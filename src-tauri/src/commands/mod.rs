mod admin;
mod ai_chat;
mod api_tokens;
mod auth;
mod backup;
mod enrichment;
mod export;
mod health;
mod heartbeat;
mod http;
mod pet;
mod query;
mod settings;
pub(crate) use settings::SETTINGS_DIR;
mod streaming;
mod system_state;
mod table;
mod timeline;
mod utility;
mod vault;

// Re-export all commands so lib.rs `commands::xxx` paths remain unchanged
pub use admin::*;
pub use ai_chat::*;
pub use api_tokens::*;
pub use auth::*;
pub use backup::*;
pub use enrichment::*;
pub use export::*;
pub use health::*;
pub use heartbeat::*;
pub use http::*;
pub use pet::*;
pub use query::*;
pub use settings::*;
pub use streaming::*;
pub use system_state::*;
pub use table::*;
pub use timeline::*;
pub use utility::*;
pub use vault::*;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use notecli::db::Database;
use notecli::error::{AuthErrorKind, NoteDeckError};

pub(crate) use crate::error::Result;

pub use notecore::commands::{export_account_list, validate_host};
/// notecore の実行文脈。旧 `AppState` (二段階初期化) はそのまま notecore へ移った。
pub use notecore::context::Core as AppState;

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

/// タイムライン取得時の OGP 先読み結果を WebView へ `nd:ogp-hints` で流す。
pub struct TauriHintSink(pub tauri::AppHandle);

impl notecore::context::HintSink for TauriHintSink {
    fn ogp_hints(&self, hints: std::collections::HashMap<String, notecore::ogp::OgpData>) {
        use tauri::Emitter;
        let _ = self.0.emit("nd:ogp-hints", &hints);
    }
}

pub use notecore::credentials::{cleanup_expired_credentials, get_credentials};

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

#[cfg(test)]
mod tests {
    use super::*;

    // --- extract_ogp_urls ---

    // --- validate_host ---

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
