//! タイムライン系のうち手元側に残るコマンド (#1106 段階 0b)。
//! データ系 (`api_get_timeline` 等) は notecore のコマンド表 (commands/table.rs) に移った。

use tauri::State;

use notecli::error::NoteDeckError;
use notecli::models::NormalizedDriveFile;

use super::{AppState, Result};
use notecore::commands::MAX_UPLOAD_BYTES;

// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn api_upload_file_from_path(
    app_state: State<'_, AppState>,
    account_id: String,
    file_path: String,
    is_sensitive: bool,
    folder_id: Option<String>,
) -> Result<NormalizedDriveFile> {
    let path = std::path::Path::new(&file_path);
    let file_data = std::fs::read(path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read file: {e}")))?;
    if file_data.len() > MAX_UPLOAD_BYTES {
        return Err(NoteDeckError::InvalidInput("File too large".to_string()));
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let content_type = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    // 端末のファイルを読んだあとはデータ系の api_upload_file と同じ経路 (型付き)
    notecore::commands::timeline::api_upload_file(
        &app_state,
        account_id,
        file_name,
        file_data,
        content_type,
        is_sensitive,
        folder_id,
    )
    .await
}
