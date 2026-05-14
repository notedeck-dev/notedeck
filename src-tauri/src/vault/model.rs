use serde::{Deserialize, Serialize};

use super::error::{VaultError, VaultResult};

/// `connections.json` のスキーマバージョン。
pub const SCHEMA_VERSION: u32 = 1;

/// secret slot 名のデフォルト値。Phase B 以降 / フロントエンドで参照する。
#[allow(dead_code)]
pub const DEFAULT_SLOT: &str = "primary";

/// 認証方式。Rust 側で secret を注入する際の形を判別共用体で表現する。
///
/// v2 で `oauth2` variant を追加する余地を残すため `#[serde(tag = "kind")]`。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthType {
    /// `Authorization: Bearer <secret>`
    Bearer,
    /// `<name>: <secret>`
    Header { name: String },
    /// URL クエリパラメータ `?<param>=<secret>`
    Query { param: String },
    /// `Authorization: Basic base64(<username>:<secret>)`
    Basic { username: String },
}

/// 接続種別。v2 で `inbound` (webhook receiver) を追加する余地を残す。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    #[default]
    Outbound,
}

/// 接続メタデータの出自。v1 では常に `Vault` (= ユーザーが手動登録)。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, Default)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionOrigin {
    #[default]
    Vault,
    /// vault 以外 (Misskey アカウント / AI provider key / プラグイン管理 等)。
    /// 詳細は `external_source` フィールドで表現する。
    External,
}

/// 接続メタデータ。secret 本体は含まない (OS キーチェーンに別管理)。
///
/// `Debug` を derive してよい — secret を持たないため。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    /// ULID。
    pub id: String,
    /// 表示名。
    pub name: String,
    /// scheme + host + path のみ。query / userinfo / fragment は保存時に拒否。
    pub base_url: String,
    #[serde(default)]
    pub kind: ConnectionKind,
    pub auth_type: AuthType,
    /// 接続が到達してよいホスト。空なら baseUrl の host のみ (upsert 時に自動投入)。
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    /// `None` = 全アカウント共通、`Some(account_id)` = 特定アカウント専用。
    #[serde(default)]
    pub account_scope: Option<String>,
    #[serde(default)]
    pub origin: ConnectionOrigin,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_source: Option<String>,
    /// テンプレート由来の場合の id (`builtin:github@1` 形式)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    /// AI に開示するか。default false — 明示的に opt-in しないと AI からは見えない。
    #[serde(default)]
    pub ai_visible: bool,
    /// secret が設定済みの slot 名一覧。keychain 列挙 API がないため metadata 側が source of truth。
    #[serde(default)]
    pub slots: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_secret_updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// `connections.json` のトップレベル構造。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionsFile {
    pub schema_version: u32,
    #[serde(default)]
    pub connections: Vec<Connection>,
}

impl Default for ConnectionsFile {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            connections: Vec::new(),
        }
    }
}

/// slot 名を検証する: `^[a-z][a-z0-9_]{0,31}$`。
///
/// keychain account を `vault/v1/<conn_id>/<slot>` で構成するため、
/// `/` や `:` を含む slot 名による delimiter injection を防ぐ。
pub fn validate_slot(slot: &str) -> VaultResult<()> {
    let mut chars = slot.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_lowercase());
    let rest_ok = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if first_ok && rest_ok && slot.len() <= 32 {
        Ok(())
    } else {
        Err(VaultError::InvalidSlot)
    }
}

/// connection_id が ULID 形式 (Crockford Base32, 26 文字) か検証する。
pub fn validate_connection_id(id: &str) -> VaultResult<()> {
    if ulid::Ulid::from_string(id).is_ok() {
        Ok(())
    } else {
        Err(VaultError::InvalidConnectionId)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_slot_accepts_lowercase_alnum_underscore() {
        assert!(validate_slot("primary").is_ok());
        assert!(validate_slot("access_token").is_ok());
        assert!(validate_slot("a").is_ok());
    }

    #[test]
    fn validate_slot_rejects_delimiter_injection() {
        assert!(validate_slot("primary/fake").is_err());
        assert!(validate_slot("primary:fake").is_err());
        assert!(validate_slot("Primary").is_err());
        assert!(validate_slot("1primary").is_err());
        assert!(validate_slot("").is_err());
        assert!(validate_slot(&"x".repeat(33)).is_err());
    }

    #[test]
    fn validate_connection_id_checks_ulid_format() {
        let valid = ulid::Ulid::new().to_string();
        assert!(validate_connection_id(&valid).is_ok());
        assert!(validate_connection_id("not-a-ulid").is_err());
        assert!(validate_connection_id("").is_err());
    }
}
