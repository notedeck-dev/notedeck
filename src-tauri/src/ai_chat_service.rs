//! AI チャットストリーミングの domain service (#782 R5)。
//!
//! commands/ai_chat.rs から吸い上げた実体: 透過リトライ状態機械 (#646)、
//! SSE パース、Anthropic / OpenAI 互換の tool_use ビルダー、ストリーム台帳
//! (ACTIVE_STREAMS)、secret redaction、専用 HTTP クライアント。
//! コマンド層は start_stream / cancel_stream への薄い委譲のみ。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{async_runtime::JoinHandle, Emitter};

use notecli::error::{AuthErrorKind, NoteDeckError};

type Result<T> = std::result::Result<T, NoteDeckError>;

/// In-flight chat streaming tasks keyed by `stream_id`. Used by `ai_chat_cancel`
/// to abort the background SSE consumer for a specific stream (e.g. when the
/// user switches to a different AI session mid-response).
static ACTIVE_STREAMS: LazyLock<Mutex<HashMap<String, JoinHandle<()>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Lock `ACTIVE_STREAMS`, recovering from poisoning. Poisoned のまま放置すると
/// register/cancel が silent no-op になり、abort 不能な zombie task が残るため。
fn active_streams() -> std::sync::MutexGuard<'static, HashMap<String, JoinHandle<()>>> {
    ACTIVE_STREAMS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn register_stream(stream_id: String, handle: JoinHandle<()>) {
    if let Some(prev) = active_streams().insert(stream_id, handle) {
        // Same stream_id already in flight (shouldn't happen normally) —
        // abort the older one to keep the map clean.
        prev.abort();
    }
}

fn deregister_stream(stream_id: &str) {
    active_streams().remove(stream_id);
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum AiChatRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AiChatMessage {
    pub role: AiChatRole,
    pub content: String,
    /// AI が呼び出した tool の id (Anthropic `toolu_...` / OpenAI `call_...`)。
    /// 同一 message が tool_use を含む assistant ターンであることを示す。
    /// content と併用された場合は「テキスト + tool_use」の混在 message として
    /// provider に投げる。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    /// tool_use の name (capability id)。tool_use_id とセット。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_name: Option<String>,
    /// tool_use の入力 JSON。tool_use_id とセット。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_input: Option<serde_json::Value>,
    /// tool_result メッセージのときに、対応する tool_use の id を指す。
    /// 設定されている場合 content は実行結果テキスト、role は user 想定。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_result_for: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Type)]
pub struct AiChatRequest {
    pub stream_id: String,
    /// 使用する Vault 接続 (#564 後続)。endpoint / 認証 / protocol は
    /// この接続から Rust 側で解決する。secret はフロントには渡らない。
    pub connection_id: String,
    pub model: String,
    pub messages: Vec<AiChatMessage>,
    pub system: Option<String>,
    pub max_tokens: Option<u32>,
    /// Provider 形式 (Anthropic or OpenAI) の生 tool definition 配列。
    /// フロントが provider に応じて事前変換した形で渡す。空 / None なら
    /// tool calling は無効 (= 既存挙動と同じ)。
    pub tools: Option<serde_json::Value>,
}

/// Wire-format event sent over the `nd:ai-chat-event` channel.
/// Flat shape (rather than tagged enum) for stable specta TS bindings.
#[derive(Debug, Clone, Serialize, Type)]
pub struct AiChatEvent {
    pub stream_id: String,
    /// `"delta" | "done" | "error" | "tool_use"`
    pub kind: String,
    /// Present when `kind == "delta"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Present when `kind == "error"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Tool use call id (Anthropic `toolu_...`, OpenAI `call_...`).
    /// Present when `kind == "tool_use"`. Frontend echoes this back as
    /// `tool_result.tool_use_id` to close the round-trip.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    /// Capability id (= tool name) requested by the AI.
    /// Present when `kind == "tool_use"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_name: Option<String>,
    /// Parsed JSON object passed as the tool input.
    /// Present when `kind == "tool_use"`. Empty object if AI omitted args.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_input: Option<serde_json::Value>,
}

const EVENT_NAME: &str = "nd:ai-chat-event";
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Time allowed to establish the TCP+TLS connection.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// Per-read idle timeout for the SSE body. Unlike a total timeout this does NOT
/// kill a healthy long generation — it only fires when no bytes arrive for this
/// long, so a silently-dropped mid-stream connection is still bounded.
const READ_TIMEOUT: Duration = Duration::from_secs(120);
const DEFAULT_MAX_TOKENS: u32 = 4096;
/// Hard cap on the total bytes (system + all message contents) sent in one
/// chat request. Prevents accidental paste-of-a-huge-file and runaway costs.
const MAX_REQUEST_BYTES: usize = 256 * 1024;
/// 透過リトライ (#646 §A) の最大再送回数。early-drop (UI に何も emit する前の
/// network/stream エラー) のときだけ同一 body を再送する。一度でも delta /
/// tool_use / error を emit した後は再送しない — 重複表示と、tool_use 再 emit
/// による write capability の二重実行 (#646 §C) を防ぐため。
const MAX_TRANSPARENT_RETRIES: u32 = 2;

/// 1 attempt の失敗。`retryable` は network/timeout/reset 系 (送信時 or
/// stream 中の chunk エラー) のみ true。HTTP status エラーは terminal
/// (4xx は再送しても同じ結果、429/5xx はユーザー側の再試行導線に委ねる)。
struct AttemptError {
    message: String,
    retryable: bool,
}

impl AttemptError {
    fn terminal(message: String) -> Self {
        Self {
            message,
            retryable: false,
        }
    }
    fn retryable(message: String) -> Self {
        Self {
            message,
            retryable: true,
        }
    }
}

/// Equal jitter backoff (#640 §E と同方針): sleep ∈ [base/2, base]、
/// base = 500ms * 2^(attempt-1)。floor があるので即時失敗 (RST 等) でも
/// hot-retry バーストにならない。
fn backoff_bounds_ms(attempt: u32) -> (u64, u64) {
    let base = 500u64 << (attempt - 1);
    (base / 2, base)
}

async fn backoff_sleep(attempt: u32) {
    use rand::Rng as _;
    let (lo, hi) = backoff_bounds_ms(attempt);
    let ms = rand::rng().random_range(lo..=hi);
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

/// AI ストリーミング専用 HTTP クライアント。
///
/// 共有 `reqwest::Client` (lib.rs の `shared_http`) を使うと、HTTP/2 の
/// RST_STREAM や connection pool の半閉じ接続再利用が原因で
/// "error decoding response body" / "os error 103" になるケースが発生する
/// (大きい tool_result を AI が処理した後の長いレスポンス中に多い)。それを避けるため:
///
/// - `http1_only()` で HTTP/2 を無効化 (SSE は HTTP/1.1 chunked が安定)
/// - `pool_max_idle_per_host(0)` で idle 接続を保持しない。AI は低頻度なので毎回
///   新規接続のコストは無視でき、モバイルで NAT が切った半閉じ接続を次リクエストで
///   掴む事故 (#508 の os error 103 の一因) を防げる
/// - total timeout は持たない。代わりに `connect_timeout` (接続確立) と
///   `read_timeout` (チャンク間 idle) を使う。total timeout だと健全な長文生成が
///   180s で問答無用に切られていた (#508 の「長文応答で切れる」直因)。read_timeout
///   は無音が続いたときだけ発火するので長文生成自体は切らない
///
/// `OnceLock` でプロセス生存期間 1 回だけ構築。
static STREAMING_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn streaming_client() -> &'static reqwest::Client {
    STREAMING_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .http1_only()
            .pool_max_idle_per_host(0)
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .user_agent("notedeck-ai-streaming")
            .build()
            .expect("failed to build AI streaming client")
    })
}

/// reqwest::Error の Display は短すぎて診断に使えない (例:
/// "error decoding response body" だけで原因不明)。`std::error::Error::source`
/// を辿って full chain を `⇐` 区切りで連結する。
fn describe_stream_error(e: &reqwest::Error) -> String {
    use std::fmt::Write as _;
    let mut details = format!("stream error: {e}");
    let mut source: Option<&(dyn std::error::Error + 'static)> = std::error::Error::source(e);
    while let Some(s) = source {
        let _ = write!(details, " ⇐ {s}");
        source = s.source();
    }
    details
}

/// ストリーミングチャットを開始する。入力検証 → Vault 接続解決 →
/// protocol 別ランナーを background task で起動し、ストリーム台帳に登録する。
/// 即座に返り、以後のイベントは `nd:ai-chat-event` に流れる。
pub async fn start_stream(
    app: tauri::AppHandle,
    client: reqwest::Client,
    req: AiChatRequest,
) -> Result<()> {
    if req.model.trim().is_empty() {
        return Err(NoteDeckError::InvalidInput("model is empty".into()));
    }

    let total_bytes: usize = req.messages.iter().map(|m| m.content.len()).sum::<usize>()
        + req.system.as_deref().map(str::len).unwrap_or(0);
    if total_bytes > MAX_REQUEST_BYTES {
        return Err(NoteDeckError::InvalidInput(format!(
            "リクエストが大きすぎます ({} KB / 上限 {} KB)。長文は分割するか、不要な履歴を削除してください。",
            total_bytes / 1024,
            MAX_REQUEST_BYTES / 1024
        )));
    }

    // Vault 接続を解決する: endpoint / protocol はメタデータから、secret は
    // OS キーチェーンから。secret はこの Rust 側だけで展開しフロントには返さない。
    let file = crate::vault::connections_store::load(&app)
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    let connection = file
        .connections
        .iter()
        .find(|c| c.id == req.connection_id)
        .ok_or_else(|| NoteDeckError::InvalidInput("AI 接続が見つかりません".into()))?
        .clone();
    let protocol = connection.protocol.ok_or_else(|| {
        NoteDeckError::InvalidInput("選択された接続は AI プロバイダーではありません".into())
    })?;
    let endpoint = connection.base_url.clone();
    let api_key = {
        use crate::vault::SecretBackend as _;
        crate::vault::KeychainBackend
            .load(&req.connection_id, "primary")
            .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?
            .map(|s| {
                use secrecy::ExposeSecret as _;
                s.expose_secret().to_string()
            })
            .unwrap_or_default()
    };
    if api_key.is_empty() {
        return Err(NoteDeckError::Auth(AuthErrorKind::CredentialMissing(
            format!("接続「{}」の API キーが設定されていません", connection.name),
        )));
    }

    let app_handle = app.clone();
    let stream_id = req.stream_id.clone();
    let stream_id_for_task = stream_id.clone();

    let handle = tauri::async_runtime::spawn(async move {
        let result = match protocol {
            crate::vault::ConnectionProtocol::Anthropic => {
                run_anthropic(&client, &req, &endpoint, &api_key, &app_handle).await
            }
            crate::vault::ConnectionProtocol::OpenaiCompat => {
                run_openai_compat(&client, &req, &endpoint, &api_key, &app_handle).await
            }
        };
        match result {
            Ok(()) => emit_done(&app_handle, &stream_id_for_task),
            Err(message) => emit_error(&app_handle, &stream_id_for_task, message),
        }
        deregister_stream(&stream_id_for_task);
    });

    register_stream(stream_id, handle);

    Ok(())
}

/// 進行中ストリームを中断する。冪等 — 完了済み / 未登録なら no-op。
pub fn cancel_stream(stream_id: &str) {
    let handle = active_streams().remove(stream_id);
    if let Some(h) = handle {
        h.abort();
    }
}

fn emit_delta(app: &tauri::AppHandle, stream_id: &str, text: String) {
    let _ = app.emit(
        EVENT_NAME,
        AiChatEvent {
            stream_id: stream_id.to_string(),
            kind: "delta".into(),
            text: Some(text),
            error: None,
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
        },
    );
}

fn emit_done(app: &tauri::AppHandle, stream_id: &str) {
    let _ = app.emit(
        EVENT_NAME,
        AiChatEvent {
            stream_id: stream_id.to_string(),
            kind: "done".into(),
            text: None,
            error: None,
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
        },
    );
}

fn emit_error(app: &tauri::AppHandle, stream_id: &str, message: String) {
    let _ = app.emit(
        EVENT_NAME,
        AiChatEvent {
            stream_id: stream_id.to_string(),
            kind: "error".into(),
            text: None,
            error: Some(message),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
        },
    );
}

fn emit_tool_use(
    app: &tauri::AppHandle,
    stream_id: &str,
    id: String,
    name: String,
    input: serde_json::Value,
) {
    let _ = app.emit(
        EVENT_NAME,
        AiChatEvent {
            stream_id: stream_id.to_string(),
            kind: "tool_use".into(),
            text: None,
            error: None,
            tool_use_id: Some(id),
            tool_use_name: Some(name),
            tool_use_input: Some(input),
        },
    );
}

fn role_str(r: &AiChatRole) -> &'static str {
    match r {
        AiChatRole::System => "system",
        AiChatRole::User => "user",
        AiChatRole::Assistant => "assistant",
    }
}

/// AiChatMessage を Anthropic Messages API の 1 message に変換する。
///
/// - 通常 (text のみ): `{role, content: "..."}`
/// - tool_use を含む assistant: `{role: "assistant", content: [{type: "text", ...}, {type: "tool_use", id, name, input}]}`
/// - tool_result の user: `{role: "user", content: [{type: "tool_result", tool_use_id, content}]}`
fn anthropic_message(m: &AiChatMessage) -> serde_json::Value {
    use serde_json::json;

    if let Some(tool_use_id) = m.tool_use_id.as_deref() {
        let mut blocks: Vec<serde_json::Value> = Vec::new();
        if !m.content.is_empty() {
            blocks.push(json!({"type": "text", "text": m.content}));
        }
        blocks.push(json!({
            "type": "tool_use",
            "id": tool_use_id,
            "name": m.tool_use_name.as_deref().unwrap_or(""),
            "input": m
                .tool_use_input
                .clone()
                .unwrap_or_else(|| json!({})),
        }));
        return json!({"role": role_str(&m.role), "content": blocks});
    }
    if let Some(tool_use_id) = m.tool_result_for.as_deref() {
        return json!({
            "role": role_str(&m.role),
            "content": [{
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": m.content,
            }]
        });
    }
    json!({"role": role_str(&m.role), "content": m.content})
}

/// AiChatMessage を OpenAI Chat Completions API の 1 message に変換する。
///
/// - 通常 (text のみ): `{role, content: "..."}`
/// - tool_use を含む assistant: `{role: "assistant", content: <text or null>, tool_calls: [{id, type: "function", function: {name, arguments: <stringified JSON>}}]}`
/// - tool_result: `{role: "tool", tool_call_id, content: "..."}`
fn openai_message(m: &AiChatMessage) -> serde_json::Value {
    use serde_json::json;

    if let Some(tool_use_id) = m.tool_use_id.as_deref() {
        let arguments = serde_json::to_string(m.tool_use_input.as_ref().unwrap_or(&json!({})))
            .unwrap_or_else(|_| "{}".to_string());
        let content_value = if m.content.is_empty() {
            serde_json::Value::Null
        } else {
            json!(m.content)
        };
        return json!({
            "role": "assistant",
            "content": content_value,
            "tool_calls": [{
                "id": tool_use_id,
                "type": "function",
                "function": {
                    "name": m.tool_use_name.as_deref().unwrap_or(""),
                    "arguments": arguments,
                }
            }]
        });
    }
    if let Some(tool_call_id) = m.tool_result_for.as_deref() {
        return json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": m.content,
        });
    }
    json!({"role": role_str(&m.role), "content": m.content})
}

fn parse_sse_blocks(buf: &mut String) -> Vec<String> {
    let mut blocks = Vec::new();
    while let Some(pos) = buf.find("\n\n") {
        blocks.push(buf[..pos].to_string());
        buf.drain(..pos + 2);
    }
    blocks
}

// --- Anthropic Messages API ---

async fn run_anthropic(
    // shared_http は使わず streaming_client() を使う (HTTP/2 RST_STREAM 回避)。
    // 引数は呼び出し側の互換性のため残してある。
    _shared_http: &reqwest::Client,
    req: &AiChatRequest,
    endpoint: &str,
    api_key: &str,
    app: &tauri::AppHandle,
) -> std::result::Result<(), String> {
    let mut has_emitted = false;
    let mut attempt: u32 = 0;
    loop {
        match run_anthropic_attempt(req, endpoint, api_key, app, &mut has_emitted).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                if has_emitted || !e.retryable || attempt >= MAX_TRANSPARENT_RETRIES {
                    return Err(e.message);
                }
                attempt += 1;
                tracing::warn!(
                    attempt,
                    "ai stream early-drop, transparent retry: {}",
                    e.message
                );
                backoff_sleep(attempt).await;
            }
        }
    }
}

async fn run_anthropic_attempt(
    req: &AiChatRequest,
    endpoint: &str,
    api_key: &str,
    app: &tauri::AppHandle,
    has_emitted: &mut bool,
) -> std::result::Result<(), AttemptError> {
    use serde_json::json;

    let url = format!("{}/v1/messages", endpoint.trim_end_matches('/'));
    let messages: Vec<serde_json::Value> = req
        .messages
        .iter()
        .filter(|m| !matches!(m.role, AiChatRole::System))
        .map(anthropic_message)
        .collect();

    let mut body = json!({
        "model": req.model,
        "max_tokens": req.max_tokens.unwrap_or(DEFAULT_MAX_TOKENS),
        "messages": messages,
        "stream": true,
    });
    if let Some(sys) = req.system.as_deref().filter(|s| !s.is_empty()) {
        body["system"] = json!(sys);
    }
    if let Some(tools) = req.tools.as_ref() {
        if !is_empty_array(tools) {
            body["tools"] = tools.clone();
        }
    }

    let resp = streaming_client()
        .post(&url)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AttemptError::retryable(format!("network error: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(AttemptError::terminal(format_http_error(status, &text)));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    // 失敗した attempt の組み立て途中 tool_use はここで捨てられる (再 attempt は
    // fresh な builder で始まる) ので、incomplete な tool_use_id が確定することはない。
    let mut tool_builder: Option<AnthropicToolUseBuilder> = None;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| AttemptError::retryable(describe_stream_error(&e)))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        for block in parse_sse_blocks(&mut buf) {
            handle_anthropic_block(&block, app, &req.stream_id, &mut tool_builder, has_emitted);
        }
    }
    Ok(())
}

/// Anthropic tool_use の SSE ストリームを assembling する一時状態。
/// content_block_start で `{id, name}` を取り、input_json_delta を
/// 連結し、content_block_stop で完成した tool_use イベントを emit する。
struct AnthropicToolUseBuilder {
    id: String,
    name: String,
    input_json_buf: String,
}

fn handle_anthropic_block(
    block: &str,
    app: &tauri::AppHandle,
    stream_id: &str,
    tool_builder: &mut Option<AnthropicToolUseBuilder>,
    has_emitted: &mut bool,
) {
    let mut data: Option<&str> = None;
    for line in block.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            data = Some(rest.trim());
        }
    }
    let Some(data) = data else { return };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
        return;
    };
    let Some(t) = value.get("type").and_then(|v| v.as_str()) else {
        return;
    };
    match t {
        "content_block_start" => {
            let cb = value.get("content_block");
            let block_type = cb.and_then(|c| c.get("type")).and_then(|v| v.as_str());
            if block_type == Some("tool_use") {
                let id = cb
                    .and_then(|c| c.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = cb
                    .and_then(|c| c.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                *tool_builder = Some(AnthropicToolUseBuilder {
                    id,
                    name,
                    input_json_buf: String::new(),
                });
            }
        }
        "content_block_delta" => {
            let delta_type = value.pointer("/delta/type").and_then(|v| v.as_str());
            if delta_type == Some("text_delta") {
                if let Some(text) = value.pointer("/delta/text").and_then(|v| v.as_str()) {
                    *has_emitted = true;
                    emit_delta(app, stream_id, text.to_string());
                }
            } else if delta_type == Some("input_json_delta") {
                if let Some(b) = tool_builder.as_mut() {
                    if let Some(partial) = value
                        .pointer("/delta/partial_json")
                        .and_then(|v| v.as_str())
                    {
                        b.input_json_buf.push_str(partial);
                    }
                }
            }
        }
        "content_block_stop" => {
            if let Some(b) = tool_builder.take() {
                let input = if b.input_json_buf.is_empty() {
                    serde_json::json!({})
                } else {
                    serde_json::from_str::<serde_json::Value>(&b.input_json_buf)
                        .unwrap_or_else(|_| serde_json::json!({}))
                };
                *has_emitted = true;
                emit_tool_use(app, stream_id, b.id, b.name, input);
            }
        }
        "error" => {
            if let Some(msg) = value.pointer("/error/message").and_then(|v| v.as_str()) {
                // SSE error イベントも UI に届く = このターンは透過リトライ不可
                *has_emitted = true;
                emit_error(app, stream_id, format!("Anthropic: {msg}"));
            }
        }
        _ => {}
    }
}

fn is_empty_array(v: &serde_json::Value) -> bool {
    v.as_array().map(|a| a.is_empty()).unwrap_or(false)
}

// --- OpenAI Chat Completions (and OpenAI-compatible) ---

async fn run_openai_compat(
    // shared_http は使わず streaming_client() を使う (HTTP/2 RST_STREAM 回避)。
    // 引数は呼び出し側の互換性のため残してある。
    _shared_http: &reqwest::Client,
    req: &AiChatRequest,
    endpoint: &str,
    api_key: &str,
    app: &tauri::AppHandle,
) -> std::result::Result<(), String> {
    let mut has_emitted = false;
    let mut attempt: u32 = 0;
    loop {
        match run_openai_compat_attempt(req, endpoint, api_key, app, &mut has_emitted).await {
            Ok(()) => return Ok(()),
            Err(e) => {
                if has_emitted || !e.retryable || attempt >= MAX_TRANSPARENT_RETRIES {
                    return Err(e.message);
                }
                attempt += 1;
                tracing::warn!(
                    attempt,
                    "ai stream early-drop, transparent retry: {}",
                    e.message
                );
                backoff_sleep(attempt).await;
            }
        }
    }
}

async fn run_openai_compat_attempt(
    req: &AiChatRequest,
    endpoint: &str,
    api_key: &str,
    app: &tauri::AppHandle,
    has_emitted: &mut bool,
) -> std::result::Result<(), AttemptError> {
    use serde_json::json;

    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));
    let mut messages: Vec<serde_json::Value> = Vec::new();
    if let Some(sys) = req.system.as_deref().filter(|s| !s.is_empty()) {
        messages.push(json!({"role": "system", "content": sys}));
    }
    for m in &req.messages {
        messages.push(openai_message(m));
    }
    let mut body = json!({
        "model": req.model,
        "messages": messages,
        "stream": true,
    });
    if let Some(mt) = req.max_tokens {
        body["max_tokens"] = json!(mt);
    }
    if let Some(tools) = req.tools.as_ref() {
        if !is_empty_array(tools) {
            body["tools"] = tools.clone();
        }
    }

    let mut request = streaming_client()
        .post(&url)
        .header("content-type", "application/json")
        .json(&body);
    if !api_key.is_empty() {
        request = request.header("authorization", format!("Bearer {api_key}"));
    }
    let resp = request
        .send()
        .await
        .map_err(|e| AttemptError::retryable(format!("network error: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(AttemptError::terminal(format_http_error(status, &text)));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    // OpenAI は同 message 内で複数 tool_calls を index 別に送ってくるので
    // index ごとの builder を Vec で持つ。今回は単一前提で実装するが、
    // Vec のままにしておくと将来複数対応への拡張が容易。
    let mut tool_builders: Vec<OpenAiToolCallBuilder> = Vec::new();
    'outer: while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| AttemptError::retryable(describe_stream_error(&e)))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));
        for block in parse_sse_blocks(&mut buf) {
            for line in block.lines() {
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    break 'outer;
                }
                let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
                    continue;
                };
                if let Some(text) = value
                    .pointer("/choices/0/delta/content")
                    .and_then(|v| v.as_str())
                {
                    *has_emitted = true;
                    emit_delta(app, &req.stream_id, text.to_string());
                }
                accumulate_openai_tool_calls(&value, &mut tool_builders);
                if let Some(reason) = value
                    .pointer("/choices/0/finish_reason")
                    .and_then(|v| v.as_str())
                {
                    if reason == "tool_calls" {
                        flush_openai_tool_calls(
                            app,
                            &req.stream_id,
                            &mut tool_builders,
                            has_emitted,
                        );
                    }
                }
            }
        }
    }
    // Stream が `[DONE]` で打ち切られた場合 / finish_reason が来なかった
    // ケースに備えて、残っている builder があれば flush する。
    flush_openai_tool_calls(app, &req.stream_id, &mut tool_builders, has_emitted);
    Ok(())
}

/// OpenAI Chat Completions の tool_calls を index ごとに assembling する
/// 一時状態。最初のチャンクで `id` と `function.name` が来て、その後
/// `function.arguments` が partial で連結される。
struct OpenAiToolCallBuilder {
    id: String,
    name: String,
    args_json_buf: String,
}

fn accumulate_openai_tool_calls(
    value: &serde_json::Value,
    builders: &mut Vec<OpenAiToolCallBuilder>,
) {
    let Some(tool_calls) = value
        .pointer("/choices/0/delta/tool_calls")
        .and_then(|v| v.as_array())
    else {
        return;
    };
    for tc in tool_calls {
        let index = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        // 必要に応じて Vec を拡張 (穴は空 builder で埋める)
        while builders.len() <= index {
            builders.push(OpenAiToolCallBuilder {
                id: String::new(),
                name: String::new(),
                args_json_buf: String::new(),
            });
        }
        let b = &mut builders[index];
        if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
            if !id.is_empty() {
                b.id = id.to_string();
            }
        }
        if let Some(name) = tc.pointer("/function/name").and_then(|v| v.as_str()) {
            if !name.is_empty() {
                b.name = name.to_string();
            }
        }
        if let Some(args) = tc.pointer("/function/arguments").and_then(|v| v.as_str()) {
            b.args_json_buf.push_str(args);
        }
    }
}

fn flush_openai_tool_calls(
    app: &tauri::AppHandle,
    stream_id: &str,
    builders: &mut Vec<OpenAiToolCallBuilder>,
    has_emitted: &mut bool,
) {
    for b in builders.drain(..) {
        if b.id.is_empty() && b.name.is_empty() {
            continue;
        }
        let input = if b.args_json_buf.is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str::<serde_json::Value>(&b.args_json_buf)
                .unwrap_or_else(|_| serde_json::json!({}))
        };
        *has_emitted = true;
        emit_tool_use(app, stream_id, b.id, b.name, input);
    }
}

/// Patterns that look like API credentials. Redacted from any error body before
/// it is shown to the user — error responses sometimes echo the request headers
/// (or include other credentials in JSON), and we never want those to leak.
static SECRET_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        // Anthropic style: sk-ant-...
        Regex::new(r"sk-ant-[A-Za-z0-9_\-]{20,}").unwrap(),
        // OpenAI style: sk-...
        Regex::new(r"sk-[A-Za-z0-9_\-]{20,}").unwrap(),
        // Bearer tokens
        Regex::new(r"(?i)Bearer\s+[A-Za-z0-9._\-]{20,}").unwrap(),
        // x-api-key style headers echoed back
        Regex::new(r#"(?i)x-api-key["'\s:=]+[A-Za-z0-9_\-]{20,}"#).unwrap(),
    ]
});

fn redact_secrets(s: &str) -> String {
    let mut out = s.to_string();
    for re in SECRET_PATTERNS.iter() {
        out = re.replace_all(&out, "[REDACTED]").into_owned();
    }
    out
}

fn format_http_error(status: u16, body: &str) -> String {
    let snippet: String = redact_secrets(body).chars().take(300).collect();
    let detail = if snippet.trim().is_empty() {
        String::new()
    } else {
        format!(": {snippet}")
    };
    match status {
        // 401 はキーそのものが通っていない。403 はキーは通っていて権限・課金
        // 状態が理由 (クレジット不足・キーの ACL・地域制限など) なので、対処が
        // まったく別物になる。プロバイダーが返した理由もそのまま見せる。
        401 => format!("APIキーが無効です (HTTP {status}){detail}"),
        403 => format!(
            "APIキーの権限または課金状態に問題があります (HTTP {status}){detail} — プロバイダーのコンソールで残高と API キーの権限を確認してください"
        ),
        429 => "レート制限に達しました。少し待ってから再試行してください".into(),
        500..=599 => format!("サーバーエラー (HTTP {status}){detail}"),
        _ => format!("HTTP {status}{detail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn text_message(role: AiChatRole, content: &str) -> AiChatMessage {
        AiChatMessage {
            role,
            content: content.into(),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: None,
        }
    }

    #[test]
    fn anthropic_message_text_only() {
        let m = text_message(AiChatRole::User, "hello");
        assert_eq!(
            anthropic_message(&m),
            json!({"role": "user", "content": "hello"}),
        );
    }

    #[test]
    fn anthropic_message_assistant_with_tool_use_only() {
        let m = AiChatMessage {
            role: AiChatRole::Assistant,
            content: String::new(),
            tool_use_id: Some("toolu_1".into()),
            tool_use_name: Some("time.now".into()),
            tool_use_input: Some(json!({})),
            tool_result_for: None,
        };
        assert_eq!(
            anthropic_message(&m),
            json!({
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "toolu_1", "name": "time.now", "input": {}}
                ]
            }),
        );
    }

    #[test]
    fn anthropic_message_assistant_with_text_and_tool_use() {
        let m = AiChatMessage {
            role: AiChatRole::Assistant,
            content: "Let me check.".into(),
            tool_use_id: Some("toolu_2".into()),
            tool_use_name: Some("time.now".into()),
            tool_use_input: Some(json!({})),
            tool_result_for: None,
        };
        let v = anthropic_message(&m);
        let blocks = v.get("content").and_then(|c| c.as_array()).unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], "Let me check.");
        assert_eq!(blocks[1]["type"], "tool_use");
        assert_eq!(blocks[1]["id"], "toolu_2");
    }

    #[test]
    fn anthropic_message_tool_result() {
        let m = AiChatMessage {
            role: AiChatRole::User,
            content: "2026-05-01T00:00:00Z".into(),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: Some("toolu_1".into()),
        };
        assert_eq!(
            anthropic_message(&m),
            json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "toolu_1",
                    "content": "2026-05-01T00:00:00Z",
                }]
            }),
        );
    }

    #[test]
    fn openai_message_text_only() {
        let m = text_message(AiChatRole::Assistant, "hi");
        assert_eq!(
            openai_message(&m),
            json!({"role": "assistant", "content": "hi"}),
        );
    }

    #[test]
    fn openai_message_assistant_with_tool_use() {
        let m = AiChatMessage {
            role: AiChatRole::Assistant,
            content: String::new(),
            tool_use_id: Some("call_1".into()),
            tool_use_name: Some("notes.post".into()),
            tool_use_input: Some(json!({"text": "hi", "visibility": "public"})),
            tool_result_for: None,
        };
        let v = openai_message(&m);
        assert_eq!(v["role"], "assistant");
        assert!(v["content"].is_null());
        let calls = v.get("tool_calls").and_then(|c| c.as_array()).unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0]["id"], "call_1");
        assert_eq!(calls[0]["type"], "function");
        assert_eq!(calls[0]["function"]["name"], "notes.post");
        // arguments は string として serialized されている
        let args_str = calls[0]["function"]["arguments"].as_str().unwrap();
        let args: serde_json::Value = serde_json::from_str(args_str).unwrap();
        assert_eq!(args, json!({"text": "hi", "visibility": "public"}));
    }

    #[test]
    fn openai_message_assistant_with_text_and_tool_use() {
        let m = AiChatMessage {
            role: AiChatRole::Assistant,
            content: "Calling tool".into(),
            tool_use_id: Some("call_2".into()),
            tool_use_name: Some("time.now".into()),
            tool_use_input: Some(json!({})),
            tool_result_for: None,
        };
        let v = openai_message(&m);
        assert_eq!(v["content"], "Calling tool");
    }

    #[test]
    fn openai_message_tool_result_uses_tool_role() {
        let m = AiChatMessage {
            role: AiChatRole::User, // OpenAI 形式では role を 'tool' に上書きする
            content: "result text".into(),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: Some("call_1".into()),
        };
        assert_eq!(
            openai_message(&m),
            json!({
                "role": "tool",
                "tool_call_id": "call_1",
                "content": "result text",
            }),
        );
    }

    #[test]
    fn backoff_bounds_are_equal_jitter_with_floor() {
        // attempt 1: base 500ms → [250, 500]、attempt 2: base 1000ms → [500, 1000]。
        // floor (base/2) があるので 0 秒近傍の hot-retry バーストにならない。
        assert_eq!(backoff_bounds_ms(1), (250, 500));
        assert_eq!(backoff_bounds_ms(2), (500, 1000));
    }

    #[test]
    fn format_http_error_separates_401_from_403() {
        // 401 は「キーが違う」、403 は「キーは通っているが権限・課金が問題」。
        // 対処が別物なので同じ文言に丸めない。
        let unauthorized = format_http_error(401, r#"{"error":"Incorrect API key"}"#);
        let forbidden = format_http_error(403, r#"{"error":"Your team has no credits"}"#);
        assert!(unauthorized.contains("APIキーが無効"));
        assert!(!forbidden.contains("APIキーが無効"));
    }

    #[test]
    fn format_http_error_shows_provider_reason_for_auth_errors() {
        // プロバイダーが返した理由を捨てない (クレジット不足を「キーが無効」と
        // 誤読させない)。
        let msg = format_http_error(403, r#"{"error":"Your team has no credits"}"#);
        assert!(msg.contains("Your team has no credits"));
    }

    #[test]
    fn format_http_error_redacts_secrets_echoed_in_body() {
        let msg = format_http_error(
            401,
            r#"{"error":"bad key sk-ant-abcdefghijklmnopqrstuvwxyz0123"}"#,
        );
        assert!(msg.contains("[REDACTED]"));
        assert!(!msg.contains("sk-ant-"));
    }

    #[test]
    fn format_http_error_omits_empty_body() {
        // ボディが空のときに ": " だけがぶら下がらない。
        assert_eq!(format_http_error(401, ""), "APIキーが無効です (HTTP 401)");
    }

    #[test]
    fn ai_chat_message_deserialize_backward_compat() {
        // 既存 frontend が tool_* フィールドを送らないケースで deserialize できる
        let json = r#"{"role":"user","content":"hi"}"#;
        let m: AiChatMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(m.role, AiChatRole::User));
        assert_eq!(m.content, "hi");
        assert!(m.tool_use_id.is_none());
        assert!(m.tool_use_name.is_none());
        assert!(m.tool_use_input.is_none());
        assert!(m.tool_result_for.is_none());
    }
}
