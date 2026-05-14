//! Secret Vault ([#564](https://github.com/hitalin/notedeck/issues/564)) の Tauri コマンド層。
//!
//! ロジックは [`crate::vault`] モジュールにあり、ここは薄いラッパー。
//! 全コマンドは main ウィンドウからのみ呼べる (AiScript の WebView 等を遮断)。
//! `vault_fetch` (Phase B) を除き AI tool / HTTP API からは呼べない。

use std::time::{SystemTime, UNIX_EPOCH};

use secrecy::SecretString;
use serde::{Deserialize, Serialize};

use crate::vault::connections_store;
use crate::vault::fetch::{self, VaultFetchRequest, VaultFetchResponse};
use crate::vault::model::{validate_connection_id, validate_slot};
use crate::vault::{
    AuthType, Connection, ConnectionKind, ConnectionOrigin, ConnectionProtocol, KeychainBackend,
    SecretBackend,
    VaultError, VaultResult,
};

/// redaction の誤マッチを防ぐための secret 最小長。
const MIN_SECRET_LEN: usize = 16;

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn backend() -> KeychainBackend {
    KeychainBackend
}

/// vault コマンドは main ウィンドウからのみ許可する。
///
/// AiScript の WebView やプラグインウィンドウは別 label を持つため、
/// `__TAURI__.invoke('vault_*')` を直接呼んでも弾かれる。
fn assert_main_window(window: &tauri::Window) -> VaultResult<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(VaultError::InvalidInput {
            message: "vault commands are restricted to the main window".to_string(),
        })
    }
}

/// baseUrl を検証する: https/http スキーム + host 必須、query/fragment/userinfo は禁止。
fn validate_base_url(raw: &str) -> VaultResult<()> {
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

/// メタデータを upsert する内部ヘルパー。secret は触らない。
fn upsert_metadata(
    app: &tauri::AppHandle,
    input: ConnectionUpsert,
) -> VaultResult<Connection> {
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
                ai_visible: false,
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

/// 全接続のメタデータ一覧を返す (secret は含まない)。
#[tauri::command]
#[specta::specta]
pub async fn vault_list_connections(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> VaultResult<Vec<Connection>> {
    assert_main_window(&window)?;
    let file = connections_store::load(&app)?;
    connections_store::check_schema_version(&file)?;
    Ok(file.connections)
}

/// 単一接続のメタデータを返す。
#[tauri::command]
#[specta::specta]
pub async fn vault_get_connection(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
) -> VaultResult<Option<Connection>> {
    assert_main_window(&window)?;
    validate_connection_id(&id)?;
    let file = connections_store::load(&app)?;
    Ok(file.connections.into_iter().find(|c| c.id == id))
}

/// 接続のメタデータを作成 / 更新する (secret は別コマンド)。
#[tauri::command]
#[specta::specta]
pub async fn vault_upsert_connection(
    app: tauri::AppHandle,
    window: tauri::Window,
    input: ConnectionUpsert,
) -> VaultResult<Connection> {
    assert_main_window(&window)?;
    upsert_metadata(&app, input)
}

/// 接続のメタデータと secret を 1 トランザクションで作成 / 更新する。
///
/// TOCTOU を避けるため、メタデータ保存 → keychain 書き込みを 1 コマンドにまとめる。
/// keychain 書き込みに失敗したらメタデータ側の slot 登録もロールバックする。
#[tauri::command]
#[specta::specta]
pub async fn vault_upsert_connection_with_secret(
    app: tauri::AppHandle,
    window: tauri::Window,
    input: ConnectionUpsert,
    slot: String,
    secret: String,
) -> VaultResult<Connection> {
    assert_main_window(&window)?;
    validate_slot(&slot)?;
    if secret.len() < MIN_SECRET_LEN {
        return Err(VaultError::SecretTooShort);
    }

    let connection = upsert_metadata(&app, input)?;
    let conn_id = connection.id.clone();
    let secret = SecretString::from(secret);

    // keychain 書き込み。失敗したらメタデータは既に保存済みだが slot は未登録なので
    // 「secret 未設定の接続」として残るだけで整合性は保たれる。
    backend().store(&conn_id, &slot, &secret)?;

    // slot をメタデータに登録する。
    register_slot(&app, &conn_id, &slot)
}

/// slot をメタデータの `slots` 配列に登録し、更新後の接続を返す。
fn register_slot(app: &tauri::AppHandle, conn_id: &str, slot: &str) -> VaultResult<Connection> {
    let mut file = connections_store::load(app)?;
    let connection = file
        .connections
        .iter_mut()
        .find(|c| c.id == conn_id)
        .ok_or(VaultError::ConnectionNotFound)?;
    if !connection.slots.iter().any(|s| s == slot) {
        connection.slots.push(slot.to_string());
    }
    connection.last_secret_updated_at = Some(now_millis());
    connection.updated_at = now_millis();
    let result = connection.clone();
    connections_store::save(app, &file)?;
    Ok(result)
}

/// 既存接続の secret を設定 / 入れ替える。
#[tauri::command]
#[specta::specta]
pub async fn vault_set_secret(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    slot: String,
    secret: String,
) -> VaultResult<Connection> {
    assert_main_window(&window)?;
    validate_connection_id(&id)?;
    validate_slot(&slot)?;
    if secret.len() < MIN_SECRET_LEN {
        return Err(VaultError::SecretTooShort);
    }

    // 接続が存在することを確認する。
    let file = connections_store::load(&app)?;
    if !file.connections.iter().any(|c| c.id == id) {
        return Err(VaultError::ConnectionNotFound);
    }

    let secret = SecretString::from(secret);
    backend().store(&id, &slot, &secret)?;
    register_slot(&app, &id, &slot)
}

/// 接続の secret 設定状況を返す (値そのものは決して返さない)。
#[tauri::command]
#[specta::specta]
pub async fn vault_get_secret_status(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
) -> VaultResult<SecretStatus> {
    assert_main_window(&window)?;
    validate_connection_id(&id)?;
    let file = connections_store::load(&app)?;
    let connection = file
        .connections
        .iter()
        .find(|c| c.id == id)
        .ok_or(VaultError::ConnectionNotFound)?;

    let backend = backend();
    let mut slots = Vec::new();
    for slot in &connection.slots {
        let present = backend.load(&id, slot)?.is_some();
        slots.push(SecretSlotStatus {
            name: slot.clone(),
            present,
        });
    }
    Ok(SecretStatus { slots })
}

/// 接続の特定 slot の secret を削除する。
#[tauri::command]
#[specta::specta]
pub async fn vault_delete_secret(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    slot: String,
) -> VaultResult<()> {
    assert_main_window(&window)?;
    validate_connection_id(&id)?;
    validate_slot(&slot)?;

    backend().delete(&id, &slot)?;

    let mut file = connections_store::load(&app)?;
    if let Some(connection) = file.connections.iter_mut().find(|c| c.id == id) {
        connection.slots.retain(|s| s != &slot);
        connection.updated_at = now_millis();
        connections_store::save(&app, &file)?;
    }
    Ok(())
}

/// 接続を削除する。全 slot の secret を keychain から消し、メタデータも削除する。
#[tauri::command]
#[specta::specta]
pub async fn vault_delete_connection(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
) -> VaultResult<()> {
    assert_main_window(&window)?;
    validate_connection_id(&id)?;

    let mut file = connections_store::load(&app)?;
    let Some(pos) = file.connections.iter().position(|c| c.id == id) else {
        return Err(VaultError::ConnectionNotFound);
    };

    // secret を先に消す (途中 crash でも orphan メタデータより orphan secret の方が安全)。
    let backend = backend();
    let connection = &file.connections[pos];
    for slot in &connection.slots {
        backend.delete(&id, slot)?;
    }

    file.connections.remove(pos);
    connections_store::save(&app, &file)?;
    Ok(())
}

/// 接続を AI に開示するかを切り替える。
#[tauri::command]
#[specta::specta]
pub async fn vault_set_ai_visible(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    visible: bool,
) -> VaultResult<()> {
    assert_main_window(&window)?;
    validate_connection_id(&id)?;

    let mut file = connections_store::load(&app)?;
    let connection = file
        .connections
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or(VaultError::ConnectionNotFound)?;
    connection.ai_visible = visible;
    connection.updated_at = now_millis();
    connections_store::save(&app, &file)?;
    Ok(())
}

/// 登録済み接続を使って HTTP リクエストを実行する。
///
/// secret は Rust 側で注入され、フロントエンドには渡らない。SSRF 防御
/// (DNS pinning / redirect 再検証 / allowedHosts) とレスポンス redaction を通す。
///
/// Phase B 時点では main ウィンドウからのみ呼べる。AI tool 経路の許可
/// (`allowFromAiTool`) と confirmation は Phase D で capability registry 側に実装する。
#[tauri::command]
#[specta::specta]
pub async fn vault_fetch(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    request: VaultFetchRequest,
) -> VaultResult<VaultFetchResponse> {
    assert_main_window(&window)?;
    let response = fetch::vault_fetch(&app, &id, request).await?;
    touch_last_used(&app, &id);
    Ok(response)
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

/// 接続の疎通テスト。baseUrl への GET (または指定パス) を 1 回実行する。
#[tauri::command]
#[specta::specta]
pub async fn vault_test_connection(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    test_path: Option<String>,
) -> VaultResult<VaultTestResult> {
    assert_main_window(&window)?;
    validate_connection_id(&id)?;

    let request = VaultFetchRequest {
        path: test_path.unwrap_or_else(|| "/".to_string()),
        method: Some("GET".to_string()),
        headers: None,
        body: None,
        timeout_ms: Some(10_000),
        slot: None,
    };

    match fetch::vault_fetch(&app, &id, request).await {
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
/// 移行後、旧キーチェーンエントリーは削除する。
///
/// キーチェーンに該当 provider のエントリーが無い場合は `None` を返す
/// (移行対象なし)。フロント側は返り値の接続 id を `ai.json5` に記録する。
#[tauri::command]
#[specta::specta]
pub async fn ai_migrate_provider_to_vault(
    app: tauri::AppHandle,
    window: tauri::Window,
    provider: String,
    name: String,
    base_url: String,
    protocol: ConnectionProtocol,
) -> VaultResult<Option<Connection>> {
    assert_main_window(&window)?;

    let api_key = crate::commands::ai::read_ai_api_key(&provider)
        .map_err(|e| VaultError::InvalidInput {
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
        &app,
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
    let connection = register_slot(&app, &conn_id, "primary")?;

    // 旧キーチェーンエントリーを削除する。失敗しても移行自体は成功扱い。
    let _ = notecli::keychain::delete_token(&crate::commands::ai::ai_keychain_id(&provider));

    Ok(Some(connection))
}

/// 接続の `last_used_at` を現在時刻で更新する (ベストエフォート、失敗は無視)。
fn touch_last_used(app: &tauri::AppHandle, id: &str) {
    let Ok(mut file) = connections_store::load(app) else {
        return;
    };
    if let Some(connection) = file.connections.iter_mut().find(|c| c.id == id) {
        connection.last_used_at = Some(now_millis());
        let _ = connections_store::save(app, &file);
    }
}
