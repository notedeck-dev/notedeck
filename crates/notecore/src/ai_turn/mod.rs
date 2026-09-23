//! AI エージェントのターン実行器 (#1133 縦切り 1)。
//!
//! チャット 1 ターンの状態機械を notecore に置く: provider へのラウンド (SSE)
//! → tool_use の実行 → tool_result を履歴に足して次ラウンド、を tool_use が
//! 尽きるか上限に達するまで回す。1 ラウンドに複数の tool_use が返れば全部を
//! 順に実行する (以前の JS ループは先頭以外を捨てていた)。
//!
//! この段階で notecore がやること:
//! - principal (`ai.chat` / `ai.heartbeat`) の権限解決と、宣言表からの tool 一覧の
//!   組み立て (許可されていない権限を要する capability は最初から見せない)
//! - tool 呼び出しごとの認可 (宣言の権限 ⊆ granted)。拒否は device に投げずに
//!   エラーをモデルへ返す
//! - 中断 / ラウンド上限 / 失敗の段階 (tool 実行前後) の報告
//! - ターン完了後のタイトル生成
//!
//! - 確認の要否の判定と確認要求の発行 (縦切り 2、`confirm.rs`)。要る操作は
//!   チェックポイント (`checkpoint.rs`) に turn を書いて解放し、応答で再開する
//!
//! やらないこと (後続の縦切り): capability 本体の実行 (全件をデバイスへの
//! 実行要求にする)、確認内容の組み立て (デバイスの capability 実装)、
//! セッションの書込 (デバイスがイベントを store に投影する)。
//!
//! provider とデバイスは trait で受けるので、WebView なしのハーネス (偽 provider
//! + 偽デバイス) で同じループが走る (テスト参照)。

pub mod checkpoint;
pub mod confirm;

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use specta::Type;
use tokio::task::JoinHandle;

use crate::ai_chat_service::{
    self, AiChatEvent, AiChatMessage, AiChatRequest, AiChatRole, AiChatSink, ResolvedConnection,
};
use crate::capabilities;
use crate::error::Result;
use crate::frontend_bridge::FrontendBridge;
use crate::permissions_gate;
use crate::permissions_profile::{Granted, PrincipalId};
use crate::vault::ConnectionProtocol;
use notecli::error::NoteDeckError;

/// tool_use ループで暴走しないための上限の既定値。1 ターン中に AI が連続で
/// tool を呼び続けるケースを抑える (普通は 1〜2 ラウンドで止まる)。AI 設定の
/// `generation.maxToolRounds` で変えられる。
pub const DEFAULT_MAX_TOOL_ROUNDS: u32 = 10;

/// 継続モード (#737) で system prompt 末尾に付ける通知。実行済み tool の
/// 繰り返しをモデル側でも抑止する 2 重目の防壁 (1 重目は「実行済みラウンドを
/// 再生成しない」という構造そのもの)。
pub const CONTINUATION_NOTICE: &str = "直前の応答は途中で切断されました。会話履歴にある tool 実行結果は既に実行済みです。同じ書き込み操作を繰り返さず、既存の結果を使って応答の続きを完成させてください。";

/// デバイスへの実行要求の待ち時間。確認は notecore 発 (`confirm.rs`) なので
/// ここに確認待ちは含まれない (capability 本体の実行時間だけ)。
const DEVICE_EXECUTE_TIMEOUT: Duration = Duration::from_secs(120);
/// 確認内容 (プレビュー) の組み立てをデバイスに頼む待ち時間。
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(30);

/// デバイスへの実行要求の query 種別 (JS 側 apiBridge のハンドラ名)。
pub const EXECUTE_QUERY_TYPE: &str = "ai/execute-capability";
/// 確認内容の組み立てをデバイスに頼む query 種別。
pub const PREVIEW_QUERY_TYPE: &str = "ai/confirm-preview";
/// 「次から確認しない」の記憶のスコープ (permissions.json5 の `confirmSkips`)。
const CHAT_SKIP_SCOPE: &str = "ai.chat";

const TITLE_SYSTEM_PROMPT: &str = "あなたは会話セッションのタイトル生成アシスタントです。与えられた会話の内容を端的に表す短い日本語のタイトルを 1 行で出力してください。20 文字程度 (最大 40 文字) に収めること。引用符、前置き、改行、絵文字、文末句点は付けないでください。タイトルのみを返してください。";
const TITLE_MAX_CHARS: usize = 40;

/// デバイス側だけが知っている AI tool (plugin が動的登録した capability)。
/// 宣言表に無いので、デバイスが要求に同梱する。権限はデバイス側の dispatcher
/// が「呼び出し元 ∩ 実行体」で改めて検査するが、ここでも事前フィルタに使う。
#[derive(Debug, Clone, Deserialize, Serialize, Type, Default)]
pub struct DeviceTool {
    pub id: String,
    pub description: String,
    /// `ParameterDef` の map (`{ name: { type, description, optional?, enum? } }`)
    pub params: Value,
    pub permissions: Vec<String>,
    /// 実行前に確認が要りうるか (plugin の `requiresConfirmation`)
    #[serde(default)]
    pub confirm: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, Type, Default)]
pub struct AiTurnRequest {
    pub turn_id: String,
    /// イベントの帰属先。この段階ではデバイスが store への投影に使うだけ
    pub session_id: String,
    /// `ai.chat` | `ai.heartbeat`
    pub principal: String,
    /// 呼び出し文脈のアカウント (per-account の AI カラム)。無ければ None
    pub account_id: Option<String>,
    pub connection_id: String,
    pub model: String,
    /// デバイスが組んだ system prompt (skill + デバイス文脈のスナップショット)
    pub system: Option<String>,
    /// 履歴。今回のユーザー入力を含み、placeholder / heartbeat 由来を含まない
    pub messages: Vec<AiChatMessage>,
    pub max_tokens: Option<u32>,
    pub read_timeout_ms: Option<u64>,
    pub max_tool_rounds: Option<u32>,
    /// 切断ターンの継続 (#737)。履歴末尾の実行済み tool_result から続きを生成する
    pub continuation: bool,
    /// 完了後にタイトルを生成して `title` イベントで返す (初回応答のセッション)
    pub generate_title: bool,
    pub title_max_tokens: Option<u32>,
    /// 実行時に決まる enum (`{ capabilityId: { param: [values] } }`)。宣言表に
    /// 書けない値 (カラム種別など) をデバイスが足す
    pub tool_param_enums: Option<Value>,
    pub device_tools: Vec<DeviceTool>,
}

/// `nd:ai-turn-event` の wire 形。specta 用に flat。
#[derive(Debug, Clone, Serialize, Type)]
pub struct AiTurnEvent {
    pub turn_id: String,
    /// `"delta" | "tool_use" | "tool_result" | "done" | "error" | "title"
    /// | "confirm_request" | "confirm_closed"`
    pub kind: String,
    /// delta: 追記テキスト / tool_use: その assistant メッセージの本文 (ラウンド
    /// 先頭の tool_use だけ非空) / done: 最終テキスト / title: タイトル
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// error: `"before_tool"` (tool 未実行 = 再送で安全) | `"after_tool"`
    /// (実行済み = 継続モードで再試行する)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<String>,
    /// done: `"end"` | `"tool_round_limit"`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_input: Option<Value>,
    /// tool_result: 実行が失敗 (拒否含む) だったか
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    /// confirm_request / confirm_closed: 要求 id
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirm_request_id: Option<String>,
    /// confirm_request: 束ねた項目 (`[{ toolUseId, capabilityId, params, preview, allowRemember }]`)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirm_items: Option<Value>,
    /// confirm_request: 絶対期限 (unix ms)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<u64>,
    /// confirm_closed: `decided` | `cancelled` | `expired_absolute` | `expired_display`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl AiTurnEvent {
    fn new(turn_id: &str, kind: &str) -> Self {
        Self {
            turn_id: turn_id.to_string(),
            kind: kind.to_string(),
            text: None,
            error: None,
            phase: None,
            stop_reason: None,
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            is_error: None,
            confirm_request_id: None,
            confirm_items: None,
            expires_at_ms: None,
            reason: None,
        }
    }
}

/// ターンのイベントの届け先。Tauri 側は `nd:ai-turn-event` へ emit する実装を渡す。
pub trait AiTurnSink: Send + Sync + 'static {
    fn emit(&self, event: AiTurnEvent);
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// 1 ラウンドの provider 呼び出し。実体は Vault 接続 + SSE、テストは台本。
pub trait ProviderRound: Send + Sync + 'static {
    fn protocol(&self) -> ConnectionProtocol;
    fn run<'a>(
        &'a self,
        req: &'a AiChatRequest,
        sink: &'a dyn AiChatSink,
    ) -> BoxFuture<'a, std::result::Result<(), String>>;
}

/// Vault 接続で provider を叩く本番実装。
pub struct VaultProvider(pub ResolvedConnection);

impl ProviderRound for VaultProvider {
    fn protocol(&self) -> ConnectionProtocol {
        self.0.protocol
    }
    fn run<'a>(
        &'a self,
        req: &'a AiChatRequest,
        sink: &'a dyn AiChatSink,
    ) -> BoxFuture<'a, std::result::Result<(), String>> {
        Box::pin(ai_chat_service::run_round(req, &self.0, sink))
    }
}

/// principal の実効 granted の供給元。tool 一覧の組み立てと tool 呼び出しごとに
/// 引き直す (権限ファイルの外部編集を次の判定から効かせる)。
pub trait GrantedSource: Send + Sync + 'static {
    fn granted(&self) -> BoxFuture<'_, Granted>;
}

/// permissions.json5 から principal の granted を解決する本番実装。
pub struct FileGranted(pub PrincipalId);

impl GrantedSource for FileGranted {
    fn granted(&self) -> BoxFuture<'_, Granted> {
        Box::pin(permissions_gate::granted_for(self.0))
    }
}

impl GrantedSource for Granted {
    fn granted(&self) -> BoxFuture<'_, Granted> {
        Box::pin(std::future::ready(self.clone()))
    }
}

/// 「次から確認しない」の記憶の供給元 (permissions.json5 の `confirmSkips`)。
pub trait ConfirmSkipSource: Send + Sync + 'static {
    fn skipped<'a>(&'a self, scope: &'a str, capability_id: &'a str) -> BoxFuture<'a, bool>;
}

/// permissions.json5 から読む本番実装。
pub struct FileSkips;

impl ConfirmSkipSource for FileSkips {
    fn skipped<'a>(&'a self, scope: &'a str, capability_id: &'a str) -> BoxFuture<'a, bool> {
        Box::pin(permissions_gate::confirm_skipped(scope, capability_id))
    }
}

impl ConfirmSkipSource for std::collections::HashSet<String> {
    fn skipped<'a>(&'a self, scope: &'a str, capability_id: &'a str) -> BoxFuture<'a, bool> {
        let hit = self.contains(&format!("{scope}:{capability_id}"));
        Box::pin(std::future::ready(hit))
    }
}

struct ToolUse {
    id: String,
    name: String,
    input: Value,
}

/// 1 ラウンドの受け皿。delta はターンのイベントへ転送しつつ本文に貯め、
/// tool_use は貯めるだけ (done / error は `run_round` の戻り値)。
struct RoundSink {
    turn_id: String,
    sink: Arc<dyn AiTurnSink>,
    text: Mutex<String>,
    tool_uses: Mutex<Vec<ToolUse>>,
}

impl RoundSink {
    fn new(turn_id: &str, sink: Arc<dyn AiTurnSink>) -> Self {
        Self {
            turn_id: turn_id.to_string(),
            sink,
            text: Mutex::new(String::new()),
            tool_uses: Mutex::new(Vec::new()),
        }
    }
    fn take(self) -> (String, Vec<ToolUse>) {
        (
            self.text.into_inner().unwrap_or_default(),
            self.tool_uses.into_inner().unwrap_or_default(),
        )
    }
}

impl AiChatSink for RoundSink {
    fn emit(&self, event: AiChatEvent) {
        match event.kind.as_str() {
            "delta" => {
                let Some(text) = event.text else { return };
                if let Ok(mut buf) = self.text.lock() {
                    buf.push_str(&text);
                }
                let mut e = AiTurnEvent::new(&self.turn_id, "delta");
                e.text = Some(text);
                self.sink.emit(e);
            }
            "tool_use" => {
                if let (Some(id), Some(name)) = (event.tool_use_id, event.tool_use_name) {
                    if let Ok(mut v) = self.tool_uses.lock() {
                        v.push(ToolUse {
                            id,
                            name,
                            input: event.tool_use_input.unwrap_or_else(|| json!({})),
                        });
                    }
                }
            }
            _ => {}
        }
    }
}

/// タイトル生成用の受け皿 (本文だけ貯める)。
struct CollectSink(Mutex<String>);

impl AiChatSink for CollectSink {
    fn emit(&self, event: AiChatEvent) {
        if event.kind == "delta" {
            if let (Some(t), Ok(mut buf)) = (event.text, self.0.lock()) {
                buf.push_str(&t);
            }
        }
    }
}

// --- tool 一覧 ---

/// `ParameterDef` の map から JSON Schema (object) を組む。宣言表の
/// `capabilities::input_schema` と同じ形 (デバイス側 tool 用)。
fn schema_from_param_defs(params: &Value) -> Value {
    let mut properties = Map::new();
    let mut required = Vec::new();
    if let Some(obj) = params.as_object() {
        for (name, def) in obj {
            let mut schema = Map::new();
            schema.insert(
                "type".into(),
                def.get("type").cloned().unwrap_or_else(|| json!("string")),
            );
            schema.insert(
                "description".into(),
                def.get("description").cloned().unwrap_or_else(|| json!("")),
            );
            if let Some(values) = def.get("enum") {
                schema.insert("enum".into(), values.clone());
            }
            properties.insert(name.clone(), Value::Object(schema));
            if def.get("optional").and_then(Value::as_bool) != Some(true) {
                required.push(Value::String(name.clone()));
            }
        }
    }
    let mut out = Map::new();
    out.insert("type".into(), json!("object"));
    out.insert("properties".into(), Value::Object(properties));
    if !required.is_empty() {
        out.insert("required".into(), Value::Array(required));
    }
    Value::Object(out)
}

fn tool_json(
    protocol: ConnectionProtocol,
    name: &str,
    description: &str,
    input_schema: Value,
) -> Value {
    match protocol {
        ConnectionProtocol::Anthropic => json!({
            "name": name,
            "description": description,
            "input_schema": input_schema,
        }),
        ConnectionProtocol::OpenaiCompat => json!({
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": input_schema,
            },
        }),
    }
}

/// 実行時 enum を schema に足す (`{ param: [values] }`)。
fn apply_param_enums(schema: &mut Value, enums: Option<&Value>) {
    let Some(map) = enums.and_then(Value::as_object) else {
        return;
    };
    let Some(props) = schema.get_mut("properties").and_then(Value::as_object_mut) else {
        return;
    };
    for (param, values) in map {
        if let Some(p) = props.get_mut(param) {
            if values.is_array() {
                p["enum"] = values.clone();
            }
        }
    }
}

/// 名前で引ける tool。
struct ResolvedTool {
    /// デバイスへ渡す capability id (tool 名からの逆写像ではなく元の id)
    capability_id: String,
    permissions: Vec<String>,
    /// 宣言の「確認が要りうる」
    confirm: bool,
    acts_as_account: bool,
}

/// principal に見せてよい tool 一覧 (provider 形式) と、名前 → 認可情報の表。
fn build_tools(
    req: &AiTurnRequest,
    protocol: ConnectionProtocol,
    granted: &Granted,
) -> (Vec<Value>, HashMap<String, ResolvedTool>) {
    let mut tools = Vec::new();
    let mut index = HashMap::new();
    let enums_for = |id: &str| -> Option<&Value> { req.tool_param_enums.as_ref()?.get(id) };
    for d in capabilities::CAPABILITIES {
        if !d.ai_tool || !d.permissions.iter().all(|p| granted.contains(p)) {
            continue;
        }
        let mut schema = capabilities::input_schema(d);
        apply_param_enums(&mut schema, enums_for(d.id));
        let name = capabilities::tool_name(d.id);
        tools.push(tool_json(protocol, &name, d.description, schema));
        index.insert(
            name,
            ResolvedTool {
                capability_id: d.id.to_string(),
                permissions: d.permissions.iter().map(|p| p.to_string()).collect(),
                confirm: d.confirm,
                acts_as_account: d.acts_as_account,
            },
        );
    }
    for t in &req.device_tools {
        if capabilities::find(&t.id).is_some() {
            continue; // 宣言表が正本。デバイス側の自己申告で上書きさせない
        }
        if !t.permissions.iter().all(|p| granted.contains(p.as_str())) {
            continue;
        }
        let mut schema = schema_from_param_defs(&t.params);
        apply_param_enums(&mut schema, enums_for(&t.id));
        let name = capabilities::tool_name(&t.id);
        tools.push(tool_json(protocol, &name, &t.description, schema));
        index.insert(
            name,
            ResolvedTool {
                capability_id: t.id.clone(),
                permissions: t.permissions.clone(),
                confirm: t.confirm,
                acts_as_account: false,
            },
        );
    }
    (tools, index)
}

// --- 実行 ---

/// tool 呼び出しの認可 (notecore 側)。Ok は capability id、Err はモデルへ返す
/// エラー本文 (デバイスの dispatcher と同じ `Error (code): message` 形)。
fn authorize<'a>(
    name: &str,
    index: &'a HashMap<String, ResolvedTool>,
    granted: &Granted,
) -> std::result::Result<&'a ResolvedTool, String> {
    let Some(tool) = index.get(name) else {
        return Err(format!(
            "Error (unknown_capability): 未知の capability: {name}"
        ));
    };
    let missing: Vec<&str> = tool
        .permissions
        .iter()
        .map(String::as_str)
        .filter(|p| !granted.contains(p))
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "Error (permission_denied): 権限がありません: {}",
            missing.join(", ")
        ));
    }
    Ok(tool)
}

/// デバイスの dispatcher の応答 (`DispatchResult` の JSON) → モデルへ返す本文。
fn result_text(outcome: std::result::Result<Value, String>) -> (String, bool) {
    match outcome {
        Err(e) => (format!("Error (device_unavailable): {e}"), true),
        Ok(v) => match v.get("ok").and_then(Value::as_bool) {
            Some(true) => match v.get("result") {
                Some(Value::String(s)) => (s.clone(), false),
                Some(other) => (other.to_string(), false),
                None => ("null".into(), false),
            },
            Some(false) => (
                format!(
                    "Error ({}): {}",
                    v.get("code")
                        .and_then(Value::as_str)
                        .unwrap_or("execute_failed"),
                    v.get("error").and_then(Value::as_str).unwrap_or("")
                ),
                true,
            ),
            None => (
                format!(
                    "Error (execute_failed): {}",
                    v.get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("デバイスが不正な応答を返しました")
                ),
                true,
            ),
        },
    }
}

fn round_request(
    req: &AiTurnRequest,
    round: u32,
    messages: &[AiChatMessage],
    tools: &[Value],
) -> AiChatRequest {
    let system = if req.continuation {
        Some(match req.system.as_deref().filter(|s| !s.is_empty()) {
            Some(base) => format!("{base}\n\n{CONTINUATION_NOTICE}"),
            None => CONTINUATION_NOTICE.to_string(),
        })
    } else {
        req.system.clone()
    };
    AiChatRequest {
        stream_id: format!("{}:{}", req.turn_id, round),
        connection_id: req.connection_id.clone(),
        model: req.model.clone(),
        messages: messages.to_vec(),
        system,
        max_tokens: req.max_tokens,
        read_timeout_ms: req.read_timeout_ms,
        tools: if tools.is_empty() {
            None
        } else {
            Some(Value::Array(tools.to_vec()))
        },
    }
}

/// タイトルの整形 (JS 版と同じ規則): 改行を空白に、両端の引用符・句読点を
/// 落とし、上限文字数で切る。
pub fn clean_title(raw: &str) -> String {
    // 改行の連続は 1 つの空白に (JS の `[\r\n]+` と同じ)
    let mut joined = String::with_capacity(raw.len());
    let mut in_newline = false;
    for c in raw.chars() {
        if c == '\r' || c == '\n' {
            if !in_newline {
                joined.push(' ');
                in_newline = true;
            }
        } else {
            joined.push(c);
            in_newline = false;
        }
    }
    let leading: &[char] = &['「', '『', '"', '\'', '“', '”'];
    let trailing: &[char] = &['」', '』', '"', '\'', '“', '”', '。', '．', '、'];
    let t = joined
        .trim()
        .trim_start_matches(|c: char| c.is_whitespace() || leading.contains(&c))
        .trim_end_matches(|c: char| c.is_whitespace() || trailing.contains(&c))
        .trim();
    t.chars().take(TITLE_MAX_CHARS).collect()
}

/// 履歴からタイトル生成に使う「今回のユーザー入力」を取る (tool_result を除く
/// 最後の user メッセージ)。
fn last_user_text(messages: &[AiChatMessage]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|m| matches!(m.role, AiChatRole::User) && m.tool_result_for.is_none())
        .map(|m| m.content.as_str())
}

async fn generate_title(
    req: &AiTurnRequest,
    provider: &dyn ProviderRound,
    final_text: &str,
) -> Option<String> {
    let user_text = last_user_text(&req.messages)?;
    let prompt = format!(
        "次の会話に短いタイトルを付けてください。タイトルだけを 1 行で出力。\n\nユーザー:\n{user_text}\n\nアシスタント:\n{final_text}"
    );
    let title_req = AiChatRequest {
        stream_id: format!("{}:title", req.turn_id),
        connection_id: req.connection_id.clone(),
        model: req.model.clone(),
        messages: vec![AiChatMessage {
            role: AiChatRole::User,
            content: prompt,
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: None,
        }],
        system: Some(TITLE_SYSTEM_PROMPT.to_string()),
        max_tokens: req.title_max_tokens,
        read_timeout_ms: req.read_timeout_ms,
        tools: None,
    };
    let sink = CollectSink(Mutex::new(String::new()));
    if let Err(e) = provider.run(&title_req, &sink).await {
        tracing::warn!("ai title generation failed: {e}");
        return None;
    }
    let raw = sink.0.into_inner().unwrap_or_default();
    let cleaned = clean_title(&raw);
    if cleaned.is_empty() {
        None
    } else {
        Some(cleaned)
    }
}

// --- ターンの状態 (チェックポイント可能) ---

/// ラウンドで返った tool 呼び出し 1 件の処理状態。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingToolUse {
    pub id: String,
    pub name: String,
    pub input: Value,
    /// 認可で拒否されたときの本文 (デバイスには投げない)
    pub deny: Option<String>,
    /// デバイスへ渡す capability id
    pub capability_id: Option<String>,
    /// 確認が要る (notecore の判定)
    pub needs_confirm: bool,
    /// 確認の結果。None = 未決 (needs_confirm のとき) / 不要
    pub decision: Option<bool>,
}

/// turn の状態。確認で停止するときはこれをチェックポイントに書き、応答で
/// 読み戻して続きから走る。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurnState {
    pub req: AiTurnRequest,
    pub messages: Vec<AiChatMessage>,
    pub rounds: u32,
    pub final_text: String,
    pub tool_executed: bool,
    /// 現ラウンドの assistant 本文 (先頭の tool_use に付く)
    pub round_text: String,
    /// 現ラウンドの tool 呼び出し (実行順)
    pub pending: Vec<PendingToolUse>,
    /// `pending` のうち次に実行する位置
    pub next_index: usize,
    /// 確認が拒否された理由 (期限切れ / 中断)。ユーザーの拒否は None
    pub reject_reason: Option<String>,
}

impl TurnState {
    pub fn new(req: AiTurnRequest) -> Self {
        Self {
            messages: req.messages.clone(),
            tool_executed: req.continuation,
            req,
            rounds: 0,
            final_text: String::new(),
            round_text: String::new(),
            pending: Vec::new(),
            next_index: 0,
            reject_reason: None,
        }
    }
}

/// turn を動かすのに要るもの一式。再開 (確認の応答後) でも同じものを使う。
pub struct TurnRuntime {
    pub provider: Arc<dyn ProviderRound>,
    pub granted: Arc<dyn GrantedSource>,
    pub skips: Arc<dyn ConfirmSkipSource>,
    pub bridge: Arc<dyn FrontendBridge>,
    pub sink: Arc<dyn AiTurnSink>,
    /// チェックポイントの置き場
    pub store_dir: PathBuf,
    pub policy: confirm::ConfirmPolicy,
}

/// クロスアカウント実行か (#777): actsAsAccount 付き capability で、呼び出し
/// 文脈のアカウントがあり、それと異なるアカウントを明示指定した。
/// 「次から確認しない」の対象外で、必ず確認する (デバイスの dispatcher と同じ規則)。
fn is_cross_account(tool: &ResolvedTool, input: &Value, account_id: Option<&str>) -> bool {
    let Some(ctx) = account_id.filter(|s| !s.is_empty()) else {
        return false;
    };
    if !tool.acts_as_account {
        return false;
    }
    match input.get("accountId").and_then(Value::as_str) {
        Some(explicit) if !explicit.is_empty() => explicit != ctx,
        _ => false,
    }
}

/// ラウンドの tool 呼び出しを認可し、確認の要否を決める。
async fn prepare_pending(
    rt: &TurnRuntime,
    req: &AiTurnRequest,
    index: &HashMap<String, ResolvedTool>,
    tool_uses: Vec<ToolUse>,
) -> Vec<PendingToolUse> {
    let granted = rt.granted.granted().await;
    let unattended = req.principal == "ai.heartbeat";
    let mut out = Vec::with_capacity(tool_uses.len());
    for tu in tool_uses {
        let mut p = PendingToolUse {
            id: tu.id,
            name: tu.name,
            input: tu.input,
            deny: None,
            capability_id: None,
            needs_confirm: false,
            decision: None,
        };
        match authorize(&p.name, index, &granted) {
            Err(text) => p.deny = Some(text),
            Ok(tool) => {
                p.capability_id = Some(tool.capability_id.clone());
                let cross = is_cross_account(tool, &p.input, req.account_id.as_deref());
                let mut needs = tool.confirm || cross;
                if needs && !cross {
                    // 「次から確認しない」(権限ファイルへの減算) を尊重する
                    if rt.skips.skipped(CHAT_SKIP_SCOPE, &tool.capability_id).await {
                        needs = false;
                    }
                }
                if needs && unattended {
                    // 無人実行は承認を待たない (#1106 §4.8)。その場で拒否して
                    // AI に返す。下書き / 受信箱カードに変えるのは後続
                    p.deny = Some(format!(
                        "Error (user_cancelled): Unattended HEARTBEAT does not run operations that require confirmation: {}",
                        tool.capability_id
                    ));
                } else {
                    p.needs_confirm = needs;
                }
            }
        }
        out.push(p);
    }
    out
}

/// 確認が要る項目のプレビューをデバイスに組み立ててもらい、1 枚の要求に
/// 束ねる項目 (JSON) を返す。デバイスが「この引数なら確認不要」と答えた項目は
/// needs_confirm を下ろす。
async fn collect_previews(rt: &TurnRuntime, state: &mut TurnState) -> Vec<Value> {
    let mut items = Vec::new();
    for p in state.pending.iter_mut() {
        if !p.needs_confirm || p.decision.is_some() {
            continue;
        }
        let capability_id = p.capability_id.clone().unwrap_or_default();
        let cross = capabilities::find(&capability_id)
            .map(|d| d.acts_as_account)
            .unwrap_or(false)
            && is_cross_account(
                &ResolvedTool {
                    capability_id: capability_id.clone(),
                    permissions: Vec::new(),
                    confirm: true,
                    acts_as_account: true,
                },
                &p.input,
                state.req.account_id.as_deref(),
            );
        let reply = rt
            .bridge
            .query(
                PREVIEW_QUERY_TYPE,
                json!({
                    "turnId": state.req.turn_id,
                    "principal": state.req.principal,
                    "accountId": state.req.account_id,
                    "capabilityId": capability_id,
                    "params": p.input,
                    "crossAccount": cross,
                }),
                PREVIEW_TIMEOUT,
            )
            .await;
        let (preview, allow_remember) = match reply {
            Ok(v) if v.get("needsConfirmation").and_then(Value::as_bool) == Some(false) => {
                p.needs_confirm = false;
                continue;
            }
            Ok(v) => (
                v.get("options").cloned().unwrap_or(Value::Null),
                v.get("allowRemember")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                    && !cross,
            ),
            Err(e) => {
                tracing::warn!(capability_id, "confirm preview unavailable: {e}");
                (Value::Null, false)
            }
        };
        let preview = if preview.is_null() {
            json!({
                "title": format!("{capability_id} を実行しますか?"),
                "message": "",
                "code": serde_json::to_string_pretty(&p.input).unwrap_or_default(),
                "codeLanguage": "json",
                "okLabel": "実行",
                "cancelLabel": "やめる",
                "type": "danger",
            })
        } else {
            preview
        };
        items.push(json!({
            "toolUseId": p.id,
            "capabilityId": capability_id,
            "params": p.input,
            "preview": preview,
            "allowRemember": allow_remember,
        }));
    }
    items
}

/// 現ラウンドの tool 呼び出しを `next_index` から順に実行する。
async fn execute_pending(rt: &TurnRuntime, state: &mut TurnState) {
    let turn_id = state.req.turn_id.clone();
    while state.next_index < state.pending.len() {
        let i = state.next_index;
        let tu = state.pending[i].clone();
        let assistant_text = if i == 0 {
            state.round_text.clone()
        } else {
            String::new()
        };
        let mut e = AiTurnEvent::new(&turn_id, "tool_use");
        e.text = Some(assistant_text.clone());
        e.tool_use_id = Some(tu.id.clone());
        e.tool_use_name = Some(tu.name.clone());
        e.tool_use_input = Some(tu.input.clone());
        rt.sink.emit(e);

        let (result, is_error) = if let Some(deny) = tu.deny.clone() {
            (deny, true)
        } else if tu.needs_confirm && tu.decision != Some(true) {
            let id = tu.capability_id.clone().unwrap_or_default();
            (
                match state.reject_reason.as_deref() {
                    Some(reason) => format!(
                        "Error (confirm_{reason}): 確認が得られませんでした ({reason}): {id}"
                    ),
                    None => format!("Error (user_cancelled): User cancelled execution of {id}"),
                },
                true,
            )
        } else {
            state.tool_executed = true;
            let outcome = rt
                .bridge
                .query(
                    EXECUTE_QUERY_TYPE,
                    json!({
                        "turnId": turn_id,
                        "principal": state.req.principal,
                        "accountId": state.req.account_id,
                        "capabilityId": tu.capability_id,
                        "params": tu.input,
                        // notecore で確認済み (デバイス側は確認を出さない)
                        "confirmed": tu.needs_confirm,
                    }),
                    DEVICE_EXECUTE_TIMEOUT,
                )
                .await;
            result_text(outcome)
        };
        let mut e = AiTurnEvent::new(&turn_id, "tool_result");
        e.tool_use_id = Some(tu.id.clone());
        e.text = Some(result.clone());
        e.is_error = Some(is_error);
        rt.sink.emit(e);

        state.messages.push(AiChatMessage {
            role: AiChatRole::Assistant,
            content: assistant_text,
            tool_use_id: Some(tu.id.clone()),
            tool_use_name: Some(tu.name),
            tool_use_input: Some(tu.input),
            tool_result_for: None,
        });
        state.messages.push(AiChatMessage {
            role: AiChatRole::User,
            content: result,
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: Some(tu.id),
        });
        state.next_index += 1;
    }
}

/// ターン本体。イベントは sink へ、tool の実行はデバイス (橋) へ。確認が要る
/// 呼び出しに当たったら要求を出してチェックポイントを書き、戻る (再開は
/// `confirm::respond` が `spawn_drive` で行う)。
pub async fn drive(rt: Arc<TurnRuntime>, mut state: TurnState) {
    let turn_id = state.req.turn_id.clone();
    let (tools, index) = build_tools(
        &state.req,
        rt.provider.protocol(),
        &rt.granted.granted().await,
    );
    let max_rounds = state.req.max_tool_rounds.unwrap_or(DEFAULT_MAX_TOOL_ROUNDS);

    let stop_reason = loop {
        if state.pending.is_empty() {
            let round_req = round_request(&state.req, state.rounds, &state.messages, &tools);
            let round_sink = RoundSink::new(&turn_id, rt.sink.clone());
            if let Err(message) = rt.provider.run(&round_req, &round_sink).await {
                let mut e = AiTurnEvent::new(&turn_id, "error");
                e.error = Some(message);
                e.phase = Some(
                    if state.tool_executed {
                        "after_tool"
                    } else {
                        "before_tool"
                    }
                    .into(),
                );
                rt.sink.emit(e);
                checkpoint::close(&rt.store_dir, &turn_id, "error");
                return;
            }
            let (text, tool_uses) = round_sink.take();
            if !text.is_empty() {
                state.final_text = text.clone();
            }
            if tool_uses.is_empty() {
                break "end";
            }
            if state.rounds >= max_rounds {
                state.final_text = format!(
                    "{}\n\n⚠️ tool 呼び出しが上限 ({max_rounds} 回) に達しました。",
                    if text.is_empty() {
                        &state.final_text
                    } else {
                        &text
                    }
                );
                break "tool_round_limit";
            }
            state.rounds += 1;
            state.round_text = text;
            state.next_index = 0;
            state.reject_reason = None;
            state.pending = prepare_pending(&rt, &state.req, &index, tool_uses).await;

            if state
                .pending
                .iter()
                .any(|p| p.needs_confirm && p.decision.is_none())
            {
                let items = collect_previews(&rt, &mut state).await;
                if !items.is_empty() {
                    match confirm::suspend(rt.clone(), &state, items) {
                        Ok(()) => return,
                        Err(e) => {
                            // 要求を出せない (書込失敗) なら聞かずに拒否する
                            tracing::warn!(turn_id, "cannot suspend for confirmation: {e}");
                            for p in state.pending.iter_mut() {
                                if p.needs_confirm && p.decision.is_none() {
                                    p.decision = Some(false);
                                }
                            }
                            state.reject_reason = Some("unavailable".into());
                        }
                    }
                }
            }
        }
        execute_pending(&rt, &mut state).await;
        state.pending.clear();
        state.round_text.clear();
    };

    let mut e = AiTurnEvent::new(&turn_id, "done");
    e.text = Some(state.final_text.clone());
    e.stop_reason = Some(stop_reason.into());
    rt.sink.emit(e);
    checkpoint::close(&rt.store_dir, &turn_id, "done");

    if state.req.generate_title && !state.final_text.is_empty() {
        if let Some(title) =
            generate_title(&state.req, rt.provider.as_ref(), &state.final_text).await
        {
            let mut e = AiTurnEvent::new(&turn_id, "title");
            e.text = Some(title);
            rt.sink.emit(e);
        }
    }
}

// --- 台帳 (中断用) ---

fn active_turns() -> &'static Mutex<HashMap<String, JoinHandle<()>>> {
    static TURNS: OnceLock<Mutex<HashMap<String, JoinHandle<()>>>> = OnceLock::new();
    TURNS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// turn を background task で走らせ、台帳に登録する (開始と再開の両方)。
pub(crate) fn spawn_drive(rt: Arc<TurnRuntime>, state: TurnState) {
    let turn_id = state.req.turn_id.clone();
    let turn_id_for_task = turn_id.clone();
    let handle = tokio::spawn(async move {
        drive(rt, state).await;
        if let Ok(mut turns) = active_turns().lock() {
            turns.remove(&turn_id_for_task);
        }
    });
    if let Ok(mut turns) = active_turns().lock() {
        if let Some(prev) = turns.insert(turn_id, handle) {
            prev.abort();
        }
    }
}

/// ターンを開始する。入力検証と接続解決はここで行い (エラーは呼び出し元へ)、
/// 本体は background task。以後のイベントは sink に流れる。
pub async fn start_turn(
    req: AiTurnRequest,
    app_dir: &Path,
    bridge: Arc<dyn FrontendBridge>,
    sink: Arc<dyn AiTurnSink>,
) -> Result<()> {
    if req.turn_id.trim().is_empty() {
        return Err(NoteDeckError::InvalidInput("turn_id is empty".into()));
    }
    let principal = match PrincipalId::parse(&req.principal) {
        Some(p @ (PrincipalId::AiChat | PrincipalId::AiHeartbeat)) => p,
        _ => {
            return Err(NoteDeckError::InvalidInput(format!(
                "AI ループの principal ではありません: {}",
                req.principal
            )))
        }
    };
    ai_chat_service::validate_request(&round_request(&req, 0, &req.messages, &[]))?;
    let conn = ai_chat_service::resolve_connection(app_dir, &req.connection_id)?;
    let rt = Arc::new(TurnRuntime {
        provider: Arc::new(VaultProvider(conn)),
        granted: Arc::new(FileGranted(principal)),
        skips: Arc::new(FileSkips),
        bridge,
        sink,
        store_dir: checkpoint::dir(app_dir),
        policy: confirm::ConfirmPolicy::default(),
    });
    spawn_drive(rt, TurnState::new(req));
    Ok(())
}

/// 進行中のターンを中断する。冪等。イベントは出さない (中断した側が知っている)
/// が、確認待ちなら要求を cancelled で閉じる。デバイスへ出した実行要求は
/// 応答待ちごと捨てる。
pub fn cancel_turn(turn_id: &str) {
    let handle = active_turns()
        .lock()
        .ok()
        .and_then(|mut t| t.remove(turn_id));
    if let Some(h) = handle {
        h.abort();
    }
    confirm::cancel_for_turn(turn_id);
}

/// 終了処理: 進行中の全ターンと確認待ちを中断する。
pub fn abort_all_turns() {
    let handles: Vec<JoinHandle<()>> = active_turns()
        .lock()
        .map(|mut t| t.drain().map(|(_, h)| h).collect())
        .unwrap_or_default();
    for h in handles {
        h.abort();
    }
    confirm::abort_all();
}

/// 起動時の復旧: 前回停止中のまま残った turn を閉じる (`checkpoint::recover`)。
pub fn recover(app_dir: &Path) {
    let closed = checkpoint::recover(&checkpoint::dir(app_dir));
    if !closed.is_empty() {
        tracing::warn!(
            count = closed.len(),
            "ai turns left pending across restart were closed"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frontend_bridge::BridgeFuture;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// 台本どおりに delta / tool_use を流す偽 provider。
    struct ScriptedProvider {
        rounds: Mutex<Vec<Vec<AiChatEvent>>>,
        requests: Mutex<Vec<AiChatRequest>>,
        fail_at: Option<usize>,
    }

    impl ScriptedProvider {
        fn new(rounds: Vec<Vec<AiChatEvent>>) -> Arc<Self> {
            Arc::new(Self {
                rounds: Mutex::new(rounds),
                requests: Mutex::new(Vec::new()),
                fail_at: None,
            })
        }
        fn failing_at(rounds: Vec<Vec<AiChatEvent>>, at: usize) -> Arc<Self> {
            Arc::new(Self {
                rounds: Mutex::new(rounds),
                requests: Mutex::new(Vec::new()),
                fail_at: Some(at),
            })
        }
    }

    fn delta(text: &str) -> AiChatEvent {
        AiChatEvent {
            stream_id: String::new(),
            kind: "delta".into(),
            text: Some(text.into()),
            error: None,
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
        }
    }

    fn tool_use(id: &str, name: &str, input: Value) -> AiChatEvent {
        AiChatEvent {
            stream_id: String::new(),
            kind: "tool_use".into(),
            text: None,
            error: None,
            tool_use_id: Some(id.into()),
            tool_use_name: Some(name.into()),
            tool_use_input: Some(input),
        }
    }

    impl ProviderRound for ScriptedProvider {
        fn protocol(&self) -> ConnectionProtocol {
            ConnectionProtocol::Anthropic
        }
        fn run<'a>(
            &'a self,
            req: &'a AiChatRequest,
            sink: &'a dyn AiChatSink,
        ) -> BoxFuture<'a, std::result::Result<(), String>> {
            Box::pin(async move {
                let n = {
                    let mut reqs = self.requests.lock().unwrap();
                    reqs.push(req.clone());
                    reqs.len() - 1
                };
                if self.fail_at == Some(n) {
                    return Err("接続が切断されました".into());
                }
                let events = {
                    let mut rounds = self.rounds.lock().unwrap();
                    if rounds.is_empty() {
                        return Err("script exhausted".into());
                    }
                    rounds.remove(0)
                };
                for e in events {
                    sink.emit(e);
                }
                Ok(())
            })
        }
    }

    /// 実行要求 / プレビュー要求を記録して固定の結果を返す偽デバイス。
    struct FakeDevice {
        calls: Mutex<Vec<(String, Value)>>,
        execute_reply: Value,
        preview_reply: Value,
    }

    impl FakeDevice {
        fn new(execute_reply: Value) -> Arc<Self> {
            Arc::new(Self {
                calls: Mutex::new(Vec::new()),
                execute_reply,
                preview_reply: json!({
                    "needsConfirmation": true,
                    "options": { "title": "投稿しますか?", "message": "hi" },
                    "allowRemember": true,
                }),
            })
        }
        fn with_preview(execute_reply: Value, preview_reply: Value) -> Arc<Self> {
            Arc::new(Self {
                calls: Mutex::new(Vec::new()),
                execute_reply,
                preview_reply,
            })
        }
        fn executes(&self) -> Vec<Value> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(t, _)| t == EXECUTE_QUERY_TYPE)
                .map(|(_, p)| p.clone())
                .collect()
        }
        fn previews(&self) -> Vec<Value> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(t, _)| t == PREVIEW_QUERY_TYPE)
                .map(|(_, p)| p.clone())
                .collect()
        }
    }

    impl FrontendBridge for FakeDevice {
        fn query<'a>(
            &'a self,
            query_type: &'a str,
            params: Value,
            _t: Duration,
        ) -> BridgeFuture<'a> {
            self.calls
                .lock()
                .unwrap()
                .push((query_type.to_string(), params));
            let reply = match query_type {
                EXECUTE_QUERY_TYPE => self.execute_reply.clone(),
                PREVIEW_QUERY_TYPE => self.preview_reply.clone(),
                other => panic!("unexpected query {other}"),
            };
            Box::pin(async move { Ok(reply) })
        }
        fn health_report(&self) -> BridgeFuture<'_> {
            Box::pin(async { Ok(Value::Null) })
        }
    }

    #[derive(Default)]
    struct RecordingSink(Mutex<Vec<AiTurnEvent>>);

    impl AiTurnSink for RecordingSink {
        fn emit(&self, event: AiTurnEvent) {
            self.0.lock().unwrap().push(event);
        }
    }

    impl RecordingSink {
        fn kinds(&self) -> Vec<String> {
            self.0
                .lock()
                .unwrap()
                .iter()
                .map(|e| e.kind.clone())
                .collect()
        }
        fn last(&self) -> AiTurnEvent {
            self.0.lock().unwrap().last().unwrap().clone()
        }
        fn find(&self, kind: &str) -> Option<AiTurnEvent> {
            self.0
                .lock()
                .unwrap()
                .iter()
                .find(|e| e.kind == kind)
                .cloned()
        }
        /// kind のイベントが届くまで待つ (再開は別 task なので)
        async fn wait_for(&self, kind: &str) -> AiTurnEvent {
            for _ in 0..500 {
                if let Some(e) = self.find(kind) {
                    return e;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            panic!("event {kind} did not arrive; got {:?}", self.kinds());
        }
    }

    fn user(text: &str) -> AiChatMessage {
        AiChatMessage {
            role: AiChatRole::User,
            content: text.into(),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: None,
        }
    }

    static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

    /// 台帳 (グローバル) をテスト間で衝突させないよう一意な turn id を振る
    fn request() -> AiTurnRequest {
        let n = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        AiTurnRequest {
            turn_id: format!("t{n}-{}", std::process::id()),
            session_id: "s1".into(),
            principal: "ai.chat".into(),
            connection_id: "c1".into(),
            model: "m".into(),
            messages: vec![user("いま何時?")],
            ..Default::default()
        }
    }

    fn granted(keys: &[&'static str]) -> Granted {
        keys.iter().copied().collect()
    }

    struct Harness {
        rt: Arc<TurnRuntime>,
        sink: Arc<RecordingSink>,
        _dir: tempfile::TempDir,
    }

    fn harness(
        provider: Arc<ScriptedProvider>,
        keys: &[&'static str],
        device: Arc<FakeDevice>,
    ) -> Harness {
        harness_with(
            provider,
            keys,
            device,
            HashSet::new(),
            confirm::ConfirmPolicy::default(),
        )
    }

    fn harness_with(
        provider: Arc<ScriptedProvider>,
        keys: &[&'static str],
        device: Arc<FakeDevice>,
        skips: HashSet<String>,
        policy: confirm::ConfirmPolicy,
    ) -> Harness {
        let dir = tempfile::tempdir().unwrap();
        let sink = Arc::new(RecordingSink::default());
        let rt = Arc::new(TurnRuntime {
            provider,
            granted: Arc::new(granted(keys)),
            skips: Arc::new(skips),
            bridge: device,
            sink: sink.clone(),
            store_dir: checkpoint::dir(dir.path()),
            policy,
        });
        Harness {
            rt,
            sink,
            _dir: dir,
        }
    }

    #[tokio::test]
    async fn multi_round_turn_executes_every_tool_use_and_feeds_results_back() {
        // ラウンド 1: 本文 + tool_use 2 件 (並列)、ラウンド 2: 最終本文
        let provider = ScriptedProvider::new(vec![
            vec![
                delta("確認します"),
                tool_use("tu1", "time_now", json!({})),
                tool_use("tu2", "account_list", json!({})),
            ],
            vec![delta("12 時です")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "pong"}));
        let h = harness(provider.clone(), &["account.read"], device.clone());
        let req = request();
        drive(h.rt.clone(), TurnState::new(req.clone())).await;

        assert_eq!(
            h.sink.kinds(),
            [
                "delta",
                "tool_use",
                "tool_result",
                "tool_use",
                "tool_result",
                "delta",
                "done"
            ]
        );
        // 両方の tool がデバイスに届く (以前の JS ループは 2 件目を捨てていた)
        let calls = device.executes();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["capabilityId"], "time.now");
        assert_eq!(calls[0]["principal"], "ai.chat");
        assert_eq!(calls[0]["turnId"], req.turn_id);
        assert_eq!(calls[0]["confirmed"], false);
        assert_eq!(calls[1]["capabilityId"], "account.list");
        // ラウンド 2 の履歴は user → assistant(tool_use) → user(tool_result) ×2
        let reqs = provider.requests.lock().unwrap();
        let history = &reqs[1].messages;
        assert_eq!(history.len(), 5);
        assert_eq!(history[1].tool_use_id.as_deref(), Some("tu1"));
        assert_eq!(history[1].content, "確認します");
        assert_eq!(history[2].tool_result_for.as_deref(), Some("tu1"));
        assert_eq!(history[2].content, "pong");
        assert_eq!(history[3].content, "");
        assert_eq!(history[4].tool_result_for.as_deref(), Some("tu2"));
        let done = h.sink.last();
        assert_eq!(done.text.as_deref(), Some("12 時です"));
        assert_eq!(done.stop_reason.as_deref(), Some("end"));
        // 確認で停止していないのでチェックポイントは無い
        assert!(checkpoint::read(&h.rt.store_dir, &req.turn_id).is_err());
    }

    #[tokio::test]
    async fn tools_are_filtered_by_granted_and_denied_calls_never_reach_the_device() {
        let provider = ScriptedProvider::new(vec![
            vec![tool_use("tu1", "notes_create", json!({"text": "hi"}))],
            vec![delta("done")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "never"}));
        // notes.write を持たない principal
        let h = harness(provider.clone(), &["notes.read"], device.clone());
        drive(h.rt.clone(), TurnState::new(request())).await;

        assert!(device.executes().is_empty());
        let result = h.sink.find("tool_result").unwrap();
        assert_eq!(result.is_error, Some(true));
        assert!(result
            .text
            .as_deref()
            .unwrap()
            .starts_with("Error (unknown_capability)"));
        // tool 一覧にも notes.create は載らない
        let reqs = provider.requests.lock().unwrap();
        let names: Vec<String> = reqs[0]
            .tools
            .as_ref()
            .and_then(Value::as_array)
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();
        assert!(!names.contains(&"notes_create".to_string()));
        assert!(names.contains(&"notes_search".to_string()));
    }

    #[tokio::test]
    async fn round_limit_stops_the_loop_with_a_warning() {
        let mut rounds = Vec::new();
        for i in 0..3 {
            rounds.push(vec![tool_use(&format!("tu{i}"), "time_now", json!({}))]);
        }
        let provider = ScriptedProvider::new(rounds);
        let device = FakeDevice::new(json!({"ok": true, "result": "x"}));
        let h = harness(provider, &[], device.clone());
        let mut req = request();
        req.max_tool_rounds = Some(1);
        drive(h.rt.clone(), TurnState::new(req)).await;

        assert_eq!(device.executes().len(), 1);
        let done = h.sink.last();
        assert_eq!(done.stop_reason.as_deref(), Some("tool_round_limit"));
        assert!(done.text.unwrap().contains("上限 (1 回)"));
    }

    #[tokio::test]
    async fn error_phase_tells_whether_a_tool_already_ran() {
        let device = FakeDevice::new(json!({"ok": true, "result": "x"}));

        // ラウンド 1 で失敗 → before_tool (再送で安全)
        let h = harness(ScriptedProvider::failing_at(vec![], 0), &[], device.clone());
        drive(h.rt.clone(), TurnState::new(request())).await;
        let e = h.sink.last();
        assert_eq!(e.kind, "error");
        assert_eq!(e.phase.as_deref(), Some("before_tool"));

        // ラウンド 2 で失敗 → after_tool (継続モードで再試行)
        let provider =
            ScriptedProvider::failing_at(vec![vec![tool_use("tu1", "time_now", json!({}))]], 1);
        let h = harness(provider, &[], device.clone());
        drive(h.rt.clone(), TurnState::new(request())).await;
        assert_eq!(h.sink.last().phase.as_deref(), Some("after_tool"));

        // 継続モードは最初から after_tool 扱いで、system に通知が付く
        let provider = ScriptedProvider::failing_at(vec![], 0);
        let h = harness(provider.clone(), &[], device);
        let mut req = request();
        req.continuation = true;
        req.system = Some("base".into());
        drive(h.rt.clone(), TurnState::new(req)).await;
        assert_eq!(h.sink.last().phase.as_deref(), Some("after_tool"));
        let reqs = provider.requests.lock().unwrap();
        assert_eq!(
            reqs[0].system.as_deref(),
            Some(format!("base\n\n{CONTINUATION_NOTICE}").as_str())
        );
    }

    #[tokio::test]
    async fn device_tools_and_runtime_enums_are_merged_into_the_tool_list() {
        let provider = ScriptedProvider::new(vec![vec![delta("ok")]]);
        let device = FakeDevice::new(Value::Null);
        let h = harness(provider.clone(), &["deck.write", "deck.read"], device);
        let mut req = request();
        req.device_tools = vec![
            DeviceTool {
                id: "plugin.hello".into(),
                description: "plugin tool".into(),
                params: json!({"name": {"type": "string", "description": "n"}}),
                permissions: vec![],
                confirm: false,
            },
            DeviceTool {
                // 宣言表にある id はデバイス側の申告で上書きできない
                id: "time.now".into(),
                description: "spoof".into(),
                params: json!({}),
                permissions: vec![],
                confirm: false,
            },
        ];
        req.tool_param_enums = Some(json!({"column.add": {"type": ["timeline", "notifications"]}}));
        drive(h.rt.clone(), TurnState::new(req)).await;

        let reqs = provider.requests.lock().unwrap();
        let tools = reqs[0].tools.as_ref().unwrap().as_array().unwrap().clone();
        let by_name = |n: &str| tools.iter().find(|t| t["name"] == n).cloned();
        let plugin = by_name("plugin_hello").expect("plugin tool present");
        assert_eq!(plugin["input_schema"]["required"], json!(["name"]));
        assert_eq!(
            by_name("time_now").unwrap()["description"],
            capabilities::find("time.now").unwrap().description
        );
        let add = by_name("column_add").expect("column.add present");
        assert_eq!(
            add["input_schema"]["properties"]["type"]["enum"],
            json!(["timeline", "notifications"])
        );
    }

    #[tokio::test]
    async fn title_is_generated_after_done_when_requested() {
        let provider = ScriptedProvider::new(vec![
            vec![delta("12 時です")],
            vec![delta("「現在時刻の確認」\n")],
        ]);
        let device = FakeDevice::new(Value::Null);
        let h = harness(provider.clone(), &[], device);
        let mut req = request();
        req.generate_title = true;
        drive(h.rt.clone(), TurnState::new(req)).await;
        assert_eq!(h.sink.kinds(), ["delta", "done", "title"]);
        assert_eq!(h.sink.last().text.as_deref(), Some("現在時刻の確認"));
        let reqs = provider.requests.lock().unwrap();
        assert!(reqs[1].messages[0].content.contains("いま何時?"));
        assert!(reqs[1].tools.is_none());
    }

    // --- 確認要求 (縦切り 2) ---

    fn confirm_script() -> Arc<ScriptedProvider> {
        ScriptedProvider::new(vec![
            vec![
                delta("投稿します"),
                tool_use("tu1", "notes_create", json!({"text": "hi"})),
            ],
            vec![delta("投稿しました")],
        ])
    }

    #[tokio::test]
    async fn confirm_required_tool_suspends_the_turn_and_resumes_on_accept() {
        let provider = confirm_script();
        let device = FakeDevice::new(json!({"ok": true, "result": "note-1"}));
        let h = harness(provider.clone(), &["notes.write"], device.clone());
        let req = request();
        drive(h.rt.clone(), TurnState::new(req.clone())).await;

        // 要求を出して戻る: 実行はまだ、チェックポイントはある
        assert_eq!(h.sink.kinds(), ["delta", "confirm_request"]);
        assert!(device.executes().is_empty());
        let previews = device.previews();
        assert_eq!(previews.len(), 1);
        assert_eq!(previews[0]["capabilityId"], "notes.create");
        assert_eq!(previews[0]["crossAccount"], false);
        let cp = checkpoint::read(&h.rt.store_dir, &req.turn_id).unwrap();
        assert_eq!(cp.pending.len(), 1);
        assert!(cp.pending[0].needs_confirm);
        let request = h.sink.last();
        let request_id = request.confirm_request_id.clone().unwrap();
        let items = request.confirm_items.clone().unwrap();
        assert_eq!(items[0]["capabilityId"], "notes.create");
        assert_eq!(items[0]["preview"]["title"], "投稿しますか?");
        assert_eq!(items[0]["allowRemember"], true);
        assert!(request.expires_at_ms.is_some());

        // 許可 → 再開 → 確認済みとして実行 → 完了
        confirm::respond(&request_id, true).unwrap();
        h.sink.wait_for("done").await;
        assert_eq!(
            h.sink.kinds(),
            [
                "delta",
                "confirm_request",
                "confirm_closed",
                "tool_use",
                "tool_result",
                "delta",
                "done"
            ]
        );
        assert_eq!(
            h.sink.find("confirm_closed").unwrap().reason.as_deref(),
            Some(confirm::REASON_DECIDED)
        );
        let calls = device.executes();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["confirmed"], true);
        assert_eq!(
            h.sink.find("tool_result").unwrap().text.as_deref(),
            Some("note-1")
        );
        // 決着済みへの応答は明示エラー
        assert!(confirm::respond(&request_id, true).is_err());
        // 完了でチェックポイントは閉じる
        assert!(checkpoint::read(&h.rt.store_dir, &req.turn_id).is_err());
    }

    #[tokio::test]
    async fn rejecting_a_confirm_request_returns_user_cancelled_without_executing() {
        let device = FakeDevice::new(json!({"ok": true, "result": "never"}));
        let h = harness(confirm_script(), &["notes.write"], device.clone());
        drive(h.rt.clone(), TurnState::new(request())).await;
        let request_id = h.sink.last().confirm_request_id.unwrap();
        confirm::respond(&request_id, false).unwrap();
        h.sink.wait_for("done").await;
        assert!(device.executes().is_empty());
        let r = h.sink.find("tool_result").unwrap();
        assert_eq!(r.is_error, Some(true));
        assert!(r.text.unwrap().starts_with("Error (user_cancelled)"));
    }

    #[tokio::test]
    async fn remembered_skip_runs_without_asking() {
        let device = FakeDevice::new(json!({"ok": true, "result": "note-1"}));
        let mut skips = HashSet::new();
        skips.insert("ai.chat:notes.create".to_string());
        let h = harness_with(
            confirm_script(),
            &["notes.write"],
            device.clone(),
            skips,
            confirm::ConfirmPolicy::default(),
        );
        drive(h.rt.clone(), TurnState::new(request())).await;
        assert!(h.sink.find("confirm_request").is_none());
        assert!(device.previews().is_empty());
        assert_eq!(device.executes()[0]["confirmed"], false);
        assert_eq!(h.sink.last().kind, "done");
    }

    #[tokio::test]
    async fn device_can_say_no_confirmation_is_needed_for_these_params() {
        let device = FakeDevice::with_preview(
            json!({"ok": true, "result": "note-1"}),
            json!({"needsConfirmation": false}),
        );
        let h = harness(confirm_script(), &["notes.write"], device.clone());
        drive(h.rt.clone(), TurnState::new(request())).await;
        assert!(h.sink.find("confirm_request").is_none());
        assert_eq!(device.previews().len(), 1);
        assert_eq!(device.executes().len(), 1);
    }

    #[tokio::test]
    async fn unattended_heartbeat_rejects_confirm_required_tools_without_asking() {
        let device = FakeDevice::new(json!({"ok": true, "result": "never"}));
        let h = harness(confirm_script(), &["notes.write"], device.clone());
        let mut req = request();
        req.principal = "ai.heartbeat".into();
        drive(h.rt.clone(), TurnState::new(req)).await;
        assert!(device.previews().is_empty());
        assert!(device.executes().is_empty());
        let r = h.sink.find("tool_result").unwrap();
        assert!(r.text.unwrap().contains("Unattended HEARTBEAT"));
        assert_eq!(h.sink.last().kind, "done");
    }

    #[tokio::test]
    async fn cross_account_execution_is_always_confirmed_even_when_remembered() {
        let provider = ScriptedProvider::new(vec![
            vec![tool_use(
                "tu1",
                "notes_create",
                json!({"text": "hi", "accountId": "acc-other"}),
            )],
            vec![delta("ok")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "x"}));
        let mut skips = HashSet::new();
        skips.insert("ai.chat:notes.create".to_string());
        let h = harness_with(
            provider,
            &["notes.write", "account.actAs"],
            device.clone(),
            skips,
            confirm::ConfirmPolicy::default(),
        );
        let mut req = request();
        req.account_id = Some("acc-self".into());
        drive(h.rt.clone(), TurnState::new(req)).await;
        let request = h.sink.last();
        assert_eq!(request.kind, "confirm_request");
        assert_eq!(device.previews()[0]["crossAccount"], true);
        // クロスアカウントには「次から確認しない」を出さない
        assert_eq!(request.confirm_items.unwrap()[0]["allowRemember"], false);
    }

    #[tokio::test]
    async fn several_confirm_required_calls_in_one_round_are_bundled_into_one_request() {
        let provider = ScriptedProvider::new(vec![
            vec![
                tool_use("tu1", "notes_create", json!({"text": "a"})),
                tool_use("tu2", "time_now", json!({})),
                tool_use("tu3", "notes_create", json!({"text": "b"})),
            ],
            vec![delta("ok")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "x"}));
        let h = harness(provider, &["notes.write"], device.clone());
        drive(h.rt.clone(), TurnState::new(request())).await;
        let request = h.sink.last();
        let items = request.confirm_items.clone().unwrap();
        assert_eq!(items.as_array().unwrap().len(), 2);
        assert_eq!(items[0]["toolUseId"], "tu1");
        assert_eq!(items[1]["toolUseId"], "tu3");
        confirm::respond(&request.confirm_request_id.unwrap(), true).unwrap();
        h.sink.wait_for("done").await;
        let calls = device.executes();
        assert_eq!(calls.len(), 3);
        assert_eq!(calls[0]["confirmed"], true);
        assert_eq!(calls[1]["confirmed"], false);
        assert_eq!(calls[2]["confirmed"], true);
    }

    #[tokio::test]
    async fn absolute_ttl_expires_the_request_and_rejects_with_reason() {
        let device = FakeDevice::new(json!({"ok": true, "result": "never"}));
        let h = harness_with(
            confirm_script(),
            &["notes.write"],
            device.clone(),
            HashSet::new(),
            confirm::ConfirmPolicy {
                absolute_ttl: Duration::from_millis(30),
                display_ttl: Duration::from_secs(60),
            },
        );
        drive(h.rt.clone(), TurnState::new(request())).await;
        let request_id = h.sink.last().confirm_request_id.unwrap();
        h.sink.wait_for("done").await;
        assert_eq!(
            h.sink.find("confirm_closed").unwrap().reason.as_deref(),
            Some(confirm::REASON_EXPIRED_ABSOLUTE)
        );
        let r = h.sink.find("tool_result").unwrap();
        assert!(r
            .text
            .unwrap()
            .starts_with("Error (confirm_expired_absolute)"));
        assert!(device.executes().is_empty());
        assert!(confirm::respond(&request_id, true).is_err());
    }

    #[tokio::test]
    async fn display_ttl_starts_when_the_device_reports_shown() {
        let device = FakeDevice::new(json!({"ok": true, "result": "never"}));
        let h = harness_with(
            confirm_script(),
            &["notes.write"],
            device.clone(),
            HashSet::new(),
            confirm::ConfirmPolicy {
                absolute_ttl: Duration::from_secs(60),
                display_ttl: Duration::from_millis(30),
            },
        );
        drive(h.rt.clone(), TurnState::new(request())).await;
        let request_id = h.sink.last().confirm_request_id.unwrap();
        // 表示前は表示 TTL が走らない
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(h.sink.find("confirm_closed").is_none());
        confirm::shown(&request_id).unwrap();
        h.sink.wait_for("done").await;
        assert_eq!(
            h.sink.find("confirm_closed").unwrap().reason.as_deref(),
            Some(confirm::REASON_EXPIRED_DISPLAY)
        );
        assert!(confirm::shown(&request_id).is_err());
    }

    #[tokio::test]
    async fn cancelling_the_turn_closes_the_pending_request_and_the_checkpoint() {
        let device = FakeDevice::new(json!({"ok": true, "result": "never"}));
        let h = harness(confirm_script(), &["notes.write"], device.clone());
        let req = request();
        drive(h.rt.clone(), TurnState::new(req.clone())).await;
        let request_id = h.sink.last().confirm_request_id.unwrap();
        cancel_turn(&req.turn_id);
        assert_eq!(
            h.sink.last().reason.as_deref(),
            Some(confirm::REASON_CANCELLED)
        );
        assert!(confirm::respond(&request_id, true).is_err());
        let err = checkpoint::read(&h.rt.store_dir, &req.turn_id)
            .unwrap_err()
            .to_string();
        assert!(err.contains("cancelled"), "{err}");
        assert!(device.executes().is_empty());
    }

    #[test]
    fn result_text_mirrors_dispatch_result_shapes() {
        assert_eq!(
            result_text(Ok(json!({"ok": true, "result": {"a": 1}}))),
            ("{\"a\":1}".to_string(), false)
        );
        assert_eq!(
            result_text(Ok(
                json!({"ok": false, "code": "user_cancelled", "error": "拒否"})
            )),
            ("Error (user_cancelled): 拒否".to_string(), true)
        );
        assert_eq!(
            result_text(Ok(json!({"error": "boom"}))),
            ("Error (execute_failed): boom".to_string(), true)
        );
        assert!(result_text(Err("Query timed out".into()))
            .0
            .starts_with("Error (device_unavailable)"));
    }

    #[test]
    fn clean_title_matches_js_rules() {
        assert_eq!(clean_title("  「タイトル」。\n"), "タイトル");
        assert_eq!(clean_title("a\r\nb"), "a b");
        assert_eq!(
            clean_title(&"あ".repeat(50)).chars().count(),
            TITLE_MAX_CHARS
        );
    }

    #[tokio::test]
    async fn start_turn_rejects_non_ai_principals() {
        let dir = tempfile::tempdir().unwrap();
        let device = FakeDevice::new(Value::Null);
        let sink = Arc::new(RecordingSink::default());
        let mut req = request();
        req.principal = "external".into();
        let err = start_turn(req, dir.path(), device, sink).await.unwrap_err();
        assert!(err.to_string().contains("principal"));
    }
}
