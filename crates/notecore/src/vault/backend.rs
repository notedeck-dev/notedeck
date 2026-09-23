use secrecy::SecretString;

use super::error::VaultResult;

/// secret backend が報告する能力。
///
/// Android Keystore など backend ごとに制約が異なるため、
/// 上位 UI が「値が長すぎる」等を事前に判定できるようにする。
/// Phase B 以降で参照する。
#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
pub struct BackendCapabilities {
    /// 1 エントリーあたりの最大バイト数。
    pub max_value_bytes: usize,
}

/// secret の永続化先を抽象化する trait。
///
/// 同期 API として定義する — keyring 系 OS API はいずれも同期呼び出しのため。
/// 呼び出し側で `tokio::task::spawn_blocking` に載せること。
///
/// v1 の実装は [`super::keychain_backend::KeychainBackend`] のみ。
/// Android 用の backend は v2 でこの trait を実装して追加する。
pub trait SecretBackend: Send + Sync {
    /// secret を保存する (上書き)。
    fn store(&self, conn_id: &str, slot: &str, value: &SecretString) -> VaultResult<()>;

    /// secret を取得する。エントリーが無ければ `Ok(None)`。
    fn load(&self, conn_id: &str, slot: &str) -> VaultResult<Option<SecretString>>;

    /// secret を削除する。エントリーが無くても `Ok(())`。
    fn delete(&self, conn_id: &str, slot: &str) -> VaultResult<()>;

    /// backend の能力を報告する。Phase B 以降で参照する。
    #[allow(dead_code)]
    fn capabilities(&self) -> BackendCapabilities;
}
