//! MiAuth 認証フローの手続き (#782 R3)。
//!
//! auth_start の権限リスト・検証・URL 組立と、auth_complete_and_save の
//! 「認証完了 → アカウント保存 → keychain 昇格」オーケストレーションを
//! commands/auth.rs から吸い上げる。セッション追跡 (AuthSessionTracker) は
//! リプレイ防止のため Tauri State に残し、コマンド側で consume する。

use std::sync::Arc;

use zeroize::Zeroize;

use notecli::api::MisskeyClient;
use notecli::db::Database;
use notecli::error::NoteDeckError;
use notecli::keychain;
use notecli::models::{Account, AccountPublic};

type Result<T> = std::result::Result<T, NoteDeckError>;

/// MiAuth で要求するデフォルト権限一式。
pub const DEFAULT_MIAUTH_PERMISSIONS: &[&str] = &[
    "read:account",
    "write:account",
    "read:notifications",
    "read:reactions",
    "read:favorites",
    "read:drive",
    "write:drive",
    "write:favorites",
    "read:following",
    "write:following",
    "read:mutes",
    "write:mutes",
    "read:blocks",
    "write:blocks",
    "write:notes",
    "write:reactions",
    "write:votes",
    "read:channels",
    "write:channels",
    "read:chat",
    "write:chat",
    "read:flash",
    "read:flash-likes",
    "write:flash-likes",
    "read:pages",
    "read:page-likes",
    "write:page-likes",
    "read:gallery",
    "read:gallery-likes",
    "write:gallery-likes",
    "read:federation",
];

/// permission 文字列を検証する (URL に埋め込むため文字種と長さを制限)。
pub fn validate_permissions(perms: &[String]) -> Result<()> {
    for perm in perms {
        if !perm
            .chars()
            .all(|c| c.is_alphanumeric() || c == ':' || c == '-')
            || perm.len() > 50
        {
            return Err(NoteDeckError::InvalidInput(format!(
                "Invalid permission: {perm}"
            )));
        }
    }
    Ok(())
}

/// MiAuth 認可 URL を組み立てる。host / permissions は検証済みであること。
pub fn build_miauth_url(host: &str, session_id: &str, perms: &[String]) -> String {
    let permission_str = perms.join(",");
    format!(
        "https://{host}/miauth/{session_id}?name=notedeck&icon=https%3A%2F%2Fraw.githubusercontent.com%2Fnotedeck-dev%2Fnotedeck%2Fmain%2Fsrc-tauri%2Ficons%2F128x128.png&permission={permission_str}"
    )
}

/// 認証完了 → アカウント保存 → keychain 昇格。
///
/// - DB にはトークン込みで保存 (キーチェーンのフォールバック)
/// - keychain へ保存し読み戻せたら DB のトークンをクリア。ただし再起動非永続な
///   store (Linux keyutils) では keychain はキャッシュ扱いとし DB フォールバックを
///   残す (#785)
/// - Re-auth の場合、DB 上の id は既存のものが維持される
pub async fn complete_and_save(
    db: &Arc<Database>,
    client: &Arc<MisskeyClient>,
    host: &str,
    session_id: &str,
    software: String,
) -> Result<AccountPublic> {
    let auth_result = client.complete_auth(host, session_id).await?;

    let mut token = auth_result.token;

    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        host: host.to_string(),
        token: token.clone(),
        user_id: auth_result.user.id.clone(),
        username: auth_result.user.username.clone(),
        display_name: auth_result.user.name.clone(),
        avatar_url: auth_result.user.avatar_url.clone(),
        software,
    };

    db.upsert_account(&account)?;

    let saved = db
        .get_account_by_host_user(host, &auth_result.user.id)?
        .ok_or_else(|| NoteDeckError::Auth("Failed to save account".to_string()))?;

    if keychain::store_token(&saved.id, &token).is_ok()
        && keychain::get_token(&saved.id).ok().flatten().is_some()
        && keychain::is_persistent()
    {
        let _ = db.clear_token(&saved.id);
    }
    token.zeroize();

    Ok(AccountPublic::new(&saved, true))
    // account, saved が drop → token が zeroize される
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_permissions_are_all_valid() {
        let perms: Vec<String> = DEFAULT_MIAUTH_PERMISSIONS
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert!(validate_permissions(&perms).is_ok());
    }

    #[test]
    fn injection_permissions_are_rejected() {
        for bad in ["read:account&evil=1", "a b", "x/y", &"p".repeat(51)] {
            assert!(
                validate_permissions(&[bad.to_string()]).is_err(),
                "should reject: {bad}"
            );
        }
    }

    #[test]
    fn miauth_url_contains_session_and_permissions() {
        let url = build_miauth_url(
            "misskey.io",
            "sess-1",
            &["read:account".to_string(), "write:notes".to_string()],
        );
        assert!(url.starts_with("https://misskey.io/miauth/sess-1?"));
        assert!(url.ends_with("permission=read:account,write:notes"));
    }
}
