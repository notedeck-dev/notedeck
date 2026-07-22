//! アカウントのライフサイクル手続き (#782 R3)。
//!
//! delete / logout の「credential cache 無効化 → keychain 削除 → DB」の順序、
//! ゲストの連番採番、has_token 判定 (AccountPublic 化) を一元化する。
//! has_token 判定は従来 load_accounts と emit_accounts_early に重複していた。

use notecli::db::Database;
use notecli::error::NoteDeckError;
use notecli::keychain;
use notecli::models::{Account, AccountPublic};

use crate::commands::invalidate_credentials;

type Result<T> = std::result::Result<T, NoteDeckError>;

/// keychain / DB フォールバックを見て has_token を判定し AccountPublic 化する。
pub fn to_public(account: &Account) -> AccountPublic {
    let has_token =
        !account.token.is_empty() || keychain::get_token(&account.id).ok().flatten().is_some();
    AccountPublic::new(account, has_token)
}

pub fn list_public(db: &Database) -> Result<Vec<AccountPublic>> {
    Ok(db.load_accounts()?.iter().map(to_public).collect())
}

/// アカウント完全削除。cache 無効化 → keychain → DB の順で行う
/// (使用中の資格情報を先に無効化してから実体を消す)。
pub fn delete(db: &Database, id: &str) -> Result<()> {
    invalidate_credentials(id);
    let _ = keychain::delete_token(id);
    db.delete_account(id)?;
    Ok(())
}

/// ログアウト: トークンのみ削除し、アカウント行とカラムは維持する。
pub fn logout(db: &Database, id: &str) -> Result<()> {
    invalidate_credentials(id);
    let _ = keychain::delete_token(id);
    db.clear_token(id)?;
    Ok(())
}

/// 既存アカウント一覧からゲストの連番表示名 (「ゲスト N」) を決める。
pub fn next_guest_display_name(accounts: &[Account]) -> String {
    let guest_count = accounts.iter().filter(|a| a.user_id == "__guest__").count();
    format!("ゲスト{}", guest_count + 1)
}

/// ゲスト (未認証) アカウントを作成して保存する。host は検証済みであること。
pub fn create_guest(db: &Database, host: String, software: String) -> Result<Account> {
    let id = uuid::Uuid::new_v4().to_string();
    let username = format!("guest_{}", &id[..8]);
    let display_name = Some(next_guest_display_name(
        &db.load_accounts().unwrap_or_default(),
    ));
    let account = Account {
        id,
        host,
        token: String::new(),
        user_id: "__guest__".to_string(),
        username,
        display_name,
        avatar_url: None,
        software,
    };
    db.upsert_account(&account)?;
    Ok(account)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guest(n: u8) -> Account {
        Account {
            id: format!("g{n}"),
            host: "misskey.io".into(),
            token: String::new(),
            user_id: "__guest__".into(),
            username: format!("guest_{n}"),
            display_name: None,
            avatar_url: None,
            software: "misskey-dev/misskey".into(),
        }
    }

    #[test]
    fn guest_display_name_is_sequential() {
        assert_eq!(next_guest_display_name(&[]), "ゲスト1");
        assert_eq!(next_guest_display_name(&[guest(1)]), "ゲスト2");
        // 通常アカウントは数えない
        let mut normal = guest(9);
        normal.user_id = "u1".into();
        assert_eq!(next_guest_display_name(&[normal, guest(1)]), "ゲスト2");
    }
}
