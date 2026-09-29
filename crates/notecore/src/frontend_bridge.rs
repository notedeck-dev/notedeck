//! HTTP API (core) から手元側へ問い合わせる口 (#1106)。
//!
//! 一部のルート (デッキ構成 / コマンド一覧 / capability 実行 / ヘルスチェックの
//! frontend 部) は WebView や Tauri の managed state を見ないと答えられない。
//! core はそれらを直接知らず、この trait を通して手元側に聞く。アプリの中では
//! Tauri 側 (`query_bridge.rs`) が実装し、notemaid では接続中の端末に中継する
//! (端末が居なければ「フロントなし」)。
//!
//! 手元の索引 (notes キャッシュ) も端末にしか無いので、それを読む問い合わせは
//! 型付きの `archive_search` で受ける (notemaid の `notes.searchArchive` が使う)。

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `archive_search` の wire 上の問い合わせ名 (notemaid → 端末)
pub const ARCHIVE_SEARCH_QUERY: &str = "archive/search";
/// 外部アプリ用の永続トークンの発行 / 失効 (手元の CLI に MCP サーバーを渡すため、#1104)
pub const TOKEN_ISSUE_QUERY: &str = "api-token/issue";
pub const TOKEN_REVOKE_QUERY: &str = "api-token/revoke";

/// 手元の索引の横断検索 (#947)。`commands::timeline::search_archive` の引数と同じ
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveSearchRequest {
    pub account_ids: Vec<String>,
    #[serde(default)]
    pub query: String,
    pub limit: u32,
    #[serde(default)]
    pub since: Option<String>,
    #[serde(default)]
    pub until: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub has_files: Option<bool>,
    #[serde(default)]
    pub public_only: bool,
}

pub type BridgeFuture<'a> = Pin<Box<dyn Future<Output = Result<Value, String>> + Send + 'a>>;

pub trait FrontendBridge: Send + Sync + 'static {
    /// WebView (Pinia store) へ問い合わせて JSON で受け取る。
    fn query<'a>(
        &'a self,
        query_type: &'a str,
        params: Value,
        timeout: Duration,
    ) -> BridgeFuture<'a>;

    /// 手元側のランタイム状態を含むヘルスレポート (`HealthReport` の JSON)。
    fn health_report(&self) -> BridgeFuture<'_>;

    /// 手元の索引を検索する (`Vec<NormalizedNote>` の JSON)。索引は端末にしか無い
    fn archive_search(&self, req: ArchiveSearchRequest) -> BridgeFuture<'_>;

    /// 外部アプリ用の永続トークンを発行する (`{ id, token }`)。手元の CLI (#1104) に
    /// NoteDeck の MCP サーバーを渡すためで、external principal の権限がそのまま効く
    fn issue_external_token(&self, name: String) -> BridgeFuture<'_>;
    /// 発行したトークンを失効させる (CLI を終えたとき)
    fn revoke_external_token(&self, id: String) -> BridgeFuture<'_>;
}

/// 既定 (5 秒) のタイムアウトで問い合わせる。
pub fn query<'a>(
    bridge: &'a dyn FrontendBridge,
    query_type: &'a str,
    params: Value,
) -> BridgeFuture<'a> {
    bridge.query(query_type, params, Duration::from_secs(5))
}

/// 「フロントなし」の実装 (headless テスト / 端末の居ない notemaid)。問い合わせは全部
/// `device_unavailable` で答え、ターン実行器はデバイス依存の capability を
/// エラーにし、確認内容は core が組む。
pub struct NoDeviceBridge;

impl FrontendBridge for NoDeviceBridge {
    fn query<'a>(
        &'a self,
        query_type: &'a str,
        _params: Value,
        _timeout: Duration,
    ) -> BridgeFuture<'a> {
        Box::pin(async move { Err(format!("no device is connected (query {query_type})")) })
    }

    fn health_report(&self) -> BridgeFuture<'_> {
        Box::pin(async { Ok(Value::Null) })
    }

    fn archive_search(&self, _req: ArchiveSearchRequest) -> BridgeFuture<'_> {
        Box::pin(async { Err("no device is connected (the archive lives on the device)".into()) })
    }

    fn issue_external_token(&self, _name: String) -> BridgeFuture<'_> {
        Box::pin(async { Err("no device is connected (tokens are issued on the device)".into()) })
    }

    fn revoke_external_token(&self, _id: String) -> BridgeFuture<'_> {
        Box::pin(async { Err("no device is connected (tokens are revoked on the device)".into()) })
    }
}
