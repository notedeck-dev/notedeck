//! 手元の CLI を provider として使う (#1104)。ターン実行器から見ると 1 ラウンド = CLI の 1 ターン。
//! ツールのループは CLI の中で回る (NoteDeck の capability は MCP サーバー越し) ので、
//! こちらは本文の断片を流し、ツールの動きを 1 行ずつ添え、許可要求を確認ダイアログに写すだけ。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notecore::frontend_bridge::FrontendBridge;
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
    /// harness id → NoteDeck の MCP サーバーに渡した永続トークン (id)。終了時に失効させる
    tokens: Mutex<HashMap<String, String>>,
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
            .map(|mut t| t.drain().map(|(_, v)| v).collect())
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
    /// トークンは harness ごとに 1 つ発行して覚え、終了時に失効させる
    async fn mcp_server(&self) -> Option<Value> {
        let url = self.mcp_url.clone()?;
        let issued = self
            .bridge
            .issue_external_token(format!("AI harness: {}", self.harness.name))
            .await;
        let issued = match issued {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(harness = %self.harness.id, "cannot issue an MCP token: {e}");
                return None;
            }
        };
        let token = issued.get("token").and_then(Value::as_str)?.to_string();
        if let Some(id) = issued.get("id").and_then(Value::as_str) {
            self.registry
                .tokens
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(self.harness.id.clone(), id.to_string());
        }
        Some(json!({
            "type": "http",
            "name": "notedeck",
            "url": url,
            "headers": [{ "name": "Authorization", "value": format!("Bearer {token}") }],
        }))
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
    /// 新しいツール呼び出し (1 行で添える)
    Tool(String),
    Nothing,
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
        Some("tool_call") => {
            let title = update
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            Shown::Tool(title.to_string())
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

/// 確認ダイアログに出す項目 (デバイスの `AiConfirmRequestPayload` の形)
pub fn permission_items(harness_name: &str, params: &Value) -> Vec<Value> {
    let tool = params.get("toolCall").cloned().unwrap_or(Value::Null);
    let title = tool
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("tool call");
    let raw_input = tool.get("rawInput").cloned().unwrap_or(json!({}));
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
    vec![json!({
        "toolUseId": tool.get("toolCallId").and_then(Value::as_str).unwrap_or("acp"),
        "capabilityId": "acp.permission",
        "params": raw_input,
        "preview": {
            "title": format!("{harness_name}: {title}"),
            "message": if message.is_empty() { Value::Null } else { Value::String(message) },
        },
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
                                Shown::Tool(title) => sink.emit(text_event(&req.stream_id, format!("\n> 🔧 {title}\n"))),
                                Shown::Nothing => {}
                            },
                            Ok(Some(Incoming::Permission { params, reply: permission_reply })) => {
                                // 人格 / 記憶のファイルは CLI からは書かせない (認可と汚染規則を通らないため)。
                                // 人に聞かずに拒否し、本文に一行残す (#1162)
                                let accepted = if touches_protected_paths(&params, &self.workspace) {
                                    sink.emit(text_event(
                                        &req.stream_id,
                                        "\n> ⛔ blocked: the AI's personality and memory files are only edited through NoteDeck\n".into(),
                                    ));
                                    false
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
    candidates.iter().any(|c| {
        let p = c.replace('\\', "/");
        p.starts_with(&protected) && !p.starts_with(&workspace)
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
    fn updates_map_to_text_and_tool_lines() {
        let chunk = json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": "Hel" } });
        assert!(matches!(map_update(&chunk), Shown::Text(t) if t == "Hel"));
        let tool = json!({ "sessionUpdate": "tool_call", "toolCallId": "c1", "title": "Read notes", "kind": "read", "status": "pending" });
        assert!(matches!(map_update(&tool), Shown::Tool(t) if t == "Read notes"));
        let thought = json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": "hmm" } });
        assert!(matches!(map_update(&thought), Shown::Nothing));
        let progress = json!({ "sessionUpdate": "tool_call_update", "toolCallId": "c1", "status": "completed" });
        assert!(matches!(map_update(&progress), Shown::Nothing));
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
    fn permission_items_take_the_dialog_shape() {
        let params = json!({
            "sessionId": "s",
            "toolCall": { "toolCallId": "c9", "title": "Write file", "kind": "edit", "rawInput": { "path": "/x" }, "locations": [{ "path": "/x" }] },
            "options": []
        });
        let items = permission_items("Claude Code", &params);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["toolUseId"], "c9");
        assert_eq!(items[0]["preview"]["title"], "Claude Code: Write file");
        assert_eq!(items[0]["preview"]["message"], "edit · /x");
        assert_eq!(items[0]["allowRemember"], false);
        assert_eq!(items[0]["params"]["path"], "/x");
    }
}
