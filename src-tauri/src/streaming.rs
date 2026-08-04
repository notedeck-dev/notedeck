use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notecli::models::NormalizedNotification;
use notecli::streaming::FrontendEmitter;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
#[cfg(any(target_os = "macos", target_os = "android"))]
use tauri_plugin_notification::NotificationExt;
use tauri_specta::Event;

use crate::os_notify::{NotificationClicked, NotifyMedia};

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

/// broadcast の絵文字辞書変更 (#889)。絵文字ストアが購読して push 反映する。
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct StreamEmojiChanged(pub notecli::streaming::StreamEmojiChangedEvent);

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
    /// クリック時の遷移コンテキスト (#754)。要約通知になると失われる。
    context: Option<NotificationClicked>,
    /// アバター/絵文字画像 (#754)。要約通知になると失われる。
    media: Option<NotifyMedia>,
}

/// send_native_notification の判定結果。表示 (副作用) と分離してテスト可能にする。
enum OsNotifPlan {
    /// dedup 済み・未知 type・フォーカス中 → 何もしない
    Suppress,
    /// 個別に即時表示 (バースト外の 1 件目 / Android)
    ShowNow {
        title: String,
        body: Option<String>,
        context: Option<NotificationClicked>,
        media: Option<NotifyMedia>,
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
            let body = if names.len() > GROUP_MAX_NAMES {
                format!("{} ほか", names[..GROUP_MAX_NAMES].join("、"))
            } else {
                names.join("、")
            };
            Some(PendingOsNotification {
                title: format!("新着通知 {} 件", items.len()),
                body: Some(body),
                context: None,
                media: None,
            })
        }
    }
}

/// `host` は Android の deep link 組み立て用 (通知元アカウントのサーバー)。
/// バースト要約通知は複数サーバーにまたがりうるので None。
fn show_os_notification<R: tauri::Runtime>(
    app: &AppHandle<R>,
    title: &str,
    body: Option<&str>,
    context: Option<&NotificationClicked>,
    media: Option<&NotifyMedia>,
    host: Option<&str>,
) {
    // Linux / Windows: user-notify 経由 (クリック遷移 + 画像添付, #754)。
    // 画像取得は ImageCache を通す (setup 前の呼び出しでは None = 画像なし)
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let _ = host;
        let cache = app
            .try_state::<std::sync::Arc<crate::image_cache::ImageCache>>()
            .map(|s| s.inner().clone());
        crate::os_notify::show(title, body, context, media, cache);
    }

    // macOS: user-notify は署名済み bundle 必須のため plugin 経路を維持
    // (クリック遷移・画像は署名導入までブロック, #754)
    #[cfg(target_os = "macos")]
    {
        let _ = (context, media, host);
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
        // 通知の large icon の表示上限は 64dp 程度。3x 密度でも足りる幅の
        // variant を要求する (静止画のみ縮小、アニメーションは原本素通し)
        const AVATAR_MAX_WIDTH: u32 = 256;

        let deep_link = host.and_then(|h| android_deep_link(h, context));
        let app = app.clone();
        let title = title.to_string();
        let body = body.map(str::to_string);
        let icon_url = media.and_then(|m| m.icon_url.clone());
        let image_url = media.and_then(|m| m.image_url.clone());
        tauri::async_runtime::spawn(async move {
            // ImageCache は setup で manage される。未登録 (起動直後) なら
            // 画像なしで通知だけ出す
            let cache = app
                .try_state::<std::sync::Arc<crate::image_cache::ImageCache>>()
                .map(|s| s.inner().clone());
            let (icon_path, image_path) = match cache {
                Some(cache) => {
                    let icon = match icon_url {
                        Some(u) => {
                            crate::notify_media::ensure_local_file(
                                &cache,
                                &u,
                                Some(AVATAR_MAX_WIDTH),
                            )
                            .await
                        }
                        None => None,
                    };
                    // 絵文字はアニメーション保持のため変換なし (原本)。decode の
                    // メモリ安全は Kotlin 側の inSampleSize が担保する
                    let image = match image_url {
                        Some(u) => crate::notify_media::ensure_local_file(&cache, &u, None).await,
                        None => None,
                    };
                    (icon, image)
                }
                None => (None, None),
            };
            show_android_notification(
                &title,
                body.as_deref(),
                deep_link.as_deref(),
                icon_path.as_deref().and_then(|p| p.to_str()),
                image_path.as_deref().and_then(|p| p.to_str()),
            );
        });
    }
}

/// MainActivity.showRichNotification を JNI で呼ぶ。avatar_path / image_path
/// は ImageCache のローカルファイル (URL ではない)。
#[cfg(target_os = "android")]
fn show_android_notification(
    title: &str,
    body: Option<&str>,
    deep_link: Option<&str>,
    avatar_path: Option<&str>,
    image_path: Option<&str>,
) {
    use jni::objects::{JObject, JValue};

    let ctx = ndk_context::android_context();
    let vm = match unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) } {
        Ok(vm) => vm,
        Err(e) => {
            tracing::warn!("[notification] JavaVM unavailable: {e}");
            return;
        }
    };
    let mut env = match vm.attach_current_thread() {
        Ok(env) => env,
        Err(e) => {
            tracing::warn!("[notification] attach_current_thread failed: {e}");
            return;
        }
    };
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

    // Option<&str> → Java の String / null
    fn jstr<'a>(
        env: &mut jni::JNIEnv<'a>,
        s: Option<&str>,
    ) -> std::result::Result<JObject<'a>, jni::errors::Error> {
        match s {
            Some(s) => Ok(env.new_string(s)?.into()),
            None => Ok(JObject::null()),
        }
    }

    let result = (|| -> std::result::Result<(), jni::errors::Error> {
        let j_title = jstr(&mut env, Some(title))?;
        let j_body = jstr(&mut env, body)?;
        let j_link = jstr(&mut env, deep_link)?;
        let j_avatar = jstr(&mut env, avatar_path)?;
        let j_image = jstr(&mut env, image_path)?;

        env.call_method(
            &activity,
            "showRichNotification",
            "(ILjava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V",
            &[
                JValue::Int(next_notification_id()),
                JValue::Object(&j_title),
                JValue::Object(&j_body),
                JValue::Object(&j_link),
                JValue::Object(&j_avatar),
                JValue::Object(&j_image),
            ],
        )?;
        Ok(())
    })();
    if let Err(e) = result {
        // Err を warn するだけで済ませると JVM 側の pending exception が残り、
        // 同一スレッドの次の JNI 呼び出しで ART が "called with pending
        // exception" として abort する (プロセス即死)。必ずクリアする
        // (describe で logcat に原因を残す)
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        tracing::warn!("[notification] JNI call failed: {e}");
    }
}

/// Android の通知タップで開く deep link。デスクトップの遷移仕様に合わせ、
/// note があればノート詳細、なければ user でユーザー詳細、どちらもなければ
/// None (アプリを前面に出すだけ)。
#[cfg(target_os = "android")]
fn android_deep_link(host: &str, context: Option<&NotificationClicked>) -> Option<String> {
    let ctx = context?;
    if let Some(note_id) = &ctx.note_id {
        Some(format!("notedeck://{host}/note/{note_id}"))
    } else {
        ctx.user_id
            .as_ref()
            .map(|user_id| format!("notedeck://{host}/user/{user_id}"))
    }
}

/// Android の通知 ID。同じ ID で notify すると上書きされるため通知ごとに進める。
#[cfg(target_os = "android")]
fn next_notification_id() -> i32 {
    use std::sync::atomic::{AtomicI32, Ordering};
    static NEXT: AtomicI32 = AtomicI32::new(1);
    // NotificationWorker の GROUP_SUMMARY_ID (i32::MAX - 1) と衝突しない範囲で回す
    NEXT.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
        Some(if v >= 1_000_000 { 1 } else { v + 1 })
    })
    .unwrap_or(1)
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
            OsNotifPlan::ShowNow {
                title,
                body,
                context,
                media,
            } => {
                show_os_notification(
                    &self.app,
                    &title,
                    body.as_deref(),
                    context.as_ref(),
                    media.as_ref(),
                    Some(&notification.server_host),
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
                            );
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
            // 外部アプリ (notifications/create) 由来。本家 sw に合わせ header が
            // あれば title=header / body=body、無ければ body を title に繰り上げる
            "app" => match (notification.header.as_deref(), notification.body.as_deref()) {
                (Some(header), body) => (header.to_string(), body.map(str::to_string)),
                (None, Some(body)) => (body.to_string(), None),
                (None, None) => ("通知".to_string(), None),
            },
            "test" => ("テスト通知".to_string(), Some("テスト通知".to_string())),

            _ => return OsNotifPlan::Suppress,
        };

        // クリック時の遷移コンテキスト (#754)。note があればノート詳細、
        // なければ user でユーザー詳細。どちらもなければフォーカスのみ。
        let context = Some(NotificationClicked {
            account_id: notification.account_id.clone(),
            note_id: notification.note.as_ref().map(|n| n.id.clone()),
            user_id: notification.user.as_ref().map(|u| u.id.clone()),
        });

        // 通知メディア: 本家 web push (icon=アバター, badge=絵文字) に倣い、
        // icon = アクターのアバター、リアクションのカスタム絵文字 (":name:" /
        // ":name@host:") はフルカラー画像として添付。Unicode 絵文字は本文に
        // 出るので画像なし。URL の形式は notify_media::emoji_image_url 参照。
        let media = {
            // app 通知はアクターが居ないので、送信元アプリの icon を代わりに使う
            let icon_url = notification
                .user
                .as_ref()
                .and_then(|u| u.avatar_url.clone())
                .or_else(|| notification.icon.clone());
            let image_url = (notif_type == "reaction")
                .then_some(notification.reaction.as_deref())
                .flatten()
                .and_then(|r| crate::notify_media::emoji_image_url(&notification.server_host, r));
            (icon_url.is_some() || image_url.is_some()).then_some(NotifyMedia {
                icon_url,
                image_url,
            })
        };

        // Android は webview が凍結されうるため常に即時表示 (グルーピングは
        // channel 経由で OS が行う)
        #[cfg(target_os = "android")]
        {
            OsNotifPlan::ShowNow {
                title,
                body: body_opt,
                context,
                media,
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
                    context,
                    media,
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
            E::EmojiChanged(e) => StreamEmojiChanged((**e).clone()).emit(&self.app).err(),
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
    fn plan_carries_click_context() {
        let app = mock_app();
        let emitter = TauriEmitter::new(app.handle().clone());

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
        let emitter = TauriEmitter::new(app.handle().clone());

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
        let emitter = TauriEmitter::new(app.handle().clone());

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
