//! アカウント資格情報の解決 (メモリキャッシュ → keychain → DB の順、lazy migration つき)。
//! commands/mod.rs から移動 (#1106 段階 0b)。account_service / migrations もここに依存する。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use zeroize::Zeroize;

use notecli::db::Database;
use notecli::error::{AuthErrorKind, NoteDeckError};
use notecli::keychain;

use crate::error::Result;

const CREDENTIAL_CACHE_TTL: Duration = Duration::from_secs(60);

struct CachedCredential {
    host: String,
    token: String,
    cached_at: Instant,
}

impl Drop for CachedCredential {
    fn drop(&mut self) {
        self.token.zeroize();
    }
}

#[derive(Default)]
pub struct CredentialCache {
    cache: Mutex<HashMap<String, CachedCredential>>,
}

impl CredentialCache {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, account_id: &str) -> Option<(String, String)> {
        let mut cache = self.cache.lock().ok()?;
        if let Some(entry) = cache.get(account_id) {
            if entry.cached_at.elapsed() < CREDENTIAL_CACHE_TTL {
                return Some((entry.host.clone(), entry.token.clone()));
            }
            // Expired: remove immediately (triggers Drop → zeroize)
            cache.remove(account_id);
        }
        None
    }

    fn insert(&self, account_id: &str, host: &str, token: &str) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(
                account_id.to_string(),
                CachedCredential {
                    host: host.to_string(),
                    token: token.to_string(),
                    cached_at: Instant::now(),
                },
            );
        }
    }

    pub fn invalidate(&self, account_id: &str) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.remove(account_id); // Drop → zeroize
        }
    }

    /// Remove all expired entries (triggers Drop → zeroize on each).
    pub fn cleanup_expired(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.retain(|_, entry| entry.cached_at.elapsed() < CREDENTIAL_CACHE_TTL);
        }
    }
}

static CREDENTIAL_CACHE: LazyLock<CredentialCache> = LazyLock::new(CredentialCache::new);

/// Look up account credentials: uses in-memory cache, then keychain, then DB (lazy migration)
pub fn get_credentials(db: &Database, account_id: &str) -> Result<(String, String)> {
    // Fast path: check in-memory cache first
    if let Some(cached) = CREDENTIAL_CACHE.get(account_id) {
        return Ok(cached);
    }

    let account = db
        .get_account(account_id)?
        .ok_or_else(|| NoteDeckError::AccountNotFound(account_id.to_string()))?;
    let host = account.host.clone();

    // Try keychain first (ignore errors — keychain may be unavailable)
    if let Some(token) = keychain::get_token(account_id).ok().flatten() {
        // Keychain has the token; clear DB copy if still present.
        // 再起動非永続な store (Linux keyutils) では DB フォールバックを消さない (#785)
        if !account.token.is_empty() && keychain::is_persistent() {
            let _ = db.clear_token(account_id);
        }
        CREDENTIAL_CACHE.insert(account_id, &host, &token);
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
        CREDENTIAL_CACHE.insert(account_id, &host, &token);
        return Ok((host, token));
    }

    Err(NoteDeckError::Auth(AuthErrorKind::NoToken(
        account_id.to_string(),
    )))
}

/// Invalidate cached credentials (call on logout/token change)
pub fn invalidate_credentials(account_id: &str) {
    CREDENTIAL_CACHE.invalidate(account_id);
}

/// Remove expired credential cache entries (call periodically)
pub fn cleanup_expired_credentials() {
    CREDENTIAL_CACHE.cleanup_expired();
}

/// Get host only from account_id (no token required).
fn get_host(db: &Database, account_id: &str) -> Result<String> {
    let account = db
        .get_account(account_id)?
        .ok_or_else(|| NoteDeckError::AccountNotFound(account_id.to_string()))?;
    Ok(account.host.clone())
}

/// Get credentials with anonymous fallback.
/// Returns (host, token) where token is empty if not authenticated.
/// Public Misskey endpoints work with empty token (skipped by notecli).
pub fn get_credentials_or_anon(db: &Database, account_id: &str) -> Result<(String, String)> {
    match get_credentials(db, account_id) {
        Ok(creds) => Ok(creds),
        Err(_) => Ok((get_host(db, account_id)?, String::new())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_cache_insert_and_get() {
        let cache = CredentialCache::new();
        cache.insert("acc-1", "misskey.io", "token-123");
        let (host, token) = cache.get("acc-1").unwrap();
        assert_eq!(host, "misskey.io");
        assert_eq!(token, "token-123");
    }

    #[test]
    fn credential_cache_miss() {
        let cache = CredentialCache::new();
        assert!(cache.get("nonexistent").is_none());
    }

    #[test]
    fn credential_cache_invalidate() {
        let cache = CredentialCache::new();
        cache.insert("acc-1", "misskey.io", "token");
        cache.invalidate("acc-1");
        assert!(cache.get("acc-1").is_none());
    }
}
