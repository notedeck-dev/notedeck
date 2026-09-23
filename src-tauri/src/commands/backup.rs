//! バックアップの手元側 (#1106): 保存先はこの端末のダウンロードフォルダ。
//! 本体は [`notecore::backup_service`]。

use std::path::PathBuf;

use notecli::error::NoteDeckError;
use tauri::Manager;

use super::Result;
use notecore::backup_service::{self, BackupResult, BACKUP_SUBDIR};

fn backup_root(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dl = app
        .path()
        .download_dir()
        .map_err(|e| NoteDeckError::InvalidInput(format!("download dir unavailable: {e}")))?;
    Ok(dl.join("notedeck").join(BACKUP_SUBDIR))
}

/// バックアップ保存先を (無ければ作って) 返す。UI の「フォルダを開く」用
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn get_backup_dir(app: tauri::AppHandle) -> Result<String> {
    let root = backup_root(&app)?;
    std::fs::create_dir_all(&root)
        .map_err(|e| NoteDeckError::InvalidInput(format!("failed to create backup dir: {e}")))?;
    Ok(root.to_string_lossy().into_owned())
}

/// バックアップを 1 世代作成する。`stamp` はフロントが生成した Zettelkasten 形式の日時。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn backup_create(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, super::AppState>,
    stamp: String,
    keep: Option<u32>,
    include_db: Option<bool>,
    include_settings: Option<bool>,
) -> Result<BackupResult> {
    let root = backup_root(&app)?;
    backup_service::create(&app_state, &root, stamp, keep, include_db, include_settings).await
}
