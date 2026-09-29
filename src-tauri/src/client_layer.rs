//! クライアント層 (#1106 案 B): AI 系コマンドを「この端末で回す notemaid」に渡すか
//! 「別プロセス (常駐タスク / 自分のサーバー) の notemaid」に中継するかの切替点。
//! 切替点はコマンド表の Tauri ラッパー (`commands/table.rs`) の notemaid 側の行だけで、
//! データ系コマンドは常に in-process の notecore を呼ぶ (データ面はデバイスに 1 つ)。
//! ここはその中継の実体 (Unix socket のクライアント、AI イベントの転送、橋の問い合わせ、
//! 状態面) を持つ。WebView は違いを知らない。
//!
//! 望む構成は `client.json5` の `backend`。`resident` のときだけ起動時に接続を始め、
//! 切れたら再接続する (待っている要求は NO_CONNECTION で返す)。購読の帳簿は持たない
//! (データ面の中継は #1106 の 2026-09-29 の転換で廃止)。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use notecore::rpc::{Frame, Outcome, RpcError};
use notemaid::transport::{self, Endpoint};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};

/// 状態面 (`nd:client-layer-state` と `client_layer_state` コマンド)
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ClientLayerState {
    /// `embedded` | `resident`
    pub backend: String,
    pub connected: bool,
    pub socket: Option<String>,
    pub daemon_version: Option<String>,
    /// 接続先のマニフェストの指紋がこのアプリと一致するか (未接続なら None)
    pub fingerprint_match: Option<bool>,
    pub last_error: Option<String>,
    /// 再接続の回数
    pub reconnects: u32,
    /// イベントの連番に欠落を見た回数 (再送はしない。復帰の catch-up が埋める)
    pub event_gaps: u32,
}

type EventHook = Arc<dyn Fn(&str, Value) + Send + Sync>;
type StateHook = Arc<dyn Fn(&ClientLayerState) + Send + Sync>;
/// notecored からの橋の問い合わせ (確認内容 / 実行要求 / HEARTBEAT の文脈) を WebView に
/// 渡して答えを返す。型・引数・上限時間は notecored が決める
pub type QueryHook = Arc<
    dyn Fn(String, Value, Duration) -> notecore::frontend_bridge::BridgeFuture<'static>
        + Send
        + Sync,
>;

pub struct RelayClient {
    endpoint: Endpoint,
    tx: Mutex<Option<mpsc::Sender<Frame>>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Outcome>>>,
    next_id: AtomicU64,
    secret: Mutex<Option<String>>,
    state: Mutex<ClientLayerState>,
    last_seq: Mutex<u64>,
    had_session: Mutex<bool>,
    /// 接続の有無。起動直後 (子プロセスがまだ bind していない) の要求はこれを待つ
    ready: watch::Sender<bool>,
    on_event: EventHook,
    on_state: StateHook,
    on_query: QueryHook,
}

static RELAY: OnceLock<Arc<RelayClient>> = OnceLock::new();

/// 中継先。None = 埋め込み (既定)
pub fn relay() -> Option<&'static Arc<RelayClient>> {
    RELAY.get()
}

pub fn state() -> ClientLayerState {
    match RELAY.get() {
        Some(r) => r.state_snapshot(),
        None => ClientLayerState {
            backend: "embedded".into(),
            ..Default::default()
        },
    }
}

/// 常駐構成で起動: 接続を始め、以後の AI 系コマンドは中継に流れる
pub fn start(
    endpoint: Endpoint,
    on_event: EventHook,
    on_state: StateHook,
    on_query: QueryHook,
) -> Arc<RelayClient> {
    let client = Arc::new(RelayClient::new(endpoint, on_event, on_state, on_query));
    let _ = RELAY.set(client.clone());
    let runner = client.clone();
    tauri::async_runtime::spawn(async move { runner.run().await });
    client
}

fn unavailable(message: &str) -> RpcError {
    RpcError {
        code: "NO_CONNECTION".into(),
        message: message.to_string(),
        i18n: None,
    }
}

impl RelayClient {
    pub fn new(
        endpoint: Endpoint,
        on_event: EventHook,
        on_state: StateHook,
        on_query: QueryHook,
    ) -> Self {
        Self {
            state: Mutex::new(ClientLayerState {
                backend: "resident".into(),
                socket: Some(endpoint.to_string()),
                ..Default::default()
            }),
            endpoint,
            tx: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            secret: Mutex::new(None),
            last_seq: Mutex::new(0),
            had_session: Mutex::new(false),
            ready: watch::channel(false).0,
            on_event,
            on_state,
            on_query,
        }
    }

    pub fn state_snapshot(&self) -> ClientLayerState {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    #[cfg(test)]
    pub fn is_connected(&self) -> bool {
        self.state_snapshot().connected
    }

    fn update_state(&self, f: impl FnOnce(&mut ClientLayerState)) {
        let snapshot = {
            let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut s);
            s.clone()
        };
        (self.on_state)(&snapshot);
    }

    /// 接続し、切れたら待っている要求を失敗させて再接続する
    pub async fn run(self: Arc<Self>) {
        let mut backoff = Duration::from_millis(500);
        loop {
            match transport::connect(&self.endpoint).await {
                Ok(stream) => {
                    backoff = Duration::from_millis(500);
                    self.session(stream).await;
                    self.disconnected("connection closed");
                }
                Err(e) => {
                    self.update_state(|s| {
                        s.connected = false;
                        s.last_error = Some(e.to_string());
                    });
                }
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(Duration::from_secs(10));
        }
    }

    /// 接続が立つまで待つ (上限つき)。起動直後に AI 系の要求が来たときの readiness
    pub async fn wait_connected(&self, timeout: Duration) -> bool {
        let mut rx = self.ready.subscribe();
        if *rx.borrow() {
            return true;
        }
        tokio::time::timeout(timeout, async {
            while rx.changed().await.is_ok() {
                if *rx.borrow() {
                    return true;
                }
            }
            false
        })
        .await
        .unwrap_or(false)
    }

    fn disconnected(&self, reason: &str) {
        let _ = self.ready.send(false);
        *self.tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
        *self.secret.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let pending: Vec<oneshot::Sender<Outcome>> = self
            .pending
            .lock()
            .map(|mut p| p.drain().map(|(_, tx)| tx).collect())
            .unwrap_or_default();
        for tx in pending {
            let _ = tx.send(Outcome::failure(unavailable(reason)));
        }
        self.update_state(|s| {
            s.connected = false;
            s.daemon_version = None;
            s.fingerprint_match = None;
            s.last_error = Some(reason.to_string());
        });
    }

    async fn session(self: &Arc<Self>, stream: transport::Stream) {
        let (reader, mut writer) = tokio::io::split(stream);
        let (tx, mut rx) = mpsc::channel::<Frame>(1024);
        let writer_task = tokio::spawn(async move {
            while let Some(frame) = rx.recv().await {
                let Ok(mut line) = serde_json::to_string(&frame) else {
                    continue;
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
                    tracing::warn!("[relay] bad frame: {e}");
                    continue;
                }
            };
            match frame {
                Frame::Hello {
                    secret,
                    version,
                    fingerprint,
                    ..
                } => {
                    *self.secret.lock().unwrap_or_else(|e| e.into_inner()) = Some(secret);
                    *self.tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx.clone());
                    let matches = fingerprint == notecore::rpc::manifest_fingerprint();
                    if !matches {
                        tracing::warn!(version, "[relay] notecored manifest differs from this app");
                    }
                    self.update_state(|s| {
                        s.connected = true;
                        s.daemon_version = Some(version.clone());
                        s.fingerprint_match = Some(matches);
                        s.last_error = None;
                    });
                    let _ = self.ready.send(true);
                    *self.last_seq.lock().unwrap_or_else(|e| e.into_inner()) = 0;
                    let first = {
                        let mut h = self.had_session.lock().unwrap_or_else(|e| e.into_inner());
                        let first = !*h;
                        *h = true;
                        first
                    };
                    if !first {
                        self.update_state(|s| s.reconnects += 1);
                    }
                }
                Frame::Response { id, outcome } => {
                    let tx = self.pending.lock().ok().and_then(|mut p| p.remove(&id));
                    if let Some(tx) = tx {
                        let _ = tx.send(outcome);
                    }
                }
                Frame::Event { name, payload, seq } => {
                    self.note_seq(seq);
                    (self.on_event)(&name, payload)
                }
                Frame::Query {
                    id,
                    query_type,
                    params,
                    timeout_ms,
                } => {
                    // 端末側の処理は WebView 往復なので待たずに別 task で答える
                    let fut =
                        (self.on_query)(query_type, params, Duration::from_millis(timeout_ms));
                    let tx = tx.clone();
                    tokio::spawn(async move {
                        let (result, error) = match fut.await {
                            Ok(v) => (Some(v), None),
                            Err(e) => (None, Some(e)),
                        };
                        let _ = tx.send(Frame::QueryResponse { id, result, error }).await;
                    });
                }
                Frame::Request { .. } | Frame::QueryResponse { .. } => {}
            }
        }
        // 書き手は送り口が全部落ちるまで生きるので、自分が握っている分も手放す
        *self.tx.lock().unwrap_or_else(|e| e.into_inner()) = None;
        drop(tx);
        let _ = writer_task.await;
    }

    /// 連番の欠落を数える (再送はしない)
    fn note_seq(&self, seq: u64) {
        if seq == 0 {
            return;
        }
        let mut last = self.last_seq.lock().unwrap_or_else(|e| e.into_inner());
        if *last != 0 && seq != *last + 1 {
            tracing::warn!(
                expected = *last + 1,
                got = seq,
                "[relay] event sequence gap"
            );
            self.update_state(|s| s.event_gaps += 1);
        }
        *last = seq;
    }

    /// 生の要求 (コマンド表の名前 + camelCase の引数)
    pub async fn request(&self, name: &str, params: Value, window: Option<String>) -> Outcome {
        if self.tx.lock().map(|t| t.is_none()).unwrap_or(true) {
            // 起動直後は子プロセスがまだ bind していないことがある。少しだけ待つ
            self.wait_connected(Duration::from_secs(8)).await;
        }
        let (tx, secret) = {
            let tx = self.tx.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let secret = self
                .secret
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone();
            (tx, secret)
        };
        let (Some(tx), Some(secret)) = (tx, secret) else {
            return Outcome::failure(unavailable("notecored is not connected"));
        };
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply_tx, reply_rx) = oneshot::channel();
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, reply_tx);
        let frame = Frame::Request {
            id,
            secret,
            name: name.to_string(),
            params,
            window,
        };
        if tx.send(frame).await.is_err() {
            self.pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&id);
            return Outcome::failure(unavailable("notecored connection is closing"));
        }
        match reply_rx.await {
            Ok(outcome) => outcome,
            Err(_) => Outcome::failure(unavailable("notecored connection was lost")),
        }
    }

    /// 型付き経路と同じ形で返す (コマンド表のラッパーが呼ぶ)
    pub async fn call<R: DeserializeOwned, E: From<RpcError>>(
        &self,
        name: &str,
        params: Value,
        window: Option<String>,
    ) -> Result<R, E> {
        let outcome = self.request(name, params, window).await;
        if outcome.ok {
            serde_json::from_value(outcome.result.unwrap_or(Value::Null)).map_err(|e| {
                E::from(RpcError {
                    code: "JSON".into(),
                    message: format!("{name}: response did not match the expected type: {e}"),
                    i18n: None,
                })
            })
        } else {
            Err(E::from(
                outcome
                    .error
                    .unwrap_or_else(|| unavailable("no error detail")),
            ))
        }
    }
}

/// コマンド表のラッパーが引数を wire の形 (camelCase のオブジェクト) にするための入れ物
#[derive(Default)]
pub struct Params(pub serde_json::Map<String, Value>);

impl Params {
    pub fn push<T: serde::Serialize>(&mut self, ident: &str, value: &T) {
        self.0.insert(
            notecore::rpc::camel_case(ident),
            serde_json::to_value(value).unwrap_or(Value::Null),
        );
    }

    pub fn into_value(self) -> Value {
        Value::Object(self.0)
    }
}

// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn client_layer_state() -> ClientLayerState {
    state()
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    /// 偽の notecored: hello を送り、要求に答え、イベントを 1 つ押し出す
    async fn fake_daemon(socket: PathBuf) {
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        let (stream, _) = listener.accept().await.unwrap();
        let (reader, mut writer) = stream.into_split();
        let hello = Frame::Hello {
            protocol: notecore::rpc::PROTOCOL_VERSION,
            secret: "s3cret".into(),
            version: "9.9.9".into(),
            fingerprint: notecore::rpc::manifest_fingerprint(),
        };
        let mut line = serde_json::to_string(&hello).unwrap();
        line.push('\n');
        writer.write_all(line.as_bytes()).await.unwrap();
        let ev = Frame::Event {
            name: "nd:settings-file-changed".into(),
            payload: json!({ "name": "ai.json5", "op": "write" }),
            seq: 1,
        };
        let mut line = serde_json::to_string(&ev).unwrap();
        line.push('\n');
        writer.write_all(line.as_bytes()).await.unwrap();
        // 橋の問い合わせ: 端末が答えを返す
        let q = Frame::Query {
            id: 77,
            query_type: "ai/confirm-preview".into(),
            params: json!({ "capabilityId": "notes.create" }),
            timeout_ms: 1000,
        };
        let mut line = serde_json::to_string(&q).unwrap();
        line.push('\n');
        writer.write_all(line.as_bytes()).await.unwrap();
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(l)) = lines.next_line().await {
            if let Ok(Frame::QueryResponse { id, result, .. }) = serde_json::from_str::<Frame>(&l) {
                assert_eq!(id, 77);
                assert_eq!(result.unwrap()["echo"]["capabilityId"], "notes.create");
                let ev = Frame::Event {
                    name: "nd:query-answered".into(),
                    payload: json!({}),
                    seq: 2,
                };
                let mut line = serde_json::to_string(&ev).unwrap();
                line.push('\n');
                writer.write_all(line.as_bytes()).await.unwrap();
                continue;
            }
            let Ok(Frame::Request {
                id,
                secret,
                name,
                params,
                window,
            }) = serde_json::from_str::<Frame>(&l)
            else {
                continue;
            };
            assert_eq!(secret, "s3cret");
            let outcome = match name.as_str() {
                "api_note_identity" => {
                    assert_eq!(params["uri"], "https://x/notes/1");
                    assert_eq!(window.as_deref(), Some("main"));
                    Outcome::success(json!("x:1"))
                }
                _ => Outcome::failure(RpcError {
                    code: "INVALID_INPUT".into(),
                    message: format!("unknown command: {name}"),
                    i18n: None,
                }),
            };
            let mut line = serde_json::to_string(&Frame::Response { id, outcome }).unwrap();
            line.push('\n');
            writer.write_all(line.as_bytes()).await.unwrap();
        }
    }

    #[tokio::test]
    async fn relays_typed_calls_and_forwards_events() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("d.sock");
        tokio::spawn(fake_daemon(socket.clone()));
        let events: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
        let states: Arc<Mutex<Vec<ClientLayerState>>> = Arc::new(Mutex::new(Vec::new()));
        let ev = events.clone();
        let st = states.clone();
        let client = Arc::new(RelayClient::new(
            Endpoint::Unix(socket),
            Arc::new(move |name, payload| ev.lock().unwrap().push((name.to_string(), payload))),
            Arc::new(move |s| st.lock().unwrap().push(s.clone())),
            Arc::new(|query_type, params, _timeout| {
                Box::pin(async move {
                    assert_eq!(query_type, "ai/confirm-preview");
                    Ok(json!({ "echo": params }))
                })
            }),
        ));
        let runner = client.clone();
        tokio::spawn(async move { runner.run().await });
        for _ in 0..200 {
            if client.is_connected() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(client.is_connected());
        let s = client.state_snapshot();
        assert_eq!(s.backend, "resident");
        assert_eq!(s.daemon_version.as_deref(), Some("9.9.9"));
        assert_eq!(s.fingerprint_match, Some(true));

        let mut p = Params::default();
        p.push("uri", &"https://x/notes/1");
        let r: Result<String, notecli::error::NoteDeckError> = client
            .call("api_note_identity", p.into_value(), Some("main".into()))
            .await;
        assert_eq!(r.unwrap(), "x:1");
        let r: Result<String, notecli::error::NoteDeckError> =
            client.call("nope", json!({}), None).await;
        let e = r.unwrap_err();
        assert_eq!(e.code(), "INVALID_INPUT");
        assert!(e.safe_message().contains("unknown command"));
        // 型が合わなければ JSON エラー
        let r: Result<u32, notecli::error::NoteDeckError> = client
            .call(
                "api_note_identity",
                json!({ "uri": "https://x/notes/1" }),
                Some("main".into()),
            )
            .await;
        assert_eq!(r.unwrap_err().code(), "JSON");
        for _ in 0..100 {
            if events.lock().unwrap().len() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let got = events.lock().unwrap();
        assert_eq!(got[0].0, "nd:settings-file-changed");
        assert_eq!(got[0].1["name"], "ai.json5");
        // 偽 daemon は問い合わせの答えを受け取ってから 2 つ目のイベントを出す
        assert_eq!(got[1].0, "nd:query-answered");
    }

    #[tokio::test]
    async fn unconnected_relay_fails_fast() {
        let dir = tempfile::tempdir().unwrap();
        let client = RelayClient::new(
            Endpoint::Unix(dir.path().join("none.sock")),
            Arc::new(|_, _| {}),
            Arc::new(|_| {}),
            Arc::new(|_, _, _| Box::pin(async { Err("none".into()) })),
        );
        let r: Result<String, notecli::error::NoteDeckError> =
            client.call("api_note_identity", json!({}), None).await;
        assert_eq!(r.unwrap_err().code(), "NO_CONNECTION");
    }
}
