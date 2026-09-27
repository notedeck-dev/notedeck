//! 自己診断のうち notecore が答えられる部分 (#644 / #1106)。doctor の検査とキャッシュの
//! 統計。手元のランタイム状態 (ログ場所 / HEARTBEAT の timer / 直近の panic) は
//! アプリ側が足す。常駐構成では notecored のこれを中継で取る

use serde::{Deserialize, Serialize};

use crate::context::Core;
use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CoreHealth {
    /// notecli doctor の結果 (database / keychain / accounts / network / auth)
    pub doctor: notecli::commands::doctor::Report,
    pub note_cache_count: i64,
    pub db_size_bytes: i64,
}

pub async fn health_core(core: &Core) -> Result<CoreHealth> {
    let db = core.db().await;
    let db_path = core.app_dir()?.join("notecli.db");
    // doctor のチェックを丸ごと再利用 (account_spec = None で全アカウント対象)
    let mut doctor = notecli::commands::doctor::diagnose(db.as_ref(), &db_path, None).await?;
    strip_guest_credential_checks(&mut doctor, &db.load_accounts().unwrap_or_default());
    let (note_cache_count, db_size_bytes) = db.cache_stats()?;
    Ok(CoreHealth {
        doctor,
        note_cache_count,
        db_size_bytes,
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
        strip_guest_credential_checks(&mut report, &[account("u1", "alice")]);
        assert_eq!(report.checks.len(), 1);
        assert!(!report.ok);
    }
}
