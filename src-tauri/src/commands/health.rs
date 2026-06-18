//! Healthcheck (#644) — アプリの自己診断。
//!
//! notecli の `doctor` と同じチェック (database / keychain / accounts /
//! network / auth) を `diagnose()` で再利用し、notedeck 固有のランタイム状態
//! (backend ready / cache / HEARTBEAT / ログ場所) を足して 1 つの [`HealthReport`]
//! に集約する。About ウィンドウの healthcheck ダイアログがこれを表示する。

use std::sync::Arc;

use notecli::error::NoteDeckError;
use tauri::{Manager, State};

use super::{AppState, HeartbeatScheduler, Result};

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    /// notecli doctor の結果 (database / keychain / accounts / network / auth)。
    pub doctor: notecli::commands::doctor::Report,
    /// バックエンド (DB + MisskeyClient) の初期化が完了しているか。
    pub backend_ready: bool,
    pub note_cache_count: i64,
    pub db_size_bytes: i64,
    /// HEARTBEAT scheduler の現在 interval (分)。未登録なら null。
    pub heartbeat_interval_minutes: Option<u32>,
    /// notedeck.log を含むログディレクトリ (#644)。解決できなければ null。
    pub log_dir: Option<String>,
}

#[tauri::command]
#[specta::specta]
pub async fn run_healthcheck(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    scheduler: State<'_, Arc<HeartbeatScheduler>>,
) -> Result<HealthReport> {
    let db = app_state.db().await;
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?
        .join("notecli.db");

    // doctor のチェックを丸ごと再利用 (account_spec = None で全アカウント対象)。
    let doctor = notecli::commands::doctor::diagnose(db.as_ref(), &db_path, None).await?;
    let (note_cache_count, db_size_bytes) = db.cache_stats()?;
    let log_dir = app
        .path()
        .app_log_dir()
        .ok()
        .map(|p| p.to_string_lossy().into_owned());

    Ok(HealthReport {
        doctor,
        backend_ready: app_state.is_ready(),
        note_cache_count,
        db_size_bytes,
        heartbeat_interval_minutes: scheduler.current_interval(),
        log_dir,
    })
}
