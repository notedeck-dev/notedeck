//! サーバー検出結果の SWR キャッシュ (notedeck#782)。
//!
//! フロント (Pinia store) が持っていた「メモリ → DB → ネットワーク」の
//! stale-while-revalidate・TTL 判定・in-flight dedup を Rust 側へ集約する。
//! 保存するのは生の検出結果 ([`ServerDetection`]) で、フォーク解決や
//! feature 判定はアプリ側が読取時に行う。
//!
//! - **fresh** (TTL 内): DB の行をそのまま返す。ネットワークなし
//! - **stale** (TTL 超過): DB の行を即返しつつバックグラウンドで再検出
//!   (オフラインでも stale を維持して壊れない)
//! - **miss**: per-host ロックで dedup してネットワーク検出 → DB 保存

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::api::MisskeyClient;
use crate::db::Database;
use crate::error::NoteDeckError;
use crate::models::ServerDetection;

/// 検出結果の TTL。超過した行は stale 扱いで返しつつ再検出する。
pub const SERVER_DETECTION_TTL_MS: i64 = 24 * 60 * 60 * 1000;

/// TTL 判定の純粋関数部。`get_or_fetch` の分岐はすべてここに集約する。
#[derive(Debug, PartialEq, Eq)]
pub enum CachePlan {
    /// TTL 内 — そのまま返す
    Fresh,
    /// TTL 超過 — stale を返しつつバックグラウンド再検出
    StaleRevalidate,
    /// 行なし — ネットワーク検出が必要
    Miss,
}

pub fn plan_for(row: Option<&ServerDetection>, now_ms: i64, ttl_ms: i64) -> CachePlan {
    match row {
        None => CachePlan::Miss,
        Some(det) if now_ms - det.updated_at < ttl_ms => CachePlan::Fresh,
        Some(_) => CachePlan::StaleRevalidate,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct ServerInfoService {
    db: Arc<Database>,
    client: Arc<MisskeyClient>,
    /// miss 時の per-host dedup ロック。同一 host への同時要求を直列化し、
    /// 2 本目以降はロック取得後の DB 再読込で検出済みの行を拾う。
    inflight: tokio::sync::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// stale 再検出の実行中 host 集合 (spawn の重複起動防止)。
    revalidating: Mutex<HashSet<String>>,
}

impl ServerInfoService {
    pub fn new(db: Arc<Database>, client: Arc<MisskeyClient>) -> Arc<Self> {
        Arc::new(Self {
            db,
            client,
            inflight: tokio::sync::Mutex::new(HashMap::new()),
            revalidating: Mutex::new(HashSet::new()),
        })
    }

    /// SWR 取得。fresh は即返し、stale は返しつつ背景再検出、miss は検出して保存。
    pub async fn get_or_fetch(
        self: &Arc<Self>,
        host: &str,
    ) -> Result<ServerDetection, NoteDeckError> {
        let row = self.db.get_server_detection(host)?;
        match plan_for(row.as_ref(), now_ms(), SERVER_DETECTION_TTL_MS) {
            CachePlan::Fresh => Ok(row.expect("fresh implies row")),
            CachePlan::StaleRevalidate => {
                self.spawn_revalidate(host);
                Ok(row.expect("stale implies row"))
            }
            CachePlan::Miss => {
                let lock = self.host_lock(host).await;
                let _guard = lock.lock().await;
                // ロック待機中に先行リクエストが保存した行を拾う (dedup)
                if let Some(det) = self.db.get_server_detection(host)? {
                    if plan_for(Some(&det), now_ms(), SERVER_DETECTION_TTL_MS) == CachePlan::Fresh {
                        return Ok(det);
                    }
                }
                self.detect_and_store(host).await
            }
        }
    }

    /// 強制ネットワーク検出 + DB 保存。ログイン完了直後など、キャッシュを
    /// 確実に上書きしたい場面で使う。
    pub async fn detect_and_store(&self, host: &str) -> Result<ServerDetection, NoteDeckError> {
        let det = self.detect(host).await?;
        self.db.upsert_server_detection(&det)?;
        Ok(det)
    }

    /// nodeinfo (必須) + /api/meta (失敗許容) を並列取得して生の検出結果を作る。
    async fn detect(&self, host: &str) -> Result<ServerDetection, NoteDeckError> {
        let (nodeinfo, meta) = tokio::join!(
            self.client.fetch_nodeinfo(host),
            self.client.fetch_server_meta(host),
        );
        let nodeinfo = nodeinfo?;
        let software = &nodeinfo["software"];
        // meta はオフライン/非公開でも動くよう失敗を握りつぶす (アプリ側は
        // favicon フォールバックで表示する)
        let meta_json = meta
            .map(|v| v.to_string())
            .unwrap_or_else(|_| "{}".to_string());
        Ok(ServerDetection {
            host: host.to_string(),
            software_name: software["name"].as_str().unwrap_or("").to_string(),
            software_version: software["version"].as_str().unwrap_or("").to_string(),
            software_repository: software["repository"].as_str().map(|s| s.to_string()),
            meta_json,
            updated_at: now_ms(),
        })
    }

    fn spawn_revalidate(self: &Arc<Self>, host: &str) {
        {
            let mut set = self.revalidating.lock().unwrap_or_else(|e| e.into_inner());
            if !set.insert(host.to_string()) {
                return; // 既に再検出中
            }
        }
        let this = Arc::clone(self);
        let host = host.to_string();
        tokio::spawn(async move {
            // オフライン等の失敗は無視して stale を維持する
            let _ = this.detect_and_store(&host).await;
            let mut set = this.revalidating.lock().unwrap_or_else(|e| e.into_inner());
            set.remove(&host);
        });
    }

    async fn host_lock(&self, host: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut map = self.inflight.lock().await;
        Arc::clone(map.entry(host.to_string()).or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn sample(updated_at: i64) -> ServerDetection {
        ServerDetection {
            host: "misskey.io".into(),
            software_name: "misskey".into(),
            software_version: "2025.3.0".into(),
            software_repository: None,
            meta_json: "{}".into(),
            updated_at,
        }
    }

    #[test]
    fn plan_fresh_within_ttl() {
        let det = sample(1_000);
        assert_eq!(plan_for(Some(&det), 1_000 + 99, 100), CachePlan::Fresh);
        assert_eq!(
            plan_for(Some(&det), 1_000 + 100, 100),
            CachePlan::StaleRevalidate
        );
        assert_eq!(plan_for(None, 0, 100), CachePlan::Miss);
    }

    fn temp_db() -> (TempDir, Arc<Database>) {
        let dir = TempDir::new().unwrap();
        let db = Database::open(&dir.path().join("test.db")).unwrap();
        (dir, Arc::new(db))
    }

    /// NOTECLI_INSECURE_HOSTS はプロセス共有 env のため、これを触る
    /// ネットワーク系テストはこの lock で直列化する。
    static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    fn register_insecure_host(host: &str) {
        let merged = match std::env::var("NOTECLI_INSECURE_HOSTS") {
            Ok(v) if !v.is_empty() => format!("{v},{host}"),
            _ => host.to_string(),
        };
        std::env::set_var("NOTECLI_INSECURE_HOSTS", merged);
    }

    /// wiremock を Misskey サーバーに見立てる。fetch_nodeinfo は
    /// `{scheme}://{host}/...` を直接叩くため、insecure host 登録で
    /// http://127.0.0.1:PORT へ向ける。
    async fn mock_misskey() -> (MockServer, String) {
        let server = MockServer::start().await;
        let host = server.uri().trim_start_matches("http://").to_string();
        register_insecure_host(&host);

        Mock::given(method("GET"))
            .and(path("/.well-known/nodeinfo"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "links": [{
                    "rel": "http://nodeinfo.diaspora.software/ns/schema/2.1",
                    "href": format!("http://{host}/nodeinfo/2.1"),
                }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/nodeinfo/2.1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "software": {
                    "name": "misskey",
                    "version": "2025.4.0",
                    "repository": "https://github.com/misskey-dev/misskey",
                }
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/meta"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "iconUrl": "/icon.png",
                "themeColor": "#86b300",
            })))
            .mount(&server)
            .await;
        (server, host)
    }

    /// ネットワーク系テストは NOTECLI_INSECURE_HOSTS (プロセス共有 env) を
    /// 使うため 1 つの async テストにまとめて直列化する。
    #[tokio::test]
    async fn swr_miss_then_fresh_then_stale() {
        let _env = ENV_LOCK.lock().await;
        let (_server, host) = mock_misskey().await;
        let (_dir, db) = temp_db();
        let client = Arc::new(MisskeyClient::new().unwrap());
        let svc = ServerInfoService::new(Arc::clone(&db), client);

        // miss: ネットワーク検出して保存
        let det = svc.get_or_fetch(&host).await.unwrap();
        assert_eq!(det.software_name, "misskey");
        assert_eq!(det.software_version, "2025.4.0");
        assert_eq!(
            det.software_repository.as_deref(),
            Some("https://github.com/misskey-dev/misskey")
        );
        assert!(det.meta_json.contains("icon.png"));
        assert!(db.get_server_detection(&host).unwrap().is_some());

        // fresh: DB から返る (同時要求も 1 件に dedup される想定のロック経路)
        let again = svc.get_or_fetch(&host).await.unwrap();
        assert_eq!(again.updated_at, det.updated_at);

        // stale: 古い updated_at に書き換えると stale 行が即返る
        let mut old = det.clone();
        old.updated_at = 1; // 1970 年 = 確実に TTL 切れ
        db.upsert_server_detection(&old).unwrap();
        let stale = svc.get_or_fetch(&host).await.unwrap();
        assert_eq!(stale.updated_at, 1);
        // バックグラウンド再検出が走り、いずれ updated_at が更新される
        for _ in 0..50 {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            let cur = db.get_server_detection(&host).unwrap().unwrap();
            if cur.updated_at > 1 {
                return;
            }
        }
        panic!("background revalidation did not update the row");
    }

    #[tokio::test]
    async fn meta_failure_is_tolerated() {
        let _env = ENV_LOCK.lock().await;
        let server = MockServer::start().await;
        let host = server.uri().trim_start_matches("http://").to_string();
        register_insecure_host(&host);

        Mock::given(method("GET"))
            .and(path("/.well-known/nodeinfo"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "links": [{ "rel": "nodeinfo/2.0", "href": format!("http://{host}/nodeinfo/2.0") }]
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/nodeinfo/2.0"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "software": { "name": "misskey", "version": "2025.4.0" }
            })))
            .mount(&server)
            .await;
        // /api/meta は 500
        Mock::given(method("POST"))
            .and(path("/api/meta"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let (_dir, db) = temp_db();
        let svc = ServerInfoService::new(db, Arc::new(MisskeyClient::new().unwrap()));
        let det = svc.detect_and_store(&host).await.unwrap();
        assert_eq!(det.software_name, "misskey");
        assert_eq!(det.meta_json, "{}");
        assert_eq!(det.software_repository, None);
    }
}
