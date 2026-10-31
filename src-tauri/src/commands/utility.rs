use notecli::error::NoteDeckError;

use super::Result;

/// 内蔵 HTTP サーバーが中継のポートを取れなかった (#1231)。bind の結果が出るまでは false
#[derive(Default)]
pub struct HttpRelayUnavailable(pub std::sync::atomic::AtomicBool);

/// 画像プロキシ (`/proxy/image`) の起動毎トークン (#1099)。フロントは起動時に
/// 1 回受け取り、プロキシ URL の query `t` に載せる。中継のポートを取れなかったと
/// 分かっているときは None を返し、フロントは中継を使わず元の URL で読む (#1231。
/// 後から開いたウィンドウ向け。起動中のウィンドウには `nd:http-relay-unavailable` で知らせる)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn get_media_proxy_token(
    token: tauri::State<'_, notecore::http_server::MediaProxyToken>,
    unavailable: tauri::State<'_, HttpRelayUnavailable>,
) -> Option<String> {
    if unavailable.0.load(std::sync::atomic::Ordering::Relaxed) {
        return None;
    }
    Some(token.0.clone())
}

// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn get_rustc_version() -> String {
    option_env!("RUSTC_VERSION_INFO")
        .unwrap_or("unknown")
        .to_string()
}

// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// 見えている通知カラムの口座を写す (#330 §3.3)。フロントがカラムの可視 (viewport 内 +
/// フォーカス) の変化ごとに和集合を送る。含まれる口座の通知は OS 通知にしない
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn set_visible_notification_scopes(
    window: tauri::Window,
    state: tauri::State<'_, crate::os_notify::VisibleNotificationScopes>,
    account_ids: Vec<String>,
) {
    // 呼び出し元のウィンドウの分だけ置き換える (別ウィンドウのデッキの分は残る)
    state.set(window.label(), account_ids);
}

/// 通知の権限を求める (Android 13 以上。他では no-op)。起動時ではなく、最初の口座を
/// 追加した直後に説明つきで呼ぶ (#330 §4.5)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn request_notification_permission() {
    #[cfg(target_os = "android")]
    {
        // tauri コマンドは JVM main thread 外で走るため FindClass ではアプリクラスを
        // 解決できない。Activity のメソッドなので ndk_context の Activity に直接
        // call_method する (set_status_bar_style と同じ)
        let result = (|| -> std::result::Result<(), jni::errors::Error> {
            let ctx = ndk_context::android_context();
            let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
            let mut env = vm.attach_current_thread()?;
            let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
            let call = env.call_method(&activity, "requestNotificationPermission", "()V", &[]);
            if call.is_err() && env.exception_check().unwrap_or(false) {
                let _ = env.exception_describe();
                let _ = env.exception_clear();
            }
            call.map(|_| ())
        })();
        if let Err(e) = result {
            tracing::warn!("[notification] permission request failed: {e}");
        }
    }
}

/// 通知が OS で許可されているか。Android 以外 (OS 通知の許可を別に持たない) と、
/// Android で判定できないときは None
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn notification_permission_granted() -> Option<bool> {
    #[cfg(target_os = "android")]
    {
        crate::android_notify::notifications_enabled()
    }
    #[cfg(not(target_os = "android"))]
    {
        None
    }
}

/// OS のこのアプリの通知設定を開く (Android。他では no-op)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn open_os_notification_settings() {
    #[cfg(target_os = "android")]
    crate::android_notify::open_settings();
}

/// Android のステータスバー/ナビゲーションバーのアイコン色をアプリテーマに
/// 追従させる (#755)。edge-to-edge (enableEdgeToEdge) 環境ではバー背景は
/// WebView がそのまま透けるため、切り替えが必要なのはアイコンの明暗のみ。
/// light_background = true (ライトテーマ) なら濃色アイコンにする。
/// Android 以外では no-op。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn set_status_bar_style(light_background: bool) {
    #[cfg(target_os = "android")]
    {
        // tauri コマンドは JVM main thread 外で走るため FindClass では
        // アプリクラスを解決できない。ndk_context の Activity インスタンスに
        // 直接 call_method する (Kotlin 側が runOnUiThread へ hop する)。
        // (std::result を明示 — super::Result エイリアスと衝突するため)
        let result = (|| -> std::result::Result<(), jni::errors::Error> {
            let ctx = ndk_context::android_context();
            let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
            let mut env = vm.attach_current_thread()?;
            let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
            let call = env.call_method(
                &activity,
                "setStatusBarStyle",
                "(Z)V",
                &[jni::objects::JValue::Bool(light_background as u8)],
            );
            // 失敗時に JVM 側の pending exception を残すと、同一スレッドの
            // 次の JNI 呼び出しで ART が abort する (プロセス即死)。必ずクリア
            if call.is_err() && env.exception_check().unwrap_or(false) {
                let _ = env.exception_describe();
                let _ = env.exception_clear();
            }
            call.map(|_| ())
        })();
        if let Err(e) = result {
            tracing::warn!("[status-bar] JNI call failed: {e}");
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = light_background;
}

/// Export notecli.db to a user-chosen location via save dialog.
///
/// DB は WAL モードのため単純なファイルコピーでは未反映のトランザクションが
/// 取り残される。notecli の `backup_to` (VACUUM INTO) で整合したスナップ
/// ショットを書き出す。
///
/// 認証情報は一切持ち出さない (トークン列は常に空にする)。通常トークンは
/// OS キーチェーンにあり DB に入らないため、別マシンに復元すればどのみち
/// 再ログインが必要になる。キーチェーンが永続しない環境では DB に平文で
/// 残るので、そこだけ持ち出されるのを防ぐ。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn export_db(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, super::AppState>,
) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;

    let dest = app
        .dialog()
        .file()
        .set_file_name("notecli.db")
        .add_filter("SQLite Database", &["db"])
        .blocking_save_file();

    let Some(dest) = dest else {
        return Ok(false); // user cancelled
    };

    let dest_path = dest
        .as_path()
        .ok_or_else(|| NoteDeckError::InvalidInput("Invalid destination path".to_string()))?
        .to_path_buf();

    notecore::commands::admin::snapshot_db_to(&app_state, &dest_path).await?;
    Ok(true)
}

/// Import notecli.db from a user-chosen file via open dialog.
/// Replaces the current database file. Caller should relaunch the app afterwards
/// so that Rust re-opens the new DB with a fresh connection.
///
/// 注意: V6 (note_timelines) 適用済みの DB は旧バージョンのアプリへ持ち込めない
/// (refinery の missing migration で open 不能。DB 自体は無傷)。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn import_db(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, super::AppState>,
) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;

    let src = app
        .dialog()
        .file()
        .add_filter("SQLite Database", &["db"])
        .blocking_pick_file();

    let Some(src) = src else {
        return Ok(false); // user cancelled
    };

    let src_path = src
        .as_path()
        .ok_or_else(|| NoteDeckError::InvalidInput("Invalid source path".to_string()))?;

    notecore::commands::admin::replace_database_file(app_state.app_dir()?, src_path)?;
    Ok(true)
}

/// Download an image from URL and save to a user-chosen location via save dialog.
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn save_image_to_file(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, super::AppState>,
    url: String,
) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;

    // Derive filename from URL
    let file_name = url
        .rsplit('/')
        .next()
        .unwrap_or("image")
        .split('?')
        .next()
        .unwrap_or("image")
        .to_string();

    let ext = file_name.rsplit('.').next().unwrap_or("png").to_lowercase();

    let filter_label = match ext.as_str() {
        "jpg" | "jpeg" => "JPEG Image",
        "png" => "PNG Image",
        "gif" => "GIF Image",
        "webp" => "WebP Image",
        "avif" => "AVIF Image",
        "svg" => "SVG Image",
        _ => "Image",
    };

    let dest = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter(filter_label, &[&ext])
        .blocking_save_file();

    let Some(dest) = dest else {
        return Ok(false); // user cancelled
    };

    let dest_path = dest
        .as_path()
        .ok_or_else(|| NoteDeckError::InvalidInput("Invalid destination path".to_string()))?;

    let bytes = notecore::commands::enrichment::fetch_image_bytes(&app_state, url).await?;

    std::fs::write(dest_path, &bytes)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to save image: {e}")))?;

    Ok(true)
}

/// 未読合計を OS へ反映する (#748):
/// - macOS Dock / Linux ランチャー: バッジ件数
/// - Windows: タスクバーのオーバーレイドット
/// - トレイ: tooltip の件数表記 + アイコン右上の未読ドット
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn set_unread_badge(app: tauri::AppHandle, count: u32) {
    #[cfg(mobile)]
    let _ = (&app, count);

    #[cfg(not(mobile))]
    {
        use tauri::Manager;

        if let Some(window) = app.get_webview_window("main") {
            #[cfg(target_os = "windows")]
            {
                let scale = window.scale_factor().unwrap_or(1.0);
                let overlay = (count > 0).then(|| overlay_count_icon(count, scale));
                let _ = window.set_overlay_icon(overlay);
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = window.set_badge_count((count > 0).then_some(count as i64));
            }
        }

        if let Some(tray) = app.tray_by_id("main") {
            let tooltip = if count > 0 {
                crate::ui_lang::t(
                    "_native.tray.unread_plural",
                    serde_json::json!({ "count": count }),
                )
            } else {
                "NoteDeck".to_string()
            };
            let _ = tray.set_tooltip(Some(tooltip));
            if let Some(base) = app.default_window_icon() {
                let icon = if count > 0 {
                    icon_with_unread_dot(base)
                } else {
                    base.clone()
                };
                let _ = tray.set_icon(Some(icon));
            }
        }
    }
}

/// 未読バッジの赤。Discord のブランドカラーの赤 (#ED4245) に揃える
#[cfg(any(test, not(mobile)))]
const BADGE_RED: [u8; 4] = [0xED, 0x42, 0x45, 0xFF];

/// ベースアイコンの右上に未読ドット (赤円) を焼き込む。
/// image crate 等の依存を増やさないため RGBA バッファを直接操作する。
#[cfg(not(mobile))]
fn icon_with_unread_dot(base: &tauri::image::Image<'_>) -> tauri::image::Image<'static> {
    let width = base.width() as usize;
    let height = base.height() as usize;
    let mut rgba = base.rgba().to_vec();
    let radius = (width.min(height) as f64) * 0.24;
    let cx = width as f64 - radius - 1.0;
    let cy = radius + 1.0;
    for y in 0..height {
        for x in 0..width {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            if dx * dx + dy * dy <= radius * radius {
                let i = (y * width + x) * 4;
                rgba[i..i + 4].copy_from_slice(&BADGE_RED);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, width as u32, height as u32)
}

/// Windows タスクバー用の未読バッジ。置き場所 (アイコンのどの角か) は OS が決めるので、
/// ここでは選べない。OS はオーバーレイを 16px × 表示倍率で描くため、その実寸で渡す
/// (大きく渡して OS に縮めさせるとにじむ)
#[cfg(target_os = "windows")]
fn overlay_count_icon(count: u32, scale: f64) -> tauri::image::Image<'static> {
    let size = (16.0 * scale).round() as u32;
    tauri::image::Image::new_owned(overlay_badge_rgba(count, size), size, size)
}

/// 赤円に未読件数 (10 以上は「9+」) を白で描いたバッジを size 四方で返す。
/// 元画像は `scripts/gen-badge-icons.mjs` が大きめの解像度で描いたもの
#[cfg(any(all(test, target_os = "linux"), target_os = "windows"))]
fn overlay_badge_rgba(count: u32, size: u32) -> Vec<u8> {
    const BADGES: [&[u8]; 10] = [
        include_bytes!("../../icons/badge/badge-1.png"),
        include_bytes!("../../icons/badge/badge-2.png"),
        include_bytes!("../../icons/badge/badge-3.png"),
        include_bytes!("../../icons/badge/badge-4.png"),
        include_bytes!("../../icons/badge/badge-5.png"),
        include_bytes!("../../icons/badge/badge-6.png"),
        include_bytes!("../../icons/badge/badge-7.png"),
        include_bytes!("../../icons/badge/badge-8.png"),
        include_bytes!("../../icons/badge/badge-9.png"),
        include_bytes!("../../icons/badge/badge-9plus.png"),
    ];
    let png = BADGES[count.clamp(1, 10) as usize - 1];
    let badge = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .expect("embedded badge PNG")
        .into_rgba8();
    image::imageops::resize(&badge, size, size, image::imageops::FilterType::CatmullRom).into_raw()
}

// image crate は Linux / Windows だけの依存なので、テストは Linux で回す
#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    fn pixel(rgba: &[u8], size: u32, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * size + x) * 4) as usize;
        rgba[i..i + 4].try_into().unwrap()
    }

    #[test]
    fn overlay_badge_is_drawn_at_the_requested_size() {
        for size in [16, 20, 24, 40] {
            assert_eq!(
                overlay_badge_rgba(1, size).len(),
                (size * size * 4) as usize
            );
        }
    }

    #[test]
    fn overlay_badge_shows_9_plus_for_ten_or_more() {
        assert_eq!(overlay_badge_rgba(10, 16), overlay_badge_rgba(250, 16));
        assert_ne!(overlay_badge_rgba(9, 16), overlay_badge_rgba(10, 16));
    }

    #[test]
    fn overlay_badge_is_a_red_circle_smaller_than_the_slot() {
        let rgba = overlay_badge_rgba(1, 32);
        // 枠の左端の中央は円の外 (透明)
        assert_eq!(pixel(&rgba, 32, 0, 16)[3], 0);
        // 円の上寄り (数字の外) はトレイのドットと同じ赤
        assert_eq!(pixel(&rgba, 32, 16, 5), BADGE_RED);
        // 中央付近に白い数字がある
        assert!((12..20)
            .flat_map(|y| (12..20).map(move |x| (x, y)))
            .any(|(x, y)| pixel(&rgba, 32, x, y) == [0xFF, 0xFF, 0xFF, 0xFF]));
    }
}
