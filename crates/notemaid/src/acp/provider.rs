//! 手元の CLI を provider として使う (#1104)。ターン実行器から見ると 1 ラウンド = CLI の 1 ターン。
//! ツールのループは CLI の中で回る (NoteDeck の capability は MCP サーバー越し) ので、
//! こちらは本文の断片を流し、ツールの動きを通常経路と同じ tool_use / tool_result に写し
//! (`ai_turn::external`)、CLI 自身のツールの許可要求を確認ダイアログに写すだけ。
//! NoteDeck の capability への許可要求は、その段階で NoteDeck 自身に確認させる (#1191):
//! 橋 `acp/confirm` でデバイスの dispatcher が権限の判定と確認ダイアログを済ませ、承認を
//! 記録する。直後の同じ tool 呼び出し (MCP) はその記録で確認なしに通るので 2 度聞かない。
//! 人の承認を MCP tool のタイムアウトの内側で待たないための形 (以前は実行時に確認していて、
//! CLI には timed out と返るのに承認後に反映されていた)。デバイスに届かなければ通し、
//! 実行時の確認に任せる。CLI は利用者が選んだ AI 本人なので、MCP 用トークンは
//! harness 種別 = ai.chat で解決する (#1188: external だと記憶 / skill の書込が恒久 deny)。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notecore::frontend_bridge::FrontendBridge;
use notecore::i18n::{localize_fields, text as i18n_text};
use serde_json::{json, Value};

use super::client::{AcpAgent, Incoming};
use super::harness::HarnessInfo;
use crate::ai_chat_service::{AiChatEvent, AiChatMessage, AiChatRole, AiChatSink, RoundError};
use crate::ai_turn::confirm;

/// 1 ターン全体の上限 (CLI はツールを何度も回すので長い)
const TURN_HARD_LIMIT: Duration = Duration::from_secs(30 * 60);
/// 許可要求を待つ上限 (確認ダイアログの TTL と同じ考え方)
const PERMISSION_TTL: Duration = Duration::from_secs(10 * 60);

/// 起動済みのエージェントと、NoteDeck のセッション → ACP のセッションの対応
#[derive(Default)]
pub struct Registry {
    agents: Mutex<HashMap<String, Arc<AcpAgent>>>,
    /// (harness id, NoteDeck session id) → ACP session id
    sessions: Mutex<HashMap<(String, String), String>>,
    /// harness id → NoteDeck の MCP サーバーに渡した永続トークン (id, 本体)。harness ごとに
    /// 1 つだけ発行して以後のセッションでは使い回し、終了時に id で失効させる (セッションごとに
    /// 発行すると失効漏れのトークンが残る)
    tokens: Mutex<HashMap<String, (String, String)>>,
}

impl Registry {
    fn agent(&self, id: &str) -> Option<Arc<AcpAgent>> {
        let mut agents = self.agents.lock().unwrap_or_else(|e| e.into_inner());
        match agents.get(id) {
            Some(a) if a.is_alive() => Some(a.clone()),
            Some(_) => {
                agents.remove(id);
                // プロセスが死んだので、そのセッション対応も捨てる
                self.sessions
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .retain(|(h, _), _| h != id);
                None
            }
            None => None,
        }
    }

    /// 全部止める (notemaid の終了)。トークンの失効は呼び出し側が橋でやる
    pub fn shutdown_all(&self) -> Vec<String> {
        let agents: Vec<Arc<AcpAgent>> = self
            .agents
            .lock()
            .map(|mut a| a.drain().map(|(_, v)| v).collect())
            .unwrap_or_default();
        for a in agents {
            a.shutdown();
        }
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.tokens
            .lock()
            .map(|mut t| t.drain().map(|(_, (id, _))| id).collect())
            .unwrap_or_default()
    }
}

pub struct AcpProvider {
    pub harness: HarnessInfo,
    pub registry: Arc<Registry>,
    pub bridge: Arc<dyn FrontendBridge>,
    /// エージェントの作業ディレクトリ (設定フォルダの中の専用の場所)
    pub workspace: PathBuf,
    /// NoteDeck の MCP サーバーの URL (`None` = 渡さない)
    pub mcp_url: Option<String>,
}

impl AcpProvider {
    /// エージェントを (必要なら起動して) 返す。初回は MCP 用の永続トークンを橋で発行する
    async fn agent(&self) -> Result<Arc<AcpAgent>, RoundError> {
        if let Some(a) = self.registry.agent(&self.harness.id) {
            return Ok(a);
        }
        if !self.harness.available {
            return Err(RoundError::from(format!(
                "{} is not available: {}",
                self.harness.name,
                self.harness.detail.clone().unwrap_or_default()
            )));
        }
        std::fs::create_dir_all(&self.workspace)
            .map_err(|e| RoundError::from(format!("workspace: {e}")))?;
        let agent = AcpAgent::spawn(self.harness.clone(), &self.workspace)
            .await
            .map_err(RoundError::from)?;
        self.registry
            .agents
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(self.harness.id.clone(), agent.clone());
        Ok(agent)
    }

    /// NoteDeck の MCP サーバーの設定 (`session/new` の mcpServers の 1 件)。
    /// トークン (harness 種別 = ai.chat principal) は harness ごとに 1 つ発行して覚え、
    /// 終了時に失効させる
    async fn mcp_server(&self) -> Option<Value> {
        let url = self.mcp_url.clone()?;
        let token = match self.token_for_harness().await {
            Some(t) => t,
            None => return None,
        };
        Some(json!({
            "type": "http",
            "name": "notedeck",
            "url": url,
            "headers": [{ "name": "Authorization", "value": format!("Bearer {token}") }],
        }))
    }

    /// NoteDeck の capability への許可要求を、デバイスの dispatcher に確認してもらう
    /// (`acp/confirm`: 権限の判定 + 確認ダイアログ、人のペースで待つ)。承認なら true。
    /// デバイスに届かない (切断中 / 古いアプリ) ときは通し、実行時の確認に任せる
    async fn confirm_with_notedeck(&self, capability_id: &str, input: Value) -> bool {
        let reply = self
            .bridge
            .query(
                "acp/confirm",
                json!({
                    "capabilityId": capability_id,
                    "params": input,
                    "principal": "ai.chat",
                }),
                notecore::http_server::CAPABILITY_EXECUTE_TIMEOUT,
            )
            .await;
        match reply {
            Ok(v) => match v.get("ok").and_then(Value::as_bool) {
                Some(ok) => ok,
                None => {
                    tracing::warn!(harness = %self.harness.id, capability = capability_id, "acp/confirm answered without ok; deferring to the execute-time confirmation");
                    true
                }
            },
            Err(e) => {
                tracing::warn!(harness = %self.harness.id, capability = capability_id, "acp/confirm unavailable ({e}); deferring to the execute-time confirmation");
                true
            }
        }
    }

    /// この harness の MCP 用トークン本体。発行済みなら使い回し、無ければ発行して覚える
    async fn token_for_harness(&self) -> Option<String> {
        if let Some((_, token)) = self
            .registry
            .tokens
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&self.harness.id)
        {
            return Some(token.clone());
        }
        let issued = self
            .bridge
            .issue_harness_token(format!("AI harness: {}", self.harness.name))
            .await;
        let issued = match issued {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(harness = %self.harness.id, "cannot issue an MCP token: {e}");
                return None;
            }
        };
        let token = issued.get("token").and_then(Value::as_str)?.to_string();
        let id = issued.get("id").and_then(Value::as_str)?.to_string();
        self.registry
            .tokens
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(self.harness.id.clone(), (id, token.clone()));
        Some(token)
    }

    async fn session_for(
        &self,
        agent: &Arc<AcpAgent>,
        notedeck_session: Option<&str>,
    ) -> Result<(String, bool), RoundError> {
        let key = (
            self.harness.id.clone(),
            notedeck_session.unwrap_or("").to_string(),
        );
        if notedeck_session.is_some() {
            let existing = self
                .registry
                .sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&key)
                .cloned();
            if let Some(sid) = existing {
                return Ok((sid, false));
            }
        }
        let mcp = self.mcp_server().await;
        let sid = agent.new_session(&self.workspace, mcp).await.map_err(|e| {
            match e.strip_prefix(super::client::AUTH_REQUIRED_PREFIX) {
                Some(detail) => RoundError::from(format!(
                    "{} needs you to log in with its CLI first ({detail})",
                    self.harness.name
                )),
                None => RoundError::from(e),
            }
        })?;
        if notedeck_session.is_some() {
            self.registry
                .sessions
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(key, sid.clone());
        }
        Ok((sid, true))
    }
}

/// CLI に渡す文面。ACP セッションを新しく作ったときだけ、NoteDeck が組んだ文脈
/// (skill / デバイスの状況) とそれまでの会話を前置きにする。以後は最新の入力だけ
pub fn compose_prompt(messages: &[AiChatMessage], system: Option<&str>, fresh: bool) -> String {
    let last_user = messages
        .iter()
        .rev()
        .find(|m| matches!(m.role, AiChatRole::User))
        .map(|m| m.content.clone())
        .unwrap_or_default();
    if !fresh {
        return last_user;
    }
    let mut out = String::new();
    // system は notemaid が組んだもの (人格 / 記憶 / skill / <notedeck-context>) なので
    // そのまま先頭に置く (文脈タグで包み直さない、#1162)
    if let Some(sys) = system.filter(|s| !s.trim().is_empty()) {
        out.push_str(sys.trim());
        out.push_str("\n\n");
    }
    let prior: Vec<&AiChatMessage> = messages
        .iter()
        .take(messages.len().saturating_sub(1))
        .filter(|m| !matches!(m.role, AiChatRole::System) && !m.content.trim().is_empty())
        .collect();
    if !prior.is_empty() {
        out.push_str("<conversation-so-far>\n");
        for m in prior {
            let who = match m.role {
                AiChatRole::User => "User",
                AiChatRole::Assistant => "Assistant",
                AiChatRole::System => "System",
            };
            out.push_str(who);
            out.push_str(": ");
            out.push_str(m.content.trim());
            out.push('\n');
        }
        out.push_str("</conversation-so-far>\n\n");
    }
    out.push_str(&last_user);
    out
}

/// `session/update` を表示に写す
pub enum Shown {
    Text(String),
    /// CLI が tool を始めた (結果まで同時に来ていれば `outcome` 付き)
    Call {
        call: ToolCallShown,
        outcome: Option<ToolOutcomeShown>,
    },
    /// tool が終わった
    Result {
        id: String,
        outcome: ToolOutcomeShown,
    },
    Nothing,
}

/// CLI の tool 呼び出し (通常経路の tool_use と同じ欄)
#[derive(Debug, Clone, PartialEq)]
pub struct ToolCallShown {
    pub id: String,
    /// NoteDeck の capability なら通常経路と同じ tool 名 (`notes_search` の形)、
    /// CLI 自身の tool ならその表示名
    pub name: String,
    pub input: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutcomeShown {
    pub text: String,
    pub is_error: bool,
}

/// CLI 側の tool 名が NoteDeck の MCP サーバーの tool なら、その tool 名
/// (`notes_search` の形) を返す。CLI ごとの接頭辞 (Claude Code は
/// `mcp__notedeck__`) を剥がし、宣言表にある capability だけを認める
pub fn notedeck_tool_name(title: &str) -> Option<String> {
    const PREFIXES: &[&str] = &[
        "mcp__notedeck__",
        "notedeck__",
        "notedeck:",
        "notedeck/",
        "notedeck.",
    ];
    let name = PREFIXES.iter().find_map(|p| title.strip_prefix(p))?.trim();
    let id = notecore::capabilities::id_from_tool_name(name);
    notecore::capabilities::find(&id)
        .filter(|d| d.ai_tool)
        .map(|_| name.to_string())
}

fn tool_call_shown(tool: &Value) -> Option<ToolCallShown> {
    let id = tool.get("toolCallId").and_then(Value::as_str)?;
    let title = tool.get("title").and_then(Value::as_str).unwrap_or("tool");
    let name = notedeck_tool_name(title).unwrap_or_else(|| title.to_string());
    let input = match tool.get("rawInput") {
        Some(v @ Value::Object(_)) => v.clone(),
        Some(Value::Null) | None => json!({}),
        Some(other) => json!({ "input": other }),
    };
    Some(ToolCallShown {
        id: id.to_string(),
        name,
        input,
    })
}

/// `content` (ACP の ToolCallContent の列) を本文にする
fn content_text(content: &Value) -> String {
    let Some(items) = content.as_array() else {
        return String::new();
    };
    let parts: Vec<String> = items
        .iter()
        .filter_map(|c| match c.get("type").and_then(Value::as_str) {
            Some("content") => c
                .get("content")
                .and_then(|b| b.get("text"))
                .and_then(Value::as_str)
                .map(str::to_string),
            Some("diff") => c
                .get("path")
                .and_then(Value::as_str)
                .map(|p| format!("(diff) {p}")),
            Some("terminal") => Some("(terminal output)".to_string()),
            _ => None,
        })
        .filter(|t| !t.is_empty())
        .collect();
    parts.join("\n")
}

/// 終わった tool の結果。`status` が completed / failed のときだけ Some
fn tool_outcome(tool: &Value) -> Option<ToolOutcomeShown> {
    let status = tool.get("status").and_then(Value::as_str)?;
    let mut is_error = match status {
        "completed" => false,
        "failed" => true,
        _ => return None,
    };
    let mut text = tool.get("content").map(content_text).unwrap_or_default();
    if text.is_empty() {
        match tool.get("rawOutput") {
            // MCP の tool 結果 (`{ content: [{type: text}], isError }`) はその本文
            Some(raw @ Value::Object(_)) if raw.get("content").is_some() => {
                if raw.get("isError").and_then(Value::as_bool) == Some(true) {
                    is_error = true;
                }
                text = raw
                    .get("content")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|b| b.get("text").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
            }
            Some(Value::String(s)) => text = s.clone(),
            Some(Value::Null) | None => {}
            Some(other) => text = serde_json::to_string_pretty(other).unwrap_or_default(),
        }
    }
    if text.is_empty() {
        text = status.to_string();
    }
    Some(ToolOutcomeShown { text, is_error })
}

pub fn map_update(update: &Value) -> Shown {
    match update.get("sessionUpdate").and_then(Value::as_str) {
        Some("agent_message_chunk") => {
            let text = update
                .get("content")
                .and_then(|c| c.get("text"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if text.is_empty() {
                Shown::Nothing
            } else {
                Shown::Text(text.to_string())
            }
        }
        Some("tool_call") => match tool_call_shown(update) {
            Some(call) => Shown::Call {
                call,
                outcome: tool_outcome(update),
            },
            None => Shown::Nothing,
        },
        Some("tool_call_update") => {
            let id = update.get("toolCallId").and_then(Value::as_str);
            match (id, tool_outcome(update)) {
                (Some(id), Some(outcome)) => Shown::Result {
                    id: id.to_string(),
                    outcome,
                },
                _ => Shown::Nothing,
            }
        }
        _ => Shown::Nothing,
    }
}

/// 許可要求の選択肢から、受諾 / 拒否に当たる optionId を選ぶ
pub fn choose_option(options: &[Value], accepted: bool) -> Option<String> {
    let kind_of = |o: &Value| {
        o.get("kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    let id_of = |o: &Value| {
        o.get("optionId")
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let wanted = if accepted {
        "allow_once"
    } else {
        "reject_once"
    };
    let prefix = if accepted { "allow" } else { "reject" };
    options
        .iter()
        .find(|o| kind_of(o) == wanted)
        .or_else(|| options.iter().find(|o| kind_of(o).starts_with(prefix)))
        .or_else(|| {
            if accepted {
                options.first()
            } else {
                options.last()
            }
        })
        .and_then(id_of)
}

/// 確認ダイアログに出す項目 (デバイスの `AiConfirmRequestPayload` の形)。CLI 自身の
/// tool (ファイル編集 / コマンド実行など) 用で、通常経路の汎用プレビュー
/// (`exec::preview::generic`) と同じ見た目: 誰が何を + 引数の JSON + 「実行」
pub fn permission_items(harness_name: &str, params: &Value) -> Vec<Value> {
    let tool = params.get("toolCall").cloned().unwrap_or(Value::Null);
    let title = tool
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("tool call");
    let raw_input = match tool.get("rawInput") {
        Some(v @ Value::Object(_)) => v.clone(),
        _ => json!({}),
    };
    let mut message = String::new();
    if let Some(kind) = tool.get("kind").and_then(Value::as_str) {
        message.push_str(kind);
    }
    if let Some(locs) = tool.get("locations").and_then(Value::as_array) {
        let paths: Vec<&str> = locs
            .iter()
            .filter_map(|l| l.get("path").and_then(Value::as_str))
            .collect();
        if !paths.is_empty() {
            if !message.is_empty() {
                message.push_str(" · ");
            }
            message.push_str(&paths.join(", "));
        }
    }
    let mut preview = json!({ "type": "danger" });
    if !message.is_empty() {
        preview["message"] = Value::String(message);
    }
    if raw_input.as_object().is_some_and(|o| !o.is_empty()) {
        preview["code"] = json!(serde_json::to_string_pretty(&raw_input).unwrap_or_default());
        preview["codeLanguage"] = json!("json");
    }
    localize_fields(
        &mut preview,
        vec![
            (
                "title",
                i18n_text(
                    "_native.acp.permission.title",
                    json!({ "harness": harness_name, "tool": title }),
                ),
            ),
            (
                "okLabel",
                i18n_text("_native.preview.generic.ok", json!({})),
            ),
            (
                "cancelLabel",
                i18n_text("_native.preview.cancel", json!({})),
            ),
        ],
    );
    vec![json!({
        "toolUseId": tool.get("toolCallId").and_then(Value::as_str).unwrap_or("acp"),
        "capabilityId": "acp.permission",
        "params": raw_input,
        "preview": preview,
        "allowRemember": false,
    })]
}

fn text_event(stream_id: &str, text: String) -> AiChatEvent {
    AiChatEvent {
        stream_id: stream_id.to_string(),
        kind: "delta".into(),
        text: Some(text),
        error: None,
        error_i18n: None,
        tool_use_id: None,
        tool_use_name: None,
        tool_use_input: None,
        usage: None,
        confirm_request_id: None,
        confirm_items: None,
        expires_at_ms: None,
    }
}

/// CLI が tool を始めた (`ai_turn::external` が tool_use のカードにする)
fn tool_call_event(stream_id: &str, call: &ToolCallShown) -> AiChatEvent {
    let mut e = text_event(stream_id, String::new());
    e.kind = "tool_call".into();
    e.text = None;
    e.tool_use_id = Some(call.id.clone());
    e.tool_use_name = Some(call.name.clone());
    e.tool_use_input = Some(call.input.clone());
    e
}

/// tool が終わった (tool_result のカード)。`call` を添えると、tool_call を
/// 見ていない id でもカードを起こせる
fn tool_result_event(
    stream_id: &str,
    id: &str,
    call: Option<&ToolCallShown>,
    outcome: &ToolOutcomeShown,
) -> AiChatEvent {
    let mut e = text_event(stream_id, String::new());
    e.kind = "tool_call_result".into();
    e.tool_use_id = Some(id.to_string());
    if outcome.is_error {
        e.text = None;
        e.error = Some(outcome.text.clone());
    } else {
        e.text = Some(outcome.text.clone());
    }
    if let Some(c) = call {
        e.tool_use_name = Some(c.name.clone());
        e.tool_use_input = Some(c.input.clone());
    }
    e
}

impl crate::ai_turn::ProviderRound for AcpProvider {
    fn protocol(&self) -> notecore::vault::ConnectionProtocol {
        // provider 形式の tool 定義は使わない (CLI が MCP で NoteDeck を呼ぶ)
        notecore::vault::ConnectionProtocol::Anthropic
    }

    fn run<'a>(
        &'a self,
        req: &'a crate::ai_chat_service::AiChatRequest,
        sink: &'a dyn AiChatSink,
    ) -> crate::ai_turn::BoxFuture<'a, Result<(), RoundError>> {
        Box::pin(async move {
            let agent = self.agent().await?;
            let (acp_session, fresh) = self.session_for(&agent, req.session_id.as_deref()).await?;
            let prompt = compose_prompt(&req.messages, req.system.as_deref(), fresh);
            let (mut inbox, reply) = agent
                .prompt(&acp_session, &prompt)
                .await
                .map_err(RoundError::from)?;
            // 中断 (この future が捨てられる) で session/cancel を送る
            let guard = CancelGuard {
                agent: agent.clone(),
                session: acp_session.clone(),
                armed: true,
            };
            let idle = Duration::from_millis(req.read_timeout_ms.unwrap_or(120_000).max(10_000));
            let started = tokio::time::Instant::now();
            let mut reply = reply;
            let result = loop {
                let remaining = TURN_HARD_LIMIT.saturating_sub(started.elapsed());
                if remaining.is_zero() {
                    break Err(RoundError::from(
                        "the CLI turn hit the time limit".to_string(),
                    ));
                }
                tokio::select! {
                    r = &mut reply => {
                        break match r {
                            Ok(Ok(v)) => {
                                let stop = v.get("stopReason").and_then(Value::as_str).unwrap_or("end_turn");
                                if stop == "cancelled" { Err(RoundError::from("cancelled".to_string())) } else { Ok(()) }
                            }
                            Ok(Err(e)) => Err(RoundError::from(e)),
                            Err(_) => Err(RoundError::from(format!("{} stopped answering", self.harness.name))),
                        };
                    }
                    incoming = tokio::time::timeout(idle.min(remaining), inbox.recv()) => {
                        match incoming {
                            Err(_) => break Err(RoundError::from(format!(
                                "{} sent nothing for {} seconds", self.harness.name, idle.as_secs()
                            ))),
                            Ok(None) => break Err(RoundError::from(format!("{} went away", self.harness.name))),
                            Ok(Some(Incoming::Update(u))) => match map_update(&u) {
                                Shown::Text(t) => sink.emit(text_event(&req.stream_id, t)),
                                Shown::Call { call, outcome } => {
                                    sink.emit(tool_call_event(&req.stream_id, &call));
                                    if let Some(outcome) = outcome {
                                        sink.emit(tool_result_event(&req.stream_id, &call.id, None, &outcome));
                                    }
                                }
                                Shown::Result { id, outcome } => {
                                    sink.emit(tool_result_event(&req.stream_id, &id, None, &outcome));
                                }
                                Shown::Nothing => {}
                            },
                            Ok(Some(Incoming::Permission { params, reply: permission_reply })) => {
                                let tool = params.get("toolCall").cloned().unwrap_or(Value::Null);
                                // 保護パスの拒否は tool 名に関わらず最初に効かせる (名前は CLI の申告)
                                let accepted = if touches_protected_paths(&params, &self.workspace) {
                                    // 人格 / 記憶のファイルは CLI からは書かせない (認可と汚染規則を
                                    // 通らないため)。人に聞かずに拒否し、tool の結果として残す (#1162)
                                    let call = tool_call_shown(&tool);
                                    let id = call.as_ref().map(|c| c.id.clone()).unwrap_or_else(|| "acp".into());
                                    sink.emit(tool_result_event(
                                        &req.stream_id,
                                        &id,
                                        call.as_ref(),
                                        &ToolOutcomeShown {
                                            text: "Error (blocked): the AI's personality and memory files are only edited through NoteDeck".into(),
                                            is_error: true,
                                        },
                                    ));
                                    false
                                } else if let Some((capability_id, input)) = notedeck_capability_request(&params) {
                                    // NoteDeck の capability: 権限の判定と確認ダイアログをこの段階で
                                    // NoteDeck 自身に済ませてもらう (#1191)。承認は記録され、直後の
                                    // 同じ tool 呼び出しは確認なしで通る
                                    self.confirm_with_notedeck(&capability_id, input).await
                                } else {
                                    ask_permission(&self.harness.name, &req.stream_id, sink, &params).await
                                };
                                let options = params.get("options").and_then(Value::as_array).cloned().unwrap_or_default();
                                let outcome = match choose_option(&options, accepted) {
                                    Some(option_id) => json!({ "outcome": "selected", "optionId": option_id }),
                                    None => json!({ "outcome": "cancelled" }),
                                };
                                let _ = permission_reply.send(outcome);
                            }
                        }
                    }
                }
            };
            let mut guard = guard;
            guard.armed = false;
            agent.end_prompt(&acp_session);
            result
        })
    }
}

/// 許可要求が NoteDeck の MCP tool へのものなら (capability id, 引数)。ファイルやコマンドに
/// 触る兆候があるものは除く: tool 名は CLI の申告で出自の証明にならないので、名前だけでは
/// NoteDeck の tool と見なさない (ファイル編集などを NoteDeck の tool 名で申告されても
/// CLI の tool として確認を出す)。MCP tool の呼び出しは ACP では `kind: other` (または省略)
/// で、`locations` を持たない。引数は `rawInput` (無ければ空)
pub fn notedeck_capability_request(params: &Value) -> Option<(String, Value)> {
    let tool = params.get("toolCall").cloned().unwrap_or(Value::Null);
    let title = tool.get("title").and_then(Value::as_str).unwrap_or("");
    let name = notedeck_tool_name(title)?;
    let kind_ok = matches!(
        tool.get("kind").and_then(Value::as_str),
        None | Some("other")
    );
    let no_locations = tool
        .get("locations")
        .and_then(Value::as_array)
        .is_none_or(|l| l.is_empty());
    if !(kind_ok && no_locations) {
        return None;
    }
    let input = match tool.get("rawInput") {
        Some(v @ Value::Object(_)) => v.clone(),
        _ => json!({}),
    };
    Some((notecore::capabilities::id_from_tool_name(&name), input))
}

/// 許可要求が人格 / 記憶のファイル (`notemaid/` の中、`workspace/` 以外) に触るか。
/// rawInput の文字列値と locations のパスを見る
pub fn touches_protected_paths(params: &Value, workspace_dir: &std::path::Path) -> bool {
    let Some(protected) = workspace_dir.parent() else {
        return false;
    };
    let protected = protected.to_string_lossy().replace('\\', "/");
    let workspace = workspace_dir.to_string_lossy().replace('\\', "/");
    let mut candidates: Vec<String> = Vec::new();
    let tool = params.get("toolCall").cloned().unwrap_or(Value::Null);
    if let Some(locs) = tool.get("locations").and_then(Value::as_array) {
        candidates.extend(
            locs.iter()
                .filter_map(|l| l.get("path").and_then(Value::as_str))
                .map(str::to_string),
        );
    }
    fn walk(v: &Value, out: &mut Vec<String>) {
        match v {
            Value::String(s) => out.push(s.clone()),
            Value::Array(a) => a.iter().for_each(|x| walk(x, out)),
            Value::Object(o) => o.values().for_each(|x| walk(x, out)),
            _ => {}
        }
    }
    if let Some(raw) = tool.get("rawInput") {
        walk(raw, &mut candidates);
    }
    // パスは文字列の途中にも埋まる (`echo x > <dir>/USER.md` のようなコマンド) ので、
    // 保護された場所が現れる位置ごとに見る
    candidates.iter().any(|c| {
        let p = c.replace('\\', "/");
        p.match_indices(&protected)
            .any(|(i, _)| !p[i..].starts_with(&workspace))
    })
}

/// 許可要求を確認ダイアログに写し、答えを待つ (期限切れは拒否)
async fn ask_permission(
    harness_name: &str,
    stream_id: &str,
    sink: &dyn AiChatSink,
    params: &Value,
) -> bool {
    let turn_id = stream_id.split(':').next().unwrap_or(stream_id);
    let request_id = format!(
        "{turn_id}:acp{}",
        params
            .get("toolCall")
            .and_then(|t| t.get("toolCallId"))
            .and_then(Value::as_str)
            .unwrap_or("0")
    );
    let rx = confirm::live_register(&request_id);
    let mut e = text_event(stream_id, String::new());
    e.kind = "confirm_request".into();
    e.text = None;
    e.confirm_request_id = Some(request_id.clone());
    e.confirm_items = Some(Value::Array(permission_items(harness_name, params)));
    e.expires_at_ms = Some(crate::ai_sessions::now_ms() + PERMISSION_TTL.as_millis() as u64);
    sink.emit(e);
    match tokio::time::timeout(PERMISSION_TTL, rx).await {
        Ok(Ok(accepted)) => accepted,
        _ => {
            confirm::live_forget(&request_id);
            false
        }
    }
}

struct CancelGuard {
    agent: Arc<AcpAgent>,
    session: String,
    armed: bool,
}

impl Drop for CancelGuard {
    fn drop(&mut self) {
        if self.armed {
            let agent = self.agent.clone();
            let session = self.session.clone();
            agent.end_prompt(&session);
            tokio::spawn(async move { agent.cancel(&session).await });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protected_paths_are_the_workspace_parent_except_the_cli_workspace() {
        let ws = std::path::Path::new("/data/notedeck/notemaid/workspace");
        let hit =
            json!({ "toolCall": { "rawInput": { "path": "/data/notedeck/notemaid/USER.md" } } });
        assert!(touches_protected_paths(&hit, ws));
        let via_loc =
            json!({ "toolCall": { "locations": [{ "path": "/data/notedeck/notemaid/SOUL.md" }] } });
        assert!(touches_protected_paths(&via_loc, ws));
        let embedded = json!({ "toolCall": { "rawInput": { "command": "echo hi > /data/notedeck/notemaid/USER.md" } } });
        assert!(touches_protected_paths(&embedded, ws));
        let both = json!({ "toolCall": { "rawInput": { "command": "cp /data/notedeck/notemaid/workspace/a /data/notedeck/notemaid/SOUL.md" } } });
        assert!(touches_protected_paths(&both, ws));
        let inside = json!({ "toolCall": { "rawInput": { "command": "cat /data/notedeck/notemaid/workspace/a.txt" } } });
        assert!(!touches_protected_paths(&inside, ws));
        let ok = json!({ "toolCall": { "rawInput": { "path": "/data/notedeck/notemaid/workspace/notes.txt" } } });
        assert!(!touches_protected_paths(&ok, ws));
        let elsewhere =
            json!({ "toolCall": { "rawInput": { "command": "ls /data/notedeck/skills" } } });
        assert!(!touches_protected_paths(&elsewhere, ws));
    }

    fn msg(role: AiChatRole, content: &str) -> AiChatMessage {
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
    fn fresh_sessions_get_context_and_history_later_prompts_only_the_last_input() {
        let history = vec![
            msg(AiChatRole::User, "hi"),
            msg(AiChatRole::Assistant, "hello"),
            msg(AiChatRole::User, "what's new?"),
        ];
        let fresh = compose_prompt(&history, Some("You are NoteDeck's AI."), true);
        assert!(fresh.starts_with("You are NoteDeck's AI.\n\n"));
        assert!(fresh.contains("User: hi\nAssistant: hello\n"));
        assert!(fresh.ends_with("what's new?"));
        assert_eq!(compose_prompt(&history, Some("sys"), false), "what's new?");
        assert_eq!(compose_prompt(&history[..1], None, true), "hi");
    }

    #[test]
    fn updates_map_to_text_and_tool_cards() {
        let chunk = json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "Hel" } });
        assert!(matches!(map_update(&chunk), Shown::Text(t) if t == "Hel"));
        let tool = json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "title": "Read notes", "kind": "read", "status": "pending", "rawInput": { "path": "/x" } });
        match map_update(&tool) {
            Shown::Call { call, outcome } => {
                assert_eq!(call.id, "c1");
                assert_eq!(call.name, "Read notes");
                assert_eq!(call.input["path"], "/x");
                assert!(outcome.is_none());
            }
            other => panic!("unexpected {}", describe(&other)),
        }
        let thought = json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "hmm" } });
        assert!(matches!(map_update(&thought), Shown::Nothing));
        let progress = json!({ "sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "in_progress" });
        assert!(matches!(map_update(&progress), Shown::Nothing));
        let done = json!({ "sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "completed",
            "content": [{ "type": "content", "content": { "type": "text", "text": "line 1" } }] });
        match map_update(&done) {
            Shown::Result { id, outcome } => {
                assert_eq!(id, "c1");
                assert_eq!(outcome.text, "line 1");
                assert!(!outcome.is_error);
            }
            other => panic!("unexpected {}", describe(&other)),
        }
        let failed =
            json!({ "sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "failed" });
        match map_update(&failed) {
            Shown::Result { outcome, .. } => {
                assert!(outcome.is_error);
                assert_eq!(outcome.text, "failed");
            }
            other => panic!("unexpected {}", describe(&other)),
        }
    }

    fn describe(s: &Shown) -> &'static str {
        match s {
            Shown::Text(_) => "text",
            Shown::Call { .. } => "call",
            Shown::Result { .. } => "result",
            Shown::Nothing => "nothing",
        }
    }

    #[test]
    fn notedeck_mcp_tools_take_the_capability_tool_name() {
        // Claude Code の MCP tool 名 → 通常経路と同じ tool 名 (宣言表にあるものだけ)
        assert_eq!(
            notedeck_tool_name("mcp__notedeck__notes_search").as_deref(),
            Some("notes_search")
        );
        assert_eq!(
            notedeck_tool_name("notedeck:account_list").as_deref(),
            Some("account_list")
        );
        assert_eq!(notedeck_tool_name("mcp__notedeck__nope_nope"), None);
        assert_eq!(notedeck_tool_name("Bash"), None);
        assert_eq!(notedeck_tool_name("mcp__other__notes_search"), None);

        let tool = json!({ "sessionUpdate": "tool_call", "toolCallId": "c2", "title": "mcp__notedeck__notes_search",
            "kind": "other", "status": "completed", "rawInput": { "query": "misskey" },
            "rawOutput": { "content": [{ "type": "text", "text": "{\"notes\":[]}" }] } });
        match map_update(&tool) {
            Shown::Call { call, outcome } => {
                assert_eq!(call.name, "notes_search");
                assert_eq!(call.input["query"], "misskey");
                let outcome = outcome.expect("completed in the same update");
                assert_eq!(outcome.text, "{\"notes\":[]}");
                assert!(!outcome.is_error);
            }
            other => panic!("unexpected {}", describe(&other)),
        }
        let failed = json!({ "sessionUpdate": "tool_call_update", "toolCallId": "c2", "status": "completed",
            "rawOutput": { "content": [{ "type": "text", "text": "permission_denied: no" }], "isError": true } });
        match map_update(&failed) {
            Shown::Result { outcome, .. } => {
                assert!(outcome.is_error);
                assert_eq!(outcome.text, "permission_denied: no");
            }
            other => panic!("unexpected {}", describe(&other)),
        }
    }

    #[test]
    fn only_plain_notedeck_mcp_calls_are_confirmed_by_notedeck() {
        let ask = |tool: Value| notedeck_capability_request(&json!({ "toolCall": tool })).is_some();
        // capability id と引数が取り出せる (直後の MCP 呼び出しと同じ鍵になる)
        let (id, input) = notedeck_capability_request(&json!({ "toolCall": {
            "title": "mcp__notedeck__memory_update", "kind": "other",
            "rawInput": { "action": "add", "target": "user", "content": "x" }
        } }))
        .unwrap();
        assert_eq!(id, "memory.update");
        assert_eq!(input["target"], "user");
        assert!(ask(
            json!({ "title": "mcp__notedeck__notes_search", "kind": "other", "rawInput": { "query": "a" } })
        ));
        assert!(ask(json!({ "title": "mcp__notedeck__account_list" })));
        assert_eq!(
            notedeck_capability_request(
                &json!({ "toolCall": { "title": "mcp__notedeck__account_list" } })
            )
            .unwrap()
            .1,
            json!({})
        );
        // NoteDeck の名前を名乗っても、ファイル / コマンドの兆候があれば聞く
        assert!(!ask(
            json!({ "title": "mcp__notedeck__notes_search", "kind": "edit" })
        ));
        assert!(!ask(
            json!({ "title": "mcp__notedeck__notes_search", "kind": "execute" })
        ));
        assert!(!ask(
            json!({ "title": "mcp__notedeck__notes_search", "kind": "other", "locations": [{ "path": "/x" }] })
        ));
        // NoteDeck 以外の tool は聞く
        assert!(!ask(json!({ "title": "Bash", "kind": "other" })));
        assert!(!ask(
            json!({ "title": "mcp__notedeck__nope_nope", "kind": "other" })
        ));
    }

    #[test]
    fn tool_events_carry_the_turn_shapes() {
        let call = ToolCallShown {
            id: "c1".into(),
            name: "Bash".into(),
            input: json!({ "command": "ls" }),
        };
        let e = tool_call_event("t1:0", &call);
        assert_eq!(e.kind, "tool_call");
        assert_eq!(e.tool_use_id.as_deref(), Some("c1"));
        assert_eq!(e.tool_use_name.as_deref(), Some("Bash"));
        assert_eq!(e.tool_use_input.as_ref().unwrap()["command"], "ls");
        let ok = tool_result_event(
            "t1:0",
            "c1",
            None,
            &ToolOutcomeShown {
                text: "out".into(),
                is_error: false,
            },
        );
        assert_eq!(ok.kind, "tool_call_result");
        assert_eq!(ok.text.as_deref(), Some("out"));
        assert!(ok.error.is_none());
        let bad = tool_result_event(
            "t1:0",
            "c1",
            Some(&call),
            &ToolOutcomeShown {
                text: "boom".into(),
                is_error: true,
            },
        );
        assert!(bad.text.is_none());
        assert_eq!(bad.error.as_deref(), Some("boom"));
        assert_eq!(bad.tool_use_name.as_deref(), Some("Bash"));
    }

    #[test]
    fn permission_options_pick_once_variants_first() {
        let options = json!([
            { "optionId": "always", "name": "Always", "kind": "allow_always" },
            { "optionId": "once", "name": "Once", "kind": "allow_once" },
            { "optionId": "no", "name": "No", "kind": "reject_once" },
        ]);
        let options = options.as_array().unwrap();
        assert_eq!(choose_option(options, true).as_deref(), Some("once"));
        assert_eq!(choose_option(options, false).as_deref(), Some("no"));
        let only_always = json!([{ "optionId": "a", "kind": "allow_always" }, { "optionId": "r", "kind": "reject_always" }]);
        let only_always = only_always.as_array().unwrap();
        assert_eq!(choose_option(only_always, true).as_deref(), Some("a"));
        assert_eq!(choose_option(only_always, false).as_deref(), Some("r"));
        assert_eq!(choose_option(&[], true), None);
    }

    #[test]
    fn permission_items_take_the_generic_preview_shape() {
        let params = json!({
            "sessionId": "s",
            "toolCall": { "toolCallId": "c9", "title": "Write file", "kind": "edit", "rawInput": { "path": "/x" }, "locations": [{ "path": "/x" }] },
            "options": []
        });
        let items = permission_items("Claude Code", &params);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["toolUseId"], "c9");
        assert_eq!(items[0]["capabilityId"], "acp.permission");
        let preview = &items[0]["preview"];
        // 通常経路の汎用プレビューと同じ欄: 英語の正本文 + 表示言語で引き直す手がかり
        assert_eq!(preview["title"], "Claude Code wants to run Write file");
        assert_eq!(
            preview["i18n"]["title"]["key"],
            "_native.acp.permission.title"
        );
        assert_eq!(preview["i18n"]["title"]["params"]["harness"], "Claude Code");
        assert_eq!(preview["i18n"]["title"]["params"]["tool"], "Write file");
        assert_eq!(preview["okLabel"], "Run");
        assert_eq!(
            preview["i18n"]["okLabel"]["key"],
            "_native.preview.generic.ok"
        );
        assert_eq!(
            preview["i18n"]["cancelLabel"]["key"],
            "_native.preview.cancel"
        );
        assert_eq!(preview["type"], "danger");
        assert_eq!(preview["message"], "edit · /x");
        assert_eq!(preview["codeLanguage"], "json");
        assert!(preview["code"]
            .as_str()
            .unwrap()
            .contains("\"path\": \"/x\""));
        assert_eq!(items[0]["allowRemember"], false);
        assert_eq!(items[0]["params"]["path"], "/x");

        // 引数の無い tool はコード欄も message も無い
        let bare = json!({ "toolCall": { "toolCallId": "c1", "title": "ToolSearch" } });
        let items = permission_items("Claude Code", &bare);
        assert!(items[0]["preview"].get("code").is_none());
        assert!(items[0]["preview"].get("message").is_none());
    }
}
