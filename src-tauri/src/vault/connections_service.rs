//! 接続メタデータ + secret のドメイン手続き (#782 R4)。
//!
//! commands/vault.rs に反復していた「load → find(id) → mutate → save」を
//! [`update_connection`] に集約し、exposed ↔ trust 連動などの不変条件は
//! `Connection` 上の純関数 (`apply_*`) として直接テストする。
//! main ウィンドウ検証はコマンド層の責務のまま残す。

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use super::connections_store;
use super::fetch::{self, VaultFetchRequest};
use super::model::{validate_connection_id, validate_slot, PrincipalClass, TrustedPlugin};
use super::{
    AuthType, Connection, ConnectionKind, ConnectionOrigin, ConnectionProtocol, KeychainBackend,
    SecretBackend, VaultError, VaultResult,
};

/// redaction の誤マッチを防ぐための secret 最小長。
pub const MIN_SECRET_LEN: usize = 16;

pub(crate) fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn backend() -> KeychainBackend {
    KeychainBackend
}

/// baseUrl を検証する: https/http スキーム + host 必須、query/fragment/userinfo は禁止。
pub fn validate_base_url(raw: &str) -> VaultResult<()> {
    let url = url::Url::parse(raw).map_err(|e| VaultError::InvalidInput {
        message: format!("baseUrl parse error: {e}"),
    })?;
    if !matches!(url.scheme(), "https" | "http") {
        return Err(VaultError::InvalidInput {
            message: "baseUrl scheme must be https or http".to_string(),
        });
    }
    if url.host_str().is_none() {
        return Err(VaultError::InvalidInput {
            message: "baseUrl must have a host".to_string(),
        });
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(VaultError::InvalidInput {
            message: "baseUrl must not contain a query or fragment".to_string(),
        });
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(VaultError::InvalidInput {
            message: "baseUrl must not contain userinfo".to_string(),
        });
    }
    Ok(())
}

/// baseUrl から host を取り出す (allowedHosts の自動投入用)。
fn host_of(raw: &str) -> Option<String> {
    url::Url::parse(raw)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
}

/// 接続の作成 / 更新の入力。`id` が `None` なら新規作成。
#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionUpsert {
    pub id: Option<String>,
    pub name: String,
    pub base_url: String,
    pub auth_type: AuthType,
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    #[serde(default)]
    pub account_scope: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    /// テンプレート由来の場合の id (`builtin:openai@1` 形式)。
    #[serde(default)]
    pub template_id: Option<String>,
    /// LLM プロトコル。AI プロバイダー接続なら `Some(_)`。
    #[serde(default)]
    pub protocol: Option<ConnectionProtocol>,
    /// 出自。`ai-provider` 移行などで `External` を指定する。未指定なら `Vault`。
    #[serde(default)]
    pub origin: Option<ConnectionOrigin>,
    /// `origin = External` の詳細 (`ai-provider` 等)。
    #[serde(default)]
    pub external_source: Option<String>,
}

/// secret slot の設定状況。
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretSlotStatus {
    pub name: String,
    pub present: bool,
}

/// 接続の全 slot の設定状況。
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub slots: Vec<SecretSlotStatus>,
}

/// 接続の疎通テスト結果。
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultTestResult {
    /// HTTP ステータス (リクエストが届いた場合)。
    pub status: Option<u16>,
    /// 2xx / 3xx なら true。
    pub ok: bool,
    /// 失敗時の理由 (SSRF / timeout / DNS など)。secret は含まない。
    pub error: Option<String>,
}

/// 「load → find(id) → mutate → save」の共通形。mutate 後に updated_at を更新する。
pub fn update_connection<T>(
    app: &tauri::AppHandle,
    id: &str,
    f: impl FnOnce(&mut Connection) -> T,
) -> VaultResult<T> {
    validate_connection_id(id)?;
    let mut file = connections_store::load(app)?;
    let connection = file
        .connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or(VaultError::ConnectionNotFound)?;
    let out = f(connection);
    connection.updated_at = now_millis();
    connections_store::save(app, &file)?;
    Ok(out)
}

// --- Connection 上の純関数 (不変条件はここでテストする) ---

/// 開示先クラスの切替。開示を外したクラスは trust も意味を失うので同時に外す。
/// Plugin クラスは個体 trust (`trusted_plugins`) も全消しする (#712 §6.1)。
pub fn apply_exposed(connection: &mut Connection, class: PrincipalClass, exposed: bool) {
    if exposed {
        if !connection.exposed_to.contains(&class) {
            connection.exposed_to.push(class);
        }
    } else {
        connection.exposed_to.retain(|c| *c != class);
        connection.trusted_for.retain(|c| *c != class);
        if class == PrincipalClass::Plugin {
            connection.trusted_plugins.clear();
        }
    }
}

/// クラス単位の trust 切替 (#712 §6.2)。
pub fn apply_trusted(connection: &mut Connection, class: PrincipalClass, trusted: bool) {
    if trusted {
        if !connection.trusted_for.contains(&class) {
            connection.trusted_for.push(class);
        }
    } else {
        connection.trusted_for.retain(|c| *c != class);
    }
}

/// プラグイン個体単位の trust 切替。1 個体の同意が他へ波及しない。
/// `name` は帰属表示用スナップショット (再信頼で最新の名前に更新される)。
pub fn apply_trusted_plugin(
    connection: &mut Connection,
    plugin_id: String,
    name: Option<String>,
    trusted: bool,
) {
    connection.trusted_plugins.retain(|p| p.id != plugin_id);
    if trusted {
        connection.trusted_plugins.push(TrustedPlugin {
            id: plugin_id,
            name,
        });
    }
}

// --- 手続き ---

/// メタデータを upsert する。secret は触らない。
pub fn upsert_metadata(app: &tauri::AppHandle, input: ConnectionUpsert) -> VaultResult<Connection> {
    validate_base_url(&input.base_url)?;

    let mut file = connections_store::load(app)?;
    connections_store::check_schema_version(&file)?;

    // allowedHosts が空なら baseUrl の host を自動投入する。
    let allowed_hosts = if input.allowed_hosts.is_empty() {
        host_of(&input.base_url).into_iter().collect()
    } else {
        input.allowed_hosts
    };

    let now = now_millis();

    let connection = match &input.id {
        Some(id) => {
            validate_connection_id(id)?;
            let existing = file
                .connections
                .iter_mut()
                .find(|c| &c.id == id)
                .ok_or(VaultError::ConnectionNotFound)?;
            existing.name = input.name;
            existing.base_url = input.base_url;
            existing.auth_type = input.auth_type;
            existing.allowed_hosts = allowed_hosts;
            existing.account_scope = input.account_scope;
            existing.notes = input.notes;
            existing.template_id = input.template_id;
            existing.protocol = input.protocol;
            if let Some(origin) = input.origin {
                existing.origin = origin;
            }
            existing.external_source = input.external_source;
            existing.updated_at = now;
            existing.clone()
        }
        None => {
            let connection = Connection {
                id: ulid::Ulid::new().to_string(),
                name: input.name,
                base_url: input.base_url,
                kind: ConnectionKind::Outbound,
                auth_type: input.auth_type,
                allowed_hosts,
                account_scope: input.account_scope,
                origin: input.origin.unwrap_or(ConnectionOrigin::Vault),
                external_source: input.external_source,
                template_id: input.template_id,
                protocol: input.protocol,
                exposed_to: vec![],
                trusted_for: vec![],
                trusted_plugins: vec![],
                legacy_ai_visible: None,
                legacy_ai_trusted: None,
                slots: Vec::new(),
                last_used_at: None,
                last_secret_updated_at: None,
                display_name: None,
                icon: None,
                notes: input.notes,
                created_at: now.clone(),
                updated_at: now,
            };
            file.connections.push(connection.clone());
            connection
        }
    };

    connections_store::save(app, &file)?;
    Ok(connection)
}

/// slot をメタデータの `slots` 配列に登録し、更新後の接続を返す。
fn register_slot(app: &tauri::AppHandle, conn_id: &str, slot: &str) -> VaultResult<Connection> {
    update_connection(app, conn_id, |connection| {
        if !connection.slots.iter().any(|s| s == slot) {
            connection.slots.push(slot.to_string());
        }
        connection.last_secret_updated_at = Some(now_millis());
        connection.clone()
    })
}

/// メタデータと secret を 1 トランザクションで作成 / 更新する。
///
/// TOCTOU を避けるため、メタデータ保存 → keychain 書き込みを 1 手続きにまとめる。
/// keychain 書き込みに失敗したらメタデータは既に保存済みだが slot は未登録なので
/// 「secret 未設定の接続」として残るだけで整合性は保たれる。
pub fn upsert_with_secret(
    app: &tauri::AppHandle,
    input: ConnectionUpsert,
    slot: &str,
    secret: String,
) -> VaultResult<Connection> {
    validate_slot(slot)?;
    if secret.len() < MIN_SECRET_LEN {
        return Err(VaultError::SecretTooShort);
    }

    let connection = upsert_metadata(app, input)?;
    let conn_id = connection.id.clone();

    backend().store(&conn_id, slot, &SecretString::from(secret))?;
    register_slot(app, &conn_id, slot)
}

/// 既存接続の secret を設定 / 入れ替える。
pub fn set_secret(
    app: &tauri::AppHandle,
    id: &str,
    slot: &str,
    secret: String,
) -> VaultResult<Connection> {
    validate_connection_id(id)?;
    validate_slot(slot)?;
    if secret.len() < MIN_SECRET_LEN {
        return Err(VaultError::SecretTooShort);
    }

    // 接続が存在することを確認する。
    let file = connections_store::load(app)?;
    if !file.connections.iter().any(|c| c.id == id) {
        return Err(VaultError::ConnectionNotFound);
    }

    backend().store(id, slot, &SecretString::from(secret))?;
    register_slot(app, id, slot)
}

/// secret 設定状況を返す (値そのものは決して返さない)。
pub fn secret_status(app: &tauri::AppHandle, id: &str) -> VaultResult<SecretStatus> {
    validate_connection_id(id)?;
    let file = connections_store::load(app)?;
    let connection = file
        .connections
        .iter()
        .find(|c| c.id == id)
        .ok_or(VaultError::ConnectionNotFound)?;

    let backend = backend();
    let mut slots = Vec::new();
    for slot in &connection.slots {
        let present = backend.load(id, slot)?.is_some();
        slots.push(SecretSlotStatus {
            name: slot.clone(),
            present,
        });
    }
    Ok(SecretStatus { slots })
}

/// 特定 slot の secret を削除する。
pub fn delete_secret(app: &tauri::AppHandle, id: &str, slot: &str) -> VaultResult<()> {
    validate_connection_id(id)?;
    validate_slot(slot)?;

    backend().delete(id, slot)?;

    let mut file = connections_store::load(app)?;
    if let Some(connection) = file.connections.iter_mut().find(|c| c.id == id) {
        connection.slots.retain(|s| s != slot);
        connection.updated_at = now_millis();
        connections_store::save(app, &file)?;
    }
    Ok(())
}

/// 接続を削除する。全 slot の secret を keychain から消し、メタデータも削除する。
/// secret を先に消す (途中 crash でも orphan メタデータより orphan secret の方が安全)。
pub fn delete_connection(app: &tauri::AppHandle, id: &str) -> VaultResult<()> {
    validate_connection_id(id)?;

    let mut file = connections_store::load(app)?;
    let Some(pos) = file.connections.iter().position(|c| c.id == id) else {
        return Err(VaultError::ConnectionNotFound);
    };

    let backend = backend();
    let connection = &file.connections[pos];
    for slot in &connection.slots {
        backend.delete(id, slot)?;
    }

    file.connections.remove(pos);
    connections_store::save(app, &file)?;
    Ok(())
}

/// 接続の疎通テスト。baseUrl への GET (または指定パス) を 1 回実行する。
pub async fn test_connection(
    app: &tauri::AppHandle,
    id: &str,
    test_path: Option<String>,
) -> VaultResult<VaultTestResult> {
    validate_connection_id(id)?;

    let request = VaultFetchRequest {
        path: test_path.unwrap_or_else(|| "/".to_string()),
        method: Some("GET".to_string()),
        headers: None,
        body: None,
        timeout_ms: Some(10_000),
        slot: None,
    };

    match fetch::vault_fetch(app, id, request).await {
        Ok(resp) => Ok(VaultTestResult {
            status: Some(resp.status),
            ok: (200..400).contains(&resp.status),
            error: None,
        }),
        Err(e) => Ok(VaultTestResult {
            status: None,
            ok: false,
            error: Some(e.to_string()),
        }),
    }
}

/// AI プロバイダーの API キーを Vault 接続へ移行する (#564 後続)。
///
/// 旧来 `ai.<provider>` キーチェーンに保存していた AI API キーを、Vault の
/// 接続 (`origin = External`, `externalSource = "ai-provider"`) に移し替える。
/// 移行後、旧キーチェーンエントリーは削除する。該当エントリーが無い場合は
/// `None` (移行対象なし)。
pub fn migrate_ai_provider(
    app: &tauri::AppHandle,
    provider: &str,
    name: String,
    base_url: String,
    protocol: ConnectionProtocol,
) -> VaultResult<Option<Connection>> {
    let api_key =
        crate::commands::ai::read_ai_api_key(provider).map_err(|e| VaultError::InvalidInput {
            message: e.to_string(),
        })?;
    let Some(api_key) = api_key.filter(|k| !k.is_empty()) else {
        return Ok(None);
    };

    // AI チャットの認証は `ai_chat.rs` 側で protocol 別に注入するが、`vault_fetch`
    // 経由でも使えるよう authType も protocol に合わせて設定しておく。
    let auth_type = match protocol {
        ConnectionProtocol::Anthropic => AuthType::Header {
            name: "x-api-key".to_string(),
        },
        ConnectionProtocol::OpenaiCompat => AuthType::Bearer,
    };

    let connection = upsert_metadata(
        app,
        ConnectionUpsert {
            id: None,
            name,
            base_url,
            auth_type,
            allowed_hosts: Vec::new(),
            account_scope: None,
            notes: None,
            template_id: None,
            protocol: Some(protocol),
            origin: Some(ConnectionOrigin::External),
            external_source: Some("ai-provider".to_string()),
        },
    )?;

    let conn_id = connection.id.clone();
    backend().store(&conn_id, "primary", &SecretString::from(api_key))?;
    let connection = register_slot(app, &conn_id, "primary")?;

    // 旧キーチェーンエントリーを削除する。失敗しても移行自体は成功扱い。
    let _ = notecli::keychain::delete_token(&crate::commands::ai::ai_keychain_id(provider));

    Ok(Some(connection))
}

/// 接続の `last_used_at` を現在時刻で更新する (ベストエフォート、失敗は無視)。
pub fn touch_last_used(app: &tauri::AppHandle, id: &str) {
    let _ = update_connection(app, id, |connection| {
        connection.last_used_at = Some(now_millis());
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conn() -> Connection {
        Connection {
            id: "01TEST".into(),
            name: "test".into(),
            base_url: "https://api.example.com".into(),
            kind: ConnectionKind::Outbound,
            auth_type: AuthType::Bearer,
            allowed_hosts: vec![],
            account_scope: None,
            origin: ConnectionOrigin::Vault,
            external_source: None,
            template_id: None,
            protocol: None,
            exposed_to: vec![],
            trusted_for: vec![],
            trusted_plugins: vec![],
            legacy_ai_visible: None,
            legacy_ai_trusted: None,
            slots: vec![],
            last_used_at: None,
            last_secret_updated_at: None,
            display_name: None,
            icon: None,
            notes: None,
            created_at: "0".into(),
            updated_at: "0".into(),
        }
    }

    #[test]
    fn validate_base_url_rules() {
        assert!(validate_base_url("https://api.example.com/v1").is_ok());
        assert!(validate_base_url("http://localhost:8080").is_ok());
        assert!(validate_base_url("ftp://example.com").is_err());
        assert!(validate_base_url("https://example.com/?q=1").is_err());
        assert!(validate_base_url("https://example.com/#frag").is_err());
        assert!(validate_base_url("https://user:pass@example.com/").is_err());
        assert!(validate_base_url("not a url").is_err());
    }

    #[test]
    fn unexpose_revokes_class_trust() {
        let mut c = conn();
        apply_exposed(&mut c, PrincipalClass::Ai, true);
        apply_trusted(&mut c, PrincipalClass::Ai, true);
        assert!(c.exposed_to.contains(&PrincipalClass::Ai));
        assert!(c.trusted_for.contains(&PrincipalClass::Ai));

        // 開示を外すと trust も同時に剥がれる (#712 §6.1 の不変条件)
        apply_exposed(&mut c, PrincipalClass::Ai, false);
        assert!(!c.exposed_to.contains(&PrincipalClass::Ai));
        assert!(!c.trusted_for.contains(&PrincipalClass::Ai));
    }

    #[test]
    fn unexpose_plugin_clears_individual_trusts() {
        let mut c = conn();
        apply_exposed(&mut c, PrincipalClass::Plugin, true);
        apply_trusted_plugin(&mut c, "plg-1".into(), Some("Widget".into()), true);
        apply_trusted_plugin(&mut c, "plg-2".into(), None, true);
        assert_eq!(c.trusted_plugins.len(), 2);

        apply_exposed(&mut c, PrincipalClass::Plugin, false);
        assert!(c.trusted_plugins.is_empty());
    }

    #[test]
    fn expose_and_trust_are_idempotent() {
        let mut c = conn();
        apply_exposed(&mut c, PrincipalClass::Ai, true);
        apply_exposed(&mut c, PrincipalClass::Ai, true);
        assert_eq!(c.exposed_to.len(), 1);

        apply_trusted(&mut c, PrincipalClass::Ai, true);
        apply_trusted(&mut c, PrincipalClass::Ai, true);
        assert_eq!(c.trusted_for.len(), 1);
    }

    #[test]
    fn retrust_plugin_updates_name_snapshot() {
        let mut c = conn();
        apply_trusted_plugin(&mut c, "plg-1".into(), Some("旧名".into()), true);
        apply_trusted_plugin(&mut c, "plg-1".into(), Some("新名".into()), true);
        assert_eq!(c.trusted_plugins.len(), 1);
        assert_eq!(c.trusted_plugins[0].name.as_deref(), Some("新名"));

        apply_trusted_plugin(&mut c, "plg-1".into(), None, false);
        assert!(c.trusted_plugins.is_empty());
    }
}
