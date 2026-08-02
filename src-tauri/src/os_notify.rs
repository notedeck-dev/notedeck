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
    /// 画像の取得は ImageCache (ディスク/メモリキャッシュ・negative cache・
    /// circuit breaker・サイズ上限) を通す。cache が None (未初期化) なら
    /// 画像なしで表示する。
    pub fn show(
        title: &str,
        body: Option<&str>,
        context: Option<&NotificationClicked>,
        media: Option<&super::NotifyMedia>,
        cache: Option<Arc<crate::image_cache::ImageCache>>,
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
            if let (Some(media), Some(cache)) = (media, cache) {
                if let Some(path) = media
                    .icon_url
                    .as_deref()
                    .and_then(|url| fetch_to_cache(&cache, url))
                {
                    builder = builder.set_icon(path).set_icon_round_crop(true);
                }
                if let Some(url) = media.image_url.as_deref() {
                    // Windows のみ高さを揃える (normalize_emoji_height 参照)。
                    // Linux は ImageData ヒントで小さな枠に収まるので原寸のまま。
                    #[cfg(target_os = "windows")]
                    let path = cache_png(&cache, url, "-emoji", normalize_emoji_height);
                    #[cfg(not(target_os = "windows"))]
                    let path = fetch_to_cache(&cache, url);
                    if let Some(path) = path {
                        builder = builder.set_image(path);
                    }
                }
            }
            if let Err(e) = tauri::async_runtime::block_on(manager.send_notification(builder)) {
                tracing::warn!("[notification] failed to send: {e:?}");
            }
        });
    }

    /// 画像 URL を PNG に再エンコードし、キャッシュパスを返す。
    /// Misskey のアバター/絵文字は webp が多いが Windows toast は webp を
    /// 表示できないため、常に PNG へ変換する。失敗はすべて None (画像なしで
    /// 通知を出す)。
    fn fetch_to_cache(
        cache: &crate::image_cache::ImageCache,
        url: &str,
    ) -> Option<std::path::PathBuf> {
        cache_png(cache, url, "", |img| {
            // 通知アイコンには十分な解像度に抑える (メモリ・ディスク節約)
            if img.width() > 512 || img.height() > 512 {
                img.thumbnail(512, 512)
            } else {
                img
            }
        })
    }

    /// ImageCache 経由で取得 → decode (寸法上限あり) → transform → PNG 保存。
    /// suffix はキャッシュキーの区別用 (同じ URL でも変換後の画像は別ファイル
    /// になる)。専用スレッド上なので block_on してよい。
    fn cache_png(
        cache: &crate::image_cache::ImageCache,
        url: &str,
        suffix: &str,
        transform: impl FnOnce(image::DynamicImage) -> image::DynamicImage,
    ) -> Option<std::path::PathBuf> {
        let dir = std::env::temp_dir().join("notedeck-notif");
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join(format!("{}{suffix}.png", crate::image_cache::hex_hash(url)));
        if path.exists() {
            return Some(path);
        }
        let bytes = tauri::async_runtime::block_on(crate::notify_media::ensure_bytes(cache, url))?;
        // 寸法上限なしの decode は巨大 PNG の RGBA 展開でメモリを食い潰す。
        // 画像プロキシの変換 (media_proxy::transform_image) と同じ上限を掛ける
        let mut reader = image::ImageReader::new(std::io::Cursor::new(&bytes))
            .with_guessed_format()
            .ok()?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(crate::media_proxy::MAX_DECODE_DIMENSION);
        limits.max_image_height = Some(crate::media_proxy::MAX_DECODE_DIMENSION);
        reader.limits(limits);
        let img = transform(reader.decode().ok()?);
        img.save_with_format(&path, image::ImageFormat::Png).ok()?;
        Some(path)
    }

    /// Windows toast のインライン画像 (`<image id="1">`) はトーストの横幅に
    /// 合わせて拡縮されるため、表示される高さは画像のアスペクト比だけで決まる。
    /// カスタム絵文字は正方形・横長・縦長が混在するので、そのまま渡すと通知
    /// ごとに高さがバラバラになる。固定サイズの透明カンバスに「高さを揃えて」
    /// 中央配置し、アスペクト比を一定にすることで表示上の高さだけを統一する。
    /// 横幅は絵文字ごとにカンバス内で変わる (揃えると横長絵文字が小さく潰れる)。
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    fn normalize_emoji_height(img: image::DynamicImage) -> image::DynamicImage {
        // 表示幅 364px / 高さ 64px (100% スケール) の 2 倍で持つ
        const CANVAS_W: u32 = 728;
        const CANVAS_H: u32 = 128;

        // resize はアスペクト比を保って枠内に収めるので、CANVAS_W:CANVAS_H
        // (5.7:1) より横長の絵文字だけは幅で頭打ちになり高さが縮む
        let fitted = img
            .resize(CANVAS_W, CANVAS_H, image::imageops::FilterType::Lanczos3)
            .to_rgba8();
        let mut canvas = image::RgbaImage::new(CANVAS_W, CANVAS_H);
        let x = ((CANVAS_W - fitted.width()) / 2) as i64;
        let y = ((CANVAS_H - fitted.height()) / 2) as i64;
        image::imageops::overlay(&mut canvas, &fitted, x, y);
        image::DynamicImage::ImageRgba8(canvas)
    }

    #[cfg(test)]
    mod tests {
        use super::normalize_emoji_height;
        use image::{DynamicImage, GenericImageView, RgbaImage};

        fn emoji(w: u32, h: u32) -> DynamicImage {
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(w, h, image::Rgba([1, 2, 3, 255])))
        }

        #[test]
        fn normalized_emoji_has_fixed_canvas_regardless_of_source_size() {
            for (w, h) in [(128, 128), (32, 32), (256, 64), (64, 256)] {
                let out = normalize_emoji_height(emoji(w, h));
                assert_eq!(out.dimensions(), (728, 128), "source {w}x{h}");
            }
        }

        #[test]
        fn wide_emoji_keeps_aspect_ratio_and_is_centered() {
            // 256x64 (4:1) → 高さ 128 に合わせると 512x128
            let out = normalize_emoji_height(emoji(256, 64));
            let rgba = out.to_rgba8();
            assert_eq!(rgba.get_pixel(0, 64)[3], 0, "左端は透明余白");
            assert_eq!(rgba.get_pixel(364, 64)[3], 255, "中央に絵文字がある");
            assert_eq!(rgba.get_pixel(727, 64)[3], 0, "右端は透明余白");
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "windows"))]
pub use desktop::{init, show};

/// Windows: toast の protocol 起動 URL (NOTIFICATION_PROTOCOL://) を
/// 遷移コンテキストに復元する (#754)。Default action 以外 (dismiss) や
/// accountId なし (バースト要約通知) は None = フォーカスのみでよい。
#[cfg(target_os = "windows")]
pub fn decode_protocol_url(url: &str) -> Option<NotificationClicked> {
    let resp = match user_notify::windows::decode_deeplink(url) {
        Ok(resp) => resp,
        Err(e) => {
            tracing::warn!("[notification] protocol url decode failed: {e:?}");
            return None;
        }
    };
    if !matches!(
        resp.action,
        user_notify::NotificationResponseAction::Default
    ) {
        return None;
    }
    Some(NotificationClicked {
        account_id: resp.user_info.get("accountId")?.clone(),
        note_id: resp.user_info.get("noteId").cloned(),
        user_id: resp.user_info.get("userId").cloned(),
    })
}
