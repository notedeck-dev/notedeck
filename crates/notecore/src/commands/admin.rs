//! admin のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use notecli::db::{ChatEvictionConfig, EvictionConfig};
use notecli::error::NoteDeckError;
use notecli::models::{AccountPublic, ServerDetection};

use crate::account_service;
use crate::commands::{export_account_list, validate_host};
use crate::context::Core;
use crate::error::Result;

// --- DB: Accounts ---

// --- Cache management ---

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub note_count: i64,
    pub db_size_bytes: i64,
}

// 以下の cache 系コマンドは writer lock を長時間 (秒〜分オーダー) 保持し得るため
// spawn_blocking で退避する。writer は std::sync::Mutex のため async runtime 直呼びは
// tokio worker の連鎖枯渇を招く (前例: messaging.rs)。

/// writer lock を長時間保持する DB 操作を blocking スレッドで実行する。
async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> std::result::Result<T, NoteDeckError> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| NoteDeckError::Internal(format!("blocking task failed: {e}")))?
}

// --- Chat cache management ---

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ChatCacheStats {
    pub message_count: i64,
    pub bytes: i64,
}

// --- Guest / Anonymous API ---

// --- Server detections (SWR キャッシュは notecli::server_info、#782) ---

pub async fn load_accounts(core: &Core) -> Result<Vec<AccountPublic>> {
    let db = core.db().await;
    account_service::list_public(&db)
}

pub async fn cache_stats(core: &Core) -> Result<CacheStats> {
    let db = core.db().await;
    let (note_count, db_size_bytes) = db.cache_stats()?;
    Ok(CacheStats {
        note_count,
        db_size_bytes,
    })
}

pub async fn account_cache_count(core: &Core, account_id: String) -> Result<i64> {
    core.blocking(move |db| db.account_cache_count(&account_id))
        .await
}

pub async fn clear_account_cache(core: &Core, account_id: String) -> Result<u64> {
    let db = core.db().await;
    run_blocking(move || db.clear_account_cache(&account_id)).await
}

pub async fn clear_all_cache(core: &Core) -> Result<u64> {
    let db = core.db().await;
    run_blocking(move || {
        let notes = db.clear_all_notes_cache()?;
        let _ogp = db.clear_ogp_cache()?;
        Ok(notes)
    })
    .await
}

/// ユーザーが UI で選んだ eviction config を即時適用する。 戻り値は削除件数。
/// JS 側で settings.cacheEviction を変更したタイミングで呼ぶ想定。
pub async fn apply_eviction_config(core: &Core, config: EvictionConfig) -> Result<u64> {
    let db = core.db().await;
    run_blocking(move || db.cleanup_with_eviction(&config)).await
}

/// notecli の `EvictionConfig::default()` を取得する。 アプリの「バランス」
/// プリセットの実体としてフロント側で参照する。
pub async fn default_eviction_config(_core: &Core) -> Result<EvictionConfig> {
    Ok(EvictionConfig::default())
}

pub async fn chat_cache_stats(core: &Core) -> Result<ChatCacheStats> {
    let db = core.db().await;
    let (message_count, bytes) = db.chat_cache_stats()?;
    Ok(ChatCacheStats {
        message_count,
        bytes,
    })
}

pub async fn chat_cache_count(core: &Core, account_id: String) -> Result<i64> {
    core.blocking(move |db| db.chat_cache_count(&account_id))
        .await
}

pub async fn clear_chat_cache_for_account(core: &Core, account_id: String) -> Result<u64> {
    core.blocking(move |db| db.clear_chat_cache_for_account(&account_id))
        .await
}

/// chat 用の eviction config を即時適用する。`apply_eviction_config` (notes 用) と並列。
pub async fn apply_chat_eviction_config(core: &Core, config: ChatEvictionConfig) -> Result<u64> {
    let db = core.db().await;
    run_blocking(move || db.cleanup_chat_with_eviction(&config)).await
}

pub async fn default_chat_eviction_config(_core: &Core) -> Result<ChatEvictionConfig> {
    Ok(ChatEvictionConfig::default())
}

/// Create a guest (unauthenticated) account for browsing public timelines.
pub async fn create_guest_account(
    core: &Core,
    host: String,
    software: String,
) -> Result<AccountPublic> {
    let db = core.db().await;
    let host = validate_host(&host)?;
    let account = account_service::create_guest(&db, host, software)?;
    export_account_list(core, &db);
    Ok(AccountPublic::new(&account, false))
}

pub async fn load_server_detections(core: &Core) -> Result<Vec<ServerDetection>> {
    core.blocking(move |db| db.load_server_detections()).await
}

/// SWR 取得: fresh は即返し / stale は返しつつ背景再検出 / miss は検出して保存。
pub async fn get_server_detection(core: &Core, host: String) -> Result<ServerDetection> {
    let svc = core.server_info().await;
    svc.get_or_fetch(&host).await
}

/// 強制ネットワーク検出 + 保存。ログイン直後などキャッシュを確実に上書きする用。
pub async fn detect_server(core: &Core, host: String) -> Result<ServerDetection> {
    let svc = core.server_info().await;
    svc.detect_and_store(&host).await
}

/// Validate that a file has a valid SQLite header.
pub fn validate_sqlite_file(path: &std::path::Path) -> Result<()> {
    let header = std::fs::read(path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read file: {e}")))?;
    if header.len() < 16 || &header[..16] != b"SQLite format 3\0" {
        return Err(NoteDeckError::InvalidInput(
            "Not a valid SQLite database file".to_string(),
        ));
    }
    Ok(())
}

/// notecli.db の整合したスナップショットを `dest` に書く (トークンは常に除去)。
/// 手元側の「DB をエクスポート」(保存 dialog) が呼ぶ。
pub async fn snapshot_db_to(core: &Core, dest: &std::path::Path) -> Result<()> {
    let db = core.db().await;
    let dest = dest.to_path_buf();
    tokio::task::spawn_blocking(move || db.backup_to(&dest, true))
        .await
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?
}

/// `src` を検証してから notecli.db として app dir に置き、WAL / SHM を消す
/// (再起動後に新しい DB がきれいに開く)。手元側の「DB をインポート」(選択 dialog) が呼ぶ。
pub fn replace_database_file(app_dir: &std::path::Path, src: &std::path::Path) -> Result<()> {
    validate_sqlite_file(src)?;
    std::fs::copy(src, app_dir.join("notecli.db"))
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to import database: {e}")))?;
    let _ = std::fs::remove_file(app_dir.join("notecli.db-wal"));
    let _ = std::fs::remove_file(app_dir.join("notecli.db-shm"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_sqlite_valid() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        // Write valid SQLite header + padding
        let mut data = b"SQLite format 3\0".to_vec();
        data.resize(100, 0);
        std::fs::write(&path, &data).unwrap();
        assert!(validate_sqlite_file(&path).is_ok());
    }

    #[test]
    fn validate_sqlite_invalid_header() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("not-a-db.txt");
        std::fs::write(&path, "this is not a database").unwrap();
        assert!(validate_sqlite_file(&path).is_err());
    }

    #[test]
    fn validate_sqlite_too_small() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tiny.db");
        std::fs::write(&path, "small").unwrap();
        assert!(validate_sqlite_file(&path).is_err());
    }

    #[test]
    fn validate_sqlite_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("empty.db");
        std::fs::write(&path, "").unwrap();
        assert!(validate_sqlite_file(&path).is_err());
    }
}
