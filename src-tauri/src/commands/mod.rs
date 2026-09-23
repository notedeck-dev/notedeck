mod admin;
mod ai_chat;
mod api_tokens;
mod auth;
mod backup;
mod charts;
mod clips;
mod column_query;
mod content;
mod drafts;
mod enrichment;
mod export;
mod federation;
mod health;
mod heartbeat;
mod http;
mod lists;
mod messaging;
mod pet;
mod query;
mod settings;
pub(crate) use settings::SETTINGS_DIR;
mod streaming;
mod system_state;
mod table;
mod timeline;
mod user;
mod utility;
mod vault;

// Re-export all commands so lib.rs `commands::xxx` paths remain unchanged
pub use admin::*;
pub use ai_chat::*;
pub use api_tokens::*;
pub use auth::*;
pub use backup::*;
pub use charts::*;
pub use clips::*;
pub use column_query::*;
pub use content::*;
pub use drafts::*;
pub use enrichment::*;
pub use export::*;
pub use federation::*;
pub use health::*;
pub use heartbeat::*;
pub use http::*;
pub use lists::*;
pub use messaging::*;
pub use pet::*;
pub use query::*;
pub use settings::*;
pub use streaming::*;
pub use system_state::*;
pub use table::*;
pub use timeline::*;
pub use user::*;
pub use utility::*;
pub use vault::*;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use notecli::api::MisskeyClient;
use notecli::db::Database;
use notecli::error::{AuthErrorKind, NoteDeckError};

pub(crate) use crate::error::Result;

/// notecore の実行文脈。旧 `AppState` (二段階初期化) はそのまま notecore へ移った。
pub use notecore::context::Core as AppState;

/// タイムライン取得時の OGP 先読み結果を WebView へ `nd:ogp-hints` で流す。
pub struct TauriHintSink(pub tauri::AppHandle);

impl notecore::context::HintSink for TauriHintSink {
    fn ogp_hints(&self, hints: std::collections::HashMap<String, notecore::ogp::OgpData>) {
        use tauri::Emitter;
        let _ = self.0.emit("nd:ogp-hints", &hints);
    }
}

pub use notecore::credentials::{
    cleanup_expired_credentials, get_credentials, get_credentials_or_anon,
};

/// `client.request` + `serde_json::from_value::<T>` の型付き汎用ラッパ (#782 R2)。
/// charts / clips / drafts / lists / federation 等の「生 request → 型へ
/// デシリアライズ」定型を 1 行に畳む。
pub(crate) async fn typed_request<T: serde::de::DeserializeOwned>(
    client: &MisskeyClient,
    host: &str,
    token: &str,
    endpoint: &str,
    params: serde_json::Value,
) -> Result<T> {
    let raw = client.request(host, token, endpoint, params).await?;
    Ok(serde_json::from_value(raw)?)
}

/// Tracks MiAuth sessions to prevent replay attacks.
/// Sessions expire after 15 minutes and are consumed on completion.
pub struct AuthSessionTracker {
    sessions: Mutex<HashMap<String, (String, Instant)>>, // session_id -> (host, created_at)
}

const AUTH_SESSION_TTL_SECS: u64 = 900; // 15 minutes

impl AuthSessionTracker {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn register(&self, session_id: &str, host: &str) {
        let Ok(mut sessions) = self.sessions.lock() else {
            tracing::error!("AuthSessionTracker mutex poisoned in register");
            return;
        };
        // Purge expired entries while we have the lock
        sessions.retain(|_, (_, created)| created.elapsed().as_secs() < AUTH_SESSION_TTL_SECS);
        sessions.insert(session_id.to_string(), (host.to_string(), Instant::now()));
    }

    pub(crate) fn consume(
        &self,
        session_id: &str,
        host: &str,
    ) -> std::result::Result<(), NoteDeckError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| NoteDeckError::Internal("session lock poisoned".to_string()))?;
        match sessions.remove(session_id) {
            Some((stored_host, created)) => {
                if created.elapsed().as_secs() >= AUTH_SESSION_TTL_SECS {
                    return Err(NoteDeckError::Auth(AuthErrorKind::SessionInvalid(
                        "Auth session expired".to_string(),
                    )));
                }
                if stored_host != host {
                    return Err(NoteDeckError::Auth(AuthErrorKind::SessionInvalid(
                        "Host mismatch".to_string(),
                    )));
                }
                Ok(())
            }
            None => Err(NoteDeckError::Auth(AuthErrorKind::SessionInvalid(
                "Invalid or already consumed auth session".to_string(),
            ))),
        }
    }
}

/// Write account list (non-secret metadata only) to a JSON file for background workers.
/// The file contains host, account_id, and username — no tokens.
pub fn export_account_list(app: &tauri::AppHandle, db: &Database) {
    let Ok(app_dir) = crate::app_dir::resolve_app_dir(app) else {
        return;
    };
    let Ok(accounts) = db.load_accounts() else {
        return;
    };
    let list: Vec<serde_json::Value> = accounts
        .iter()
        .map(|a| {
            serde_json::json!({
                "id": a.id,
                "host": a.host,
                "username": a.username,
            })
        })
        .collect();
    let _ = std::fs::write(
        app_dir.join("poll_accounts.json"),
        serde_json::to_string(&list).unwrap_or_default(),
    );
}

/// Emit account list to frontend via Tauri event before AppState is initialized.
/// This lets the accounts store populate early, bypassing the AppState readiness gate.
/// Uses the same AccountPublic format as the load_accounts command.
pub fn emit_accounts_early(app: &tauri::AppHandle, db: &Database) {
    use tauri::Emitter;
    let Ok(accounts) = db.load_accounts() else {
        return;
    };
    let list: Vec<notecli::models::AccountPublic> = accounts
        .iter()
        .map(notecore::account_service::to_public)
        .collect();
    let _ = app.emit("nd:accounts-early", &list);
}

pub(crate) fn validate_host(host: &str) -> Result<String> {
    let normalized = host.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "Host cannot be empty".to_string(),
        ));
    }
    if normalized.len() > 253 {
        return Err(NoteDeckError::InvalidInput("Host too long".to_string()));
    }
    if normalized.contains(['/', '?', '#', '@', ' ', '\n', '\r']) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid host: {normalized}"
        )));
    }

    // E2E テスト用 (#702): デバッグビルド限定で、環境変数に明示列挙された
    // ホストだけ SSRF ガードをバイパスする (モック Misskey サーバーが
    // 127.0.0.1 で動くため)。リリースビルドでは常に無効。
    #[cfg(debug_assertions)]
    if let Ok(allowed) = std::env::var("NOTEDECK_E2E_ALLOW_HOSTS") {
        if allowed.split(',').any(|h| h.trim() == normalized) {
            return Ok(normalized);
        }
    }

    // SSRF prevention: block loopback, private, and link-local addresses
    let ssrf_blocked = [
        "localhost",
        "127.",
        "0.0.0.0",
        "[::1]",
        "::1",
        "10.",
        "192.168.",
        "169.254.",
        "[fc",      // IPv6 ULA (fc00::/7)
        "[fd",      // IPv6 ULA (fd00::/8)
        "[fe80:",   // IPv6 link-local
        "[::ffff:", // IPv4-mapped IPv6
    ];
    if ssrf_blocked.iter().any(|p| normalized.starts_with(p)) {
        return Err(NoteDeckError::InvalidInput(
            "Loopback and private addresses are not allowed".to_string(),
        ));
    }
    // 172.16.0.0/12
    if normalized.starts_with("172.") {
        if let Some(second) = normalized
            .strip_prefix("172.")
            .and_then(|s| s.split('.').next())
        {
            if let Ok(n) = second.parse::<u8>() {
                if (16..=31).contains(&n) {
                    return Err(NoteDeckError::InvalidInput(
                        "Loopback and private addresses are not allowed".to_string(),
                    ));
                }
            }
        }
    }
    // Block reserved TLDs
    if normalized.ends_with(".local")
        || normalized.ends_with(".internal")
        || normalized.ends_with(".localhost")
    {
        return Err(NoteDeckError::InvalidInput(
            "Reserved domain names are not allowed".to_string(),
        ));
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- extract_ogp_urls ---

    // --- validate_host ---

    #[test]
    fn valid_host() {
        assert_eq!(validate_host("Misskey.IO").unwrap(), "misskey.io");
    }

    #[test]
    fn valid_host_trims_whitespace() {
        assert_eq!(validate_host("  example.com  ").unwrap(), "example.com");
    }

    #[test]
    fn reject_empty_host() {
        assert!(validate_host("").is_err());
        assert!(validate_host("   ").is_err());
    }

    #[test]
    fn reject_host_with_path() {
        assert!(validate_host("example.com/path").is_err());
    }

    #[test]
    fn reject_localhost() {
        assert!(validate_host("localhost").is_err());
        assert!(validate_host("localhost:3000").is_err());
    }

    #[test]
    fn reject_loopback_ipv4() {
        assert!(validate_host("127.0.0.1").is_err());
        assert!(validate_host("127.0.0.1:8080").is_err());
    }

    #[test]
    fn e2e_allowlist_bypasses_ssrf_guard_for_exact_match_only() {
        // 他テストと衝突しない値を使う (env はプロセス全体で共有されるため)
        // SAFETY: テスト専用。並行テストは別の値を検証しており影響しない。
        unsafe { std::env::set_var("NOTEDECK_E2E_ALLOW_HOSTS", "127.0.0.1:39821") };
        assert_eq!(validate_host("127.0.0.1:39821").unwrap(), "127.0.0.1:39821");
        // 列挙外の loopback は引き続き拒否
        assert!(validate_host("127.0.0.1:39999").is_err());
        unsafe { std::env::remove_var("NOTEDECK_E2E_ALLOW_HOSTS") };
    }

    #[test]
    fn reject_private_ranges() {
        assert!(validate_host("10.0.0.1").is_err());
        assert!(validate_host("192.168.1.1").is_err());
        assert!(validate_host("172.16.0.1").is_err());
        assert!(validate_host("172.31.255.255").is_err());
    }

    #[test]
    fn allow_172_outside_private() {
        // 172.15.x.x and 172.32.x.x are public
        assert!(validate_host("172.15.0.1").is_ok());
        assert!(validate_host("172.32.0.1").is_ok());
    }

    #[test]
    fn reject_ipv6_loopback() {
        assert!(validate_host("[::1]").is_err());
        assert!(validate_host("::1").is_err());
    }

    #[test]
    fn reject_reserved_tlds() {
        assert!(validate_host("myserver.local").is_err());
        assert!(validate_host("app.internal").is_err());
        assert!(validate_host("test.localhost").is_err());
    }

    #[test]
    fn reject_long_host() {
        let long = "a".repeat(254);
        assert!(validate_host(&long).is_err());
    }

    // --- AuthSessionTracker ---

    #[test]
    fn auth_session_register_and_consume() {
        let tracker = AuthSessionTracker::new();
        tracker.register("sess-1", "misskey.io");
        assert!(tracker.consume("sess-1", "misskey.io").is_ok());
    }

    #[test]
    fn auth_session_double_consume_fails() {
        let tracker = AuthSessionTracker::new();
        tracker.register("sess-1", "misskey.io");
        tracker.consume("sess-1", "misskey.io").unwrap();
        assert!(tracker.consume("sess-1", "misskey.io").is_err());
    }

    #[test]
    fn auth_session_host_mismatch() {
        let tracker = AuthSessionTracker::new();
        tracker.register("sess-1", "misskey.io");
        let err = tracker.consume("sess-1", "evil.com").unwrap_err();
        assert!(err.to_string().contains("Host mismatch"));
    }

    #[test]
    fn auth_session_unknown_id() {
        let tracker = AuthSessionTracker::new();
        assert!(tracker.consume("nonexistent", "misskey.io").is_err());
    }
}
