use notecli::error::NoteDeckError;

use super::Result;

#[tauri::command]
#[specta::specta]
pub fn get_cli_commands() -> Vec<notecli::cli::CliCommandInfo> {
    notecli::cli::command_metadata()
}

#[tauri::command]
#[specta::specta]
pub fn get_openapi_spec() -> serde_json::Value {
    serde_json::to_value(crate::http_server::openapi_spec()).unwrap_or_default()
}

#[tauri::command]
#[specta::specta]
pub fn get_rustc_version() -> String {
    option_env!("RUSTC_VERSION_INFO")
        .unwrap_or("unknown")
        .to_string()
}

#[tauri::command]
#[specta::specta]
pub fn open_devtools(window: tauri::WebviewWindow) {
    window.open_devtools();
}

/// Android のステータスバー/ナビゲーションバーのアイコン色をアプリテーマに
/// 追従させる (#755)。edge-to-edge (enableEdgeToEdge) 環境ではバー背景は
/// WebView がそのまま透けるため、切り替えが必要なのはアイコンの明暗のみ。
/// light_background = true (ライトテーマ) なら濃色アイコンにする。
/// Android 以外では no-op。
#[tauri::command]
#[specta::specta]
pub fn set_status_bar_style(light_background: bool) {
    #[cfg(target_os = "android")]
    {
        // tauri コマンドは JVM main thread 外で走るため FindClass では
        // アプリクラスを解決できない。ndk_context の Activity インスタンスに
        // 直接 call_method する (Kotlin 側が runOnUiThread へ hop する)。
        let result = (|| -> Result<(), jni::errors::Error> {
            let ctx = ndk_context::android_context();
            let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }?;
            let mut env = vm.attach_current_thread()?;
            let activity = unsafe { jni::objects::JObject::from_raw(ctx.context().cast()) };
            env.call_method(
                &activity,
                "setStatusBarStyle",
                "(Z)V",
                &[jni::objects::JValue::Bool(light_background as u8)],
            )?;
            Ok(())
        })();
        if let Err(e) = result {
            tracing::warn!("[status-bar] JNI call failed: {e}");
        }
    }
    #[cfg(not(target_os = "android"))]
    let _ = light_background;
}

/// Validate that a file has a valid SQLite header.
fn validate_sqlite_file(path: &std::path::Path) -> Result<()> {
    let header = std::fs::read(path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read file: {e}")))?;
    if header.len() < 16 || &header[..16] != b"SQLite format 3\0" {
        return Err(NoteDeckError::InvalidInput(
            "Not a valid SQLite database file".to_string(),
        ));
    }
    Ok(())
}

/// Export notecli.db to a user-chosen location via save dialog.
#[tauri::command]
#[specta::specta]
pub async fn export_db(app: tauri::AppHandle) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;

    let app_dir = crate::app_dir::resolve_app_dir(&app)
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    let db_path = app_dir.join("notecli.db");
    if !db_path.exists() {
        return Err(NoteDeckError::InvalidInput(
            "notecli.db not found".to_string(),
        ));
    }

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
        .ok_or_else(|| NoteDeckError::InvalidInput("Invalid destination path".to_string()))?;
    std::fs::copy(&db_path, dest_path)
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    Ok(true)
}

/// Import notecli.db from a user-chosen file via open dialog.
/// Replaces the current database file. Caller should relaunch the app afterwards
/// so that Rust re-opens the new DB with a fresh connection.
#[tauri::command]
#[specta::specta]
pub async fn import_db(app: tauri::AppHandle) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;

    let app_dir = crate::app_dir::resolve_app_dir(&app)
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    let db_path = app_dir.join("notecli.db");

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

    validate_sqlite_file(src_path)?;

    std::fs::copy(src_path, &db_path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to import database: {e}")))?;

    // Remove WAL/SHM files so the new DB starts clean after relaunch
    let _ = std::fs::remove_file(app_dir.join("notecli.db-wal"));
    let _ = std::fs::remove_file(app_dir.join("notecli.db-shm"));

    Ok(true)
}

/// Download an image from URL and save to a user-chosen location via save dialog.
#[tauri::command]
#[specta::specta]
pub async fn save_image_to_file(app: tauri::AppHandle, url: String) -> Result<bool> {
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

    let ext = file_name
        .rsplit('.')
        .next()
        .unwrap_or("png")
        .to_lowercase();

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

    // Download image
    let response = reqwest::get(&url)
        .await
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to download image: {e}")))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read image data: {e}")))?;

    std::fs::write(dest_path, &bytes)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to save image: {e}")))?;

    Ok(true)
}

// --- EXIF viewer (#797) ---

/// EXIF 1 フィールド。tag はタグ名 (例: "DateTimeOriginal", "GPSLatitude")。
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExifField {
    /// IFD 名 ("primary" / "thumbnail")
    pub ifd: String,
    pub tag: String,
    pub value: String,
}

/// MakerNote 等の巨大なバイナリ値を UI 向けに切り詰める上限
const EXIF_VALUE_MAX_CHARS: usize = 200;
/// EXIF 読み取りのためにダウンロードする画像サイズの上限
const EXIF_FETCH_MAX_BYTES: usize = 64 * 1024 * 1024;

fn parse_exif_fields(buf: &[u8]) -> Result<Vec<ExifField>> {
    let exif = match exif::Reader::new().read_from_container(&mut std::io::Cursor::new(buf)) {
        Ok(exif) => exif,
        // EXIF セグメント自体が無い = メタデータなし（正常系）
        Err(exif::Error::NotFound(_)) => return Ok(Vec::new()),
        Err(e) => {
            return Err(NoteDeckError::InvalidInput(format!(
                "Failed to parse image: {e}"
            )))
        }
    };
    Ok(exif
        .fields()
        .map(|f| {
            let mut value = f.display_value().with_unit(&exif).to_string();
            if value.chars().count() > EXIF_VALUE_MAX_CHARS {
                value = value.chars().take(EXIF_VALUE_MAX_CHARS).collect::<String>() + "…";
            }
            ExifField {
                ifd: if f.ifd_num == exif::In::PRIMARY {
                    "primary".to_string()
                } else {
                    "thumbnail".to_string()
                },
                tag: f.tag.to_string(),
                value,
            }
        })
        .collect())
}

/// 画像 URL から EXIF フィールド一覧を読み取る。EXIF が無い場合は空リスト。
#[tauri::command]
#[specta::specta]
pub async fn read_image_exif(url: String) -> Result<Vec<ExifField>> {
    if !url.starts_with("https://") {
        return Err(NoteDeckError::InvalidInput(
            "Only https URLs are allowed".to_string(),
        ));
    }

    let mut response = reqwest::get(&url)
        .await
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to download image: {e}")))?;
    if let Some(len) = response.content_length() {
        if len as usize > EXIF_FETCH_MAX_BYTES {
            return Err(NoteDeckError::InvalidInput(
                "Image is too large to inspect".to_string(),
            ));
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read image data: {e}")))?
    {
        if buf.len() + chunk.len() > EXIF_FETCH_MAX_BYTES {
            return Err(NoteDeckError::InvalidInput(
                "Image is too large to inspect".to_string(),
            ));
        }
        buf.extend_from_slice(&chunk);
    }

    parse_exif_fields(&buf)
}

/// 未読合計を OS へ反映する (#748):
/// - macOS Dock / Linux ランチャー: バッジ件数
/// - Windows: タスクバーのオーバーレイドット
/// - トレイ: tooltip の件数表記 + アイコン右上の未読ドット
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
                format!("NoteDeck — 未読 {count} 件")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_sqlite_valid() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        // Write valid SQLite header + padding
        let mut data = b"SQLite format 3\0".to_vec();
        data.resize(100, 0);
        std::fs::write(&path, &data).unwrap();
        assert!(validate_sqlite_file(&path).is_ok());
    }

    #[test]
    fn validate_sqlite_invalid_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("not-a-db.txt");
        std::fs::write(&path, "this is not a database").unwrap();
        assert!(validate_sqlite_file(&path).is_err());
    }

    #[test]
    fn validate_sqlite_too_small() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tiny.db");
        std::fs::write(&path, "small").unwrap();
        assert!(validate_sqlite_file(&path).is_err());
    }

    #[test]
    fn validate_sqlite_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.db");
        std::fs::write(&path, "").unwrap();
        assert!(validate_sqlite_file(&path).is_err());
    }

    #[test]
    fn parse_exif_fields_reads_tiff_tags() {
        // 最小の TIFF (little endian): Make = "abc" の 1 エントリ IFD
        let buf: Vec<u8> = vec![
            0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, // II*\0, IFD offset 8
            0x01, 0x00, // entry count = 1
            0x0F, 0x01, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, // Make, ASCII, count 4
            0x61, 0x62, 0x63, 0x00, // "abc\0" (inline)
            0x00, 0x00, 0x00, 0x00, // next IFD = 0
        ];
        let fields = parse_exif_fields(&buf).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].tag, "Make");
        assert_eq!(fields[0].ifd, "primary");
        assert!(fields[0].value.contains("abc"));
    }

    #[test]
    fn parse_exif_fields_returns_empty_for_jpeg_without_exif() {
        // SOI + EOI のみの JPEG (EXIF セグメントなし)
        let buf: Vec<u8> = vec![0xFF, 0xD8, 0xFF, 0xD9];
        let fields = parse_exif_fields(&buf).unwrap();
        assert!(fields.is_empty());
    }

    #[test]
    fn parse_exif_fields_rejects_non_image_bytes() {
        assert!(parse_exif_fields(b"this is not an image at all").is_err());
    }
}
