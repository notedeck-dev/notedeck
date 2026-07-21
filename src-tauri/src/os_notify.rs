//! OS 通知のクリック遷移 (#754)。
//!
//! tauri-plugin-notification のデスクトップ実装はクリックイベントを取得できない
//! (上流 tauri-apps/plugins-workspace#2150) ため、プラットフォームで経路を分ける:
//!
//! - Linux / Windows: user-notify crate で表示し、クリック (Default action) を
//!   コールバックで受けて main window をフォーカス + `NotificationClicked` を emit
//! - macOS: user-notify は署名済み bundle (Apple Developer 署名) が必須のため
//!   従来の plugin 経路を維持 (クリック遷移なし)。署名導入時に解禁する
//! - Android: plugin の `extra` にコンテキストを積み、JS 側 onAction が遷移する
//!   (このモジュールは使わない — streaming.rs 参照)

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// Windows toast の protocol 起動 (#754) に使う専用 URI スキーム。
/// notedeck:// と分けるのは、通知クリック URL (user-notify の encode 形式:
/// `<scheme>://<notification_id>/__default__?<base64 user_info>`) が
/// 通常の deep-link (notedeck://<host>/...) と構文が違うため。
pub const NOTIFICATION_PROTOCOL: &str = "notedeck-notification";

/// Windows の Action Center からの cold start (#754) で、フロントの
/// リスナー登録前に届いた通知クリックを保持する。フロントがデッキ初期化時に
/// `notification_take_pending_click` で取り出す (take で 1 回きり)。
#[derive(Default)]
pub struct PendingNotificationClick(pub std::sync::Mutex<Option<NotificationClicked>>);

/// OS 通知クリック時にフロントへ渡す遷移コンテキスト。
/// noteId があればノート詳細、なければ userId でユーザー詳細を開く。
/// どちらもない (要約通知・システム通知) 場合はウィンドウのフォーカスのみ。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct NotificationClicked {
    pub account_id: String,
    pub note_id: Option<String>,
    pub user_id: Option<String>,
}

/// 通知に添付するメディア。Misskey 本家の web push (icon=アバター,
/// badge=絵文字シルエット) を参考に、デスクトップでは icon = アクターの
/// アバター、image = リアクションのカスタム絵文字 (フルカラー) を表示する。
/// Linux/Windows (user-notify 経路) のみ使用。macOS/Android は未対応。
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(any(target_os = "macos", target_os = "android"), allow(dead_code))]
pub struct NotifyMedia {
    pub icon_url: Option<String>,
    pub image_url: Option<String>,
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
mod desktop {
    use std::collections::HashMap;
    use std::sync::{Arc, OnceLock};

    use tauri::Manager;
    use tauri_specta::Event;
    use user_notify::{NotificationManager, NotificationResponseAction};

    use super::NotificationClicked;

    static MANAGER: OnceLock<Arc<dyn NotificationManager>> = OnceLock::new();

    /// user-notify manager を初期化し、クリックコールバックを登録する。
    /// setup (Phase 1) から 1 回だけ呼ぶ。
    pub fn init<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
        // notification_protocol は Windows のみ意味を持つ (#754): toast の
        // activationType が protocol になり、クリックはコールバックではなく
        // NOTIFICATION_PROTOCOL:// URL の起動として届く (lib.rs の deep-link
        // ハンドラで decode)。アプリ終了後の Action Center クリックでも
        // single-instance / deep-link 経由でアプリを起こせる。
        let manager = user_notify::get_notification_manager(
            app.config().identifier.clone(),
            Some(super::NOTIFICATION_PROTOCOL.to_string()),
        );
        let handle = app.clone();
        let register_result = manager.register(
            Box::new(move |response| {
                // Dismiss (スワイプ/閉じる) では遷移しない
                if !matches!(response.action, NotificationResponseAction::Default) {
                    return;
                }
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
                let info = &response.user_info;
                if let Some(account_id) = info.get("accountId") {
                    let event = NotificationClicked {
                        account_id: account_id.clone(),
                        note_id: info.get("noteId").cloned(),
                        user_id: info.get("userId").cloned(),
                    };
                    if let Err(e) = event.emit(&handle) {
                        tracing::warn!("[notification] click emit failed: {e}");
                    }
                }
            }),
            vec![],
        );
        if let Err(e) = register_result {
            tracing::warn!("[notification] click handler registration failed: {e:?}");
        }
        let _ = MANAGER.set(manager);
    }

    /// OS 通知を表示する。context があればクリック時の遷移ペイロードとして
    /// user_info に積み、media があればアバター/絵文字画像を添付する。
    pub fn show(
        title: &str,
        body: Option<&str>,
        context: Option<&NotificationClicked>,
        media: Option<&super::NotifyMedia>,
    ) {
        // 未初期化 (ユニットテスト等) は no-op
        let Some(manager) = MANAGER.get() else {
            return;
        };
        let mut builder = user_notify::NotificationBuilder::new().title(title);
        if let Some(body) = body {
            builder = builder.body(body);
        }
        if let Some(ctx) = context {
            let mut info = HashMap::new();
            info.insert("accountId".to_string(), ctx.account_id.clone());
            if let Some(note_id) = &ctx.note_id {
                info.insert("noteId".to_string(), note_id.clone());
            }
            if let Some(user_id) = &ctx.user_id {
                info.insert("userId".to_string(), user_id.clone());
            }
            builder = builder.set_user_info(info);
        }
        // Linux の send_notification は内部でブロッキングの notify-rust
        // handle_action を呼び、通知が閉じられるまで返らない。tokio ワーカーを
        // 塞がないよう通知 1 件ごとに専用スレッドで送る (通知は数秒で expire
        // するのでスレッドは短命)。画像フェッチも同スレッドで行い、失敗時は
        // 画像なしで表示を続行する。
        let manager = Arc::clone(manager);
        let media = media.cloned();
        std::thread::spawn(move || {
            if let Some(media) = media {
                if let Some(path) = media.icon_url.as_deref().and_then(fetch_to_cache) {
                    builder = builder.set_icon(path).set_icon_round_crop(true);
                }
                if let Some(path) = media.image_url.as_deref().and_then(fetch_to_cache) {
                    builder = builder.set_image(path);
                }
            }
            if let Err(e) = tauri::async_runtime::block_on(manager.send_notification(builder)) {
                tracing::warn!("[notification] failed to send: {e:?}");
            }
        });
    }

    fn http_client() -> &'static reqwest::Client {
        static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
        CLIENT.get_or_init(|| {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(4))
                .build()
                .unwrap_or_default()
        })
    }

    /// 画像 URL を fetch して PNG に再エンコードし、キャッシュパスを返す。
    /// Misskey のアバター/絵文字は webp が多いが Windows toast は webp を
    /// 表示できないため、常に PNG へ変換する。失敗はすべて None (画像なしで
    /// 通知を出す)。
    fn fetch_to_cache(url: &str) -> Option<std::path::PathBuf> {
        let dir = std::env::temp_dir().join("notedeck-notif");
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join(format!("{}.png", crate::image_cache::hex_hash(url)));
        if path.exists() {
            return Some(path);
        }
        let bytes = tauri::async_runtime::block_on(async {
            let resp = http_client().get(url).send().await.ok()?;
            if !resp.status().is_success() {
                return None;
            }
            resp.bytes().await.ok()
        })?;
        let img = image::load_from_memory(&bytes).ok()?;
        // 通知アイコンには十分な解像度に抑える (メモリ・ディスク節約)
        let img = if img.width() > 512 || img.height() > 512 {
            img.thumbnail(512, 512)
        } else {
            img
        };
        img.save_with_format(&path, image::ImageFormat::Png).ok()?;
        Some(path)
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub use desktop::{init, show};

/// Windows: toast の protocol 起動 URL (NOTIFICATION_PROTOCOL://) を
/// 遷移コンテキストに復元する (#754)。Default action 以外 (dismiss) や
/// accountId なし (バースト要約通知) は None = フォーカスのみでよい。
#[cfg(target_os = "windows")]
pub fn decode_protocol_url(url: &str) -> Option<NotificationClicked> {
    let resp = match user_notify::decode_deeplink(url) {
        Ok(resp) => resp,
        Err(e) => {
            tracing::warn!("[notification] protocol url decode failed: {e:?}");
            return None;
        }
    };
    if !matches!(resp.action, user_notify::NotificationResponseAction::Default) {
        return None;
    }
    Some(NotificationClicked {
        account_id: resp.user_info.get("accountId")?.clone(),
        note_id: resp.user_info.get("noteId").cloned(),
        user_id: resp.user_info.get("userId").cloned(),
    })
}
