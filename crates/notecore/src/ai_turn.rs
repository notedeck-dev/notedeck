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
//! やらないこと (後続の縦切り): capability 本体の実行 (全件をデバイスへの
//! 実行要求にする)、確認要求の発行 (デバイス側の dispatcher が今の確認 UI を
//! 出す)、セッションの書込 (デバイスがイベントを store に投影する)。
//!
//! provider とデバイスは trait で受けるので、WebView なしのハーネス (偽 provider
//! + 偽デバイス) で同じループが走る (テスト参照)。

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
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

/// デバイスへの実行要求の待ち時間。この段階では確認ダイアログの待ちも
/// デバイス側に含まれるので長めに取る (確認要求の notecore 発は次の縦切り)。
const DEVICE_EXECUTE_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// デバイスへの実行要求の query 種別 (JS 側 apiBridge のハンドラ名)。
pub const EXECUTE_QUERY_TYPE: &str = "ai/execute-capability";

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
    /// `"delta" | "tool_use" | "tool_result" | "done" | "error" | "title"`
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
        }
    }
}

/// ターンのイベントの届け先。Tauri 側は `nd:ai-turn-event` へ emit する実装を渡す。
pub trait AiTurnSink: Send + Sync + 'static {
    fn emit(&self, event: AiTurnEvent);
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// 1 ラウンドの provider 呼び出し。実体は Vault 接続 + SSE、テストは台本。
pub trait ProviderRound: Send + Sync {
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
pub trait GrantedSource: Send + Sync {
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
) -> std::result::Result<&'a str, String> {
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
    Ok(&tool.capability_id)
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

/// ターン本体。イベントは sink へ、tool の実行はデバイス (橋) へ。
pub async fn run_turn(
    req: AiTurnRequest,
    provider: &dyn ProviderRound,
    granted_source: &dyn GrantedSource,
    bridge: &dyn FrontendBridge,
    sink: Arc<dyn AiTurnSink>,
) {
    let turn_id = req.turn_id.clone();
    let emit = |e: AiTurnEvent| sink.emit(e);

    let (tools, index) = build_tools(&req, provider.protocol(), &granted_source.granted().await);
    let max_rounds = req.max_tool_rounds.unwrap_or(DEFAULT_MAX_TOOL_ROUNDS);
    let mut messages = req.messages.clone();
    let mut rounds: u32 = 0;
    let mut final_text = String::new();
    let mut tool_executed = req.continuation;

    let stop_reason = loop {
        let round_req = round_request(&req, rounds, &messages, &tools);
        let round_sink = RoundSink::new(&turn_id, sink.clone());
        if let Err(message) = provider.run(&round_req, &round_sink).await {
            let mut e = AiTurnEvent::new(&turn_id, "error");
            e.error = Some(message);
            e.phase = Some(
                if tool_executed {
                    "after_tool"
                } else {
                    "before_tool"
                }
                .into(),
            );
            emit(e);
            return;
        }
        let (text, tool_uses) = round_sink.take();
        if !text.is_empty() {
            final_text = text.clone();
        }
        if tool_uses.is_empty() {
            break "end";
        }
        if rounds >= max_rounds {
            final_text = format!(
                "{}\n\n⚠️ tool 呼び出しが上限 ({max_rounds} 回) に達しました。",
                if text.is_empty() { &final_text } else { &text }
            );
            break "tool_round_limit";
        }
        rounds += 1;

        // tool 呼び出しごとに granted を引き直す (権限ファイルの外部編集を反映)
        let granted = granted_source.granted().await;
        for (i, tu) in tool_uses.into_iter().enumerate() {
            let assistant_text = if i == 0 { text.clone() } else { String::new() };
            let mut e = AiTurnEvent::new(&turn_id, "tool_use");
            e.text = Some(assistant_text.clone());
            e.tool_use_id = Some(tu.id.clone());
            e.tool_use_name = Some(tu.name.clone());
            e.tool_use_input = Some(tu.input.clone());
            emit(e);

            let (result, is_error) = match authorize(&tu.name, &index, &granted) {
                Err(text) => (text, true),
                Ok(capability_id) => {
                    tool_executed = true;
                    let outcome = bridge
                        .query(
                            EXECUTE_QUERY_TYPE,
                            json!({
                                "turnId": turn_id,
                                "principal": req.principal,
                                "accountId": req.account_id,
                                "capabilityId": capability_id,
                                "params": tu.input,
                            }),
                            DEVICE_EXECUTE_TIMEOUT,
                        )
                        .await;
                    result_text(outcome)
                }
            };
            let mut e = AiTurnEvent::new(&turn_id, "tool_result");
            e.tool_use_id = Some(tu.id.clone());
            e.text = Some(result.clone());
            e.is_error = Some(is_error);
            emit(e);

            messages.push(AiChatMessage {
                role: AiChatRole::Assistant,
                content: assistant_text,
                tool_use_id: Some(tu.id.clone()),
                tool_use_name: Some(tu.name),
                tool_use_input: Some(tu.input),
                tool_result_for: None,
            });
            messages.push(AiChatMessage {
                role: AiChatRole::User,
                content: result,
                tool_use_id: None,
                tool_use_name: None,
                tool_use_input: None,
                tool_result_for: Some(tu.id),
            });
        }
    };

    let mut e = AiTurnEvent::new(&turn_id, "done");
    e.text = Some(final_text.clone());
    e.stop_reason = Some(stop_reason.into());
    emit(e);

    if req.generate_title && !final_text.is_empty() {
        if let Some(title) = generate_title(&req, provider, &final_text).await {
            let mut e = AiTurnEvent::new(&turn_id, "title");
            e.text = Some(title);
            emit(e);
        }
    }
}

// --- 台帳 (中断用) ---

fn active_turns() -> &'static Mutex<HashMap<String, JoinHandle<()>>> {
    static TURNS: OnceLock<Mutex<HashMap<String, JoinHandle<()>>>> = OnceLock::new();
    TURNS.get_or_init(|| Mutex::new(HashMap::new()))
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

    let turn_id = req.turn_id.clone();
    let turn_id_for_task = turn_id.clone();
    let handle = tokio::spawn(async move {
        run_turn(
            req,
            &VaultProvider(conn),
            &FileGranted(principal),
            bridge.as_ref(),
            sink,
        )
        .await;
        if let Ok(mut turns) = active_turns().lock() {
            turns.remove(&turn_id_for_task);
        }
    });
    if let Ok(mut turns) = active_turns().lock() {
        if let Some(prev) = turns.insert(turn_id, handle) {
            prev.abort();
        }
    }
    Ok(())
}

/// 進行中のターンを中断する。冪等。イベントは出さない (中断した側が知っている)。
/// デバイスへ出した実行要求は応答待ちごと捨てる。
pub fn cancel_turn(turn_id: &str) {
    let handle = active_turns()
        .lock()
        .ok()
        .and_then(|mut t| t.remove(turn_id));
    if let Some(h) = handle {
        h.abort();
    }
}

/// 終了処理: 進行中の全ターンを中断する。
pub fn abort_all_turns() {
    let handles: Vec<JoinHandle<()>> = active_turns()
        .lock()
        .map(|mut t| t.drain().map(|(_, h)| h).collect())
        .unwrap_or_default();
    for h in handles {
        h.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frontend_bridge::BridgeFuture;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// 台本どおりに delta / tool_use を流す偽 provider。
    struct ScriptedProvider {
        rounds: Mutex<Vec<Vec<AiChatEvent>>>,
        requests: Mutex<Vec<AiChatRequest>>,
        fail_at: Option<usize>,
    }

    impl ScriptedProvider {
        fn new(rounds: Vec<Vec<AiChatEvent>>) -> Self {
            Self {
                rounds: Mutex::new(rounds),
                requests: Mutex::new(Vec::new()),
                fail_at: None,
            }
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

    /// 実行要求を記録して固定の結果を返す偽デバイス。
    struct FakeDevice {
        calls: Mutex<Vec<Value>>,
        reply: Value,
    }

    impl FrontendBridge for FakeDevice {
        fn query<'a>(
            &'a self,
            query_type: &'a str,
            params: Value,
            _t: Duration,
        ) -> BridgeFuture<'a> {
            assert_eq!(query_type, EXECUTE_QUERY_TYPE);
            self.calls.lock().unwrap().push(params);
            let reply = self.reply.clone();
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

    fn request() -> AiTurnRequest {
        AiTurnRequest {
            turn_id: "t1".into(),
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

    fn kinds(sink: &RecordingSink) -> Vec<String> {
        sink.0
            .lock()
            .unwrap()
            .iter()
            .map(|e| e.kind.clone())
            .collect()
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
        let device = FakeDevice {
            calls: Mutex::new(Vec::new()),
            reply: json!({"ok": true, "result": "pong"}),
        };
        let sink = Arc::new(RecordingSink::default());
        run_turn(
            request(),
            &provider,
            &granted(&["account.read"]),
            &device,
            sink.clone(),
        )
        .await;

        assert_eq!(
            kinds(&sink),
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
        let calls = device.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["capabilityId"], "time.now");
        assert_eq!(calls[0]["principal"], "ai.chat");
        assert_eq!(calls[0]["turnId"], "t1");
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
        let done = sink.0.lock().unwrap().last().unwrap().clone();
        assert_eq!(done.text.as_deref(), Some("12 時です"));
        assert_eq!(done.stop_reason.as_deref(), Some("end"));
    }

    #[tokio::test]
    async fn tools_are_filtered_by_granted_and_denied_calls_never_reach_the_device() {
        let provider = ScriptedProvider::new(vec![
            vec![tool_use("tu1", "notes_create", json!({"text": "hi"}))],
            vec![delta("done")],
        ]);
        let device = FakeDevice {
            calls: Mutex::new(Vec::new()),
            reply: json!({"ok": true, "result": "never"}),
        };
        let sink = Arc::new(RecordingSink::default());
        // notes.write を持たない principal
        run_turn(
            request(),
            &provider,
            &granted(&["notes.read"]),
            &device,
            sink.clone(),
        )
        .await;

        assert!(device.calls.lock().unwrap().is_empty());
        let events = sink.0.lock().unwrap();
        let result = events.iter().find(|e| e.kind == "tool_result").unwrap();
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
        let device = FakeDevice {
            calls: Mutex::new(Vec::new()),
            reply: json!({"ok": true, "result": "x"}),
        };
        let sink = Arc::new(RecordingSink::default());
        let mut req = request();
        req.max_tool_rounds = Some(1);
        run_turn(req, &provider, &granted(&[]), &device, sink.clone()).await;

        assert_eq!(device.calls.lock().unwrap().len(), 1);
        let done = sink.0.lock().unwrap().last().unwrap().clone();
        assert_eq!(done.stop_reason.as_deref(), Some("tool_round_limit"));
        assert!(done.text.unwrap().contains("上限 (1 回)"));
    }

    #[tokio::test]
    async fn error_phase_tells_whether_a_tool_already_ran() {
        // ラウンド 1 で失敗 → before_tool (再送で安全)
        let mut provider = ScriptedProvider::new(vec![]);
        provider.fail_at = Some(0);
        let device = FakeDevice {
            calls: Mutex::new(Vec::new()),
            reply: json!({"ok": true, "result": "x"}),
        };
        let sink = Arc::new(RecordingSink::default());
        run_turn(request(), &provider, &granted(&[]), &device, sink.clone()).await;
        let e = sink.0.lock().unwrap().last().unwrap().clone();
        assert_eq!(e.kind, "error");
        assert_eq!(e.phase.as_deref(), Some("before_tool"));

        // ラウンド 2 で失敗 → after_tool (継続モードで再試行)
        let mut provider =
            ScriptedProvider::new(vec![vec![tool_use("tu1", "time_now", json!({}))]]);
        provider.fail_at = Some(1);
        let sink = Arc::new(RecordingSink::default());
        run_turn(request(), &provider, &granted(&[]), &device, sink.clone()).await;
        let e = sink.0.lock().unwrap().last().unwrap().clone();
        assert_eq!(e.phase.as_deref(), Some("after_tool"));

        // 継続モードは最初から after_tool 扱いで、system に通知が付く
        let mut provider = ScriptedProvider::new(vec![]);
        provider.fail_at = Some(0);
        let sink = Arc::new(RecordingSink::default());
        let mut req = request();
        req.continuation = true;
        req.system = Some("base".into());
        run_turn(req, &provider, &granted(&[]), &device, sink.clone()).await;
        let e = sink.0.lock().unwrap().last().unwrap().clone();
        assert_eq!(e.phase.as_deref(), Some("after_tool"));
        let reqs = provider.requests.lock().unwrap();
        assert_eq!(
            reqs[0].system.as_deref(),
            Some(format!("base\n\n{CONTINUATION_NOTICE}").as_str())
        );
    }

    #[tokio::test]
    async fn device_tools_and_runtime_enums_are_merged_into_the_tool_list() {
        let provider = ScriptedProvider::new(vec![vec![delta("ok")]]);
        let device = FakeDevice {
            calls: Mutex::new(Vec::new()),
            reply: Value::Null,
        };
        let sink = Arc::new(RecordingSink::default());
        let mut req = request();
        req.device_tools = vec![
            DeviceTool {
                id: "plugin.hello".into(),
                description: "plugin tool".into(),
                params: json!({"name": {"type": "string", "description": "n"}}),
                permissions: vec![],
            },
            DeviceTool {
                // 宣言表にある id はデバイス側の申告で上書きできない
                id: "time.now".into(),
                description: "spoof".into(),
                params: json!({}),
                permissions: vec![],
            },
        ];
        req.tool_param_enums = Some(json!({"column.add": {"type": ["timeline", "notifications"]}}));
        run_turn(
            req,
            &provider,
            &granted(&["deck.write", "deck.read"]),
            &device,
            sink,
        )
        .await;

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
        let device = FakeDevice {
            calls: Mutex::new(Vec::new()),
            reply: Value::Null,
        };
        let sink = Arc::new(RecordingSink::default());
        let mut req = request();
        req.generate_title = true;
        run_turn(req, &provider, &granted(&[]), &device, sink.clone()).await;
        assert_eq!(kinds(&sink), ["delta", "done", "title"]);
        let title = sink.0.lock().unwrap().last().unwrap().clone();
        assert_eq!(title.text.as_deref(), Some("現在時刻の確認"));
        let reqs = provider.requests.lock().unwrap();
        assert!(reqs[1].messages[0].content.contains("いま何時?"));
        assert!(reqs[1].tools.is_none());
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
        let device = Arc::new(FakeDevice {
            calls: Mutex::new(Vec::new()),
            reply: Value::Null,
        });
        let sink = Arc::new(RecordingSink::default());
        let mut req = request();
        req.principal = "external".into();
        let err = start_turn(req, dir.path(), device, sink).await.unwrap_err();
        assert!(err.to_string().contains("principal"));
        let _ = AtomicUsize::new(0).load(Ordering::Relaxed);
    }
}
