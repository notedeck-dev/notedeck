//! Secret Vault ([#564](https://github.com/notedeck-dev/notedeck/issues/564)) の Tauri コマンド層。
//!
//! ロジックは [`notecore::vault::connections_service`] にあり、ここは
//! 「main ウィンドウ検証 + service 呼び出し」の薄いラッパー (#782 R4)。
//! 全コマンドは main ウィンドウからのみ呼べる (AiScript の WebView 等を遮断)。
//! `vault_fetch` (Phase B) を除き AI tool / HTTP API からは呼べない。

use notecore::vault::connections_service::{self as service, ConnectionUpsert};
use notecore::vault::model::PrincipalClass;
use notecore::vault::{Connection, ConnectionProtocol, VaultError, VaultResult};

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

/// アプリデータディレクトリを解決する。service 層は Tauri を知らず `&Path` を受ける (#1106)。
fn app_dir(app: &tauri::AppHandle) -> VaultResult<std::path::PathBuf> {
    crate::app_dir::resolve_app_dir(app).map_err(|e| VaultError::StoreIo {
        message: e.to_string(),
    })
}

/// 接続のメタデータを作成 / 更新する (secret は別コマンド)。
// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn vault_upsert_connection(
    app: tauri::AppHandle,
    window: tauri::Window,
    input: ConnectionUpsert,
) -> VaultResult<Connection> {
    assert_main_window(&window)?;
    let dir = app_dir(&app)?;
    service::upsert_metadata(&dir, input)
}

/// 接続のメタデータと secret を 1 トランザクションで作成 / 更新する。
// nd-command: authz
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
    let dir = app_dir(&app)?;
    service::upsert_with_secret(&dir, input, &slot, secret)
}

/// 既存接続の secret を設定 / 入れ替える。
// nd-command: authz
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
    let dir = app_dir(&app)?;
    service::set_secret(&dir, &id, &slot, secret)
}

/// 接続の特定 slot の secret を削除する。
// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn vault_delete_secret(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
    slot: String,
) -> VaultResult<()> {
    assert_main_window(&window)?;
    let dir = app_dir(&app)?;
    service::delete_secret(&dir, &id, &slot)
}

/// 接続を削除する。全 slot の secret を keychain から消し、メタデータも削除する。
// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn vault_delete_connection(
    app: tauri::AppHandle,
    window: tauri::Window,
    id: String,
) -> VaultResult<()> {
    assert_main_window(&window)?;
    let dir = app_dir(&app)?;
    service::delete_connection(&dir, &id)
}

/// 接続の開示先クラスを切り替える (#712 §6.1)。
// nd-command: authz
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
    let dir = app_dir(&app)?;
    service::update_connection(&dir, &id, |c| {
        service::apply_exposed(c, principal_class, exposed)
    })
}

/// 接続を「信頼済み」(確認なしで利用可) にするクラスを切り替える (#712 §6.2)。
/// 旧 `vault_set_ai_trusted(id, bool)` の置換 — クラスを明示することで
/// 「外部アプリでの確認同意が AI の trust に化ける」経路が構造的に消える。
// nd-command: authz
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
    let dir = app_dir(&app)?;
    service::update_connection(&dir, &id, |c| {
        service::apply_trusted(c, principal_class, trusted)
    })
}

/// 接続を「信頼済み」にするプラグイン個体を切り替える。
///
/// plugin クラスの trust はクラス一括 (`trusted_for`) にせず個体単位で持つ —
/// 1 つのウィジェットの確認同意が全プラグイン / Play / Page に波及しない。
// nd-command: authz
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
    let dir = app_dir(&app)?;
    service::update_connection(&dir, &id, |c| {
        service::apply_trusted_plugin(c, plugin_id, name, trusted)
    })
}

/// AI プロバイダーの API キーを Vault 接続へ移行する (#564 後続)。
// nd-command: authz
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
    let dir = app_dir(&app)?;
    service::migrate_ai_provider(&dir, &provider, name, base_url, protocol)
}
