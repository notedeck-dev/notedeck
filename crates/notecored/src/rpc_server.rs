//! RPC 面 (Unix socket、#1106 §4.3)。接続ごとに所有者 (uid) を照合し、起動毎の秘密を
//! hello で渡す。要求はコマンド表の JSON アダプタに流し、notecore のイベントは
//! 全セッションに押し出す。

use std::collections::HashMap;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notecore::commands::{self, CallContext};
use notecore::context::Core;
use notecore::frontend_bridge::{BridgeFuture, FrontendBridge};
use notecore::rpc::{BatchItem, Frame, Outcome, RpcError, SELF_PREFIX};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, oneshot};

use crate::sinks::Events;

pub use notecore::rpc::default_socket_path;

pub type StatusFn = Arc<dyn Fn() -> Value + Send + Sync>;

type QueryReply = oneshot::Sender<Result<Value, String>>;
type PendingQuery = (u64, QueryReply);

/// セッションが開いた購読 (仕様 §4.4: 購読はデバイスセッションの所有物。切断で回収する)
#[derive(Default, Debug, Clone, PartialEq)]
pub struct Owned {
    /// `query_subscribe_*` が返した query id (同じ id を複数回開いた分だけ数える)
    pub queries: Vec<String>,
    /// `stream_sub_note` の (account_id, note_id)
    pub captures: Vec<(String, String)>,
    /// `stream_observe_start` で開いた観測の数 (Stream Inspector)
    pub observing: u32,
}

/// 接続中のセッション (橋の問い合わせを投げる相手)。最後に繋いだセッションを優先する
#[derive(Default)]
pub struct Sessions {
    next_session: AtomicU64,
    next_query: AtomicU64,
    /// session id → 書き手
    live: Mutex<Vec<(u64, mpsc::Sender<Frame>)>>,
    /// query id → (session id, 応答の受け口)
    pending: Mutex<HashMap<u64, PendingQuery>>,
    /// session id → 開いている購読
    owned: Mutex<HashMap<u64, Owned>>,
}

impl Sessions {
    fn register(&self, tx: mpsc::Sender<Frame>) -> u64 {
        let id = self.next_session.fetch_add(1, Ordering::Relaxed) + 1;
        self.live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((id, tx));
        id
    }

    /// 要求の名前と結果から、このセッションの購読の帳簿を更新する
    pub fn record(&self, session: u64, name: &str, params: &Value, outcome: &Outcome) {
        if !outcome.ok {
            return;
        }
        let mut owned = self.owned.lock().unwrap_or_else(|e| e.into_inner());
        let entry = owned.entry(session).or_default();
        let s = |k: &str| {
            params
                .get(k)
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string()
        };
        if name.starts_with("query_subscribe_") {
            if let Some(qid) = outcome
                .result
                .as_ref()
                .and_then(|r| r.get("queryId"))
                .and_then(Value::as_str)
            {
                entry.queries.push(qid.to_string());
            }
        } else if name == "query_close" {
            let qid = s("queryId");
            if let Some(i) = entry.queries.iter().position(|q| *q == qid) {
                entry.queries.remove(i);
            }
        } else if name == "stream_sub_note" {
            entry.captures.push((s("accountId"), s("noteId")));
        } else if name == "stream_unsub_note" {
            let key = (s("accountId"), s("noteId"));
            if let Some(i) = entry.captures.iter().position(|c| *c == key) {
                entry.captures.remove(i);
            }
        } else if name == "stream_observe_start" {
            entry.observing += 1;
        } else if name == "stream_observe_stop" {
            entry.observing = entry.observing.saturating_sub(1);
        }
    }

    #[cfg(test)]
    pub fn owned_by(&self, session: u64) -> Owned {
        self.owned
            .lock()
            .ok()
            .and_then(|o| o.get(&session).cloned())
            .unwrap_or_default()
    }

    /// セッションを外し、開いたままの購読を返す (呼び出し側が閉じる)
    fn unregister(&self, id: u64) -> Owned {
        let owned = self
            .owned
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id)
            .unwrap_or_default();
        self.live
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|(sid, _)| *sid != id);
        let dead: Vec<QueryReply> = {
            let mut p = self.pending.lock().unwrap_or_else(|e| e.into_inner());
            let ids: Vec<u64> = p
                .iter()
                .filter(|(_, (sid, _))| *sid == id)
                .map(|(qid, _)| *qid)
                .collect();
            ids.into_iter()
                .filter_map(|qid| p.remove(&qid))
                .map(|(_, tx)| tx)
                .collect()
        };
        for tx in dead {
            let _ = tx.send(Err("device disconnected".into()));
        }
        owned
    }

    pub fn count(&self) -> usize {
        self.live.lock().map(|l| l.len()).unwrap_or(0)
    }

    fn answer(&self, id: u64, result: Result<Value, String>) {
        let tx = self
            .pending
            .lock()
            .ok()
            .and_then(|mut p| p.remove(&id))
            .map(|(_, tx)| tx);
        if let Some(tx) = tx {
            let _ = tx.send(result);
        }
    }

    /// 最後に繋いだセッションに問い合わせて答えを待つ。居なければ Err
    pub async fn query(
        &self,
        query_type: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let (sid, tx) = self
            .live
            .lock()
            .ok()
            .and_then(|l| l.last().cloned())
            .ok_or_else(|| format!("no device is connected (query {query_type})"))?;
        let id = self.next_query.fetch_add(1, Ordering::Relaxed) + 1;
        let (reply_tx, reply_rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, (sid, reply_tx));
        let frame = Frame::Query {
            id,
            query_type: query_type.to_string(),
            params,
            timeout_ms: timeout.as_millis() as u64,
        };
        if tx.send(frame).await.is_err() {
            self.pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            return Err("device session is closing".into());
        }
        match tokio::time::timeout(timeout, reply_rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("device disconnected".into()),
            Err(_) => {
                self.pending
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .remove(&id);
                Err("Query timed out".into())
            }
        }
    }
}

/// notecore の橋を接続中のセッションに繋ぐ (仕様 §4.4)。端末が居なければ Err で、
/// ターン実行器は core の capability の確認内容を自分で組み、端末依存の capability を
/// device_unavailable で返す
pub struct SessionBridge(pub Arc<Sessions>);

impl FrontendBridge for SessionBridge {
    fn query<'a>(
        &'a self,
        query_type: &'a str,
        params: Value,
        timeout: Duration,
    ) -> BridgeFuture<'a> {
        Box::pin(self.0.query(query_type, params, timeout))
    }

    fn health_report(&self) -> BridgeFuture<'_> {
        Box::pin(async { Ok(Value::Null) })
    }
}

pub struct RpcServer {
    pub core: Arc<Core>,
    pub events: Events,
    pub secret: String,
    pub socket: PathBuf,
    pub status: StatusFn,
    pub sessions: Arc<Sessions>,
}

impl RpcServer {
    /// 置き場を用意して bind する。残骸の socket は繋がらなければ消す
    pub async fn bind(&self) -> std::io::Result<UnixListener> {
        if let Some(dir) = self.socket.parent() {
            std::fs::create_dir_all(dir)?;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        if self.socket.exists() {
            if UnixStream::connect(&self.socket).await.is_ok() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AddrInUse,
                    "another notecored is answering on the socket",
                ));
            }
            std::fs::remove_file(&self.socket)?;
        }
        let listener = UnixListener::bind(&self.socket)?;
        std::fs::set_permissions(&self.socket, std::fs::Permissions::from_mode(0o600))?;
        Ok(listener)
    }

    pub async fn serve(
        self: Arc<Self>,
        listener: UnixListener,
        shutdown: notecore::shutdown::ShutdownToken,
    ) {
        loop {
            let accepted = tokio::select! {
                _ = shutdown.clone().cancelled() => break,
                r = listener.accept() => r,
            };
            match accepted {
                Ok((stream, _)) => {
                    let server = self.clone();
                    tokio::spawn(async move { server.session(stream).await });
                }
                Err(e) => {
                    tracing::warn!("[rpc] accept failed: {e}");
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
        let _ = std::fs::remove_file(&self.socket);
    }

    async fn session(self: Arc<Self>, stream: UnixStream) {
        // 所有者の照合: 同じ uid だけ (仕様 §4.3)
        match stream.peer_cred() {
            Ok(cred) if cred.uid() == unsafe { libc::getuid() } => {}
            Ok(cred) => {
                tracing::warn!(
                    uid = cred.uid(),
                    "[rpc] refused connection from another uid"
                );
                return;
            }
            Err(e) => {
                tracing::warn!("[rpc] peer credentials unavailable: {e}");
                return;
            }
        }
        let (reader, mut writer) = stream.into_split();
        let (tx, mut rx) = mpsc::channel::<Frame>(1024);
        let session_id = self.sessions.register(tx.clone());
        let hello = Frame::Hello {
            protocol: notecore::rpc::PROTOCOL_VERSION,
            secret: self.secret.clone(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            fingerprint: notecore::rpc::manifest_fingerprint(),
        };
        if tx.send(hello).await.is_err() {
            return;
        }
        // 書き手: 応答とイベントを 1 本に。イベントにはセッション単位の連番を振る
        let mut events = self.events.0.subscribe();
        let writer_task = tokio::spawn(async move {
            let mut next_seq: u64 = 0;
            loop {
                let frame = tokio::select! {
                    f = rx.recv() => match f { Some(f) => f, None => break },
                    e = events.recv() => match e {
                        Ok(mut f) => {
                            if let Frame::Event { seq, .. } = &mut f {
                                next_seq += 1;
                                *seq = next_seq;
                            }
                            f
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!(dropped = n, "[rpc] session lagged; events dropped");
                            continue;
                        }
                        Err(_) => break,
                    },
                };
                let mut line = match serde_json::to_string(&frame) {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                line.push('\n');
                if writer.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
            }
        });
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let frame: Frame = match serde_json::from_str(&line) {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!("[rpc] bad frame: {e}");
                    continue;
                }
            };
            if let Frame::QueryResponse { id, result, error } = frame {
                self.sessions.answer(
                    id,
                    error
                        .map(Err)
                        .unwrap_or_else(|| Ok(result.unwrap_or(Value::Null))),
                );
                continue;
            }
            let server = self.clone();
            let tx = tx.clone();
            tokio::spawn(async move {
                if let Some(reply) = server.handle(session_id, frame).await {
                    let _ = tx.send(reply).await;
                }
            });
        }
        drop(tx);
        // 購読はセッションの所有物: 切断で回収する (仕様 §4.4)
        let owned = self.sessions.unregister(session_id);
        for qid in owned.queries {
            if let Err(e) = commands::query::query_close(&self.core, qid.clone()).await {
                tracing::warn!(query = qid, "[rpc] close on disconnect failed: {e}");
            }
        }
        for (account_id, note_id) in owned.captures {
            let _ = commands::streaming::stream_unsub_note(&self.core, account_id, note_id).await;
        }
        for _ in 0..owned.observing {
            let _ = commands::streaming::stream_observe_stop(&self.core).await;
        }
        let _ = writer_task.await;
    }

    async fn handle(&self, session_id: u64, frame: Frame) -> Option<Frame> {
        match frame {
            Frame::Request {
                id,
                secret,
                name,
                params,
                window,
            } => {
                let outcome = if secret != self.secret {
                    Outcome::failure(unauthorized())
                } else {
                    let outcome = self.call(&name, params.clone(), window).await;
                    self.sessions.record(session_id, &name, &params, &outcome);
                    outcome
                };
                Some(Frame::Response { id, outcome })
            }
            Frame::Batch { id, secret, items } => {
                let outcome = if secret != self.secret {
                    Outcome::failure(unauthorized())
                } else {
                    let mut results = Vec::with_capacity(items.len());
                    for BatchItem {
                        name,
                        params,
                        window,
                    } in items
                    {
                        let outcome = self.call(&name, params.clone(), window).await;
                        self.sessions.record(session_id, &name, &params, &outcome);
                        results.push(outcome);
                    }
                    Outcome::success(serde_json::to_value(results).unwrap_or(Value::Null))
                };
                Some(Frame::Response { id, outcome })
            }
            _ => None,
        }
    }

    async fn call(&self, name: &str, params: Value, window: Option<String>) -> Outcome {
        if let Some(own) = name.strip_prefix(SELF_PREFIX) {
            return match own {
                "status" => Outcome::success((self.status)()),
                "ping" => Outcome::success(json!({ "pong": true })),
                // 接続中の端末に橋の問い合わせが届くかの検査 (受け入れ試験と診断用)
                "probe-device" => match self
                    .sessions
                    .query("notecored/probe", params, Duration::from_secs(5))
                    .await
                {
                    Ok(v) => Outcome::success(v),
                    Err(e) => Outcome::failure(RpcError {
                        code: "NO_CONNECTION".into(),
                        message: e,
                        i18n: None,
                    }),
                },
                _ => Outcome::failure(RpcError {
                    code: "INVALID_INPUT".into(),
                    message: format!("unknown daemon request: {name}"),
                    i18n: None,
                }),
            };
        }
        let ctx = CallContext { window };
        // データ系は notecore の表、AI 系は notemaid の表 (#1106)
        let dispatched = if commands::CommandId::parse(name).is_some() {
            commands::dispatch(&self.core, &ctx, name, params).await
        } else {
            notemaid::commands::dispatch(&self.core, &ctx, name, params).await
        };
        match dispatched {
            Ok(v) => Outcome::success(v),
            Err(e) => Outcome::failure(RpcError::from(&e)),
        }
    }
}

fn unauthorized() -> RpcError {
    RpcError {
        code: "UNAUTHORIZED".into(),
        message: "secret does not match this notecored".into(),
        i18n: None,
    }
}

/// 起動毎の秘密 (hello で渡す)
pub fn new_secret() -> String {
    rand::random::<[u8; 32]>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sessions_keep_their_subscriptions_until_unregistered() {
        let sessions = Sessions::default();
        let (tx, _rx) = mpsc::channel::<Frame>(4);
        let a = sessions.register(tx.clone());
        let b = sessions.register(tx);
        let opened = Outcome::success(json!({ "queryId": "q:1" }));
        sessions.record(
            a,
            "query_subscribe_timeline",
            &json!({ "accountId": "x" }),
            &opened,
        );
        sessions.record(
            a,
            "query_subscribe_timeline",
            &json!({ "accountId": "x" }),
            &opened,
        );
        sessions.record(
            b,
            "query_subscribe_timeline",
            &json!({ "accountId": "x" }),
            &opened,
        );
        sessions.record(
            a,
            "stream_sub_note",
            &json!({ "accountId": "x", "noteId": "n1" }),
            &Outcome::success(Value::Null),
        );
        // 失敗した要求は数えない
        sessions.record(
            a,
            "query_subscribe_antenna",
            &json!({}),
            &Outcome::failure(unauthorized()),
        );
        assert_eq!(sessions.owned_by(a).queries, vec!["q:1", "q:1"]);
        sessions.record(
            a,
            "query_close",
            &json!({ "queryId": "q:1" }),
            &Outcome::success(Value::Null),
        );
        assert_eq!(sessions.owned_by(a).queries, vec!["q:1"]);
        assert_eq!(
            sessions.owned_by(a).captures,
            vec![("x".to_string(), "n1".to_string())]
        );
        sessions.record(
            a,
            "stream_observe_start",
            &json!({}),
            &Outcome::success(Value::Null),
        );
        sessions.record(
            b,
            "stream_observe_stop",
            &json!({}),
            &Outcome::success(Value::Null),
        );
        assert_eq!(sessions.owned_by(b).observing, 0);
        assert_eq!(sessions.count(), 2);
        let owned = sessions.unregister(a);
        assert_eq!(owned.queries, vec!["q:1"]);
        assert_eq!(owned.captures.len(), 1);
        assert_eq!(owned.observing, 1);
        assert_eq!(sessions.count(), 1);
        assert_eq!(sessions.owned_by(b).queries, vec!["q:1"]);
        assert_eq!(sessions.owned_by(a), Owned::default());
    }
}
