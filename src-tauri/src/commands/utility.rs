use notecli::error::NoteDeckError;

use super::Result;

/// 画像プロキシ (`/proxy/image`) の起動毎トークン (#1099)。フロントは起動時に
/// 1 回受け取り、プロキシ URL の query `t` に載せる。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn get_media_proxy_token(
    token: tauri::State<'_, notecore::http_server::MediaProxyToken>,
) -> String {
    token.0.clone()
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

/// Windows の Action Center からの cold start (#754): 起動引数の
/// notedeck-notification:// URL から復元した通知クリックの遷移コンテキストを
/// 1 回だけ返す。フロントはデッキ初期化時に呼び、あればノート/ユーザーへ
/// 遷移する。Windows 以外では常に None。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn notification_take_pending_click(
    state: tauri::State<'_, crate::os_notify::PendingNotificationClick>,
) -> Option<crate::os_notify::NotificationClicked> {
    state.0.lock().ok().and_then(|mut pending| pending.take())
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
                let overlay = (count > 0).then(overlay_dot_icon);
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
                rgba[i..i + 4].copy_from_slice(&[0xE8, 0x11, 0x23, 0xFF]);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, width as u32, height as u32)
}

/// Windows タスクバー用: 透明背景に赤円のみのオーバーレイアイコン。
#[cfg(all(not(mobile), target_os = "windows"))]
fn overlay_dot_icon() -> tauri::image::Image<'static> {
    const SIZE: usize = 32;
    let mut rgba = vec![0u8; SIZE * SIZE * 4];
    let center = SIZE as f64 / 2.0 - 0.5;
    let radius = SIZE as f64 * 0.42;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f64 - center;
            let dy = y as f64 - center;
            if dx * dx + dy * dy <= radius * radius {
                let i = (y * SIZE + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[0xE8, 0x11, 0x23, 0xFF]);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, SIZE as u32, SIZE as u32)
}
