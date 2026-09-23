//! vault のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

//! Secret Vault ([#564](https://github.com/notedeck-dev/notedeck/issues/564)) の読み取り面と
//! secret を使う (開示しない) 操作。許可ウィンドウ属性 (main) は表の行が持ち、
//! secret や信頼設定を書く操作は認可境界として src-tauri 側に残る。

use crate::context::Core;
use crate::vault::connections_service::{self as service, SecretStatus, VaultTestResult};
use crate::vault::connections_store;
use crate::vault::fetch::{self, VaultFetchRequest, VaultFetchResponse};
use crate::vault::model::validate_connection_id;
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
