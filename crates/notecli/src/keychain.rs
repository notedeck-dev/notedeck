use crate::error::NoteDeckError;

#[cfg(feature = "keyring")]
const SERVICE: &str = "notedeck";

/// Initialize the platform-specific credential store.
/// Must be called once before any keychain operations.
#[cfg(feature = "keyring")]
pub fn init_store() -> Result<(), NoteDeckError> {
    #[cfg(target_os = "android")]
    {
        let store = android_native_keyring_store::by_store::Store::new()
            .map_err(|e| NoteDeckError::Keychain(e.to_string()))?;
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "macos")]
    {
        let store = apple_native_keyring_store::keychain::Store::new()
            .map_err(|e| NoteDeckError::Keychain(e.to_string()))?;
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "ios")]
    {
        let store = apple_native_keyring_store::protected::Store::new()
            .map_err(|e| NoteDeckError::Keychain(e.to_string()))?;
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "windows")]
    {
        let store = windows_native_keyring_store::Store::new()
            .map_err(|e| NoteDeckError::Keychain(e.to_string()))?;
        keyring_core::set_default_store(store);
    }
    #[cfg(target_os = "linux")]
    {
        // secret-service (gnome-keyring / KWallet) が実際に使える場合のみ優先する:
        // at-rest 暗号化 + 再起動永続 (notedeck#786)。GUI デスクトップには原則存在する。
        // D-Bus 接続成功だけでは不十分 — WSL2 等では daemon がいても default collection
        // が無く「書込だけ」失敗するため、roundtrip probe で書いて読めることを確認する。
        // 使えない環境はカーネル keyutils に劣化する。keyutils は再起動非永続
        // (UntilReboot) のため DB フォールバックが正になる (notedeck#785)
        if let Ok(store) = zbus_secret_service_keyring_store::Store::new() {
            if probe_roundtrip(&store) {
                keyring_core::set_default_store(store);
                return Ok(());
            }
        }
        let store = linux_keyutils_keyring_store::Store::new()
            .map_err(|e| NoteDeckError::Keychain(e.to_string()))?;
        keyring_core::set_default_store(store);
    }
    Ok(())
}

/// store に実際に書いて読めるか確認する。接続可否ではなく roundtrip で判定するのは、
/// secret-service が「接続は成功するが collection が無く書込不能」という中間状態を
/// 取りうるため (WSL2 の gnome-keyring 等)。
#[cfg(all(feature = "keyring", target_os = "linux"))]
fn probe_roundtrip(store: &std::sync::Arc<zbus_secret_service_keyring_store::Store>) -> bool {
    use keyring_core::api::CredentialStoreApi;
    let Ok(entry) = store.build(SERVICE, "__store_probe__", None) else {
        return false;
    };
    if entry.set_password("probe").is_err() {
        return false;
    }
    let ok = matches!(entry.get_password().as_deref(), Ok("probe"));
    let _ = entry.delete_credential();
    ok
}

/// 現在の credential store が再起動をまたいで永続するかどうか。
///
/// Linux の keyutils store はカーネルメモリ常駐（`UntilReboot`）のため false。
/// false の場合、呼び出し側は DB 等の永続フォールバックを消してはならず、
/// keychain は高速キャッシュとして扱う（notedeck#785）。
#[cfg(feature = "keyring")]
pub fn is_persistent() -> bool {
    match keyring_core::get_default_store() {
        Some(store) => matches!(
            store.persistence(),
            keyring_core::CredentialPersistence::UntilDelete
        ),
        None => false,
    }
}

#[cfg(feature = "keyring")]
pub fn store_token(account_id: &str, token: &str) -> Result<(), NoteDeckError> {
    let entry = keyring_core::Entry::new(SERVICE, account_id)
        .map_err(|e| NoteDeckError::Keychain(e.to_string()))?;
    entry
        .set_password(token)
        .map_err(|e| NoteDeckError::Keychain(e.to_string()))
}

#[cfg(feature = "keyring")]
pub fn get_token(account_id: &str) -> Result<Option<String>, NoteDeckError> {
    let entry = keyring_core::Entry::new(SERVICE, account_id)
        .map_err(|e| NoteDeckError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(e) => Err(NoteDeckError::Keychain(e.to_string())),
    }
}

#[cfg(feature = "keyring")]
pub fn delete_token(account_id: &str) -> Result<(), NoteDeckError> {
    let entry = keyring_core::Entry::new(SERVICE, account_id)
        .map_err(|e| NoteDeckError::Keychain(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring_core::Error::NoEntry) => Ok(()),
        Err(e) => Err(NoteDeckError::Keychain(e.to_string())),
    }
}

// Fallback: no-ops (token stays in SQLite)
#[cfg(not(feature = "keyring"))]
pub fn init_store() -> Result<(), NoteDeckError> {
    Ok(())
}

#[cfg(all(test, feature = "keyring", target_os = "linux"))]
mod tests {
    use super::*;

    /// is_persistent() が選択された store と整合すること。
    /// secret-service が使える環境では永続 (true)、keyutils 劣化時は
    /// 再起動非永続 (false) で DB フォールバックを消してはならない
    #[test]
    fn is_persistent_matches_selected_store() {
        assert!(
            !is_persistent(),
            "store 未設定時は安全側 (false) に倒すこと"
        );
        if init_store().is_ok() {
            let vendor = keyring_core::get_default_store()
                .expect("init_store 成功後は default store が存在する")
                .vendor();
            if vendor.to_lowercase().contains("keyutils") {
                assert!(!is_persistent(), "keyutils store は再起動非永続");
            } else {
                assert!(is_persistent(), "secret-service store は永続: {vendor}");
            }
        }
    }

    /// 実環境の keyring に対する roundtrip。実データを触るため手動実行専用。
    #[test]
    #[ignore = "実環境の keyring を触るため手動実行: cargo test -- --ignored"]
    fn roundtrip_against_real_store() {
        init_store().unwrap();
        let id = "test-notecli-roundtrip";
        store_token(id, "dummy-token").unwrap();
        assert_eq!(get_token(id).unwrap().as_deref(), Some("dummy-token"));
        delete_token(id).unwrap();
        assert_eq!(get_token(id).unwrap(), None);
    }
}

#[cfg(not(feature = "keyring"))]
pub fn is_persistent() -> bool {
    false
}

#[cfg(not(feature = "keyring"))]
pub fn store_token(_account_id: &str, _token: &str) -> Result<(), NoteDeckError> {
    Ok(())
}

#[cfg(not(feature = "keyring"))]
pub fn get_token(_account_id: &str) -> Result<Option<String>, NoteDeckError> {
    Ok(None)
}

#[cfg(not(feature = "keyring"))]
pub fn delete_token(_account_id: &str) -> Result<(), NoteDeckError> {
    Ok(())
}
