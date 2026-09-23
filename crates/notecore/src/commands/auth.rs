//! auth のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

//! MiAuth 認証: セッション追跡 (リプレイ防止) と `auth_start`。完了 (資格情報の保存) は
//! 認可境界なので src-tauri 側に残る。

use notecli::models::AuthSession;

use crate::commands::validate_host;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use notecli::error::{AuthErrorKind, NoteDeckError};

use crate::auth_service;
use crate::context::Core;
use crate::error::Result;

pub async fn auth_start(
    core: &Core,
    host: String,
    permissions: Option<Vec<String>>,
) -> Result<AuthSession> {
    let host = validate_host(&host)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let perms = permissions.unwrap_or_else(|| {
        auth_service::DEFAULT_MIAUTH_PERMISSIONS
            .iter()
            .map(|s| s.to_string())
            .collect()
    });
    auth_service::validate_permissions(&perms)?;
    let url = auth_service::build_miauth_url(&host, &session_id, &perms);
    core.auth_sessions().register(&session_id, &host);
    Ok(AuthSession {
        session_id,
        url,
        host,
    })
}

/// Tracks MiAuth sessions to prevent replay attacks.
/// Sessions expire after 15 minutes and are consumed on completion.
#[derive(Default)]
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

    pub fn register(&self, session_id: &str, host: &str) {
        let Ok(mut sessions) = self.sessions.lock() else {
            tracing::error!("AuthSessionTracker mutex poisoned in register");
            return;
        };
        // Purge expired entries while we have the lock
        sessions.retain(|_, (_, created)| created.elapsed().as_secs() < AUTH_SESSION_TTL_SECS);
        sessions.insert(session_id.to_string(), (host.to_string(), Instant::now()));
    }

    pub fn consume(&self, session_id: &str, host: &str) -> std::result::Result<(), NoteDeckError> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
