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
    /// 記録されている直近の Rust panic。adb を繋げない Android でも
    /// ここから内容を読めるようにするのが主目的。無ければ null。
    pub last_panic: Option<crate::crash_report::PanicReport>,
}

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
    let db = app_state.db().await;
    let db_path = crate::app_dir::resolve_app_dir(app)
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?
        .join("notecli.db");

    // doctor のチェックを丸ごと再利用 (account_spec = None で全アカウント対象)。
    let mut doctor = notecli::commands::doctor::diagnose(db.as_ref(), &db_path, None).await?;
    strip_guest_credential_checks(&mut doctor, &db.load_accounts().unwrap_or_default());
    let (note_cache_count, db_size_bytes) = db.cache_stats()?;
    let log_dir_path = app.path().app_log_dir().ok();
    let last_panic = log_dir_path
        .as_deref()
        .and_then(crate::crash_report::read_last_panic);
    let log_dir = log_dir_path.map(|p| p.to_string_lossy().into_owned());

    Ok(HealthReport {
        doctor,
        backend_ready: app_state.is_ready(),
        note_cache_count,
        db_size_bytes,
        heartbeat_interval_minutes: scheduler.current_interval(),
        log_dir,
        last_panic,
    })
}

/// ゲストはトークンを持たないまま使うものなので、doctor の credentials
/// 失敗 (「no token found」) を診断結果から取り除く。ゲストは notedeck 側の
/// 概念なので notecli の doctor は区別できず、ここで落とす。
/// 対象の突き合わせは doctor が付けるアカウントラベル (`@user@host`) で行う。
fn strip_guest_credential_checks(
    report: &mut notecli::commands::doctor::Report,
    accounts: &[notecli::models::Account],
) {
    let guest_labels: Vec<String> = accounts
        .iter()
        .filter(|a| crate::account_service::is_guest(a))
        .map(|a| format!("@{}@{}", a.username, a.host))
        .collect();
    if guest_labels.is_empty() {
        return;
    }
    report.checks.retain(|c| {
        c.name != "credentials"
            || !c
                .account
                .as_ref()
                .is_some_and(|label| guest_labels.contains(label))
    });
    report.ok = report
        .checks
        .iter()
        .all(|c| c.status != notecli::commands::doctor::Status::Fail);
}

#[cfg(test)]
mod tests {
    use notecli::commands::doctor::{Check, Report, Status};
    use notecli::models::Account;

    use super::strip_guest_credential_checks;

    fn account(user_id: &str, username: &str) -> Account {
        Account {
            id: username.into(),
            host: "misskey.io".into(),
            token: String::new(),
            user_id: user_id.into(),
            username: username.into(),
            display_name: None,
            avatar_url: None,
            software: "misskey-dev/misskey".into(),
        }
    }

    fn credentials_fail(label: &str) -> Check {
        Check {
            name: "credentials".into(),
            status: Status::Fail,
            message: "no token found in keychain or DB".into(),
            account: Some(label.into()),
            fix: None,
        }
    }

    #[test]
    fn guest_credential_failure_is_dropped_and_report_recovers() {
        let mut report = Report {
            ok: false,
            checks: vec![credentials_fail("@guest_1@misskey.io")],
        };
        strip_guest_credential_checks(
            &mut report,
            &[account(crate::account_service::GUEST_USER_ID, "guest_1")],
        );
        assert!(report.checks.is_empty());
        assert!(report.ok);
    }

    #[test]
    fn logged_out_account_keeps_its_credential_failure() {
        let mut report = Report {
            ok: false,
            checks: vec![credentials_fail("@alice@misskey.io")],
        };
        strip_guest_credential_checks(
            &mut report,
            &[
                account(crate::account_service::GUEST_USER_ID, "guest_1"),
                account("u1", "alice"),
            ],
        );
        assert_eq!(report.checks.len(), 1);
        assert!(!report.ok);
    }
}
