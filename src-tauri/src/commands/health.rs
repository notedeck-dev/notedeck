//! Healthcheck (#644) — アプリの自己診断。
//!
//! notecli の `doctor` と同じチェック (database / keychain / accounts /
//! network / auth) を `diagnose()` で再利用し、notedeck 固有のランタイム状態
//! (backend ready / cache / HEARTBEAT / ログ場所) を足して 1 つの [`HealthReport`]
//! に集約する。About ウィンドウの healthcheck ダイアログがこれを表示する。

use std::sync::Arc;

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
    /// 記録されている直近の Rust panic。adb を繋げない Android でも
    /// ここから内容を読めるようにするのが主目的。無ければ null。
    pub last_panic: Option<notecore::crash_report::PanicReport>,
    /// AI (notemaid) がどこでどう動いているか (#1106)。繋がらない / 起動しない理由も含む
    pub notemaid: NotemaidDiagnostics,
}

/// AI の別プロセス (notemaid) の自己診断。事実だけを集め、判定は表示側が行う
#[derive(serde::Serialize, specta::Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotemaidDiagnostics {
    /// `in-process` (アプリの中) | `child` (アプリが起こした子プロセス) | `resident` (ログイン時タスク)
    pub mode: String,
    /// in-process に退避した理由 (子が起動しなかった等)。退避していなければ null
    pub fallback_reason: Option<String>,
    /// 中継の状態 (別プロセスのときだけ)
    pub relay: Option<crate::client_layer::ClientLayerState>,
    /// sidecar / 子プロセス / 常駐の登録 (デスクトップだけ)
    #[cfg(desktop)]
    pub launcher: Option<crate::maid_launcher::LauncherDiagnostics>,
    /// 動いている notemaid 自身の申告 (`notemaid.status`)。繋がっていなければ null
    pub daemon: Option<serde_json::Value>,
    /// HEARTBEAT の直近 (in-process ならこのプロセス、別プロセスなら notemaid の申告)
    pub heartbeat: serde_json::Value,
    /// notemaid のログの置き場 (データディレクトリの logs/)
    pub log_dir: Option<String>,
}

async fn notemaid_diagnostics(app_state: &AppState) -> NotemaidDiagnostics {
    let mut d = NotemaidDiagnostics {
        mode: "in-process".into(),
        heartbeat: notemaid::heartbeat::status_json(),
        log_dir: app_state
            .app_dir()
            .ok()
            .map(|p| p.join("logs").display().to_string()),
        ..Default::default()
    };
    #[cfg(desktop)]
    {
        d.launcher = Some(
            tokio::task::spawn_blocking(crate::maid_launcher::diagnostics)
                .await
                .unwrap_or_default(),
        );
        let state = crate::client_layer::state();
        if let Some(relay) = crate::client_layer::relay() {
            d.mode = if d.launcher.as_ref().and_then(|l| l.child_pid).is_some() {
                "child".into()
            } else {
                "resident".into()
            };
            if state.connected {
                // 短く待つ: 診断で固まらない
                let outcome = tokio::time::timeout(
                    std::time::Duration::from_secs(3),
                    relay.request("notemaid.status", serde_json::json!({}), None),
                )
                .await;
                if let Ok(outcome) = outcome {
                    if outcome.ok {
                        if let Some(v) = outcome.result {
                            if let Some(hb) = v.get("heartbeat") {
                                d.heartbeat = hb.clone();
                            }
                            d.daemon = Some(v);
                        }
                    }
                }
            }
        } else if state.backend == "embedded" && state.last_error.is_some() {
            // 中継を作ったが退避した (子が起動しなかった等)
            d.fallback_reason = state.last_error.clone();
        }
        d.relay = crate::client_layer::relay().map(|_| state);
    }
    d
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
    // doctor とキャッシュの統計は notecore の担当 (データ面は常にこのプロセス)
    let core = notecore::commands::health::health_core(app_state).await?;
    let backend_ready = app_state.is_ready();
    let log_dir_path = app.path().app_log_dir().ok();
    let last_panic = log_dir_path
        .as_deref()
        .and_then(notecore::crash_report::read_last_panic);
    let log_dir = log_dir_path.map(|p| p.to_string_lossy().into_owned());

    let notemaid = notemaid_diagnostics(app_state).await;
    Ok(HealthReport {
        doctor: core.doctor,
        backend_ready,
        note_cache_count: core.note_cache_count,
        db_size_bytes: core.db_size_bytes,
        heartbeat_interval_minutes: scheduler.current_interval(),
        log_dir,
        last_panic,
        notemaid,
    })
}
