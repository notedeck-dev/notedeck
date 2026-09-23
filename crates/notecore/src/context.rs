//! `Core` — notecore の実行文脈 (#1106 段階 0b)。
//!
//! データ系コマンドの本体は「`&Core` と引数を取る関数」で、Misskey クライアント / DB /
//! server_info / OGP キャッシュなど notecore 側の状態はすべてここから引く。アプリ
//! (src-tauri) は 1 つを managed state に置き、notecored も同じものを 1 つ作る。
//!
//! 二段階初期化 (旧 `AppState`): DB が先に使えるようになり (migration 後)、Misskey
//! クライアントは後から揃う。`db()` は前者を、`ready()` / `authed()` は後者を待つ。
//!
//! 手元側にしか無いもの (UI へのヒント通知) は trait で受ける (`HintSink`)。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use notecli::api::MisskeyClient;
use notecli::db::Database;

use crate::credentials::{get_credentials, get_credentials_or_anon};
use crate::error::Result;
use crate::ogp::{OgpCache, OgpData};

/// 手元側 (WebView) へのヒント通知。データ系コマンドの副産物で、無くても処理は成立する。
pub trait HintSink: Send + Sync + 'static {
    /// タイムライン取得時に先読みした OGP (`nd:ogp-hints`)
    fn ogp_hints(&self, hints: HashMap<String, OgpData>);
}

struct Inner {
    db: Arc<Database>,
    client: Arc<MisskeyClient>,
    server_info: Arc<notecli::server_info::ServerInfoService>,
}

pub struct Core {
    // Full init (DB + client) — used by client() and ready()
    rx: tokio::sync::watch::Receiver<Option<Arc<Inner>>>,
    tx: tokio::sync::watch::Sender<Option<Arc<Inner>>>,
    // DB-only early init — used by db()
    db_rx: tokio::sync::watch::Receiver<Option<Arc<Database>>>,
    db_tx: tokio::sync::watch::Sender<Option<Arc<Database>>>,
    /// OGP キャッシュ。初期化後に 1 度だけ差される (無ければ先読みを省く)
    ogp: OnceLock<OgpCache>,
    /// 手元側へのヒント通知。無ければ黙って捨てる (notecored の既定)
    hints: OnceLock<Arc<dyn HintSink>>,
    /// アプリデータディレクトリ (notecli.db / notedeck/ 設定 / キャッシュの置き場)
    app_dir: OnceLock<PathBuf>,
}

impl Default for Core {
    fn default() -> Self {
        Self::new()
    }
}

impl Core {
    pub fn new() -> Self {
        let (tx, rx) = tokio::sync::watch::channel(None);
        let (db_tx, db_rx) = tokio::sync::watch::channel(None);
        Self {
            rx,
            tx,
            db_rx,
            db_tx,
            ogp: OnceLock::new(),
            hints: OnceLock::new(),
            app_dir: OnceLock::new(),
        }
    }

    /// Called as soon as DB is ready (after migrations, before client).
    /// Unblocks all commands that only need `db()`.
    pub fn initialize_db(&self, db: Arc<Database>) {
        let _ = self.db_tx.send(Some(db));
    }

    /// Called once from the background init thread when DB + client are ready.
    pub fn initialize(&self, db: Arc<Database>, client: Arc<MisskeyClient>) {
        // Also signal DB channel in case initialize_db() wasn't called
        let _ = self.db_tx.send(Some(Arc::clone(&db)));
        let server_info =
            notecli::server_info::ServerInfoService::new(Arc::clone(&db), Arc::clone(&client));
        let _ = self.tx.send(Some(Arc::new(Inner {
            db,
            client,
            server_info,
        })));
    }

    /// アプリデータディレクトリを差す (起動時 1 回)。
    pub fn set_app_dir(&self, dir: PathBuf) {
        let _ = self.app_dir.set(dir);
    }

    /// アプリデータディレクトリ。未設定なら Err (テストや初期化順の誤りを黙らせない)。
    pub fn app_dir(&self) -> Result<&Path> {
        self.app_dir
            .get()
            .map(PathBuf::as_path)
            .ok_or_else(|| notecli::error::NoteDeckError::Internal("app dir is not set".into()))
    }

    /// OGP キャッシュを差す (初期化後 1 回)。2 回目以降は無視される。
    pub fn set_ogp(&self, cache: OgpCache) {
        let _ = self.ogp.set(cache);
    }

    pub fn ogp(&self) -> Option<&OgpCache> {
        self.ogp.get()
    }

    /// 手元側へのヒント通知先を差す (初期化後 1 回)。
    pub fn set_hint_sink(&self, sink: Arc<dyn HintSink>) {
        let _ = self.hints.set(sink);
    }

    pub fn hints(&self) -> Option<&dyn HintSink> {
        self.hints.get().map(|s| s.as_ref())
    }

    /// 背景タスクへ持ち出す用
    pub fn hints_arc(&self) -> Option<Arc<dyn HintSink>> {
        self.hints.get().cloned()
    }

    /// Non-blocking check of full readiness (DB + MisskeyClient). Used by the
    /// healthcheck so it can report startup state without awaiting init.
    pub fn is_ready(&self) -> bool {
        self.rx.borrow().is_some()
    }

    /// Await until DB is ready (fast path — does not wait for MisskeyClient).
    pub async fn db(&self) -> Arc<Database> {
        let mut rx = self.db_rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        Arc::clone(r.as_ref().unwrap())
    }

    /// Await until fully initialized, then return MisskeyClient reference.
    pub async fn client(&self) -> Arc<MisskeyClient> {
        let mut rx = self.rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        Arc::clone(&r.as_ref().unwrap().client)
    }

    /// Await until fully initialized, then return the server-info SWR service.
    pub async fn server_info(&self) -> Arc<notecli::server_info::ServerInfoService> {
        let mut rx = self.rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        Arc::clone(&r.as_ref().unwrap().server_info)
    }

    /// `ready()` + `get_credentials` の定型を 1 行に畳む (#782 R2)。
    /// db を後続で使わないコマンド用 — 使う場合は従来どおり `ready()` を使う。
    pub async fn authed(&self, account_id: &str) -> Result<(Arc<MisskeyClient>, String, String)> {
        let (db, client) = self.ready().await;
        let (host, token) = get_credentials(&db, account_id)?;
        Ok((client, host, token))
    }

    /// 匿名フォールバック版 (公開エンドポイント用)。
    pub async fn authed_or_anon(
        &self,
        account_id: &str,
    ) -> Result<(Arc<MisskeyClient>, String, String)> {
        let (db, client) = self.ready().await;
        let (host, token) = get_credentials_or_anon(&db, account_id)?;
        Ok((client, host, token))
    }

    /// Await until fully initialized, then return both.
    pub async fn ready(&self) -> (Arc<Database>, Arc<MisskeyClient>) {
        let mut rx = self.rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        let inner = r.as_ref().unwrap();
        (Arc::clone(&inner.db), Arc::clone(&inner.client))
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use super::*;

    /// 一時 DB + 実クライアント (ネットワークには出ない) で初期化済みの Core。
    pub fn temp_core() -> (tempfile::TempDir, Core) {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open(&dir.path().join("test.db")).unwrap());
        let client = Arc::new(MisskeyClient::new().unwrap());
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        core.initialize(db, client);
        (dir, core)
    }
}
