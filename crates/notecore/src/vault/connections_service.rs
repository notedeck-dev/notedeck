//! 接続メタデータ + secret のドメイン手続き (#782 R4)。
//!
//! commands/vault.rs に反復していた「load → find(id) → mutate → save」を
//! [`update_connection`] に集約し、exposed ↔ trust 連動などの不変条件は
//! `Connection` 上の純関数 (`apply_*`) として直接テストする。
//! main ウィンドウ検証はコマンド層の責務のまま残す。

use secrecy::SecretString;
use serde::{Deserialize, Serialize};
use std::path::Path;
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

pub fn now_millis() -> String {
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
/// (Default / Serialize はコマンド表の見本パラメータのためで、既定値に意味は無い)
#[derive(Debug, Default, Serialize, Deserialize, specta::Type)]
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
    /// この端末の中で動くサービスへの接続 (#880)。true なら base_url は loopback の
    /// 3 表記でポート明示が必須、false なら loopback の URL は拒む (両向きに検査)
    #[serde(default)]
    pub local: bool,
}

/// secret slot の設定状況。
#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretSlotStatus {
    pub name: String,
    pub present: bool,
}

/// 接続の全 slot の設定状況。
#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub slots: Vec<SecretSlotStatus>,
}

/// 接続の疎通テスト結果。
#[derive(Debug, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultTestResult {
    /// HTTP ステータス (リクエストが届いた場合)。
    pub status: Option<u16>,
    /// 2xx / 3xx なら true。
    pub ok: bool,
    /// 失敗時の理由 (SSRF / timeout / DNS など)。secret は含まない。
    pub error: Option<String>,
    /// 実際に叩いた URL (baseUrl + testPath、#1319)。失敗の原因を追えるように返す。
    /// 接続が見つからないなど URL を組めなかったときは None
    #[serde(default)]
    pub url: Option<String>,
    /// 応答から読めたモデル名の候補 (OpenAI / Anthropic 互換の `/models` の `data[].id`、
    /// #880)。モデル一覧の形でない応答なら None
    #[serde(default)]
    pub models: Option<Vec<String>>,
}

/// 「load → find(id) → mutate → save」の共通形。mutate 後に updated_at を更新する。
pub fn update_connection<T>(
    app_dir: &Path,
    id: &str,
    f: impl FnOnce(&mut Connection) -> T,
) -> VaultResult<T> {
    validate_connection_id(id)?;
    let mut file = connections_store::load(app_dir)?;
    let connection = file
        .connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or(VaultError::ConnectionNotFound)?;
    let out = f(connection);
    connection.updated_at = now_millis();
    connections_store::save(app_dir, &file)?;
    Ok(out)
}

// --- Connection 上の純関数 (不変条件はここでテストする) ---

/// 開示先クラスの切替。開示を外したクラスは trust も意味を失うので同時に外す。
/// Plugin クラスは個体 trust (`trusted_plugins`) も全消しする (#712 §6.1)。
pub fn apply_exposed(
    connection: &mut Connection,
    class: PrincipalClass,
    exposed: bool,
) -> VaultResult<()> {
    if exposed && connection.local {
        return Err(local_not_exposable());
    }
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
    Ok(())
}

/// ローカル接続 (#880) は AI / プラグイン / 外部アプリに開示できない
fn local_not_exposable() -> VaultError {
    VaultError::InvalidInput {
        message:
            "a local connection (this device) cannot be exposed to AI, plugins or external apps"
                .to_string(),
    }
}

/// クラス単位の trust 切替 (#712 §6.2)。
pub fn apply_trusted(
    connection: &mut Connection,
    class: PrincipalClass,
    trusted: bool,
) -> VaultResult<()> {
    if trusted && connection.local {
        return Err(local_not_exposable());
    }
    if trusted {
        if !connection.trusted_for.contains(&class) {
            connection.trusted_for.push(class);
        }
    } else {
        connection.trusted_for.retain(|c| *c != class);
    }
    Ok(())
}

/// プラグイン個体単位の trust 切替。1 個体の同意が他へ波及しない。
/// `name` は帰属表示用スナップショット (再信頼で最新の名前に更新される)。
pub fn apply_trusted_plugin(
    connection: &mut Connection,
    plugin_id: String,
    name: Option<String>,
    trusted: bool,
) -> VaultResult<()> {
    if trusted && connection.local {
        return Err(local_not_exposable());
    }
    connection.trusted_plugins.retain(|p| p.id != plugin_id);
    if trusted {
        connection.trusted_plugins.push(TrustedPlugin {
            id: plugin_id,
            name,
        });
    }
    Ok(())
}

// --- 手続き ---

/// メタデータを upsert する。secret は触らない。
pub fn upsert_metadata(app_dir: &Path, input: ConnectionUpsert) -> VaultResult<Connection> {
    validate_base_url(&input.base_url)?;
    // loopback の URL ⇔ ローカル接続 を両向きに検査する (#880)。ローカルなら
    // `localhost` を 127.0.0.1 に正規化して保存し、実行時は IP literal だけになる
    let loopback = crate::ssrf::normalize_loopback_url(&input.base_url)
        .map_err(|message| VaultError::InvalidInput { message })?;
    let base_url = match (input.local, loopback) {
        (true, Some(normalized)) => normalized,
        (true, None) => {
            return Err(VaultError::InvalidInput {
                message: "a local connection must point at this device \
                          (localhost / 127.0.0.1 / [::1] with an explicit port)"
                    .to_string(),
            })
        }
        (false, Some(_)) => {
            return Err(VaultError::InvalidInput {
                message: "a loopback URL must be saved as a local connection".to_string(),
            })
        }
        (false, None) => input.base_url,
    };

    let mut file = connections_store::load(app_dir)?;
    connections_store::check_schema_version(&file)?;

    // allowedHosts が空なら baseUrl の host を自動投入する。ローカル接続の宛先は
    // base_url の host:port そのものなので、許可ホスト欄は使わず host だけを持つ
    let allowed_hosts = if input.local || input.allowed_hosts.is_empty() {
        host_of(&base_url).into_iter().collect()
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
            existing.base_url = base_url;
            existing.local = input.local;
            if input.local {
                // ローカル接続は誰にも開示しない (vault.fetch は入口で拒むが、表示も揃える)
                existing.exposed_to.clear();
                existing.trusted_for.clear();
                existing.trusted_plugins.clear();
            }
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
                base_url,
                kind: ConnectionKind::Outbound,
                auth_type: input.auth_type,
                allowed_hosts,
                account_scope: input.account_scope,
                origin: input.origin.unwrap_or(ConnectionOrigin::Vault),
                external_source: input.external_source,
                template_id: input.template_id,
                protocol: input.protocol,
                local: input.local,
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

    connections_store::save(app_dir, &file)?;
    Ok(connection)
}

/// slot をメタデータの `slots` 配列に登録し、更新後の接続を返す。
fn register_slot(app_dir: &Path, conn_id: &str, slot: &str) -> VaultResult<Connection> {
    update_connection(app_dir, conn_id, |connection| {
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
    app_dir: &Path,
    input: ConnectionUpsert,
    slot: &str,
    secret: String,
) -> VaultResult<Connection> {
    validate_slot(slot)?;
    if secret.len() < MIN_SECRET_LEN {
        return Err(VaultError::SecretTooShort);
    }

    let connection = upsert_metadata(app_dir, input)?;
    let conn_id = connection.id.clone();

    backend().store(&conn_id, slot, &SecretString::from(secret))?;
    register_slot(app_dir, &conn_id, slot)
}

/// 既存接続の secret を設定 / 入れ替える。
pub fn set_secret(app_dir: &Path, id: &str, slot: &str, secret: String) -> VaultResult<Connection> {
    validate_connection_id(id)?;
    validate_slot(slot)?;
    if secret.len() < MIN_SECRET_LEN {
        return Err(VaultError::SecretTooShort);
    }

    // 接続が存在することを確認する。
    let file = connections_store::load(app_dir)?;
    if !file.connections.iter().any(|c| c.id == id) {
        return Err(VaultError::ConnectionNotFound);
    }

    backend().store(id, slot, &SecretString::from(secret))?;
    register_slot(app_dir, id, slot)
}

/// secret 設定状況を返す (値そのものは決して返さない)。
pub fn secret_status(app_dir: &Path, id: &str) -> VaultResult<SecretStatus> {
    validate_connection_id(id)?;
    let file = connections_store::load(app_dir)?;
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
pub fn delete_secret(app_dir: &Path, id: &str, slot: &str) -> VaultResult<()> {
    validate_connection_id(id)?;
    validate_slot(slot)?;

    backend().delete(id, slot)?;

    let mut file = connections_store::load(app_dir)?;
    if let Some(connection) = file.connections.iter_mut().find(|c| c.id == id) {
        connection.slots.retain(|s| s != slot);
        connection.updated_at = now_millis();
        connections_store::save(app_dir, &file)?;
    }
    Ok(())
}

/// 接続を削除する。全 slot の secret を keychain から消し、メタデータも削除する。
/// secret を先に消す (途中 crash でも orphan メタデータより orphan secret の方が安全)。
pub fn delete_connection(app_dir: &Path, id: &str) -> VaultResult<()> {
    validate_connection_id(id)?;

    let mut file = connections_store::load(app_dir)?;
    let Some(pos) = file.connections.iter().position(|c| c.id == id) else {
        return Err(VaultError::ConnectionNotFound);
    };

    let backend = backend();
    let connection = &file.connections[pos];
    for slot in &connection.slots {
        backend.delete(id, slot)?;
    }

    file.connections.remove(pos);
    connections_store::save(app_dir, &file)?;
    Ok(())
}

/// 接続の疎通テスト。baseUrl への GET (または指定パス) を 1 回実行する。
pub async fn test_connection(
    app_dir: &Path,
    id: &str,
    test_path: Option<String>,
) -> VaultResult<VaultTestResult> {
    validate_connection_id(id)?;
    let connection = connections_store::load(app_dir)?
        .connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or(VaultError::ConnectionNotFound)?;
    // この端末の中のサービス (#880) は vault_fetch を通さない専用の経路で疎通する
    if connection.local {
        return probe_local_connection(&connection).await;
    }

    let path = test_path.unwrap_or_else(|| "/".to_string());
    // 実際に叩く URL を結果に添える (#1319)。vault_fetch と同じ結合規則
    let url = fetch::resolve_url(&connection.base_url, &path)
        .ok()
        .map(|u| u.to_string());

    let request = VaultFetchRequest {
        path,
        method: Some("GET".to_string()),
        headers: None,
        body: None,
        timeout_ms: Some(10_000),
        slot: None,
    };

    match fetch::vault_fetch(app_dir, id, request).await {
        // 通信断は status 0 + error で返る (#1294)。疎通テストでは「届かなかった」
        // として status 無し + 理由にする
        Ok(resp) if resp.status == 0 => Ok(VaultTestResult {
            status: None,
            ok: false,
            error: resp.error,
            url,
            models: None,
        }),
        Ok(resp) => Ok(VaultTestResult {
            status: Some(resp.status),
            ok: (200..400).contains(&resp.status),
            error: None,
            url,
            // AI プロバイダーの疎通先は `/models` なので、応答がその形ならモデルの候補にする
            models: if (200..300).contains(&resp.status) {
                parse_model_ids(&resp.body)
            } else {
                None
            },
        }),
        Err(e) => Ok(VaultTestResult {
            status: None,
            ok: false,
            error: Some(e.to_string()),
            url,
            models: None,
        }),
    }
}

/// この端末の中のサービス (ローカル接続、#880) の疎通。`vault_fetch` (secret 必須 /
/// 外向きの SSRF 検査 / 任意パス) は通さず、protocol から決まるモデル一覧のパスだけを
/// secret 任意で GET する。redirect は追わない。宛先は保存時に正規化した loopback の
/// IP literal なので名前解決は起きない
async fn probe_local_connection(connection: &Connection) -> VaultResult<VaultTestResult> {
    let base = crate::ssrf::normalize_loopback_url(&connection.base_url)
        .map_err(|message| VaultError::InvalidInput { message })?
        .ok_or_else(|| VaultError::InvalidInput {
            message: "a local connection must point at this device".to_string(),
        })?;
    let url = format!(
        "{}{}",
        base.trim_end_matches('/'),
        models_path_for(connection.protocol)
    );
    let client = reqwest::Client::builder()
        .http1_only()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .pool_max_idle_per_host(0)
        .build()
        .map_err(|e| VaultError::RequestFailed {
            message: format!("failed to build client: {e}"),
        })?;
    let mut req = client.get(&url).header("user-agent", "NoteDeck");
    // secret があれば従来どおり注入する (Ollama は無視する。認証を有効にしたローカル
    // サーバーのため)。無ければ付けない = 認証なし
    if let Ok(Some(secret)) = KeychainBackend.load(&connection.id, "primary") {
        req = super::auth_inject::inject_auth(req, &connection.auth_type, &secret);
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(VaultTestResult {
                status: None,
                ok: false,
                error: Some(fetch::transport_error_message(e)),
                url: Some(url),
                models: None,
            })
        }
    };
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok(VaultTestResult {
        status: Some(status),
        ok: (200..400).contains(&status),
        error: None,
        url: Some(url),
        models: if (200..300).contains(&status) {
            parse_model_ids(&body)
        } else {
            None
        },
    })
}

/// protocol ごとのモデル一覧のパス (baseUrl の下)。OpenAI 互換の baseUrl は `/v1` を
/// 含むので `/models`、Anthropic 互換の baseUrl は含まないので `/v1/models`
pub fn models_path_for(protocol: Option<ConnectionProtocol>) -> &'static str {
    match protocol {
        Some(ConnectionProtocol::OpenaiCompat) => "/models",
        Some(ConnectionProtocol::Anthropic) => "/v1/models",
        None => "/",
    }
}

/// モデル一覧の応答 (`{ data: [{ id }] }`、OpenAI / Anthropic 互換で同じ形) から
/// モデル名を読む。その形でなければ None
pub fn parse_model_ids(body: &str) -> Option<Vec<String>> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let data = v.get("data")?.as_array()?;
    Some(
        data.iter()
            .filter_map(|m| m.get("id")?.as_str().map(str::to_string))
            .collect(),
    )
}

/// AI プロバイダーの API キーを Vault 接続へ移行する (#564 後続)。
///
/// 旧来 `ai.<provider>` キーチェーンに保存していた AI API キーを、Vault の
/// 接続 (`origin = External`, `externalSource = "ai-provider"`) に移し替える。
/// 移行後、旧キーチェーンエントリーは削除する。該当エントリーが無い場合は
/// `None` (移行対象なし)。
pub fn migrate_ai_provider(
    app_dir: &Path,
    provider: &str,
    name: String,
    base_url: String,
    protocol: ConnectionProtocol,
) -> VaultResult<Option<Connection>> {
    let api_key =
        crate::ai_keys::read_ai_api_key(provider).map_err(|e| VaultError::InvalidInput {
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
        app_dir,
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
            local: false,
        },
    )?;

    let conn_id = connection.id.clone();
    backend().store(&conn_id, "primary", &SecretString::from(api_key))?;
    let connection = register_slot(app_dir, &conn_id, "primary")?;

    // 旧キーチェーンエントリーを削除する。失敗しても移行自体は成功扱い。
    let _ = notecli::keychain::delete_token(&crate::ai_keys::ai_keychain_id(provider));

    Ok(Some(connection))
}

/// 接続の `last_used_at` を現在時刻で更新する (ベストエフォート、失敗は無視)。
pub fn touch_last_used(app_dir: &Path, id: &str) {
    let _ = update_connection(app_dir, id, |connection| {
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
            local: false,
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
        apply_exposed(&mut c, PrincipalClass::Ai, true).unwrap();
        apply_trusted(&mut c, PrincipalClass::Ai, true).unwrap();
        assert!(c.exposed_to.contains(&PrincipalClass::Ai));
        assert!(c.trusted_for.contains(&PrincipalClass::Ai));

        // 開示を外すと trust も同時に剥がれる (#712 §6.1 の不変条件)
        apply_exposed(&mut c, PrincipalClass::Ai, false).unwrap();
        assert!(!c.exposed_to.contains(&PrincipalClass::Ai));
        assert!(!c.trusted_for.contains(&PrincipalClass::Ai));
    }

    #[test]
    fn unexpose_plugin_clears_individual_trusts() {
        let mut c = conn();
        apply_exposed(&mut c, PrincipalClass::Plugin, true).unwrap();
        apply_trusted_plugin(&mut c, "plg-1".into(), Some("Widget".into()), true).unwrap();
        apply_trusted_plugin(&mut c, "plg-2".into(), None, true).unwrap();
        assert_eq!(c.trusted_plugins.len(), 2);

        apply_exposed(&mut c, PrincipalClass::Plugin, false).unwrap();
        assert!(c.trusted_plugins.is_empty());
    }

    #[test]
    fn expose_and_trust_are_idempotent() {
        let mut c = conn();
        apply_exposed(&mut c, PrincipalClass::Ai, true).unwrap();
        apply_exposed(&mut c, PrincipalClass::Ai, true).unwrap();
        assert_eq!(c.exposed_to.len(), 1);

        apply_trusted(&mut c, PrincipalClass::Ai, true).unwrap();
        apply_trusted(&mut c, PrincipalClass::Ai, true).unwrap();
        assert_eq!(c.trusted_for.len(), 1);
    }

    #[test]
    fn retrust_plugin_updates_name_snapshot() {
        let mut c = conn();
        apply_trusted_plugin(&mut c, "plg-1".into(), Some("旧名".into()), true).unwrap();
        apply_trusted_plugin(&mut c, "plg-1".into(), Some("新名".into()), true).unwrap();
        assert_eq!(c.trusted_plugins.len(), 1);
        assert_eq!(c.trusted_plugins[0].name.as_deref(), Some("新名"));

        apply_trusted_plugin(&mut c, "plg-1".into(), None, false).unwrap();
        assert!(c.trusted_plugins.is_empty());
    }

    fn upsert_input(base_url: &str, local: bool) -> ConnectionUpsert {
        ConnectionUpsert {
            id: None,
            name: "ollama".into(),
            base_url: base_url.into(),
            auth_type: AuthType::Bearer,
            allowed_hosts: vec![],
            account_scope: None,
            notes: None,
            template_id: None,
            protocol: Some(ConnectionProtocol::OpenaiCompat),
            origin: None,
            external_source: None,
            local,
        }
    }

    /// ローカル接続 (#880) は URL を正規化して保存し、誰にも開示できない
    #[test]
    fn local_connection_is_normalized_and_never_exposed() {
        let dir = tempfile::tempdir().unwrap();
        let c =
            upsert_metadata(dir.path(), upsert_input("http://localhost:11434/v1", true)).unwrap();
        assert!(c.local);
        assert_eq!(c.base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(c.allowed_hosts, vec!["127.0.0.1".to_string()]);
        let mut c2 = c.clone();
        assert!(apply_exposed(&mut c2, PrincipalClass::Ai, true).is_err());
        assert!(apply_trusted(&mut c2, PrincipalClass::Ai, true).is_err());
        assert!(apply_trusted_plugin(&mut c2, "p".into(), None, true).is_err());
        assert!(apply_exposed(&mut c2, PrincipalClass::Ai, false).is_ok());
        assert!(c2.exposed_to.is_empty());
    }

    /// loopback の URL ⇔ ローカル接続 は両向きに検査する。自アプリのポートは拒む
    #[test]
    fn loopback_url_and_local_flag_must_agree() {
        let dir = tempfile::tempdir().unwrap();
        assert!(
            upsert_metadata(dir.path(), upsert_input("http://127.0.0.1:11434/v1", false)).is_err()
        );
        assert!(
            upsert_metadata(dir.path(), upsert_input("https://api.example.com/v1", true)).is_err()
        );
        assert!(
            upsert_metadata(dir.path(), upsert_input("http://127.0.0.1:19820/v1", true)).is_err()
        );
        assert!(upsert_metadata(dir.path(), upsert_input("http://127.0.0.1/v1", true)).is_err());
    }

    #[test]
    fn switching_an_exposed_connection_to_local_clears_its_exposure() {
        let dir = tempfile::tempdir().unwrap();
        let c = upsert_metadata(
            dir.path(),
            upsert_input("https://api.example.com/v1", false),
        )
        .unwrap();
        update_connection(dir.path(), &c.id, |c| {
            apply_exposed(c, PrincipalClass::Plugin, true)
        })
        .unwrap()
        .unwrap();
        let mut input = upsert_input("http://127.0.0.1:11434/v1", true);
        input.id = Some(c.id.clone());
        let c = upsert_metadata(dir.path(), input).unwrap();
        assert!(c.local);
        assert!(c.exposed_to.is_empty());
        assert!(c.trusted_plugins.is_empty());
    }

    #[test]
    fn model_ids_are_read_from_a_models_list() {
        assert_eq!(
            parse_model_ids(r#"{"object":"list","data":[{"id":"qwen2.5:0.5b"},{"id":"x"}]}"#),
            Some(vec!["qwen2.5:0.5b".to_string(), "x".to_string()])
        );
        assert_eq!(
            parse_model_ids(r#"{"object":"list","data":[]}"#),
            Some(vec![])
        );
        assert_eq!(parse_model_ids("not json"), None);
        assert_eq!(parse_model_ids(r#"{"error":"x"}"#), None);
        assert_eq!(
            models_path_for(Some(ConnectionProtocol::OpenaiCompat)),
            "/models"
        );
        assert_eq!(
            models_path_for(Some(ConnectionProtocol::Anthropic)),
            "/v1/models"
        );
    }
}
