use std::path::Path;

use serde::Serialize;

use crate::api::MisskeyClient;
use crate::db::Database;
use crate::error::NoteDeckError;
use crate::format::{theme, OutputFormat};
use crate::keychain;
use crate::models::Account;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Warn,
    Fail,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Check {
    /// チェック項目名 (database, keychain, credentials, network, auth)
    pub name: String,
    pub status: Status,
    pub message: String,
    /// アカウント別チェックの場合の対象 (@user@host)。環境チェックは None。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    /// 失敗・警告時にユーザーが実行すべき修復コマンド/手順。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

impl Check {
    fn env(name: &str, status: Status, message: String) -> Self {
        Self {
            name: name.into(),
            status,
            message,
            account: None,
            fix: None,
        }
    }
    fn acc(account: &str, name: &str, status: Status, message: String) -> Self {
        Self {
            name: name.into(),
            status,
            message,
            account: Some(account.into()),
            fix: None,
        }
    }
    fn with_fix(mut self, fix: impl Into<String>) -> Self {
        self.fix = Some(fix.into());
        self
    }
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Report {
    pub ok: bool,
    pub checks: Vec<Check>,
}

/// 環境・アカウントの診断を実行し、結果を [`Report`] として返す。
/// 出力やプロセス終了は行わない — CLI 表示は [`run_doctor`] が、GUI (notedeck の
/// healthcheck) はこの [`Report`] を直接消費する。
pub async fn diagnose(
    db: &Database,
    db_path: &Path,
    account_spec: Option<&str>,
) -> Result<Report, NoteDeckError> {
    let mut checks = vec![check_database(db, db_path), check_keychain()];

    let accounts = db.load_accounts().unwrap_or_default();
    if accounts.is_empty() {
        checks.push(
            Check::env("accounts", Status::Warn, "no accounts registered".into())
                .with_fix("notecli login <HOST>"),
        );
    } else {
        checks.push(Check::env(
            "accounts",
            Status::Ok,
            format!("{} account(s) registered", accounts.len()),
        ));
    }

    let targets: Vec<&Account> = match account_spec {
        Some(spec) => accounts
            .iter()
            .filter(|a| account_matches(a, spec))
            .collect(),
        None => accounts.iter().collect(),
    };
    if let Some(spec) = account_spec {
        if targets.is_empty() && !accounts.is_empty() {
            checks.push(Check::env(
                "accounts",
                Status::Fail,
                format!("no account matched '{spec}'"),
            ));
        }
    }

    let client = MisskeyClient::new()?;
    for a in &targets {
        check_account(&client, a, &mut checks).await;
    }

    let ok = checks.iter().all(|c| c.status != Status::Fail);
    Ok(Report { ok, checks })
}

pub async fn run_doctor(
    db: &Database,
    db_path: &Path,
    account_spec: Option<&str>,
    fmt: OutputFormat,
) -> Result<(), NoteDeckError> {
    let report = diagnose(db, db_path, account_spec).await?;
    print_report(&report, fmt);

    // 出力は済んでいるので、fail があればここで終了コード 1 を返す
    // (main の汎用エラー表示で上書きされないよう自前で exit する)。
    if !report.ok {
        std::process::exit(1);
    }
    Ok(())
}

fn check_database(db: &Database, path: &Path) -> Check {
    match db.load_accounts() {
        Ok(_) => Check::env(
            "database",
            Status::Ok,
            format!("{} (readable)", path.display()),
        ),
        Err(e) => Check::env(
            "database",
            Status::Fail,
            format!("{}: {}", path.display(), e.safe_message()),
        ),
    }
}

fn check_keychain() -> Check {
    #[cfg(feature = "keyring")]
    {
        // 読み取り専用プローブ。存在しないキーは Ok(None) を返すので、
        // Err になった場合のみ keychain が利用不可と判断する。
        match keychain::get_token("__notecli_doctor_probe__") {
            Ok(_) => Check::env("keychain", Status::Ok, "available".into()),
            Err(e) => Check::env(
                "keychain",
                Status::Warn,
                format!("unavailable, falling back to DB: {}", e.safe_message()),
            ),
        }
    }
    #[cfg(not(feature = "keyring"))]
    {
        Check::env(
            "keychain",
            Status::Warn,
            "keyring feature disabled, tokens stored in DB".into(),
        )
    }
}

async fn check_account(client: &MisskeyClient, a: &Account, checks: &mut Vec<Check>) {
    let label = format!("@{}@{}", a.username, a.host);

    // 認証情報: keychain 優先、DB legacy は警告
    let token = if let Some(t) = keychain::get_token(&a.id).ok().flatten() {
        checks.push(Check::acc(
            &label,
            "credentials",
            Status::Ok,
            "token in keychain".into(),
        ));
        Some(t)
    } else if !a.token.is_empty() {
        checks.push(Check::acc(
            &label,
            "credentials",
            Status::Warn,
            "token in DB (legacy — keychain migration pending)".into(),
        ));
        Some(a.token.clone())
    } else {
        checks.push(
            Check::acc(
                &label,
                "credentials",
                Status::Fail,
                "no token found in keychain or DB".into(),
            )
            .with_fix(format!("notecli login {}", a.host)),
        );
        None
    };

    // サーバー疎通 (トークン不要)
    match client.fetch_server_meta(&a.host).await {
        Ok(meta) => {
            let version = meta.get("version").and_then(|v| v.as_str()).unwrap_or("?");
            checks.push(Check::acc(
                &label,
                "network",
                Status::Ok,
                format!("reachable ({} v{version})", a.software),
            ));
        }
        Err(e) => checks.push(Check::acc(
            &label,
            "network",
            Status::Fail,
            format!("unreachable: {}", e.safe_message()),
        )),
    }

    // トークン有効性 (/api/i)
    if let Some(token) = &token {
        match client.get_user_policies(&a.host, token).await {
            Ok(_) => checks.push(Check::acc(&label, "auth", Status::Ok, "token valid".into())),
            Err(e) => checks.push(
                Check::acc(
                    &label,
                    "auth",
                    Status::Fail,
                    format!("token rejected: {}", e.safe_message()),
                )
                .with_fix(format!("notecli login {}", a.host)),
            ),
        }
    }
}

fn account_matches(a: &Account, spec: &str) -> bool {
    if a.id == spec {
        return true;
    }
    if let Some(rest) = spec.strip_prefix('@') {
        if let Some((user, host)) = rest.split_once('@') {
            return a.username.eq_ignore_ascii_case(user) && a.host.contains(host);
        }
    }
    a.username.eq_ignore_ascii_case(spec)
}

fn print_report(report: &Report, fmt: OutputFormat) {
    match fmt {
        OutputFormat::Json => println!("{}", serde_json::to_string(report).unwrap()),
        OutputFormat::Jsonl => {
            for c in &report.checks {
                println!("{}", serde_json::to_string(c).unwrap());
            }
        }
        OutputFormat::Compact => {
            for c in &report.checks {
                println!(
                    "{}\t{}\t{}\t{}\t{}",
                    status_word(c.status),
                    c.account.as_deref().unwrap_or("-"),
                    c.name,
                    c.message,
                    c.fix.as_deref().unwrap_or("-")
                );
            }
        }
        OutputFormat::Ids => println!("{}", if report.ok { "ok" } else { "fail" }),
        OutputFormat::Default => print_default(report),
    }
}

fn print_default(report: &Report) {
    println!("{}", theme::heading("notecli doctor"));
    println!();

    println!("{}", theme::heading("Environment"));
    for c in report.checks.iter().filter(|c| c.account.is_none()) {
        print_line(c);
    }

    let mut current: Option<&str> = None;
    for c in report.checks.iter().filter(|c| c.account.is_some()) {
        let acc = c.account.as_deref().unwrap();
        if current != Some(acc) {
            println!();
            println!("{}", theme::user(acc));
            current = Some(acc);
        }
        print_line(c);
    }

    println!();
    let fails = report
        .checks
        .iter()
        .filter(|c| c.status == Status::Fail)
        .count();
    let warns = report
        .checks
        .iter()
        .filter(|c| c.status == Status::Warn)
        .count();
    if fails > 0 {
        println!("{}", theme::error(&format!("{fails} check(s) failed")));
    } else if warns > 0 {
        println!(
            "{}",
            theme::badge(&format!("all checks passed ({warns} warning(s))"))
        );
    } else {
        println!("{}", theme::success("all checks passed"));
    }
}

fn print_line(c: &Check) {
    println!("  {} {:<12} {}", glyph(c.status), c.name, c.message);
    if let Some(fix) = &c.fix {
        println!("      {}", theme::muted(&format!("→ run: {fix}")));
    }
}

fn glyph(status: Status) -> colored::ColoredString {
    match status {
        Status::Ok => theme::success("✓"),
        Status::Warn => theme::badge("⚠"),
        Status::Fail => theme::error("✗"),
    }
}

fn status_word(status: Status) -> &'static str {
    match status {
        Status::Ok => "ok",
        Status::Warn => "warn",
        Status::Fail => "fail",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account() -> Account {
        Account {
            id: "acc-1".into(),
            host: "misskey.io".into(),
            token: String::new(),
            user_id: "uid".into(),
            username: "taka".into(),
            display_name: None,
            avatar_url: None,
            software: "misskey".into(),
        }
    }

    #[test]
    fn matches_by_id() {
        assert!(account_matches(&account(), "acc-1"));
    }

    #[test]
    fn matches_by_handle() {
        assert!(account_matches(&account(), "@taka@misskey.io"));
        assert!(account_matches(&account(), "@TAKA@misskey")); // 大小無視・host部分一致
    }

    #[test]
    fn matches_by_username() {
        assert!(account_matches(&account(), "taka"));
    }

    #[test]
    fn no_match() {
        assert!(!account_matches(&account(), "@other@example.com"));
        assert!(!account_matches(&account(), "someone"));
    }
}
