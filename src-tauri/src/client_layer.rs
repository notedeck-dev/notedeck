//! クライアント層 (#1106 §4.1、段階 3a): データ系コマンドを「埋め込みの notecore」に
//! 渡すか「常駐の notecored」に中継するかの切替点。切替点はコマンド表の Tauri ラッパー
//! (`commands/table.rs`) の 1 箇所で、ここはその中継の実体 (Unix socket のクライアント、
//! イベントの転送、状態面) を持つ。WebView は違いを知らない。
//!
//! 望む構成は `client.json5` の `backend`。`resident` のときだけ起動時に接続を始め、
//! 切れたら再接続する (待っている要求は device_unavailable 相当のエラーで返す)。

// Unix socket の中継は unix 限定 (Windows の常駐構成は 3b 以降)。非 unix では
// 接続経路が無いので、それに連なる関数が dead になるのを許す
#![cfg_attr(not(unix), allow(dead_code))]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use notecore::rpc::{Frame, Outcome, RpcError};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
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
    /// 再接続の回数 (購読を再宣言した回数)
    pub reconnects: u32,
    /// イベントの連番に欠落を見た回数 (再送はしない。復帰の catch-up が埋める)
    pub event_gaps: u32,
    /// 前回の起動で切替 (pending-resident) を完了できなかった理由 (#1106 順序 7)
    pub switch_error: Option<String>,
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

/// WebView が持っている購読 1 つ。再接続時に同じ要求を出し直し、返ってきた新しい
/// query id を WebView の id (public id) に付け替える
#[derive(Clone, Debug)]
struct OpenQuery {
    name: String,
    params: Value,
    window: Option<String>,
    /// notecored 側の今の id (再宣言で変わる)
    daemon_id: String,
}

/// 再接続で購読を出し直したときのイベント名
pub const RESUMED_EVENT: &str = "nd:client-layer-resumed";

pub struct RelayClient {
    socket: PathBuf,
    tx: Mutex<Option<mpsc::Sender<Frame>>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Outcome>>>,
    next_id: AtomicU64,
    secret: Mutex<Option<String>>,
    state: Mutex<ClientLayerState>,
    /// public id (WebView が持つ) → 購読。順序は開いた順
    queries: Mutex<Vec<(String, OpenQuery)>>,
    /// notecored 側の id → public id (delta の付け替え用)
    aliases: Mutex<HashMap<String, String>>,
    /// 再宣言中の要求 id → WebView の id。応答を読んだその場で付け替える
    /// (応答の直後に届く delta を取りこぼさないため)
    renewing: Mutex<HashMap<u64, String>>,
    /// stream_sub_note の (accountId, noteId)
    captures: Mutex<Vec<(String, String)>>,
    /// 開いている観測 (`stream_observe_start`) の数。再接続で同じ数だけ開き直す
    observing: Mutex<u32>,
    last_seq: Mutex<u64>,
    had_session: Mutex<bool>,
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
    let mut s = match RELAY.get() {
        Some(r) => r.state_snapshot(),
        None => ClientLayerState {
            backend: "embedded".into(),
            ..Default::default()
        },
    };
    s.switch_error = crate::core_switch::switch_error();
    s
}

/// 常駐構成で起動: 接続を始め、以後のデータ系コマンドは中継に流れる
pub fn start(
    socket: PathBuf,
    on_event: EventHook,
    on_state: StateHook,
    on_query: QueryHook,
) -> Arc<RelayClient> {
    let client = Arc::new(RelayClient::new(socket, on_event, on_state, on_query));
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
        socket: PathBuf,
        on_event: EventHook,
        on_state: StateHook,
        on_query: QueryHook,
    ) -> Self {
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
            queries: Mutex::new(Vec::new()),
            aliases: Mutex::new(HashMap::new()),
            renewing: Mutex::new(HashMap::new()),
            captures: Mutex::new(Vec::new()),
            observing: Mutex::new(0),
            last_seq: Mutex::new(0),
            had_session: Mutex::new(false),
            on_event,
            on_state,
            on_query,
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
    #[cfg(unix)]
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

    /// 非 unix には Unix socket が無いので繋がない (状態面に理由だけ残す)
    #[cfg(not(unix))]
    pub async fn run(self: Arc<Self>) {
        self.update_state(|s| {
            s.connected = false;
            s.last_error = Some("notecored relay is not available on this platform".into());
        });
    }

    #[cfg(unix)]
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

    #[cfg(unix)]
    async fn session(self: &Arc<Self>, stream: UnixStream) {
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
                    *self.last_seq.lock().unwrap_or_else(|e| e.into_inner()) = 0;
                    let first = {
                        let mut h = self.had_session.lock().unwrap_or_else(|e| e.into_inner());
                        let first = !*h;
                        *h = true;
                        first
                    };
                    if !first {
                        // 再宣言は要求と応答の往復なので、応答を読むこのループを
                        // 塞がないよう別 task で回す
                        let me = self.clone();
                        tokio::spawn(async move { me.redeclare().await });
                    }
                }
                Frame::Response { id, outcome } => {
                    self.apply_renewal(id, &outcome);
                    let tx = self.pending.lock().ok().and_then(|mut p| p.remove(&id));
                    if let Some(tx) = tx {
                        let _ = tx.send(outcome);
                    }
                }
                Frame::Event { name, payload, seq } => {
                    self.note_seq(seq);
                    let payload = self.public_payload(&name, payload);
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
                Frame::Request { .. } | Frame::Batch { .. } | Frame::QueryResponse { .. } => {}
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

    /// notecored 側の query id を WebView の id に戻す
    fn public_payload(&self, name: &str, mut payload: Value) -> Value {
        if name == "query-delta" {
            if let Some(daemon_id) = payload.get("queryId").and_then(Value::as_str) {
                let public = self
                    .aliases
                    .lock()
                    .ok()
                    .and_then(|a| a.get(daemon_id).cloned());
                if let Some(public) = public {
                    payload["queryId"] = Value::String(public);
                }
            }
        }
        payload
    }

    /// WebView の query id を notecored 側の今の id に (再宣言の後だけ違う)
    fn daemon_params(&self, params: Value) -> Value {
        let mut params = params;
        if let Some(public) = params.get("queryId").and_then(Value::as_str) {
            let daemon_id = self.queries.lock().ok().and_then(|q| {
                q.iter()
                    .find(|(p, _)| p == public)
                    .map(|(_, o)| o.daemon_id.clone())
            });
            if let Some(daemon_id) = daemon_id {
                params["queryId"] = Value::String(daemon_id);
            }
        }
        params
    }

    /// 購読の帳簿 (再接続で出し直すため)。public id = 最初に返った id
    fn record(&self, name: &str, params: &Value, window: &Option<String>, outcome: &Outcome) {
        if !outcome.ok {
            return;
        }
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
                self.queries
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push((
                        qid.to_string(),
                        OpenQuery {
                            name: name.to_string(),
                            params: params.clone(),
                            window: window.clone(),
                            daemon_id: qid.to_string(),
                        },
                    ));
            }
        } else if name == "query_close" {
            let public = s("queryId");
            let mut q = self.queries.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(i) = q.iter().position(|(p, _)| *p == public) {
                let (_, open) = q.remove(i);
                if !q.iter().any(|(_, o)| o.daemon_id == open.daemon_id) {
                    self.aliases
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .remove(&open.daemon_id);
                }
            }
        } else if name == "stream_sub_note" {
            self.captures
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((s("accountId"), s("noteId")));
        } else if name == "stream_unsub_note" {
            let key = (s("accountId"), s("noteId"));
            let mut c = self.captures.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(i) = c.iter().position(|k| *k == key) {
                c.remove(i);
            }
        } else if name == "stream_observe_start" {
            *self.observing.lock().unwrap_or_else(|e| e.into_inner()) += 1;
        } else if name == "stream_observe_stop" {
            let mut o = self.observing.lock().unwrap_or_else(|e| e.into_inner());
            *o = o.saturating_sub(1);
        }
    }

    /// 再宣言の応答が読めた時点で、新しい id を WebView の id に結びつける。
    /// 読み取りループから呼ぶので、続く delta より必ず先に付け替わる
    fn apply_renewal(&self, request_id: u64, outcome: &Outcome) {
        let public = self
            .renewing
            .lock()
            .ok()
            .and_then(|mut r| r.remove(&request_id));
        let Some(public) = public else {
            return;
        };
        let daemon_id = outcome
            .result
            .as_ref()
            .filter(|_| outcome.ok)
            .and_then(|r| r.get("queryId"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let mut queries = self.queries.lock().unwrap_or_else(|e| e.into_inner());
        let Some((_, open)) = queries.iter_mut().find(|(p, _)| *p == public) else {
            return;
        };
        let mut aliases = self.aliases.lock().unwrap_or_else(|e| e.into_inner());
        match daemon_id {
            Some(daemon_id) => {
                aliases.insert(daemon_id.clone(), public);
                open.daemon_id = daemon_id;
            }
            None => {
                tracing::warn!(
                    public,
                    "[relay] re-declare failed: {:?}; keeping the old id",
                    outcome.error
                );
                aliases.insert(open.daemon_id.clone(), public);
            }
        }
    }

    /// 再接続後: WebView が持つ購読を全量、冪等に出し直し、新しい id を付け替える。
    /// 終わったら復帰イベントを出して WebView に catch-up させる (仕様 §4.4)
    async fn redeclare(&self) {
        let opens: Vec<(String, OpenQuery)> =
            self.queries.lock().map(|q| q.clone()).unwrap_or_default();
        let captures: Vec<(String, String)> =
            self.captures.lock().map(|c| c.clone()).unwrap_or_default();
        self.aliases
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        for (public, open) in opens {
            let _ = self
                .raw_request_renewing(
                    &open.name,
                    open.params.clone(),
                    open.window.clone(),
                    Some(public),
                )
                .await;
        }
        for (account_id, note_id) in &captures {
            let _ = self
                .raw_request(
                    "stream_sub_note",
                    serde_json::json!({ "accountId": account_id, "noteId": note_id }),
                    None,
                )
                .await;
        }
        let observing = self.observing.lock().map(|o| *o).unwrap_or(0);
        for _ in 0..observing {
            let _ = self
                .raw_request("stream_observe_start", serde_json::json!({}), None)
                .await;
        }
        self.update_state(|s| s.reconnects += 1);
        (self.on_event)(RESUMED_EVENT, Value::Null);
    }

    /// 生の要求 (コマンド表の名前 + camelCase の引数)。query id の付け替えと購読の帳簿つき
    pub async fn request(&self, name: &str, params: Value, window: Option<String>) -> Outcome {
        let params = self.daemon_params(params);
        let outcome = self.raw_request(name, params.clone(), window.clone()).await;
        self.record(name, &params, &window, &outcome);
        outcome
    }

    async fn raw_request(&self, name: &str, params: Value, window: Option<String>) -> Outcome {
        self.raw_request_renewing(name, params, window, None).await
    }

    /// `renewing` が Some なら、この要求は再宣言で、応答時にその WebView id へ付け替える
    async fn raw_request_renewing(
        &self,
        name: &str,
        params: Value,
        window: Option<String>,
        renewing: Option<String>,
    ) -> Outcome {
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
        if let Some(public) = renewing {
            self.renewing
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(id, public);
        }
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
            self.renewing
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

#[cfg(all(test, unix))]
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
            socket,
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
            dir.path().join("none.sock"),
            Arc::new(|_, _| {}),
            Arc::new(|_| {}),
            Arc::new(|_, _, _| Box::pin(async { Err("none".into()) })),
        );
        let r: Result<String, notecli::error::NoteDeckError> =
            client.call("api_note_identity", json!({}), None).await;
        assert_eq!(r.unwrap_err().code(), "NO_CONNECTION");
    }

    /// 切れて繋ぎ直したら、購読を出し直して id を付け替え、復帰イベントを出す
    async fn reconnecting_daemon(socket: PathBuf) {
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        for round in 0..2u32 {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, mut writer) = stream.into_split();
            let hello = Frame::Hello {
                protocol: notecore::rpc::PROTOCOL_VERSION,
                secret: "s".into(),
                version: "1".into(),
                fingerprint: notecore::rpc::manifest_fingerprint(),
            };
            let mut line = serde_json::to_string(&hello).unwrap();
            line.push('\n');
            writer.write_all(line.as_bytes()).await.unwrap();
            let mut lines = BufReader::new(reader).lines();
            let mut served = 0;
            while let Ok(Some(l)) = lines.next_line().await {
                let Ok(Frame::Request {
                    id, name, params, ..
                }) = serde_json::from_str::<Frame>(&l)
                else {
                    continue;
                };
                let outcome = match name.as_str() {
                    "query_subscribe_timeline" => {
                        assert_eq!(params["accountId"], "a");
                        Outcome::success(json!({ "queryId": format!("q:{round}"), "revision": 1 }))
                    }
                    "query_close" => {
                        // 2 回目の接続では付け替え後の id で届く
                        assert_eq!(params["queryId"], format!("q:{round}"));
                        Outcome::success(Value::Null)
                    }
                    _ => Outcome::success(Value::Null),
                };
                let mut line = serde_json::to_string(&Frame::Response { id, outcome }).unwrap();
                line.push('\n');
                writer.write_all(line.as_bytes()).await.unwrap();
                served += 1;
                if round == 0 && served == 1 {
                    // 1 回目: 購読を 1 つ受けたら切る
                    break;
                }
                if round == 1 && name == "query_subscribe_timeline" {
                    // 2 回目: 再宣言の後、新しい id で delta を流す
                    let ev = Frame::Event {
                        name: "query-delta".into(),
                        payload: json!({ "queryId": "q:1", "revision": 5, "inserts": [], "deletes": [], "updates": [] }),
                        seq: 1,
                    };
                    let mut line = serde_json::to_string(&ev).unwrap();
                    line.push('\n');
                    writer.write_all(line.as_bytes()).await.unwrap();
                }
            }
        }
    }

    #[tokio::test]
    async fn redeclares_subscriptions_after_reconnect_and_aliases_ids() {
        let dir = tempfile::tempdir().unwrap();
        let socket = dir.path().join("r.sock");
        tokio::spawn(reconnecting_daemon(socket.clone()));
        let events: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
        let ev = events.clone();
        let client = Arc::new(RelayClient::new(
            socket,
            Arc::new(move |name, payload| ev.lock().unwrap().push((name.to_string(), payload))),
            Arc::new(|_| {}),
            Arc::new(|_, _, _| Box::pin(async { Err("none".into()) })),
        ));
        let runner = client.clone();
        tokio::spawn(async move { runner.run().await });
        for _ in 0..200 {
            if client.is_connected() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let first = client
            .request(
                "query_subscribe_timeline",
                json!({ "accountId": "a", "timelineType": "home" }),
                None,
            )
            .await;
        assert_eq!(first.result.unwrap()["queryId"], "q:0");
        // 偽 daemon が切る → 再接続 → 再宣言 (q:1) → 復帰イベント
        for _ in 0..400 {
            if client.state_snapshot().reconnects >= 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(client.state_snapshot().reconnects, 1);
        for _ in 0..200 {
            if events.lock().unwrap().len() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let got = events.lock().unwrap().clone();
        assert!(got.iter().any(|(n, _)| n == RESUMED_EVENT));
        // 新しい id の delta は WebView の id (q:0) に付け替わる
        let delta = got.iter().find(|(n, _)| n == "query-delta").unwrap();
        assert_eq!(delta.1["queryId"], "q:0");
        // WebView が q:0 を閉じると daemon には q:1 で届く
        let closed = client
            .request("query_close", json!({ "queryId": "q:0" }), None)
            .await;
        assert!(closed.ok);
    }
}
