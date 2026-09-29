//! `Core` — notecore の実行文脈 (#1106 段階 0b)。
//!
//! データ系コマンドの本体は「`&Core` と引数を取る関数」で、Misskey クライアント / DB /
//! server_info / OGP キャッシュなど notecore 側の状態はすべてここから引く。アプリ
//! (src-tauri) は 1 つを managed state に置き、notemaid も自分のプロセスに 1 つ作る。
//!
//! 二段階初期化 (旧 `AppState`): DB が先に使えるようになり (migration 後)、Misskey
//! クライアントは後から揃う。`db()` は前者を、`client()` / `authed()` は後者を待つ。
//!
//! **DB を持たない構成** (notemaid): `initialize_client` + `set_account_store` だけで
//! 組み立てる。索引 (notes キャッシュ) はこのプロセスに無いので、取得系の書込は
//! `with_archive` で「索引があるときだけ」にし、`blocking` は待たずに Err で返る。
//! 手元の索引を読む用途は `FrontendBridge::archive_search` で端末に聞く。
//!
//! 手元側にしか無いもの (UI へのヒント通知) は trait で受ける (`HintSink`)。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, Weak};

use notecli::api::MisskeyClient;
use notecli::db::Database;

use crate::commands::auth::AuthSessionTracker;
use crate::credentials::{get_credentials, get_credentials_or_anon};
use crate::error::Result;
use crate::frontend_bridge::FrontendBridge;
use crate::image_cache::ImageCache;
use crate::media_warm::MediaWarmer;
use crate::ogp::{OgpCache, OgpData};
use crate::perf_config::SharedPerfConfig;
use crate::query_runtime::QueryRuntime;
use notecli::error::NoteDeckError;
use notecli::streaming::StreamingManager;

/// 手元側 (WebView) へのヒント通知。データ系コマンドの副産物で、無くても処理は成立する。
/// 名前つきイベントの届け先 (AI の出来事など、上に載るクレートが出すもの)。Tauri は WebView へ
/// emit し、別プロセスは socket のイベント frame にする。notecore は名前も payload も解釈しない
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, name: &'static str, payload: serde_json::Value);
}

pub trait HintSink: Send + Sync + 'static {
    /// タイムライン取得時に先読みした OGP (`nd:ogp-hints`)
    fn ogp_hints(&self, hints: HashMap<String, OgpData>);
}

/// Misskey クライアントと、それに紐づく server_info (DB があれば DB に、無ければメモリに保存)
struct Inner {
    client: Arc<MisskeyClient>,
    server_info: Arc<notecli::server_info::ServerInfoService>,
}

pub struct Core {
    // Misskey client init — used by client() / server_info() / authed()
    rx: tokio::sync::watch::Receiver<Option<Arc<Inner>>>,
    tx: tokio::sync::watch::Sender<Option<Arc<Inner>>>,
    // DB-only early init — used by db()
    db_rx: tokio::sync::watch::Receiver<Option<Arc<Database>>>,
    db_tx: tokio::sync::watch::Sender<Option<Arc<Database>>>,
    /// このプロセスは DB を持たない (`initialize_client` で組み立てた)。`blocking` は待たずに Err
    db_absent: std::sync::atomic::AtomicBool,
    /// 口座の所在 (`AccountStore`)。DB を開く構成では `initialize_db` が DB を差す
    accounts: OnceLock<Arc<dyn crate::accounts::AccountStore>>,
    /// OGP キャッシュ。初期化後に 1 度だけ差される (無ければ先読みを省く)
    ogp: OnceLock<OgpCache>,
    /// 手元側へのヒント通知。無ければ黙って捨てる (notemaid の既定)
    hints: OnceLock<Arc<dyn HintSink>>,
    /// アプリデータディレクトリ (notecli.db / notedeck/ 設定 / キャッシュの置き場)
    app_dir: OnceLock<PathBuf>,
    /// 埋め込む側のバージョン (OpenAPI の info.version / `/api` が返す)
    app_version: OnceLock<String>,
    /// 共有 HTTP クライアント (SSRF 検証 resolver つき)
    http: OnceLock<reqwest::Client>,
    /// 画像キャッシュ
    image_cache: OnceLock<Arc<ImageCache>>,
    /// メディア先行取得キュー
    media_warmer: OnceLock<Arc<MediaWarmer>>,
    /// ストリーミング (WebSocket) 管理
    streaming: OnceLock<Arc<StreamingManager>>,
    /// クエリランタイム (購読台帳 / 差分バッファ)
    query_runtime: OnceLock<Arc<QueryRuntime>>,
    /// Stream Inspector の観測の口 (開いている間だけ生封筒を流す)
    stream_observation: Arc<crate::stream_fanout::StreamObservation>,
    /// パフォーマンス設定 (実行時に更新される)
    perf: OnceLock<SharedPerfConfig>,
    /// 手元側 (WebView / managed state) への問い合わせ口。ターン実行器が
    /// capability の実行要求に使う
    frontend_bridge: OnceLock<Arc<dyn FrontendBridge>>,
    /// 設定ファイルの変更通知 (`settings_events`)。未設定なら黙って捨てる
    settings_sink: OnceLock<Arc<dyn crate::settings_events::SettingsSink>>,
    /// MiAuth セッションの追跡 (リプレイ防止)
    auth_sessions: AuthSessionTracker,
    /// 名前つきイベントの届け先 (`EventSink`)。未設定なら `event_sink()` が Err
    events: OnceLock<Arc<dyn EventSink>>,
    /// `new_shared` で作ったときの自分への弱参照。spawn した task に `Arc<Core>` を渡すため
    weak: OnceLock<Weak<Core>>,
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
            db_absent: std::sync::atomic::AtomicBool::new(false),
            accounts: OnceLock::new(),
            ogp: OnceLock::new(),
            hints: OnceLock::new(),
            stream_observation: Arc::default(),
            app_dir: OnceLock::new(),
            app_version: OnceLock::new(),
            http: OnceLock::new(),
            image_cache: OnceLock::new(),
            media_warmer: OnceLock::new(),
            streaming: OnceLock::new(),
            query_runtime: OnceLock::new(),
            perf: OnceLock::new(),
            frontend_bridge: OnceLock::new(),
            settings_sink: OnceLock::new(),
            auth_sessions: AuthSessionTracker::new(),
            events: OnceLock::new(),
            weak: OnceLock::new(),
        }
    }

    /// Called as soon as DB is ready (after migrations, before client).
    /// Unblocks all commands that only need `db()`.
    pub fn initialize_db(&self, db: Arc<Database>) {
        let _ = self
            .accounts
            .set(Arc::clone(&db) as Arc<dyn crate::accounts::AccountStore>);
        let _ = self.db_tx.send(Some(db));
    }

    /// DB を持たない構成 (notemaid): Misskey クライアントだけを差す。口座は `set_account_store` で。
    /// 以後 `has_db()` は false、`blocking` は Err、`with_archive` は素通しになる
    pub fn initialize_client(&self, client: Arc<MisskeyClient>) {
        self.db_absent
            .store(true, std::sync::atomic::Ordering::Release);
        let server_info =
            notecli::server_info::ServerInfoService::new_in_memory(Arc::clone(&client));
        let _ = self.tx.send(Some(Arc::new(Inner {
            client,
            server_info,
        })));
    }

    /// このプロセスに索引 (DB) があるか。無い構成では取得系の書込を省く
    pub fn has_db(&self) -> bool {
        !self.db_absent.load(std::sync::atomic::Ordering::Acquire)
    }

    /// 今すぐ使える DB (待たない)。初期化前と DB を持たない構成では None
    pub fn try_db(&self) -> Option<Arc<Database>> {
        self.db_rx.borrow().clone()
    }

    /// 口座の所在を差し替える (`initialize_db` より前に呼ぶ)。notemaid は写しを差す
    pub fn set_account_store(&self, store: Arc<dyn crate::accounts::AccountStore>) {
        let _ = self.accounts.set(store);
    }

    pub fn accounts(&self) -> Result<Arc<dyn crate::accounts::AccountStore>> {
        self.accounts
            .get()
            .cloned()
            .ok_or_else(|| NoteDeckError::Internal("account store is not set".into()))
    }

    /// Called once from the background init thread when DB + client are ready.
    pub fn initialize(&self, db: Arc<Database>, client: Arc<MisskeyClient>) {
        // Also signal DB channel in case initialize_db() wasn't called
        let _ = self
            .accounts
            .set(Arc::clone(&db) as Arc<dyn crate::accounts::AccountStore>);
        let _ = self.db_tx.send(Some(Arc::clone(&db)));
        let server_info = notecli::server_info::ServerInfoService::new(db, Arc::clone(&client));
        let _ = self.tx.send(Some(Arc::new(Inner {
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

    pub fn set_app_version(&self, version: String) {
        let _ = self.app_version.set(version);
    }

    pub fn app_version(&self) -> &str {
        self.app_version
            .get()
            .map(String::as_str)
            .unwrap_or("0.0.0")
    }

    pub fn set_http(&self, client: reqwest::Client) {
        let _ = self.http.set(client);
    }

    pub fn http(&self) -> Result<&reqwest::Client> {
        self.http
            .get()
            .ok_or_else(|| NoteDeckError::Internal("http client is not set".into()))
    }

    pub fn set_image_cache(&self, cache: Arc<ImageCache>) {
        let _ = self.image_cache.set(cache);
    }

    pub fn image_cache(&self) -> Result<&Arc<ImageCache>> {
        self.image_cache
            .get()
            .ok_or_else(|| NoteDeckError::Internal("image cache is not set".into()))
    }

    pub fn set_media_warmer(&self, warmer: Arc<MediaWarmer>) {
        let _ = self.media_warmer.set(warmer);
    }

    pub fn media_warmer(&self) -> Result<&Arc<MediaWarmer>> {
        self.media_warmer
            .get()
            .ok_or_else(|| NoteDeckError::Internal("media warmer is not set".into()))
    }

    pub fn set_streaming(&self, streaming: Arc<StreamingManager>) {
        let _ = self.streaming.set(streaming);
    }

    /// ストリーミング管理。初期化前 (DB 準備中) は Err
    pub fn streaming(&self) -> Result<&Arc<StreamingManager>> {
        self.streaming
            .get()
            .ok_or_else(|| NoteDeckError::Internal("streaming is not ready".into()))
    }

    pub fn stream_observation(&self) -> &Arc<crate::stream_fanout::StreamObservation> {
        &self.stream_observation
    }

    pub fn set_query_runtime(&self, runtime: Arc<QueryRuntime>) {
        let _ = self.query_runtime.set(runtime);
    }

    pub fn query_runtime(&self) -> Result<&Arc<QueryRuntime>> {
        self.query_runtime
            .get()
            .ok_or_else(|| NoteDeckError::Internal("query runtime is not set".into()))
    }

    pub fn set_perf(&self, perf: SharedPerfConfig) {
        let _ = self.perf.set(perf);
    }

    pub fn perf(&self) -> Result<&SharedPerfConfig> {
        self.perf
            .get()
            .ok_or_else(|| NoteDeckError::Internal("perf config is not set".into()))
    }

    pub fn set_settings_sink(&self, sink: Arc<dyn crate::settings_events::SettingsSink>) {
        let _ = self.settings_sink.set(sink);
    }

    /// notecore が設定ファイルを書いたことをデバイスに知らせる。sink が無い
    /// (テスト / 未配線) なら no-op
    pub fn notify_settings_change(&self, change: crate::settings_events::SettingsChange) {
        if let Some(sink) = self.settings_sink.get() {
            sink.settings_changed(change);
        }
    }

    pub fn set_frontend_bridge(&self, bridge: Arc<dyn FrontendBridge>) {
        let _ = self.frontend_bridge.set(bridge);
    }

    pub fn frontend_bridge(&self) -> Result<Arc<dyn FrontendBridge>> {
        self.frontend_bridge
            .get()
            .cloned()
            .ok_or_else(|| NoteDeckError::Internal("frontend bridge is not set".into()))
    }

    /// `Arc` で作る。長生きする task (AI のターンなど) が `shared()` で自分の `Arc` を取れる
    pub fn new_shared() -> Arc<Core> {
        Arc::new_cyclic(|w| {
            let core = Core::new();
            let _ = core.weak.set(w.clone());
            core
        })
    }

    /// `new_shared` で作った Core の `Arc`。`new()` で作った (テストなど) 場合は Err
    pub fn shared(&self) -> Result<Arc<Core>> {
        self.weak.get().and_then(Weak::upgrade).ok_or_else(|| {
            NoteDeckError::Internal("core is not shared (use Core::new_shared)".into())
        })
    }

    pub fn set_event_sink(&self, sink: Arc<dyn EventSink>) {
        let _ = self.events.set(sink);
    }

    pub fn event_sink(&self) -> Result<Arc<dyn EventSink>> {
        self.events
            .get()
            .cloned()
            .ok_or_else(|| NoteDeckError::Internal("event sink is not set".into()))
    }

    pub fn auth_sessions(&self) -> &AuthSessionTracker {
        &self.auth_sessions
    }

    /// OGP キャッシュ。未設定なら Err (先読みのような省略可能な用途は `ogp()` を使う)
    pub fn ogp_cache(&self) -> Result<&OgpCache> {
        self.ogp
            .get()
            .ok_or_else(|| NoteDeckError::Internal("ogp cache is not set".into()))
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

    /// 同期の DB 呼び出しを blocking スレッドへ寄せる (#1106 段階 0b)。
    ///
    /// notecli の Database は rusqlite (同期) なので、async のコマンド本体から直接呼ぶと
    /// tokio の worker を塞ぐ (4 スレッドの runtime では連鎖して枯渇する)。行数の多い
    /// 読み書き (取り込み / キャッシュ検索 / 一括削除) は必ずここを通す。
    /// プール化や async API を notecli 側に持たせる判断 (#1098) は、この境界の裏で
    /// 差し替えられる。
    pub async fn blocking<T, F>(&self, f: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&Database) -> Result<T> + Send + 'static,
    {
        if !self.has_db() {
            return Err(NoteDeckError::Internal(
                "this process has no database (the archive lives on the device)".into(),
            ));
        }
        let db = self.db().await;
        tokio::task::spawn_blocking(move || f(&db))
            .await
            .map_err(|e| NoteDeckError::Internal(format!("blocking task failed: {e}")))?
    }

    /// 索引 (DB) があるときだけ `f` を blocking で回し、無ければ `value` をそのまま返す。
    /// 取得したノートをキャッシュへ取り込む類の「あれば書く」処理用 (notemaid は素通し)
    pub async fn with_archive<T, F>(&self, value: T, f: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&Database, T) -> Result<T> + Send + 'static,
    {
        if !self.has_db() {
            return Ok(value);
        }
        self.blocking(move |db| f(db, value)).await
    }

    /// Await until the Misskey client is set (DB を持たない構成でも待てる)。
    pub async fn client(&self) -> Arc<MisskeyClient> {
        let mut rx = self.rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        Arc::clone(&r.as_ref().unwrap().client)
    }

    /// Await until the client is set, then return the server-info SWR service.
    pub async fn server_info(&self) -> Arc<notecli::server_info::ServerInfoService> {
        let mut rx = self.rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        Arc::clone(&r.as_ref().unwrap().server_info)
    }

    /// `client()` + `get_credentials` の定型を 1 行に畳む (#782 R2)。DB を持たない構成でも動く。
    pub async fn authed(&self, account_id: &str) -> Result<(Arc<MisskeyClient>, String, String)> {
        let client = self.client().await;
        let (host, token) = get_credentials(&*self.accounts()?, account_id)?;
        Ok((client, host, token))
    }

    /// 匿名フォールバック版 (公開エンドポイント用)。
    pub async fn authed_or_anon(
        &self,
        account_id: &str,
    ) -> Result<(Arc<MisskeyClient>, String, String)> {
        let client = self.client().await;
        let (host, token) = get_credentials_or_anon(&*self.accounts()?, account_id)?;
        Ok((client, host, token))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct OneAccount;
    impl crate::accounts::AccountStore for OneAccount {
        fn get(&self, id: &str) -> Result<Option<notecli::models::Account>> {
            Ok((id == "a").then(|| notecli::models::Account {
                id: "a".into(),
                host: "example.com".into(),
                token: String::new(),
                user_id: "u".into(),
                username: "n".into(),
                display_name: None,
                avatar_url: None,
                software: "misskey".into(),
            }))
        }
        fn list(&self) -> Result<Vec<notecli::models::Account>> {
            Ok(self.get("a")?.into_iter().collect())
        }
        fn clear_token(&self, _id: &str) -> Result<()> {
            Ok(())
        }
    }

    /// notemaid の組み立て: DB なしでも資格情報 / server_info / 取得系の書込が返る (待ち続けない)
    #[tokio::test]
    async fn client_only_core_never_waits_for_a_database() {
        let core = Core::new_shared();
        core.set_account_store(Arc::new(OneAccount));
        core.initialize_client(Arc::new(MisskeyClient::new().unwrap()));
        assert!(core.is_ready());
        assert!(!core.has_db());
        assert!(core.try_db().is_none());
        let (_, host, token) = core.authed_or_anon("a").await.unwrap();
        assert_eq!((host.as_str(), token.as_str()), ("example.com", ""));
        let _ = core.server_info().await;
        assert!(core.blocking(|_db| Ok(())).await.is_err());
        assert_eq!(core.with_archive(7, |_db, v| Ok(v + 1)).await.unwrap(), 7);
    }
}

/// テスト用の Core。`test-support` feature で他クレート (notemaid) のテストにも開く
#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use super::*;

    /// 一時 DB + 実クライアント (ネットワークには出ない) で初期化済みの Core。
    pub fn temp_core() -> (tempfile::TempDir, Core) {
        let dir = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open(&dir.path().join("test.db")).unwrap());
        let client = Arc::new(MisskeyClient::new().unwrap());
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        core.set_http(reqwest::Client::new());
        core.set_query_runtime(Arc::new(QueryRuntime::default()));
        core.set_perf(Arc::new(tokio::sync::RwLock::new(
            crate::perf_config::PerformanceConfig::default(),
        )));
        core.initialize(db, client);
        (dir, core)
    }
}
