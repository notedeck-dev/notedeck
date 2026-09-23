//! ファイルエクスポートの手元側 (#1106): 保存先はこの端末のダウンロードフォルダ、
//! 進捗は Tauri イベント。本体は [`notecore::export_service`]。

use std::path::PathBuf;

use tauri::Manager;
use tauri_specta::Event;

use notecore::export_service::{self, ExportFileItem, ExportProgress};

// notecore のペイロード型を Tauri イベントとして流すための newtype (orphan rule 対策)。
// transparent なので TS 側の型名とイベント名 (`export-progress`) は変わらない。
#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct ExportProgressEvent(pub ExportProgress);

impl Event for ExportProgressEvent {
    const NAME: &'static str = "export-progress";
}

fn export_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dl = app
        .path()
        .download_dir()
        .map_err(|e| format!("download dir unavailable: {e}"))?;
    Ok(dl.join("notedeck"))
}

/// エクスポートルートを (無ければ作って) 返す。… メニューの
/// 「ダウンロードフォルダを開く」用
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn get_export_dir(app: tauri::AppHandle) -> Result<String, String> {
    let root = export_root(&app)?;
    std::fs::create_dir_all(&root).map_err(|e| format!("failed to create export dir: {e}"))?;
    Ok(root.to_string_lossy().into_owned())
}

// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn export_files_cancel(task_id: String) {
    export_service::cancel(&task_id);
}

/// エクスポートを開始し、解決済みの保存先ディレクトリを返す。
/// 即座に返り、以後の進捗は `ExportProgress` に流れる
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn export_files_start(
    app: tauri::AppHandle,
    task_id: String,
    segments: Vec<String>,
    items: Vec<ExportFileItem>,
) -> Result<String, String> {
    let root = export_root(&app)?;
    let sink = app.clone();
    export_service::start(
        root,
        task_id,
        segments,
        items,
        std::sync::Arc::new(move |p: ExportProgress| {
            let _ = ExportProgressEvent(p).emit(&sink);
        }),
    )
}
