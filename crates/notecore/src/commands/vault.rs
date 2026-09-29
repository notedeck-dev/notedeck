//! vault のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

//! Secret Vault ([#564](https://github.com/notedeck-dev/notedeck/issues/564)) の読み取り面、
//! secret を使う (開示しない) 操作、そして secret や信頼設定を書く操作 (表の種別 authz)。
//! 許可ウィンドウ属性 (main) は表の行が持つ。書込も notecore にあり、このプロセスの
//! secret store に書く (#1106)。

use crate::context::Core;
use crate::vault::connections_service::{
    self as service, ConnectionUpsert, SecretStatus, VaultTestResult,
};
use crate::vault::connections_store;
use crate::vault::fetch::{self, VaultFetchRequest, VaultFetchResponse};
use crate::vault::model::validate_connection_id;
use crate::vault::model::PrincipalClass;
use crate::vault::ConnectionProtocol;
use crate::vault::{Connection, VaultError, VaultResult};

/// 全接続のメタデータ一覧を返す (secret は含まない)。
pub async fn vault_list_connections(core: &Core) -> VaultResult<Vec<Connection>> {
    let dir = core.app_dir().map_err(|e| VaultError::StoreIo {
        message: e.to_string(),
    })?;
    let file = connections_store::load(dir)?;
    connections_store::check_schema_version(&file)?;
    Ok(file.connections)
}

/// 単一接続のメタデータを返す。
pub async fn vault_get_connection(core: &Core, id: String) -> VaultResult<Option<Connection>> {
    let dir = core.app_dir().map_err(|e| VaultError::StoreIo {
        message: e.to_string(),
    })?;
    validate_connection_id(&id)?;
    let file = connections_store::load(dir)?;
    Ok(file.connections.into_iter().find(|c| c.id == id))
}

/// 接続の secret 設定状況を返す (値そのものは決して返さない)。
pub async fn vault_get_secret_status(core: &Core, id: String) -> VaultResult<SecretStatus> {
    let dir = core.app_dir().map_err(|e| VaultError::StoreIo {
        message: e.to_string(),
    })?;
    service::secret_status(dir, &id)
}

/// 登録済み接続を使って HTTP リクエストを実行する。
///
/// secret は Rust 側で注入され、フロントエンドには渡らない。SSRF 防御
/// (DNS pinning / redirect 再検証 / allowedHosts) とレスポンス redaction を通す。
///
/// Phase B 時点では main ウィンドウからのみ呼べる。AI tool 経路の許可
/// (`allowFromAiTool`) と confirmation は Phase D で capability registry 側に実装する。
pub async fn vault_fetch(
    core: &Core,
    id: String,
    request: VaultFetchRequest,
) -> VaultResult<VaultFetchResponse> {
    let dir = core.app_dir().map_err(|e| VaultError::StoreIo {
        message: e.to_string(),
    })?;
    let response = fetch::vault_fetch(dir, &id, request).await?;
    service::touch_last_used(dir, &id);
    Ok(response)
}

/// 接続の疎通テスト。baseUrl への GET (または指定パス) を 1 回実行する。
pub async fn vault_test_connection(
    core: &Core,
    id: String,
    test_path: Option<String>,
) -> VaultResult<VaultTestResult> {
    let dir = core.app_dir().map_err(|e| VaultError::StoreIo {
        message: e.to_string(),
    })?;
    service::test_connection(dir, &id, test_path).await
}

fn dir(core: &Core) -> VaultResult<&std::path::Path> {
    core.app_dir().map_err(|e| VaultError::StoreIo {
        message: e.to_string(),
    })
}

pub async fn vault_upsert_connection(
    core: &Core,
    input: ConnectionUpsert,
) -> VaultResult<Connection> {
    service::upsert_metadata(dir(core)?, input)
}

pub async fn vault_upsert_connection_with_secret(
    core: &Core,
    input: ConnectionUpsert,
    slot: String,
    secret: String,
) -> VaultResult<Connection> {
    service::upsert_with_secret(dir(core)?, input, &slot, secret)
}

pub async fn vault_set_secret(
    core: &Core,
    id: String,
    slot: String,
    secret: String,
) -> VaultResult<Connection> {
    service::set_secret(dir(core)?, &id, &slot, secret)
}

pub async fn vault_delete_secret(core: &Core, id: String, slot: String) -> VaultResult<()> {
    service::delete_secret(dir(core)?, &id, &slot)
}

pub async fn vault_delete_connection(core: &Core, id: String) -> VaultResult<()> {
    service::delete_connection(dir(core)?, &id)
}

pub async fn vault_set_exposed(
    core: &Core,
    id: String,
    principal_class: PrincipalClass,
    exposed: bool,
) -> VaultResult<()> {
    service::update_connection(dir(core)?, &id, |c| {
        service::apply_exposed(c, principal_class, exposed)
    })
}

pub async fn vault_set_trusted(
    core: &Core,
    id: String,
    principal_class: PrincipalClass,
    trusted: bool,
) -> VaultResult<()> {
    service::update_connection(dir(core)?, &id, |c| {
        service::apply_trusted(c, principal_class, trusted)
    })
}

pub async fn vault_set_trusted_plugin(
    core: &Core,
    id: String,
    plugin_id: String,
    name: Option<String>,
    trusted: bool,
) -> VaultResult<()> {
    service::update_connection(dir(core)?, &id, |c| {
        service::apply_trusted_plugin(c, plugin_id, name, trusted)
    })
}

pub async fn ai_migrate_provider_to_vault(
    core: &Core,
    provider: String,
    name: String,
    base_url: String,
    protocol: ConnectionProtocol,
) -> VaultResult<Option<Connection>> {
    service::migrate_ai_provider(dir(core)?, &provider, name, base_url, protocol)
}
