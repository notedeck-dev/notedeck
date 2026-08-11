//! 設定ファイル系コマンド。実体は `crate::settings_store` domain service (#782)。
//! ここに残るのは AppHandle からのパス解決・ダイアログ・OS 統合 (WSL エディタ
//! 委譲) のみ。

use std::fs;
use std::path::PathBuf;

use notecli::error::NoteDeckError;
use tauri::Manager;

use crate::settings_store as store;

use super::Result;

/// Settings subdirectory name under app_data_dir.
const SETTINGS_DIR: &str = "notedeck";

/// Resolve the settings base directory: `app_data_dir/notedeck/`.
fn settings_base_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let app_dir = crate::app_dir::resolve_app_dir(app)
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    Ok(app_dir.join(SETTINGS_DIR))
}

/// List files in a settings subdirectory.
#[tauri::command]
#[specta::specta]
pub fn list_settings_files(app: tauri::AppHandle, subdir: &str) -> Result<Vec<String>> {
    store::list_files(&settings_base_dir(&app)?, subdir)
}

/// Read a settings file as a UTF-8 string.
#[tauri::command]
#[specta::specta]
pub fn read_settings_file(app: tauri::AppHandle, subdir: &str, name: &str) -> Result<String> {
    store::read_file(&settings_base_dir(&app)?, subdir, name)
}

/// Write a settings file (creates parent directories if needed).
#[tauri::command]
#[specta::specta]
pub fn write_settings_file(
    app: tauri::AppHandle,
    subdir: &str,
    name: &str,
    content: &str,
) -> Result<()> {
    store::write_file(&settings_base_dir(&app)?, subdir, name, content)
}

/// Delete a settings file.
#[tauri::command]
#[specta::specta]
pub fn delete_settings_file(app: tauri::AppHandle, subdir: &str, name: &str) -> Result<()> {
    store::delete_file(&settings_base_dir(&app)?, subdir, name)
}

/// Rename a settings file within the same subdirectory.
#[tauri::command]
#[specta::specta]
pub fn rename_settings_file(
    app: tauri::AppHandle,
    subdir: &str,
    old_name: &str,
    new_name: &str,
) -> Result<()> {
    store::rename_file(&settings_base_dir(&app)?, subdir, old_name, new_name)
}

/// Read a root-level settings file as a UTF-8 string.
#[tauri::command]
#[specta::specta]
pub fn read_root_settings_file(app: tauri::AppHandle, name: &str) -> Result<String> {
    store::read_root_file(&settings_base_dir(&app)?, name)
}

/// Write a root-level settings file.
#[tauri::command]
#[specta::specta]
pub fn write_root_settings_file(app: tauri::AppHandle, name: &str, content: &str) -> Result<()> {
    store::write_root_file(&settings_base_dir(&app)?, name, content)
}

/// Get the settings directory path (so users can open it in file manager).
#[tauri::command]
#[specta::specta]
pub fn get_settings_dir(app: tauri::AppHandle) -> Result<String> {
    Ok(settings_base_dir(&app)?.to_string_lossy().to_string())
}

/// Get the log directory path (`app_log_dir`, holds `notedeck.log` — #644).
/// Separate from the settings dir, so the "ファイル → ログフォルダを開く" menu
/// item can reveal it. Created if missing so it opens even when empty.
#[tauri::command]
#[specta::specta]
pub fn get_log_dir(app: tauri::AppHandle) -> Result<String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.to_string_lossy().to_string())
}

/// Open a settings file in the OS default editor. WSL2 では xdg-open が GUI
/// エディタへルーティングできないため、wslpath で Windows パスへ変換し
/// cmd.exe start 経由で Windows 側の既定アプリに委譲する。
#[tauri::command]
#[specta::specta]
pub fn open_settings_file_in_editor(
    app: tauri::AppHandle,
    subdir: Option<String>,
    name: String,
) -> Result<()> {
    let base = settings_base_dir(&app)?;
    let path = match subdir.as_deref() {
        Some(s) => store::resolve_file(&base, s, &name)?,
        None => store::resolve_root_file(&base, &name)?,
    };
    if !path.exists() {
        return Err(NoteDeckError::InvalidInput(format!(
            "File does not exist: {}",
            path.display()
        )));
    }

    #[cfg(target_os = "linux")]
    if is_wsl() {
        return open_in_windows_host(&path);
    }

    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to open {}: {e}", path.display())))
}

#[cfg(target_os = "linux")]
fn is_wsl() -> bool {
    if std::env::var_os("WSL_DISTRO_NAME").is_some() {
        return true;
    }
    fs::read_to_string("/proc/version")
        .map(|v| {
            let lower = v.to_lowercase();
            lower.contains("microsoft") || lower.contains("wsl")
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn open_in_windows_host(path: &std::path::Path) -> Result<()> {
    use std::process::Command;
    let output = Command::new("wslpath")
        .arg("-w")
        .arg(path)
        .output()
        .map_err(|e| NoteDeckError::InvalidInput(format!("wslpath exec failed: {e}")))?;
    if !output.status.success() {
        return Err(NoteDeckError::InvalidInput(format!(
            "wslpath failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    let winpath = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // `start` は最初の引用符付き引数をウィンドウタイトルとして扱うので、
    // 空文字列のタイトルを先に渡してからパスを渡す。
    Command::new("cmd.exe")
        .args(["/c", "start", "", &winpath])
        .spawn()
        .map_err(|e| NoteDeckError::InvalidInput(format!("cmd.exe exec failed: {e}")))?;
    Ok(())
}

/// Read `settings.json5` (VSCode `settings.json` equivalent — single source of truth
/// for scalar preferences). Returns empty string if the file does not exist (first run).
///
/// Note: The Tauri command name stays `read_notedeck_json` for backwards-compatible
/// bindings. The file on disk is `settings.json5` to avoid collision with the export
/// bundle filename `notedeck.json`.
#[tauri::command]
#[specta::specta]
pub fn read_notedeck_json(app: tauri::AppHandle) -> Result<String> {
    store::read_settings_json(&settings_base_dir(&app)?)
}

/// Write `settings.json5`. Creates the settings directory if missing.
#[tauri::command]
#[specta::specta]
pub fn write_notedeck_json(app: tauri::AppHandle, content: &str) -> Result<()> {
    store::write_settings_json(&settings_base_dir(&app)?, content)
}

/// Export all settings files to a JSON bundle via save dialog.
#[tauri::command]
#[specta::specta]
pub async fn export_settings_json(app: tauri::AppHandle) -> Result<bool> {
    use tauri_plugin_dialog::DialogExt;

    let base_dir = settings_base_dir(&app)?;

    let dest = app
        .dialog()
        .file()
        .set_file_name("notedeck.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    let Some(dest) = dest else {
        return Ok(false); // user cancelled
    };

    let dest_path = dest
        .as_path()
        .ok_or_else(|| NoteDeckError::InvalidInput("Invalid destination path".to_string()))?;

    let bundle = store::export_bundle(&base_dir)?;
    let json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to serialize: {e}")))?;
    fs::write(dest_path, json)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to write: {e}")))?;

    Ok(true)
}

/// import_settings_json の結果。`imported: false` はダイアログのキャンセル。
/// `warnings` はスキップ / 別名退避したエントリの説明 (#913 付随修正 — フロントは
/// 復元完了メッセージに件数 + 内容を表示する)。
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettingsResult {
    pub imported: bool,
    pub warnings: Vec<String>,
}

/// Import settings from a JSON bundle via open dialog.
#[tauri::command]
#[specta::specta]
pub async fn import_settings_json(app: tauri::AppHandle) -> Result<ImportSettingsResult> {
    use std::collections::BTreeMap;
    use tauri_plugin_dialog::DialogExt;

    let base_dir = settings_base_dir(&app)?;

    let src = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    let Some(src) = src else {
        // user cancelled
        return Ok(ImportSettingsResult {
            imported: false,
            warnings: vec![],
        });
    };

    let src_path = src
        .as_path()
        .ok_or_else(|| NoteDeckError::InvalidInput("Invalid source path".to_string()))?;

    let raw = fs::read_to_string(src_path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read file: {e}")))?;
    let bundle: BTreeMap<String, String> = serde_json::from_str(&raw)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Invalid JSON: {e}")))?;

    let warnings = store::import_bundle(&base_dir, &bundle)?;

    Ok(ImportSettingsResult {
        imported: true,
        warnings,
    })
}
