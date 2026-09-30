//! ACP (Agent Client Protocol) のクライアント (#1104): エージェントを子プロセスとして起動し、
//! stdio の改行区切り JSON-RPC 2.0 で話す。
//!
//! - こちらから: `initialize` / `session/new` / `session/prompt` / `session/cancel` (通知)
//! - 向こうから: `session/update` (通知) と `session/request_permission` (要求)。fs / terminal は
//!   `clientCapabilities` で持たないと申告し、来ても method not found で断る
//! - 1 プロセスに複数の ACP セッションを持てる。NoteDeck のセッションごとに 1 つ作る
//! - プロセスの stderr はエージェントのログなので tracing に流すだけ

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot};

use super::harness::HarnessInfo;

pub const PROTOCOL_VERSION: u64 = 1;
const METHOD_NOT_FOUND: i64 = -32601;
/// 起動 (initialize の往復) の上限。npx の初回はパッケージ取得で時間がかかる
const INITIALIZE_TIMEOUT: Duration = Duration::from_secs(120);
const SESSION_NEW_TIMEOUT: Duration = Duration::from_secs(60);
/// ACP の「認証が要る」エラー
const AUTH_REQUIRED: i64 = -32000;
/// そのエラーを文字列で運ぶときの印 (provider が利用者向けの文に直す)
pub const AUTH_REQUIRED_PREFIX: &str = "auth_required: ";

/// 進行中の prompt が受け取るもの (更新は通知、許可要求は答えを要求する)
pub enum Incoming {
    Update(Value),
    /// `session/request_permission`。`reply` に `outcome` を返す
    Permission {
        params: Value,
        reply: oneshot::Sender<Value>,
    },
}

type Inbox = mpsc::UnboundedSender<Incoming>;
type Reply = oneshot::Sender<Result<Value, String>>;

pub struct AcpAgent {
    pub harness: HarnessInfo,
    child: Mutex<Option<Child>>,
    stdin: tokio::sync::Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, Reply>>,
    /// ACP セッション id → 進行中の prompt の受け口
    inboxes: Mutex<HashMap<String, Inbox>>,
    alive: Arc<AtomicBool>,
    /// initialize の結果 (agentInfo / authMethods)
    pub info: Mutex<Value>,
}

impl AcpAgent {
    /// 起動して initialize まで済ませる
    pub async fn spawn(harness: HarnessInfo, cwd: &std::path::Path) -> Result<Arc<Self>, String> {
        let mut cmd = Command::new(&harness.command);
        cmd.args(&harness.args)
            .current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("cannot start {} ({}): {e}", harness.name, harness.command))?;
        let stdin = child.stdin.take().ok_or("agent stdin is not piped")?;
        let stdout = child.stdout.take().ok_or("agent stdout is not piped")?;
        let stderr = child.stderr.take();
        let agent = Arc::new(Self {
            harness,
            child: Mutex::new(Some(child)),
            stdin: tokio::sync::Mutex::new(stdin),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            inboxes: Mutex::new(HashMap::new()),
            alive: Arc::new(AtomicBool::new(true)),
            info: Mutex::new(Value::Null),
        });
        if let Some(stderr) = stderr {
            let name = agent.harness.name.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    tracing::debug!(agent = %name, "{l}");
                }
            });
        }
        {
            let me = Arc::downgrade(&agent);
            let alive = agent.alive.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let Some(agent) = me.upgrade() else { break };
                    agent.on_line(&line).await;
                }
                alive.store(false, Ordering::Release);
                if let Some(agent) = me.upgrade() {
                    agent.fail_all("the agent process exited");
                }
            });
        }
        let init = agent
            .request(
                "initialize",
                json!({
                    "protocolVersion": PROTOCOL_VERSION,
                    "clientCapabilities": {
                        "fs": { "readTextFile": false, "writeTextFile": false },
                        "terminal": false,
                    },
                    "clientInfo": {
                        "name": "notedeck",
                        "title": "NoteDeck",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                }),
                INITIALIZE_TIMEOUT,
            )
            .await?;
        let version = init.get("protocolVersion").and_then(Value::as_u64);
        if version != Some(PROTOCOL_VERSION) {
            agent.shutdown();
            return Err(format!(
                "{} speaks ACP version {version:?}; NoteDeck needs {PROTOCOL_VERSION}",
                agent.harness.name
            ));
        }
        *agent.info.lock().unwrap_or_else(|e| e.into_inner()) = init;
        Ok(agent)
    }

    pub fn is_alive(&self) -> bool {
        if !self.alive.load(Ordering::Acquire) {
            return false;
        }
        let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut().map(|c| c.try_wait()) {
            Some(Ok(None)) => true,
            _ => {
                self.alive.store(false, Ordering::Release);
                false
            }
        }
    }

    /// NoteDeck の MCP サーバーを渡してセッションを作る。戻り値は ACP のセッション id
    pub async fn new_session(
        &self,
        cwd: &std::path::Path,
        mcp: Option<Value>,
    ) -> Result<String, String> {
        let servers: Vec<Value> = mcp.into_iter().collect();
        let r = self
            .request(
                "session/new",
                json!({ "cwd": cwd.display().to_string(), "mcpServers": servers }),
                SESSION_NEW_TIMEOUT,
            )
            .await?;
        r.get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "session/new returned no sessionId".into())
    }

    /// prompt を送り、更新の届け先を登録する。応答 (stopReason) は 2 つ目の receiver に届く
    pub async fn prompt(
        &self,
        session_id: &str,
        text: &str,
    ) -> Result<
        (
            mpsc::UnboundedReceiver<Incoming>,
            oneshot::Receiver<Result<Value, String>>,
        ),
        String,
    > {
        let (tx, rx) = mpsc::unbounded_channel();
        self.inboxes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session_id.to_string(), tx);
        let reply = self
            .send_request(
                "session/prompt",
                json!({ "sessionId": session_id, "prompt": [{ "type": "text", "text": text }] }),
            )
            .await?;
        Ok((rx, reply))
    }

    pub fn end_prompt(&self, session_id: &str) {
        self.inboxes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(session_id);
    }

    pub async fn cancel(&self, session_id: &str) {
        let _ = self
            .write_line(&json!({
                "jsonrpc": "2.0", "method": "session/cancel",
                "params": { "sessionId": session_id }
            }))
            .await;
    }

    /// 終わらせる (待たない)
    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        if let Some(mut child) = self.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = child.start_kill();
        }
        self.fail_all("the agent was shut down");
    }

    // --- JSON-RPC の配管 ---

    async fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let rx = self.send_request(method, params).await?;
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err(format!("{method}: the agent went away")),
            Err(_) => Err(format!(
                "{method}: no answer within {} seconds",
                timeout.as_secs()
            )),
        }
    }

    async fn send_request(
        &self,
        method: &str,
        params: Value,
    ) -> Result<oneshot::Receiver<Result<Value, String>>, String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("the agent is not running".into());
        }
        let (tx, rx) = oneshot::channel();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
        let frame = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(e) = self.write_line(&frame).await {
            self.pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            return Err(e);
        }
        Ok(rx)
    }

    async fn on_line(&self, line: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            tracing::warn!(agent = %self.harness.name, "non-JSON line on stdout: {line}");
            return;
        };
        let method = msg.get("method").and_then(Value::as_str);
        let id = msg.get("id").cloned();
        match (method, id) {
            // 応答
            (None, Some(id)) => {
                let Some(id) = id.as_u64() else { return };
                let tx = self
                    .pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                if let Some(tx) = tx {
                    let outcome = if let Some(err) = msg.get("error") {
                        let text = err
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("agent error");
                        // ACP の auth_required。authMethods の申告はログイン済みでも来るので、
                        // 要るかどうかはこのエラーで判断する
                        Err(
                            if err.get("code").and_then(Value::as_i64) == Some(AUTH_REQUIRED) {
                                format!("{AUTH_REQUIRED_PREFIX}{text}")
                            } else {
                                text.to_string()
                            },
                        )
                    } else {
                        Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                    };
                    let _ = tx.send(outcome);
                }
            }
            // 通知
            (Some("session/update"), None) => {
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                let sid = params
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let inbox = self
                    .inboxes
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(sid)
                    .cloned();
                if let Some(inbox) = inbox {
                    let _ = inbox.send(Incoming::Update(
                        params.get("update").cloned().unwrap_or(Value::Null),
                    ));
                }
            }
            (Some(_), None) => {}
            // 向こうからの要求
            (Some(m), Some(id)) => {
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                if m == "session/request_permission" {
                    let sid = params
                        .get("sessionId")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let inbox = self
                        .inboxes
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .get(sid)
                        .cloned();
                    let (reply_tx, reply_rx) = oneshot::channel();
                    let delivered = inbox
                        .map(|i| {
                            i.send(Incoming::Permission {
                                params,
                                reply: reply_tx,
                            })
                            .is_ok()
                        })
                        .unwrap_or(false);
                    let outcome = if delivered {
                        reply_rx
                            .await
                            .unwrap_or_else(|_| json!({ "outcome": "cancelled" }))
                    } else {
                        json!({ "outcome": "cancelled" })
                    };
                    let _ = self
                        .write_line(&json!({
                            "jsonrpc": "2.0", "id": id, "result": { "outcome": outcome }
                        }))
                        .await;
                } else {
                    // fs / terminal / elicitation: 持っていない
                    let _ = self
                        .write_line(&json!({
                            "jsonrpc": "2.0", "id": id,
                            "error": {
                                "code": METHOD_NOT_FOUND,
                                "message": format!("NoteDeck does not provide {m}"),
                            }
                        }))
                        .await;
                }
            }
            (None, None) => {}
        }
    }

    async fn write_line(&self, frame: &Value) -> Result<(), String> {
        let mut line = frame.to_string();
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| format!("write to agent: {e}"))?;
        stdin
            .flush()
            .await
            .map_err(|e| format!("flush to agent: {e}"))
    }

    fn fail_all(&self, reason: &str) {
        let pending: Vec<Reply> = self
            .pending
            .lock()
            .map(|mut p| p.drain().map(|(_, tx)| tx).collect())
            .unwrap_or_default();
        for tx in pending {
            let _ = tx.send(Err(reason.to_string()));
        }
        self.inboxes
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }
}

#[cfg(test)]
mod live {
    //! 手元に `claude` がある環境でだけ手で回す (CLI の契約を 1 リクエスト使う):
    //! `cargo test -p notemaid acp::client::live -- --ignored --nocapture`
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn claude_code_answers_one_prompt_over_acp() {
        let Some(h) = crate::acp::harness::find(&[], "claude-code") else {
            return;
        };
        if !h.available {
            eprintln!("skip: {:?}", h.detail);
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let agent = AcpAgent::spawn(h, dir.path()).await.expect("spawn");
        eprintln!("initialize -> {}", agent.info.lock().unwrap());
        let sid = agent
            .new_session(dir.path(), None)
            .await
            .expect("session/new");
        let (mut rx, reply) = agent
            .prompt(&sid, "Reply with exactly the word pong and nothing else.")
            .await
            .expect("prompt");
        let mut text = String::new();
        let mut reply = std::pin::pin!(reply);
        let stop = loop {
            tokio::select! {
                r = &mut reply => break r.expect("channel").expect("prompt failed"),
                Some(inc) = rx.recv() => match inc {
                    Incoming::Update(u) => {
                        if let crate::acp::provider::Shown::Text(t) = crate::acp::provider::map_update(&u) {
                            text.push_str(&t);
                        }
                    }
                    Incoming::Permission { reply, .. } => {
                        let _ = reply.send(json!({ "outcome": { "outcome": "cancelled" } }));
                    }
                },
            }
        };
        agent.end_prompt(&sid);
        eprintln!("stop = {stop}, text = {text:?}");
        assert_eq!(
            stop.get("stopReason").and_then(Value::as_str),
            Some("end_turn")
        );
        assert!(text.to_lowercase().contains("pong"));
        agent.shutdown();
    }
}
