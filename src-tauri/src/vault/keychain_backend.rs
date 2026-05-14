use secrecy::{ExposeSecret, SecretString};

use super::backend::{BackendCapabilities, SecretBackend};
use super::error::{VaultError, VaultResult};

/// `notecli::keychain` (OS キーチェーン) を使う [`SecretBackend`] 実装。
///
/// `notecli::keychain` の service 名は `"notedeck"` 固定で、Misskey トークン
/// (`<account-uuid>`) や AI キー (`ai.<provider>`) と同じ名前空間を共有する。
/// vault は account 名を `vault/v1/<conn_id>/<slot>` という構造化 path 風の
/// 文字列にすることで既存エントリーと衝突しない。
pub struct KeychainBackend;

/// keychain account 文字列を構成する。
///
/// `/` 区切りの構造化 path にすることで、`conn_id` / `slot` の検証が
/// 通っている限り delimiter injection は起きない (検証は呼び出し側の責務)。
fn keychain_account(conn_id: &str, slot: &str) -> String {
    format!("vault/v1/{conn_id}/{slot}")
}

impl SecretBackend for KeychainBackend {
    fn store(&self, conn_id: &str, slot: &str, value: &SecretString) -> VaultResult<()> {
        let account = keychain_account(conn_id, slot);
        notecli::keychain::store_token(&account, value.expose_secret()).map_err(VaultError::from)
    }

    fn load(&self, conn_id: &str, slot: &str) -> VaultResult<Option<SecretString>> {
        let account = keychain_account(conn_id, slot);
        let token = notecli::keychain::get_token(&account).map_err(VaultError::from)?;
        Ok(token.map(SecretString::from))
    }

    fn delete(&self, conn_id: &str, slot: &str) -> VaultResult<()> {
        let account = keychain_account(conn_id, slot);
        notecli::keychain::delete_token(&account).map_err(VaultError::from)
    }

    fn capabilities(&self) -> BackendCapabilities {
        // OS キーチェーンは概ね数 KB まで。控えめに 4 KiB を上限とする。
        BackendCapabilities {
            max_value_bytes: 4096,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_account_is_structured_path() {
        let acc = keychain_account("01HXXXXXXXXXXXXXXXXXXXXXXX", "primary");
        assert_eq!(acc, "vault/v1/01HXXXXXXXXXXXXXXXXXXXXXXX/primary");
    }
}
