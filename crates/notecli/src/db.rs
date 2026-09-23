use rusqlite::{params, Connection, OpenFlags};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use crate::error::NoteDeckError;
use crate::models::{
    Account, ChatMessage, ChatMessageReaction, ChatReactionUser, NormalizedNote, ServerDetection,
    TimelineKey,
};

mod embedded {
    use refinery::embed_migrations;
    embed_migrations!("migrations");
}

/// A row from the ogp_cache table, mapped to structured fields.
#[derive(Debug, Clone)]
pub struct SummaryRow {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub thumbnail: Option<String>,
    pub sitename: Option<String>,
    pub icon: Option<String>,
    pub player_url: Option<String>,
    pub player_width: Option<u32>,
    pub player_height: Option<u32>,
    pub player_allow: Option<String>,
    pub final_url: Option<String>,
    pub sensitive: bool,
    pub medias_json: Option<String>,
}

const PRAGMAS_WRITER: &str = "\
    PRAGMA journal_mode=WAL;\
    PRAGMA foreign_keys=ON;\
    PRAGMA synchronous=NORMAL;\
    PRAGMA busy_timeout=5000;\
    PRAGMA journal_size_limit=67108864;\
    PRAGMA mmap_size=268435456;\
    PRAGMA cache_size=-16000;\
    PRAGMA temp_store=MEMORY;";

const PRAGMAS_READER: &str = "\
    PRAGMA busy_timeout=5000;\
    PRAGMA mmap_size=268435456;\
    PRAGMA cache_size=-8000;\
    PRAGMA temp_store=MEMORY;";

/// 起動時の `incremental_vacuum` で 1 度に返却する free page の上限。
/// 大きすぎると起動が遅くなり、小さすぎると free page が溜まり続ける。
const INCREMENTAL_VACUUM_PAGES_PER_BOOT: i64 = 1000;

/// per-timeline トリムの 1 チャンク tx あたりの victim 上限。
/// 初回有効化 (1M 規模で百万行級の削除) が単一 tx だと writer lock を分オーダーで
/// 占有し WS ingest / 全コマンドが停止するため分割する。
const TRIM_CHUNK_ROWS: i64 = 50_000;

/// `notes_cache` の eviction policy。 デフォルトは「ほぼ永続保存」 — notedeck の
/// 「過去ノートを一瞬でローカル検索」という UX を尊重し、 暴走防止の hard cap
/// だけを残す。 アプリ側からユーザー設定で上書きできる。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct EvictionConfig {
    /// 各アカウントごとの note (entity) 上限。`None` なら無制限。
    pub per_account_limit: Option<i64>,
    /// `cached_at` の TTL (日)。`None` なら無期限保持。
    pub ttl_days: Option<i64>,
    /// バケット (account_id × timeline_key) ごとの所属行上限。`None` なら無制限。
    /// トリムは membership とその対象限定の orphan entity のみを消す。
    pub per_timeline_limit: Option<i64>,
}

impl Default for EvictionConfig {
    fn default() -> Self {
        // 検索 UX を最優先。 暴走防止のため per-account 1M 件で hard cap だけ残す。
        Self {
            per_account_limit: Some(1_000_000),
            ttl_days: None,
            per_timeline_limit: None,
        }
    }
}

/// `chat_messages_cache` の eviction policy。`EvictionConfig` (notes 用) と独立して
/// 制御できるよう別 struct で管理する。デフォルトは notes と同じ「per-account 1M 件
/// hard cap、TTL なし」(チャット履歴の永続性を尊重 — 設計判断は notedeck #460)。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ChatEvictionConfig {
    pub per_account_limit: Option<i64>,
    pub ttl_days: Option<i64>,
}

impl Default for ChatEvictionConfig {
    fn default() -> Self {
        Self {
            per_account_limit: Some(1_000_000),
            ttl_days: None,
        }
    }
}

/// SQLite database with separate reader/writer connections.
/// WAL mode allows concurrent reads while writing.
/// 走査を中断した位置。継続時はこの行より後ろから読み直す。
///
/// 「最後に**走査した**行」を指す。最後にマッチした行を指すと、その間にあった
/// マッチしない行を再開時にもう一度読むことになる。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedNoteCursor {
    pub created_at: String,
    pub note_id: String,
}

/// `scan_cached_notes` の結果。
#[derive(Debug, Clone, Default)]
pub struct CachedNoteScan {
    /// 述語が true を返したノート
    pub notes: Vec<NormalizedNote>,
    /// 実際に読んだ行数
    pub scanned: usize,
    /// 述語が判定できなかった行 + JSON として読めなかった行の数
    pub errors: usize,
    /// 走査上限で打ち切ったときの継続位置。読み切った場合は None
    pub cursor: Option<CachedNoteCursor>,
}

/// FTS5 の MATCH 文字列を組み立てる。リテラルは AND 結合し、`"` は doubling で
/// エスケープする。trigram が成立しない 3 文字未満は落とす (押し込むと 0 件に
/// なり偽陰性を生むため)。押し込めるものが無ければ None = FTS を使わない。
fn build_fts_match_query(literals: &[String]) -> Option<String> {
    let quoted: Vec<String> = literals
        .iter()
        .filter(|l| l.chars().count() >= 3)
        .map(|l| format!("\"{}\"", l.replace('"', "\"\"")))
        .collect();
    if quoted.is_empty() {
        None
    } else {
        Some(quoted.join(" AND "))
    }
}

pub struct Database {
    writer: Mutex<Connection>,
    reader: Mutex<Connection>,
}

/// キャッシュ横断検索の条件 (notedeck#945)。`Default` は「絞り込みなし」。
#[derive(Debug, Clone, Copy, Default)]
pub struct CachedSearchOptions<'a> {
    /// 本文の検索語。3 文字以上は FTS (trigram)、それ未満は LIKE、空なら全件
    pub query: &'a str,
    pub limit: i64,
    /// created_at の下限 / 上限 (ISO 8601、両端含む)
    pub since_date: Option<&'a str>,
    pub until_date: Option<&'a str>,
    /// true なら古い順
    pub ascending: bool,
    /// 投稿者 `name` または `name@host` (大文字小文字を区別しない)
    pub author: Option<&'a str>,
    /// Some(true) = 添付あり、Some(false) = 添付なし
    pub has_files: Option<bool>,
    /// true なら visibility が public のノートだけ (AI など第三者に見せる面用)
    pub public_only: bool,
}

impl Database {
    /// デフォルトの eviction policy で DB を開く。 後方互換性のために維持。
    pub fn open(path: &Path) -> Result<Self, NoteDeckError> {
        Self::open_with_eviction(path, EvictionConfig::default())
    }

    /// アプリ側のユーザー設定を反映した notes 用 eviction policy で DB を開く。
    /// `chat_messages_cache` 側はデフォルトで開く。後方互換のために維持。
    pub fn open_with_eviction(
        path: &Path,
        eviction: EvictionConfig,
    ) -> Result<Self, NoteDeckError> {
        Self::open_with_evictions(path, eviction, ChatEvictionConfig::default())
    }

    /// notes と chat の両方に独立した eviction policy を適用して DB を開く。
    /// 起動時の cleanup はこの設定で 1 度だけ走る。 アプリ実行中に設定を
    /// 変更した場合は `cleanup_with_eviction` / `cleanup_chat_with_eviction` で
    /// 再 cleanup できる。
    pub fn open_with_evictions(
        path: &Path,
        notes_eviction: EvictionConfig,
        chat_eviction: ChatEvictionConfig,
    ) -> Result<Self, NoteDeckError> {
        // Writer connection: migrations, schema changes, inserts/updates/deletes
        let mut writer = Connection::open(path)?;
        writer.execute_batch(PRAGMAS_WRITER)?;

        // DB は API トークンのフォールバック等の機微情報を含むため owner-only にする。
        // WAL/SHM は SQLite が本体と同じパーミッションで作るが、既存ファイルは
        // 直さないので明示的に締める (notedeck#785)
        Self::restrict_permissions(path);

        // auto_vacuum=INCREMENTAL を保証してから migration 走らせる。
        // auto_vacuum モード変更は VACUUM 後に有効化される SQLite の仕様なので、
        // 既存 DB の場合はここで一度だけ VACUUM が走る。
        Self::ensure_incremental_vacuum(&writer)?;

        // V6 (実体/所属分離) は既存 DB の全行リライトを伴い 1M 行で 1 分前後かかる。
        // 既定 EnvFilter=warn では info が出ず無言ハングに見えるため warn で告知する。
        let long_migration_pending = Self::schema_version(&writer).is_some_and(|v| v < 6);
        if long_migration_pending {
            tracing::warn!(
                "applying notes-cache schema migration (V6); this may take a minute \
                 and temporarily needs free disk up to ~2x the database size"
            );
        }
        let migration_started = std::time::Instant::now();

        // Run numbered migrations (V1, V2, ...)。
        // set_grouped(true) は必須: 既定 (grouped=false) では migration 本体と
        // schema_history 記録が別コミットになり、間で kill されると非冪等 SQL
        // (V2 の ADD COLUMN / V6 の DROP COLUMN) の再適用が失敗して DB が開けなくなる。
        embedded::migrations::runner()
            .set_grouped(true)
            .run(&mut writer)
            .map_err(|e| {
                NoteDeckError::Database(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
                    Some(format!("Migration failed: {e}")),
                ))
            })?;
        if long_migration_pending {
            tracing::warn!(
                elapsed_ms = migration_started.elapsed().as_millis() as u64,
                "notes-cache schema migration complete"
            );
        }

        // checkpoint#1: migration が膨らませた WAL を回収する (best-effort)。
        Self::wal_checkpoint_truncate(&writer);

        // One-time FTS rebuild for existing databases upgraded before FTS5 was added
        Self::rebuild_fts_if_needed(&writer)?;

        // Reader connection: SELECT queries only (separate lock from writer)
        let reader = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_NO_MUTEX
                | OpenFlags::SQLITE_OPEN_URI,
        )?;
        reader.execute_batch(PRAGMAS_READER)?;

        let db = Self {
            writer: Mutex::new(writer),
            reader: Mutex::new(reader),
        };
        db.cleanup_with_eviction(&notes_eviction)?;
        db.cleanup_chat_with_eviction(&chat_eviction)?;
        // cleanup で生まれた free page を少し返却する (起動コスト一定)。
        db.incremental_vacuum_step()?;
        {
            let conn = db.lock_write()?;
            // 空テーブルへの ANALYZE は stat1 を作らないため、新規 DB が成長した後の
            // stat1 生成 (idx_note_timelines_note を CASCADE に選ばせる必須要件) を
            // ここが担う。ANALYZE 済みなら実質 no-op。
            conn.execute_batch("PRAGMA optimize;")?;
            // checkpoint#2: cleanup / optimize / vacuum step の write を回収 (best-effort)。
            Self::wal_checkpoint_truncate(&conn);
        }
        Ok(db)
    }

    /// refinery_schema_history の最新 version。テーブルが無い (新規 DB) なら None。
    fn schema_version(conn: &Connection) -> Option<i64> {
        conn.query_row(
            "SELECT MAX(version) FROM refinery_schema_history",
            [],
            |row| row.get::<_, Option<i64>>(0),
        )
        .ok()
        .flatten()
    }

    /// `PRAGMA wal_checkpoint(TRUNCATE)` を best-effort で実行する。
    /// 他プロセスの active reader/writer がいると busy=1 の結果行を返して
    /// エラーなく劣化する (frame copy は完了、truncate のみ持ち越し)。
    /// 恒久残留の防止は毎起動の再試行が実体。
    fn wal_checkpoint_truncate(conn: &Connection) {
        match conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        }) {
            Ok((busy, log, checkpointed)) if busy != 0 => {
                tracing::debug!(
                    log,
                    checkpointed,
                    "wal_checkpoint(TRUNCATE) busy; truncate deferred"
                );
            }
            Ok(_) => {}
            Err(e) => tracing::debug!(error = %e, "wal_checkpoint(TRUNCATE) failed"),
        }
    }

    /// DB 本体と WAL/SHM を owner-only (0600) に締める。失敗しても DB は開ける
    /// (パーミッションより可用性を優先し、エラーは握りつぶす)。
    #[cfg(unix)]
    fn restrict_permissions(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        for suffix in ["", "-wal", "-shm"] {
            let target = if suffix.is_empty() {
                path.to_path_buf()
            } else {
                let mut os = path.as_os_str().to_owned();
                os.push(suffix);
                std::path::PathBuf::from(os)
            };
            if let Ok(meta) = std::fs::metadata(&target) {
                let mut perms = meta.permissions();
                if perms.mode() & 0o077 != 0 {
                    perms.set_mode(0o600);
                    let _ = std::fs::set_permissions(&target, perms);
                }
            }
        }
    }

    #[cfg(not(unix))]
    fn restrict_permissions(_path: &Path) {}

    /// `auto_vacuum=INCREMENTAL` を保証する。SQLite では `auto_vacuum` モード変更は
    /// VACUUM 後にしか有効化されない仕様のため、必要なら 1 度だけ VACUUM を走らせる。
    /// 新規 DB なら最初の `PRAGMA auto_vacuum` 実行で適用済みとなり VACUUM は走らない。
    fn ensure_incremental_vacuum(conn: &Connection) -> Result<(), NoteDeckError> {
        // 0 = NONE, 1 = FULL, 2 = INCREMENTAL
        let current: i64 = conn.query_row("PRAGMA auto_vacuum", [], |row| row.get(0))?;
        if current != 2 {
            conn.execute_batch("PRAGMA auto_vacuum=INCREMENTAL;")?;
            // Fresh DB なら以降の write でモードが固定される。既存 DB の場合は
            // VACUUM 必須 (高コストだが起動 1 回限りの one-shot)。
            conn.execute_batch("VACUUM;")?;
        }
        Ok(())
    }

    fn lock_read(&self) -> Result<MutexGuard<'_, Connection>, NoteDeckError> {
        self.reader.lock().map_err(|_| {
            NoteDeckError::Database(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_LOCKED),
                Some("Reader lock poisoned".to_string()),
            ))
        })
    }

    fn lock_write(&self) -> Result<MutexGuard<'_, Connection>, NoteDeckError> {
        self.writer.lock().map_err(|_| {
            NoteDeckError::Database(rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_LOCKED),
                Some("Writer lock poisoned".to_string()),
            ))
        })
    }

    /// Alias for lock_write — used by tests that need direct connection access.
    #[cfg(test)]
    fn lock(&self) -> Result<MutexGuard<'_, Connection>, NoteDeckError> {
        self.lock_write()
    }

    /// Populate FTS index from existing data if empty (one-time upgrade path).
    fn rebuild_fts_if_needed(conn: &Connection) -> Result<(), NoteDeckError> {
        let needs_rebuild: bool = conn.query_row(
            "SELECT (SELECT COUNT(*) FROM notes_fts) = 0
                AND (SELECT COUNT(*) FROM notes_cache WHERE text IS NOT NULL) > 0",
            [],
            |row| row.get(0),
        )?;
        if needs_rebuild {
            conn.execute_batch("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')")?;
        }
        Ok(())
    }

    // --- Accounts ---

    fn row_to_account(row: &rusqlite::Row) -> rusqlite::Result<Account> {
        Ok(Account {
            id: row.get(0)?,
            host: row.get(1)?,
            token: row.get(2)?,
            user_id: row.get(3)?,
            username: row.get(4)?,
            display_name: row.get(5)?,
            avatar_url: row.get(6)?,
            software: row.get(7)?,
        })
    }

    pub fn load_accounts(&self) -> Result<Vec<Account>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT id, host, token, user_id, username, display_name, avatar_url, software FROM accounts ORDER BY rowid",
        )?;
        let rows = stmt.query_map([], Self::row_to_account)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn upsert_account(&self, account: &Account) -> Result<(), NoteDeckError> {
        let conn = self.lock_write()?;
        conn.execute(
            "INSERT INTO accounts (id, host, token, user_id, username, display_name, avatar_url, software)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(host, user_id) DO UPDATE SET
                 token = excluded.token,
                 username = excluded.username,
                 display_name = excluded.display_name,
                 avatar_url = excluded.avatar_url,
                 software = excluded.software",
            params![
                account.id,
                account.host,
                account.token,
                account.user_id,
                account.username,
                account.display_name,
                account.avatar_url,
                account.software,
            ],
        )?;
        Ok(())
    }

    pub fn get_account(&self, id: &str) -> Result<Option<Account>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT id, host, token, user_id, username, display_name, avatar_url, software FROM accounts WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(params![id], Self::row_to_account)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn get_account_by_host(&self, host: &str) -> Result<Option<Account>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT id, host, token, user_id, username, display_name, avatar_url, software FROM accounts WHERE host = ?1 LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![host], Self::row_to_account)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    pub fn get_account_by_host_user(
        &self,
        host: &str,
        user_id: &str,
    ) -> Result<Option<Account>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT id, host, token, user_id, username, display_name, avatar_url, software FROM accounts WHERE host = ?1 AND user_id = ?2",
        )?;
        let mut rows = stmt.query_map(params![host, user_id], Self::row_to_account)?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// Clear the token column in DB (after migration to keychain)
    pub fn clear_token(&self, id: &str) -> Result<(), NoteDeckError> {
        let conn = self.lock_write()?;
        conn.execute("UPDATE accounts SET token = '' WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn delete_account(&self, id: &str) -> Result<(), NoteDeckError> {
        let conn = self.lock_write()?;
        let tx = conn.unchecked_transaction()?;
        // membership を先に一括 DELETE してから entity を消す (行単位 CASCADE +
        // FTS トリガの遅い経路を回避 — clear_account_cache と同じ理由)。
        tx.execute(
            "DELETE FROM note_timelines WHERE account_id = ?1",
            params![id],
        )?;
        tx.execute("DELETE FROM notes_cache WHERE account_id = ?1", params![id])?;
        tx.execute(
            "DELETE FROM chat_messages_cache WHERE account_id = ?1",
            params![id],
        )?;
        tx.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(())
    }

    // --- Cache management ---

    /// Delete all cached notes for a specific account.
    pub fn clear_account_cache(&self, account_id: &str) -> Result<u64, NoteDeckError> {
        let conn = self.lock_write()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM note_timelines WHERE account_id = ?1",
            params![account_id],
        )?;
        let deleted = tx.execute(
            "DELETE FROM notes_cache WHERE account_id = ?1",
            params![account_id],
        )?;
        tx.commit()?;
        Ok(deleted as u64)
    }

    /// Delete all cached notes for every account.
    pub fn clear_all_notes_cache(&self) -> Result<u64, NoteDeckError> {
        let conn = self.lock_write()?;
        let tx = conn.unchecked_transaction()?;
        tx.execute("DELETE FROM note_timelines", [])?;
        let deleted = tx.execute("DELETE FROM notes_cache", [])?;
        tx.commit()?;
        Ok(deleted as u64)
    }

    /// Delete all OGP cache entries (regardless of TTL).
    pub fn clear_ogp_cache(&self) -> Result<u64, NoteDeckError> {
        let conn = self.lock_write()?;
        let deleted = conn.execute("DELETE FROM ogp_cache", [])?;
        Ok(deleted as u64)
    }

    /// Return note count for a specific account.
    pub fn account_cache_count(&self, account_id: &str) -> Result<i64, NoteDeckError> {
        let conn = self.lock_read()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes_cache WHERE account_id = ?1",
            params![account_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    // --- Server detections ---

    pub fn load_server_detections(&self) -> Result<Vec<ServerDetection>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT host, software_name, software_version, software_repository, meta_json, updated_at FROM server_detections",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ServerDetection {
                host: row.get(0)?,
                software_name: row.get(1)?,
                software_version: row.get(2)?,
                software_repository: row.get(3)?,
                meta_json: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_server_detection(
        &self,
        host: &str,
    ) -> Result<Option<ServerDetection>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT host, software_name, software_version, software_repository, meta_json, updated_at FROM server_detections WHERE host = ?1",
        )?;
        let mut rows = stmt.query_map(params![host], |row| {
            Ok(ServerDetection {
                host: row.get(0)?,
                software_name: row.get(1)?,
                software_version: row.get(2)?,
                software_repository: row.get(3)?,
                meta_json: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    // --- Notes cache ---

    /// 唯一の書込経路。entity upsert + membership upsert を単一 tx で行う。
    ///
    /// - entity: `ON CONFLICT DO UPDATE` (text / note_json / cached_at / uri)。
    ///   新旧判定は持たない last-writer-wins (WS/polling の fire-and-forget により
    ///   DB 到達順は無保証 — 現行同等)。
    /// - membership: `ON CONFLICT DO NOTHING` (added_at は初回値維持)。
    /// - sort_key は常に `note.created_at` (サーバー由来文字列をそのまま) を書く。
    /// - account_id は各 note の `NormalizedNote.account_id` から取る (混在配列も
    ///   per-note に正しく処理)。
    pub fn ingest_notes(
        &self,
        notes: &[NormalizedNote],
        key: &TimelineKey,
    ) -> Result<(), NoteDeckError> {
        let canonical = key.as_canonical();
        let conn = self.lock_write()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let tx = conn.unchecked_transaction()?;
        {
            let mut entity_stmt = tx.prepare_cached(
                "INSERT INTO notes_cache (note_id, account_id, server_host, created_at, text, note_json, cached_at, uri, identity)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(note_id, account_id) DO UPDATE SET
                     text = excluded.text,
                     note_json = excluded.note_json,
                     cached_at = excluded.cached_at,
                     uri = excluded.uri,
                     identity = excluded.identity",
            )?;
            let mut membership_stmt = tx.prepare_cached(
                "INSERT INTO note_timelines (account_id, timeline_key, note_id, sort_key, added_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(account_id, timeline_key, note_id) DO NOTHING",
            )?;
            for note in notes {
                let json = serde_json::to_string(note).unwrap_or_default();
                // identity は normalize 済みなら埋まっている。旧 JSON 由来の
                // 空値でも列だけは必ず埋める (backfill 待ちにしない)
                let identity = if note.identity.is_empty() {
                    crate::identity::identity_of(note.uri.as_deref(), &note.server_host, &note.id)
                } else {
                    note.identity.clone()
                };
                entity_stmt.execute(params![
                    note.id,
                    note.account_id,
                    note.server_host,
                    note.created_at,
                    note.text,
                    json,
                    now,
                    note.uri,
                    identity,
                ])?;
                membership_stmt.execute(params![
                    note.account_id,
                    canonical,
                    note.id,
                    note.created_at,
                    now,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// バケットから 1 ノートの所属を外す。当該バケットにのみ所属する entity は
    /// 同一 tx で掃除する (CASCADE が membership を道連れにする)。
    ///
    /// 戻り値は「対象 note の membership が実在し削除されたか」の件数 (0 or 1)。
    /// entity 先行 CASCADE の場合も 1 と数える。
    pub fn remove_membership(
        &self,
        account_id: &str,
        key: &TimelineKey,
        note_id: &str,
    ) -> Result<u64, NoteDeckError> {
        let canonical = key.as_canonical();
        let conn = self.lock_write()?;
        let tx = conn.unchecked_transaction()?;
        // 逆順 2 文: ①当該バケットにのみ所属する entity を先に DELETE (CASCADE が
        // membership を道連れ)。述語は EXISTS(当該バケット) ∧ NOT EXISTS(他バケット)
        // — EXISTS を欠くと membership ゼロの orphan entity を巻き添え削除して
        // 件数意味論が破れる。
        let entity_deleted = tx.execute(
            "DELETE FROM notes_cache
             WHERE note_id = ?3 AND account_id = ?1
               AND EXISTS (SELECT 1 FROM note_timelines m
                           WHERE m.account_id = ?1 AND m.timeline_key = ?2 AND m.note_id = ?3)
               AND NOT EXISTS (SELECT 1 FROM note_timelines m
                               WHERE m.note_id = ?3 AND m.account_id = ?1
                                 AND m.timeline_key <> ?2)",
            params![account_id, canonical, note_id],
        )?;
        // ②残 membership DELETE (①が発火した場合は CASCADE 済みで 0 行)
        let membership_deleted = tx.execute(
            "DELETE FROM note_timelines
             WHERE account_id = ?1 AND timeline_key = ?2 AND note_id = ?3",
            params![account_id, canonical, note_id],
        )?;
        tx.commit()?;
        Ok((entity_deleted + membership_deleted) as u64)
    }

    /// バケットを丸ごと破棄する (次回フェッチで再構築される)。
    /// 当該バケットにのみ所属する entity は同一 tx で掃除する。
    ///
    /// 戻り値は削除した membership 行数 (対象限定掃除で消えた entity は数えない —
    /// ①の entity 1 件は CASCADE でちょうど 1 membership を道連れにするため
    /// ①+② が membership 総数になる)。
    pub fn clear_timeline(
        &self,
        account_id: &str,
        key: &TimelineKey,
    ) -> Result<u64, NoteDeckError> {
        let canonical = key.as_canonical();
        let conn = self.lock_write()?;
        let tx = conn.unchecked_transaction()?;
        let entity_deleted = tx.execute(
            "DELETE FROM notes_cache
             WHERE (note_id, account_id) IN (
                 SELECT m.note_id, m.account_id FROM note_timelines m
                 WHERE m.account_id = ?1 AND m.timeline_key = ?2
                   AND NOT EXISTS (SELECT 1 FROM note_timelines o
                                   WHERE o.note_id = m.note_id AND o.account_id = m.account_id
                                     AND o.timeline_key <> ?2))",
            params![account_id, canonical],
        )?;
        let membership_deleted = tx.execute(
            "DELETE FROM note_timelines WHERE account_id = ?1 AND timeline_key = ?2",
            params![account_id, canonical],
        )?;
        tx.commit()?;
        Ok((entity_deleted + membership_deleted) as u64)
    }

    /// どのバケットにも所属しない entity を掃除する (修復用の手動 API。自動実行なし)。
    /// 戻り値は削除した entity 行数。
    pub fn sweep_orphan_notes(&self) -> Result<u64, NoteDeckError> {
        let conn = self.lock_write()?;
        let deleted = conn.execute(
            "DELETE FROM notes_cache
             WHERE NOT EXISTS (SELECT 1 FROM note_timelines m
                               WHERE m.note_id = notes_cache.note_id
                                 AND m.account_id = notes_cache.account_id)",
            [],
        )?;
        Ok(deleted as u64)
    }

    /// notes_cache の note_json を NormalizedNote に戻す。スキーマ世代差・破損行は None。
    /// identity 系フィールド (`_identity` / `_isOrigin` / `_identityTrusted`) は
    /// 旧 JSON に無いので常に再計算して補う (決定的なので既存値と同値になる)。
    /// 5 つの読み出し経路すべてがここを通る (述語評価より前に補うため)。
    fn parse_cached_note(json: &str) -> Option<NormalizedNote> {
        let mut note = serde_json::from_str::<NormalizedNote>(json).ok()?;
        note.fill_identity();
        Some(note)
    }

    /// Find cached notes by ActivityPub URI across all accounts.
    /// Uses the partial index on `uri` for fast lookups.
    pub fn find_notes_by_uri(&self, uri: &str) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached("SELECT note_json FROM notes_cache WHERE uri = ?1")?;
        let rows = stmt.query_map(params![uri], |row| {
            let json: String = row.get(0)?;
            Ok(json)
        })?;
        let mut notes = Vec::new();
        for row in rows {
            let json = row?;
            if let Some(note) = Self::parse_cached_note(&json) {
                notes.push(note);
            }
        }
        Ok(notes)
    }

    /// identity (正規化 AP object id) でキャッシュを account 横断で引く (notedeck#1058)。
    /// 引数は生の URI でもよい (同じ規則で正規化する)。backfill 完了前の行
    /// (identity = '') は uri 列でフォールバックする。ローカル行と Renote の
    /// `/activity` 行は backfill 完了まで拾えない (短い過渡)。
    pub fn find_notes_by_identity(
        &self,
        uri_or_identity: &str,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let identity = crate::identity::identity_of(Some(uri_or_identity), "", "");
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT note_json FROM notes_cache WHERE identity = ?1 OR (identity = '' AND uri = ?1)",
        )?;
        let rows = stmt.query_map(params![identity], |row| row.get::<_, String>(0))?;
        let mut notes = Vec::new();
        for row in rows {
            if let Some(note) = Self::parse_cached_note(&row?) {
                notes.push(note);
            }
        }
        Ok(notes)
    }

    /// V7 で追加した identity 列の backfill を 1 チャンク進める。戻り値は更新行数で、
    /// 0 なら完了。identity は列 (uri / server_host / note_id) だけから導出できるので
    /// JSON parse は要らない。1 チャンク = 1 tx で writer ロックを短く持つ
    /// (WS 取り込みを止めない)。upsert とは同じロックで直列化され値は決定的なので
    /// 競合しない。
    pub fn backfill_identity_chunk(&self, chunk: usize) -> Result<u64, NoteDeckError> {
        let conn = self.lock_write()?;
        let tx = conn.unchecked_transaction()?;
        let rows: Vec<(i64, String, String, Option<String>)> = {
            let mut stmt = tx.prepare_cached(
                "SELECT rowid, note_id, server_host, uri FROM notes_cache WHERE identity = '' LIMIT ?1",
            )?;
            let mapped = stmt.query_map(params![chunk as i64], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?;
            mapped.collect::<rusqlite::Result<_>>()?
        };
        {
            let mut upd =
                tx.prepare_cached("UPDATE notes_cache SET identity = ?1 WHERE rowid = ?2")?;
            for (rowid, note_id, server_host, uri) in &rows {
                let identity = crate::identity::identity_of(uri.as_deref(), server_host, note_id);
                upd.execute(params![identity, rowid])?;
            }
        }
        tx.commit()?;
        Ok(rows.len() as u64)
    }

    pub fn search_cached_notes(
        &self,
        account_id: &str,
        query: &str,
        limit: i64,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        self.search_cached_notes_advanced(account_id, query, limit, None, None, false)
    }

    pub fn search_cached_notes_advanced(
        &self,
        account_id: &str,
        query: &str,
        limit: i64,
        since_date: Option<&str>,
        until_date: Option<&str>,
        ascending: bool,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        self.search_cached_notes_across(
            &[account_id],
            &CachedSearchOptions {
                query,
                limit,
                since_date,
                until_date,
                ascending,
                ..Default::default()
            },
        )
    }

    /// 複数アカウントを横断して検索する (notedeck#945 / #1058)。結果は variant
    /// (アカウントごとの行) のまま返し、同一ノートの束ねは呼び出し側で行う。
    /// `account_ids` が空なら空を返す。
    pub fn search_cached_notes_across(
        &self,
        account_ids: &[&str],
        opts: &CachedSearchOptions<'_>,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        if account_ids.is_empty() {
            return Ok(Vec::new());
        }
        let CachedSearchOptions {
            query,
            limit,
            since_date,
            until_date,
            ascending,
            author,
            has_files,
            public_only,
        } = *opts;
        let conn = self.lock_read()?;
        let order = if ascending { "ASC" } else { "DESC" };
        let has_query = !query.is_empty();

        let account_placeholders = (1..=account_ids.len())
            .map(|i| format!("?{i}"))
            .collect::<Vec<_>>()
            .join(", ");
        let mut conditions = vec![format!("nc.account_id IN ({account_placeholders})")];
        let mut param_idx = account_ids.len() as u32 + 1;

        let fts_query;
        let like_pattern;
        let use_fts = has_query && query.chars().count() >= 3;
        let use_like = has_query && !use_fts;

        if use_fts {
            let escaped = query.replace('"', "\"\"");
            fts_query = format!("\"{escaped}\"");
            conditions.push(format!(
                "nc.rowid IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?{param_idx})"
            ));
            param_idx += 1;
        } else {
            fts_query = String::new();
        }
        if use_like {
            like_pattern = format!("%{query}%");
            conditions.push(format!("nc.text LIKE ?{param_idx}"));
            param_idx += 1;
        } else {
            like_pattern = String::new();
        }

        if since_date.is_some() {
            conditions.push(format!("nc.created_at >= ?{param_idx}"));
            param_idx += 1;
        }
        if until_date.is_some() {
            conditions.push(format!("nc.created_at <= ?{param_idx}"));
            param_idx += 1;
        }

        // 投稿者: `name` または `name@host`。host 省略時は取得元サーバーを問わず
        // username だけで一致させる。ローカルユーザーは user.host が null なので、
        // host 指定時は取得元 (server_host) で補う
        let author_parts = author.map(|a| {
            let a = a.trim().trim_start_matches('@');
            match a.split_once('@') {
                Some((name, host)) => (name.to_lowercase(), Some(host.to_lowercase())),
                None => (a.to_lowercase(), None),
            }
        });
        if let Some((_, host)) = &author_parts {
            conditions.push(format!(
                "LOWER(json_extract(nc.note_json, '$.user.username')) = ?{param_idx}"
            ));
            param_idx += 1;
            if host.is_some() {
                conditions.push(format!(
                    "LOWER(COALESCE(json_extract(nc.note_json, '$.user.host'), nc.server_host)) = ?{param_idx}"
                ));
                param_idx += 1;
            }
        }
        if let Some(with_files) = has_files {
            conditions.push(if with_files {
                "json_array_length(nc.note_json, '$.files') > 0".to_string()
            } else {
                "json_array_length(nc.note_json, '$.files') = 0".to_string()
            });
        }
        if public_only {
            conditions.push("json_extract(nc.note_json, '$.visibility') = 'public'".to_string());
        }

        let sql = format!(
            "SELECT nc.note_json FROM notes_cache nc WHERE {} ORDER BY nc.created_at {order} LIMIT ?{param_idx}",
            conditions.join(" AND "),
        );

        let mut stmt = conn.prepare(&sql)?;

        let mut dynamic_params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        for id in account_ids {
            dynamic_params.push(Box::new(id.to_string()));
        }
        if use_fts {
            dynamic_params.push(Box::new(fts_query));
        }
        if use_like {
            dynamic_params.push(Box::new(like_pattern));
        }
        if let Some(d) = since_date {
            dynamic_params.push(Box::new(d.to_string()));
        }
        if let Some(d) = until_date {
            dynamic_params.push(Box::new(d.to_string()));
        }
        if let Some((name, host)) = author_parts {
            dynamic_params.push(Box::new(name));
            if let Some(host) = host {
                dynamic_params.push(Box::new(host));
            }
        }
        dynamic_params.push(Box::new(limit));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            dynamic_params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let json_str: String = row.get(0)?;
                Ok(json_str)
            })?
            .filter_map(|r| r.ok())
            .collect::<Vec<String>>();

        Ok(rows
            .into_iter()
            .filter_map(|json_str| Self::parse_cached_note(&json_str))
            .collect())
    }

    /// キャッシュ済みノートを走査し、呼び出し側の述語で絞り込む。
    ///
    /// クエリ機能 (notedeck の カラムクエリ #783) のように、判定ロジックが
    /// 呼び出し側にしかない検索のための API。この層は「FTS で粗く絞って行を
    /// 読み、述語に渡す」だけで、述語の意味論には関与しない。
    ///
    /// - `scope`: `Some(key)` なら当該バケット (note_timelines の所属) に
    ///   限定して走査する。カラムのタイムライン種別で正しく絞れる —
    ///   実体/所属分離 (issue #30) 以前は所属が後勝ち上書きで母集合を
    ///   保証できなかったため全体走査しかなかった。`None` は従来どおり
    ///   アカウントの全キャッシュを走査する
    /// - `fts_literals`: FTS5 に押し込むリテラル群 (AND 結合)。空なら全件走査。
    ///   偽陰性を避けるため、trigram が成立しない 3 文字未満は無視する
    /// - `limit`: 返すノートの上限
    /// - `max_scanned_rows`: 走査する行数の上限。到達したら打ち切って
    ///   継続カーソルを返す (巨大キャッシュで応答が返らなくなるのを防ぐ)
    /// - `pred`: `None` を返すと per-note エラーとして除外し件数に計上する
    ///
    /// カーソルの互換性: scope あり走査は membership の `(sort_key, note_id)` を
    /// キーに進むが、sort_key = note.created_at (§3) のため `CachedNoteCursor`
    /// の形・意味は scope なし走査と同一。ただしカーソルは同じ scope の
    /// 続き読みにのみ使うこと (scope を跨ぐと順序前提が崩れる)。
    ///
    /// DB ロックはチャンク単位で取り直す。述語の評価はロックの外で行うので、
    /// 重い述語が他の DB 利用者を待たせない。
    // 走査の絞り (scope/fts/cursor) と上限 (limit/max_scanned_rows) は独立に
    // 意味を持つ引数で、束ねる struct を作るほどの呼び出し面がない
    #[allow(clippy::too_many_arguments)]
    pub fn scan_cached_notes<F>(
        &self,
        account_id: &str,
        scope: Option<&TimelineKey>,
        fts_literals: &[String],
        limit: usize,
        max_scanned_rows: usize,
        after: Option<&CachedNoteCursor>,
        mut pred: F,
    ) -> Result<CachedNoteScan, NoteDeckError>
    where
        F: FnMut(&NormalizedNote) -> Option<bool>,
    {
        /// 1 度のロックで読む行数
        const CHUNK: usize = 200;

        let mut out = CachedNoteScan::default();
        if limit == 0 || max_scanned_rows == 0 {
            return Ok(out);
        }

        // trigram が成立しない短いリテラルを押し込むと 0 件になり偽陰性になる。
        // 呼び出し側で弾く約束だが、影響が致命的なのでここでも落とす
        let match_query = build_fts_match_query(fts_literals);

        let mut cursor = after.cloned();
        let mut exhausted = false;

        while out.notes.len() < limit && out.scanned < max_scanned_rows {
            let take = CHUNK.min(max_scanned_rows - out.scanned);
            let rows =
                self.fetch_scan_chunk(account_id, scope, match_query.as_deref(), &cursor, take)?;
            if rows.is_empty() {
                exhausted = true;
                break;
            }
            let fetched = rows.len();
            let mut hit_limit = false;
            for (note_id, created_at, json) in rows {
                out.scanned += 1;
                cursor = Some(CachedNoteCursor {
                    created_at,
                    note_id,
                });
                match Self::parse_cached_note(&json) {
                    Some(note) => match pred(&note) {
                        Some(true) => {
                            out.notes.push(note);
                            if out.notes.len() >= limit {
                                hit_limit = true;
                                break;
                            }
                        }
                        Some(false) => {}
                        // 述語が判定できなかった (型エラー等)
                        None => out.errors += 1,
                    },
                    // スキーマ世代差・破損行も per-note エラーとして扱う
                    None => out.errors += 1,
                }
            }
            // limit で止めた場合はこのチャンクを読み切っていないので、
            // 「読み切った」判定に落とさずカーソルを残す
            if hit_limit {
                break;
            }
            if fetched < take {
                exhausted = true;
                break;
            }
        }

        out.cursor = if exhausted { None } else { cursor };
        Ok(out)
    }

    /// 走査の 1 チャンクを読む。ロックはこの関数の中だけで保持する。
    ///
    /// scope あり: membership を `idx_note_timelines_order` の seek で辿り
    /// entity を PK lookup する (sort_key = created_at のためタプルの形は
    /// scope なしと同一)。scope なし: 従来どおり entity を
    /// `idx_notes_cache_timeline` (account_id, created_at DESC) で走査する。
    fn fetch_scan_chunk(
        &self,
        account_id: &str,
        scope: Option<&TimelineKey>,
        match_query: Option<&str>,
        cursor: &Option<CachedNoteCursor>,
        take: usize,
    ) -> Result<Vec<(String, String, String)>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut conditions = vec!["nc.account_id = ?1".to_string()];
        let mut idx = 2u32;
        let scoped = scope.is_some();
        let (from_clause, sort_col, id_col) = if scoped {
            conditions.push(format!("m.timeline_key = ?{idx}"));
            idx += 1;
            (
                "note_timelines m JOIN notes_cache nc \
                 ON nc.note_id = m.note_id AND nc.account_id = m.account_id",
                "m.sort_key",
                "m.note_id",
            )
        } else {
            ("notes_cache nc", "nc.created_at", "nc.note_id")
        };
        // scoped 側の account 条件も membership を駆動させる
        if scoped {
            conditions[0] = "m.account_id = ?1".to_string();
        }
        if match_query.is_some() {
            conditions.push(format!(
                "nc.rowid IN (SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?{idx})"
            ));
            idx += 1;
        }
        if cursor.is_some() {
            // created_at (= sort_key) の同値で分かれても順序が定まるよう
            // note_id を副キーにする
            conditions.push(format!(
                "({sort_col} < ?{idx} OR ({sort_col} = ?{idx} AND {id_col} < ?{}))",
                idx + 1
            ));
            idx += 2;
        }
        let sql = format!(
            "SELECT {id_col}, {sort_col}, nc.note_json FROM {from_clause} WHERE {} \
             ORDER BY {sort_col} DESC, {id_col} DESC LIMIT ?{idx}",
            conditions.join(" AND "),
        );

        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        params.push(Box::new(account_id.to_string()));
        if let Some(key) = scope {
            params.push(Box::new(key.as_canonical()));
        }
        if let Some(q) = match_query {
            params.push(Box::new(q.to_string()));
        }
        if let Some(c) = cursor {
            params.push(Box::new(c.created_at.clone()));
            params.push(Box::new(c.note_id.clone()));
        }
        params.push(Box::new(take as i64));

        let refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare_cached(&sql)?;
        let rows = stmt
            .query_map(refs.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        Ok(rows)
    }

    /// バケットの最新 `limit` 件を返す。membership を index seek → entity を PK lookup。
    /// limit は membership 行数に適用し、note_json parse 失敗行は skip (返却 < limit 許容)。
    pub fn get_cached_timeline(
        &self,
        account_id: &str,
        key: &TimelineKey,
        limit: i64,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT e.note_json FROM note_timelines m
             JOIN notes_cache e ON e.note_id = m.note_id AND e.account_id = m.account_id
             WHERE m.account_id = ?1 AND m.timeline_key = ?2
             ORDER BY m.sort_key DESC, m.note_id DESC
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![account_id, key.as_canonical(), limit], |row| {
            let json_str: String = row.get(0)?;
            Ok(json_str)
        })?;
        let mut notes = Vec::new();
        for row in rows {
            let json_str = row?;
            if let Some(note) = Self::parse_cached_note(&json_str) {
                notes.push(note);
            }
        }
        Ok(notes)
    }

    /// `notes_cache` の eviction を `EvictionConfig::default()` で実行する。
    /// 後方互換性のために維持。 アプリ側はユーザー設定を反映するため
    /// `cleanup_with_eviction` を直接呼ぶ。
    pub fn cleanup_cache(&self) -> Result<u64, NoteDeckError> {
        self.cleanup_with_eviction(&EvictionConfig::default())
    }

    /// 設定を渡して eviction を実行する。 `None` のフィールドは「制限なし」と
    /// して該当する DELETE をスキップする。 アプリ実行中に設定を変えた直後にも
    /// 呼ぶ想定 (UI から「すぐ反映」 ボタン等)。
    ///
    /// 削除順 (①③は単一 tx、②はチャンク分割 tx):
    /// 1. **TTL**: `cached_at < now - ttl_days` の entity を削除 → CASCADE で所属連動。
    /// 2. **Per-timeline トリム**: バケットごとに上位 `per_timeline_limit` 件を残し
    ///    membership を削除。当該 victim のうちどのバケットにも所属しなくなった
    ///    entity は同一チャンク tx 内で掃除する。Favorites/Clip バケットは
    ///    added_at 降順 (= 初回ローカル取得時刻。サーバー上の追加時刻とは一致しない
    ///    既知の制限)、他は sort_key 降順で残す。
    ///    初回有効化は 1M 規模で分オーダーの削除になり得るため、victim を
    ///    `TRIM_CHUNK_ROWS` 行ずつのチャンク tx に分割する (中断しても各チャンクは
    ///    一貫状態で orphan を生まない — 未処理 victim は membership が残るため
    ///    次回 cleanup が再計算して続きから削る)。
    /// 3. **Per-account hard cap**: アカウントごとに `cached_at` 降順で
    ///    `per_account_limit` 件を残し entity を削除 → CASCADE で所属連動。
    ///
    /// 戻り値は削除した entity + membership の総行数。`notes_fts` は
    /// `AFTER DELETE` トリガーで連動掃除される。
    pub fn cleanup_with_eviction(&self, config: &EvictionConfig) -> Result<u64, NoteDeckError> {
        // 全フィールド無効なら早期 return (lock も取らない)。
        // per_timeline_limit を含む 3 フィールド判定であること (2 フィールド判定だと
        // per-timeline のみ設定時にトリムが走らない)。
        if config.per_account_limit.is_none()
            && config.ttl_days.is_none()
            && config.per_timeline_limit.is_none()
        {
            return Ok(0);
        }

        let mut total_deleted: u64 = 0;

        // writer lock はフェーズ単位で取り直す。②のチャンク分割は tx だけでなく
        // Mutex も手放さないと意味がない (握ったままだと ingest_notes 等の
        // lock_write 呼び出しがトリム完走まで待たされる)。
        // ① TTL (単一 tx)
        if let Some(ttl_days) = config.ttl_days {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let ttl_cutoff = now - ttl_days * 86_400;
            let conn = self.lock_write()?;
            let tx = conn.unchecked_transaction()?;
            let n = tx.execute(
                "DELETE FROM notes_cache WHERE cached_at < ?1",
                params![ttl_cutoff],
            )?;
            tx.commit()?;
            total_deleted += n as u64;
        }

        // ② per-timeline トリム (チャンクごとに lock + tx)
        if let Some(per_timeline_limit) = config.per_timeline_limit {
            total_deleted += self.trim_timelines_chunked(per_timeline_limit)?;
        }

        // ③ per-account hard cap (単一 tx)
        if let Some(per_account_limit) = config.per_account_limit {
            let conn = self.lock_write()?;
            let tx = conn.unchecked_transaction()?;
            // SQLite 3.25+ の window function で 1 クエリで評価。
            let n = tx.execute(
                "DELETE FROM notes_cache
                 WHERE rowid IN (
                     SELECT rowid FROM (
                         SELECT rowid,
                                ROW_NUMBER() OVER (
                                    PARTITION BY account_id
                                    ORDER BY cached_at DESC
                                ) AS rn
                         FROM notes_cache
                     )
                     WHERE rn > ?1
                 )",
                params![per_account_limit],
            )?;
            tx.commit()?;
            total_deleted += n as u64;
        }

        Ok(total_deleted)
    }

    /// per-timeline トリムの実体。victim (バケット上限超過の membership) を
    /// チャンクごとの tx で削除し、victim のうち所属ゼロになった entity を
    /// 同一 tx で掃除する。戻り値は削除した membership + entity の総行数。
    fn trim_timelines_chunked(&self, per_timeline_limit: i64) -> Result<u64, NoteDeckError> {
        let mut total: u64 = 0;
        loop {
            // チャンクごとに writer lock を取り直す。ここで Mutex を手放すことで
            // WS ingest や他コマンドの書込がトリムの合間に割り込める
            // (握りっぱなしだと 1M 行規模で分オーダーの停止になる)。
            let conn = self.lock_write()?;
            let tx = conn.unchecked_transaction()?;
            tx.execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS trim_victims (
                     account_id TEXT NOT NULL,
                     timeline_key TEXT NOT NULL,
                     note_id TEXT NOT NULL,
                     PRIMARY KEY (account_id, timeline_key, note_id)
                 ) WITHOUT ROWID;
                 DELETE FROM trim_victims;",
            )?;
            // 残す順: Favorites/Clip は added_at 降順、他は sort_key 降順。
            // チャンクの選び方は任意でよい (削除後に再計算するため最終形は不変)。
            let picked = tx.execute(
                "INSERT INTO trim_victims (account_id, timeline_key, note_id)
                 SELECT account_id, timeline_key, note_id FROM (
                     SELECT account_id, timeline_key, note_id,
                            ROW_NUMBER() OVER (
                                PARTITION BY account_id, timeline_key
                                ORDER BY
                                    CASE WHEN timeline_key = 'favorites'
                                              OR timeline_key LIKE 'clip:%'
                                         THEN added_at END DESC,
                                    sort_key DESC, note_id DESC
                            ) AS rn
                     FROM note_timelines
                 )
                 WHERE rn > ?1
                 LIMIT ?2",
                params![per_timeline_limit, TRIM_CHUNK_ROWS],
            )?;
            if picked == 0 {
                tx.commit()?;
                break;
            }
            // membership DELETE → 当該 victim 群の対象限定 entity 掃除 (同一 tx)
            let memberships = tx.execute(
                "DELETE FROM note_timelines
                 WHERE (account_id, timeline_key, note_id) IN (
                     SELECT account_id, timeline_key, note_id FROM trim_victims)",
                [],
            )?;
            let entities = tx.execute(
                "DELETE FROM notes_cache
                 WHERE (note_id, account_id) IN (
                     SELECT DISTINCT v.note_id, v.account_id FROM trim_victims v
                     WHERE NOT EXISTS (SELECT 1 FROM note_timelines m
                                       WHERE m.note_id = v.note_id
                                         AND m.account_id = v.account_id))",
                [],
            )?;
            tx.commit()?;
            total += (memberships + entities) as u64;
        }
        Ok(total)
    }

    /// 1 度に最大 `INCREMENTAL_VACUUM_PAGES_PER_BOOT` ページを `auto_vacuum=INCREMENTAL`
    /// で返却する。起動時の cleanup 後に呼ぶことで、長期蓄積した free page を
    /// 段階的にディスクへ返す。実行コストは数ミリ秒オーダー。
    pub fn incremental_vacuum_step(&self) -> Result<(), NoteDeckError> {
        let conn = self.lock_write()?;
        conn.execute_batch(&format!(
            "PRAGMA incremental_vacuum({INCREMENTAL_VACUUM_PAGES_PER_BOOT});"
        ))?;
        Ok(())
    }

    /// DB の一貫したスナップショットを `dest` に書き出す。
    ///
    /// 単純なファイルコピーでは WAL に未反映のトランザクションが取り残され、
    /// 古い、または壊れた複製ができる。`VACUUM INTO` は writer 接続上で
    /// 単一ファイルの完結したコピーを作るため、-wal / -shm を伴わない。
    ///
    /// `strip_tokens` を立てると、複製側の `accounts.token` を空にしてから
    /// 返す。キーチェーンが永続しない環境では DB に API トークンが平文で
    /// 残るため、持ち出す成果物からは落とせるようにする。
    pub fn backup_to(&self, dest: &Path, strip_tokens: bool) -> Result<(), NoteDeckError> {
        if dest.exists() {
            // VACUUM INTO は既存ファイルへの書き出しを拒否する
            std::fs::remove_file(dest).map_err(|e| {
                NoteDeckError::Database(rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CANTOPEN),
                    Some(format!("failed to replace existing backup: {e}")),
                ))
            })?;
        }
        {
            let conn = self.lock_write()?;
            conn.execute("VACUUM INTO ?1", params![dest.to_string_lossy()])?;
        }
        Self::restrict_permissions(dest);

        if strip_tokens {
            let copy = Connection::open(dest)?;
            copy.execute("UPDATE accounts SET token = ''", [])?;
        }
        Ok(())
    }

    /// Delete a single note from the cache (e.g. when a deletion event is received).
    /// account スコープ (全アカウント一括削除の暗黙挙動を廃止)。所属は CASCADE で
    /// 連動削除される。戻り値は entity が実在し削除されたか。
    pub fn delete_cached_note(
        &self,
        account_id: &str,
        note_id: &str,
    ) -> Result<bool, NoteDeckError> {
        let conn = self.lock_write()?;
        let n = conn.execute(
            "DELETE FROM notes_cache WHERE note_id = ?1 AND account_id = ?2",
            params![note_id, account_id],
        )?;
        Ok(n > 0)
    }

    /// Return (note_count, db_size_bytes).
    pub fn cache_stats(&self) -> Result<(i64, i64), NoteDeckError> {
        let conn = self.lock_read()?;
        let count: i64 =
            conn.query_row("SELECT COUNT(*) FROM notes_cache", [], |row| row.get(0))?;
        let page_count: i64 =
            conn.query_row("SELECT page_count FROM pragma_page_count", [], |row| {
                row.get(0)
            })?;
        let page_size: i64 =
            conn.query_row("SELECT page_size FROM pragma_page_size", [], |row| {
                row.get(0)
            })?;
        Ok((count, page_count * page_size))
    }

    /// カーソル以前のバケット内ノートを返す。
    ///
    /// keyset cursor: `before_note_id` が Some なら行値比較 `(sort_key, note_id) < (?, ?)`
    /// (排他)、None なら `sort_key <= ?` (現行互換の包含比較。境界重複はフロント
    /// dedup が吸収)。タイムスタンプ単独カーソルは同一 sort_key が limit 以上並ぶと
    /// 前進不能になるため、呼び出し側は note_id を渡すこと。
    pub fn get_cached_timeline_before(
        &self,
        account_id: &str,
        key: &TimelineKey,
        before_sort_key: &str,
        before_note_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let conn = self.lock_read()?;
        let canonical = key.as_canonical();
        let jsons: Vec<String> = match before_note_id {
            Some(note_id) => {
                let mut stmt = conn.prepare_cached(
                    "SELECT e.note_json FROM note_timelines m
                     JOIN notes_cache e ON e.note_id = m.note_id AND e.account_id = m.account_id
                     WHERE m.account_id = ?1 AND m.timeline_key = ?2
                       AND (m.sort_key, m.note_id) < (?3, ?4)
                     ORDER BY m.sort_key DESC, m.note_id DESC
                     LIMIT ?5",
                )?;
                let rows = stmt.query_map(
                    params![account_id, canonical, before_sort_key, note_id, limit],
                    |row| row.get::<_, String>(0),
                )?;
                rows.collect::<rusqlite::Result<_>>()?
            }
            None => {
                let mut stmt = conn.prepare_cached(
                    "SELECT e.note_json FROM note_timelines m
                     JOIN notes_cache e ON e.note_id = m.note_id AND e.account_id = m.account_id
                     WHERE m.account_id = ?1 AND m.timeline_key = ?2 AND m.sort_key <= ?3
                     ORDER BY m.sort_key DESC, m.note_id DESC
                     LIMIT ?4",
                )?;
                let rows = stmt.query_map(
                    params![account_id, canonical, before_sort_key, limit],
                    |row| row.get::<_, String>(0),
                )?;
                rows.collect::<rusqlite::Result<_>>()?
            }
        };
        Ok(jsons
            .iter()
            .filter_map(|json| Self::parse_cached_note(json))
            .collect())
    }

    /// バケットの sort_key 範囲 (min, max) を返す。sort_key = created_at の間は
    /// 現行と同値。
    pub fn get_cache_date_range(
        &self,
        account_id: &str,
        key: &TimelineKey,
    ) -> Result<Option<(String, String)>, NoteDeckError> {
        let conn = self.lock_read()?;
        let result: (Option<String>, Option<String>) = conn.query_row(
            "SELECT MIN(sort_key), MAX(sort_key) FROM note_timelines
             WHERE account_id = ?1 AND timeline_key = ?2",
            params![account_id, key.as_canonical()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        match result {
            (Some(min), Some(max)) => Ok(Some((min, max))),
            _ => Ok(None),
        }
    }

    // --- OGP / Summary cache ---

    pub fn cache_summary(
        &self,
        url: &str,
        row: &SummaryRow,
        ttl_secs: i64,
    ) -> Result<(), NoteDeckError> {
        let conn = self.lock_write()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        conn.execute(
            "INSERT INTO ogp_cache (url, title, description, image, site_name, icon, player_url, player_width, player_height, player_allow, final_url, sensitive, medias_json, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(url) DO UPDATE SET
                 title = excluded.title,
                 description = excluded.description,
                 image = excluded.image,
                 site_name = excluded.site_name,
                 icon = excluded.icon,
                 player_url = excluded.player_url,
                 player_width = excluded.player_width,
                 player_height = excluded.player_height,
                 player_allow = excluded.player_allow,
                 final_url = excluded.final_url,
                 sensitive = excluded.sensitive,
                 medias_json = excluded.medias_json,
                 expires_at = excluded.expires_at",
            params![
                url,
                row.title,
                row.description,
                row.thumbnail,
                row.sitename,
                row.icon,
                row.player_url,
                row.player_width,
                row.player_height,
                row.player_allow,
                row.final_url,
                row.sensitive as i32,
                row.medias_json,
                now + ttl_secs
            ],
        )?;
        Ok(())
    }

    pub fn get_cached_summary(&self, url: &str) -> Result<Option<SummaryRow>, NoteDeckError> {
        let conn = self.lock_read()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let result = conn.query_row(
            "SELECT title, description, image, site_name, icon, player_url, player_width, player_height, player_allow, final_url, sensitive, medias_json
             FROM ogp_cache WHERE url = ?1 AND expires_at > ?2",
            params![url, now],
            |row| Self::row_to_summary(url, row),
        );
        match result {
            Ok(data) => Ok(Some(data)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn load_summary_cache(&self, limit: usize) -> Result<Vec<SummaryRow>, NoteDeckError> {
        let conn = self.lock_read()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let mut stmt = conn.prepare_cached(
            "SELECT url, title, description, image, site_name, icon, player_url, player_width, player_height, player_allow, final_url, sensitive, medias_json
             FROM ogp_cache WHERE expires_at > ?1 LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![now, limit as i64], |row| {
                let url: String = row.get(0)?;
                Self::row_to_summary_offset(&url, row, 1)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Map a DB row (without url column) into SummaryRow. Columns start at index 0.
    fn row_to_summary(url: &str, row: &rusqlite::Row) -> rusqlite::Result<SummaryRow> {
        Self::row_to_summary_offset(url, row, 0)
    }

    /// Map a DB row into SummaryRow with column offset (for queries with/without url column).
    fn row_to_summary_offset(
        url: &str,
        row: &rusqlite::Row,
        off: usize,
    ) -> rusqlite::Result<SummaryRow> {
        let sensitive_i: i32 = row.get(off + 10)?;
        Ok(SummaryRow {
            url: url.to_string(),
            title: row.get(off)?,
            description: row.get(off + 1)?,
            thumbnail: row.get(off + 2)?,
            sitename: row.get(off + 3)?,
            icon: row.get(off + 4)?,
            player_url: row.get(off + 5)?,
            player_width: row.get(off + 6)?,
            player_height: row.get(off + 7)?,
            player_allow: row.get(off + 8)?,
            final_url: row.get(off + 9)?,
            sensitive: sensitive_i != 0,
            medias_json: row.get(off + 11)?,
        })
    }

    pub fn cleanup_expired_ogp(&self) -> Result<(), NoteDeckError> {
        let conn = self.lock_write()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        conn.execute("DELETE FROM ogp_cache WHERE expires_at <= ?1", params![now])?;
        Ok(())
    }

    pub fn upsert_server_detection(&self, det: &ServerDetection) -> Result<(), NoteDeckError> {
        let conn = self.lock_write()?;
        conn.execute(
            "INSERT INTO server_detections
                 (host, software_name, software_version, software_repository, meta_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(host) DO UPDATE SET
                 software_name = excluded.software_name,
                 software_version = excluded.software_version,
                 software_repository = excluded.software_repository,
                 meta_json = excluded.meta_json,
                 updated_at = excluded.updated_at",
            params![
                det.host,
                det.software_name,
                det.software_version,
                det.software_repository,
                det.meta_json,
                det.updated_at,
            ],
        )?;
        Ok(())
    }

    // --- Chat messages cache ---

    /// `ChatMessage` から `(thread_id, thread_kind)` を導出する。
    /// DM の partner は `from_user_id == account_user_id ? to_user_id : from_user_id` で計算。
    /// `to_user_id` も `to_room_id` も無い (= 不正な msg) 場合は `None` を返す → caller は skip。
    pub(crate) fn derive_thread_key(
        msg: &ChatMessage,
        account_user_id: &str,
    ) -> Option<(String, &'static str)> {
        if let Some(room_id) = &msg.to_room_id {
            return Some((format!("r:{room_id}"), "room"));
        }
        if let Some(to_user_id) = &msg.to_user_id {
            let partner = if msg.from_user_id == account_user_id {
                to_user_id
            } else {
                &msg.from_user_id
            };
            return Some((format!("u:{partner}"), "dm"));
        }
        None
    }

    fn row_to_chat_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
        let json: String = row.get(0)?;
        serde_json::from_str(&json).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
        })
    }

    /// 複数の chat メッセージを upsert する。`account_user_id` は DM の partner 判定に使う。
    /// 戻り値は実際に書き込まれた行数 (thread が決定できなかった msg は skip)。
    pub fn cache_chat_messages(
        &self,
        msgs: &[ChatMessage],
        account_id: &str,
        account_user_id: &str,
        server_host: &str,
    ) -> Result<usize, NoteDeckError> {
        if msgs.is_empty() {
            return Ok(0);
        }
        let conn = self.lock_write()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let tx = conn.unchecked_transaction()?;
        let mut written = 0usize;
        {
            let mut stmt = tx.prepare_cached(
                "INSERT INTO chat_messages_cache (
                    message_id, account_id, server_host, thread_id, thread_kind,
                    from_user_id, created_at, message_json, cached_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(message_id, account_id) DO UPDATE SET
                     thread_id = excluded.thread_id,
                     thread_kind = excluded.thread_kind,
                     from_user_id = excluded.from_user_id,
                     created_at = excluded.created_at,
                     message_json = excluded.message_json,
                     cached_at = excluded.cached_at",
            )?;
            for msg in msgs {
                let Some((thread_id, thread_kind)) = Self::derive_thread_key(msg, account_user_id)
                else {
                    continue;
                };
                let json = serde_json::to_string(msg).unwrap_or_default();
                stmt.execute(params![
                    msg.id,
                    account_id,
                    server_host,
                    thread_id,
                    thread_kind,
                    msg.from_user_id,
                    msg.created_at,
                    json,
                    now,
                ])?;
                written += 1;
            }
        }
        tx.commit()?;
        Ok(written)
    }

    /// 単一 chat メッセージの upsert。`cache_chat_messages` の thin wrapper。
    pub fn cache_chat_message(
        &self,
        msg: &ChatMessage,
        account_id: &str,
        account_user_id: &str,
        server_host: &str,
    ) -> Result<bool, NoteDeckError> {
        let written = self.cache_chat_messages(
            std::slice::from_ref(msg),
            account_id,
            account_user_id,
            server_host,
        )?;
        Ok(written > 0)
    }

    /// WS `chat:deleted` event 受信時など、特定メッセージを cache から消す。
    pub fn delete_cached_chat_message(
        &self,
        account_id: &str,
        message_id: &str,
    ) -> Result<bool, NoteDeckError> {
        let conn = self.lock_write()?;
        let n = conn.execute(
            "DELETE FROM chat_messages_cache WHERE account_id = ?1 AND message_id = ?2",
            params![account_id, message_id],
        )?;
        Ok(n > 0)
    }

    /// WS `chat:react` / `chat:unreact` event を atomic に適用する。
    /// 該当 message が DB に無ければ何もしない (`Ok(false)`)。
    /// `is_react = true` で追加、`false` で削除 ((reactor.id, reaction) の最初の 1 件)。
    pub fn apply_chat_message_reaction(
        &self,
        account_id: &str,
        message_id: &str,
        reactor: &ChatReactionUser,
        reaction: &str,
        is_react: bool,
    ) -> Result<bool, NoteDeckError> {
        let conn = self.lock_write()?;
        let tx = conn.unchecked_transaction()?;
        let json: Option<String> = tx
            .query_row(
                "SELECT message_json FROM chat_messages_cache WHERE account_id = ?1 AND message_id = ?2",
                params![account_id, message_id],
                |row| row.get(0),
            )
            .ok();
        let Some(json) = json else {
            return Ok(false);
        };
        let mut msg: ChatMessage = match serde_json::from_str(&json) {
            Ok(m) => m,
            Err(_) => return Ok(false),
        };
        if is_react {
            msg.reactions.push(ChatMessageReaction {
                user: Some(reactor.clone()),
                reaction: reaction.to_string(),
            });
        } else {
            // (user_id, reaction) が一致する最初の 1 件を削除。
            if let Some(pos) = msg.reactions.iter().position(|r| {
                r.reaction == reaction
                    && r.user.as_ref().map(|u| u.id.as_str()) == Some(reactor.id.as_str())
            }) {
                msg.reactions.remove(pos);
            } else {
                return Ok(false);
            }
        }
        let new_json = serde_json::to_string(&msg).unwrap_or(json);
        let n = tx.execute(
            "UPDATE chat_messages_cache SET message_json = ?1
             WHERE account_id = ?2 AND message_id = ?3",
            params![new_json, account_id, message_id],
        )?;
        tx.commit()?;
        Ok(n > 0)
    }

    /// History view 用: 各 thread の最新 1 件を返す (`limit` 件まで)。
    pub fn get_cached_chat_history(
        &self,
        account_id: &str,
        limit: i64,
    ) -> Result<Vec<ChatMessage>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT message_json FROM chat_messages_cache
             WHERE rowid IN (
                 SELECT rowid FROM (
                     SELECT rowid,
                            ROW_NUMBER() OVER (
                                PARTITION BY thread_id
                                ORDER BY created_at DESC
                            ) AS rn
                     FROM chat_messages_cache
                     WHERE account_id = ?1
                 )
                 WHERE rn = 1
             )
             ORDER BY created_at DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![account_id, limit], Self::row_to_chat_message)?;
        let mut msgs = Vec::new();
        for m in rows.flatten() {
            msgs.push(m);
        }
        Ok(msgs)
    }

    /// thread タイムライン用: 指定 thread の messages を created_at 降順で返す。
    /// `until_id` を指定した場合、その message 以前 (created_at が小さい) を返す。
    pub fn get_cached_chat_thread_messages(
        &self,
        account_id: &str,
        thread_id: &str,
        until_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<ChatMessage>, NoteDeckError> {
        let conn = self.lock_read()?;
        let msgs = if let Some(until_id) = until_id {
            // until_id の created_at を取得して、それ以前を返す。
            let until_at: Option<String> = conn
                .query_row(
                    "SELECT created_at FROM chat_messages_cache
                     WHERE account_id = ?1 AND message_id = ?2",
                    params![account_id, until_id],
                    |row| row.get(0),
                )
                .ok();
            let Some(until_at) = until_at else {
                return Ok(Vec::new());
            };
            let mut stmt = conn.prepare_cached(
                "SELECT message_json FROM chat_messages_cache
                 WHERE account_id = ?1 AND thread_id = ?2 AND created_at < ?3
                 ORDER BY created_at DESC
                 LIMIT ?4",
            )?;
            let rows = stmt.query_map(
                params![account_id, thread_id, until_at, limit],
                Self::row_to_chat_message,
            )?;
            rows.filter_map(|r| r.ok()).collect()
        } else {
            let mut stmt = conn.prepare_cached(
                "SELECT message_json FROM chat_messages_cache
                 WHERE account_id = ?1 AND thread_id = ?2
                 ORDER BY created_at DESC
                 LIMIT ?3",
            )?;
            let rows = stmt.query_map(
                params![account_id, thread_id, limit],
                Self::row_to_chat_message,
            )?;
            rows.filter_map(|r| r.ok()).collect()
        };
        Ok(msgs)
    }

    /// Gap 検出用: 指定 thread の最新 message id を返す (since_id 計算)。
    pub fn get_cached_chat_latest_message_id(
        &self,
        account_id: &str,
        thread_id: &str,
    ) -> Result<Option<String>, NoteDeckError> {
        let conn = self.lock_read()?;
        let mut stmt = conn.prepare_cached(
            "SELECT message_id FROM chat_messages_cache
             WHERE account_id = ?1 AND thread_id = ?2
             ORDER BY created_at DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![account_id, thread_id], |row| {
            let id: String = row.get(0)?;
            Ok(id)
        })?;
        match rows.next() {
            Some(row) => Ok(Some(row?)),
            None => Ok(None),
        }
    }

    /// `chat_messages_cache` の eviction を実行する。設計は `cleanup_with_eviction` と同形。
    pub fn cleanup_chat_with_eviction(
        &self,
        config: &ChatEvictionConfig,
    ) -> Result<u64, NoteDeckError> {
        if config.per_account_limit.is_none() && config.ttl_days.is_none() {
            return Ok(0);
        }

        let conn = self.lock_write()?;
        let tx = conn.unchecked_transaction()?;
        let mut total_deleted: u64 = 0;

        if let Some(ttl_days) = config.ttl_days {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let ttl_cutoff = now - ttl_days * 86_400;
            let n = tx.execute(
                "DELETE FROM chat_messages_cache WHERE cached_at < ?1",
                params![ttl_cutoff],
            )?;
            total_deleted += n as u64;
        }

        if let Some(per_account_limit) = config.per_account_limit {
            let n = tx.execute(
                "DELETE FROM chat_messages_cache
                 WHERE rowid IN (
                     SELECT rowid FROM (
                         SELECT rowid,
                                ROW_NUMBER() OVER (
                                    PARTITION BY account_id
                                    ORDER BY cached_at DESC
                                ) AS rn
                         FROM chat_messages_cache
                     )
                     WHERE rn > ?1
                 )",
                params![per_account_limit],
            )?;
            total_deleted += n as u64;
        }

        tx.commit()?;
        Ok(total_deleted)
    }

    /// 指定アカウントの chat メッセージをすべて削除。
    pub fn clear_chat_cache_for_account(&self, account_id: &str) -> Result<u64, NoteDeckError> {
        let conn = self.lock_write()?;
        let deleted = conn.execute(
            "DELETE FROM chat_messages_cache WHERE account_id = ?1",
            params![account_id],
        )?;
        Ok(deleted as u64)
    }

    /// 指定アカウントの chat メッセージ件数。
    pub fn chat_cache_count(&self, account_id: &str) -> Result<i64, NoteDeckError> {
        let conn = self.lock_read()?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM chat_messages_cache WHERE account_id = ?1",
            params![account_id],
            |row| row.get(0),
        )?;
        Ok(count)
    }

    /// `chat_messages_cache` の (件数, 概算バイト数) を返す。
    /// バイト数は DB 全体の page_count*page_size を返す `cache_stats` と異なり、
    /// `pgsize` を行単位に積んで概算する。
    pub fn chat_cache_stats(&self) -> Result<(i64, i64), NoteDeckError> {
        let conn = self.lock_read()?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM chat_messages_cache", [], |row| {
            row.get(0)
        })?;
        let bytes: i64 = conn
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(message_json)), 0) FROM chat_messages_cache",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok((count, bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Account, NormalizedNote, NormalizedUser, ServerDetection};
    use std::collections::HashMap;

    fn temp_db() -> (tempfile::TempDir, Database) {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let db = Database::open(&db_path).unwrap();
        (dir, db)
    }

    fn tk(s: &str) -> TimelineKey {
        TimelineKey::parse(s).unwrap()
    }

    // --- Migration tests ---

    #[test]
    fn migration_creates_all_tables() {
        let (_dir, db) = temp_db();
        let conn = db.lock().unwrap();

        // Verify all expected tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(tables.contains(&"accounts".to_string()));
        assert!(tables.contains(&"server_detections".to_string()));
        // V5 で旧 servers テーブルは削除済み
        assert!(!tables.contains(&"servers".to_string()));
        assert!(tables.contains(&"notes_cache".to_string()));
        assert!(tables.contains(&"ogp_cache".to_string()));
        assert!(tables.contains(&"chat_messages_cache".to_string()));
        assert!(tables.contains(&"refinery_schema_history".to_string()));
    }

    #[test]
    fn migration_creates_fts5_virtual_table() {
        let (_dir, db) = temp_db();
        let conn = db.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='notes_fts'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn migration_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // First open
        let db = Database::open(&db_path).unwrap();
        drop(db);

        // Second open: migrations re-run without error
        let db = Database::open(&db_path).unwrap();
        assert!(db.load_accounts().unwrap().is_empty());
    }

    #[test]
    fn migration_tracks_schema_version() {
        let (_dir, db) = temp_db();
        let conn = db.lock().unwrap();
        let version: i32 = conn
            .query_row(
                "SELECT MAX(version) FROM refinery_schema_history",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(version >= 1);
    }

    #[test]
    fn ogp_cache_has_summaly_columns() {
        let (_dir, db) = temp_db();
        let conn = db.lock().unwrap();
        let columns: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info('ogp_cache')")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        for expected in &[
            "icon",
            "player_url",
            "player_width",
            "player_height",
            "player_allow",
            "final_url",
            "sensitive",
            "medias_json",
        ] {
            assert!(
                columns.contains(&expected.to_string()),
                "Missing column: {expected}"
            );
        }
    }

    #[test]
    fn notes_cache_has_no_timeline_type_column() {
        // V6 で timeline_type 列は除去され、所属は note_timelines が持つ
        let (_dir, db) = temp_db();
        let conn = db.lock().unwrap();
        let has: bool = conn
            .prepare(
                "SELECT COUNT(*) FROM pragma_table_info('notes_cache') WHERE name='timeline_type'",
            )
            .unwrap()
            .query_row([], |row| row.get(0))
            .unwrap();
        assert!(!has);

        let has_membership: bool = conn
            .prepare("SELECT COUNT(*) FROM sqlite_master WHERE name='note_timelines'")
            .unwrap()
            .query_row([], |row| row.get(0))
            .unwrap();
        assert!(has_membership);
    }

    // --- Account CRUD tests ---

    fn sample_account() -> Account {
        Account {
            id: "acc-1".to_string(),
            host: "misskey.io".to_string(),
            token: "test-token".to_string(),
            user_id: "user-1".to_string(),
            username: "alice".to_string(),
            display_name: Some("Alice".to_string()),
            avatar_url: None,
            software: "misskey".to_string(),
        }
    }

    #[test]
    fn backup_to_produces_a_readable_copy_with_data() {
        let (dir, db) = temp_db();
        db.upsert_account(&sample_account()).unwrap();
        let dest = dir.path().join("backup.db");

        db.backup_to(&dest, false).unwrap();

        // VACUUM INTO は単一ファイルで完結する (-wal を伴わない)
        assert!(dest.exists());
        assert!(!dir.path().join("backup.db-wal").exists());

        let restored = Database::open(&dest).unwrap();
        let accounts = restored.load_accounts().unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].token, "test-token");
    }

    #[test]
    fn backup_to_can_strip_tokens_from_the_copy() {
        let (dir, db) = temp_db();
        db.upsert_account(&sample_account()).unwrap();
        let dest = dir.path().join("backup.db");

        db.backup_to(&dest, true).unwrap();

        let restored = Database::open(&dest).unwrap();
        assert_eq!(restored.load_accounts().unwrap()[0].token, "");
        // 元の DB は触らない
        assert_eq!(db.load_accounts().unwrap()[0].token, "test-token");
    }

    #[test]
    fn backup_to_overwrites_an_existing_file() {
        let (dir, db) = temp_db();
        db.upsert_account(&sample_account()).unwrap();
        let dest = dir.path().join("backup.db");
        std::fs::write(&dest, b"stale").unwrap();

        db.backup_to(&dest, false).unwrap();

        let restored = Database::open(&dest).unwrap();
        assert_eq!(restored.load_accounts().unwrap().len(), 1);
    }

    #[test]
    fn account_upsert_and_load() {
        let (_dir, db) = temp_db();
        db.upsert_account(&sample_account()).unwrap();

        let accounts = db.load_accounts().unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].username, "alice");
        assert_eq!(accounts[0].host, "misskey.io");
    }

    #[test]
    fn account_get_by_id() {
        let (_dir, db) = temp_db();
        db.upsert_account(&sample_account()).unwrap();

        let acc = db.get_account("acc-1").unwrap().unwrap();
        assert_eq!(acc.username, "alice");

        assert!(db.get_account("nonexistent").unwrap().is_none());
    }

    #[test]
    fn account_delete() {
        let (_dir, db) = temp_db();
        db.upsert_account(&sample_account()).unwrap();
        db.delete_account("acc-1").unwrap();
        assert!(db.load_accounts().unwrap().is_empty());
    }

    #[test]
    fn account_clear_token() {
        let (_dir, db) = temp_db();
        db.upsert_account(&sample_account()).unwrap();
        db.clear_token("acc-1").unwrap();

        let acc = db.get_account("acc-1").unwrap().unwrap();
        assert!(acc.token.is_empty());
    }

    // --- Server CRUD tests ---

    fn sample_detection() -> ServerDetection {
        ServerDetection {
            host: "misskey.io".to_string(),
            software_name: "misskey".to_string(),
            software_version: "2025.3.0".to_string(),
            software_repository: Some("https://github.com/misskey-dev/misskey".to_string()),
            meta_json: "{}".to_string(),
            updated_at: 1700000000,
        }
    }

    #[test]
    fn server_detection_upsert_and_load() {
        let (_dir, db) = temp_db();
        db.upsert_server_detection(&sample_detection()).unwrap();

        let dets = db.load_server_detections().unwrap();
        assert_eq!(dets.len(), 1);
        assert_eq!(dets[0].host, "misskey.io");
    }

    #[test]
    fn server_detection_get_by_host_and_update() {
        let (_dir, db) = temp_db();
        db.upsert_server_detection(&sample_detection()).unwrap();

        let d = db.get_server_detection("misskey.io").unwrap().unwrap();
        assert_eq!(d.software_version, "2025.3.0");

        // upsert は同 host を上書きする
        let mut newer = sample_detection();
        newer.software_version = "2025.4.0".to_string();
        newer.updated_at = 1700001000;
        db.upsert_server_detection(&newer).unwrap();
        let d = db.get_server_detection("misskey.io").unwrap().unwrap();
        assert_eq!(d.software_version, "2025.4.0");
        assert_eq!(d.updated_at, 1700001000);

        assert!(db.get_server_detection("nonexistent").unwrap().is_none());
    }

    // --- Notes cache tests ---

    fn sample_note(id: &str, text: &str) -> NormalizedNote {
        let mut note = NormalizedNote {
            id: id.to_string(),
            account_id: "acc-1".to_string(),
            server_host: "misskey.io".to_string(),
            identity: String::new(),
            is_origin: false,
            identity_trusted: false,
            content_hidden: false,
            created_at: "2025-01-01T00:00:00Z".to_string(),
            text: Some(text.to_string()),
            cw: None,
            user: NormalizedUser {
                id: "user-1".to_string(),
                username: "alice".to_string(),
                host: None,
                name: None,
                avatar_url: None,
                emojis: HashMap::new(),
                is_bot: false,
                is_cat: false,
                avatar_decorations: Vec::new(),
                instance: None,
            },
            visibility: "public".to_string(),
            emojis: HashMap::new(),
            reaction_emojis: HashMap::new(),
            reactions: HashMap::new(),
            my_reaction: None,
            renote_count: 0,
            replies_count: 0,
            files: Vec::new(),
            poll: None,
            reply_id: None,
            renote_id: None,
            channel_id: None,
            channel: None,
            reaction_acceptance: None,
            uri: None,
            url: None,
            updated_at: None,
            local_only: false,
            visible_user_ids: Vec::new(),
            is_favorited: false,
            mode_flags: HashMap::new(),
            reply: None,
            renote: None,
        };
        note.fill_identity();
        note
    }

    #[test]
    fn cache_note_and_retrieve() {
        let (_dir, db) = temp_db();
        let note = sample_note("note-1", "Hello world");
        db.ingest_notes(&[note], &tk("home")).unwrap();

        let cached = db.get_cached_timeline("acc-1", &tk("home"), 10).unwrap();
        assert_eq!(cached.len(), 1);
        assert_eq!(cached[0].id, "note-1");
    }

    #[test]
    fn cache_note_delete() {
        let (_dir, db) = temp_db();
        db.ingest_notes(&[sample_note("note-1", "test")], &tk("home"))
            .unwrap();
        db.delete_cached_note("acc-1", "note-1").unwrap();

        let cached = db.get_cached_timeline("acc-1", &tk("home"), 10).unwrap();
        assert!(cached.is_empty());
    }

    #[test]
    fn fts_search_finds_cached_notes() {
        let (_dir, db) = temp_db();
        db.ingest_notes(
            &[
                sample_note("n1", "Rust programming language"),
                sample_note("n2", "Python scripting"),
            ],
            &tk("home"),
        )
        .unwrap();

        let results = db.search_cached_notes("acc-1", "Rust", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "n1");
    }

    #[test]
    #[cfg(unix)]
    fn db_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // 既存 DB が緩いパーミッションでも open 時に締められること
        std::fs::write(&db_path, b"").unwrap();
        let mut perms = std::fs::metadata(&db_path).unwrap().permissions();
        perms.set_mode(0o644);
        std::fs::set_permissions(&db_path, perms).unwrap();

        let _db = Database::open(&db_path).unwrap();
        let mode = std::fs::metadata(&db_path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "DB は owner-only であること");
    }

    #[test]
    fn fts_search_reflects_note_edit() {
        let (_dir, db) = temp_db();
        db.ingest_notes(&[sample_note("n1", "before edit text")], &tk("home"))
            .unwrap();

        // 同じノートが編集後のテキストで再キャッシュされる（Misskey のノート編集）
        db.ingest_notes(&[sample_note("n1", "after edit text")], &tk("home"))
            .unwrap();

        let hit_new = db.search_cached_notes("acc-1", "after", 10).unwrap();
        assert_eq!(hit_new.len(), 1, "編集後テキストで検索できること");
        assert_eq!(hit_new[0].id, "n1");

        let hit_old = db.search_cached_notes("acc-1", "before", 10).unwrap();
        assert!(hit_old.is_empty(), "編集前テキストの索引が残らないこと");
    }

    #[test]
    fn fts_search_reflects_edit_from_null_text() {
        let (_dir, db) = temp_db();
        // text が null のノート（renote 等）が後からテキスト付きで再キャッシュされる
        let mut no_text = sample_note("n1", "");
        no_text.text = None;
        db.ingest_notes(&[no_text], &tk("home")).unwrap();

        db.ingest_notes(&[sample_note("n1", "now has text")], &tk("home"))
            .unwrap();

        let results = db.search_cached_notes("acc-1", "now has", 10).unwrap();
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn cache_date_range() {
        let (_dir, db) = temp_db();
        db.ingest_notes(&[sample_note("n1", "test")], &tk("home"))
            .unwrap();

        let range = db.get_cache_date_range("acc-1", &tk("home")).unwrap();
        assert!(range.is_some());
        let (oldest, newest) = range.unwrap();
        assert_eq!(oldest, newest); // single note
    }

    // --- OGP cache tests ---

    #[test]
    fn ogp_cache_store_and_retrieve() {
        let (_dir, db) = temp_db();
        let row = SummaryRow {
            url: "https://example.com".to_string(),
            title: Some("Example".to_string()),
            description: Some("A test page".to_string()),
            thumbnail: None,
            sitename: None,
            icon: None,
            player_url: None,
            player_width: None,
            player_height: None,
            player_allow: None,
            final_url: None,
            sensitive: false,
            medias_json: None,
        };
        db.cache_summary("https://example.com", &row, 3600).unwrap();

        let cached = db.get_cached_summary("https://example.com").unwrap();
        assert!(cached.is_some());
        assert_eq!(cached.unwrap().title, Some("Example".to_string()));
    }

    #[test]
    fn ogp_cache_expired_returns_none() {
        let (_dir, db) = temp_db();
        let row = SummaryRow {
            url: "https://expired.com".to_string(),
            title: Some("Old".to_string()),
            description: None,
            thumbnail: None,
            sitename: None,
            icon: None,
            player_url: None,
            player_width: None,
            player_height: None,
            player_allow: None,
            final_url: None,
            sensitive: false,
            medias_json: None,
        };
        // TTL = 0 means already expired
        db.cache_summary("https://expired.com", &row, 0).unwrap();

        // Should not return expired entry
        let cached = db.get_cached_summary("https://expired.com").unwrap();
        assert!(cached.is_none());
    }

    // --- Cache eviction & vacuum tests ---

    fn note_for_account(id: &str, account_id: &str) -> NormalizedNote {
        let mut n = sample_note(id, "hello");
        n.account_id = account_id.to_string();
        n
    }

    /// notes_cache の cached_at をテスト用に直書きする (既定では now で埋まるため)。
    fn set_cached_at(db: &Database, note_id: &str, cached_at: i64) {
        let conn = db.lock().unwrap();
        conn.execute(
            "UPDATE notes_cache SET cached_at = ?1 WHERE note_id = ?2",
            params![cached_at, note_id],
        )
        .unwrap();
    }

    #[test]
    fn cleanup_removes_notes_older_than_ttl() {
        let (_dir, db) = temp_db();
        db.ingest_notes(&[note_for_account("fresh", "acc-1")], &tk("home"))
            .unwrap();
        db.ingest_notes(&[note_for_account("stale", "acc-1")], &tk("home"))
            .unwrap();
        // stale を 10 日前に偽装、TTL = 1 日でカット
        set_cached_at(&db, "stale", 0);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let _ = now; // 参照のみ (cached_at = 0 は十分古い)

        let cfg = EvictionConfig {
            per_account_limit: Some(10_000),
            ttl_days: Some(1),
            per_timeline_limit: None,
        };
        let deleted = db.cleanup_with_eviction(&cfg).unwrap();
        assert_eq!(deleted, 1);

        let remaining: Vec<NormalizedNote> =
            db.get_cached_timeline("acc-1", &tk("home"), 100).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "fresh");
    }

    #[test]
    fn cleanup_caps_per_account_count() {
        let (_dir, db) = temp_db();
        // 5 件 insert (cached_at は now ですべて同程度)
        for i in 0..5 {
            db.ingest_notes(&[note_for_account(&format!("n{i}"), "acc-1")], &tk("home"))
                .unwrap();
        }
        // 古い 2 件を 1 時間前に偽装 → cap=3 で削除されるのはこの 2 件
        set_cached_at(&db, "n0", 1000);
        set_cached_at(&db, "n1", 1001);

        let cfg = EvictionConfig {
            per_account_limit: Some(3),
            ttl_days: None, // TTL 無効で件数だけテスト
            per_timeline_limit: None,
        };
        let deleted = db.cleanup_with_eviction(&cfg).unwrap();
        assert_eq!(deleted, 2);

        let remaining: Vec<NormalizedNote> =
            db.get_cached_timeline("acc-1", &tk("home"), 100).unwrap();
        assert_eq!(remaining.len(), 3);
        // n0 / n1 (古い) が消えて n2 / n3 / n4 が残る
        let mut ids: Vec<&str> = remaining.iter().map(|n| n.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["n2", "n3", "n4"]);
    }

    #[test]
    fn cleanup_per_account_independent() {
        let (_dir, db) = temp_db();
        // acc-1 に 4 件、acc-2 に 2 件
        for i in 0..4 {
            db.ingest_notes(&[note_for_account(&format!("a{i}"), "acc-1")], &tk("home"))
                .unwrap();
        }
        for i in 0..2 {
            db.ingest_notes(&[note_for_account(&format!("b{i}"), "acc-2")], &tk("home"))
                .unwrap();
        }
        // acc-1 の古い 2 件
        set_cached_at(&db, "a0", 1000);
        set_cached_at(&db, "a1", 1001);

        // cap=2: acc-1 は 2 件残り、acc-2 は影響を受けない
        let cfg = EvictionConfig {
            per_account_limit: Some(2),
            ttl_days: None,
            per_timeline_limit: None,
        };
        let deleted = db.cleanup_with_eviction(&cfg).unwrap();
        assert_eq!(deleted, 2);

        assert_eq!(db.account_cache_count("acc-1").unwrap(), 2);
        assert_eq!(db.account_cache_count("acc-2").unwrap(), 2);
    }

    #[test]
    fn cleanup_no_op_when_under_limits() {
        let (_dir, db) = temp_db();
        for i in 0..3 {
            db.ingest_notes(&[note_for_account(&format!("n{i}"), "acc-1")], &tk("home"))
                .unwrap();
        }
        let cfg = EvictionConfig {
            per_account_limit: Some(100),
            ttl_days: None,
            per_timeline_limit: None,
        };
        let deleted = db.cleanup_with_eviction(&cfg).unwrap();
        assert_eq!(deleted, 0);
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 3);
    }

    #[test]
    fn cleanup_with_all_disabled_is_pure_noop() {
        let (_dir, db) = temp_db();
        for i in 0..3 {
            db.ingest_notes(&[note_for_account(&format!("n{i}"), "acc-1")], &tk("home"))
                .unwrap();
        }
        // 3 フィールド全て None: ロックを取らずに 0 を返す。
        // 検索 UX 優先のデフォルトに近いケースをカバー。
        let cfg = EvictionConfig {
            per_account_limit: None,
            ttl_days: None,
            per_timeline_limit: None,
        };
        let deleted = db.cleanup_with_eviction(&cfg).unwrap();
        assert_eq!(deleted, 0);
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 3);
    }

    #[test]
    fn cleanup_only_ttl_keeps_high_count() {
        let (_dir, db) = temp_db();
        for i in 0..5 {
            db.ingest_notes(&[note_for_account(&format!("n{i}"), "acc-1")], &tk("home"))
                .unwrap();
        }
        // 5 件すべてが新しいので、TTL=1 でも何も消えない (cap は無効)
        let cfg = EvictionConfig {
            per_account_limit: None,
            ttl_days: Some(1),
            per_timeline_limit: None,
        };
        let deleted = db.cleanup_with_eviction(&cfg).unwrap();
        assert_eq!(deleted, 0);
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 5);
    }

    #[test]
    fn default_config_is_lenient() {
        // 検索 UX を尊重するため、デフォルト設定では実質的に何も削除されない。
        let cfg = EvictionConfig::default();
        assert_eq!(cfg.per_account_limit, Some(1_000_000));
        assert_eq!(cfg.ttl_days, None);
    }

    #[test]
    fn auto_vacuum_mode_is_incremental_after_open() {
        let (_dir, db) = temp_db();
        let conn = db.lock().unwrap();
        let mode: i64 = conn
            .query_row("PRAGMA auto_vacuum", [], |row| row.get(0))
            .unwrap();
        // 0 = NONE, 1 = FULL, 2 = INCREMENTAL
        assert_eq!(mode, 2, "auto_vacuum should be INCREMENTAL");
    }

    #[test]
    fn incremental_vacuum_step_runs_without_error() {
        let (_dir, db) = temp_db();
        // データ insert → 削除 → free page を生む
        for i in 0..50 {
            db.ingest_notes(&[note_for_account(&format!("n{i}"), "acc-1")], &tk("home"))
                .unwrap();
        }
        db.clear_all_notes_cache().unwrap();
        // free page があっても無くてもエラーにならない (PRAGMA は no-op 時 silent)
        db.incremental_vacuum_step().unwrap();
        // 2 度呼んでも問題なし
        db.incremental_vacuum_step().unwrap();
    }

    // --- Chat messages cache tests ---

    use crate::models::{ChatMessage, ChatMessageReaction, ChatReactionUser};

    fn dm_msg(id: &str, from: &str, to: &str, text: &str, created_at: &str) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            created_at: created_at.to_string(),
            from_user_id: from.to_string(),
            from_user: None,
            to_user_id: Some(to.to_string()),
            to_user: None,
            to_room_id: None,
            to_room: None,
            text: Some(text.to_string()),
            file_id: None,
            file: None,
            is_read: Some(false),
            reactions: Vec::new(),
        }
    }

    fn room_msg(id: &str, from: &str, room: &str, text: &str, created_at: &str) -> ChatMessage {
        ChatMessage {
            id: id.to_string(),
            created_at: created_at.to_string(),
            from_user_id: from.to_string(),
            from_user: None,
            to_user_id: None,
            to_user: None,
            to_room_id: Some(room.to_string()),
            to_room: None,
            text: Some(text.to_string()),
            file_id: None,
            file: None,
            is_read: Some(false),
            reactions: Vec::new(),
        }
    }

    fn reactor(id: &str, username: &str) -> ChatReactionUser {
        ChatReactionUser {
            id: id.to_string(),
            name: None,
            username: username.to_string(),
            host: None,
            avatar_url: None,
        }
    }

    #[test]
    fn derive_thread_key_dm_partner_is_other_side() {
        // 自分が send 側: partner は to_user_id
        let msg = dm_msg("m1", "me", "alice", "hi", "2026-05-01T00:00:00Z");
        let (tid, kind) = Database::derive_thread_key(&msg, "me").unwrap();
        assert_eq!(tid, "u:alice");
        assert_eq!(kind, "dm");
        // 自分が receive 側: partner は from_user_id
        let msg = dm_msg("m2", "alice", "me", "yo", "2026-05-01T00:01:00Z");
        let (tid, kind) = Database::derive_thread_key(&msg, "me").unwrap();
        assert_eq!(tid, "u:alice");
        assert_eq!(kind, "dm");
    }

    #[test]
    fn derive_thread_key_room_uses_room_id() {
        let msg = room_msg("m3", "alice", "room42", "hello", "2026-05-01T00:00:00Z");
        let (tid, kind) = Database::derive_thread_key(&msg, "me").unwrap();
        assert_eq!(tid, "r:room42");
        assert_eq!(kind, "room");
    }

    #[test]
    fn derive_thread_key_returns_none_for_invalid_msg() {
        let msg = ChatMessage {
            id: "m4".to_string(),
            created_at: "2026-05-01T00:00:00Z".to_string(),
            from_user_id: "alice".to_string(),
            from_user: None,
            to_user_id: None,
            to_user: None,
            to_room_id: None,
            to_room: None,
            text: None,
            file_id: None,
            file: None,
            is_read: None,
            reactions: Vec::new(),
        };
        assert!(Database::derive_thread_key(&msg, "me").is_none());
    }

    #[test]
    fn cache_chat_message_dm_and_retrieve() {
        let (_dir, db) = temp_db();
        let msg = dm_msg("m1", "me", "alice", "hi", "2026-05-01T00:00:00Z");
        let written = db
            .cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();
        assert!(written);

        let history = db.get_cached_chat_history("acc-1", 10).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "m1");

        let thread = db
            .get_cached_chat_thread_messages("acc-1", "u:alice", None, 10)
            .unwrap();
        assert_eq!(thread.len(), 1);
        assert_eq!(thread[0].id, "m1");
    }

    #[test]
    fn cache_chat_message_room_and_retrieve() {
        let (_dir, db) = temp_db();
        let msg = room_msg("m1", "alice", "room42", "hello", "2026-05-01T00:00:00Z");
        db.cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();

        let thread = db
            .get_cached_chat_thread_messages("acc-1", "r:room42", None, 10)
            .unwrap();
        assert_eq!(thread.len(), 1);
        assert_eq!(thread[0].id, "m1");
    }

    #[test]
    fn cache_chat_message_skips_invalid() {
        let (_dir, db) = temp_db();
        let invalid = ChatMessage {
            id: "m1".to_string(),
            created_at: "2026-05-01T00:00:00Z".to_string(),
            from_user_id: "alice".to_string(),
            from_user: None,
            to_user_id: None,
            to_user: None,
            to_room_id: None,
            to_room: None,
            text: None,
            file_id: None,
            file: None,
            is_read: None,
            reactions: Vec::new(),
        };
        let written = db
            .cache_chat_message(&invalid, "acc-1", "me", "example.com")
            .unwrap();
        assert!(!written);
        assert_eq!(db.chat_cache_count("acc-1").unwrap(), 0);
    }

    #[test]
    fn chat_history_returns_one_per_thread() {
        let (_dir, db) = temp_db();
        // 同じ DM thread で 5 件、別 thread で 1 件
        for i in 0..5 {
            let ts = format!("2026-05-01T00:0{i}:00Z");
            let m = dm_msg(&format!("dm{i}"), "me", "alice", "hi", &ts);
            db.cache_chat_message(&m, "acc-1", "me", "example.com")
                .unwrap();
        }
        let other = room_msg("r1", "bob", "room42", "yo", "2026-05-01T00:00:30Z");
        db.cache_chat_message(&other, "acc-1", "me", "example.com")
            .unwrap();

        let history = db.get_cached_chat_history("acc-1", 100).unwrap();
        assert_eq!(history.len(), 2);
        // alice DM の最新は dm4
        let dm = history
            .iter()
            .find(|m| m.to_user_id.as_deref() == Some("alice"))
            .unwrap();
        assert_eq!(dm.id, "dm4");
    }

    #[test]
    fn chat_thread_messages_until_id_pagination() {
        let (_dir, db) = temp_db();
        for i in 0..5 {
            let ts = format!("2026-05-01T00:0{i}:00Z");
            let m = dm_msg(&format!("m{i}"), "me", "alice", "hi", &ts);
            db.cache_chat_message(&m, "acc-1", "me", "example.com")
                .unwrap();
        }
        // m3 より過去 (m0..m2) を取得
        let older = db
            .get_cached_chat_thread_messages("acc-1", "u:alice", Some("m3"), 10)
            .unwrap();
        let ids: Vec<&str> = older.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["m2", "m1", "m0"]);
    }

    #[test]
    fn apply_chat_message_reaction_appends() {
        let (_dir, db) = temp_db();
        let msg = dm_msg("m1", "me", "alice", "hi", "2026-05-01T00:00:00Z");
        db.cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();
        let r = reactor("alice", "alice");
        let applied = db
            .apply_chat_message_reaction("acc-1", "m1", &r, "👍", true)
            .unwrap();
        assert!(applied);

        let stored = db
            .get_cached_chat_thread_messages("acc-1", "u:alice", None, 10)
            .unwrap();
        assert_eq!(stored[0].reactions.len(), 1);
        assert_eq!(stored[0].reactions[0].reaction, "👍");
        assert_eq!(stored[0].reactions[0].user.as_ref().unwrap().id, "alice");
    }

    #[test]
    fn apply_chat_message_reaction_removes_match() {
        let (_dir, db) = temp_db();
        let mut msg = dm_msg("m1", "me", "alice", "hi", "2026-05-01T00:00:00Z");
        msg.reactions.push(ChatMessageReaction {
            user: Some(reactor("alice", "alice")),
            reaction: "👍".to_string(),
        });
        msg.reactions.push(ChatMessageReaction {
            user: Some(reactor("bob", "bob")),
            reaction: "❤️".to_string(),
        });
        db.cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();

        let applied = db
            .apply_chat_message_reaction("acc-1", "m1", &reactor("alice", "alice"), "👍", false)
            .unwrap();
        assert!(applied);

        let stored = db
            .get_cached_chat_thread_messages("acc-1", "u:alice", None, 10)
            .unwrap();
        assert_eq!(stored[0].reactions.len(), 1);
        assert_eq!(stored[0].reactions[0].reaction, "❤️");
    }

    #[test]
    fn apply_chat_message_reaction_no_match_returns_false() {
        let (_dir, db) = temp_db();
        let msg = dm_msg("m1", "me", "alice", "hi", "2026-05-01T00:00:00Z");
        db.cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();
        let unmatched = db
            .apply_chat_message_reaction("acc-1", "m1", &reactor("alice", "alice"), "👍", false)
            .unwrap();
        assert!(!unmatched);
        // 存在しない message
        let absent = db
            .apply_chat_message_reaction("acc-1", "missing", &reactor("alice", "alice"), "👍", true)
            .unwrap();
        assert!(!absent);
    }

    #[test]
    fn delete_cached_chat_message_works() {
        let (_dir, db) = temp_db();
        let msg = dm_msg("m1", "me", "alice", "hi", "2026-05-01T00:00:00Z");
        db.cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();
        assert_eq!(db.chat_cache_count("acc-1").unwrap(), 1);

        let removed = db.delete_cached_chat_message("acc-1", "m1").unwrap();
        assert!(removed);
        assert_eq!(db.chat_cache_count("acc-1").unwrap(), 0);
    }

    #[test]
    fn cleanup_chat_per_account_independent() {
        let (_dir, db) = temp_db();
        for i in 0..5 {
            let ts = format!("2026-05-01T00:0{i}:00Z");
            let m = dm_msg(&format!("a{i}"), "me", "alice", "hi", &ts);
            db.cache_chat_message(&m, "acc-1", "me", "example.com")
                .unwrap();
            let m2 = dm_msg(&format!("b{i}"), "me", "bob", "yo", &ts);
            db.cache_chat_message(&m2, "acc-2", "me", "example.com")
                .unwrap();
        }

        // cap=2 で各アカウント独立に 2 件残し
        let cfg = ChatEvictionConfig {
            per_account_limit: Some(2),
            ttl_days: None,
        };
        // cached_at が同じ now なので、 ROW_NUMBER は実装依存だが per-account 件数は 2 になることを assert
        let _ = db.cleanup_chat_with_eviction(&cfg).unwrap();
        assert_eq!(db.chat_cache_count("acc-1").unwrap(), 2);
        assert_eq!(db.chat_cache_count("acc-2").unwrap(), 2);
    }

    #[test]
    fn delete_account_purges_chat_cache() {
        let (_dir, db) = temp_db();
        // 別 account を accounts table に挿入してから chat 行を作る (delete_account は両方触る)
        db.upsert_account(&Account {
            id: "acc-1".to_string(),
            host: "example.com".to_string(),
            token: String::new(),
            user_id: "me".to_string(),
            username: "me".to_string(),
            display_name: None,
            avatar_url: None,
            software: "misskey".to_string(),
        })
        .unwrap();
        let msg = dm_msg("m1", "me", "alice", "hi", "2026-05-01T00:00:00Z");
        db.cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();
        assert_eq!(db.chat_cache_count("acc-1").unwrap(), 1);

        db.delete_account("acc-1").unwrap();
        assert_eq!(db.chat_cache_count("acc-1").unwrap(), 0);
    }

    #[test]
    fn get_cached_latest_message_id_returns_max_per_thread() {
        let (_dir, db) = temp_db();
        for i in 0..3 {
            let ts = format!("2026-05-01T00:0{i}:00Z");
            let m = dm_msg(&format!("m{i}"), "me", "alice", "hi", &ts);
            db.cache_chat_message(&m, "acc-1", "me", "example.com")
                .unwrap();
        }
        let latest = db
            .get_cached_chat_latest_message_id("acc-1", "u:alice")
            .unwrap();
        assert_eq!(latest, Some("m2".to_string()));

        let absent = db
            .get_cached_chat_latest_message_id("acc-1", "u:nonexistent")
            .unwrap();
        assert!(absent.is_none());
    }

    #[test]
    fn cache_chat_message_upserts_on_conflict() {
        let (_dir, db) = temp_db();
        let mut msg = dm_msg("m1", "me", "alice", "hi", "2026-05-01T00:00:00Z");
        db.cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();
        // 同 ID で別 text → upsert で上書き
        msg.text = Some("edited".to_string());
        db.cache_chat_message(&msg, "acc-1", "me", "example.com")
            .unwrap();
        let stored = db
            .get_cached_chat_thread_messages("acc-1", "u:alice", None, 10)
            .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].text.as_deref(), Some("edited"));
    }

    // --- scan_cached_notes (predicate 注入) ---

    /// 走査用に created_at をずらしたノートを作る (新しい順は id の降順)
    fn scan_note(id: &str, text: &str, seq: u32) -> NormalizedNote {
        let mut note = sample_note(id, text);
        note.created_at = format!("2025-01-01T00:00:{seq:02}Z");
        note
    }

    fn seed_scan_notes(db: &Database) {
        let notes = vec![
            scan_note("n1", "alpha bravo", 1),
            scan_note("n2", "alpha charlie", 2),
            scan_note("n3", "delta echo", 3),
            scan_note("n4", "alpha foxtrot", 4),
        ];
        db.ingest_notes(&notes, &tk("home")).unwrap();
    }

    #[test]
    fn scan_filters_by_predicate() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        let out = db
            .scan_cached_notes("acc-1", None, &[], 10, 100, None, |n| {
                Some(n.text.as_deref().unwrap_or("").contains("alpha"))
            })
            .unwrap();
        assert_eq!(out.notes.len(), 3);
        assert_eq!(out.scanned, 4);
        assert_eq!(out.errors, 0);
        assert!(out.cursor.is_none(), "読み切ったらカーソルは返さない");
    }

    #[test]
    fn scan_returns_notes_newest_first() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        let out = db
            .scan_cached_notes("acc-1", None, &[], 10, 100, None, |_| Some(true))
            .unwrap();
        let ids: Vec<&str> = out.notes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, vec!["n4", "n3", "n2", "n1"]);
    }

    #[test]
    fn scan_uses_fts_prefilter() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        let out = db
            .scan_cached_notes("acc-1", None, &["delta".to_string()], 10, 100, None, |_| {
                Some(true)
            })
            .unwrap();
        // FTS で 1 行に絞られるので、述語に渡る行も 1 件だけ
        assert_eq!(out.scanned, 1);
        assert_eq!(out.notes.len(), 1);
        assert_eq!(out.notes[0].id, "n3");
    }

    #[test]
    fn scan_ignores_too_short_literals() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        // 3 文字未満を押し込むと trigram が 0 件を返して偽陰性になるので無視する
        let out = db
            .scan_cached_notes("acc-1", None, &["ab".to_string()], 10, 100, None, |_| {
                Some(true)
            })
            .unwrap();
        assert_eq!(out.scanned, 4, "FTS を使わず全件走査するべき");
    }

    #[test]
    fn scan_stops_at_limit() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        let out = db
            .scan_cached_notes("acc-1", None, &[], 2, 100, None, |_| Some(true))
            .unwrap();
        assert_eq!(out.notes.len(), 2);
        assert!(out.cursor.is_some(), "続きがあるならカーソルを返す");
    }

    #[test]
    fn scan_resumes_from_cursor_without_gap_or_overlap() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        // 走査上限 2 行で打ち切る
        let first = db
            .scan_cached_notes("acc-1", None, &[], 10, 2, None, |_| Some(true))
            .unwrap();
        assert_eq!(first.scanned, 2);
        let cursor = first.cursor.expect("打ち切ったらカーソルが返る");

        let second = db
            .scan_cached_notes("acc-1", None, &[], 10, 10, Some(&cursor), |_| Some(true))
            .unwrap();
        let mut all: Vec<String> = first.notes.iter().map(|n| n.id.clone()).collect();
        all.extend(second.notes.iter().map(|n| n.id.clone()));
        assert_eq!(
            all,
            vec!["n4", "n3", "n2", "n1"],
            "取りこぼしも重複もなく続きが読める"
        );
    }

    #[test]
    fn scan_counts_predicate_errors() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        let out = db
            .scan_cached_notes("acc-1", None, &[], 10, 100, None, |n| {
                // n3 だけ判定不能にする
                if n.id == "n3" {
                    None
                } else {
                    Some(true)
                }
            })
            .unwrap();
        assert_eq!(out.errors, 1);
        assert_eq!(out.notes.len(), 3, "判定不能なノートは除外する");
    }

    #[test]
    fn scan_counts_broken_rows_as_errors() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        {
            // note_json を壊す (スキーマ世代差で読めない行の代役)
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE notes_cache SET note_json = '{ broken' WHERE note_id = 'n2'",
                [],
            )
            .unwrap();
        }
        let out = db
            .scan_cached_notes("acc-1", None, &[], 10, 100, None, |_| Some(true))
            .unwrap();
        assert_eq!(out.errors, 1);
        assert_eq!(out.notes.len(), 3);
        assert_eq!(out.scanned, 4, "読めない行も走査行数には数える");
    }

    #[test]
    fn scan_is_scoped_to_account() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        let mut other = scan_note("n9", "alpha", 9);
        other.account_id = "acc-2".to_string();
        db.ingest_notes(&[other], &tk("home")).unwrap();

        let out = db
            .scan_cached_notes("acc-1", None, &[], 10, 100, None, |_| Some(true))
            .unwrap();
        assert!(out.notes.iter().all(|n| n.account_id == "acc-1"));
    }

    #[test]
    fn scan_scoped_to_bucket_filters_by_membership() {
        // #783 のカラムクエリが「種別で絞ると取りこぼす」妥協をしていた点の解消:
        // scope 指定で当該バケット所属のみが母集合になる (§12-9)
        let (_dir, db) = temp_db();
        db.ingest_notes(&[scan_note("home-1", "alpha topic", 1)], &tk("home"))
            .unwrap();
        db.ingest_notes(
            &[scan_note("antenna-1", "alpha topic", 2)],
            &tk("antenna:a1"),
        )
        .unwrap();
        // 両方に所属するノート
        let shared = scan_note("shared-1", "alpha topic", 3);
        db.ingest_notes(std::slice::from_ref(&shared), &tk("home"))
            .unwrap();
        db.ingest_notes(&[shared], &tk("antenna:a1")).unwrap();

        let out = db
            .scan_cached_notes("acc-1", Some(&tk("antenna:a1")), &[], 10, 100, None, |_| {
                Some(true)
            })
            .unwrap();
        let ids: Vec<&str> = out.notes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(
            ids,
            ["shared-1", "antenna-1"],
            "バケット所属のみ・sort_key 降順"
        );

        // scope なしは従来どおり全体走査
        let all = db
            .scan_cached_notes("acc-1", None, &[], 10, 100, None, |_| Some(true))
            .unwrap();
        assert_eq!(all.notes.len(), 3);
    }

    #[test]
    fn scan_scoped_cursor_resumes_within_bucket() {
        let (_dir, db) = temp_db();
        for i in 0..5 {
            db.ingest_notes(&[scan_note(&format!("a{i}"), "text", i)], &tk("antenna:a1"))
                .unwrap();
        }
        // バケット外のノート (カーソル継続に混入しないこと)
        db.ingest_notes(&[scan_note("h1", "text", 10)], &tk("home"))
            .unwrap();

        let scope = tk("antenna:a1");
        let first = db
            .scan_cached_notes("acc-1", Some(&scope), &[], 10, 2, None, |_| Some(true))
            .unwrap();
        assert_eq!(first.notes.len(), 2);
        let cursor = first.cursor.expect("打ち切りで継続カーソルが返る");

        let rest = db
            .scan_cached_notes("acc-1", Some(&scope), &[], 10, 100, Some(&cursor), |_| {
                Some(true)
            })
            .unwrap();
        assert_eq!(rest.notes.len(), 3, "残り全件を重複なく回収");
        assert!(rest.cursor.is_none(), "読み切ったらカーソルなし");
        let mut all: Vec<String> = first
            .notes
            .iter()
            .chain(rest.notes.iter())
            .map(|n| n.id.clone())
            .collect();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), 5);
    }

    #[test]
    fn scan_scoped_with_fts_prefilter() {
        let (_dir, db) = temp_db();
        db.ingest_notes(
            &[scan_note("hit", "unique-zebra topic", 1)],
            &tk("antenna:a1"),
        )
        .unwrap();
        db.ingest_notes(
            &[scan_note("miss-text", "other topic", 2)],
            &tk("antenna:a1"),
        )
        .unwrap();
        // FTS には合うがバケット外
        db.ingest_notes(
            &[scan_note("miss-bucket", "unique-zebra topic", 3)],
            &tk("home"),
        )
        .unwrap();

        let out = db
            .scan_cached_notes(
                "acc-1",
                Some(&tk("antenna:a1")),
                &["unique-zebra".to_string()],
                10,
                100,
                None,
                |_| Some(true),
            )
            .unwrap();
        let ids: Vec<&str> = out.notes.iter().map(|n| n.id.as_str()).collect();
        assert_eq!(ids, ["hit"], "FTS プリフィルタとバケット絞りの積");
    }

    #[test]
    fn scan_handles_zero_limits() {
        let (_dir, db) = temp_db();
        seed_scan_notes(&db);
        let out = db
            .scan_cached_notes("acc-1", None, &[], 0, 100, None, |_| Some(true))
            .unwrap();
        assert!(out.notes.is_empty());
        assert_eq!(out.scanned, 0);
    }

    #[test]
    fn fts_match_query_escapes_quotes() {
        let q = build_fts_match_query(&["say \"hi\" now".to_string()]).unwrap();
        assert_eq!(q, "\"say \"\"hi\"\" now\"");
    }

    #[test]
    fn fts_match_query_joins_with_and() {
        let q = build_fts_match_query(&["alpha".to_string(), "bravo".to_string()]).unwrap();
        assert_eq!(q, "\"alpha\" AND \"bravo\"");
    }

    // --- 実体/所属分離 (issue #30 仕様 v5) ---

    fn note_with_created_at(id: &str, account_id: &str, created_at: &str) -> NormalizedNote {
        let mut n = note_for_account(id, account_id);
        n.created_at = created_at.to_string();
        n
    }

    #[test]
    fn note_belongs_to_multiple_timelines() {
        // §9-2: home ∩ social の複数所属 (v5 以前は後勝ちで付け替わっていた現行バグ)
        let (_dir, db) = temp_db();
        let note = sample_note("n1", "both timelines");
        db.ingest_notes(std::slice::from_ref(&note), &tk("home"))
            .unwrap();
        db.ingest_notes(&[note], &tk("social")).unwrap();

        let home = db.get_cached_timeline("acc-1", &tk("home"), 10).unwrap();
        let social = db.get_cached_timeline("acc-1", &tk("social"), 10).unwrap();
        assert_eq!(home.len(), 1, "home からも読めること");
        assert_eq!(social.len(), 1, "social からも読めること");
        // entity は 1 行のまま
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 1);
    }

    #[test]
    fn ingest_with_param_key_is_readable() {
        // §9-3: 孤児化解消 — antenna キーで ingest → 同じキーで読める
        let (_dir, db) = temp_db();
        db.ingest_notes(&[sample_note("n1", "from antenna")], &tk("antenna:a1"))
            .unwrap();
        let notes = db
            .get_cached_timeline("acc-1", &tk("antenna:a1"), 10)
            .unwrap();
        assert_eq!(notes.len(), 1);
    }

    #[test]
    fn ingest_mixed_accounts_processes_per_note() {
        // §9-12: 複数 account 混在配列の per-note 処理
        let (_dir, db) = temp_db();
        db.ingest_notes(
            &[
                note_for_account("n1", "acc-1"),
                note_for_account("n2", "acc-2"),
            ],
            &tk("home"),
        )
        .unwrap();
        assert_eq!(
            db.get_cached_timeline("acc-1", &tk("home"), 10)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            db.get_cached_timeline("acc-2", &tk("home"), 10)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn remove_membership_keeps_shared_entity() {
        // §9-6: 他バケット所属 entity の生存
        let (_dir, db) = temp_db();
        let note = sample_note("n1", "shared");
        db.ingest_notes(std::slice::from_ref(&note), &tk("home"))
            .unwrap();
        db.ingest_notes(&[note], &tk("favorites")).unwrap();

        let removed = db
            .remove_membership("acc-1", &tk("favorites"), "n1")
            .unwrap();
        assert_eq!(removed, 1);
        assert!(db
            .get_cached_timeline("acc-1", &tk("favorites"), 10)
            .unwrap()
            .is_empty());
        assert_eq!(
            db.get_cached_timeline("acc-1", &tk("home"), 10)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 1);
    }

    #[test]
    fn remove_membership_sweeps_sole_entity() {
        // §9-6: 単独所属 entity は同一 tx で掃除される
        let (_dir, db) = temp_db();
        db.ingest_notes(&[sample_note("n1", "only fav")], &tk("favorites"))
            .unwrap();
        let removed = db
            .remove_membership("acc-1", &tk("favorites"), "n1")
            .unwrap();
        assert_eq!(removed, 1);
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 0);
    }

    #[test]
    fn remove_membership_on_orphan_entity_returns_zero() {
        // §9-6 追補 (R11-5): membership ゼロの orphan entity を巻き添え削除しない
        let (_dir, db) = temp_db();
        db.ingest_notes(&[sample_note("n1", "will be orphan")], &tk("home"))
            .unwrap();
        {
            let conn = db.lock().unwrap();
            conn.execute("DELETE FROM note_timelines", []).unwrap();
        }
        let removed = db.remove_membership("acc-1", &tk("home"), "n1").unwrap();
        assert_eq!(removed, 0, "membership 不在なら 0 を返す");
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 1, "entity は残す");
    }

    #[test]
    fn clear_timeline_scoped_to_bucket_and_account() {
        // §9-6: バケット破棄 — 他バケット所属は生存・単独所属は掃除・他アカウント非干渉
        let (_dir, db) = temp_db();
        let shared = note_for_account("shared", "acc-1");
        db.ingest_notes(std::slice::from_ref(&shared), &tk("antenna:a1"))
            .unwrap();
        db.ingest_notes(&[shared], &tk("home")).unwrap();
        db.ingest_notes(&[note_for_account("sole", "acc-1")], &tk("antenna:a1"))
            .unwrap();
        db.ingest_notes(&[note_for_account("other", "acc-2")], &tk("antenna:a1"))
            .unwrap();

        // membership 3 行 (shared/sole の antenna:a1 = 2、sole entity の CASCADE 1 は
        // 数えない → shared 1 + sole 1(entity 先行 CASCADE) = 2
        let removed = db.clear_timeline("acc-1", &tk("antenna:a1")).unwrap();
        assert_eq!(removed, 2);
        assert!(db
            .get_cached_timeline("acc-1", &tk("antenna:a1"), 10)
            .unwrap()
            .is_empty());
        assert_eq!(
            db.get_cached_timeline("acc-1", &tk("home"), 10)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 1, "sole は掃除");
        assert_eq!(
            db.account_cache_count("acc-2").unwrap(),
            1,
            "他アカウント非干渉"
        );
    }

    #[test]
    fn delete_cached_note_is_account_scoped() {
        // §9-7: 同一 note_id でも他アカウントの entity は残る
        let (_dir, db) = temp_db();
        db.ingest_notes(&[note_for_account("n1", "acc-1")], &tk("home"))
            .unwrap();
        db.ingest_notes(&[note_for_account("n1", "acc-2")], &tk("home"))
            .unwrap();

        assert!(db.delete_cached_note("acc-1", "n1").unwrap());
        assert!(db
            .get_cached_timeline("acc-1", &tk("home"), 10)
            .unwrap()
            .is_empty());
        assert_eq!(
            db.get_cached_timeline("acc-2", &tk("home"), 10)
                .unwrap()
                .len(),
            1
        );
        // 二度目は false
        assert!(!db.delete_cached_note("acc-1", "n1").unwrap());
    }

    #[test]
    fn sweep_orphan_notes_removes_only_orphans() {
        let (_dir, db) = temp_db();
        db.ingest_notes(&[sample_note("kept", "has membership")], &tk("home"))
            .unwrap();
        db.ingest_notes(&[sample_note("orphan", "loses membership")], &tk("home"))
            .unwrap();
        {
            let conn = db.lock().unwrap();
            conn.execute("DELETE FROM note_timelines WHERE note_id = 'orphan'", [])
                .unwrap();
        }
        assert_eq!(db.sweep_orphan_notes().unwrap(), 1);
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 1);
    }

    #[test]
    fn keyset_paging_advances_through_equal_sort_keys() {
        // §9-8: 同一 sort_key が limit 超で並んでも note_id tie-break で前進する
        let (_dir, db) = temp_db();
        let same_ts = "2025-06-01T00:00:00Z";
        let notes: Vec<NormalizedNote> = (0..5)
            .map(|i| note_with_created_at(&format!("n{i}"), "acc-1", same_ts))
            .collect();
        db.ingest_notes(&notes, &tk("home")).unwrap();

        let mut seen: Vec<String> = Vec::new();
        let mut cursor: Option<(String, String)> = None;
        loop {
            let page = match &cursor {
                None => db.get_cached_timeline("acc-1", &tk("home"), 2).unwrap(),
                Some((sk, nid)) => db
                    .get_cached_timeline_before("acc-1", &tk("home"), sk, Some(nid), 2)
                    .unwrap(),
            };
            if page.is_empty() {
                break;
            }
            for n in &page {
                seen.push(n.id.clone());
            }
            let last = page.last().unwrap();
            cursor = Some((last.created_at.clone(), last.id.clone()));
        }
        assert_eq!(seen.len(), 5, "重複・欠落なく全件回収");
        let mut dedup = seen.clone();
        dedup.sort();
        dedup.dedup();
        assert_eq!(dedup.len(), 5);
    }

    #[test]
    fn timeline_before_without_note_id_is_inclusive() {
        // note_id なしは現行互換の包含比較 (境界重複はフロント dedup が吸収)
        let (_dir, db) = temp_db();
        db.ingest_notes(
            &[
                note_with_created_at("n1", "acc-1", "2025-06-01T00:00:00Z"),
                note_with_created_at("n2", "acc-1", "2025-06-02T00:00:00Z"),
            ],
            &tk("home"),
        )
        .unwrap();
        let page = db
            .get_cached_timeline_before("acc-1", &tk("home"), "2025-06-01T00:00:00Z", None, 10)
            .unwrap();
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, "n1");
    }

    #[test]
    fn ttl_cascade_removes_memberships() {
        // §9-5: TTL の entity 削除が CASCADE で所属を道連れにする
        let (_dir, db) = temp_db();
        let note = sample_note("n1", "old note");
        db.ingest_notes(std::slice::from_ref(&note), &tk("home"))
            .unwrap();
        db.ingest_notes(&[note], &tk("social")).unwrap();
        set_cached_at(&db, "n1", 1000);

        let cfg = EvictionConfig {
            per_account_limit: None,
            ttl_days: Some(1),
            per_timeline_limit: None,
        };
        db.cleanup_with_eviction(&cfg).unwrap();
        assert!(db
            .get_cached_timeline("acc-1", &tk("home"), 10)
            .unwrap()
            .is_empty());
        assert!(db
            .get_cached_timeline("acc-1", &tk("social"), 10)
            .unwrap()
            .is_empty());
        let conn = db.lock().unwrap();
        let memberships: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_timelines", [], |r| r.get(0))
            .unwrap();
        assert_eq!(memberships, 0);
    }

    #[test]
    fn per_timeline_trim_runs_when_only_it_is_set() {
        // §9-5: per_timeline_limit のみ設定でもトリムが走る (早期 return 回帰)
        let (_dir, db) = temp_db();
        for i in 0..5 {
            db.ingest_notes(
                &[note_with_created_at(
                    &format!("n{i}"),
                    "acc-1",
                    &format!("2025-06-0{}T00:00:00Z", i + 1),
                )],
                &tk("home"),
            )
            .unwrap();
        }
        let cfg = EvictionConfig {
            per_account_limit: None,
            ttl_days: None,
            per_timeline_limit: Some(2),
        };
        let deleted = db.cleanup_with_eviction(&cfg).unwrap();
        // membership 3 + orphan entity 3
        assert_eq!(deleted, 6);
        let remaining = db.get_cached_timeline("acc-1", &tk("home"), 10).unwrap();
        assert_eq!(remaining.len(), 2);
        // sort_key 降順で最新 2 件が残る
        assert_eq!(remaining[0].id, "n4");
        assert_eq!(remaining[1].id, "n3");
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 2);
    }

    #[test]
    fn per_timeline_trim_releases_writer_lock_between_chunks() {
        // チャンク分割の目的は writer Mutex を手放して他の書込を割り込ませること。
        // lock を握りっぱなしだと (tx だけ分割しても) この ingest は完走まで待たされる。
        use std::sync::Arc;
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open(&dir.path().join("test.db")).unwrap());
        for i in 0..200 {
            db.ingest_notes(
                &[note_with_created_at(
                    &format!("n{i:03}"),
                    "acc-1",
                    &format!("2025-06-01T00:00:{:02}Z", i % 60),
                )],
                &tk("home"),
            )
            .unwrap();
        }

        let trimmer = Arc::clone(&db);
        let handle = std::thread::spawn(move || {
            trimmer
                .cleanup_with_eviction(&EvictionConfig {
                    per_account_limit: None,
                    ttl_days: None,
                    per_timeline_limit: Some(1),
                })
                .unwrap()
        });

        // トリム中でも新規 ingest が完了できる (デッドロック・恒久ブロックしない)
        db.ingest_notes(&[note_for_account("concurrent", "acc-1")], &tk("social"))
            .unwrap();
        let deleted = handle.join().unwrap();
        assert!(deleted > 0);
        assert_eq!(
            db.get_cached_timeline("acc-1", &tk("social"), 10)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn per_timeline_trim_keeps_shared_entities() {
        // §9-5: トリムで membership を失っても他バケット所属の entity は残る
        let (_dir, db) = temp_db();
        for i in 0..3 {
            let note = note_with_created_at(
                &format!("n{i}"),
                "acc-1",
                &format!("2025-06-0{}T00:00:00Z", i + 1),
            );
            db.ingest_notes(std::slice::from_ref(&note), &tk("home"))
                .unwrap();
            db.ingest_notes(&[note], &tk("social")).unwrap();
        }
        let cfg = EvictionConfig {
            per_account_limit: None,
            ttl_days: None,
            per_timeline_limit: Some(1),
        };
        db.cleanup_with_eviction(&cfg).unwrap();
        // home / social とも最新 1 件ずつ残り、entity は共有されているため
        // どちらのバケットの生存分も account_cache_count に含まれる
        assert_eq!(
            db.get_cached_timeline("acc-1", &tk("home"), 10)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            db.get_cached_timeline("acc-1", &tk("social"), 10)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 1);
    }

    #[test]
    fn per_timeline_trim_uses_added_at_for_favorites() {
        // §9-5: Favorites バケットは added_at (初回取得時刻) 降順で残す
        let (_dir, db) = temp_db();
        // created_at は新しいが最初に取得されたノート
        db.ingest_notes(
            &[note_with_created_at(
                "newer-first",
                "acc-1",
                "2025-06-09T00:00:00Z",
            )],
            &tk("favorites"),
        )
        .unwrap();
        // created_at は古いが後から取得された (backfill) ノート
        db.ingest_notes(
            &[note_with_created_at(
                "older-later",
                "acc-1",
                "2025-01-01T00:00:00Z",
            )],
            &tk("favorites"),
        )
        .unwrap();
        {
            // added_at を明示的に差別化 (同秒対策)
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE note_timelines SET added_at = 100 WHERE note_id = 'newer-first'",
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE note_timelines SET added_at = 200 WHERE note_id = 'older-later'",
                [],
            )
            .unwrap();
        }
        let cfg = EvictionConfig {
            per_account_limit: None,
            ttl_days: None,
            per_timeline_limit: Some(1),
        };
        db.cleanup_with_eviction(&cfg).unwrap();
        let remaining = db
            .get_cached_timeline("acc-1", &tk("favorites"), 10)
            .unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(
            remaining[0].id, "older-later",
            "added_at が新しい方 (後から取得) が残る"
        );
    }

    #[test]
    fn clear_account_cache_removes_memberships() {
        // §9-11: clear 系の membership 連動
        let (_dir, db) = temp_db();
        db.ingest_notes(&[note_for_account("n1", "acc-1")], &tk("home"))
            .unwrap();
        db.ingest_notes(&[note_for_account("n2", "acc-2")], &tk("home"))
            .unwrap();
        db.clear_account_cache("acc-1").unwrap();
        {
            let conn = db.lock().unwrap();
            let memberships: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM note_timelines WHERE account_id = 'acc-1'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(memberships, 0);
        }
        assert_eq!(
            db.get_cached_timeline("acc-2", &tk("home"), 10)
                .unwrap()
                .len(),
            1
        );

        db.clear_all_notes_cache().unwrap();
        let conn = db.lock().unwrap();
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM note_timelines", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 0);
    }

    #[test]
    fn cascade_delete_uses_membership_index_with_stat1() {
        // §9-17: stat1 存在下で親 DELETE の CASCADE が idx_note_timelines_note を使う
        // (stat1 なしだと WITHOUT ROWID PK の prefix スキャンに落ちる — 実測 2000 倍差)
        let (_dir, db) = temp_db();
        db.ingest_notes(&[sample_note("n1", "note")], &tk("home"))
            .unwrap();
        let conn = db.lock().unwrap();
        conn.execute_batch("ANALYZE;").unwrap();
        let plan: String = conn
            .prepare("EXPLAIN QUERY PLAN DELETE FROM notes_cache WHERE note_id = 'n1' AND account_id = 'acc-1'")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
            .join(" | ");
        assert!(
            plan.contains("idx_note_timelines_note"),
            "CASCADE の子スキャンが idx_note_timelines_note を使うこと: {plan}"
        );
    }

    #[test]
    fn v6_migrates_old_timeline_type_rows() {
        // §9-4: V5 時点の旧 DB fixture → V6 適用で membership 復元・壊れキー消滅・FTS 健全
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("old.db");
        {
            let mut conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(PRAGMAS_WRITER).unwrap();
            embedded::migrations::runner()
                .set_grouped(true)
                .set_target(refinery::Target::Version(5))
                .run(&mut conn)
                .unwrap();
            // 旧形式の行を直接 INSERT (正キー 2 種 + 壊れキー 2 種)
            let insert = |id: &str, tl: &str| {
                conn.execute(
                    "INSERT INTO notes_cache (note_id, account_id, server_host, created_at, text, note_json, cached_at, timeline_type)
                     VALUES (?1, 'acc-1', 'misskey.io', '2025-01-01T00:00:00Z', 'migration test text', ?2, 42, ?3)",
                    params![
                        id,
                        serde_json::to_string(&sample_note(id, "migration test text")).unwrap(),
                        tl
                    ],
                )
                .unwrap();
            };
            insert("good-home", "home");
            insert("good-antenna", "antenna:a1");
            insert("broken-empty", "");
            insert("broken-userlist", "user-list");
        }
        // 再 open で V6 が適用される
        let db = Database::open(&db_path).unwrap();
        assert_eq!(
            db.get_cached_timeline("acc-1", &tk("home"), 10)
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            db.get_cached_timeline("acc-1", &tk("antenna:a1"), 10)
                .unwrap()
                .len(),
            1
        );
        // 壊れキー行は migration 内 DELETE で消滅
        assert_eq!(db.account_cache_count("acc-1").unwrap(), 2);
        // added_at = 旧 cached_at の近似移行
        {
            let conn = db.lock().unwrap();
            let added_at: i64 = conn
                .query_row(
                    "SELECT added_at FROM note_timelines WHERE note_id = 'good-home'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(added_at, 42);
            // FTS integrity-check が通る
            conn.execute_batch("INSERT INTO notes_fts(notes_fts) VALUES('integrity-check');")
                .unwrap();
        }
        // FTS 検索が移行後も動く
        let hits = db.search_cached_notes("acc-1", "migration", 10).unwrap();
        assert_eq!(hits.len(), 2);
    }

    // ---- identity (notedeck#1058) ----

    fn variant(id: &str, account_id: &str, host: &str, uri: Option<&str>) -> NormalizedNote {
        let mut n = sample_note(id, "hello identity");
        n.account_id = account_id.to_string();
        n.server_host = host.to_string();
        n.uri = uri.map(str::to_string);
        n.fill_identity();
        n
    }

    #[test]
    fn find_notes_by_identity_bundles_local_row_and_activity_row() {
        let (_dir, db) = temp_db();
        // origin 側の純粋 Renote 行 (uri なし) と、連合先が Announce の id を uri に持つ行
        let origin = variant("r1", "acc-1", "origin.example", None);
        let remote = variant(
            "localB",
            "acc-2",
            "b.example",
            Some("https://origin.example/notes/r1/activity"),
        );
        db.ingest_notes(&[origin, remote], &tk("home")).unwrap();

        let hits = db
            .find_notes_by_identity("https://origin.example/notes/r1")
            .unwrap();
        assert_eq!(hits.len(), 2);
        for n in &hits {
            assert_eq!(n.identity, "https://origin.example/notes/r1");
        }
        let by_account: std::collections::HashSet<_> =
            hits.iter().map(|n| n.account_id.as_str()).collect();
        assert!(by_account.contains("acc-1") && by_account.contains("acc-2"));
        // 生の URI の大文字 host でも同じ規則で正規化して引ける
        let hits = db
            .find_notes_by_identity("HTTPS://Origin.Example/notes/r1")
            .unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn find_notes_by_identity_sets_origin_and_trusted_flags() {
        let (_dir, db) = temp_db();
        let mut origin = variant("x1", "acc-1", "origin.example", None);
        origin.user.host = None;
        let mut remote = variant(
            "localB",
            "acc-2",
            "b.example",
            Some("https://origin.example/notes/x1"),
        );
        remote.user.host = Some("origin.example".to_string());
        let mut spoofed = variant(
            "localC",
            "acc-3",
            "c.example",
            Some("https://origin.example/notes/x1"),
        );
        spoofed.user.host = Some("evil.example".to_string());
        spoofed.fill_identity();
        db.ingest_notes(&[origin, remote, spoofed], &tk("home"))
            .unwrap();

        let hits = db
            .find_notes_by_identity("https://origin.example/notes/x1")
            .unwrap();
        let get = |acc: &str| hits.iter().find(|n| n.account_id == acc).unwrap().clone();
        assert!(get("acc-1").is_origin && get("acc-1").identity_trusted);
        assert!(!get("acc-2").is_origin && get("acc-2").identity_trusted);
        assert!(!get("acc-3").is_origin && !get("acc-3").identity_trusted);
    }

    #[test]
    fn backfill_identity_chunk_fills_legacy_rows_and_uri_fallback_bridges_the_gap() {
        let (_dir, db) = temp_db();
        let local = variant("r1", "acc-1", "origin.example", None);
        let remote = variant(
            "localB",
            "acc-2",
            "b.example",
            Some("https://origin.example/notes/r1"),
        );
        db.ingest_notes(&[local, remote], &tk("home")).unwrap();
        // V7 直後の状態を再現: identity 列が空
        {
            let conn = db.lock().unwrap();
            conn.execute("UPDATE notes_cache SET identity = ''", [])
                .unwrap();
        }
        // backfill 前: uri 列のフォールバックで remote だけ拾える (local 行は uri NULL)
        let hits = db
            .find_notes_by_identity("https://origin.example/notes/r1")
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].account_id, "acc-2");

        // 1 行ずつ 2 回で完了、3 回目は 0
        assert_eq!(db.backfill_identity_chunk(1).unwrap(), 1);
        assert_eq!(db.backfill_identity_chunk(1).unwrap(), 1);
        assert_eq!(db.backfill_identity_chunk(1).unwrap(), 0);

        let hits = db
            .find_notes_by_identity("https://origin.example/notes/r1")
            .unwrap();
        assert_eq!(hits.len(), 2);
        let conn = db.lock().unwrap();
        let empty: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM notes_cache WHERE identity = ''",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(empty, 0);
    }

    #[test]
    fn parse_cached_note_fills_identity_for_legacy_json() {
        let (_dir, db) = temp_db();
        let note = variant("n1", "acc-1", "misskey.io", None);
        db.ingest_notes(&[note], &tk("home")).unwrap();
        // 旧世代の JSON (identity 系フィールド無し) を再現
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "UPDATE notes_cache SET note_json = json_remove(note_json, '$._identity', '$._isOrigin', '$._identityTrusted')",
                [],
            )
            .unwrap();
            let json: String = conn
                .query_row("SELECT note_json FROM notes_cache", [], |r| r.get(0))
                .unwrap();
            assert!(!json.contains("_identity"));
        }
        let notes = db.get_cached_timeline("acc-1", &tk("home"), 10).unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].identity, "https://misskey.io/notes/n1");
        assert!(notes[0].is_origin);
        assert!(notes[0].identity_trusted);
        // カラムクエリの走査経路も同じ補完を通る
        let out = db
            .scan_cached_notes("acc-1", None, &[], 10, 1000, None, |n: &NormalizedNote| {
                Some(!n.identity.is_empty())
            })
            .unwrap();
        assert_eq!(out.notes.len(), 1);
    }

    #[test]
    fn search_cached_notes_across_filters_by_author_and_files() {
        let (_dir, db) = temp_db();
        let mut by_alice_local = variant("n1", "acc-1", "a.example", None);
        by_alice_local.user.username = "Alice".to_string();
        by_alice_local.user.host = None;
        let mut by_alice_remote = variant("n2", "acc-2", "b.example", None);
        by_alice_remote.user.username = "alice".to_string();
        by_alice_remote.user.host = Some("a.example".to_string());
        by_alice_remote
            .files
            .push(crate::models::NormalizedDriveFile {
                id: "f1".to_string(),
                name: "img.png".to_string(),
                file_type: "image/png".to_string(),
                url: "https://b.example/f1".to_string(),
                thumbnail_url: None,
                size: 1,
                is_sensitive: false,
                width: None,
                height: None,
                blurhash: None,
            });
        let mut by_bob = variant("n3", "acc-1", "a.example", None);
        by_bob.user.username = "bob".to_string();
        db.ingest_notes(&[by_alice_local, by_alice_remote, by_bob], &tk("home"))
            .unwrap();
        let accounts = ["acc-1", "acc-2"];
        let base = CachedSearchOptions {
            limit: 10,
            ..Default::default()
        };

        // username だけ: 取得元を問わず、大文字小文字も区別しない
        let alice = db
            .search_cached_notes_across(
                &accounts,
                &CachedSearchOptions {
                    author: Some("@alice"),
                    ..base
                },
            )
            .unwrap();
        assert_eq!(alice.len(), 2);

        // name@host: ローカルユーザー (host null) は取得元サーバーで補う
        let alice_at_a = db
            .search_cached_notes_across(
                &accounts,
                &CachedSearchOptions {
                    author: Some("alice@A.example"),
                    ..base
                },
            )
            .unwrap();
        assert_eq!(alice_at_a.len(), 2);
        let alice_at_b = db
            .search_cached_notes_across(
                &accounts,
                &CachedSearchOptions {
                    author: Some("alice@b.example"),
                    ..base
                },
            )
            .unwrap();
        assert!(alice_at_b.is_empty());

        // 添付の有無
        let with_files = db
            .search_cached_notes_across(
                &accounts,
                &CachedSearchOptions {
                    has_files: Some(true),
                    ..base
                },
            )
            .unwrap();
        assert_eq!(with_files.len(), 1);
        assert_eq!(with_files[0].id, "n2");
        let without_files = db
            .search_cached_notes_across(
                &accounts,
                &CachedSearchOptions {
                    has_files: Some(false),
                    ..base
                },
            )
            .unwrap();
        assert_eq!(without_files.len(), 2);
    }

    #[test]
    fn search_cached_notes_across_public_only_drops_private_notes() {
        let (_dir, db) = temp_db();
        let public = variant("n1", "acc-1", "a.example", None);
        let mut followers = variant("n2", "acc-1", "a.example", None);
        followers.visibility = "followers".to_string();
        let mut specified = variant("n3", "acc-1", "a.example", None);
        specified.visibility = "specified".to_string();
        db.ingest_notes(&[public, followers, specified], &tk("home"))
            .unwrap();

        let all = db
            .search_cached_notes_across(
                &["acc-1"],
                &CachedSearchOptions {
                    limit: 10,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(all.len(), 3);
        let only_public = db
            .search_cached_notes_across(
                &["acc-1"],
                &CachedSearchOptions {
                    limit: 10,
                    public_only: true,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(only_public.len(), 1);
        assert_eq!(only_public[0].id, "n1");
    }

    #[test]
    fn search_cached_notes_across_returns_variants_of_all_accounts() {
        let (_dir, db) = temp_db();
        let a = variant(
            "n1",
            "acc-1",
            "a.example",
            Some("https://o.example/notes/z"),
        );
        let b = variant(
            "n2",
            "acc-2",
            "b.example",
            Some("https://o.example/notes/z"),
        );
        let other = variant("n3", "acc-3", "c.example", None);
        db.ingest_notes(&[a, b, other], &tk("home")).unwrap();

        let hits = db
            .search_cached_notes_across(
                &["acc-1", "acc-2"],
                &CachedSearchOptions {
                    query: "identity",
                    limit: 10,
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits
            .iter()
            .all(|n| n.identity == "https://o.example/notes/z"));
        assert!(db
            .search_cached_notes_across(
                &[],
                &CachedSearchOptions {
                    query: "identity",
                    limit: 10,
                    ..Default::default()
                },
            )
            .unwrap()
            .is_empty());
        // 単一アカウント版は横断版の薄いラッパ
        assert_eq!(
            db.search_cached_notes("acc-3", "identity", 10)
                .unwrap()
                .len(),
            1
        );
    }
}
