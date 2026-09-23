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

/// LLM プロバイダーのプロトコル。AI チャット (#564 後続) で使う。
///
/// `Some(_)` の接続は「AI プロバイダーとして使える接続」として AI 設定の
/// ピッカーに出る。`ai_chat` の SSE パース分岐にも使う。
/// 通常の vault 接続 (GitHub 等) は `None`。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectionProtocol {
    /// Anthropic Messages API (SSE: `content_block_delta`)。認証は `x-api-key`。
    Anthropic,
    /// OpenAI Chat Completions 互換 (SSE: `data: {...}` + `[DONE]`)。
    /// 認証は `Authorization: Bearer`。OpenAI / OpenRouter / 自前ゲートウェイ等。
    OpenaiCompat,
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

/// 接続を開示する先の principal クラス (#712 §6.1)。
/// principal そのものより粗いクラス — 接続ごとに全 principal 分のトグルを
/// 並べるのは Apple 式に反する。「AI に見せる」「プラグインに見せる」
/// 「外部アプリに見せる」の 3 つの同意が、ユーザーのメンタルモデルの実際の粒度。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrincipalClass {
    /// ai.chat + ai.heartbeat
    Ai,
    /// AiScript プラグイン / ウィジェット (#759 — per-connection opt-in、default 非開示)
    Plugin,
    /// HTTP API 経由の外部アプリ (全永続トークン)
    External,
}

/// 「確認なしで使う」のプラグイン個体単位の記憶。
///
/// 開示 (`exposed_to`) はクラス単位だが、plugin クラスは多数の第三者コード個体が
/// 同居するため、trust だけはクラス一括 (`trusted_for`) にせず個体単位で持つ —
/// 1 つのウィジェットへの同意が全プラグイン / Play / Page に波及しない。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrustedPlugin {
    /// principal の pluginId (`widget:<installId>` / `play:<id>` / `page:<id>` /
    /// プラグインは installId 素)。
    pub id: String,
    /// 帰属表示用の配布名スナップショット (記憶時点の名前)。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
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
    /// LLM プロトコル。`Some(_)` なら AI プロバイダーとして使える接続。
    /// 通常の vault 接続は `None`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<ConnectionProtocol>,
    /// 開示先クラス (#712 §6.1)。空 = どこにも開示しない (default)。
    /// External は誰も自動付与しない — 外部アプリへの開示は必ず明示 opt-in。
    #[serde(default)]
    pub exposed_to: Vec<PrincipalClass>,
    /// 確認ダイアログなしで vault.fetch を許可するクラス (Ai / External のみ —
    /// Plugin の trust は個体単位の `trusted_plugins` で持つ)。
    /// `exposed_to` に含まれるクラスにのみ意味を持つ。
    #[serde(default)]
    pub trusted_for: Vec<PrincipalClass>,
    /// 確認ダイアログなしで vault.fetch を許可するプラグイン個体。
    /// `exposed_to` に Plugin が含まれるときのみ意味を持つ。
    #[serde(default)]
    pub trusted_plugins: Vec<TrustedPlugin>,
    /// 旧 `aiVisible` (移行読込専用 #712)。load 時に `exposed_to: [Ai]` へ
    /// 変換され、次回保存で消える (serialize しない)。
    #[serde(default, rename = "aiVisible", skip_serializing)]
    #[specta(skip)]
    pub legacy_ai_visible: Option<bool>,
    /// 旧 `aiTrusted` (移行読込専用 #712)。
    #[serde(default, rename = "aiTrusted", skip_serializing)]
    #[specta(skip)]
    pub legacy_ai_trusted: Option<bool>,
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

    #[test]
    fn legacy_ai_fields_are_readable_and_new_fields_default_empty() {
        // 既存 connections.json は aiVisible / aiTrusted を持つ。移行読込専用
        // フィールドとして読め、exposed_to / trusted_for は空で初期化される
        // (実変換は connections_store::load が行う)。
        let legacy = r#"{
            "id": "01HZZZZZZZZZZZZZZZZZZZZZZZ",
            "name": "Legacy",
            "baseUrl": "https://example.com",
            "authType": { "kind": "bearer" },
            "aiVisible": true,
            "createdAt": "0",
            "updatedAt": "0"
        }"#;
        let conn: Connection = serde_json::from_str(legacy).unwrap();
        assert_eq!(conn.legacy_ai_visible, Some(true));
        assert_eq!(conn.legacy_ai_trusted, None);
        assert!(conn.exposed_to.is_empty());
        assert!(conn.trusted_for.is_empty());
    }

    #[test]
    fn exposed_to_round_trips_and_legacy_fields_are_not_serialized() {
        let conn = Connection {
            id: "01HZZZZZZZZZZZZZZZZZZZZZZZ".to_string(),
            name: "Trusted".to_string(),
            base_url: "https://example.com".to_string(),
            kind: ConnectionKind::default(),
            auth_type: AuthType::Bearer,
            allowed_hosts: vec![],
            account_scope: None,
            origin: ConnectionOrigin::default(),
            external_source: None,
            template_id: None,
            protocol: None,
            exposed_to: vec![PrincipalClass::Ai],
            trusted_for: vec![PrincipalClass::Ai],
            trusted_plugins: vec![TrustedPlugin {
                id: "widget:01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
                name: Some("Todoist".to_string()),
            }],
            legacy_ai_visible: Some(true),
            legacy_ai_trusted: Some(true),
            slots: vec![],
            last_used_at: None,
            last_secret_updated_at: None,
            display_name: None,
            icon: None,
            notes: None,
            created_at: "0".to_string(),
            updated_at: "0".to_string(),
        };
        let json = serde_json::to_string(&conn).unwrap();
        assert!(json.contains("\"exposedTo\":[\"ai\"]"));
        assert!(json.contains("\"trustedFor\":[\"ai\"]"));
        assert!(json.contains("\"trustedPlugins\""));
        assert!(json.contains("\"name\":\"Todoist\""));
        // 旧フィールドは serialize されない (= 次回保存で消える)
        assert!(!json.contains("aiVisible"));
        assert!(!json.contains("aiTrusted"));
        let back: Connection = serde_json::from_str(&json).unwrap();
        assert_eq!(back.exposed_to, vec![PrincipalClass::Ai]);
        assert_eq!(back.trusted_plugins, conn.trusted_plugins);
        assert_eq!(back.legacy_ai_visible, None);
    }
}
