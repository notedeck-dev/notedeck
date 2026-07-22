//! Secret Vault ([#564](https://github.com/notedeck-dev/notedeck/issues/564)) の Tauri コマンド層。
//!
//! ロジックは [`crate::vault::connections_service`] にあり、ここは
//! 「main ウィンドウ検証 + service 呼び出し」の薄いラッパー (#782 R4)。
//! 全コマンドは main ウィンドウからのみ呼べる (AiScript の WebView 等を遮断)。
//! `vault_fetch` (Phase B) を除き AI tool / HTTP API からは呼べない。

use crate::vault::connections_service::{
    self as service, ConnectionUpsert, SecretStatus, VaultTestResult,
};
use crate::vault::connections_store;
use crate::vault::fetch::{self, VaultFetchRequest, VaultFetchResponse};
use crate::vault::model::{validate_connection_id, PrincipalClass};
use crate::vault::{Connection, ConnectionProtocol, VaultError, VaultResult};

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
    service::upsert_metadata(&app, input)
}

/// 接続のメタデータと secret を 1 トランザクションで作成 / 更新する。
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
    service::upsert_with_secret(&app, input, &slot, secret)
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
    service::set_secret(&app, &id, &slot, secret)
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
    service::secret_status(&app, &id)
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
    service::delete_secret(&app, &id, &slot)
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
    service::delete_connection(&app, &id)
}

/// 接続の開示先クラスを切り替える (#712 §6.1)。
#[tauri::command]
#[specta::specta]
pub async fn vault_set_exposed(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    principal_class: PrincipalClass,
    exposed: bool,
) -> VaultResult<()> {
    assert_main_window(&window)?;
    service::update_connection(&app, &id, |c| {
        service::apply_exposed(c, principal_class, exposed)
    })
}

/// 接続を「信頼済み」(確認なしで利用可) にするクラスを切り替える (#712 §6.2)。
/// 旧 `vault_set_ai_trusted(id, bool)` の置換 — クラスを明示することで
/// 「外部アプリでの確認同意が AI の trust に化ける」経路が構造的に消える。
#[tauri::command]
#[specta::specta]
pub async fn vault_set_trusted(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    principal_class: PrincipalClass,
    trusted: bool,
) -> VaultResult<()> {
    assert_main_window(&window)?;
    service::update_connection(&app, &id, |c| {
        service::apply_trusted(c, principal_class, trusted)
    })
}

/// 接続を「信頼済み」にするプラグイン個体を切り替える。
///
/// plugin クラスの trust はクラス一括 (`trusted_for`) にせず個体単位で持つ —
/// 1 つのウィジェットの確認同意が全プラグイン / Play / Page に波及しない。
#[tauri::command]
#[specta::specta]
pub async fn vault_set_trusted_plugin(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    plugin_id: String,
    name: Option<String>,
    trusted: bool,
) -> VaultResult<()> {
    assert_main_window(&window)?;
    service::update_connection(&app, &id, |c| {
        service::apply_trusted_plugin(c, plugin_id, name, trusted)
    })
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
    service::touch_last_used(&app, &id);
    Ok(response)
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
    service::test_connection(&app, &id, test_path).await
}

/// AI プロバイダーの API キーを Vault 接続へ移行する (#564 後続)。
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
    service::migrate_ai_provider(&app, &provider, name, base_url, protocol)
}
