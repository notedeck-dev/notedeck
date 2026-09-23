pub mod api;
pub mod cli;
pub mod commands;
pub mod db;
pub mod error;
pub mod event_bus;
pub mod format;
pub mod http_server;
pub mod identity;
pub(crate) mod insecure;
pub mod keychain;
pub mod models;
pub mod server_info;
pub mod streaming;

use db::Database;
use error::{AuthErrorKind, NoteDeckError};
use zeroize::Zeroize;

/// Retrieve host and API token for an account.
/// Tries keychain first, falls back to DB token with lazy migration.
pub fn get_credentials(db: &Database, account_id: &str) -> Result<(String, String), NoteDeckError> {
    let account = db
        .get_account(account_id)?
        .ok_or_else(|| NoteDeckError::AccountNotFound(account_id.to_string()))?;
    let host = account.host.clone();

    // Try keychain first (ignore errors — keychain may be unavailable)
    if let Some(token) = keychain::get_token(account_id).ok().flatten() {
        // 再起動非永続な store (Linux keyutils) では DB フォールバックを消さない (notedeck#785)
        if !account.token.is_empty() && keychain::is_persistent() {
            let _ = db.clear_token(account_id);
        }
        return Ok((host, token));
    }

    // Fallback: use DB token
    let mut db_token = account.token.clone();
    if !db_token.is_empty() {
        // Try lazy migration to keychain; verify before clearing DB
        if keychain::is_persistent()
            && keychain::store_token(account_id, &db_token).is_ok()
            && keychain::get_token(account_id).ok().flatten().is_some()
        {
            let _ = db.clear_token(account_id);
        }
        let token = db_token.clone();
        db_token.zeroize();
        return Ok((host, token));
    }

    Err(NoteDeckError::Auth(AuthErrorKind::NoToken(
        account_id.to_string(),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keychain;
    use crate::models::Account;

    fn temp_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("test.db")).unwrap();
        (dir, db)
    }

    fn sample_account(id: &str, token: &str) -> Account {
        Account {
            id: id.into(),
            host: "misskey.io".into(),
            token: token.into(),
            user_id: "uid1".into(),
            username: "taka".into(),
            display_name: None,
            avatar_url: None,
            software: "misskey".into(),
        }
    }

    #[test]
    fn get_credentials_account_not_found() {
        let (_dir, db) = temp_db();
        let err = get_credentials(&db, "nonexistent").unwrap_err();
        assert_eq!(err.code(), "ACCOUNT_NOT_FOUND");
    }

    #[test]
    fn get_credentials_no_token() {
        // keyring feature が有効だと本物の OS キーチェーンを叩く。他のテストが同じ id で
        // 保存した token を拾わないよう、テストごとに固有の id を使い、事前に消しておく
        let (_dir, db) = temp_db();
        let _ = keychain::delete_token("acc-no-token");
        let account = sample_account("acc-no-token", "");
        db.upsert_account(&account).unwrap();
        // keychain に無く、DB token も空 → Auth error
        let err = get_credentials(&db, "acc-no-token").unwrap_err();
        assert_eq!(err.code(), "AUTH_NO_TOKEN");
    }

    #[test]
    fn get_credentials_db_fallback() {
        let (_dir, db) = temp_db();
        let _ = keychain::delete_token("acc-db-fallback");
        let account = sample_account("acc-db-fallback", "db-token-123");
        db.upsert_account(&account).unwrap();
        // keychain に無い → DB token にフォールバックする (keyring 有効時はここで keychain に
        // 移行されるので、テスト後に消して次回の実行に残さない)
        let (host, token) = get_credentials(&db, "acc-db-fallback").unwrap();
        assert_eq!(host, "misskey.io");
        assert_eq!(token, "db-token-123");
        let _ = keychain::delete_token("acc-db-fallback");
    }
}
