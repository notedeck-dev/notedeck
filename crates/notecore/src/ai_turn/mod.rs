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
//! - セッションの書込 (縦切り 3、`ai_sessions`): ユーザー入力 / tool_use /
//!   tool_result / 最終応答 / 失敗 / 中断の partial を notecore が書く。デバイスは
//!   イベントの `message_id` で自分の写しを揃える
//! - 汚染の記録 (縦切り 3、`taint.rs`): `untrusted` な capability の結果や
//!   デバイスが申告した文脈を読んだセッションは tainted になり、書き込みは
//!   「次から確認しない」を無視して確認する
//!
//! やらないこと (後続の縦切り): capability 本体の実行 (全件をデバイスへの
//! 実行要求にする)、確認内容の組み立て (デバイスの capability 実装)。
//!
//! provider とデバイスは trait で受けるので、WebView なしのハーネス (偽 provider
//! + 偽デバイス) で同じループが走る (テスト参照)。

pub mod checkpoint;
pub mod confirm;
pub mod taint;

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
use crate::ai_sessions::{self, SessionMessage};
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
    /// 結果に他人の内容を含みうるか (デバイス側の申告。宣言表の `untrusted` と同じ意味)
    #[serde(default)]
    pub untrusted: bool,
    /// 書き込みの宛先になる引数 (宣言表の `destinations` と同じ意味)
    #[serde(default)]
    pub destinations: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, Type, Default)]
pub struct AiTurnRequest {
    pub turn_id: String,
    /// 書込先のセッション。None = 永続化しない (HEARTBEAT の使い捨て履歴)
    pub session_id: Option<String>,
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
    /// デバイスが組んだ文脈に他人の内容 (可視ノートなど) が含まれる。
    /// true ならこのセッションはこのターンから tainted
    #[serde(default)]
    pub context_untrusted: bool,
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
    /// tool_use / tool_result / done / error: notecore がセッションに書いた
    /// メッセージの id (デバイスは写しの id をこれに揃える)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
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
            message_id: None,
        }
    }
}

/// セッションのメッセージ id は turn id から決定的に振る。デバイスはユーザー
/// 入力の id (`<turn>-u`) を同じ規則で先に作って表示する。
pub fn user_message_id(turn_id: &str) -> String {
    format!("{turn_id}-u")
}
fn assistant_message_id(turn_id: &str, rounds: u32) -> String {
    format!("{turn_id}-a{rounds}")
}
fn tool_use_message_id(turn_id: &str, rounds: u32, i: usize) -> String {
    format!("{turn_id}-a{rounds}-{i}")
}
fn tool_result_message_id(turn_id: &str, rounds: u32, i: usize) -> String {
    format!("{turn_id}-r{rounds}-{i}")
}

/// セッションの書き手 (本番はファイル、テストはメモリ)。
pub trait SessionSink: Send + Sync + 'static {
    fn append(&self, session_id: &str, messages: Vec<SessionMessage>) -> Result<()>;
}

/// `notedeck/sessions/` に書く本番実装。
pub struct FileSessions(pub PathBuf);

impl SessionSink for FileSessions {
    fn append(&self, session_id: &str, messages: Vec<SessionMessage>) -> Result<()> {
        ai_sessions::append(&self.0, session_id, messages).map(|_| ())
    }
}

fn session_message(id: String, role: &str, content: String) -> SessionMessage {
    SessionMessage {
        id,
        role: role.into(),
        content,
        timestamp: ai_sessions::now_ms(),
        ..Default::default()
    }
}

/// セッションへ書く (書込先が無ければ何もしない)。失敗は warn (ターンは止めない)。
fn persist(rt: &TurnRuntime, session_id: Option<&str>, messages: Vec<SessionMessage>) {
    let Some(sid) = session_id else { return };
    if let Err(e) = rt.sessions.append(sid, messages) {
        tracing::warn!(session_id = sid, "ai session write failed: {e}");
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

/// `exec: core` な capability を notecore で実行する口。ローカル構成では
/// Tauri 側が managed state の Core を引いて `capabilities::exec::execute` を呼ぶ
/// 実装を渡し、notecored は Core を直接持つ実装を渡す。
pub trait CoreExecutor: Send + Sync + 'static {
    fn execute<'a>(
        &'a self,
        id: &'a str,
        params: Value,
        ctx: capabilities::exec::ExecContext,
    ) -> BoxFuture<'a, std::result::Result<capabilities::exec::ExecOutcome, String>>;
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
    /// 中断時に partial を書けるよう、本文は台帳と共有する
    live: Arc<Mutex<LiveText>>,
    tool_uses: Mutex<Vec<ToolUse>>,
}

/// 進行中ラウンドの本文 (中断で partial をセッションに書くために台帳が見る)。
#[derive(Default)]
struct LiveText {
    text: String,
    /// この本文が属する assistant メッセージの id
    message_id: String,
    session_id: Option<String>,
}

impl RoundSink {
    fn new(turn_id: &str, sink: Arc<dyn AiTurnSink>, live: Arc<Mutex<LiveText>>) -> Self {
        Self {
            turn_id: turn_id.to_string(),
            sink,
            live,
            tool_uses: Mutex::new(Vec::new()),
        }
    }
    fn take(self) -> (String, Vec<ToolUse>) {
        let text = self.live.lock().map(|l| l.text.clone()).unwrap_or_default();
        (text, self.tool_uses.into_inner().unwrap_or_default())
    }
}

impl AiChatSink for RoundSink {
    fn emit(&self, event: AiChatEvent) {
        match event.kind.as_str() {
            "delta" => {
                let Some(text) = event.text else { return };
                if let Ok(mut live) = self.live.lock() {
                    live.text.push_str(&text);
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
    /// 結果に他人の内容を含みうる (読んだセッションを tainted にする)
    untrusted: bool,
    /// 書き込みの宛先になる引数
    destinations: Vec<String>,
    /// notecore 単独で実行できる (宣言表の `exec: core`)
    core: bool,
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
                untrusted: d.untrusted,
                destinations: d.destinations.iter().map(|x| x.to_string()).collect(),
                core: d.exec == capabilities::Exec::Core,
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
                untrusted: t.untrusted,
                destinations: t.destinations.clone(),
                core: false,
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
    /// 結果を読むとセッションが tainted になる
    #[serde(default)]
    pub untrusted: bool,
    /// 宛先の値が untrusted な本文 (他人の内容) の中に出現した (#1103)。
    /// 確認に一文添え、記憶の対象外、無人実行では拒否
    #[serde(default)]
    pub destination_untrusted: bool,
    /// notecore で実行する (デバイスに投げない)
    #[serde(default)]
    pub core: bool,
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
    pub sessions: Arc<dyn SessionSink>,
    pub taint: Arc<dyn taint::TaintStore>,
    /// `exec: core` の本体。None なら core の capability もデバイスに投げる
    /// (ハーネスの既定)
    pub core: Option<Arc<dyn CoreExecutor>>,
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

/// 宛先の出所 (#1103): 値がどこに出てきたか。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Origin {
    /// ユーザーの入力に出てくる
    User,
    /// 構造化された信頼済み結果 (untrusted でない capability の結果) に出てくる
    Trusted,
    /// untrusted な本文 (他人の内容) の中にだけ出てくる。どこにも無い値も
    /// (モデルが作った可能性があるので) ここに倒す
    Untrusted,
}

/// 出所判定のために履歴を 3 つの本文集合に分ける。
struct ProvenanceCorpus {
    user: Vec<String>,
    trusted: Vec<String>,
    untrusted: Vec<String>,
}

impl ProvenanceCorpus {
    fn build(
        req: &AiTurnRequest,
        messages: &[AiChatMessage],
        index: &HashMap<String, ResolvedTool>,
    ) -> Self {
        let mut c = Self {
            user: Vec::new(),
            trusted: Vec::new(),
            untrusted: Vec::new(),
        };
        if let Some(system) = req.system.as_deref() {
            if req.context_untrusted {
                c.untrusted.push(system.to_string());
            } else {
                c.trusted.push(system.to_string());
            }
        }
        // tool_use id → その tool が untrusted か
        let mut untrusted_by_use: HashMap<&str, bool> = HashMap::new();
        for m in messages {
            if let (Some(id), Some(name)) = (m.tool_use_id.as_deref(), m.tool_use_name.as_deref()) {
                let untrusted = index
                    .get(name)
                    .map(|t| t.untrusted)
                    .or_else(|| {
                        capabilities::find(&capabilities::id_from_tool_name(name))
                            .map(|d| d.untrusted)
                    })
                    .unwrap_or(true);
                untrusted_by_use.insert(id, untrusted);
            }
        }
        for m in messages {
            if let Some(for_id) = m.tool_result_for.as_deref() {
                if untrusted_by_use.get(for_id).copied().unwrap_or(true) {
                    c.untrusted.push(m.content.clone());
                } else {
                    c.trusted.push(m.content.clone());
                }
            } else if matches!(m.role, AiChatRole::User) {
                c.user.push(m.content.clone());
            }
        }
        c
    }

    fn origin_of(&self, value: &str) -> Origin {
        if self.user.iter().any(|t| t.contains(value)) {
            Origin::User
        } else if self.trusted.iter().any(|t| t.contains(value)) {
            Origin::Trusted
        } else {
            Origin::Untrusted
        }
    }
}

/// 宛先の引数の値 (文字列 / 文字列の配列) を集める。空は無視。
fn destination_values(input: &Value, params: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for name in params {
        match input.get(name) {
            Some(Value::String(s)) if !s.is_empty() => out.push(s.clone()),
            Some(Value::Array(a)) => {
                for v in a {
                    if let Some(s) = v.as_str().filter(|s| !s.is_empty()) {
                        out.push(s.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// ラウンドの tool 呼び出しを認可し、確認の要否を決める。
async fn prepare_pending(
    rt: &TurnRuntime,
    state: &TurnState,
    index: &HashMap<String, ResolvedTool>,
    tool_uses: Vec<ToolUse>,
) -> Vec<PendingToolUse> {
    let req = &state.req;
    let corpus = ProvenanceCorpus::build(req, &state.messages, index);
    let granted = rt.granted.granted().await;
    let unattended = req.principal == "ai.heartbeat";
    // tainted なセッション (#1103): 「次から確認しない」を無視して必ず確認する
    let tainted = match req.session_id.as_deref() {
        Some(sid) => rt.taint.is_tainted(sid).await,
        None => false,
    };
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
            untrusted: false,
            destination_untrusted: false,
            core: false,
        };
        match authorize(&p.name, index, &granted) {
            Err(text) => p.deny = Some(text),
            Ok(tool) => {
                p.capability_id = Some(tool.capability_id.clone());
                p.untrusted = tool.untrusted;
                p.core = tool.core;
                let cross = is_cross_account(tool, &p.input, req.account_id.as_deref());
                // 宛先の出所 (#1103): 他人の本文の中にだけ出てきた宛先は、記憶を
                // 無視して確認し、無人実行では聞かずに拒否する
                p.destination_untrusted = destination_values(&p.input, &tool.destinations)
                    .iter()
                    .any(|v| corpus.origin_of(v) == Origin::Untrusted);
                let mut needs = tool.confirm || cross || p.destination_untrusted;
                if needs && !cross && !tainted && !p.destination_untrusted && !unattended {
                    // 「次から確認しない」(権限ファイルへの減算) を尊重する。
                    // 記憶はチャットの範囲だけ (#714)。無人の HEARTBEAT には波及
                    // させない (デバイスの dispatcher と同じ)
                    if rt.skips.skipped(CHAT_SKIP_SCOPE, &tool.capability_id).await {
                        needs = false;
                    }
                }
                if p.destination_untrusted && unattended {
                    tracing::warn!(
                        capability = %tool.capability_id,
                        "unattended write rejected: destination came from untrusted content"
                    );
                    p.deny = Some(format!(
                        "Error (destination_untrusted): Unattended HEARTBEAT does not write to a destination that appeared only in untrusted content: {}",
                        tool.capability_id
                    ));
                } else if needs && unattended {
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
                    untrusted: false,
                    destinations: Vec::new(),
                    core: false,
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
                    "destinationUntrusted": p.destination_untrusted,
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
                    && !cross
                    && !p.destination_untrusted,
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
            "destinationUntrusted": p.destination_untrusted,
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
        // ラウンド番号は本文 (assistant_message_id) と同じ 0 始まり
        let round = state.rounds.saturating_sub(1);
        let tool_use_msg_id = tool_use_message_id(&turn_id, round, i);
        let tool_result_msg_id = tool_result_message_id(&turn_id, round, i);
        let mut e = AiTurnEvent::new(&turn_id, "tool_use");
        e.text = Some(assistant_text.clone());
        e.tool_use_id = Some(tu.id.clone());
        e.tool_use_name = Some(tu.name.clone());
        e.tool_use_input = Some(tu.input.clone());
        e.message_id = Some(tool_use_msg_id.clone());
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
        } else if tu.core && rt.core.is_some() {
            // notecore 単独で実行できる capability はデバイスに投げない
            state.tool_executed = true;
            let executor = rt.core.as_ref().expect("checked");
            let session_tainted = match state.req.session_id.as_deref() {
                Some(sid) => rt.taint.is_tainted(sid).await,
                None => false,
            };
            let ctx = capabilities::exec::ExecContext {
                principal: state.req.principal.clone(),
                account_id: state.req.account_id.clone(),
                tainted: session_tainted,
            };
            match executor
                .execute(
                    tu.capability_id.as_deref().unwrap_or(&tu.name),
                    tu.input.clone(),
                    ctx,
                )
                .await
            {
                Ok(outcome) => {
                    // ラベル付きの内容を返した (tainted なメモ / skill) → セッションを汚染
                    if outcome.tainted {
                        if let Some(sid) = state.req.session_id.as_deref() {
                            rt.taint
                                .mark(sid, tu.capability_id.as_deref().unwrap_or(&tu.name))
                                .await;
                        }
                    }
                    match outcome.value {
                        Value::String(s) => (s, false),
                        v => (v.to_string(), false),
                    }
                }
                Err(e) => (format!("Error (execute_failed): {e}"), true),
            }
        } else {
            state.tool_executed = true;
            let session_tainted = match state.req.session_id.as_deref() {
                Some(sid) => rt.taint.is_tainted(sid).await,
                None => false,
            };
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
                        // tainted なセッションからの書込 (メモ / skill にラベルを付ける)
                        "tainted": session_tainted,
                    }),
                    DEVICE_EXECUTE_TIMEOUT,
                )
                .await;
            // デバイス側の capability が「ラベル付きの内容を返した」と申告したら汚染
            if let Ok(v) = &outcome {
                if v.get("tainted").and_then(Value::as_bool) == Some(true) {
                    if let Some(sid) = state.req.session_id.as_deref() {
                        rt.taint
                            .mark(sid, tu.capability_id.as_deref().unwrap_or(&tu.name))
                            .await;
                    }
                }
            }
            result_text(outcome)
        };
        if !is_error && tu.untrusted {
            // 他人の内容を読んだ: 以後このセッションは tainted (ターンで消えない)
            if let Some(sid) = state.req.session_id.as_deref() {
                rt.taint
                    .mark(sid, tu.capability_id.as_deref().unwrap_or(&tu.name))
                    .await;
            }
        }
        let mut e = AiTurnEvent::new(&turn_id, "tool_result");
        e.tool_use_id = Some(tu.id.clone());
        e.text = Some(result.clone());
        e.is_error = Some(is_error);
        e.message_id = Some(tool_result_msg_id.clone());
        rt.sink.emit(e);

        persist(
            rt,
            state.req.session_id.as_deref(),
            vec![
                SessionMessage {
                    tool_use_id: Some(tu.id.clone()),
                    tool_use_name: Some(tu.name.clone()),
                    tool_use_input: Some(tu.input.clone()),
                    ..session_message(tool_use_msg_id, "assistant", assistant_text.clone())
                },
                SessionMessage {
                    tool_result_for: Some(tu.id.clone()),
                    ..session_message(tool_result_msg_id, "user", result.clone())
                },
            ],
        );

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
    let live = live_text_of(&turn_id);
    if state.req.context_untrusted {
        if let Some(sid) = state.req.session_id.as_deref() {
            rt.taint.mark(sid, "context").await;
        }
    }
    let (tools, index) = build_tools(
        &state.req,
        rt.provider.protocol(),
        &rt.granted.granted().await,
    );
    let max_rounds = state.req.max_tool_rounds.unwrap_or(DEFAULT_MAX_TOOL_ROUNDS);

    let stop_reason = loop {
        if state.pending.is_empty() {
            let round_req = round_request(&state.req, state.rounds, &state.messages, &tools);
            let message_id = assistant_message_id(&turn_id, state.rounds);
            if let Ok(mut l) = live.lock() {
                l.text.clear();
                l.message_id = message_id.clone();
                l.session_id = state.req.session_id.clone();
            }
            let round_sink = RoundSink::new(&turn_id, rt.sink.clone(), live.clone());
            if let Err(message) = rt.provider.run(&round_req, &round_sink).await {
                // mid-stream の切断: 途中までの応答は温存して ⚠️ を添える
                let partial = round_sink.take().0;
                let content = if partial.is_empty() {
                    format!("⚠️ {message}")
                } else {
                    format!("{partial}\n\n⚠️ {message}")
                };
                persist(
                    &rt,
                    state.req.session_id.as_deref(),
                    vec![session_message(message_id.clone(), "assistant", content)],
                );
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
                e.message_id = Some(message_id);
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
            state.pending = prepare_pending(&rt, &state, &index, tool_uses).await;

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

    let final_id = assistant_message_id(&turn_id, state.rounds);
    if !state.final_text.is_empty() {
        persist(
            &rt,
            state.req.session_id.as_deref(),
            vec![session_message(
                final_id.clone(),
                "assistant",
                state.final_text.clone(),
            )],
        );
    }
    let mut e = AiTurnEvent::new(&turn_id, "done");
    e.text = Some(state.final_text.clone());
    e.stop_reason = Some(stop_reason.into());
    e.message_id = Some(final_id);
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

struct ActiveTurn {
    handle: JoinHandle<()>,
    /// 進行中ラウンドの本文 (中断で partial を書くため)
    live: Arc<Mutex<LiveText>>,
    sessions: Arc<dyn SessionSink>,
}

fn active_turns() -> &'static Mutex<HashMap<String, ActiveTurn>> {
    static TURNS: OnceLock<Mutex<HashMap<String, ActiveTurn>>> = OnceLock::new();
    TURNS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 台帳に登録済みの live (再開でも同じものを使う)。未登録なら新規。
fn live_text_of(turn_id: &str) -> Arc<Mutex<LiveText>> {
    active_turns()
        .lock()
        .ok()
        .and_then(|t| t.get(turn_id).map(|a| a.live.clone()))
        .unwrap_or_default()
}

/// turn を background task で走らせ、台帳に登録する (開始と再開の両方)。
pub(crate) fn spawn_drive(rt: Arc<TurnRuntime>, state: TurnState) {
    let turn_id = state.req.turn_id.clone();
    let turn_id_for_task = turn_id.clone();
    let live = Arc::new(Mutex::new(LiveText::default()));
    let sessions = rt.sessions.clone();
    // drive は台帳から live を引くので、先に登録してから起動する
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        let _ = rx.await;
        drive(rt, state).await;
        if let Ok(mut turns) = active_turns().lock() {
            turns.remove(&turn_id_for_task);
        }
    });
    if let Ok(mut turns) = active_turns().lock() {
        if let Some(prev) = turns.insert(
            turn_id,
            ActiveTurn {
                handle,
                live,
                sessions,
            },
        ) {
            prev.handle.abort();
        }
    }
    let _ = tx.send(());
}

/// ターンを開始する。入力検証と接続解決はここで行い (エラーは呼び出し元へ)、
/// 本体は background task。以後のイベントは sink に流れる。
pub async fn start_turn(
    req: AiTurnRequest,
    app_dir: &Path,
    bridge: Arc<dyn FrontendBridge>,
    sink: Arc<dyn AiTurnSink>,
    core_executor: Arc<dyn CoreExecutor>,
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
        sessions: Arc::new(FileSessions(
            app_dir.join(crate::commands::settings::SETTINGS_DIR),
        )),
        taint: Arc::new(taint::FileTaint::new(app_dir)),
        core: Some(core_executor),
    });
    begin_turn(rt, req)
}

/// ユーザー入力をセッションに書いてから turn を起動する (書けなければ始めない)。
pub fn begin_turn(rt: Arc<TurnRuntime>, req: AiTurnRequest) -> Result<()> {
    if !req.continuation {
        if let (Some(sid), Some(text)) = (req.session_id.as_deref(), last_user_text(&req.messages))
        {
            rt.sessions.append(
                sid,
                vec![session_message(
                    user_message_id(&req.turn_id),
                    "user",
                    text.to_string(),
                )],
            )?;
        }
    }
    spawn_drive(rt, TurnState::new(req));
    Ok(())
}

/// 進行中のターンを中断する。冪等。イベントは出さない (中断した側が知っている)
/// が、確認待ちなら要求を cancelled で閉じる。デバイスへ出した実行要求は
/// 応答待ちごと捨てる。
pub fn cancel_turn(turn_id: &str) -> Option<SessionMessage> {
    let active = active_turns()
        .lock()
        .ok()
        .and_then(|mut t| t.remove(turn_id));
    confirm::cancel_for_turn(turn_id);
    let active = active?;
    active.handle.abort();
    // 途中までの応答は温存する (⚠️ は付けない)。空なら何も書かない
    let live = active.live.lock().ok()?;
    if live.text.is_empty() {
        return None;
    }
    let sid = live.session_id.clone()?;
    let msg = session_message(live.message_id.clone(), "assistant", live.text.clone());
    if let Err(e) = active.sessions.append(&sid, vec![msg.clone()]) {
        tracing::warn!(session_id = sid, "ai session write on cancel failed: {e}");
    }
    Some(msg)
}

/// 終了処理: 進行中の全ターンと確認待ちを中断する。
pub fn abort_all_turns() {
    let handles: Vec<JoinHandle<()>> = active_turns()
        .lock()
        .map(|mut t| t.drain().map(|(_, a)| a.handle).collect())
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

    /// メモリ上のセッション書き手 (append の記録)。
    #[derive(Default)]
    struct MemorySessions(Mutex<Vec<(String, SessionMessage)>>);

    impl SessionSink for MemorySessions {
        fn append(&self, session_id: &str, messages: Vec<SessionMessage>) -> Result<()> {
            let mut v = self.0.lock().unwrap();
            for m in messages {
                v.push((session_id.to_string(), m));
            }
            Ok(())
        }
    }

    impl MemorySessions {
        fn written(&self) -> Vec<SessionMessage> {
            self.0
                .lock()
                .unwrap()
                .iter()
                .map(|(_, m)| m.clone())
                .collect()
        }
    }

    /// core 実行を持たない偽 executor (start_turn の入力検証テスト用)
    struct NoCore;
    impl CoreExecutor for NoCore {
        fn execute<'a>(
            &'a self,
            _id: &'a str,
            _params: Value,
            _ctx: capabilities::exec::ExecContext,
        ) -> BoxFuture<'a, std::result::Result<capabilities::exec::ExecOutcome, String>> {
            Box::pin(async { Err("no core".into()) })
        }
    }

    /// 台本どおりに答える偽の core executor。
    struct ScriptedCore {
        calls: Mutex<Vec<(String, Value)>>,
        reply: Value,
    }
    impl CoreExecutor for ScriptedCore {
        fn execute<'a>(
            &'a self,
            id: &'a str,
            params: Value,
            _ctx: capabilities::exec::ExecContext,
        ) -> BoxFuture<'a, std::result::Result<capabilities::exec::ExecOutcome, String>> {
            self.calls.lock().unwrap().push((id.to_string(), params));
            let reply = self.reply.clone();
            Box::pin(async move {
                Ok(capabilities::exec::ExecOutcome {
                    value: reply,
                    tainted: false,
                })
            })
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
            session_id: Some("s1".into()),
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
        written: Arc<MemorySessions>,
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
        let written = Arc::new(MemorySessions::default());
        let rt = Arc::new(TurnRuntime {
            provider,
            granted: Arc::new(granted(keys)),
            skips: Arc::new(skips),
            bridge: device,
            sink: sink.clone(),
            store_dir: checkpoint::dir(dir.path()),
            policy,
            sessions: written.clone(),
            taint: Arc::new(taint::MemoryTaint::default()),
            core: None,
        });
        Harness {
            rt,
            sink,
            written,
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
                untrusted: false,
                destinations: vec![],
            },
            DeviceTool {
                // 宣言表にある id はデバイス側の申告で上書きできない
                id: "time.now".into(),
                description: "spoof".into(),
                params: json!({}),
                permissions: vec![],
                confirm: false,
                untrusted: false,
                destinations: vec![],
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
    async fn chat_confirm_skips_do_not_leak_into_unattended_heartbeat() {
        // チャットで「次から確認しない」を記憶していても、無人の HEARTBEAT では
        // 確認が要る操作として拒否する (dispatcher.test.ts の「ai.chat の remember は
        // ai.heartbeat に波及しない」と同じ)
        let device = FakeDevice::new(json!({"ok": true, "result": "never"}));
        let mut skips = HashSet::new();
        skips.insert("ai.chat:notes.create".to_string());
        let h = harness_with(
            confirm_script(),
            &["notes.write"],
            device.clone(),
            skips,
            confirm::ConfirmPolicy::default(),
        );
        let mut req = request();
        req.principal = "ai.heartbeat".into();
        drive(h.rt.clone(), TurnState::new(req)).await;
        assert!(device.executes().is_empty());
        let r = h.sink.find("tool_result").unwrap();
        assert!(r.text.unwrap().contains("Unattended HEARTBEAT"));
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

    // --- セッションの書込と taint (縦切り 3) ---

    fn sessions_of(h: &Harness) -> Vec<SessionMessage> {
        // TurnRuntime の sessions は trait object なので、テスト用にダウンキャストせず
        // MemorySessions を別に持たせる代わりにここで再構築する
        h.written.written()
    }

    #[tokio::test]
    async fn turn_writes_user_tool_rows_and_final_answer_to_the_session() {
        let provider = ScriptedProvider::new(vec![
            vec![delta("確認します"), tool_use("tu1", "time_now", json!({}))],
            vec![delta("12 時です")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "12:00"}));
        let h = harness(provider, &[], device);
        let req = request();
        begin_turn(h.rt.clone(), req.clone()).unwrap();
        h.sink.wait_for("done").await;
        let written = sessions_of(&h);
        let ids: Vec<&str> = written.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                format!("{}-u", req.turn_id),
                format!("{}-a0-0", req.turn_id),
                format!("{}-r0-0", req.turn_id),
                format!("{}-a1", req.turn_id),
            ]
        );
        assert_eq!(written[0].role, "user");
        assert_eq!(written[0].content, "いま何時?");
        assert_eq!(written[1].tool_use_id.as_deref(), Some("tu1"));
        assert_eq!(written[1].content, "確認します");
        assert_eq!(written[2].tool_result_for.as_deref(), Some("tu1"));
        assert_eq!(written[3].content, "12 時です");
        // イベントの message_id は書いた id と一致する
        let done = h.sink.find("done").unwrap();
        assert_eq!(done.message_id.as_deref(), Some(ids[3]));
        let tu = h.sink.find("tool_use").unwrap();
        assert_eq!(tu.message_id.as_deref(), Some(ids[1]));
    }

    #[tokio::test]
    async fn error_writes_partial_with_warning_and_cancel_writes_partial_without() {
        let device = FakeDevice::new(Value::Null);
        // 失敗: partial + ⚠️
        let provider = ScriptedProvider::failing_at(vec![], 0);
        let h = harness(provider, &[], device.clone());
        let req = request();
        drive(h.rt.clone(), TurnState::new(req.clone())).await;
        let written = sessions_of(&h);
        assert_eq!(written.len(), 1);
        assert!(written[0].content.starts_with("⚠️ "));
        assert_eq!(
            h.sink.find("error").unwrap().message_id.as_deref(),
            Some(written[0].id.as_str())
        );

        // 中断: 途中までの本文だけ (⚠️ なし)。何も無ければ書かない
        let provider = ScriptedProvider::new(vec![vec![delta("途中まで")]]);
        let h = harness(provider, &[], device);
        let req = request();
        // provider は即座に本文を流し終えるので、drive を直接回して live を再現する
        let live = Arc::new(Mutex::new(LiveText {
            text: "途中まで".into(),
            message_id: assistant_message_id(&req.turn_id, 0),
            session_id: Some("s1".into()),
        }));
        let handle = tokio::spawn(async {});
        active_turns().lock().unwrap().insert(
            req.turn_id.clone(),
            ActiveTurn {
                handle,
                live,
                sessions: h.rt.sessions.clone(),
            },
        );
        let msg = cancel_turn(&req.turn_id).expect("partial written");
        assert_eq!(msg.content, "途中まで");
        assert_eq!(msg.id, assistant_message_id(&req.turn_id, 0));
        assert_eq!(sessions_of(&h).len(), 1);
        assert!(cancel_turn(&req.turn_id).is_none());
    }

    #[tokio::test]
    async fn ephemeral_turn_writes_nothing() {
        let provider = ScriptedProvider::new(vec![vec![delta("ok")]]);
        let h = harness(provider, &[], FakeDevice::new(Value::Null));
        let mut req = request();
        req.session_id = None;
        begin_turn(h.rt.clone(), req).unwrap();
        h.sink.wait_for("done").await;
        assert!(sessions_of(&h).is_empty());
    }

    #[tokio::test]
    async fn reading_untrusted_content_taints_the_session_and_forces_confirmation() {
        // ラウンド 1: notes.show (untrusted) を読む → tainted
        // ラウンド 2: notes.create は記憶済みでも確認が要る
        let provider = ScriptedProvider::new(vec![
            vec![tool_use("tu1", "notes_show", json!({"noteId": "n1"}))],
            vec![tool_use("tu2", "notes_create", json!({"text": "reply"}))],
            vec![delta("done")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "note"}));
        let mut skips = HashSet::new();
        skips.insert("ai.chat:notes.create".to_string());
        let h = harness_with(
            provider,
            &["notes.read", "notes.write"],
            device.clone(),
            skips,
            confirm::ConfirmPolicy::default(),
        );
        let req = request();
        drive(h.rt.clone(), TurnState::new(req.clone())).await;
        assert!(h.rt.taint.is_tainted("s1").await);
        assert_eq!(h.sink.last().kind, "confirm_request");
        assert_eq!(device.executes().len(), 1);
    }

    #[tokio::test]
    async fn device_context_with_others_content_taints_from_the_start() {
        let provider = ScriptedProvider::new(vec![
            vec![tool_use("tu1", "notes_create", json!({"text": "x"}))],
            vec![delta("done")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "note"}));
        let mut skips = HashSet::new();
        skips.insert("ai.chat:notes.create".to_string());
        let h = harness_with(
            provider,
            &["notes.write"],
            device,
            skips,
            confirm::ConfirmPolicy::default(),
        );
        let mut req = request();
        req.context_untrusted = true;
        drive(h.rt.clone(), TurnState::new(req)).await;
        assert!(h.rt.taint.is_tainted("s1").await);
        assert_eq!(h.sink.last().kind, "confirm_request");
    }

    // --- 宛先の出所 (#1103) ---

    #[tokio::test]
    async fn destination_from_untrusted_content_forces_confirmation_without_remember() {
        // ラウンド 1: notes.show (untrusted) が本文にノート id を含めて返す
        // ラウンド 2: その id へ返信 (notes.create の replyId) — 記憶済みでも確認
        let provider = ScriptedProvider::new(vec![
            vec![tool_use("tu1", "notes_show", json!({"noteId": "seed"}))],
            vec![tool_use(
                "tu2",
                "notes_create",
                json!({"text": "reply", "replyId": "note-from-post"}),
            )],
            vec![delta("done")],
        ]);
        let device =
            FakeDevice::new(json!({"ok": true, "result": "本文: reply to note-from-post please"}));
        let mut skips = HashSet::new();
        skips.insert("ai.chat:notes.create".to_string());
        let h = harness_with(
            provider,
            &["notes.read", "notes.write"],
            device.clone(),
            skips,
            confirm::ConfirmPolicy::default(),
        );
        drive(h.rt.clone(), TurnState::new(request())).await;
        let request = h.sink.last();
        assert_eq!(request.kind, "confirm_request");
        let items = request.confirm_items.unwrap();
        assert_eq!(items[0]["destinationUntrusted"], true);
        assert_eq!(items[0]["allowRemember"], false);
        assert_eq!(device.previews()[0]["destinationUntrusted"], true);
    }

    #[tokio::test]
    async fn destination_typed_by_the_user_is_not_flagged() {
        let provider = ScriptedProvider::new(vec![
            vec![tool_use("tu1", "notes_show", json!({"noteId": "seed"}))],
            vec![tool_use(
                "tu2",
                "notes_create",
                json!({"text": "reply", "replyId": "note-from-user"}),
            )],
            vec![delta("done")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "本文に note-from-user もある"}));
        let h = harness(provider, &["notes.read", "notes.write"], device.clone());
        let mut req = request();
        req.messages = vec![user("note-from-user に返信して")];
        drive(h.rt.clone(), TurnState::new(req)).await;
        // untrusted を読んだので tainted → 確認は出るが、宛先はユーザー由来
        let request = h.sink.last();
        assert_eq!(request.kind, "confirm_request");
        let items = request.confirm_items.unwrap();
        assert_eq!(items[0]["destinationUntrusted"], false);
        assert_eq!(items[0]["allowRemember"], true);
    }

    #[tokio::test]
    async fn unattended_write_to_untrusted_destination_is_rejected_without_asking() {
        let provider = ScriptedProvider::new(vec![
            vec![tool_use("tu1", "notes_show", json!({"noteId": "seed"}))],
            vec![tool_use(
                "tu2",
                "user_follow",
                json!({"userId": "u-from-post"}),
            )],
            vec![delta("done")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "follow u-from-post"}));
        let h = harness(provider, &["notes.read", "account.write"], device.clone());
        let mut req = request();
        req.principal = "ai.heartbeat".into();
        drive(h.rt.clone(), TurnState::new(req)).await;
        assert_eq!(device.executes().len(), 1);
        let results: Vec<AiTurnEvent> = h
            .sink
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.kind == "tool_result")
            .cloned()
            .collect();
        assert!(results[1]
            .text
            .as_deref()
            .unwrap()
            .starts_with("Error (destination_untrusted)"));
        assert_eq!(h.sink.last().kind, "done");
    }

    #[tokio::test]
    async fn device_reported_taint_marks_the_session_and_execute_carries_tainted_flag() {
        // memos.list (untrusted ではない) が「ラベル付きメモを返した」と申告する
        let provider = ScriptedProvider::new(vec![
            vec![tool_use("tu1", "memos_list", json!({}))],
            vec![tool_use("tu2", "memos_create", json!({"text": "x"}))],
            vec![delta("done")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": [], "tainted": true}));
        let mut skips = HashSet::new();
        skips.insert("ai.chat:memos.create".to_string());
        let h = harness_with(
            provider,
            &["memos.read", "memos.write"],
            device.clone(),
            skips,
            confirm::ConfirmPolicy::default(),
        );
        drive(h.rt.clone(), TurnState::new(request())).await;
        assert!(h.rt.taint.is_tainted("s1").await);
        let calls = device.executes();
        assert_eq!(calls[0]["tainted"], false);
        // 2 件目は tainted なセッションからの書込として確認要求になる
        assert_eq!(h.sink.last().kind, "confirm_request");
    }

    #[tokio::test]
    async fn core_capabilities_run_in_notecore_and_never_reach_the_device() {
        // time.now は exec: core。デバイス側 tool (time_now は宣言表にあるので
        // デバイス申告で上書きできない) には投げず、core executor が答える
        let provider = ScriptedProvider::new(vec![
            vec![
                tool_use("tu1", "time_now", json!({})),
                tool_use("tu2", "column_list", json!({})),
            ],
            vec![delta("done")],
        ]);
        let device = FakeDevice::new(json!({"ok": true, "result": "from-device"}));
        let core = Arc::new(ScriptedCore {
            calls: Mutex::new(Vec::new()),
            reply: json!("2026-09-24T00:00:00.000Z"),
        });
        let mut h = harness(provider, &["deck.read"], device.clone());
        h.rt = Arc::new(TurnRuntime {
            provider: h.rt.provider.clone(),
            granted: h.rt.granted.clone(),
            skips: h.rt.skips.clone(),
            bridge: h.rt.bridge.clone(),
            sink: h.rt.sink.clone(),
            store_dir: h.rt.store_dir.clone(),
            policy: h.rt.policy,
            sessions: h.rt.sessions.clone(),
            taint: h.rt.taint.clone(),
            core: Some(core.clone()),
        });
        drive(h.rt.clone(), TurnState::new(request())).await;
        let core_calls = core.calls.lock().unwrap();
        assert_eq!(core_calls.len(), 1);
        assert_eq!(core_calls[0].0, "time.now");
        // column.list (UI 系) は device
        let device_calls = device.executes();
        assert_eq!(device_calls.len(), 1);
        assert_eq!(device_calls[0]["capabilityId"], "column.list");
        let results: Vec<String> = h
            .sink
            .0
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.kind == "tool_result")
            .map(|e| e.text.clone().unwrap())
            .collect();
        assert_eq!(results, ["2026-09-24T00:00:00.000Z", "from-device"]);
    }

    #[test]
    fn destination_values_collects_strings_and_arrays() {
        let v = destination_values(
            &json!({"replyId": "a", "ids": ["b", "", 1], "x": 5}),
            &["replyId".into(), "ids".into(), "missing".into(), "x".into()],
        );
        assert_eq!(v, vec!["a", "b"]);
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
        let err = start_turn(req, dir.path(), device, sink, Arc::new(NoCore))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("principal"));
    }
}
