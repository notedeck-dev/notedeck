use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use crate::api::MisskeyClient;
use crate::db::Database;
use crate::error::NoteDeckError;
use crate::event_bus::{EventBus, SseEvent};
use crate::models::{
    ChatMessage, ChatReactionUser, NormalizedNote, NormalizedNotification, NoteReactedBody,
    NoteUnreactedBody, NoteUpdateBody, RawEmoji, RawNote, RawNotification, ServerEmoji,
    TimelineKey, TimelineOptions,
};

/// Trait for emitting events to a frontend (e.g., Tauri WebView).
/// In CLI/daemon mode, use `NoopEmitter`.
/// #781 Phase 3: 生 JSON は WS 受信境界で死ぬ — この境界は typed StreamEvent のみ。
pub trait FrontendEmitter: Send + Sync {
    fn emit(&self, event: StreamEvent);
}

/// No-op emitter for headless/CLI mode.
pub struct NoopEmitter;

impl FrontendEmitter for NoopEmitter {
    fn emit(&self, _event: StreamEvent) {}
}

/// Emitter that forwards events to the EventBus for SSE delivery.
pub struct EventBusEmitter {
    event_bus: Arc<EventBus>,
}

impl EventBusEmitter {
    pub fn new(event_bus: Arc<EventBus>) -> Self {
        Self { event_bus }
    }
}

impl FrontendEmitter for EventBusEmitter {
    fn emit(&self, event: StreamEvent) {
        self.event_bus.send(SseEvent {
            event_type: event.sse_event_type(),
            data: event.payload_value(),
        });
    }
}

/// Send to both the EventBus (SSE) and the FrontendEmitter.
/// status / polling 由来 capture は従来どおり emitter のみ (SSE に流さない)。
fn emit_both(emitter: &dyn FrontendEmitter, event_bus: &EventBus, event: StreamEvent) {
    event_bus.send(SseEvent {
        event_type: event.sse_event_type(),
        data: event.payload_value(),
    });
    emitter.emit(event);
}

const WS_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Keepalive ping interval (client -> server).
const WS_PING_INTERVAL: Duration = Duration::from_secs(30);

/// If no inbound frame (including the Pong replying to our keepalive ping)
/// arrives within this window, the connection is treated as half-open
/// (a "zombie" socket where the OS still reports ESTABLISHED but the peer
/// is silently gone) and we force a reconnect. 3x the ping interval, so a
/// live connection tolerates losing two consecutive pongs before tripping.
const WS_READ_IDLE_TIMEOUT: Duration = Duration::from_secs(90);

fn ws_config() -> WebSocketConfig {
    let mut config = WebSocketConfig::default();
    config.max_message_size = Some(10 * 1024 * 1024); // 10 MB
    config.max_frame_size = Some(2 * 1024 * 1024); // 2 MB
    config
}

// --- Event payloads ---

/// 全ストリーミングイベントの typed union (#781 Phase 3)。
/// adjacent tagging (kind/payload) は Tauri 統合チャネル `stream-event` の
/// 歴史的ワイヤ形 `{ kind, payload }` と一致する。Box は serde/specta とも
/// 透過 (variant 間サイズ差の抑制、clippy::large_enum_variant)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", content = "payload")]
pub enum StreamEvent {
    #[serde(rename = "stream-note")]
    Note(Box<StreamNoteEvent>),
    #[serde(rename = "stream-notification")]
    Notification(Box<StreamNotificationEvent>),
    #[serde(rename = "stream-mention")]
    Mention(Box<StreamMentionEvent>),
    #[serde(rename = "stream-main-event")]
    MainEvent(Box<StreamMainEvent>),
    #[serde(rename = "stream-note-updated")]
    NoteUpdated(Box<StreamNoteUpdatedEvent>),
    #[serde(rename = "stream-note-capture-updated")]
    NoteCaptureUpdated(Box<StreamNoteCaptureEvent>),
    #[serde(rename = "stream-chat-message")]
    ChatMessage(Box<StreamChatMessageEvent>),
    #[serde(rename = "stream-chat-message-deleted")]
    ChatMessageDeleted(Box<StreamChatMessageDeletedEvent>),
    #[serde(rename = "stream-chat-message-reacted")]
    ChatMessageReacted(Box<StreamChatMessageReactedEvent>),
    #[serde(rename = "stream-chat-message-unreacted")]
    ChatMessageUnreacted(Box<StreamChatMessageUnreactedEvent>),
    #[serde(rename = "stream-status")]
    Status(Box<StreamStatusEvent>),
    #[serde(rename = "stream-emoji-changed")]
    EmojiChanged(Box<StreamEmojiChangedEvent>),
}

impl StreamEvent {
    /// Tauri 統合チャネルの kind (= serde rename と同一)。
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Note(_) => "stream-note",
            Self::Notification(_) => "stream-notification",
            Self::Mention(_) => "stream-mention",
            Self::MainEvent(_) => "stream-main-event",
            Self::NoteUpdated(_) => "stream-note-updated",
            Self::NoteCaptureUpdated(_) => "stream-note-capture-updated",
            Self::ChatMessage(_) => "stream-chat-message",
            Self::ChatMessageDeleted(_) => "stream-chat-message-deleted",
            Self::ChatMessageReacted(_) => "stream-chat-message-reacted",
            Self::ChatMessageUnreacted(_) => "stream-chat-message-unreacted",
            Self::Status(_) => "stream-status",
            Self::EmojiChanged(_) => "stream-emoji-changed",
        }
    }

    /// SSE (`/api/events`) の event type。歴史的命名を維持する。
    pub fn sse_event_type(&self) -> String {
        match self {
            Self::Note(_) => "note".into(),
            Self::Notification(_) => "notification".into(),
            Self::Mention(_) => "mention".into(),
            Self::MainEvent(e) => format!("main-{}", e.event_type),
            Self::NoteUpdated(_) => "note-updated".into(),
            Self::NoteCaptureUpdated(_) => "note-capture-updated".into(),
            Self::ChatMessage(_) => "chat".into(),
            Self::ChatMessageDeleted(_) => "chat-deleted".into(),
            Self::ChatMessageReacted(_) => "chat-reacted".into(),
            Self::ChatMessageUnreacted(_) => "chat-unreacted".into(),
            Self::Status(_) => "status".into(),
            Self::EmojiChanged(_) => "emoji-changed".into(),
        }
    }

    /// payload 部のみを serialize する (SSE data / raw tap 用)。
    pub fn payload_value(&self) -> Value {
        let value = match self {
            Self::Note(e) => serde_json::to_value(e),
            Self::Notification(e) => serde_json::to_value(e),
            Self::Mention(e) => serde_json::to_value(e),
            Self::MainEvent(e) => serde_json::to_value(e),
            Self::NoteUpdated(e) => serde_json::to_value(e),
            Self::NoteCaptureUpdated(e) => serde_json::to_value(e),
            Self::ChatMessage(e) => serde_json::to_value(e),
            Self::ChatMessageDeleted(e) => serde_json::to_value(e),
            Self::ChatMessageReacted(e) => serde_json::to_value(e),
            Self::ChatMessageUnreacted(e) => serde_json::to_value(e),
            Self::Status(e) => serde_json::to_value(e),
            Self::EmojiChanged(e) => serde_json::to_value(e),
        };
        value.unwrap_or_default()
    }
}

/// `stream-status` で報告する接続状態 (#781)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum StreamConnectionState {
    Connected,
    Reconnecting,
    Disconnected,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamNoteEvent {
    pub account_id: String,
    pub subscription_id: String,
    #[schema(value_type = NormalizedNote)]
    pub note: Arc<NormalizedNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamNotificationEvent {
    pub account_id: String,
    pub subscription_id: String,
    pub notification: NormalizedNotification,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamMentionEvent {
    pub account_id: String,
    pub subscription_id: String,
    #[schema(value_type = NormalizedNote)]
    pub note: Arc<NormalizedNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamChatMessageEvent {
    pub account_id: String,
    pub subscription_id: String,
    pub message: ChatMessage,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamChatMessageDeletedEvent {
    pub account_id: String,
    pub subscription_id: String,
    pub message_id: String,
}

/// WS payload for `chat:react` / `chat:unreact` (deserialize 用)。
/// Misskey の `ChatEventTypes` より:
/// `react: { reaction, user?, messageId }` — `messageId` の型は string。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatReactionWsBody {
    message_id: String,
    reaction: String,
    user: Option<ChatReactionUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamChatMessageReactedEvent {
    pub account_id: String,
    pub subscription_id: String,
    pub message_id: String,
    pub reaction: String,
    pub user: Option<ChatReactionUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamChatMessageUnreactedEvent {
    pub account_id: String,
    pub subscription_id: String,
    pub message_id: String,
    pub reaction: String,
    pub user: Option<ChatReactionUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamMainEvent {
    pub account_id: String,
    pub subscription_id: String,
    pub event_type: String,
    pub body: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamNoteUpdatedEvent {
    pub account_id: String,
    pub subscription_id: String,
    pub note_id: String,
    /// flatten でワイヤ形 `{ updateType, body }` を維持する
    #[serde(flatten)]
    pub update: NoteUpdateBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamNoteCaptureEvent {
    pub account_id: String,
    pub note_id: String,
    #[serde(flatten)]
    pub update: NoteUpdateBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamStatusEvent {
    pub account_id: String,
    pub state: StreamConnectionState,
}

/// broadcast チャネルの絵文字辞書変更の種別。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum EmojiChangeKind {
    Added,
    Updated,
    Deleted,
}

/// サーバー全体配信 (broadcast) の絵文字辞書変更 (#889)。
/// 本家は emojiAdded / emojiUpdated / emojiDeleted を channel ラップなしの
/// トップレベル type で全接続に配る。
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct StreamEmojiChangedEvent {
    pub account_id: String,
    /// 絵文字辞書のキーになるサーバー host
    pub host: String,
    pub change: EmojiChangeKind,
    pub emojis: Vec<ServerEmoji>,
}

// --- Internal commands sent to the WebSocket task ---

enum WsCommand {
    Subscribe {
        channel: String,
        id: String,
        params: Option<Value>,
    },
    Unsubscribe {
        id: String,
    },
    SubNote {
        id: String,
    },
    UnsubNote {
        id: String,
    },
    Shutdown,
}

struct ConnectionHandle {
    cmd_tx: mpsc::UnboundedSender<WsCommand>,
    task: tokio::task::JoinHandle<()>,
    host: String,
    /// connection_task が維持する実際の接続状態。connect() の冪等 return 時に
    /// 現在状態を emit するために持つ (フロントは status イベントだけを信じる)。
    connected: Arc<std::sync::atomic::AtomicBool>,
}

/// Handle for a polling task (non-WebSocket mode).
#[allow(dead_code)]
struct PollingHandle {
    task: tokio::task::JoinHandle<()>,
    cancel: tokio::sync::watch::Sender<bool>,
    host: String,
    token: String,
}

// --- Subscription tracking ---

/// 購読対象の正本。WS チャンネル名・params・キャッシュキーを全てここから導出する
/// (層ごとのキー手組みを型レベルで排除する — issue #30 仕様 v5 §4)。
#[derive(Debug, Clone, PartialEq)]
enum SubscriptionTarget {
    /// ノート系タイムライン購読 (キャッシュ書込あり)
    Notes(TimelineKey),
    /// main チャンネル (通知・メンション等)
    Main,
    ChatUser {
        other_id: String,
    },
    ChatRoom {
        room_id: String,
    },
}

impl SubscriptionTarget {
    /// WS チャンネル名と基本 params。streaming 購読を持たない Notes 種別
    /// (Favorites / Clip / UserNotes / Mentions / Specified) は None。
    fn ws_channel(&self) -> Option<(std::borrow::Cow<'static, str>, Option<Value>)> {
        use std::borrow::Cow;
        match self {
            Self::Notes(key) => key.ws_channel(),
            Self::Main => Some((Cow::Borrowed("main"), None)),
            Self::ChatUser { other_id } => Some((
                Cow::Borrowed("chatUser"),
                Some(json!({ "otherId": other_id })),
            )),
            Self::ChatRoom { room_id } => Some((
                Cow::Borrowed("chatRoom"),
                Some(json!({ "roomId": room_id })),
            )),
        }
    }
}

#[derive(Debug, Clone)]
struct SubscriptionInfo {
    account_id: String,
    host: String,
    /// 購読対象。チャンネル名・params・キャッシュキーの導出元。
    target: SubscriptionTarget,
    /// 追加 params のマージ点 (WS フィルタ等の将来拡張用)。reconnect replay /
    /// resume でも維持される。
    extra_params: Option<Value>,
    /// Whether this subscription is actively connected/polled.
    ///
    /// Suspended subscriptions keep their metadata for viewport-based resume and
    /// reconnect replay, but stop receiving work from the upstream server.
    active: bool,
}

impl SubscriptionInfo {
    /// 購読送信に使うチャンネル名と params (extra_params をマージ済み。extra が勝つ)。
    fn channel_and_params(&self) -> Option<(std::borrow::Cow<'static, str>, Option<Value>)> {
        let (channel, base) = self.target.ws_channel()?;
        let params = match (base, self.extra_params.clone()) {
            (Some(Value::Object(mut b)), Some(Value::Object(e))) => {
                b.extend(e);
                Some(Value::Object(b))
            }
            (base, extra) => extra.or(base),
        };
        Some((channel, params))
    }
}

pub struct StreamingManager {
    connections: Arc<Mutex<HashMap<String, ConnectionHandle>>>,
    poll_connections: Arc<Mutex<HashMap<String, PollingHandle>>>,
    subscriptions: Arc<RwLock<HashMap<String, SubscriptionInfo>>>,
    /// Note IDs being captured per account (for polling mode note updates).
    captured_notes: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    emitter: Arc<dyn FrontendEmitter>,
    event_bus: Arc<EventBus>,
    db: Arc<Database>,
    api_client: Arc<MisskeyClient>,
}

impl StreamingManager {
    pub fn new(
        emitter: Arc<dyn FrontendEmitter>,
        event_bus: Arc<EventBus>,
        db: Arc<Database>,
    ) -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            poll_connections: Arc::new(Mutex::new(HashMap::new())),
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
            captured_notes: Arc::new(RwLock::new(HashMap::new())),
            emitter,
            event_bus,
            db,
            api_client: Arc::new(MisskeyClient::new().expect("failed to create HTTP client")),
        }
    }

    pub async fn connect(
        &self,
        account_id: &str,
        host: &str,
        token: &str,
    ) -> Result<(), NoteDeckError> {
        // polling がこのアカウントのストリームを供給中なら WS を張らない。
        // connect は「ストリームを現在のモードで確保する」であって「WS を
        // 強制する」ではない。カラムのマウントや復帰は connect を無条件に
        // 呼ぶため、ここで弾かないと polling モードが黙って崩れる
        // (notedeck#1004)。WS へ戻す唯一の経路は set_mode("realtime")。
        {
            let polls = self.poll_connections.lock().await;
            if polls.contains_key(account_id) {
                self.emitter
                    .emit(StreamEvent::Status(Box::new(StreamStatusEvent {
                        account_id: account_id.to_string(),
                        state: StreamConnectionState::Connected,
                    })));
                return Ok(());
            }
        }

        let mut conns = self.connections.lock().await;
        if let Some(handle) = conns.get(account_id) {
            // 冪等 return でも現在の実状態を emit する。フロントは復帰時に
            // リスナーを張り直してから connect を呼び直すため、背景化中に
            // 取り逃した状態遷移をここで補正できる (楽観的に connected と
            // 見なす JS 側ロジックを置かないための供給側の責務)。
            let state = if handle.connected.load(std::sync::atomic::Ordering::Relaxed) {
                StreamConnectionState::Connected
            } else {
                StreamConnectionState::Reconnecting
            };
            self.emitter
                .emit(StreamEvent::Status(Box::new(StreamStatusEvent {
                    account_id: account_id.to_string(),
                    state,
                })));
            return Ok(());
        }

        let scheme = crate::insecure::ws_scheme(host);
        let url = format!("{scheme}://{host}/streaming?i={token}");

        // Attempt the initial connection (with timeout to prevent hang DoS).
        // 失敗しても Err を返さず connection_task の再接続ループに委ねる:
        // 初回失敗を呼び出し側へ返すだけだと再試行の責務が宙に浮き、
        // 「起動直後のネットワーク未確立 = 永久にストリームなし」になる。
        // 接続の生死は stream-status イベント (connected / reconnecting) で
        // フロントへ伝わる。
        let initial_ws = match tokio::time::timeout(
            WS_CONNECT_TIMEOUT,
            tokio_tungstenite::connect_async_with_config(&url, Some(ws_config()), false),
        )
        .await
        {
            Ok(Ok((ws_stream, _))) => Some(ws_stream),
            Ok(Err(e)) => {
                tracing::warn!(account_id, error = %e, "initial connect failed; retrying in background");
                None
            }
            Err(_) => {
                tracing::warn!(
                    account_id,
                    "initial connect timed out; retrying in background"
                );
                None
            }
        };
        let connected = initial_ws.is_some();
        let connected_flag = Arc::new(std::sync::atomic::AtomicBool::new(connected));

        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();

        let account_id_owned = account_id.to_string();
        let url_owned = url.clone();
        let subscriptions = self.subscriptions.clone();
        let captured_notes = self.captured_notes.clone();
        let emitter = self.emitter.clone();
        let event_bus = self.event_bus.clone();
        let db = self.db.clone();

        let api_client = self.api_client.clone();
        let host_owned = host.to_string();
        let token_owned = token.to_string();
        let connected_flag_task = connected_flag.clone();
        let task = tokio::spawn(async move {
            connection_task(
                emitter,
                event_bus,
                db,
                api_client,
                account_id_owned,
                host_owned,
                token_owned,
                url_owned,
                initial_ws,
                cmd_rx,
                subscriptions,
                captured_notes,
                connected_flag_task,
            )
            .await;
        });

        conns.insert(
            account_id.to_string(),
            ConnectionHandle {
                cmd_tx,
                task,
                host: host.to_string(),
                connected: connected_flag,
            },
        );

        self.emitter
            .emit(StreamEvent::Status(Box::new(StreamStatusEvent {
                account_id: account_id.to_string(),
                state: if connected {
                    StreamConnectionState::Connected
                } else {
                    StreamConnectionState::Reconnecting
                },
            })));

        Ok(())
    }

    pub async fn disconnect(&self, account_id: &str) {
        // Stop WebSocket connection if any
        let mut conns = self.connections.lock().await;
        if let Some(handle) = conns.remove(account_id) {
            if let Err(e) = handle.cmd_tx.send(WsCommand::Shutdown) {
                tracing::warn!(account_id, error = %e, "failed to send shutdown");
            }
            if let Err(e) = handle.task.await {
                tracing::error!(account_id, error = %e, "task join error");
            }
        }
        drop(conns);

        // Stop polling task if any
        let mut polls = self.poll_connections.lock().await;
        if let Some(handle) = polls.remove(account_id) {
            let _ = handle.cancel.send(true);
            handle.task.abort();
        }
        drop(polls);

        // Remove all subscriptions for this account
        let mut subs = self.subscriptions.write().await;
        subs.retain(|_, info| info.account_id != account_id);
        drop(subs);

        // Note captures follow the same lifecycle as subscriptions
        let mut captured = self.captured_notes.write().await;
        captured.remove(account_id);
        drop(captured);

        self.emitter
            .emit(StreamEvent::Status(Box::new(StreamStatusEvent {
                account_id: account_id.to_string(),
                state: StreamConnectionState::Disconnected,
            })));
    }

    /// Switch between realtime (WebSocket) and polling (HTTP) mode.
    /// Subscriptions are preserved across the switch.
    pub async fn set_mode(
        &self,
        account_id: &str,
        host: &str,
        token: &str,
        mode: &str,
        interval_ms: Option<u64>,
    ) -> Result<(), NoteDeckError> {
        match mode {
            "realtime" => {
                // Stop polling if active
                {
                    let mut polls = self.poll_connections.lock().await;
                    if let Some(handle) = polls.remove(account_id) {
                        let _ = handle.cancel.send(true);
                        handle.task.abort();
                    }
                }
                // Start WebSocket (connect is idempotent)
                self.connect(account_id, host, token).await?;
            }
            "polling" => {
                // Stop WebSocket if active (but keep subscriptions)
                {
                    let mut conns = self.connections.lock().await;
                    if let Some(handle) = conns.remove(account_id) {
                        let _ = handle.cmd_tx.send(WsCommand::Shutdown);
                        let _ = handle.task.await;
                    }
                }
                // Start polling task
                let interval = Duration::from_millis(interval_ms.unwrap_or(15_000));
                self.start_polling(account_id, host, token, interval).await;

                self.emitter
                    .emit(StreamEvent::Status(Box::new(StreamStatusEvent {
                        account_id: account_id.to_string(),
                        state: StreamConnectionState::Connected,
                    })));
            }
            _ => {
                return Err(NoteDeckError::InvalidInput(format!("unknown mode: {mode}")));
            }
        }
        Ok(())
    }

    async fn start_polling(&self, account_id: &str, host: &str, token: &str, interval: Duration) {
        let mut polls = self.poll_connections.lock().await;

        // Stop existing polling task
        if let Some(handle) = polls.remove(account_id) {
            let _ = handle.cancel.send(true);
            handle.task.abort();
        }

        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);

        let account_id_owned = account_id.to_string();
        let host_owned = host.to_string();
        let token_owned = token.to_string();
        let subscriptions = self.subscriptions.clone();
        let emitter = self.emitter.clone();
        let event_bus = self.event_bus.clone();
        let db = self.db.clone();
        let api_client = self.api_client.clone();
        let captured_notes = self.captured_notes.clone();

        let task = tokio::spawn(async move {
            polling_loop(
                api_client,
                emitter,
                event_bus,
                db,
                account_id_owned,
                host_owned,
                token_owned,
                interval,
                subscriptions,
                captured_notes,
                cancel_rx,
            )
            .await;
        });

        polls.insert(
            account_id.to_string(),
            PollingHandle {
                task,
                cancel: cancel_tx,
                host: host.to_string(),
                token: token.to_string(),
            },
        );
    }

    /// ノート系タイムライン購読の単一エントリポイント。チャンネル名・params・
    /// キャッシュキーは全て `key` から導出する。streaming 購読を持たない種別
    /// (Favorites 等 — `ws_channel() == None`) は Err。
    pub async fn subscribe_notes(
        &self,
        account_id: &str,
        key: TimelineKey,
        extra_params: Option<Value>,
    ) -> Result<String, NoteDeckError> {
        if key.ws_channel().is_none() {
            return Err(NoteDeckError::InvalidInput(format!(
                "timeline key '{key}' has no streaming channel"
            )));
        }
        self.subscribe_target(account_id, SubscriptionTarget::Notes(key), extra_params)
            .await
    }

    pub async fn subscribe_chat_user(
        &self,
        account_id: &str,
        other_id: &str,
    ) -> Result<String, NoteDeckError> {
        self.subscribe_target(
            account_id,
            SubscriptionTarget::ChatUser {
                other_id: other_id.to_string(),
            },
            None,
        )
        .await
    }

    pub async fn subscribe_chat_room(
        &self,
        account_id: &str,
        room_id: &str,
    ) -> Result<String, NoteDeckError> {
        self.subscribe_target(
            account_id,
            SubscriptionTarget::ChatRoom {
                room_id: room_id.to_string(),
            },
            None,
        )
        .await
    }

    pub async fn subscribe_main(&self, account_id: &str) -> Result<String, NoteDeckError> {
        self.subscribe_target(account_id, SubscriptionTarget::Main, None)
            .await
    }

    async fn subscribe_target(
        &self,
        account_id: &str,
        target: SubscriptionTarget,
        extra_params: Option<Value>,
    ) -> Result<String, NoteDeckError> {
        let sub_id = uuid::Uuid::new_v4().to_string();
        let host = self.get_host(account_id).await?;
        let info = SubscriptionInfo {
            account_id: account_id.to_string(),
            host,
            target,
            extra_params,
            active: true,
        };
        let (channel, params) = info.channel_and_params().ok_or_else(|| {
            NoteDeckError::InvalidInput("subscription target has no streaming channel".to_string())
        })?;

        {
            let mut subs = self.subscriptions.write().await;
            // main は Misskey の shouldShare チャンネル: 同一 WS 接続への 2 本目の
            // connect はサーバーが黙って無視する (ack も来ない) ため、張れるのは
            // 実質 1 本だけ。既存の購読 ID を返してアカウントごとに 1 本に保つ。
            if matches!(info.target, SubscriptionTarget::Main) {
                let existing = subs.iter().find_map(|(id, i)| {
                    (i.account_id == account_id && matches!(i.target, SubscriptionTarget::Main))
                        .then(|| id.clone())
                });
                if let Some(existing) = existing {
                    return Ok(existing);
                }
            }
            // send より先に登録して check-and-insert を原子的にする
            // (send 失敗時は下でロールバック)。
            subs.insert(sub_id.clone(), info);
        }

        if let Err(e) = self
            .send_subscribe(account_id, &channel, &sub_id, params)
            .await
        {
            self.subscriptions.write().await.remove(&sub_id);
            return Err(e);
        }

        Ok(sub_id)
    }

    pub async fn unsubscribe(
        &self,
        account_id: &str,
        subscription_id: &str,
    ) -> Result<(), NoteDeckError> {
        // main は共有チャンネル (通知・メンション・OS 通知・未読バッジが同居)。
        // カラム都合の unsubscribe で切ると他の消費者ごと無音になるので no-op。
        // 解放経路は disconnect のみ。
        {
            let subs = self.subscriptions.read().await;
            if let Some(info) = subs.get(subscription_id) {
                if matches!(info.target, SubscriptionTarget::Main) {
                    return Ok(());
                }
            }
        }

        // Send unsubscribe to WebSocket if in realtime mode
        let conns = self.connections.lock().await;
        if let Some(handle) = conns.get(account_id) {
            let _ = handle.cmd_tx.send(WsCommand::Unsubscribe {
                id: subscription_id.to_string(),
            });
        }
        drop(conns);

        // Always remove from subscriptions map (both modes use it)
        let mut subs = self.subscriptions.write().await;
        subs.remove(subscription_id);

        Ok(())
    }

    /// Suspend a subscription without forgetting its metadata.
    ///
    /// This is used by viewport budgeting: inactive deck columns should stop
    /// upstream work, but reconnect/polling/resume still need the original
    /// channel and params.
    pub async fn suspend_subscription(
        &self,
        account_id: &str,
        subscription_id: &str,
    ) -> Result<(), NoteDeckError> {
        {
            let mut subs = self.subscriptions.write().await;
            let info = subs
                .get_mut(subscription_id)
                .ok_or_else(|| NoteDeckError::InvalidInput("subscription not found".to_string()))?;
            if info.account_id != account_id {
                return Err(NoteDeckError::InvalidInput(
                    "subscription account mismatch".to_string(),
                ));
            }
            // main は viewport 予算の対象外 (unsubscribe と同じ理由で no-op)。
            if matches!(info.target, SubscriptionTarget::Main) {
                return Ok(());
            }
            if !info.active {
                return Ok(());
            }
            info.active = false;
        }

        let conns = self.connections.lock().await;
        if let Some(handle) = conns.get(account_id) {
            let _ = handle.cmd_tx.send(WsCommand::Unsubscribe {
                id: subscription_id.to_string(),
            });
        }
        Ok(())
    }

    /// Resume a suspended subscription using the original subscription ID.
    pub async fn resume_subscription(
        &self,
        account_id: &str,
        subscription_id: &str,
    ) -> Result<(), NoteDeckError> {
        let (channel_params, was_active) = {
            let subs = self.subscriptions.read().await;
            let info = subs
                .get(subscription_id)
                .ok_or_else(|| NoteDeckError::InvalidInput("subscription not found".to_string()))?;
            if info.account_id != account_id {
                return Err(NoteDeckError::InvalidInput(
                    "subscription account mismatch".to_string(),
                ));
            }
            (info.channel_and_params(), info.active)
        };
        if was_active {
            return Ok(());
        }
        let (channel, params) = channel_params.ok_or_else(|| {
            NoteDeckError::InvalidInput("subscription target has no streaming channel".to_string())
        })?;

        self.send_subscribe(account_id, &channel, subscription_id, params)
            .await?;

        let mut subs = self.subscriptions.write().await;
        if let Some(info) = subs.get_mut(subscription_id) {
            info.active = true;
        }
        Ok(())
    }

    pub async fn sub_note(&self, account_id: &str, note_id: &str) -> Result<(), NoteDeckError> {
        // Record in captured_notes in BOTH modes. Without this, WebSocket-mode
        // captures are not in any table, so the reconnect replay in
        // run_ws_session never restores them and noteUpdated events silently
        // stop after the first reconnect (idle watchdog, network error, ...).
        {
            let mut captured = self.captured_notes.write().await;
            captured
                .entry(account_id.to_string())
                .or_default()
                .insert(note_id.to_string());
        }

        // WebSocket mode: also send subNote now (polling mode reads the table)
        let conns = self.connections.lock().await;
        if let Some(handle) = conns.get(account_id) {
            return handle
                .cmd_tx
                .send(WsCommand::SubNote {
                    id: note_id.to_string(),
                })
                .map_err(|_| NoteDeckError::ConnectionClosed);
        }
        Ok(())
    }

    pub async fn unsub_note(&self, account_id: &str, note_id: &str) -> Result<(), NoteDeckError> {
        {
            let mut captured = self.captured_notes.write().await;
            if let Some(set) = captured.get_mut(account_id) {
                set.remove(note_id);
                if set.is_empty() {
                    captured.remove(account_id);
                }
            }
        }

        // WebSocket mode: also send unsubNote now
        let conns = self.connections.lock().await;
        if let Some(handle) = conns.get(account_id) {
            return handle
                .cmd_tx
                .send(WsCommand::UnsubNote {
                    id: note_id.to_string(),
                })
                .map_err(|_| NoteDeckError::ConnectionClosed);
        }
        Ok(())
    }

    async fn get_host(&self, account_id: &str) -> Result<String, NoteDeckError> {
        // Check WebSocket connections first
        let conns = self.connections.lock().await;
        if let Some(h) = conns.get(account_id) {
            return Ok(h.host.clone());
        }
        drop(conns);

        // Check polling connections
        let polls = self.poll_connections.lock().await;
        if let Some(h) = polls.get(account_id) {
            return Ok(h.host.clone());
        }

        Err(NoteDeckError::NoConnection(account_id.to_string()))
    }

    async fn send_subscribe(
        &self,
        account_id: &str,
        channel: &str,
        sub_id: &str,
        params: Option<Value>,
    ) -> Result<(), NoteDeckError> {
        let conns = self.connections.lock().await;
        if let Some(handle) = conns.get(account_id) {
            // WebSocket mode: send subscribe command
            return handle
                .cmd_tx
                .send(WsCommand::Subscribe {
                    channel: channel.to_string(),
                    id: sub_id.to_string(),
                    params,
                })
                .map_err(|_| NoteDeckError::ConnectionClosed);
        }
        drop(conns);

        // Polling mode: subscription is tracked in the subscriptions map
        // (no WebSocket command needed — polling loop reads from subscriptions directly)
        let polls = self.poll_connections.lock().await;
        if polls.contains_key(account_id) {
            return Ok(());
        }

        Err(NoteDeckError::NoConnection(account_id.to_string()))
    }
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
type WsRead = futures_util::stream::SplitStream<WsStream>;
type WsWrite = Arc<Mutex<futures_util::stream::SplitSink<WsStream, Message>>>;

enum WsExitReason {
    Disconnected,
    Shutdown,
}

const MAX_BACKOFF_SECS: u64 = 30;

/// Equal Jitter: returns a randomized backoff duration in `[backoff/2, backoff]`.
/// The floor (backoff/2) prevents a fast-failing connect from busy-looping,
/// while the randomization de-synchronizes reconnects across accounts.
fn backoff_with_jitter(backoff_secs: u64) -> Duration {
    let half = backoff_secs as f64 / 2.0;
    Duration::from_secs_f64(half + half * rand::random::<f64>())
}

/// Top-level task that handles reconnection with exponential backoff.
#[allow(clippy::too_many_arguments)]
async fn connection_task(
    emitter: Arc<dyn FrontendEmitter>,
    event_bus: Arc<EventBus>,
    db: Arc<Database>,
    api_client: Arc<MisskeyClient>,
    account_id: String,
    host: String,
    token: String,
    url: String,
    initial_ws: Option<WsStream>,
    mut cmd_rx: mpsc::UnboundedReceiver<WsCommand>,
    subscriptions: Arc<RwLock<HashMap<String, SubscriptionInfo>>>,
    captured_notes: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    connected_flag: Arc<std::sync::atomic::AtomicBool>,
) {
    use std::sync::atomic::Ordering;

    let mut backoff_secs: u64 = 1;

    // Run the first session with the already-connected WebSocket.
    // None = 初回接続に失敗している (connect() が委譲してきた)。
    // その場合は最初から下の再接続ループに任せる。
    if let Some(initial_ws) = initial_ws {
        let reason = run_ws_session(
            &emitter,
            &event_bus,
            &db,
            &api_client,
            &account_id,
            &host,
            &token,
            initial_ws,
            &mut cmd_rx,
            &subscriptions,
            &captured_notes,
        )
        .await;
        connected_flag.store(false, Ordering::Relaxed);
        if matches!(reason, WsExitReason::Shutdown) {
            return;
        }
    }

    // Reconnection loop
    loop {
        connected_flag.store(false, Ordering::Relaxed);
        emitter.emit(StreamEvent::Status(Box::new(StreamStatusEvent {
            account_id: account_id.clone(),
            state: StreamConnectionState::Reconnecting,
        })));

        // Wait with backoff, but listen for Shutdown during the wait.
        // Equal Jitter (sleep in [backoff/2, backoff]) de-syncs reconnects
        // across accounts while keeping a floor, so a fast-failing connect
        // (immediate TCP RST) can't spin into a hot retry loop.
        let sleep = tokio::time::sleep(backoff_with_jitter(backoff_secs));
        tokio::pin!(sleep);

        let shutdown_during_wait = loop {
            tokio::select! {
                _ = &mut sleep => break false,
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(WsCommand::Shutdown) | None => break true,
                        // Subscribe/Unsubscribe/SubNote/UnsubNote: safe to drop
                        // here because the subscriptions and captured_notes
                        // tables are already updated by the caller.
                        // run_ws_session replays from those tables.
                        _ => {}
                    }
                }
            }
        };

        if shutdown_during_wait {
            return;
        }

        // Attempt reconnection (with timeout)
        let ws_result = tokio::time::timeout(
            WS_CONNECT_TIMEOUT,
            tokio_tungstenite::connect_async_with_config(&url, Some(ws_config()), false),
        )
        .await;
        match ws_result {
            Ok(Ok((ws_stream, _))) => {
                backoff_secs = 1; // Reset backoff on success
                connected_flag.store(true, Ordering::Relaxed);

                emitter.emit(StreamEvent::Status(Box::new(StreamStatusEvent {
                    account_id: account_id.clone(),
                    state: StreamConnectionState::Connected,
                })));

                let reason = run_ws_session(
                    &emitter,
                    &event_bus,
                    &db,
                    &api_client,
                    &account_id,
                    &host,
                    &token,
                    ws_stream,
                    &mut cmd_rx,
                    &subscriptions,
                    &captured_notes,
                )
                .await;
                connected_flag.store(false, Ordering::Relaxed);

                if matches!(reason, WsExitReason::Shutdown) {
                    return;
                }
            }
            Ok(Err(e)) => {
                tracing::warn!(account_id = %account_id, error = %e, backoff_secs, "reconnect failed");
                backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
            }
            Err(_) => {
                tracing::warn!(account_id = %account_id, backoff_secs, "reconnect timeout");
                backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
            }
        }
    }
}

/// Run a single WebSocket session. Re-subscribes existing channels, then enters the message loop.
#[allow(clippy::too_many_arguments)]
async fn run_ws_session(
    emitter: &Arc<dyn FrontendEmitter>,
    event_bus: &Arc<EventBus>,
    db: &Arc<Database>,
    api_client: &Arc<MisskeyClient>,
    account_id: &str,
    host: &str,
    token: &str,
    ws_stream: WsStream,
    cmd_rx: &mut mpsc::UnboundedReceiver<WsCommand>,
    subscriptions: &Arc<RwLock<HashMap<String, SubscriptionInfo>>>,
    captured_notes: &Arc<RwLock<HashMap<String, HashSet<String>>>>,
) -> WsExitReason {
    let (write, read) = ws_stream.split();
    let write = Arc::new(Mutex::new(write));

    // Collect subscriptions to replay, then drop the lock before doing I/O
    let to_resub: Vec<(String, String, Option<Value>)> = {
        let subs = subscriptions.read().await;
        subs.iter()
            .filter(|(_, info)| info.account_id == account_id && info.active)
            .filter_map(|(sub_id, info)| {
                info.channel_and_params()
                    .map(|(channel, params)| (sub_id.clone(), channel.into_owned(), params))
            })
            .collect()
    };

    if !to_resub.is_empty() {
        let mut w = write.lock().await;
        for (sub_id, channel, params) in &to_resub {
            let mut body = json!({ "channel": channel, "id": sub_id });
            if let Some(p) = params {
                body["params"] = p.clone();
            }
            let msg = json!({ "type": "connect", "body": body });
            if let Err(e) = w.send(Message::Text(msg.to_string().into())).await {
                tracing::warn!(error = %e, "re-subscribe send failed");
                break;
            }
        }
    }

    // Replay note captures. Unlike channel subscriptions these have no
    // server-side persistence either, so a reconnect without this replay
    // permanently loses noteUpdated (reactions, edits) for captured notes.
    //
    // session_note_subs tracks what this session has already sent subNote
    // for. Misskey refcounts subNote (it is NOT idempotent), so a queued
    // WsCommand::SubNote that raced with this replay must not be sent twice
    // or a single unsubNote would leave a dangling server-side subscription.
    let session_note_subs: HashSet<String> = {
        let captured = captured_notes.read().await;
        captured.get(account_id).cloned().unwrap_or_default()
    };

    if !session_note_subs.is_empty() {
        let mut w = write.lock().await;
        for note_id in &session_note_subs {
            let msg = json!({ "type": "subNote", "body": { "id": note_id } });
            if let Err(e) = w.send(Message::Text(msg.to_string().into())).await {
                tracing::warn!(error = %e, "subNote replay send failed");
                // 送信失敗分は未購読のまま残るが、直後に接続自体が落ちて
                // 再接続 replay でやり直すので個別追跡はしない
                break;
            }
        }
    }

    ws_loop(
        emitter,
        event_bus,
        db,
        api_client,
        account_id,
        host,
        token,
        read,
        write,
        cmd_rx,
        subscriptions,
        session_note_subs,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn ws_loop(
    emitter: &Arc<dyn FrontendEmitter>,
    event_bus: &Arc<EventBus>,
    db: &Arc<Database>,
    api_client: &Arc<MisskeyClient>,
    account_id: &str,
    host: &str,
    token: &str,
    mut read: WsRead,
    write: WsWrite,
    cmd_rx: &mut mpsc::UnboundedReceiver<WsCommand>,
    subscriptions: &Arc<RwLock<HashMap<String, SubscriptionInfo>>>,
    // このセッションで subNote 済みのノート id。replay 分を含む。
    // Misskey の subNote は refcount 式で冪等でないため、replay と
    // 切断中に queue された SubNote コマンドの二重送信をここで排除する。
    mut session_note_subs: HashSet<String>,
) -> WsExitReason {
    let mut ping_interval = tokio::time::interval(WS_PING_INTERVAL);
    ping_interval.tick().await; // skip the first immediate tick

    // Read-idle watchdog: any inbound frame (data, server Ping, or the Pong
    // replying to our keepalive ping) proves the link is alive and resets the
    // deadline. If it elapses, the connection is half-open and we reconnect.
    let idle = tokio::time::sleep(WS_READ_IDLE_TIMEOUT);
    tokio::pin!(idle);

    loop {
        tokio::select! {
            msg = read.next() => {
                if matches!(msg, Some(Ok(_))) {
                    idle.as_mut().reset(tokio::time::Instant::now() + WS_READ_IDLE_TIMEOUT);
                }
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        let emitter_c = emitter.clone();
                        let event_bus_c = event_bus.clone();
                        let db_c = db.clone();
                        let api_client_c = api_client.clone();
                        let account_id_c = account_id.to_string();
                        let host_c = host.to_string();
                        let token_c = token.to_string();
                        let subscriptions_c = subscriptions.clone();
                        tokio::spawn(async move {
                            handle_ws_message(&*emitter_c, &event_bus_c, &db_c, &api_client_c, &account_id_c, &host_c, &token_c, &text, &subscriptions_c).await;
                        });
                    }
                    Some(Ok(Message::Ping(data))) => {
                        let mut w = write.lock().await;
                        if let Err(e) = w.send(Message::Pong(data)).await {
                            tracing::warn!(error = %e, "pong send failed");
                            return WsExitReason::Disconnected;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                        return WsExitReason::Disconnected;
                    }
                    _ => {}
                }
            }
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(WsCommand::Subscribe { channel, id, params }) => {
                        let mut body = json!({ "channel": channel, "id": id });
                        if let Some(p) = params {
                            body["params"] = p;
                        }
                        let msg = json!({ "type": "connect", "body": body });
                        let mut w = write.lock().await;
                        if let Err(e) = w.send(Message::Text(msg.to_string().into())).await {
                            tracing::warn!(error = %e, "subscribe send failed");
                        }
                    }
                    Some(WsCommand::Unsubscribe { id }) => {
                        let msg = json!({
                            "type": "disconnect",
                            "body": { "id": id }
                        });
                        let mut w = write.lock().await;
                        if let Err(e) = w.send(Message::Text(msg.to_string().into())).await {
                            tracing::warn!(error = %e, "unsubscribe send failed");
                        }
                    }
                    Some(WsCommand::SubNote { id }) => {
                        // insert が false = このセッションで購読済み (replay 済み
                        // or 二重コマンド)。重複送信すると refcount が狂う。
                        if session_note_subs.insert(id.clone()) {
                            let msg = json!({ "type": "subNote", "body": { "id": id } });
                            let mut w = write.lock().await;
                            if let Err(e) = w.send(Message::Text(msg.to_string().into())).await {
                                tracing::warn!(error = %e, "subNote send failed");
                            }
                        }
                    }
                    Some(WsCommand::UnsubNote { id }) => {
                        session_note_subs.remove(&id);
                        let msg = json!({ "type": "unsubNote", "body": { "id": id } });
                        let mut w = write.lock().await;
                        if let Err(e) = w.send(Message::Text(msg.to_string().into())).await {
                            tracing::warn!(error = %e, "unsubNote send failed");
                        }
                    }
                    Some(WsCommand::Shutdown) | None => {
                        let mut w = write.lock().await;
                        let _ = w.close().await;
                        return WsExitReason::Shutdown;
                    }
                }
            }
            _ = ping_interval.tick() => {
                let mut w = write.lock().await;
                if let Err(e) = w.send(Message::Ping(vec![].into())).await {
                    tracing::warn!(account_id, error = %e, "keepalive ping failed");
                    return WsExitReason::Disconnected;
                }
            }
            _ = &mut idle => {
                tracing::warn!(account_id, "read idle timeout: half-open connection detected, reconnecting");
                return WsExitReason::Disconnected;
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_ws_message(
    emitter: &dyn FrontendEmitter,
    event_bus: &EventBus,
    db: &Arc<Database>,
    api_client: &Arc<MisskeyClient>,
    account_id: &str,
    account_host: &str,
    account_token: &str,
    text: &str,
    subscriptions: &Arc<RwLock<HashMap<String, SubscriptionInfo>>>,
) {
    let mut msg: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    let msg_type = match msg.get("type").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => return,
    };

    // Note Capture: { "type": "noteUpdated", "body": { "id": "...", "type": "...", "body": ... } }
    if msg_type == "noteUpdated" {
        if let Some(mut body) = msg.get_mut("body").map(Value::take) {
            let note_id = body
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_owned();
            let update_type = body
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_owned();
            let update_body = body.get_mut("body").map(Value::take).unwrap_or_default();
            let Some(update) = NoteUpdateBody::from_raw(&update_type, update_body) else {
                tracing::debug!(update_type, "unknown noteUpdated type; dropped");
                return;
            };
            let payload = StreamNoteCaptureEvent {
                account_id: account_id.to_string(),
                note_id,
                update,
            };
            emit_both(
                emitter,
                event_bus,
                StreamEvent::NoteCaptureUpdated(Box::new(payload)),
            );
        }
        return;
    }

    // Broadcast: 絵文字辞書の変更 (#889)。channel ラップなしのトップレベル
    // type で全接続に届く。added は { emoji }, updated / deleted は { emojis: [] }
    let emoji_change = match msg_type {
        "emojiAdded" => Some(EmojiChangeKind::Added),
        "emojiUpdated" => Some(EmojiChangeKind::Updated),
        "emojiDeleted" => Some(EmojiChangeKind::Deleted),
        _ => None,
    };
    if let Some(change) = emoji_change {
        // msg_type は msg を borrow しているため、get_mut の前に所有へ写す
        let msg_type = msg_type.to_owned();
        let Some(mut body) = msg.get_mut("body").map(Value::take) else {
            return;
        };
        let raw = if change == EmojiChangeKind::Added {
            body.get_mut("emoji")
                .map(Value::take)
                .map(|v| Value::Array(vec![v]))
        } else {
            body.get_mut("emojis").map(Value::take)
        };
        let Some(raw) = raw else { return };
        let emojis: Vec<ServerEmoji> = match serde_json::from_value::<Vec<RawEmoji>>(raw) {
            Ok(raws) => raws.into_iter().map(ServerEmoji::from).collect(),
            Err(e) => {
                tracing::debug!(error = %e, msg_type, "malformed emoji broadcast; dropped");
                return;
            }
        };
        if emojis.is_empty() {
            return;
        }
        let payload = StreamEmojiChangedEvent {
            account_id: account_id.to_string(),
            host: account_host.to_string(),
            change,
            emojis,
        };
        emit_both(
            emitter,
            event_bus,
            StreamEvent::EmojiChanged(Box::new(payload)),
        );
        return;
    }

    // Misskey streaming: { "type": "channel", "body": { "id": "...", "type": "...", "body": ... } }
    if msg_type != "channel" {
        return;
    }

    let mut body = match msg.get_mut("body").map(Value::take) {
        Some(b) if !b.is_null() => b,
        _ => return,
    };

    let sub_id = match body.get("id").and_then(|v| v.as_str()) {
        Some(id) => id.to_owned(),
        None => return,
    };

    let event_type = match body.get("type").and_then(|v| v.as_str()) {
        Some(t) => t.to_owned(),
        None => return,
    };

    let event_body = match body.get_mut("body").map(Value::take) {
        Some(b) if !b.is_null() => b,
        _ => return,
    };

    let (target, host) = {
        let subs = subscriptions.read().await;
        match subs.get(&sub_id) {
            Some(i) => (i.target.clone(), i.host.clone()),
            None => return,
        }
    };

    let note_key = match &target {
        SubscriptionTarget::Notes(key) => Some(key.clone()),
        _ => None,
    };
    let is_note_channel = note_key.is_some();
    let is_main = matches!(target, SubscriptionTarget::Main);
    let is_chat = matches!(
        target,
        SubscriptionTarget::ChatUser { .. } | SubscriptionTarget::ChatRoom { .. }
    );

    if is_note_channel && event_type == "note" {
        if let Ok(raw) = serde_json::from_value::<RawNote>(event_body) {
            let key = note_key.expect("is_note_channel implies note_key");
            let note = Arc::new(raw.normalize(account_id, &host));
            let db = db.clone();
            let note_for_cache = Arc::clone(&note);
            tokio::task::spawn_blocking(move || {
                if let Err(e) = db.ingest_notes(std::slice::from_ref(note_for_cache.as_ref()), &key)
                {
                    tracing::warn!(error = %e, "failed to cache streamed note");
                }
            });
            let payload = StreamNoteEvent {
                account_id: account_id.to_string(),
                subscription_id: sub_id,
                note,
            };
            emit_both(emitter, event_bus, StreamEvent::Note(Box::new(payload)));
        }
    } else if is_note_channel && event_type == "noteUpdated" {
        let note_id = event_body
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned();
        let update_type = event_body
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned();
        let mut event_body = event_body;
        let update_body = event_body
            .get_mut("body")
            .map(Value::take)
            .unwrap_or_default();
        let Some(update) = NoteUpdateBody::from_raw(&update_type, update_body) else {
            tracing::debug!(update_type, "unknown noteUpdated type; dropped");
            return;
        };
        let payload = StreamNoteUpdatedEvent {
            account_id: account_id.to_string(),
            subscription_id: sub_id,
            note_id,
            update,
        };
        emit_both(
            emitter,
            event_bus,
            StreamEvent::NoteUpdated(Box::new(payload)),
        );
    } else if is_main {
        if event_type == "notification" {
            if let Ok(raw) = serde_json::from_value::<RawNotification>(event_body) {
                let notification = raw.normalize(account_id, &host);
                let payload = StreamNotificationEvent {
                    account_id: account_id.to_string(),
                    subscription_id: sub_id,
                    notification,
                };
                emit_both(
                    emitter,
                    event_bus,
                    StreamEvent::Notification(Box::new(payload)),
                );
            }
        } else if event_type == "mention" || event_type == "reply" {
            // main-event として emit しつつ、mention としても parse を試みる
            emitter.emit(StreamEvent::MainEvent(Box::new(StreamMainEvent {
                account_id: account_id.to_string(),
                subscription_id: sub_id.clone(),
                event_type,
                body: event_body.clone(),
            })));

            if let Ok(raw) = serde_json::from_value::<RawNote>(event_body) {
                let note = Arc::new(raw.normalize(account_id, &host));
                let payload = StreamMentionEvent {
                    account_id: account_id.to_string(),
                    subscription_id: sub_id,
                    note,
                };
                emit_both(emitter, event_bus, StreamEvent::Mention(Box::new(payload)));
            }
        } else {
            let payload = StreamMainEvent {
                account_id: account_id.to_string(),
                subscription_id: sub_id,
                event_type,
                body: event_body,
            };
            emit_both(
                emitter,
                event_bus,
                StreamEvent::MainEvent(Box::new(payload)),
            );
        }
    } else if is_chat {
        if event_type == "message" {
            if let Ok(mut msg) = serde_json::from_value::<ChatMessage>(event_body) {
                // Misskey 本家の chat:message WS event は Lite packer 固定で
                // fromUser/toUser を含まない (#460) ため hydrate する。
                api_client
                    .hydrate_chat_message_users(
                        account_host,
                        account_token,
                        std::slice::from_mut(&mut msg),
                    )
                    .await;
                // DB upsert (fire-and-forget)。`account_user_id` は DM partner 計算に必要。
                if let Ok(Some(account)) = db.get_account(account_id) {
                    let db = db.clone();
                    let msg_for_cache = msg.clone();
                    let account_id_owned = account_id.to_string();
                    let host_owned = host.clone();
                    let user_id = account.user_id.clone();
                    tokio::task::spawn_blocking(move || {
                        if let Err(e) = db.cache_chat_message(
                            &msg_for_cache,
                            &account_id_owned,
                            &user_id,
                            &host_owned,
                        ) {
                            tracing::warn!(error = %e, "failed to cache streamed chat message");
                        }
                    });
                }
                let payload = StreamChatMessageEvent {
                    account_id: account_id.to_string(),
                    subscription_id: sub_id,
                    message: msg,
                };
                emit_both(
                    emitter,
                    event_bus,
                    StreamEvent::ChatMessage(Box::new(payload)),
                );
            }
        } else if event_type == "deleted" {
            if let Some(id) = event_body.as_str() {
                let id_owned = id.to_string();
                {
                    let db = db.clone();
                    let account_id_owned = account_id.to_string();
                    let id_for_db = id_owned.clone();
                    tokio::task::spawn_blocking(move || {
                        if let Err(e) = db.delete_cached_chat_message(&account_id_owned, &id_for_db)
                        {
                            tracing::warn!(error = %e, "failed to delete cached chat message");
                        }
                    });
                }
                let payload = StreamChatMessageDeletedEvent {
                    account_id: account_id.to_string(),
                    subscription_id: sub_id,
                    message_id: id_owned,
                };
                emit_both(
                    emitter,
                    event_bus,
                    StreamEvent::ChatMessageDeleted(Box::new(payload)),
                );
            }
        } else if event_type == "react" || event_type == "unreact" {
            let is_react = event_type == "react";
            if let Ok(body) = serde_json::from_value::<ChatReactionWsBody>(event_body) {
                if let Some(user) = body.user.clone() {
                    let db = db.clone();
                    let account_id_owned = account_id.to_string();
                    let message_id = body.message_id.clone();
                    let reaction = body.reaction.clone();
                    tokio::task::spawn_blocking(move || {
                        if let Err(e) = db.apply_chat_message_reaction(
                            &account_id_owned,
                            &message_id,
                            &user,
                            &reaction,
                            is_react,
                        ) {
                            tracing::warn!(error = %e, "failed to apply chat reaction to cache");
                        }
                    });
                }
                if is_react {
                    let payload = StreamChatMessageReactedEvent {
                        account_id: account_id.to_string(),
                        subscription_id: sub_id,
                        message_id: body.message_id,
                        reaction: body.reaction,
                        user: body.user,
                    };
                    emit_both(
                        emitter,
                        event_bus,
                        StreamEvent::ChatMessageReacted(Box::new(payload)),
                    );
                } else {
                    let payload = StreamChatMessageUnreactedEvent {
                        account_id: account_id.to_string(),
                        subscription_id: sub_id,
                        message_id: body.message_id,
                        reaction: body.reaction,
                        user: body.user,
                    };
                    emit_both(
                        emitter,
                        event_bus,
                        StreamEvent::ChatMessageUnreacted(Box::new(payload)),
                    );
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Polling mode
// ---------------------------------------------------------------------------

const MAX_POLL_BACKOFF_SECS: u64 = 60;

/// Per-subscription state for polling (tracks last seen note ID).
struct PollSubState {
    since_id: Option<String>,
}

/// main チャンネル相当 (通知/メンション) の polling カーソル (notedeck#1003)。
/// primed が立つまでは emit しない — 初回サイクルは「取得済みの最新 ID」を
/// 基準点として確立するだけ。過去分をまとめて配ると OS 通知が大量発火する。
#[derive(Default)]
struct MainPollState {
    primed: bool,
    notif_since_id: Option<String>,
    mention_since_id: Option<String>,
}

/// チャット購読ごとの polling カーソル (notedeck#1008)。prime の意味は
/// MainPollState と同じ。
#[derive(Default)]
struct ChatPollState {
    primed: bool,
    since_id: Option<String>,
}

/// Top-level polling task. Periodically fetches notes for all active subscriptions.
#[allow(clippy::too_many_arguments)]
async fn polling_loop(
    api_client: Arc<MisskeyClient>,
    emitter: Arc<dyn FrontendEmitter>,
    event_bus: Arc<EventBus>,
    db: Arc<Database>,
    account_id: String,
    host: String,
    token: String,
    interval: Duration,
    subscriptions: Arc<RwLock<HashMap<String, SubscriptionInfo>>>,
    captured_notes: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
) {
    let mut sub_states: HashMap<String, PollSubState> = HashMap::new();
    let mut main_state = MainPollState::default();
    let mut chat_states: HashMap<String, ChatPollState> = HashMap::new();
    // Cached reaction counts for captured notes (for diff detection).
    let mut note_reaction_cache: HashMap<String, HashMap<String, i64>> = HashMap::new();
    let mut consecutive_failures: u64 = 0;
    let mut poll_count: u64 = 0;

    loop {
        // Check cancellation
        if *cancel_rx.borrow() {
            return;
        }

        // Collect note subscriptions for this account.
        // 購読経路を持つ全 Notes 種別 (timeline / antenna / channel / role /
        // user-list) を polling 対象にする。api_endpoint() を持たない種別は
        // subscribe_notes で弾かれているため到達しない。
        let subs_snapshot: Vec<(String, TimelineKey)> = {
            let subs = subscriptions.read().await;
            subs.iter()
                .filter(|(_, info)| info.account_id == account_id && info.active)
                .filter_map(|(id, info)| match &info.target {
                    SubscriptionTarget::Notes(key) if key.api_endpoint().is_some() => {
                        Some((id.clone(), key.clone()))
                    }
                    _ => None,
                })
                .collect()
        };

        let mut poll_failed = false;

        for (sub_id, key) in &subs_snapshot {
            let state = sub_states
                .entry(sub_id.clone())
                .or_insert(PollSubState { since_id: None });

            let options = TimelineOptions::new(30, state.since_id.clone(), None);

            match api_client
                .get_timeline(&host, &token, &account_id, key, options)
                .await
            {
                Ok(notes) if !notes.is_empty() => {
                    // Update since_id to newest note
                    state.since_id = Some(notes[0].id.clone());

                    // Emit notes in chronological order (oldest first)
                    for note in notes.into_iter().rev() {
                        let note = Arc::new(note);
                        // Cache to DB
                        let db = db.clone();
                        let note_for_cache = Arc::clone(&note);
                        let key = key.clone();
                        tokio::task::spawn_blocking(move || {
                            if let Err(e) =
                                db.ingest_notes(std::slice::from_ref(note_for_cache.as_ref()), &key)
                            {
                                tracing::warn!(error = %e, "failed to cache polled note");
                            }
                        });

                        let payload = StreamNoteEvent {
                            account_id: account_id.clone(),
                            subscription_id: sub_id.clone(),
                            note,
                        };
                        emit_both(
                            emitter.as_ref(),
                            &event_bus,
                            StreamEvent::Note(Box::new(payload)),
                        );
                    }

                    consecutive_failures = 0;
                }
                Ok(_) => {
                    // No new notes — success, reset backoff
                    consecutive_failures = 0;
                }
                Err(e) => {
                    tracing::warn!(
                        account_id = %account_id,
                        subscription_id = %sub_id,
                        error = %e,
                        "polling fetch failed"
                    );
                    poll_failed = true;
                }
            }
        }

        // main チャンネル相当 (通知/メンション) の polling (notedeck#1003)。
        // WS の main と同じイベント種別で emit するため、下流の query
        // ルーティング / OS 通知 / 未読バッジは WS モードとそのまま共通で動く。
        // #984 の dedup により main 購読はアカウントあたり高々 1 本。
        let main_sub_id: Option<String> = {
            let subs = subscriptions.read().await;
            subs.iter()
                .find(|(_, info)| {
                    info.account_id == account_id
                        && info.active
                        && matches!(info.target, SubscriptionTarget::Main)
                })
                .map(|(id, _)| id.clone())
        };
        if let Some(sub_id) = &main_sub_id {
            if !main_state.primed {
                // 初回はカーソル確立のみで emit しない (MainPollState の doc 参照)。
                // 片方でも失敗したら primed を立てず次サイクルでやり直す
                let notif_head = api_client
                    .get_notifications(
                        &host,
                        &token,
                        &account_id,
                        TimelineOptions::new(1, None, None),
                    )
                    .await;
                let mention_head = api_client
                    .get_timeline(
                        &host,
                        &token,
                        &account_id,
                        &TimelineKey::Mentions,
                        TimelineOptions::new(1, None, None),
                    )
                    .await;
                match (notif_head, mention_head) {
                    (Ok(notifs), Ok(mentions)) => {
                        main_state.notif_since_id = notifs.first().map(|n| n.id.clone());
                        main_state.mention_since_id = mentions.first().map(|m| m.id.clone());
                        main_state.primed = true;
                        consecutive_failures = 0;
                    }
                    (notif_res, mention_res) => {
                        for e in [notif_res.err(), mention_res.err()].into_iter().flatten() {
                            tracing::warn!(
                                account_id = %account_id,
                                error = %e,
                                "main polling prime failed"
                            );
                        }
                        poll_failed = true;
                    }
                }
            } else {
                match api_client
                    .get_notifications(
                        &host,
                        &token,
                        &account_id,
                        TimelineOptions::new(30, main_state.notif_since_id.clone(), None),
                    )
                    .await
                {
                    Ok(notifs) if !notifs.is_empty() => {
                        main_state.notif_since_id = Some(notifs[0].id.clone());
                        for notification in notifs.into_iter().rev() {
                            let payload = StreamNotificationEvent {
                                account_id: account_id.clone(),
                                subscription_id: sub_id.clone(),
                                notification,
                            };
                            emit_both(
                                emitter.as_ref(),
                                &event_bus,
                                StreamEvent::Notification(Box::new(payload)),
                            );
                        }
                        consecutive_failures = 0;
                    }
                    Ok(_) => {
                        consecutive_failures = 0;
                    }
                    Err(e) => {
                        tracing::warn!(
                            account_id = %account_id,
                            error = %e,
                            "notification polling failed"
                        );
                        poll_failed = true;
                    }
                }

                match api_client
                    .get_timeline(
                        &host,
                        &token,
                        &account_id,
                        &TimelineKey::Mentions,
                        TimelineOptions::new(30, main_state.mention_since_id.clone(), None),
                    )
                    .await
                {
                    Ok(notes) if !notes.is_empty() => {
                        main_state.mention_since_id = Some(notes[0].id.clone());
                        for note in notes.into_iter().rev() {
                            let payload = StreamMentionEvent {
                                account_id: account_id.clone(),
                                subscription_id: sub_id.clone(),
                                note: Arc::new(note),
                            };
                            emit_both(
                                emitter.as_ref(),
                                &event_bus,
                                StreamEvent::Mention(Box::new(payload)),
                            );
                        }
                        consecutive_failures = 0;
                    }
                    Ok(_) => {
                        consecutive_failures = 0;
                    }
                    Err(e) => {
                        tracing::warn!(
                            account_id = %account_id,
                            error = %e,
                            "mention polling failed"
                        );
                        poll_failed = true;
                    }
                }
            }
        }

        // チャット購読 (chatUser / chatRoom) の polling (notedeck#1008)。
        // WS と同じ ChatMessage イベントで emit する。chat は subscription_id
        // で 1:1 配送されるため購読 ID をそのまま載せる。メッセージ挿入のみ
        // 対応 (既読/リアクション/削除の polling 追随はスコープ外)。
        let chat_snapshot: Vec<(String, SubscriptionTarget)> = {
            let subs = subscriptions.read().await;
            subs.iter()
                .filter(|(_, info)| info.account_id == account_id && info.active)
                .filter_map(|(id, info)| match &info.target {
                    t @ (SubscriptionTarget::ChatUser { .. }
                    | SubscriptionTarget::ChatRoom { .. }) => Some((id.clone(), t.clone())),
                    _ => None,
                })
                .collect()
        };
        // DB キャッシュに own user_id が要る (WS 受信側と同じ)。アカウントは
        // 不変なのでサイクルごとに 1 回だけ引く
        let own_user_id: Option<String> = if chat_snapshot.is_empty() {
            None
        } else {
            db.get_account(&account_id)
                .ok()
                .flatten()
                .map(|a| a.user_id.clone())
        };
        for (sub_id, target) in &chat_snapshot {
            let state = chat_states.entry(sub_id.clone()).or_default();
            let (limit, since) = if state.primed {
                (30, state.since_id.clone())
            } else {
                // 初回はカーソル確立のみで emit しない
                (1, None)
            };
            let result = match target {
                SubscriptionTarget::ChatUser { other_id } => {
                    api_client
                        .get_chat_user_messages(
                            &host,
                            &token,
                            other_id,
                            limit,
                            since.as_deref(),
                            None,
                        )
                        .await
                }
                SubscriptionTarget::ChatRoom { room_id } => {
                    api_client
                        .get_chat_room_messages(
                            &host,
                            &token,
                            room_id,
                            limit,
                            since.as_deref(),
                            None,
                        )
                        .await
                }
                _ => unreachable!("chat_snapshot filters to chat targets"),
            };
            match result {
                Ok(messages) => {
                    if let Some(newest) = messages.first() {
                        state.since_id = Some(newest.id.clone());
                    }
                    if state.primed {
                        for msg in messages.into_iter().rev() {
                            if let Some(user_id) = &own_user_id {
                                let db = db.clone();
                                let msg_for_cache = msg.clone();
                                let account_id_owned = account_id.clone();
                                let host_owned = host.clone();
                                let user_id = user_id.clone();
                                tokio::task::spawn_blocking(move || {
                                    if let Err(e) = db.cache_chat_message(
                                        &msg_for_cache,
                                        &account_id_owned,
                                        &user_id,
                                        &host_owned,
                                    ) {
                                        tracing::warn!(error = %e, "failed to cache polled chat message");
                                    }
                                });
                            }
                            let payload = StreamChatMessageEvent {
                                account_id: account_id.clone(),
                                subscription_id: sub_id.clone(),
                                message: msg,
                            };
                            emit_both(
                                emitter.as_ref(),
                                &event_bus,
                                StreamEvent::ChatMessage(Box::new(payload)),
                            );
                        }
                    } else {
                        state.primed = true;
                    }
                    consecutive_failures = 0;
                }
                Err(e) => {
                    tracing::warn!(
                        account_id = %account_id,
                        subscription_id = %sub_id,
                        error = %e,
                        "chat polling failed"
                    );
                    poll_failed = true;
                }
            }
        }

        // Note capture: poll every 2nd cycle (2x interval)
        poll_count += 1;
        if poll_count.is_multiple_of(2) {
            let note_ids: Vec<String> = {
                let captured = captured_notes.read().await;
                captured
                    .get(&account_id)
                    .map(|s| s.iter().cloned().collect())
                    .unwrap_or_default()
            };

            // Fetch in batches of 8 to balance throughput vs server load
            for chunk in note_ids.chunks(8) {
                let futures: Vec<_> = chunk
                    .iter()
                    .map(|note_id| {
                        let api = api_client.clone();
                        let host = host.clone();
                        let token = token.clone();
                        let account_id = account_id.clone();
                        let note_id = note_id.clone();
                        async move {
                            let result = api.get_note(&host, &token, &account_id, &note_id).await;
                            (note_id, result)
                        }
                    })
                    .collect();

                let results = futures_util::future::join_all(futures).await;

                for (note_id, result) in results {
                    if let Ok(note) = result {
                        // Diff reactions against cache
                        let new_reactions = note.reactions.clone();

                        let old_reactions = note_reaction_cache
                            .get(&note_id)
                            .cloned()
                            .unwrap_or_default();

                        // Find new/increased reactions
                        for (reaction, &new_count) in &new_reactions {
                            let old_count = old_reactions.get(reaction).copied().unwrap_or(0);
                            if new_count > old_count {
                                let payload = StreamNoteCaptureEvent {
                                    account_id: account_id.clone(),
                                    note_id: note_id.clone(),
                                    update: NoteUpdateBody::Reacted(NoteReactedBody {
                                        reaction: reaction.clone(),
                                        emoji: None,
                                        user_id: None,
                                    }),
                                };
                                emitter.emit(StreamEvent::NoteCaptureUpdated(Box::new(payload)));
                            }
                        }

                        // Find removed reactions
                        for reaction in old_reactions.keys() {
                            if !new_reactions.contains_key(reaction) {
                                let payload = StreamNoteCaptureEvent {
                                    account_id: account_id.clone(),
                                    note_id: note_id.clone(),
                                    update: NoteUpdateBody::Unreacted(NoteUnreactedBody {
                                        reaction: reaction.clone(),
                                        user_id: None,
                                    }),
                                };
                                emitter.emit(StreamEvent::NoteCaptureUpdated(Box::new(payload)));
                            }
                        }

                        note_reaction_cache.insert(note_id, new_reactions);
                    }
                }
            }
        }

        // Determine sleep duration
        let sleep_duration = if poll_failed {
            consecutive_failures += 1;
            let backoff = if consecutive_failures > 10 {
                MAX_POLL_BACKOFF_SECS
            } else {
                (1u64 << consecutive_failures.min(5)).min(MAX_POLL_BACKOFF_SECS)
            };

            emitter.emit(StreamEvent::Status(Box::new(StreamStatusEvent {
                account_id: account_id.clone(),
                state: StreamConnectionState::Reconnecting,
            })));

            Duration::from_secs(backoff)
        } else {
            interval
        };

        // Sleep with cancellation check
        tokio::select! {
            _ = tokio::time::sleep(sleep_duration) => {}
            _ = cancel_rx.changed() => {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_jitter_stays_within_equal_jitter_bounds() {
        // Equal Jitter must always land in [backoff/2, backoff] and never panic
        // (from_secs_f64 panics on negative/NaN). Sample across the backoff range.
        for backoff_secs in [1u64, 2, 4, 8, 16, MAX_BACKOFF_SECS] {
            let lo = backoff_secs as f64 / 2.0;
            let hi = backoff_secs as f64;
            for _ in 0..1000 {
                let d = backoff_with_jitter(backoff_secs).as_secs_f64();
                assert!(
                    d >= lo && d <= hi,
                    "backoff {backoff_secs}s jittered to {d}s, outside [{lo}, {hi}]"
                );
            }
        }
    }

    #[test]
    fn stream_note_updated_event_keeps_wire_shape() {
        // #781: NoteUpdateBody を flatten しても歴史的ワイヤ形
        // { noteId, updateType, body } が保たれることの契約テスト。
        let payload = StreamNoteUpdatedEvent {
            account_id: "acc-1".into(),
            subscription_id: "sub-1".into(),
            note_id: "n1".into(),
            update: NoteUpdateBody::from_raw(
                "reacted",
                serde_json::json!({ "reaction": ":+1:", "userId": "u1" }),
            )
            .unwrap(),
        };
        let wire = serde_json::to_value(&payload).unwrap();
        assert_eq!(wire["noteId"], "n1");
        assert_eq!(wire["updateType"], "reacted");
        assert_eq!(wire["body"]["reaction"], ":+1:");
        assert_eq!(wire["accountId"], "acc-1");
    }

    #[test]
    fn read_idle_timeout_exceeds_ping_interval() {
        // The watchdog must outlast the ping cadence, otherwise a live but quiet
        // connection (only kept alive by ping/pong) would be falsely torn down.
        // 3x gives margin for two consecutive lost pongs.
        assert!(WS_READ_IDLE_TIMEOUT >= WS_PING_INTERVAL * 3);
    }

    #[tokio::test]
    async fn emoji_broadcast_messages_become_typed_events() {
        // #889: 本家の broadcast (emojiAdded / emojiUpdated / emojiDeleted) は
        // channel ラップなしのトップレベル type で届く。生 JSON は WS 受信
        // 境界で死に、typed StreamEvent だけが出ていくこと。
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(crate::db::Database::open(&dir.path().join("test.db")).unwrap());
        let api = Arc::new(MisskeyClient::new().unwrap());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let emitter = ChannelEmitter(tx);
        let event_bus = EventBus::new();
        let subs: Arc<RwLock<HashMap<String, SubscriptionInfo>>> =
            Arc::new(RwLock::new(HashMap::new()));

        // added は { emoji } 単数形
        let added = serde_json::json!({
            "type": "emojiAdded",
            "body": { "emoji": { "name": "petthex", "url": "https://h.example/petthex.webp" } }
        })
        .to_string();
        // deleted / updated は { emojis: [...] } 複数形
        let deleted = serde_json::json!({
            "type": "emojiDeleted",
            "body": { "emojis": [
                { "name": "old1", "url": "https://h.example/old1.webp" },
                { "name": "old2", "url": "https://h.example/old2.webp" }
            ] }
        })
        .to_string();
        // 未知のトップレベル type は従来どおり捨てられる
        let unknown = serde_json::json!({ "type": "announcementCreated", "body": {} }).to_string();

        for text in [&added, &deleted, &unknown] {
            handle_ws_message(
                &emitter,
                &event_bus,
                &db,
                &api,
                "acc-1",
                "h.example",
                "tok",
                text,
                &subs,
            )
            .await;
        }

        let StreamEvent::EmojiChanged(e) = rx.recv().await.unwrap() else {
            panic!("expected EmojiChanged");
        };
        assert_eq!(e.change, EmojiChangeKind::Added);
        assert_eq!(e.host, "h.example");
        assert_eq!(e.account_id, "acc-1");
        assert_eq!(e.emojis.len(), 1);
        assert_eq!(e.emojis[0].name, "petthex");
        assert_eq!(e.emojis[0].url, "https://h.example/petthex.webp");

        let StreamEvent::EmojiChanged(e) = rx.recv().await.unwrap() else {
            panic!("expected EmojiChanged");
        };
        assert_eq!(e.change, EmojiChangeKind::Deleted);
        assert_eq!(e.emojis.len(), 2);

        // announcementCreated は emit されない
        assert!(rx.try_recv().is_err());
    }

    /// stream-status イベントを channel に流すテスト用 emitter。
    struct ChannelEmitter(mpsc::UnboundedSender<StreamEvent>);

    impl FrontendEmitter for ChannelEmitter {
        fn emit(&self, event: StreamEvent) {
            let _ = self.0.send(event);
        }
    }

    #[tokio::test]
    async fn connect_failure_hands_off_to_reconnect_loop() {
        // 初回接続に失敗しても Err にせず、再接続ループ入りのハンドルを
        // 残すこと。旧実装は Err を返して再試行の責務が宙に浮き、
        // 「起動直後のネットワーク未確立 = 永久にストリームなし」だった。
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(crate::db::Database::open(&dir.path().join("test.db")).unwrap());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let manager =
            StreamingManager::new(Arc::new(ChannelEmitter(tx)), Arc::new(EventBus::new()), db);

        // 127.0.0.1:1 は即 connection refused になる
        manager
            .connect("acc-1", "127.0.0.1:1", "token")
            .await
            .expect("connect must not error on initial failure");

        // "reconnecting" を 2 回観測する: 1 回目は connect() 自身の emit、
        // 2 回目は connection_task の再接続ループ冒頭の emit。2 回目が
        // 来ること = ループが実際に生きて再試行していることの証明で、
        // 「ループに入らず return する」ミューテーションはここで落ちる
        // (ミューテーション注入で FAILED になることを確認済み)。
        let mut reconnecting_count = 0;
        while reconnecting_count < 2 {
            let event = tokio::time::timeout(Duration::from_secs(10), rx.recv())
                .await
                .expect("timed out waiting for reconnect loop to emit stream-status")
                .expect("emitter channel closed before loop emitted");
            if matches!(
                event,
                StreamEvent::Status(ref s) if s.state == StreamConnectionState::Reconnecting
            ) {
                reconnecting_count += 1;
            }
        }

        // disconnect が backoff 中の Shutdown を届けて task を終了できる
        manager.disconnect("acc-1").await;
    }

    // --- 接続ライフサイクルの状態遷移 (#877) ---
    //
    // connect() は初回接続に失敗してもハンドルを残す (上のテスト) ので、
    // 到達不能な host を使えば実サーバーなしで購読・中断・再開・モード切替の
    // 状態遷移を通せる。WS のフレームそのものではなく、StreamingManager が
    // 持つ表 (connections / subscriptions / captured_notes) の遷移を見る。

    /// 到達不能な host に接続したマネージャ。ハンドルは残るので購読操作は通る。
    async fn manager_with_dead_connection(
        accounts: &[&str],
    ) -> (
        tempfile::TempDir,
        StreamingManager,
        mpsc::UnboundedReceiver<StreamEvent>,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(crate::db::Database::open(&dir.path().join("test.db")).unwrap());
        let (tx, rx) = mpsc::unbounded_channel();
        let manager =
            StreamingManager::new(Arc::new(ChannelEmitter(tx)), Arc::new(EventBus::new()), db);
        for account_id in accounts {
            // 127.0.0.1:1 は即 connection refused
            manager
                .connect(account_id, "127.0.0.1:1", "token")
                .await
                .unwrap();
        }
        (dir, manager, rx)
    }

    fn drain_status(rx: &mut mpsc::UnboundedReceiver<StreamEvent>) -> Vec<StreamConnectionState> {
        let mut out = Vec::new();
        while let Ok(event) = rx.try_recv() {
            if let StreamEvent::Status(s) = event {
                out.push(s.state);
            }
        }
        out
    }

    #[tokio::test]
    async fn connect_is_idempotent_and_reports_the_live_state() {
        // 2 回目の connect は接続を張り直さず、いま持っている実状態を emit する。
        // フロントは復帰時にリスナーを張り直してから connect を呼ぶので、
        // ここで status が出ないと背景化中の遷移を取り逃したままになる。
        let (_dir, manager, mut rx) = manager_with_dead_connection(&["acc-1"]).await;
        drain_status(&mut rx);

        manager
            .connect("acc-1", "127.0.0.1:1", "token")
            .await
            .unwrap();

        // 接続タスクは 1 本のまま (張り直していない)
        assert_eq!(manager.connections.lock().await.len(), 1);
        // 未接続なので Reconnecting が返る (楽観的に Connected と言わない)
        assert!(
            drain_status(&mut rx).contains(&StreamConnectionState::Reconnecting),
            "冪等 return でも現在状態を emit すること"
        );

        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn subscribe_without_connection_reports_no_connection() {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(crate::db::Database::open(&dir.path().join("test.db")).unwrap());
        let (tx, _rx) = mpsc::unbounded_channel();
        let manager =
            StreamingManager::new(Arc::new(ChannelEmitter(tx)), Arc::new(EventBus::new()), db);

        let err = manager
            .subscribe_notes("acc-1", TimelineKey::parse("home").unwrap(), None)
            .await
            .expect_err("接続していないアカウントの購読は通らない");
        assert_eq!(err.code(), "NO_CONNECTION");
        // 失敗した購読が表に残らない
        assert!(manager.subscriptions.read().await.is_empty());
    }

    #[tokio::test]
    async fn disconnect_clears_only_that_accounts_state() {
        // cross-account (#777): 片方を切っても、もう片方の購読と capture は残る。
        let (_dir, manager, mut rx) = manager_with_dead_connection(&["acc-1", "acc-2"]).await;
        let sub1 = manager
            .subscribe_notes("acc-1", TimelineKey::parse("home").unwrap(), None)
            .await
            .unwrap();
        let sub2 = manager
            .subscribe_notes("acc-2", TimelineKey::parse("local").unwrap(), None)
            .await
            .unwrap();
        manager.sub_note("acc-1", "note-1").await.unwrap();
        manager.sub_note("acc-2", "note-2").await.unwrap();
        drain_status(&mut rx);

        manager.disconnect("acc-1").await;

        let subs = manager.subscriptions.read().await;
        assert!(!subs.contains_key(&sub1), "切断した側の購読は消える");
        assert!(subs.contains_key(&sub2), "他アカウントの購読は残る");
        drop(subs);
        let captured = manager.captured_notes.read().await;
        assert!(!captured.contains_key("acc-1"));
        assert!(captured.contains_key("acc-2"));
        drop(captured);
        assert!(drain_status(&mut rx).contains(&StreamConnectionState::Disconnected));

        manager.disconnect("acc-2").await;
    }

    #[tokio::test]
    async fn suspend_then_resume_round_trips_the_active_flag() {
        // ビューポート予算で使う中断/再開。metadata を捨てずに active だけを倒す
        // (捨てると再接続リプレイと再開で channel / params を復元できない)。
        let (_dir, manager, _rx) = manager_with_dead_connection(&["acc-1"]).await;
        let sub = manager
            .subscribe_notes("acc-1", TimelineKey::parse("home").unwrap(), None)
            .await
            .unwrap();

        manager.suspend_subscription("acc-1", &sub).await.unwrap();
        {
            let subs = manager.subscriptions.read().await;
            let info = subs.get(&sub).expect("中断しても metadata は残る");
            assert!(!info.active);
            let (channel, _) = info.channel_and_params().unwrap();
            assert_eq!(channel, "homeTimeline");
        }
        // 二重中断は no-op で成功する (UI 側で状態を持たなくてよい)
        manager.suspend_subscription("acc-1", &sub).await.unwrap();

        manager.resume_subscription("acc-1", &sub).await.unwrap();
        assert!(manager.subscriptions.read().await[&sub].active);
        // 二重再開も no-op
        manager.resume_subscription("acc-1", &sub).await.unwrap();

        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn subscribe_main_is_deduped_per_account() {
        // Misskey の main は shouldShare チャンネルで、同一 WS 接続に 2 本目を
        // connect してもサーバーが黙って無視する (エラーも返らない)。
        // 同一アカウントの subscribe_main は既存の購読 ID を返して 1 本に保つ。
        let (_dir, manager, _rx) = manager_with_dead_connection(&["acc-1", "acc-2"]).await;

        let first = manager.subscribe_main("acc-1").await.unwrap();
        let second = manager.subscribe_main("acc-1").await.unwrap();
        assert_eq!(first, second, "同一アカウントの main は同じ購読 ID を返す");

        let other = manager.subscribe_main("acc-2").await.unwrap();
        assert_ne!(first, other, "別アカウントの main は独立");

        let subs = manager.subscriptions.read().await;
        let main_count = subs
            .values()
            .filter(|info| matches!(info.target, SubscriptionTarget::Main))
            .count();
        assert_eq!(main_count, 2, "表にはアカウントごとに 1 エントリだけ");
        drop(subs);

        manager.disconnect("acc-1").await;
        manager.disconnect("acc-2").await;
    }

    #[tokio::test]
    async fn main_subscription_survives_unsubscribe_and_suspend() {
        // main はカラムの購読ではなくアカウントセッションのチャンネル。
        // 通知・メンション・OS 通知・未読バッジが全部ぶら下がるので、
        // カラム close (unsubscribe) や viewport 予算の suspend で
        // 共有 main を巻き添えにしてはならない。解放は disconnect のみ。
        let (_dir, manager, _rx) = manager_with_dead_connection(&["acc-1"]).await;
        let sub = manager.subscribe_main("acc-1").await.unwrap();

        manager.unsubscribe("acc-1", &sub).await.unwrap();
        assert!(
            manager.subscriptions.read().await.contains_key(&sub),
            "unsubscribe しても main は表に残る"
        );

        manager.suspend_subscription("acc-1", &sub).await.unwrap();
        assert!(
            manager.subscriptions.read().await[&sub].active,
            "suspend しても main は active のまま"
        );

        manager.disconnect("acc-1").await;
        assert!(
            !manager.subscriptions.read().await.contains_key(&sub),
            "disconnect では main も解放される"
        );
    }

    #[tokio::test]
    async fn suspend_and_resume_reject_another_accounts_subscription() {
        // 購読 ID を知っていても、持ち主でなければ触れない。
        let (_dir, manager, _rx) = manager_with_dead_connection(&["acc-1", "acc-2"]).await;
        let sub = manager
            .subscribe_notes("acc-1", TimelineKey::parse("home").unwrap(), None)
            .await
            .unwrap();

        let err = manager
            .suspend_subscription("acc-2", &sub)
            .await
            .expect_err("他アカウントの購読は中断できない");
        assert_eq!(err.code(), "INVALID_INPUT");
        assert!(
            manager.subscriptions.read().await[&sub].active,
            "拒否したのに active を倒してはいけない"
        );

        manager.suspend_subscription("acc-1", &sub).await.unwrap();
        let err = manager
            .resume_subscription("acc-2", &sub)
            .await
            .expect_err("他アカウントの購読は再開できない");
        assert_eq!(err.code(), "INVALID_INPUT");
        assert!(!manager.subscriptions.read().await[&sub].active);

        manager.disconnect("acc-1").await;
        manager.disconnect("acc-2").await;
    }

    #[tokio::test]
    async fn unknown_subscription_is_rejected_not_silently_ignored() {
        let (_dir, manager, _rx) = manager_with_dead_connection(&["acc-1"]).await;
        assert_eq!(
            manager
                .suspend_subscription("acc-1", "no-such-sub")
                .await
                .expect_err("存在しない購読")
                .code(),
            "INVALID_INPUT"
        );
        assert_eq!(
            manager
                .resume_subscription("acc-1", "no-such-sub")
                .await
                .expect_err("存在しない購読")
                .code(),
            "INVALID_INPUT"
        );
        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn note_capture_survives_until_explicitly_dropped() {
        // captured_notes は再接続時のリプレイ元。sub_note が表に載せないと
        // 最初の再接続以降 noteUpdated が黙って止まる。
        let (_dir, manager, _rx) = manager_with_dead_connection(&["acc-1"]).await;

        manager.sub_note("acc-1", "note-1").await.unwrap();
        manager.sub_note("acc-1", "note-2").await.unwrap();
        assert_eq!(manager.captured_notes.read().await["acc-1"].len(), 2);

        manager.unsub_note("acc-1", "note-1").await.unwrap();
        assert_eq!(manager.captured_notes.read().await["acc-1"].len(), 1);

        // 最後の 1 件を外すとアカウントのエントリごと消える (空 set を残さない)
        manager.unsub_note("acc-1", "note-2").await.unwrap();
        assert!(!manager.captured_notes.read().await.contains_key("acc-1"));

        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn set_mode_rejects_unknown_mode() {
        let (_dir, manager, _rx) = manager_with_dead_connection(&["acc-1"]).await;
        let err = manager
            .set_mode("acc-1", "127.0.0.1:1", "token", "carrier-pigeon", None)
            .await
            .expect_err("未知のモード");
        assert_eq!(err.code(), "INVALID_INPUT");
        // 既存の接続を壊していない
        assert_eq!(manager.connections.lock().await.len(), 1);
        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn switching_to_polling_keeps_subscriptions_and_swaps_the_transport() {
        // モード切替は輸送路だけを差し替える。購読を捨てると切替のたびに
        // カラムが空になる。
        let (_dir, manager, mut rx) = manager_with_dead_connection(&["acc-1"]).await;
        let sub = manager
            .subscribe_notes("acc-1", TimelineKey::parse("home").unwrap(), None)
            .await
            .unwrap();
        drain_status(&mut rx);

        manager
            .set_mode("acc-1", "127.0.0.1:1", "token", "polling", Some(60_000))
            .await
            .unwrap();

        assert!(
            manager.connections.lock().await.is_empty(),
            "polling へ移ったら WS 接続は畳む"
        );
        assert!(manager.poll_connections.lock().await.contains_key("acc-1"));
        assert!(
            manager.subscriptions.read().await.contains_key(&sub),
            "購読はモードをまたいで残る"
        );
        assert!(drain_status(&mut rx).contains(&StreamConnectionState::Connected));

        // polling 中でも購読を足せる (WS コマンドではなく表に載るだけ)
        let sub2 = manager
            .subscribe_notes("acc-1", TimelineKey::parse("local").unwrap(), None)
            .await
            .unwrap();
        assert!(manager.subscriptions.read().await.contains_key(&sub2));

        // realtime へ戻すと polling を止めて WS を張り直す
        manager
            .set_mode("acc-1", "127.0.0.1:1", "token", "realtime", None)
            .await
            .unwrap();
        assert!(manager.poll_connections.lock().await.is_empty());
        assert_eq!(manager.connections.lock().await.len(), 1);
        assert!(manager.subscriptions.read().await.contains_key(&sub));

        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn connect_does_not_resurrect_websocket_while_polling() {
        // フロントはカラムのマウントや復帰のたびに connect() を無条件に呼ぶ。
        // polling 中に WS が復活すると、永続化されたモードと実動作が乖離する
        // (notedeck#1004)。connect は「ストリームを現在のモードで確保する」であって
        // 「WS を強制する」ではない。
        let (_dir, manager, mut rx) = manager_with_dead_connection(&["acc-1"]).await;
        manager
            .set_mode("acc-1", "127.0.0.1:1", "token", "polling", Some(60_000))
            .await
            .unwrap();
        drain_status(&mut rx);

        manager
            .connect("acc-1", "127.0.0.1:1", "token")
            .await
            .unwrap();

        assert!(
            manager.connections.lock().await.is_empty(),
            "polling 中の connect は WS を張らない"
        );
        assert!(manager.poll_connections.lock().await.contains_key("acc-1"));
        // polling がストリームを供給中なので Connected として報告する
        assert!(
            drain_status(&mut rx).contains(&StreamConnectionState::Connected),
            "冪等 return でも現在状態を emit すること"
        );

        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn polling_delivers_main_channel_notifications_and_mentions() {
        // ポーリングモードでは main チャンネル (WS) が無いため、通知・メンションの
        // 取得経路がそもそも存在しなかった (notedeck#1003)。polling_loop が main
        // 購読を検出して i/notifications / notes/mentions を定期取得し、WS と同じ
        // イベント種別で配ることを検証する。初回サイクルはカーソル確立のみで
        // emit しない (過去分をまとめて OS 通知として発火させないため)。
        use serde_json::json;
        use wiremock::matchers::{body_partial_json, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        fn raw_note_json(id: &str, text: &str) -> serde_json::Value {
            json!({
                "id": id,
                "createdAt": "2025-01-01T00:00:00.000Z",
                "text": text,
                "user": {"id": "u1", "username": "taka"},
                "visibility": "public"
            })
        }
        fn raw_notification_json(id: &str) -> serde_json::Value {
            json!({
                "id": id,
                "createdAt": "2025-01-01T00:00:00.000Z",
                "type": "reaction",
                "user": {"id": "u1", "username": "taka"},
                "note": raw_note_json("n1", "hello"),
                "reaction": ":star:"
            })
        }

        let server = MockServer::start().await;
        // 初回 prime (limit 1・sinceId なし): 既存分を返す。emit されないこと
        Mock::given(method("POST"))
            .and(path("/api/i/notifications"))
            .and(body_partial_json(json!({"limit": 1})))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!([raw_notification_json("notif-old")])),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/notes/mentions"))
            .and(body_partial_json(json!({"limit": 1})))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([raw_note_json("m-old", "old")])),
            )
            .mount(&server)
            .await;
        // 2 回目以降: prime で確立したカーソル付きで新着を返す
        Mock::given(method("POST"))
            .and(path("/api/i/notifications"))
            .and(body_partial_json(json!({"sinceId": "notif-old"})))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!([raw_notification_json("notif-new")])),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/notes/mentions"))
            .and(body_partial_json(json!({"sinceId": "m-old"})))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([raw_note_json("m-new", "new")])),
            )
            .mount(&server)
            .await;
        // それ以外 (消化後のカーソル付きリクエスト等) は空
        Mock::given(method("POST"))
            .and(path("/api/i/notifications"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/notes/mentions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(crate::db::Database::open(&dir.path().join("test.db")).unwrap());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut manager =
            StreamingManager::new(Arc::new(ChannelEmitter(tx)), Arc::new(EventBus::new()), db);
        manager.api_client = Arc::new(MisskeyClient::with_base_url(&server.uri()));

        manager
            .set_mode("acc-1", "127.0.0.1:1", "token", "polling", Some(100))
            .await
            .unwrap();
        manager.subscribe_main("acc-1").await.unwrap();

        // prime → 次サイクルの新着 emit まで待つ
        let mut notif_ids = Vec::new();
        let mut mention_ids = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while (notif_ids.is_empty() || mention_ids.is_empty())
            && tokio::time::Instant::now() < deadline
        {
            match tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
                Ok(Some(StreamEvent::Notification(e))) => {
                    assert_eq!(e.account_id, "acc-1");
                    notif_ids.push(e.notification.id.clone());
                }
                Ok(Some(StreamEvent::Mention(e))) => {
                    assert_eq!(e.account_id, "acc-1");
                    mention_ids.push(e.note.id.clone());
                }
                Ok(Some(_)) => {}
                _ => {}
            }
        }

        // prime 分 (notif-old / m-old) は emit されず、新着だけが届く
        assert_eq!(notif_ids, vec!["notif-new"], "通知は新着のみ配信されること");
        assert_eq!(
            mention_ids,
            vec!["m-new"],
            "メンションは新着のみ配信されること"
        );

        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn polling_delivers_chat_messages() {
        // ポーリングモードではチャット購読 (chatUser / chatRoom) の取得経路が
        // 存在しなかった (notedeck#1008)。polling_loop がチャット購読を検出して
        // user-timeline / room-timeline を定期取得し、WS と同じ ChatMessage
        // イベントで配ることを検証する。chat は subscription_id で 1:1 配送
        // されるため、購読 ID が正しく載ることも見る。
        use serde_json::json;
        use wiremock::matchers::{body_partial_json, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        fn chat_message_json(id: &str) -> serde_json::Value {
            json!({
                "id": id,
                "createdAt": "2025-01-01T00:00:00.000Z",
                "fromUserId": "u-other",
                "fromUser": {"id": "u-other", "name": null, "username": "they",
                             "host": null, "avatarUrl": null},
                "toUserId": "u-self",
                "toUser": {"id": "u-self", "name": null, "username": "me",
                           "host": null, "avatarUrl": null},
                "toRoomId": null,
                "toRoom": null,
                "text": "hi",
                "fileId": null,
                "file": null,
                "isRead": false,
                "reactions": []
            })
        }

        let server = MockServer::start().await;
        // 初回 prime (limit 1): 既存分。emit されないこと
        Mock::given(method("POST"))
            .and(path("/api/chat/messages/user-timeline"))
            .and(body_partial_json(json!({"limit": 1})))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([chat_message_json("msg-old")])),
            )
            .mount(&server)
            .await;
        // 2 回目以降: カーソル付きで新着
        Mock::given(method("POST"))
            .and(path("/api/chat/messages/user-timeline"))
            .and(body_partial_json(json!({"sinceId": "msg-old"})))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([chat_message_json("msg-new")])),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/chat/messages/user-timeline"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(crate::db::Database::open(&dir.path().join("test.db")).unwrap());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut manager =
            StreamingManager::new(Arc::new(ChannelEmitter(tx)), Arc::new(EventBus::new()), db);
        manager.api_client = Arc::new(MisskeyClient::with_base_url(&server.uri()));

        manager
            .set_mode("acc-1", "127.0.0.1:1", "token", "polling", Some(100))
            .await
            .unwrap();
        let sub_id = manager
            .subscribe_chat_user("acc-1", "u-other")
            .await
            .unwrap();

        let mut message_ids = Vec::new();
        let mut sub_ids = Vec::new();
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while message_ids.is_empty() && tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
                Ok(Some(StreamEvent::ChatMessage(e))) => {
                    assert_eq!(e.account_id, "acc-1");
                    message_ids.push(e.message.id.clone());
                    sub_ids.push(e.subscription_id.clone());
                }
                Ok(Some(_)) => {}
                _ => {}
            }
        }

        assert_eq!(
            message_ids,
            vec!["msg-new"],
            "チャットは新着のみ配信されること"
        );
        assert_eq!(
            sub_ids,
            vec![sub_id],
            "1:1 配送に使う subscription_id が購読 ID と一致すること"
        );

        manager.disconnect("acc-1").await;
    }

    #[tokio::test]
    async fn unsubscribe_drops_the_subscription_in_both_modes() {
        let (_dir, manager, _rx) = manager_with_dead_connection(&["acc-1"]).await;
        let sub = manager
            .subscribe_notes("acc-1", TimelineKey::parse("home").unwrap(), None)
            .await
            .unwrap();

        manager.unsubscribe("acc-1", &sub).await.unwrap();
        assert!(manager.subscriptions.read().await.is_empty());

        // 接続が無くなっても unsubscribe は表を掃除して成功する
        manager.disconnect("acc-1").await;
        manager.unsubscribe("acc-1", &sub).await.unwrap();
    }
}
