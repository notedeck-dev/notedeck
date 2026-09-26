//! HTTP API (core) から手元側へ問い合わせる口 (#1106)。
//!
//! 一部のルート (デッキ構成 / コマンド一覧 / capability 実行 / ヘルスチェックの
//! frontend 部) は WebView や Tauri の managed state を見ないと答えられない。
//! core はそれらを直接知らず、この trait を通して手元側に聞く。ローカル構成では
//! Tauri 側 (`query_bridge.rs`) が実装し、notecored では「フロントなし」を返す
//! 実装を渡す (段階 3a)。

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use serde_json::Value;

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
}

/// 既定 (5 秒) のタイムアウトで問い合わせる。
pub fn query<'a>(
    bridge: &'a dyn FrontendBridge,
    query_type: &'a str,
    params: Value,
) -> BridgeFuture<'a> {
    bridge.query(query_type, params, Duration::from_secs(5))
}

/// 「フロントなし」の実装 (headless / notecored)。問い合わせは全部
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
}
