use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notecli::models::NormalizedNotification;
use notecli::streaming::FrontendEmitter;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_specta::Event;

// #781: specta 契約に載せる typed イベント。notecli の型を newtype で包む
// (serde/specta とも透過なのでワイヤ形・TS 型は中身そのもの)。

/// 統合チャネル (イベント名 "stream-envelope")。全イベントを { kind, payload }
/// の tagged union で流す。Inspector の raw tap と未読カウンタが購読する。
/// 名前が notecli::streaming::StreamEvent と衝突すると specta の TS 出力が
/// 壊れるため、newtype は別名にしている。
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamEnvelope(pub notecli::streaming::StreamEvent);

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamStatus(pub notecli::streaming::StreamStatusEvent);

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamChatMessageReacted(pub notecli::streaming::StreamChatMessageReactedEvent);

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamChatMessageUnreacted(pub notecli::streaming::StreamChatMessageUnreactedEvent);

#[cfg(target_os = "android")]
const NOTIFICATION_CHANNEL_ID: &str = "notedeck_notifications";

/// Maximum number of notification IDs to keep for deduplication.
/// When exceeded, the set is cleared to prevent unbounded growth.
const DEDUP_MAX_IDS: usize = 500;

/// デスクトップ OS 通知のバースト集約窓 (#750)。直前の OS 通知からこの時間内に
/// 届いた通知は個別に出さずバッファし、窓の終わりに要約 1 件へまとめる。
/// Android は channel で OS 側がグルーピングするため対象外。
const GROUP_WINDOW: Duration = Duration::from_secs(2);

/// 要約 body に列挙する通知元 (title) の最大数。超過分は「ほか」に畳む。
const GROUP_MAX_NAMES: usize = 3;

/// バッファ中の OS 通知 1 件分。title はアクター系なら送信元ユーザー名。
struct PendingOsNotification {
    title: String,
    body: Option<String>,
}

/// send_native_notification の判定結果。表示 (副作用) と分離してテスト可能にする。
enum OsNotifPlan {
    /// dedup 済み・未知 type・フォーカス中 → 何もしない
    Suppress,
    /// 個別に即時表示 (バースト外の 1 件目 / Android)
    ShowNow { title: String, body: Option<String> },
    /// バーストとしてバッファ済み。spawn_flusher が true なら flush タスクを起動する
    #[cfg_attr(target_os = "android", allow(dead_code))]
    Buffer { spawn_flusher: bool },
}

/// バッファを要約して表示内容にする。1 件ならそのまま、複数件なら
/// 「新着通知 N 件」+ 通知元名の列挙 (dedup、GROUP_MAX_NAMES 超は「ほか」)。
fn summarize_group(items: &[PendingOsNotification]) -> Option<(String, Option<String>)> {
    match items {
        [] => None,
        [single] => Some((single.title.clone(), single.body.clone())),
        _ => {
            let mut names: Vec<&str> = Vec::new();
            for item in items {
                if !names.contains(&item.title.as_str()) {
                    names.push(&item.title);
                }
            }
            let body = if names.len() > GROUP_MAX_NAMES {
                format!("{} ほか", names[..GROUP_MAX_NAMES].join("、"))
            } else {
                names.join("、")
            };
            Some((format!("新着通知 {} 件", items.len()), Some(body)))
        }
    }
}

fn show_os_notification<R: tauri::Runtime>(app: &AppHandle<R>, title: &str, body: Option<&str>) {
    let mut builder = app.notification().builder().title(title);
    if let Some(body) = body {
        builder = builder.body(body);
    }
    #[cfg(target_os = "android")]
    {
        builder = builder.channel_id(NOTIFICATION_CHANNEL_ID);
    }
    if let Err(e) = builder.show() {
        tracing::warn!("[notification] failed to send: {e}");
    }
}

// Runtime generic は MockRuntime でのユニットテスト用。本番は default の Wry
// のみで、挙動は非 generic 時と同一。
pub struct TauriEmitter<R: tauri::Runtime = tauri::Wry> {
    app: AppHandle<R>,
    /// Tracks recently shown notification IDs to prevent duplicate OS notifications
    /// when multiple subscriptions exist for the same account.
    recent_notif_ids: Mutex<HashSet<String>>,
    /// 直近に OS 通知を出した (またはバッファした) 時刻。バースト判定用。
    #[cfg(not(target_os = "android"))]
    last_os_notif: Mutex<Option<Instant>>,
    /// バースト中の未表示通知。flusher タスクが GROUP_WINDOW 後に drain する。
    #[cfg(not(target_os = "android"))]
    pending_group: Arc<Mutex<Vec<PendingOsNotification>>>,
}

impl<R: tauri::Runtime> TauriEmitter<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        #[cfg(target_os = "android")]
        {
            use tauri_plugin_notification::{Channel, Importance};
            let channel = Channel::builder(NOTIFICATION_CHANNEL_ID, "通知")
                .importance(Importance::Default)
                .build();
            let _ = app.notification().create_channel(channel);
        }
        Self {
            app,
            recent_notif_ids: Mutex::new(HashSet::new()),
            #[cfg(not(target_os = "android"))]
            last_os_notif: Mutex::new(None),
            #[cfg(not(target_os = "android"))]
            pending_group: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn send_native_notification(&self, notification: &NormalizedNotification) {
        match self.plan_os_notification(notification) {
            OsNotifPlan::Suppress => {}
            OsNotifPlan::ShowNow { title, body } => {
                show_os_notification(&self.app, &title, body.as_deref());
            }
            OsNotifPlan::Buffer { spawn_flusher } => {
                #[cfg(not(target_os = "android"))]
                if spawn_flusher {
                    let app = self.app.clone();
                    let pending = Arc::clone(&self.pending_group);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(GROUP_WINDOW).await;
                        let items = std::mem::take(&mut *pending.lock().unwrap());
                        if let Some((title, body)) = summarize_group(&items) {
                            show_os_notification(&app, &title, body.as_deref());
                        }
                    });
                }
                #[cfg(target_os = "android")]
                let _ = spawn_flusher;
            }
        }
    }

    /// OS 通知の表示可否・形態を判定する。表示副作用は持たない (テスト用に分離)。
    fn plan_os_notification(&self, notification: &NormalizedNotification) -> OsNotifPlan {
        // Deduplicate by notification ID — multiple subscriptions for the same
        // account can trigger this function more than once for a single notification.
        {
            let mut seen = self.recent_notif_ids.lock().unwrap();
            if !seen.insert(notification.id.clone()) {
                return OsNotifPlan::Suppress;
            }
            if seen.len() > DEDUP_MAX_IDS {
                seen.clear();
            }
        }

        let notif_type = notification.notification_type.as_str();

        // アクター系: 送信元ユーザーを title に。user が欠落したら "誰か" で従来挙動を維持。
        let actor_name = || {
            notification
                .user
                .as_ref()
                .and_then(|u| u.name.as_deref().or(Some(u.username.as_str())))
                .unwrap_or("誰か")
                .to_string()
        };

        // Misskey 本家 (packages/sw/src/scripts/create-notification.ts) に合わせ、
        // アクター系 (title = user) と自己/システム通知 (title = 固定ラベル) を分ける。
        let (title, body_opt): (String, Option<String>) = match notif_type {
            "reaction" => {
                let body = notification
                    .reaction
                    .as_deref()
                    .map(|r| format!("リアクション {r}"))
                    .unwrap_or_else(|| "リアクション".to_string());
                (actor_name(), Some(body))
            }
            "reply" => (actor_name(), Some("リプライ".to_string())),
            "renote" => (actor_name(), Some("リノート".to_string())),
            "quote" => (actor_name(), Some("引用".to_string())),
            "mention" => (actor_name(), Some("メンション".to_string())),
            "follow" => (actor_name(), Some("フォロー".to_string())),
            "followRequestAccepted" => (actor_name(), Some("フォローリクエスト承認".to_string())),
            "receiveFollowRequest" => (actor_name(), Some("フォローリクエスト".to_string())),

            // user フィールドを持たない自己/システム通知
            "achievementEarned" => {
                let body = notification
                    .achievement
                    .as_deref()
                    .map(|a| achievement_label(a).to_string());
                ("実績獲得".to_string(), body)
            }
            "login" => ("ログイン検知".to_string(), None),
            "pollEnded" => ("投票終了".to_string(), None),
            "app" => ("通知".to_string(), None),
            "test" => ("テスト通知".to_string(), Some("テスト通知".to_string())),

            _ => return OsNotifPlan::Suppress,
        };

        // Android は webview が凍結されうるため常に即時表示 (グルーピングは
        // channel 経由で OS が行う)
        #[cfg(target_os = "android")]
        {
            OsNotifPlan::ShowNow {
                title,
                body: body_opt,
            }
        }

        #[cfg(not(target_os = "android"))]
        {
            // フォーカス中はアプリ内表示 + 音で足りるため OS 通知は出さない (#704 K)。
            let focused = self
                .app
                .get_webview_window("main")
                .map(|w| w.is_focused().unwrap_or(false))
                .unwrap_or(false);
            if focused {
                return OsNotifPlan::Suppress;
            }

            // バースト集約 (#750): 直近の通知から GROUP_WINDOW 内ならバッファし、
            // flusher が窓の終わりに要約 1 件へまとめる。窓外の 1 件目は即時表示。
            let now = Instant::now();
            let mut last = self.last_os_notif.lock().unwrap();
            let in_burst = last.is_some_and(|t| now.duration_since(t) < GROUP_WINDOW);
            *last = Some(now);
            if !in_burst {
                return OsNotifPlan::ShowNow {
                    title,
                    body: body_opt,
                };
            }
            let mut pending = self.pending_group.lock().unwrap();
            let spawn_flusher = pending.is_empty();
            pending.push(PendingOsNotification {
                title,
                body: body_opt,
            });
            OsNotifPlan::Buffer { spawn_flusher }
        }
    }
}

fn achievement_label(name: &str) -> &str {
    match name {
        "notes1" => "はじめてのノート",
        "notes10" => "10ノート",
        "notes100" => "100ノート",
        "notes500" => "500ノート",
        "notes1000" => "1,000ノート",
        "notes5000" => "5,000ノート",
        "notes10000" => "10,000ノート",
        "notes20000" => "20,000ノート",
        "notes30000" => "30,000ノート",
        "notes40000" => "40,000ノート",
        "notes50000" => "50,000ノート",
        "notes60000" => "60,000ノート",
        "notes70000" => "70,000ノート",
        "notes80000" => "80,000ノート",
        "notes90000" => "90,000ノート",
        "notes100000" => "100,000ノート",
        "login3" => "ログイン3日",
        "login7" => "ログイン7日",
        "login15" => "ログイン15日",
        "login30" => "ログイン30日",
        "login60" => "ログイン60日",
        "login100" => "ログイン100日",
        "login200" => "ログイン200日",
        "login300" => "ログイン300日",
        "login400" => "ログイン400日",
        "login500" => "ログイン500日",
        "login600" => "ログイン600日",
        "login700" => "ログイン700日",
        "login800" => "ログイン800日",
        "login900" => "ログイン900日",
        "login1000" => "ログイン1,000日",
        "passedSinceAccountCreated1" => "アカウント作成から1年",
        "passedSinceAccountCreated2" => "アカウント作成から2年",
        "passedSinceAccountCreated3" => "アカウント作成から3年",
        "loggedInOnBirthday" => "誕生日にログイン",
        "loggedInOnNewYearsDay" => "元日にログイン",
        "noteClipped1" => "はじめてのクリップ",
        "noteFavorited1" => "はじめてのお気に入り",
        "myNoteFavorited1" => "お気に入りされた",
        "profileFilled" => "プロフィール設定",
        "markedAsCat" => "Cat",
        "following1" => "はじめてのフォロー",
        "following10" => "10フォロー",
        "following50" => "50フォロー",
        "following100" => "100フォロー",
        "following300" => "300フォロー",
        "followers1" => "はじめてのフォロワー",
        "followers10" => "10フォロワー",
        "followers50" => "50フォロワー",
        "followers100" => "100フォロワー",
        "followers300" => "300フォロワー",
        "followers500" => "500フォロワー",
        "followers1000" => "1,000フォロワー",
        "collectAchievements30" => "実績コレクター",
        "viewAchievements3min" => "実績を眺める",
        "iLoveMisskey" => "I Love Misskey",
        "foundTreasure" => "隠された宝物",
        "client30min" => "30分利用",
        "client60min" => "60分利用",
        "noteDeletedWithin1min" => "1分以内に削除",
        "postedAtLateNight" => "深夜の投稿",
        "postedAt0min0sec" => "ジャスト0分0秒",
        "selfQuote" => "セルフ引用",
        "htl20npm" => "TLが速い",
        "viewInstanceChart" => "インスタンスチャートを見る",
        "outputHelloWorldOnScratchpad" => "Hello, World!",
        "open3windows" => "3つのウィンドウ",
        "driveFolderCircularReference" => "循環参照",
        "reactWithoutRead" => "読まずにリアクション",
        "clickedClickHere" => "ここをクリック",
        "justPlainLucky" => "ただの幸運",
        "setNameToSyuilo" => "しゅいろの名前",
        "cookieClicked" => "クッキークリック",
        "brainDiver" => "Brain Diver",
        "smashTestNotificationButton" => "通知テスト連打",
        "tutorialCompleted" => "チュートリアル完了",
        "bubbleGameExplodingHead" => "バブルゲーム",
        "bubbleGameDoubleExplodingHead" => "バブルゲーム(ダブル)",
        _ => name,
    }
}

impl<R: tauri::Runtime> FrontendEmitter for TauriEmitter<R> {
    fn emit(&self, event: notecli::streaming::StreamEvent) {
        use notecli::streaming::StreamEvent as E;

        if let Some(runtime) = self.app.try_state::<crate::query_runtime::QueryRuntime>() {
            if runtime.ingest_stream_event(&event) {
                // 常駐 flusher が DELTA_FLUSH_WINDOW 後に drain して emit する。
                runtime.flush_notify().notify_one();
            }
        }

        // stream-note-capture-updated は QueryRuntime が NoteCaptureBatch に
        // まとめて emit するので、個別 stream-event は抑止 (IPC 削減)。
        // StreamInspector は元から ALL_KINDS に capture を含まないので影響なし。
        if matches!(event, E::NoteCaptureUpdated(_)) {
            return;
        }

        // 個別チャネル: 消費者が firehose (stream-event) を購読せずに済むよう、
        // 契約済みイベントは専用チャネルにも流す
        let dedicated = match &event {
            E::Notification(e) => {
                self.send_native_notification(&e.notification);
                None
            }
            E::Status(e) => StreamStatus((**e).clone()).emit(&self.app).err(),
            E::ChatMessageReacted(e) => StreamChatMessageReacted((**e).clone())
                .emit(&self.app)
                .err(),
            E::ChatMessageUnreacted(e) => StreamChatMessageUnreacted((**e).clone())
                .emit(&self.app)
                .err(),
            _ => None,
        };
        if let Some(e) = dedicated {
            tracing::warn!("[stream] dedicated emit failed: {e}");
        }

        // 統合チャネル: { kind, payload } の tagged union。Inspector の raw tap
        // と未読カウンタが購読する
        let kind = event.kind();
        if let Err(e) = StreamEnvelope(event).emit(&self.app) {
            tracing::warn!("[stream] emit {kind} failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    use notecli::models::NormalizedNote;
    use notecli::models::TimelineType;
    use notecli::streaming::{
        StreamConnectionState, StreamEvent, StreamNoteCaptureEvent, StreamNoteEvent,
        StreamNotificationEvent, StreamStatusEvent,
    };
    use serde_json::json;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::{App, Manager};

    use crate::query_runtime::{QueryKey, QueryRuntime};

    const RECV_TIMEOUT: Duration = Duration::from_secs(1);

    /// MockRuntime app を組み、production (lib.rs) と同じ streaming イベントを
    /// mount する。mount しないと tauri_specta の emit が panic する。
    fn mock_app() -> App<MockRuntime> {
        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("mock app should build");
        tauri_specta::Builder::<MockRuntime>::new()
            .events(tauri_specta::collect_events![
                StreamEnvelope,
                StreamStatus,
                StreamChatMessageReacted,
                StreamChatMessageUnreacted
            ])
            .mount_events(&app);
        app
    }

    /// 統合チャネル (StreamEnvelope) の受信を channel に集める。
    fn envelope_rx(app: &App<MockRuntime>) -> mpsc::Receiver<StreamEnvelope> {
        let (tx, rx) = mpsc::channel();
        StreamEnvelope::listen(app, move |ev| {
            let _ = tx.send(ev.payload);
        });
        rx
    }

    fn test_note(note_id: &str) -> std::sync::Arc<NormalizedNote> {
        // serde 経由で構築し、default フィールドの列挙を避ける (query_runtime tests と同型)
        std::sync::Arc::new(
            serde_json::from_value(json!({
                "id": note_id,
                "_accountId": "acct-1",
                "_serverHost": "misskey.example",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "user": { "id": "u1", "username": "alice" },
                "visibility": "public",
                "renoteCount": 0,
                "repliesCount": 0
            }))
            .expect("test note fixture should deserialize"),
        )
    }

    fn note_event(sub_id: &str, note_id: &str) -> StreamEvent {
        StreamEvent::Note(Box::new(StreamNoteEvent {
            account_id: "acct-1".into(),
            subscription_id: sub_id.into(),
            note: test_note(note_id),
        }))
    }

    fn status_event(state: StreamConnectionState) -> StreamEvent {
        StreamEvent::Status(Box::new(StreamStatusEvent {
            account_id: "acct-1".into(),
            state,
        }))
    }

    fn test_notification(id: &str, notif_type: &str) -> NormalizedNotification {
        serde_json::from_value(json!({
            "id": id,
            "_accountId": "acct-1",
            "_serverHost": "misskey.example",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "type": notif_type,
        }))
        .expect("test notification fixture should deserialize")
    }

    fn notification_event(id: &str, notif_type: &str) -> StreamEvent {
        StreamEvent::Notification(Box::new(StreamNotificationEvent {
            account_id: "acct-1".into(),
            subscription_id: "sub-A".into(),
            notification: test_notification(id, notif_type),
        }))
    }

    fn home_key(account: &str) -> QueryKey {
        QueryKey::Timeline {
            account_id: account.into(),
            timeline_type: TimelineType::new("home"),
            list_id: None,
        }
    }

    /// Status イベントは専用チャネル (stream-status) と統合チャネル
    /// (stream-envelope) の両方に流れる。QueryRuntime 未 manage でも
    /// try_state None 経路で panic しない。
    #[test]
    fn status_event_flows_to_dedicated_and_envelope_channels() {
        let app = mock_app();
        let env_rx = envelope_rx(&app);
        let (status_tx, status_rx) = mpsc::channel();
        StreamStatus::listen(&app, move |ev| {
            let _ = status_tx.send(ev.payload);
        });

        let emitter = TauriEmitter::new(app.handle().clone());
        emitter.emit(status_event(StreamConnectionState::Reconnecting));

        let status = status_rx
            .recv_timeout(RECV_TIMEOUT)
            .expect("dedicated stream-status should arrive");
        assert_eq!(status.0.account_id, "acct-1");
        assert_eq!(status.0.state, StreamConnectionState::Reconnecting);

        let envelope = env_rx
            .recv_timeout(RECV_TIMEOUT)
            .expect("stream-envelope should arrive");
        assert_eq!(envelope.0.kind(), "stream-status");
    }

    /// NoteCaptureUpdated は QueryRuntime にバッファされ、統合チャネルへの
    /// 個別 emit は抑止される (NoteCaptureBatch にまとめる IPC 削減)。
    #[test]
    fn note_capture_is_suppressed_on_envelope_and_buffered_in_runtime() {
        let app = mock_app();
        app.manage(QueryRuntime::default());
        let env_rx = envelope_rx(&app);

        let emitter = TauriEmitter::new(app.handle().clone());
        emitter.emit(StreamEvent::NoteCaptureUpdated(Box::new(
            StreamNoteCaptureEvent {
                account_id: "acct-1".into(),
                note_id: "n1".into(),
                update: notecli::models::NoteUpdateBody::Reacted(
                    notecli::models::NoteReactedBody {
                        reaction: ":+1:".into(),
                        emoji: None,
                        user_id: Some("u1".into()),
                    },
                ),
            },
        )));
        // 直後に status を流し、「capture の envelope が来ていない」ことを
        // 到着順で確認する (emit は同期配送)
        emitter.emit(status_event(StreamConnectionState::Connected));

        let first = env_rx
            .recv_timeout(RECV_TIMEOUT)
            .expect("stream-envelope should arrive");
        assert_eq!(
            first.0.kind(),
            "stream-status",
            "capture の個別 envelope は抑止されるはず"
        );

        let captures = app.state::<QueryRuntime>().drain_captures();
        assert_eq!(captures.len(), 1);
        assert_eq!(captures[0].note_id, "n1");
    }

    /// subscription が attach された query には note イベントが delta として
    /// バッファされ、同時に firehose (stream-envelope) にも流れる。
    #[test]
    fn note_event_with_attached_subscription_buffers_delta_and_emits_envelope() {
        let app = mock_app();
        app.manage(QueryRuntime::default());
        let snap = {
            let rt = app.state::<QueryRuntime>();
            let snap = rt.open(home_key("acct-1")).expect("open should succeed");
            rt.attach_stream_subscription(&snap.query_id, "sub-A".into())
                .expect("attach should succeed");
            snap
        };
        let env_rx = envelope_rx(&app);

        let emitter = TauriEmitter::new(app.handle().clone());
        emitter.emit(note_event("sub-A", "n1"));

        let deltas = app.state::<QueryRuntime>().drain_pending();
        assert_eq!(deltas.len(), 1);
        assert_eq!(deltas[0].query_id, snap.query_id);
        assert_eq!(deltas[0].inserts.len(), 1);

        let envelope = env_rx
            .recv_timeout(RECV_TIMEOUT)
            .expect("stream-envelope should arrive");
        assert_eq!(envelope.0.kind(), "stream-note");
    }

    /// 未知の subscription 宛て note イベントはバッファされないが、
    /// firehose には流れる (Inspector raw tap 用)。
    #[test]
    fn note_event_without_subscription_is_not_buffered_but_still_emitted() {
        let app = mock_app();
        app.manage(QueryRuntime::default());
        let env_rx = envelope_rx(&app);

        let emitter = TauriEmitter::new(app.handle().clone());
        emitter.emit(note_event("sub-unknown", "n1"));

        assert!(app.state::<QueryRuntime>().drain_pending().is_empty());
        let envelope = env_rx
            .recv_timeout(RECV_TIMEOUT)
            .expect("stream-envelope should arrive");
        assert_eq!(envelope.0.kind(), "stream-note");
    }

    /// 同一 ID の通知を 2 回受けても OS 通知の dedup セットには 1 件だけ
    /// 記録され、統合チャネルへの emit は抑止されない (2 回とも流れる)。
    /// 未知の notification type を使い OS 通知の副作用なしに dedup 経路を通す。
    #[test]
    fn duplicate_notification_dedups_os_side_but_envelope_still_flows() {
        let app = mock_app();
        let env_rx = envelope_rx(&app);

        let emitter = TauriEmitter::new(app.handle().clone());
        emitter.emit(notification_event("notif-1", "someFutureType"));
        emitter.emit(notification_event("notif-1", "someFutureType"));

        for _ in 0..2 {
            let envelope = env_rx
                .recv_timeout(RECV_TIMEOUT)
                .expect("stream-envelope should arrive for each emit");
            assert_eq!(envelope.0.kind(), "stream-notification");
        }
        let seen = emitter.recent_notif_ids.lock().unwrap();
        assert_eq!(seen.len(), 1, "同一 ID は 1 件だけ記録されるはず");
        assert!(seen.contains("notif-1"));
    }

    /// dedup セットは DEDUP_MAX_IDS を超えるとクリアされ、無限成長しない。
    /// クリア後は既知 ID も再登録できる (再通知可能)。
    #[test]
    fn dedup_set_clears_when_exceeding_max() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone());

        for i in 0..DEDUP_MAX_IDS {
            emitter
                .send_native_notification(&test_notification(&format!("id-{i}"), "someFutureType"));
        }
        assert_eq!(
            emitter.recent_notif_ids.lock().unwrap().len(),
            DEDUP_MAX_IDS
        );

        // 上限 +1 件目でクリアされる
        emitter.send_native_notification(&test_notification("id-overflow", "someFutureType"));
        assert_eq!(emitter.recent_notif_ids.lock().unwrap().len(), 0);

        // クリア後は既出 ID を再登録できる
        emitter.send_native_notification(&test_notification("id-0", "someFutureType"));
        assert_eq!(emitter.recent_notif_ids.lock().unwrap().len(), 1);
    }

    fn test_notification_with_user(
        id: &str,
        notif_type: &str,
        username: &str,
    ) -> NormalizedNotification {
        serde_json::from_value(json!({
            "id": id,
            "_accountId": "acct-1",
            "_serverHost": "misskey.example",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "type": notif_type,
            "user": { "id": "u1", "username": username },
        }))
        .expect("test notification fixture should deserialize")
    }

    fn pending(title: &str, body: Option<&str>) -> PendingOsNotification {
        PendingOsNotification {
            title: title.to_string(),
            body: body.map(str::to_string),
        }
    }

    /// バースト外の 1 件目は即時表示、GROUP_WINDOW 内の後続はバッファされる。
    /// flusher の起動指示はバッファが空→非空になる最初の 1 回だけ。
    #[test]
    fn burst_notifications_are_buffered_after_first() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone());

        let plan1 =
            emitter.plan_os_notification(&test_notification_with_user("n1", "reaction", "alice"));
        assert!(matches!(plan1, OsNotifPlan::ShowNow { .. }));

        let plan2 =
            emitter.plan_os_notification(&test_notification_with_user("n2", "reply", "bob"));
        assert!(matches!(
            plan2,
            OsNotifPlan::Buffer {
                spawn_flusher: true
            }
        ));

        let plan3 =
            emitter.plan_os_notification(&test_notification_with_user("n3", "renote", "carol"));
        assert!(matches!(
            plan3,
            OsNotifPlan::Buffer {
                spawn_flusher: false
            }
        ));

        assert_eq!(emitter.pending_group.lock().unwrap().len(), 2);
    }

    /// GROUP_WINDOW を過ぎた通知はバーストとみなされず即時表示に戻る。
    #[test]
    fn notification_after_window_shows_immediately() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone());

        let _ = emitter.plan_os_notification(&test_notification_with_user("n1", "reaction", "alice"));
        // 窓を跨いだ状態を再現
        *emitter.last_os_notif.lock().unwrap() = Instant::now().checked_sub(GROUP_WINDOW * 2);

        let plan =
            emitter.plan_os_notification(&test_notification_with_user("n2", "reply", "bob"));
        assert!(matches!(plan, OsNotifPlan::ShowNow { .. }));
        assert!(emitter.pending_group.lock().unwrap().is_empty());
    }

    /// バッファ 1 件の flush は元の title/body をそのまま使う (要約しない)。
    #[test]
    fn summarize_group_single_keeps_original() {
        let items = vec![pending("アリス", Some("リアクション 👍"))];
        let (title, body) = summarize_group(&items).expect("single item should flush");
        assert_eq!(title, "アリス");
        assert_eq!(body.as_deref(), Some("リアクション 👍"));
    }

    /// 複数件は「新着通知 N 件」+ 通知元名の dedup 列挙に要約される。
    #[test]
    fn summarize_group_groups_and_dedups_actors() {
        let items = vec![
            pending("アリス", Some("リアクション 👍")),
            pending("ボブ", Some("リプライ")),
            pending("アリス", Some("リノート")),
        ];
        let (title, body) = summarize_group(&items).expect("items should flush");
        assert_eq!(title, "新着通知 3 件");
        assert_eq!(body.as_deref(), Some("アリス、ボブ"));
    }

    /// 通知元が GROUP_MAX_NAMES を超えたら「ほか」に畳む。空バッファは何も出さない。
    #[test]
    fn summarize_group_caps_names_and_skips_empty() {
        let items = vec![
            pending("アリス", None),
            pending("ボブ", None),
            pending("キャロル", None),
            pending("デイブ", None),
        ];
        let (title, body) = summarize_group(&items).expect("items should flush");
        assert_eq!(title, "新着通知 4 件");
        assert_eq!(body.as_deref(), Some("アリス、ボブ、キャロル ほか"));

        assert!(summarize_group(&[]).is_none());
    }

    #[test]
    fn achievement_label_maps_known_and_falls_back() {
        assert_eq!(achievement_label("notes1"), "はじめてのノート");
        assert_eq!(achievement_label("iLoveMisskey"), "I Love Misskey");
        // 未知の実績名はそのまま返す
        assert_eq!(
            achievement_label("unknownFutureBadge"),
            "unknownFutureBadge"
        );
    }
}
