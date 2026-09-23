use thiserror::Error;

/// 認証エラーの内訳。呼び出し側がパターンマッチで回復手段を選べるよう、
/// 「再ログインが要る」「認証フローをやり直す」「ユーザーの承認待ち」を区別する。
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum AuthErrorKind {
    /// keychain にも DB にもトークンが無い。再ログインが必要。
    #[error("No token found for account {0}")]
    NoToken(String),

    /// MiAuth の check がサーバーに拒否された（HTTP ステータス）。認証フローをやり直す。
    #[error("MiAuth check failed: {0}")]
    MiAuthFailed(u16),

    /// ユーザーがまだ Misskey 側で許可していない。同じ URL で再試行できる。
    #[error("MiAuth authentication was not completed")]
    MiAuthPending,

    /// MiAuth 応答に必要なフィールドが無い。認証フローをやり直す。
    #[error("MiAuth response missing {0}")]
    MiAuthMalformed(&'static str),

    /// アプリ側で持つ認証セッションが無効（期限切れ・host 不一致・消費済み）。
    #[error("{0}")]
    SessionInvalid(String),

    /// 外部サービス（AI プロバイダー等）の資格情報が未設定。設定画面へ誘導する。
    #[error("{0}")]
    CredentialMissing(String),
}

#[derive(Debug, Error)]
pub enum NoteDeckError {
    #[error("Database error")]
    Database(#[from] rusqlite::Error),

    #[error("Network error")]
    Network(#[from] reqwest::Error),

    #[error("JSON parse error")]
    Json(#[from] serde_json::Error),

    #[error("Account not found: {0}")]
    AccountNotFound(String),

    #[error("{message}")]
    Api {
        endpoint: String,
        status: u16,
        /// Misskey が返した `error.code`（例: `AUTHENTICATION_FAILED`）。
        /// メッセージ文字列を parse せずに済むよう構造化して保持する。
        api_code: Option<String>,
        message: String,
    },

    #[error("{0}")]
    Auth(AuthErrorKind),

    #[error("No connection for account: {0}")]
    NoConnection(String),

    #[error("Connection closed")]
    ConnectionClosed,

    #[error("Invalid input: {0}")]
    InvalidInput(String),

    #[error("Keychain error: {0}")]
    Keychain(String),

    /// 起こり得ないはずの内部不整合（ロック汚染、保存直後の読み出し失敗等）。
    #[error("Internal error: {0}")]
    Internal(String),
}

impl NoteDeckError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Database(_) => "DATABASE",
            Self::Network(_) => "NETWORK",
            Self::Json(_) => "JSON",
            Self::AccountNotFound(_) => "ACCOUNT_NOT_FOUND",
            Self::Api { .. } => "API",
            Self::Auth(kind) => kind.code(),
            Self::NoConnection(_) => "NO_CONNECTION",
            Self::ConnectionClosed => "CONNECTION_CLOSED",
            Self::InvalidInput(_) => "INVALID_INPUT",
            Self::Keychain(_) => "KEYCHAIN",
            Self::Internal(_) => "INTERNAL",
        }
    }

    /// Misskey が返した `error.code`。API エラー以外では None。
    pub fn api_code(&self) -> Option<&str> {
        match self {
            Self::Api { api_code, .. } => api_code.as_deref(),
            _ => None,
        }
    }
}

impl AuthErrorKind {
    pub fn code(&self) -> &'static str {
        match self {
            Self::NoToken(_) => "AUTH_NO_TOKEN",
            Self::MiAuthFailed(_) => "AUTH_MIAUTH_FAILED",
            Self::MiAuthPending => "AUTH_MIAUTH_PENDING",
            Self::MiAuthMalformed(_) => "AUTH_MIAUTH_MALFORMED",
            Self::SessionInvalid(_) => "AUTH_SESSION_INVALID",
            Self::CredentialMissing(_) => "AUTH_CREDENTIAL_MISSING",
        }
    }
}

impl NoteDeckError {
    /// Returns a sanitized message safe for the frontend.
    /// Internal details (DB queries, network traces, keychain internals) are
    /// logged to stderr and replaced with generic messages.
    pub fn safe_message(&self) -> String {
        match self {
            Self::Database(e) => {
                tracing::error!(error = %e, "Database error");
                "Database operation failed".to_string()
            }
            Self::Network(e) => {
                tracing::error!(error = %e, "Network error");
                "Network request failed".to_string()
            }
            Self::Json(e) => {
                tracing::error!(error = %e, "JSON parse error");
                "Invalid response format".to_string()
            }
            Self::Keychain(e) => {
                tracing::error!(error = %e, "Keychain error");
                "Credential storage error".to_string()
            }
            Self::Internal(e) => {
                tracing::error!(error = %e, "Internal error");
                "Internal error".to_string()
            }
            // These contain messages we control — safe to expose
            Self::Api { message, .. } => message.clone(),
            Self::Auth(kind) => kind.to_string(),
            Self::AccountNotFound(id) => format!("Account not found: {id}"),
            Self::NoConnection(id) => format!("No connection for account: {id}"),
            Self::ConnectionClosed => "Connection closed".to_string(),
            Self::InvalidInput(msg) => format!("Invalid input: {msg}"),
        }
    }
}

/// Shape of NoteDeckError as seen by TypeScript (matches manual Serialize impl).
#[cfg(feature = "specta")]
#[derive(specta::Type)]
#[allow(dead_code)]
#[specta(rename_all = "camelCase")]
struct NoteDeckErrorShape {
    code: String,
    message: String,
    api_code: Option<String>,
}

#[cfg(feature = "specta")]
impl specta::Type for NoteDeckError {
    fn inline(
        type_map: &mut specta::TypeCollection,
        generics: specta::Generics,
    ) -> specta::datatype::DataType {
        NoteDeckErrorShape::inline(type_map, generics)
    }
}

impl serde::Serialize for NoteDeckError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("NoteDeckError", 3)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.safe_message())?;
        s.serialize_field("apiCode", &self.api_code())?;
        s.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_code_mapping() {
        assert_eq!(
            NoteDeckError::AccountNotFound("x".into()).code(),
            "ACCOUNT_NOT_FOUND"
        );
        assert_eq!(
            NoteDeckError::Api {
                endpoint: "test".into(),
                status: 400,
                api_code: None,
                message: "bad".into()
            }
            .code(),
            "API"
        );
        assert_eq!(
            NoteDeckError::Auth(AuthErrorKind::NoToken("acc1".into())).code(),
            "AUTH_NO_TOKEN"
        );
        assert_eq!(
            NoteDeckError::NoConnection("x".into()).code(),
            "NO_CONNECTION"
        );
        assert_eq!(NoteDeckError::ConnectionClosed.code(), "CONNECTION_CLOSED");
        assert_eq!(
            NoteDeckError::InvalidInput("x".into()).code(),
            "INVALID_INPUT"
        );
        assert_eq!(NoteDeckError::Keychain("x".into()).code(), "KEYCHAIN");
        assert_eq!(NoteDeckError::Internal("x".into()).code(), "INTERNAL");
    }

    #[test]
    fn auth_kinds_have_distinct_codes() {
        let codes = [
            NoteDeckError::Auth(AuthErrorKind::NoToken("acc1".into())).code(),
            NoteDeckError::Auth(AuthErrorKind::MiAuthFailed(500)).code(),
            NoteDeckError::Auth(AuthErrorKind::MiAuthPending).code(),
            NoteDeckError::Auth(AuthErrorKind::MiAuthMalformed("token")).code(),
            NoteDeckError::Auth(AuthErrorKind::SessionInvalid("expired".into())).code(),
            NoteDeckError::Auth(AuthErrorKind::CredentialMissing("Claude".into())).code(),
        ];
        let unique: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(unique.len(), codes.len(), "auth codes must be distinct");
        // すべて AUTH_ 接頭辞 — フロントは接頭辞で「認証エラー全般」を判定する
        assert!(codes.iter().all(|c| c.starts_with("AUTH_")));
    }

    #[test]
    fn api_code_is_exposed_for_programmatic_recovery() {
        let err = NoteDeckError::Api {
            endpoint: "notes/timeline".into(),
            status: 401,
            api_code: Some("AUTHENTICATION_FAILED".into()),
            message: "notes/timeline: AUTHENTICATION_FAILED: token is invalid".into(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "API");
        assert_eq!(json["apiCode"], "AUTHENTICATION_FAILED");
    }

    #[test]
    fn api_code_is_null_when_server_gave_none() {
        let err = NoteDeckError::Api {
            endpoint: "notes/timeline".into(),
            status: 500,
            api_code: None,
            message: "notes/timeline (500)".into(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert!(json["apiCode"].is_null());
    }

    #[test]
    fn internal_message_does_not_leak_details() {
        let err = NoteDeckError::Internal("session lock poisoned at src/foo.rs:42".into());
        assert_eq!(err.safe_message(), "Internal error");
    }

    #[test]
    fn safe_message_sanitizes_internals() {
        // These variants should NOT leak internal details
        let db_err = NoteDeckError::Database(
            rusqlite::Connection::open_in_memory()
                .unwrap()
                .execute("INVALID SQL", [])
                .unwrap_err(),
        );
        assert_eq!(db_err.safe_message(), "Database operation failed");

        let kc_err = NoteDeckError::Keychain("keyring internal detail".into());
        assert_eq!(kc_err.safe_message(), "Credential storage error");
    }

    #[test]
    fn safe_message_passes_controlled_messages() {
        let api_err = NoteDeckError::Api {
            endpoint: "/api/test".into(),
            status: 404,
            api_code: None,
            message: "Note not found".into(),
        };
        assert_eq!(api_err.safe_message(), "Note not found");

        let auth_err = NoteDeckError::Auth(AuthErrorKind::NoToken("acc1".into()));
        assert_eq!(auth_err.safe_message(), "No token found for account acc1");

        let not_found = NoteDeckError::AccountNotFound("acc123".into());
        assert_eq!(not_found.safe_message(), "Account not found: acc123");

        let no_conn = NoteDeckError::NoConnection("acc456".into());
        assert_eq!(no_conn.safe_message(), "No connection for account: acc456");

        assert_eq!(
            NoteDeckError::ConnectionClosed.safe_message(),
            "Connection closed"
        );

        let invalid = NoteDeckError::InvalidInput("empty text".into());
        assert_eq!(invalid.safe_message(), "Invalid input: empty text");
    }

    #[test]
    fn serialize_to_json() {
        let err = NoteDeckError::Api {
            endpoint: "/api/notes/show".into(),
            status: 404,
            api_code: Some("NO_SUCH_NOTE".into()),
            message: "Note not found".into(),
        };
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "API");
        assert_eq!(json["message"], "Note not found");
        // endpoint and status should NOT appear in serialized output
        assert!(json.get("endpoint").is_none());
        assert!(json.get("status").is_none());
    }

    #[test]
    fn display_trait() {
        let err = NoteDeckError::AccountNotFound("acc1".into());
        assert_eq!(format!("{err}"), "Account not found: acc1");

        let err = NoteDeckError::ConnectionClosed;
        assert_eq!(format!("{err}"), "Connection closed");

        let err = NoteDeckError::Api {
            endpoint: "test".into(),
            status: 500,
            api_code: None,
            message: "Internal error".into(),
        };
        assert_eq!(format!("{err}"), "Internal error");

        let err = NoteDeckError::Auth(AuthErrorKind::MiAuthFailed(503));
        assert_eq!(format!("{err}"), "MiAuth check failed: 503");
    }
}
