//! クライアント層 (#1106 §4.1、段階 3a): データ系コマンドを「埋め込みの notecore」に
//! 渡すか「常駐の notecored」に中継するかの切替点。切替点はコマンド表の Tauri ラッパー
//! (`commands/table.rs`) の 1 箇所で、ここはその中継の実体 (Unix socket のクライアント、
//! イベントの転送、状態面) を持つ。WebView は違いを知らない。
//!
//! 望む構成は `client.json5` の `backend`。`resident` のときだけ起動時に接続を始め、
//! 切れたら再接続する (待っている要求は device_unavailable 相当のエラーで返す)。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use notecore::rpc::{Frame, Outcome, RpcError};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot};

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
}

type EventHook = Arc<dyn Fn(&str, Value) + Send + Sync>;
type StateHook = Arc<dyn Fn(&ClientLayerState) + Send + Sync>;

pub struct RelayClient {
    socket: PathBuf,
    tx: Mutex<Option<mpsc::Sender<Frame>>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Outcome>>>,
    next_id: AtomicU64,
    secret: Mutex<Option<String>>,
    state: Mutex<ClientLayerState>,
    on_event: EventHook,
    on_state: StateHook,
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

/// 常駐構成で起動: 接続を始め、以後のデータ系コマンドは中継に流れる
pub fn start(socket: PathBuf, on_event: EventHook, on_state: StateHook) -> Arc<RelayClient> {
    let client = Arc::new(RelayClient::new(socket, on_event, on_state));
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
    pub fn new(socket: PathBuf, on_event: EventHook, on_state: StateHook) -> Self {
        Self {
            state: Mutex::new(ClientLayerState {
                backend: "resident".into(),
                socket: Some(socket.display().to_string()),
                ..Default::default()
            }),
            socket,
            tx: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            secret: Mutex::new(None),
            on_event,
            on_state,
        }
    }

    pub fn state_snapshot(&self) -> ClientLayerState {
        self.state.lock().map(|s| s.clone()).unwrap_or_default()
    }

    fn update_state(&self, f: impl FnOnce(&mut ClientLayerState)) {
        let snapshot = {
            let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut s);
            s.clone()
        };
        (self.on_state)(&snapshot);
    }

    pub fn is_connected(&self) -> bool {
        self.state_snapshot().connected
    }

    /// 接続し、切れたら待っている要求を失敗させて再接続する
    pub async fn run(self: Arc<Self>) {
        let mut backoff = Duration::from_millis(500);
        loop {
            match UnixStream::connect(&self.socket).await {
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

    fn disconnected(&self, reason: &str) {
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

    async fn session(&self, stream: UnixStream) {
        let (reader, mut writer) = stream.into_split();
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
                }
                Frame::Response { id, outcome } => {
                    let tx = self.pending.lock().ok().and_then(|mut p| p.remove(&id));
                    if let Some(tx) = tx {
                        let _ = tx.send(outcome);
                    }
                }
                Frame::Event { name, payload } => (self.on_event)(&name, payload),
                Frame::Request { .. } | Frame::Batch { .. } => {}
            }
        }
        drop(tx);
        let _ = writer_task.await;
    }

    /// 生の要求 (コマンド表の名前 + camelCase の引数)
    pub async fn request(&self, name: &str, params: Value, window: Option<String>) -> Outcome {
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

/// 起動時のアカウント一覧を notecored から取り、埋め込みと同じ `nd:accounts-early` で
/// 流す。接続を一定時間待ち、来なければ空で流す (状態面が理由を示す)
pub async fn emit_accounts_early(app: &tauri::AppHandle) {
    let Some(relay) = relay() else {
        return;
    };
    for _ in 0..300 {
        if relay.is_connected() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let accounts = relay
        .request("load_accounts", Value::Object(Default::default()), None)
        .await;
    let list = if accounts.ok {
        accounts.result.unwrap_or_else(|| Value::Array(Vec::new()))
    } else {
        tracing::warn!(
            "[relay] load_accounts failed: {:?}; emitting an empty account list",
            accounts.error
        );
        Value::Array(Vec::new())
    };
    let _ = tauri::Emitter::emit(app, "nd:accounts-early", list);
}

/// この端末の構成 (状態面用)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn client_layer_state() -> ClientLayerState {
    state()
}

/// 中継構成のときだけ Err (埋め込みの notecore を前提にする手書きコマンドが
/// DB 待ちで固まらないようにする)
pub fn ensure_embedded(what: &str) -> notecore::error::Result<()> {
    if relay().is_some() {
        return Err(notecli::error::NoteDeckError::InvalidInput(format!(
            "{what} is not available while notecored is in use (resident backend)"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
        };
        let mut line = serde_json::to_string(&ev).unwrap();
        line.push('\n');
        writer.write_all(line.as_bytes()).await.unwrap();
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(l)) = lines.next_line().await {
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
            socket,
            Arc::new(move |name, payload| ev.lock().unwrap().push((name.to_string(), payload))),
            Arc::new(move |s| st.lock().unwrap().push(s.clone())),
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
            if !events.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let got = events.lock().unwrap();
        assert_eq!(got[0].0, "nd:settings-file-changed");
        assert_eq!(got[0].1["name"], "ai.json5");
    }

    #[tokio::test]
    async fn unconnected_relay_fails_fast() {
        let dir = tempfile::tempdir().unwrap();
        let client = RelayClient::new(
            dir.path().join("none.sock"),
            Arc::new(|_, _| {}),
            Arc::new(|_| {}),
        );
        let r: Result<String, notecli::error::NoteDeckError> =
            client.call("api_note_identity", json!({}), None).await;
        assert_eq!(r.unwrap_err().code(), "NO_CONNECTION");
    }
}
