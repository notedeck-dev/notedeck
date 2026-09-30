//! RPC 面 (Unix socket / named pipe、#1106 §4.3)。接続ごとに所有者を照合し、起動毎の秘密を
//! hello で渡す。要求はコマンド表の JSON アダプタに流し、notecore のイベントは
//! 全セッションに押し出す。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notecore::commands::CallContext;
use notecore::context::Core;
use notecore::frontend_bridge::{ArchiveSearchRequest, BridgeFuture, FrontendBridge};
use notecore::rpc::{Frame, Outcome, RpcError, SELF_PREFIX};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

use crate::daemon::sinks::Events;
use crate::transport::{self, Endpoint, Listener, Peer, Stream};

pub type StatusFn = Arc<dyn Fn() -> Value + Send + Sync>;

type QueryReply = oneshot::Sender<Result<Value, String>>;
type PendingQuery = (u64, QueryReply);

/// 接続中のセッション (橋の問い合わせを投げる相手)。最後に繋いだセッションを優先する
#[derive(Default)]
pub struct Sessions {
    next_session: AtomicU64,
    next_query: AtomicU64,
    /// session id → 書き手
    live: Mutex<Vec<(u64, mpsc::Sender<Frame>)>>,
    /// query id → (session id, 応答の受け口)
    pending: Mutex<HashMap<u64, PendingQuery>>,
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

    /// セッションを外し、答え待ちの橋の問い合わせを失敗で閉じる
    fn unregister(&self, id: u64) {
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

    fn issue_external_token(&self, name: String) -> BridgeFuture<'_> {
        Box::pin(async move {
            self.0
                .query(
                    notecore::frontend_bridge::TOKEN_ISSUE_QUERY,
                    json!({ "name": name }),
                    Duration::from_secs(10),
                )
                .await
        })
    }

    fn revoke_external_token(&self, id: String) -> BridgeFuture<'_> {
        Box::pin(async move {
            self.0
                .query(
                    notecore::frontend_bridge::TOKEN_REVOKE_QUERY,
                    json!({ "id": id }),
                    Duration::from_secs(10),
                )
                .await
        })
    }

    /// 索引は端末にしか無いので、接続中の端末に `archive/search` で聞く (端末の Rust が答える)
    fn archive_search(&self, req: ArchiveSearchRequest) -> BridgeFuture<'_> {
        Box::pin(async move {
            let params = serde_json::to_value(&req).map_err(|e| e.to_string())?;
            self.0
                .query(
                    notecore::frontend_bridge::ARCHIVE_SEARCH_QUERY,
                    params,
                    Duration::from_secs(15),
                )
                .await
        })
    }
}

pub struct RpcServer {
    /// 口座の写し (アプリが `notemaid.accounts` で同期する)
    pub accounts: Arc<crate::daemon::accounts::SyncedAccounts>,
    pub core: Arc<Core>,
    pub events: Events,
    pub secret: String,
    pub endpoint: Endpoint,
    pub status: StatusFn,
    pub sessions: Arc<Sessions>,
    /// `notemaid.shutdown` で鳴らす停止の合図 (Windows の常駐はシグナルで止められないので RPC で頼む)
    pub stop: Arc<tokio::sync::Notify>,
}

impl RpcServer {
    /// 置き場を用意して bind する。残骸の socket は繋がらなければ消す
    pub async fn bind(&self) -> std::io::Result<Listener> {
        transport::bind(&self.endpoint).await
    }

    pub async fn serve(
        self: Arc<Self>,
        mut listener: Listener,
        shutdown: notecore::shutdown::ShutdownToken,
    ) {
        loop {
            let accepted = tokio::select! {
                _ = shutdown.clone().cancelled() => break,
                r = listener.accept() => r,
            };
            match accepted {
                Ok((stream, peer)) => {
                    let server = self.clone();
                    tokio::spawn(async move { server.session(stream, peer).await });
                }
                Err(e) => {
                    tracing::warn!("[rpc] accept failed: {e}");
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
        listener.cleanup();
    }

    async fn session(self: Arc<Self>, stream: Stream, peer: Peer) {
        if !peer.same_user {
            tracing::warn!("[rpc] refused connection from another user");
            return;
        }
        let (reader, mut writer) = tokio::io::split(stream);
        let (tx, mut rx) = mpsc::channel::<Frame>(1024);
        let session_id = self.sessions.register(tx.clone());
        let hello = Frame::Hello {
            protocol: notecore::rpc::PROTOCOL_VERSION,
            secret: self.secret.clone(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            fingerprint: notecore::rpc::manifest_fingerprint(),
            fs_layout: crate::migrations::FS_LAYOUT,
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
                if let Some(reply) = server.handle(frame).await {
                    let _ = tx.send(reply).await;
                }
            });
        }
        drop(tx);
        self.sessions.unregister(session_id);
        let _ = writer_task.await;
    }

    async fn handle(&self, frame: Frame) -> Option<Frame> {
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
                    self.call(&name, params, window).await
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
                // 同じユーザーからの停止依頼 (graceful)。常駐の止め方が OS のシグナルに無い Windows 用
                "shutdown" => {
                    self.stop.notify_one();
                    Outcome::success(json!({ "stopping": true }))
                }
                // 接続したアプリが口座の一覧を写す (トークンは含まない。OS キーチェーンから同じ id で読む)
                "accounts" => match self.sync_accounts(params).await {
                    Ok(n) => Outcome::success(json!({ "accounts": n })),
                    Err(e) => Outcome::failure(RpcError::from(&e)),
                },
                // 接続中の端末に橋の問い合わせが届くかの検査 (受け入れ試験と診断用)
                "probe-device" => match self
                    .sessions
                    .query("notemaid/probe", params, Duration::from_secs(5))
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
        // 中継されるのは AI 系 (notemaid の表) だけ。データ系はデバイスの notecore が持つ (#1106 案 B)
        match crate::commands::dispatch(&self.core, &ctx, name, params).await {
            Ok(v) => Outcome::success(v),
            Err(e) => Outcome::failure(RpcError::from(&e)),
        }
    }
}

impl RpcServer {
    /// アプリから受けた口座の一覧を写す (一覧に無い口座は消える)。トークン列はアプリの DB の写しで、
    /// キーチェーンが使える環境では空。資格情報のメモリキャッシュは写しに合わせて捨てる
    async fn sync_accounts(&self, params: Value) -> notecore::error::Result<usize> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Incoming {
            accounts: Vec<notecli::models::Account>,
        }
        let incoming: Incoming = serde_json::from_value(params)
            .map_err(|e| notecli::error::NoteDeckError::InvalidInput(e.to_string()))?;
        for a in &incoming.accounts {
            notecore::credentials::invalidate_credentials(&a.id);
        }
        self.accounts.replace(incoming.accounts)
    }
}

fn unauthorized() -> RpcError {
    RpcError {
        code: "UNAUTHORIZED".into(),
        message: "secret does not match this notemaid".into(),
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
