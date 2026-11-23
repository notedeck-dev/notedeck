//! admin のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use notecli::db::{ChatEvictionConfig, EvictionConfig};
use notecli::error::NoteDeckError;
use notecli::models::{AccountPublic, ServerDetection};

use crate::account_service;
use crate::commands::validate_host;
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

// DB を触るコマンドはすべて `Core::blocking` で blocking スレッドへ寄せる (#1098 §7)。
// writer は std::sync::Mutex のため async runtime 直呼びは tokio worker の連鎖枯渇を
// 招く (前例: messaging.rs)。cache 系は writer lock を秒〜分オーダーで保持し得る。

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
    core.blocking(account_service::list_public).await
}

pub async fn cache_stats(core: &Core) -> Result<CacheStats> {
    let (note_count, db_size_bytes) = core.blocking(|db| db.cache_stats()).await?;
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
    core.blocking(move |db| db.clear_account_cache(&account_id))
        .await
}

pub async fn clear_all_cache(core: &Core) -> Result<u64> {
    core.blocking(|db| {
        let notes = db.clear_all_notes_cache()?;
        let _ogp = db.clear_ogp_cache()?;
        Ok(notes)
    })
    .await
}

/// ユーザーが UI で選んだ eviction config を即時適用する。 戻り値は削除件数。
/// JS 側で settings.cacheEviction を変更したタイミングで呼ぶ想定。
pub async fn apply_eviction_config(core: &Core, config: EvictionConfig) -> Result<u64> {
    core.blocking(move |db| db.cleanup_with_eviction(&config))
        .await
}

/// settings.json5 の掃き出し設定 (`cache.evictionPreset` 等) を解いて適用する (#1131)。
/// 起動時はコアが自分で呼び、設定画面からの変更も同じ経路を通る (端末に表を持たない)
pub async fn apply_eviction_from_settings(core: &Core) -> Result<u64> {
    let text = crate::settings_store::read_settings_json(core.layout()?).unwrap_or_default();
    let config = crate::eviction_preset::resolve(&text);
    apply_eviction_config(core, config).await
}

/// notecli の `EvictionConfig::default()` を取得する。 アプリの「バランス」
/// プリセットの実体としてフロント側で参照する。
pub async fn default_eviction_config(_core: &Core) -> Result<EvictionConfig> {
    Ok(EvictionConfig::default())
}

pub async fn chat_cache_stats(core: &Core) -> Result<ChatCacheStats> {
    let (message_count, bytes) = core.blocking(|db| db.chat_cache_stats()).await?;
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
    core.blocking(move |db| db.cleanup_chat_with_eviction(&config))
        .await
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
    let host = validate_host(&host)?;
    let account = core
        .blocking(move |db| account_service::create_guest(db, host, software))
        .await?;
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
    let dest = dest.to_path_buf();
    core.blocking(move |db| db.backup_to(&dest, true)).await
}

/// `src` を検証してから notecli.db として app dir に置き、WAL / SHM を消す
/// (再起動後に新しい DB がきれいに開く)。手元側の「DB をインポート」(選択 dialog) が呼ぶ。
///
/// このアプリで開けない DB (より新しい版が移行したものなど) は置き換えずに断る。
/// 置き換えてしまうと次の起動で移行が止まり、元の DB も失われる (#1438)。
pub fn replace_database_file(app_dir: &std::path::Path, src: &std::path::Path) -> Result<()> {
    use notecli::db::{Database, MigrationStatus};

    validate_sqlite_file(src)?;
    match Database::migration_status(src)? {
        MigrationStatus::UpToDate { .. } | MigrationStatus::Pending { .. } => {}
        MigrationStatus::DbNewer { .. } => {
            return Err(crate::i18n::error(
                "DB_IMPORT_NEWER",
                "_native.backup.dbNewer",
                serde_json::json!({}),
            ));
        }
        MigrationStatus::Divergent { .. } => {
            return Err(crate::i18n::error(
                "DB_IMPORT_INCOMPATIBLE",
                "_native.backup.dbIncompatible",
                serde_json::json!({}),
            ));
        }
    }
    std::fs::copy(src, app_dir.join("notecli.db"))
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to import database: {e}")))?;
    let _ = std::fs::remove_file(app_dir.join("notecli.db-wal"));
    let _ = std::fs::remove_file(app_dir.join("notecli.db-shm"));
    Ok(())
}

/// アカウントを削除する (資格情報の失効を含む認可境界、表の種別 authz)
pub async fn delete_account(core: &Core, id: String) -> Result<()> {
    // 口座セッションが張った main を含め、その口座の接続を先に落とす (#330 §3.1)
    if let Ok(streaming) = core.streaming() {
        streaming.disconnect(&id).await;
    }
    core.blocking(move |db| crate::account_service::delete(db, &id))
        .await
}

/// ログアウト: トークンだけ消し、アカウントの記録とカラムは残す
pub async fn logout_account(core: &Core, id: String) -> Result<()> {
    if let Ok(streaming) = core.streaming() {
        streaming.disconnect(&id).await;
    }
    core.blocking(move |db| crate::account_service::logout(db, &id))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 今のバイナリで作った DB (`future` なら、より新しい版が移行した印を足す)
    fn make_db(path: &std::path::Path, future: bool) {
        drop(notecli::db::Database::open(path).unwrap());
        if future {
            rusqlite::Connection::open(path)
                .unwrap()
                .execute(
                    "INSERT INTO refinery_schema_history (version, name, applied_on, checksum) \
                     VALUES (999, 'from_the_future', '2099-01-01T00:00:00Z', '0')",
                    [],
                )
                .unwrap();
        }
    }

    #[test]
    fn replace_database_file_accepts_db_of_this_version() {
        let dir = tempfile::tempdir().unwrap();
        let app_dir = dir.path().join("app");
        std::fs::create_dir(&app_dir).unwrap();
        std::fs::write(app_dir.join("notecli.db"), b"current").unwrap();
        let src = dir.path().join("src.db");
        make_db(&src, false);

        replace_database_file(&app_dir, &src).unwrap();
        assert_ne!(
            std::fs::read(app_dir.join("notecli.db")).unwrap(),
            b"current"
        );
    }

    #[test]
    fn replace_database_file_refuses_db_newer_than_this_app() {
        let dir = tempfile::tempdir().unwrap();
        let app_dir = dir.path().join("app");
        std::fs::create_dir(&app_dir).unwrap();
        std::fs::write(app_dir.join("notecli.db"), b"current").unwrap();
        std::fs::write(app_dir.join("notecli.db-wal"), b"wal").unwrap();
        let src = dir.path().join("src.db");
        make_db(&src, true);

        let err = replace_database_file(&app_dir, &src).unwrap_err();
        assert_eq!(err.code(), "DB_IMPORT_NEWER");
        // 今の DB は置き換えず、WAL も消さない
        assert_eq!(
            std::fs::read(app_dir.join("notecli.db")).unwrap(),
            b"current"
        );
        assert!(app_dir.join("notecli.db-wal").exists());
    }

    #[test]
    fn replace_database_file_refuses_db_this_app_cannot_open() {
        let dir = tempfile::tempdir().unwrap();
        let app_dir = dir.path().join("app");
        std::fs::create_dir(&app_dir).unwrap();
        std::fs::write(app_dir.join("notecli.db"), b"current").unwrap();
        let src = dir.path().join("src.db");
        make_db(&src, false);
        rusqlite::Connection::open(&src)
            .unwrap()
            .execute(
                "UPDATE refinery_schema_history SET checksum = 'tampered' WHERE version = 1",
                [],
            )
            .unwrap();

        let err = replace_database_file(&app_dir, &src).unwrap_err();
        assert_eq!(err.code(), "DB_IMPORT_INCOMPATIBLE");
        assert_eq!(
            std::fs::read(app_dir.join("notecli.db")).unwrap(),
            b"current"
        );
    }

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
