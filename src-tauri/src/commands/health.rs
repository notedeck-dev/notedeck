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
use notecore::commands::health::CoreHealth;

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
    /// 記録されている直近の Rust panic。adb を繋げない Android でも
    /// ここから内容を読めるようにするのが主目的。無ければ null。
    pub last_panic: Option<notecore::crash_report::PanicReport>,
}

// 手元のランタイム状態 (ログ場所 / HEARTBEAT scheduler) を含むので local。doctor 部分は
// notecore の health_core (常駐構成では中継)。HTTP API は FrontendBridge 経由で受ける
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn run_healthcheck(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    scheduler: State<'_, Arc<HeartbeatScheduler>>,
) -> Result<HealthReport> {
    build_health_report(&app, &app_state, &scheduler).await
}

/// [`run_healthcheck`] の本体。HTTP API (`GET /api/health`, #709) と Tauri
/// command の両方から呼べるよう managed state を引数で受ける。
pub async fn build_health_report(
    app: &tauri::AppHandle,
    app_state: &AppState,
    scheduler: &HeartbeatScheduler,
) -> Result<HealthReport> {
    // doctor とキャッシュの統計は notecore の担当。常駐構成では notecored のものを中継で取る
    let (core, backend_ready) = match crate::client_layer::relay() {
        Some(relay) => (
            relay
                .call::<CoreHealth, NoteDeckError>("health_core", serde_json::json!({}), None)
                .await?,
            relay.is_connected(),
        ),
        None => (
            notecore::commands::health::health_core(app_state).await?,
            app_state.is_ready(),
        ),
    };
    let log_dir_path = app.path().app_log_dir().ok();
    let last_panic = log_dir_path
        .as_deref()
        .and_then(notecore::crash_report::read_last_panic);
    let log_dir = log_dir_path.map(|p| p.to_string_lossy().into_owned());

    Ok(HealthReport {
        doctor: core.doctor,
        backend_ready,
        note_cache_count: core.note_cache_count,
        db_size_bytes: core.db_size_bytes,
        heartbeat_interval_minutes: scheduler.current_interval(),
        log_dir,
        last_panic,
    })
}
