use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;
#[cfg(not(target_os = "android"))]
use std::time::Instant;

use notecli::models::NormalizedNotification;
use notecli::streaming::FrontendEmitter;
use serde::{Deserialize, Serialize};
use serde_json::json;
use specta::Type;
use tauri::{AppHandle, Manager};
#[cfg(any(target_os = "macos", target_os = "android"))]
#[cfg(target_os = "macos")]
use tauri_plugin_notification::NotificationExt;
use tauri_specta::Event;

use crate::os_notify::{NotificationClicked, NotifyMedia};

// #781: specta 契約に載せる typed イベント。notecli の型を newtype で包む
// (serde/specta とも透過なのでワイヤ形・TS 型は中身そのもの)。

/// 統合チャネル (イベント名 "stream-envelope")。全イベントを { kind, payload }
/// の tagged union で流す。Inspector の raw tap だけが購読し、観測が開いている
/// ときしか流れない (#1106)。名前が notecli::streaming::StreamEvent と衝突すると
/// specta の TS 出力が壊れるため、newtype は別名にしている。
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamEnvelope(pub notecli::streaming::StreamEvent);

/// 未読カウンタへの合図 (イベント名 "stream-unread")。生封筒に頼らない (#1106)
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamUnread(pub notecore::stream_fanout::StreamUnreadEvent);

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamStatus(pub notecli::streaming::StreamStatusEvent);

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamChatMessageReacted(pub notecli::streaming::StreamChatMessageReactedEvent);

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamChatMessageUnreacted(pub notecli::streaming::StreamChatMessageUnreactedEvent);

/// 別の会話に来たチャットの新着 (main の `newChatMessage`)。チャットの履歴一覧が購読する
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamNewChatMessage(pub notecore::stream_fanout::StreamNewChatMessageEvent);

/// broadcast の絵文字辞書変更 (#889)。絵文字ストアが購読して push 反映する。
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamEmojiChanged(pub notecli::streaming::StreamEmojiChangedEvent);

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
    /// クリック時の遷移コンテキスト (#754)。要約通知になると失われる。
    context: Option<NotificationClicked>,
    /// アバター/絵文字画像 (#754)。要約通知になると失われる。
    media: Option<NotifyMedia>,
}

/// Android の OS 通知の識別と置き場 (notecore の notify_plan が決める)
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct AndroidNotifyKey {
    tag: String,
    id: i32,
    channel_id: &'static str,
}

/// send_native_notification の判定結果。表示 (副作用) と分離してテスト可能にする。
// ShowNow は通知 1 件の中身を丸ごと持つので他の variant より大きいが、判定結果は
// その場で消費するだけなので Box で間接化する価値が無い
#[allow(clippy::large_enum_variant)]
enum OsNotifPlan {
    /// dedup 済み・未知 type・フォーカス中 → 何もしない
    Suppress,
    /// 個別に即時表示 (バースト外の 1 件目 / Android)
    ShowNow {
        title: String,
        body: Option<String>,
        context: Option<NotificationClicked>,
        media: Option<NotifyMedia>,
        /// Android の通知タップの遷移先 (notedeck://)。要約通知には無い
        deep_link: Option<String>,
        /// Android の (tag, id, チャネル)。後着が上書きし、既読は tag 単位で消す
        android: Option<AndroidNotifyKey>,
    },
    /// バーストとしてバッファ済み。spawn_flusher が true なら flush タスクを起動する
    #[cfg_attr(target_os = "android", allow(dead_code))]
    Buffer { spawn_flusher: bool },
}

/// バッファを要約して表示内容にする。1 件ならそのまま (context 維持)、複数件なら
/// 「新着通知 N 件」+ 通知元名の列挙 (dedup、GROUP_MAX_NAMES 超は「ほか」)。
/// 複数件の要約は単一の遷移先を持たないため context は None (クリック =
/// ウィンドウフォーカスのみ)。
fn summarize_group(items: &[PendingOsNotification]) -> Option<PendingOsNotification> {
    match items {
        [] => None,
        [single] => Some(PendingOsNotification {
            title: single.title.clone(),
            body: single.body.clone(),
            context: single.context.clone(),
            media: single.media.clone(),
        }),
        _ => {
            let mut names: Vec<&str> = Vec::new();
            for item in items {
                if !names.contains(&item.title.as_str()) {
                    names.push(&item.title);
                }
            }
            let sep = crate::ui_lang::t("_native.notification.listSeparator", json!({}));
            let body = if names.len() > GROUP_MAX_NAMES {
                crate::ui_lang::t(
                    "_native.notification.groupOthers",
                    json!({ "names": names[..GROUP_MAX_NAMES].join(&sep) }),
                )
            } else {
                names.join(&sep)
            };
            Some(PendingOsNotification {
                title: crate::ui_lang::t(
                    "_native.notification.groupTitle_plural",
                    json!({ "count": items.len() }),
                ),
                body: Some(body),
                context: None,
                media: None,
            })
        }
    }
}

/// `deep_link` は Android の通知タップの遷移先 (notedeck://)。バースト要約通知は
/// 単一の遷移先を持たないので None。
fn show_os_notification<R: tauri::Runtime>(
    app: &AppHandle<R>,
    title: &str,
    body: Option<&str>,
    context: Option<&NotificationClicked>,
    media: Option<&NotifyMedia>,
    deep_link: Option<&str>,
    android: Option<&AndroidNotifyKey>,
) {
    // Linux / Windows: user-notify 経由 (クリック遷移 + 画像添付, #754)。
    // 画像取得は ImageCache を通す (setup 前の呼び出しでは None = 画像なし)
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let _ = (deep_link, android);
        let cache = app
            .try_state::<std::sync::Arc<notecore::image_cache::ImageCache>>()
            .map(|s| s.inner().clone());
        crate::os_notify::show(title, body, context, media, cache);
    }

    // macOS: user-notify は署名済み bundle 必須のため plugin 経路を維持
    // (クリック遷移・画像は署名導入までブロック, #754)
    #[cfg(target_os = "macos")]
    {
        let _ = (context, media, deep_link, android);
        let mut builder = app.notification().builder().title(title);
        if let Some(body) = body {
            builder = builder.body(body);
        }
        if let Err(e) = builder.show() {
            tracing::warn!("[notification] failed to send: {e}");
        }
    }

    // Android: MainActivity.showRichNotification を JNI で呼ぶ。
    // tauri-plugin-notification の Android 実装は largeIcon に drawable リソース名
    // しか渡せず (attachments は無視される)、アバターやリアクション絵文字のような
    // 動的画像を添付できないため。配置はデスクトップと同じ (icon=アバター,
    // image=絵文字)。クリック遷移は plugin の extra + JS onAction ではなく
    // notedeck:// deep link で行う (NotificationWorker と同じ経路)。
    //
    // 画像は ImageCache 経由でローカルファイル化してから Kotlin にパスを渡す。
    // 以前は Kotlin 側が生 URL を HttpURLConnection で fetch + 原寸デコード
    // していたが、キャッシュ・サイズ上限・失敗学習が一切効かず、巨大画像の
    // OutOfMemoryError (Kotlin の catch (Exception) では捕まえられない) で
    // プロセスごと落ちる経路だった。取得は emitter (WS 読みループ) を
    // 塞がないよう spawn したタスクで行う。
    #[cfg(target_os = "android")]
    {
        // 遷移先は純関数が組んだ deep link で渡る。context はデスクトップのクリック用
        let _ = context;
        let Some(key) = android.cloned() else {
            // 要約通知は Android では作らない (OS がチャネルで束ねる)
            return;
        };
        let deep_link = deep_link.map(str::to_string);
        let app = app.clone();
        let title = title.to_string();
        let body = body.map(str::to_string);
        let icon_url = media.and_then(|m| m.icon_url.clone());
        let image_url = media.and_then(|m| m.image_url.clone());
        tauri::async_runtime::spawn(async move {
            // ImageCache は setup で manage される。未登録 (起動直後) なら
            // 画像なしで通知だけ出す
            let cache = app
                .try_state::<std::sync::Arc<notecore::image_cache::ImageCache>>()
                .map(|s| s.inner().clone());
            let (icon_path, image_path) = match cache {
                Some(cache) => {
                    let icon = match icon_url {
                        Some(u) => {
                            notecore::notify_media::ensure_local_file(
                                &cache,
                                &u,
                                Some(crate::android_notify::AVATAR_MAX_WIDTH),
                            )
                            .await
                        }
                        None => None,
                    };
                    // 絵文字はアニメーション保持のため変換なし (原本)。decode の
                    // メモリ安全は Kotlin 側の inSampleSize が担保する
                    let image = match image_url {
                        Some(u) => {
                            notecore::notify_media::ensure_local_file(&cache, &u, None).await
                        }
                        None => None,
                    };
                    (icon, image)
                }
                None => (None, None),
            };
            crate::android_notify::show(
                &key.tag,
                key.id,
                key.channel_id,
                &title,
                body.as_deref(),
                deep_link.as_deref(),
                icon_path.as_deref().and_then(|p| p.to_str()),
                image_path.as_deref().and_then(|p| p.to_str()),
            );
        });
    }
}

// Runtime generic は MockRuntime でのユニットテスト用。本番は default の Wry
// のみで、挙動は非 generic 時と同一。
pub struct TauriEmitter<R: tauri::Runtime = tauri::Wry> {
    app: AppHandle<R>,
    /// 生封筒を流すかどうか (Stream Inspector の観測、Core と共有)
    observation: Arc<notecore::stream_fanout::StreamObservation>,
    /// Tracks recently shown notification IDs to prevent duplicate OS notifications
    /// when multiple subscriptions exist for the same account.
    recent_notif_ids: Mutex<HashSet<String>>,
    /// 見えている通知カラムの口座 (managed state の写し。テストでは直接触る)
    visible_scopes: crate::os_notify::VisibleNotificationScopes,
    /// 直近に OS 通知を出した (またはバッファした) 時刻。バースト判定用。
    #[cfg(not(target_os = "android"))]
    last_os_notif: Mutex<Option<Instant>>,
    /// バースト中の未表示通知。flusher タスクが GROUP_WINDOW 後に drain する。
    #[cfg(not(target_os = "android"))]
    pending_group: Arc<Mutex<Vec<PendingOsNotification>>>,
}

impl<R: tauri::Runtime> TauriEmitter<R> {
    pub fn new(
        app: AppHandle<R>,
        observation: Arc<notecore::stream_fanout::StreamObservation>,
    ) -> Self {
        let visible_scopes = app
            .try_state::<crate::os_notify::VisibleNotificationScopes>()
            .map(|s| s.inner().clone())
            .unwrap_or_default();
        Self {
            app,
            observation,
            recent_notif_ids: Mutex::new(HashSet::new()),
            visible_scopes,
            #[cfg(not(target_os = "android"))]
            last_os_notif: Mutex::new(None),
            #[cfg(not(target_os = "android"))]
            pending_group: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// メッセージの新着を OS 通知にする。deep link に要る口座のサーバーは口座表から引く
    fn send_native_chat_notification(
        &self,
        ev: &notecore::stream_fanout::StreamNewChatMessageEvent,
    ) {
        #[cfg(target_os = "android")]
        self.advance_notify_cursor(
            &ev.account_id,
            notecore::notify_plan::NotifyKind::Message,
            &ev.message.id,
        );
        let host = self
            .app
            .try_state::<crate::commands::AppState>()
            .and_then(|core| core.accounts().ok())
            .and_then(|store| store.get(&ev.account_id).ok().flatten())
            .map(|a| a.host.clone());
        let Some(host) = host else {
            tracing::warn!(account = %ev.account_id, "[notification] chat: account host unknown");
            return;
        };
        if let OsNotifPlan::ShowNow {
            title,
            body,
            context,
            media,
            deep_link,
            android,
        } = self.plan_chat_notification(ev, &host)
        {
            show_os_notification(
                &self.app,
                &title,
                body.as_deref(),
                context.as_ref(),
                media.as_ref(),
                deep_link.as_deref(),
                android.as_ref(),
            );
        }
    }

    /// メッセージの OS 通知の判定 (表示副作用なし)。同じメッセージは 1 回だけ。
    /// バースト集約はしない (通知とは別の種類で、まとめると文面が消えるため)
    fn plan_chat_notification(
        &self,
        ev: &notecore::stream_fanout::StreamNewChatMessageEvent,
        host: &str,
    ) -> OsNotifPlan {
        {
            let mut seen = self.recent_notif_ids.lock().unwrap();
            if !seen.insert(format!("chat:{}", ev.message.id)) {
                return OsNotifPlan::Suppress;
            }
            if seen.len() > DEDUP_MAX_IDS {
                seen.clear();
            }
        }
        let notecore::notify_plan::NotifyPlan {
            title,
            body,
            click,
            icon_url,
            image_url,
            deep_link,
            channel,
            tag,
            id,
        } = notecore::notify_plan::plan_chat(&ev.message, host, &crate::ui_lang::current());
        OsNotifPlan::ShowNow {
            title,
            body,
            context: click.map(|c| NotificationClicked {
                account_id: c.account_id,
                note_id: c.note_id,
                user_id: c.user_id,
            }),
            media: (icon_url.is_some() || image_url.is_some()).then_some(NotifyMedia {
                icon_url,
                image_url,
            }),
            deep_link,
            android: Some(AndroidNotifyKey {
                tag,
                id,
                channel_id: channel.id(),
            }),
        }
    }

    fn send_native_notification(&self, notification: &NormalizedNotification) {
        // Android のワーカーと処理位置を共有する (#330 段階 C)。見えていて抑止する分や
        // 重複分も「ここまで扱った」には含める
        #[cfg(target_os = "android")]
        self.advance_notify_cursor(
            &notification.account_id,
            notecore::notify_plan::NotifyKind::Notification,
            &notification.id,
        );
        match self.plan_os_notification(notification) {
            OsNotifPlan::Suppress => {}
            OsNotifPlan::ShowNow {
                title,
                body,
                context,
                media,
                deep_link,
                android,
            } => {
                show_os_notification(
                    &self.app,
                    &title,
                    body.as_deref(),
                    context.as_ref(),
                    media.as_ref(),
                    deep_link.as_deref(),
                    android.as_ref(),
                );
            }
            OsNotifPlan::Buffer { spawn_flusher } => {
                #[cfg(not(target_os = "android"))]
                if spawn_flusher {
                    let app = self.app.clone();
                    let pending = Arc::clone(&self.pending_group);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(GROUP_WINDOW).await;
                        let items = std::mem::take(&mut *pending.lock().unwrap());
                        if let Some(summary) = summarize_group(&items) {
                            show_os_notification(
                                &app,
                                &summary.title,
                                summary.body.as_deref(),
                                summary.context.as_ref(),
                                summary.media.as_ref(),
                                None,
                                None,
                            );
                        }
                    });
                }
                #[cfg(target_os = "android")]
                let _ = spawn_flusher;
            }
        }
    }

    /// OS 通知の処理位置を進める (Android)。ワーカーはこの位置より新しいものだけを
    /// 取るので、アプリが生きている間に扱った通知を 15 分後に出し直さない。ファイルの
    /// 書込なので WS の読みループを塞がないよう別スレッドで
    #[cfg(target_os = "android")]
    fn advance_notify_cursor(
        &self,
        account_id: &str,
        kind: notecore::notify_plan::NotifyKind,
        id: &str,
    ) {
        let app_dir =
            notecore::app_dir::override_from_env().or_else(|| self.app.path().app_data_dir().ok());
        let Some(app_dir) = app_dir else {
            return;
        };
        let (account_id, id) = (account_id.to_string(), id.to_string());
        tauri::async_runtime::spawn_blocking(move || {
            crate::notify_cursor_file::advance(&app_dir, &account_id, kind, &id);
        });
    }

    /// その口座の通知カラムが見えているか。Android では WebView の可視性が凍結中に
    /// 古いまま残りうるので、Activity の前面フラグ (OS が確定的に呼ぶ) と組で判定する
    fn notification_column_visible(&self, account_id: &str) -> bool {
        let visible = self.visible_scopes.contains(account_id);
        #[cfg(target_os = "android")]
        let visible = visible && crate::android_notify::is_foreground();
        visible
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

        // 文言 / 遷移先 / 画像の URL の組み立ては notecore の純関数 1 箇所 (#330 §4.1)。
        // ここは表示言語を渡して、端末側の型に写すだけ
        let Some(plan) = notecore::notify_plan::plan(notification, &crate::ui_lang::current())
        else {
            return OsNotifPlan::Suppress;
        };
        let notecore::notify_plan::NotifyPlan {
            title,
            body: body_opt,
            click,
            icon_url,
            image_url,
            deep_link,
            channel,
            tag,
            id,
        } = plan;
        let android = Some(AndroidNotifyKey {
            tag,
            id,
            channel_id: channel.id(),
        });
        let context = click.map(|c| NotificationClicked {
            account_id: c.account_id,
            note_id: c.note_id,
            user_id: c.user_id,
        });
        let media = (icon_url.is_some() || image_url.is_some()).then_some(NotifyMedia {
            icon_url,
            image_url,
        });

        // その口座の通知カラムが見えていれば OS 通知にしない (#330 §3.3)。見ている
        // 最中はアプリ内の表示で足りる。見えていないカラムや通知カラムの無い口座は
        // 出す (以前のフォーカス中一律抑止だと気づく手段が無かった)
        if self.notification_column_visible(&notification.account_id) {
            return OsNotifPlan::Suppress;
        }

        // Android は webview が凍結されうるため常に即時表示 (グルーピングは
        // channel 経由で OS が行う)
        #[cfg(target_os = "android")]
        {
            OsNotifPlan::ShowNow {
                title,
                body: body_opt,
                context,
                media,
                deep_link,
                android,
            }
        }

        #[cfg(not(target_os = "android"))]
        {
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
                    context,
                    media,
                    deep_link,
                    android,
                };
            }
            let mut pending = self.pending_group.lock().unwrap();
            let spawn_flusher = pending.is_empty();
            pending.push(PendingOsNotification {
                title,
                body: body_opt,
                context,
                media,
            });
            OsNotifPlan::Buffer { spawn_flusher }
        }
    }
}

/// 表示言語が変わったら Android の通知チャネル名を付け直す (同じ id で作り直すと
/// 名前だけ更新される)。ほかの OS では何もしない
pub fn refresh_notification_channel(app: &tauri::AppHandle) {
    #[cfg(target_os = "android")]
    crate::android_notify::ensure_channels(&android_channels());
    let _ = app;
}

/// Android の通知チャネル (種別群、#330 §4.4) を今の表示言語で組む。入口の登録時と
/// 表示言語の変更時に Kotlin に渡す
#[cfg(target_os = "android")]
pub fn android_channels() -> Vec<(String, String, bool)> {
    let lang = crate::ui_lang::current();
    notecore::notify_plan::Channel::ALL
        .iter()
        .map(|c| (c.id().to_string(), c.label(&lang), c.important()))
        .collect()
}

impl<R: tauri::Runtime> FrontendEmitter for TauriEmitter<R> {
    fn emit(&self, event: notecli::streaming::StreamEvent) {
        use notecli::streaming::StreamEvent as E;

        if let Some(runtime) = self
            .app
            .try_state::<std::sync::Arc<notecore::query_runtime::QueryRuntime>>()
        {
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
            E::EmojiChanged(e) => StreamEmojiChanged((**e).clone()).emit(&self.app).err(),
            E::MainEvent(_) => notecore::stream_fanout::new_chat_message(&event).and_then(|m| {
                // メッセージの新着も OS 通知にする (#330 §4.1)。サーバーは受信から
                // 3 秒たっても既読にならなかった他人のメッセージだけを流すので、
                // 開いている会話の分はここに来ない
                self.send_native_chat_notification(&m);
                StreamNewChatMessage(m).emit(&self.app).err()
            }),
            _ => None,
        };
        if let Some(e) = dedicated {
            tracing::warn!("[stream] dedicated emit failed: {e}");
        }

        // 未読カウンタへの合図は専用チャネル (生封筒に依存しない)
        if let Some(unread) = notecore::stream_fanout::unread_signal(&event) {
            // 既読になった口座の OS 通知はまとめて消す (#330 §3.4)。他端末で読んだ分も
            // サーバーが readAllNotifications を流すのでここに来る
            #[cfg(target_os = "android")]
            if unread.op == notecore::stream_fanout::UnreadOp::Clear
                && unread.kind == notecore::stream_fanout::UnreadKind::Notification
            {
                crate::android_notify::cancel(&notecore::notify_plan::notify_tag(
                    &unread.account_id,
                    notecore::notify_plan::NotifyKind::Notification,
                ));
            }
            if let Err(e) = StreamUnread(unread).emit(&self.app) {
                tracing::warn!("[stream] emit stream-unread failed: {e}");
            }
        }

        // 統合チャネル: { kind, payload } の tagged union。Inspector の raw tap が
        // 観測を開いている間だけ流す
        if !self.observation.is_on() {
            return;
        }
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
    use notecli::streaming::{
        StreamConnectionState, StreamEvent, StreamNoteCaptureEvent, StreamNoteEvent,
        StreamNotificationEvent, StreamStatusEvent,
    };
    use serde_json::json;
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    use tauri::{App, Manager};

    use notecore::query_runtime::{QueryKey, QueryRuntime};

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
                StreamUnread,
                StreamStatus,
                StreamChatMessageReacted,
                StreamChatMessageUnreacted,
                StreamNewChatMessage
            ])
            .mount_events(&app);
        app
    }

    /// 観測が開いた状態 (既存のテストは生封筒が届く前提)
    fn observing() -> Arc<notecore::stream_fanout::StreamObservation> {
        let o = Arc::new(notecore::stream_fanout::StreamObservation::default());
        o.start();
        o
    }

    /// 観測が閉じていれば生封筒は流れず、未読の合図は専用チャネルに流れる
    #[test]
    fn envelope_is_gated_by_observation_and_unread_has_its_own_channel() {
        let app = mock_app();
        let env_rx = envelope_rx(&app);
        let (unread_tx, unread_rx) = mpsc::channel();
        StreamUnread::listen(&app, move |ev| {
            let _ = unread_tx.send(ev.payload);
        });
        let observation = Arc::new(notecore::stream_fanout::StreamObservation::default());
        let emitter = TauriEmitter::new(app.handle().clone(), observation.clone());

        emitter.emit(notification_event("n1", "follow"));
        let unread = unread_rx
            .recv_timeout(RECV_TIMEOUT)
            .expect("stream-unread should arrive");
        assert_eq!(unread.0.account_id, "acct-1");
        assert_eq!(
            unread.0.kind,
            notecore::stream_fanout::UnreadKind::Notification
        );
        assert!(env_rx.recv_timeout(Duration::from_millis(200)).is_err());

        observation.start();
        emitter.emit(status_event(StreamConnectionState::Connected));
        let envelope = env_rx
            .recv_timeout(RECV_TIMEOUT)
            .expect("stream-envelope should arrive while observing");
        assert_eq!(envelope.0.kind(), "stream-status");
    }

    /// main の newChatMessage は観測が閉じていても専用チャネルに流れる
    #[test]
    fn new_chat_message_has_its_own_channel() {
        let app = mock_app();
        let (tx, rx) = mpsc::channel();
        StreamNewChatMessage::listen(&app, move |ev| {
            let _ = tx.send(ev.payload);
        });
        let observation = Arc::new(notecore::stream_fanout::StreamObservation::default());
        let emitter = TauriEmitter::new(app.handle().clone(), observation);

        emitter.emit(StreamEvent::MainEvent(Box::new(
            notecli::streaming::StreamMainEvent {
                account_id: "acct-1".into(),
                subscription_id: "main".into(),
                event_type: "newChatMessage".into(),
                body: json!({
                    "id": "m1",
                    "createdAt": "2026-10-10T00:00:00.000Z",
                    "fromUserId": "u2",
                    "toUserId": "u1",
                    "text": "hi",
                }),
            },
        )));
        let got = rx
            .recv_timeout(RECV_TIMEOUT)
            .expect("stream-new-chat-message should arrive");
        assert_eq!(got.0.account_id, "acct-1");
        assert_eq!(got.0.message.id, "m1");
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
            key: "home".into(),
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

        let emitter = TauriEmitter::new(app.handle().clone(), observing());
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
        app.manage(std::sync::Arc::new(QueryRuntime::default()));
        let env_rx = envelope_rx(&app);

        let emitter = TauriEmitter::new(app.handle().clone(), observing());
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

        let captures = app.state::<std::sync::Arc<QueryRuntime>>().drain_captures();
        assert_eq!(captures.len(), 1);
        assert_eq!(captures[0].note_id, "n1");
    }

    /// subscription が attach された query には note イベントが delta として
    /// バッファされ、同時に firehose (stream-envelope) にも流れる。
    #[test]
    fn note_event_with_attached_subscription_buffers_delta_and_emits_envelope() {
        let app = mock_app();
        app.manage(std::sync::Arc::new(QueryRuntime::default()));
        let snap = {
            let rt = app.state::<std::sync::Arc<QueryRuntime>>();
            let snap = rt.open(home_key("acct-1")).expect("open should succeed");
            rt.attach_stream_subscription(&snap.query_id, "sub-A".into())
                .expect("attach should succeed");
            snap
        };
        let env_rx = envelope_rx(&app);

        let emitter = TauriEmitter::new(app.handle().clone(), observing());
        emitter.emit(note_event("sub-A", "n1"));

        let deltas = app.state::<std::sync::Arc<QueryRuntime>>().drain_pending();
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
        app.manage(std::sync::Arc::new(QueryRuntime::default()));
        let env_rx = envelope_rx(&app);

        let emitter = TauriEmitter::new(app.handle().clone(), observing());
        emitter.emit(note_event("sub-unknown", "n1"));

        assert!(app
            .state::<std::sync::Arc<QueryRuntime>>()
            .drain_pending()
            .is_empty());
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

        let emitter = TauriEmitter::new(app.handle().clone(), observing());
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
        let emitter = TauriEmitter::new(app.handle().clone(), observing());

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
            context: Some(NotificationClicked {
                account_id: "acct-1".into(),
                note_id: Some(format!("note-of-{title}")),
                user_id: Some("u1".into()),
            }),
            media: Some(NotifyMedia {
                icon_url: Some(format!("https://misskey.example/avatar-of-{title}.webp")),
                image_url: None,
            }),
        }
    }

    /// バースト外の 1 件目は即時表示、GROUP_WINDOW 内の後続はバッファされる。
    /// flusher の起動指示はバッファが空→非空になる最初の 1 回だけ。
    #[test]
    fn burst_notifications_are_buffered_after_first() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone(), observing());

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
        let emitter = TauriEmitter::new(app.handle().clone(), observing());

        let _ =
            emitter.plan_os_notification(&test_notification_with_user("n1", "reaction", "alice"));
        // 窓を跨いだ状態を再現
        *emitter.last_os_notif.lock().unwrap() = Instant::now().checked_sub(GROUP_WINDOW * 2);

        let plan = emitter.plan_os_notification(&test_notification_with_user("n2", "reply", "bob"));
        assert!(matches!(plan, OsNotifPlan::ShowNow { .. }));
        assert!(emitter.pending_group.lock().unwrap().is_empty());
    }

    /// バッファ 1 件の flush は元の title/body/context をそのまま使う (要約しない)。
    #[test]
    fn summarize_group_single_keeps_original() {
        let items = vec![pending("アリス", Some("リアクション 👍"))];
        let summary = summarize_group(&items).expect("single item should flush");
        assert_eq!(summary.title, "アリス");
        assert_eq!(summary.body.as_deref(), Some("リアクション 👍"));
        assert_eq!(
            summary.context.as_ref().and_then(|c| c.note_id.as_deref()),
            Some("note-of-アリス"),
            "1 件のみの flush はクリック遷移先を維持するはず"
        );
        assert!(
            summary.media.is_some(),
            "1 件のみの flush はアバター画像を維持するはず"
        );
    }

    /// 複数件は「新着通知 N 件」+ 通知元名の dedup 列挙に要約される。
    /// 要約は単一の遷移先を持たないため context は落ちる。
    #[test]
    fn summarize_group_groups_and_dedups_actors() {
        crate::ui_lang::set_for_tests("ja-JP");
        let items = vec![
            pending("アリス", Some("リアクション 👍")),
            pending("ボブ", Some("リプライ")),
            pending("アリス", Some("リノート")),
        ];
        let summary = summarize_group(&items).expect("items should flush");
        assert_eq!(summary.title, "新着通知 3 件");
        assert_eq!(summary.body.as_deref(), Some("アリス、ボブ"));
        assert!(summary.context.is_none(), "要約通知は遷移先を持たないはず");
        assert!(summary.media.is_none(), "要約通知は画像を持たないはず");
    }

    /// 通知元が GROUP_MAX_NAMES を超えたら「ほか」に畳む。空バッファは何も出さない。
    #[test]
    fn summarize_group_caps_names_and_skips_empty() {
        crate::ui_lang::set_for_tests("ja-JP");
        let items = vec![
            pending("アリス", None),
            pending("ボブ", None),
            pending("キャロル", None),
            pending("デイブ", None),
        ];
        let summary = summarize_group(&items).expect("items should flush");
        assert_eq!(summary.title, "新着通知 4 件");
        assert_eq!(summary.body.as_deref(), Some("アリス、ボブ、キャロル ほか"));

        assert!(summarize_group(&[]).is_none());
    }

    /// plan_os_notification はアクター系通知にクリック遷移コンテキスト
    /// (accountId + noteId/userId) を載せる (#754)。
    #[test]
    fn visible_notification_column_suppresses_os_notification() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone(), observing());
        let shown = |n: &NormalizedNotification| {
            matches!(emitter.plan_os_notification(n), OsNotifPlan::ShowNow { .. })
        };
        emitter.visible_scopes.set("main", ["acct-1".to_string()]);
        // 見えている口座 (acct-1) の通知は出さない
        assert!(!shown(&test_notification("v1", "mention")));
        // 見えていない口座は出す
        let mut other = test_notification("v2", "mention");
        other.account_id = "acct-2".to_string();
        assert!(shown(&other));
        // 別のウィンドウが空の集合を送っても、このウィンドウの分は消えない
        emitter.visible_scopes.set("deck-2", Vec::<String>::new());
        *emitter.last_os_notif.lock().unwrap() = None;
        assert!(!shown(&test_notification("v2b", "mention")));
        // 見えなくなったら出す
        emitter.visible_scopes.remove_window("main");
        *emitter.last_os_notif.lock().unwrap() = None;
        assert!(shown(&test_notification("v3", "mention")));
    }

    /// メッセージの新着は「メッセージ」チャネルの OS 通知になり、同じメッセージは 1 回だけ
    #[test]
    fn chat_message_plans_os_notification_once() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone(), observing());
        let ev = notecore::stream_fanout::StreamNewChatMessageEvent {
            account_id: "acct-1".into(),
            message: serde_json::from_value(json!({
                "id": "m1",
                "_accountId": "acct-1",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "fromUserId": "u2",
                "fromUser": { "id": "u2", "username": "bob", "name": "Bob" },
                "toUserId": "u1",
                "text": "hi",
                "reactions": [],
            }))
            .unwrap(),
        };
        match emitter.plan_chat_notification(&ev, "misskey.example") {
            OsNotifPlan::ShowNow {
                title,
                body,
                android,
                deep_link,
                ..
            } => {
                assert_eq!(title, "Bob");
                assert_eq!(body.as_deref(), Some("hi"));
                let key = android.expect("android key");
                assert_eq!(key.channel_id, "notedeck_messages");
                assert_eq!(key.tag, "chat:acct-1");
                assert_eq!(
                    deep_link.as_deref(),
                    Some("notedeck://misskey.example/chat/user/u2")
                );
            }
            _ => panic!("chat message should be shown"),
        }
        assert!(matches!(
            emitter.plan_chat_notification(&ev, "misskey.example"),
            OsNotifPlan::Suppress
        ));
    }

    #[test]
    fn plan_carries_click_context() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone(), observing());

        let notification: NormalizedNotification = serde_json::from_value(json!({
            "id": "n-ctx",
            "_accountId": "acct-1",
            "_serverHost": "misskey.example",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "type": "reaction",
            "reaction": "👍",
            "user": { "id": "u1", "username": "alice" },
            "note": {
                "id": "note-1",
                "_accountId": "acct-1",
                "_serverHost": "misskey.example",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "user": { "id": "u9", "username": "me" },
                "visibility": "public",
                "renoteCount": 0,
                "repliesCount": 0
            },
        }))
        .expect("fixture should deserialize");

        match emitter.plan_os_notification(&notification) {
            OsNotifPlan::ShowNow { context, .. } => {
                let ctx = context.expect("actor notification should carry context");
                assert_eq!(ctx.account_id, "acct-1");
                assert_eq!(ctx.note_id.as_deref(), Some("note-1"));
                assert_eq!(ctx.user_id.as_deref(), Some("u1"));
            }
            _ => panic!("first notification should be ShowNow"),
        }
    }

    fn app_notification(
        id: &str,
        header: Option<&str>,
        icon: Option<&str>,
    ) -> NormalizedNotification {
        serde_json::from_value(json!({
            "id": id,
            "_accountId": "acct-1",
            "_serverHost": "misskey.example",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "type": "app",
            "header": header,
            "body": "Mewkで実績を獲得しました！",
            "icon": icon,
        }))
        .expect("fixture should deserialize")
    }

    /// 外部アプリの app 通知は header/body/icon を OS 通知に載せる (#900)。
    /// header が無ければ本家 sw と同じく body を title に繰り上げる。
    #[test]
    fn plan_uses_app_notification_header_body_icon() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone(), observing());

        match emitter.plan_os_notification(&app_notification(
            "a1",
            Some("Mewk | 実績解除"),
            Some("https://mewk.app/icon.png"),
        )) {
            OsNotifPlan::ShowNow {
                title, body, media, ..
            } => {
                assert_eq!(title, "Mewk | 実績解除");
                assert_eq!(body.as_deref(), Some("Mewkで実績を獲得しました！"));
                assert_eq!(
                    media
                        .expect("app icon should be attached")
                        .icon_url
                        .as_deref(),
                    Some("https://mewk.app/icon.png")
                );
            }
            _ => panic!("should be ShowNow"),
        }

        *emitter.last_os_notif.lock().unwrap() = None;
        match emitter.plan_os_notification(&app_notification("a2", None, None)) {
            OsNotifPlan::ShowNow { title, body, .. } => {
                assert_eq!(title, "Mewkで実績を獲得しました！");
                assert!(body.is_none());
            }
            _ => panic!("should be ShowNow"),
        }
    }

    fn reaction_notification(id: &str, reaction: &str) -> NormalizedNotification {
        serde_json::from_value(json!({
            "id": id,
            "_accountId": "acct-1",
            "_serverHost": "misskey.example",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "type": "reaction",
            "reaction": reaction,
            "user": {
                "id": "u1",
                "username": "alice",
                "avatarUrl": "https://misskey.example/avatar.webp",
            },
        }))
        .expect("fixture should deserialize")
    }

    /// カスタム絵文字リアクションは本家 sw と同じ /emoji/<name>.webp の
    /// フルカラー画像 + アバター icon を添付する。Unicode 絵文字は画像なし。
    #[test]
    fn plan_builds_media_for_custom_emoji_reaction() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone(), observing());

        let media = |n: &NormalizedNotification| match emitter.plan_os_notification(n) {
            OsNotifPlan::ShowNow { media, .. } => media,
            _ => panic!("should be ShowNow"),
        };

        // バースト集約を避けるため窓をリセットしながら 3 パターン検証
        let custom = media(&reaction_notification("m1", ":igyo@.:"));
        let custom = custom.expect("custom emoji reaction should carry media");
        assert_eq!(
            custom.image_url.as_deref(),
            Some("https://misskey.example/emoji/igyo@..webp")
        );
        assert_eq!(
            custom.icon_url.as_deref(),
            Some("https://misskey.example/avatar.webp")
        );

        *emitter.last_os_notif.lock().unwrap() = None;
        let remote = media(&reaction_notification("m2", ":neofox@fedi.example:"));
        assert_eq!(
            remote
                .expect("remote emoji should carry media")
                .image_url
                .as_deref(),
            Some("https://misskey.example/emoji/neofox@fedi.example.webp")
        );

        *emitter.last_os_notif.lock().unwrap() = None;
        let unicode = media(&reaction_notification("m3", "👍"));
        let unicode = unicode.expect("avatar keeps media present");
        assert!(
            unicode.image_url.is_none(),
            "Unicode 絵文字は画像なしのはず"
        );
        assert!(unicode.icon_url.is_some());
    }
}
