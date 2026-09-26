//! http のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

//! 汎用 HTTP fetch capability の Rust 側実装。
//!
//! NoteDeck から外部 HTTP API (CORS なし) を叩く共通入口。capability
//! registry の Single Source of Truth 設計により、ここを 5 経路
//! (AI tool calling / AiScript プラグイン / HTTP API / CLI / コマンド
//! パレット) で共用する。Misskey API ではなく汎用 fetch なので SSRF 防御
//! ・size limit・timeout を必ず通す。NoteDeck 自身の localhost API
//! (`localhost:19820`) を deny することで credential bypass を防ぐ。
//!
//! 公開: `http_fetch` Tauri command。Frontend からは
//! `commands.httpFetch` / `Nd:http(...)` / `Nd:call('http.fetch', ...)`
//! で呼ばれる。
//!
//! # SSRF 防御
//! - URL の scheme は http / https のみ
//! - ホスト名解決後に loopback / private / link-local / multicast / 未指定
//!   アドレスへの接続を deny
//! - `.local` / `.internal` / `.localhost` の reserved TLD を deny
//!
//! # 制限
//! - response body は 10 MB まで (超過分は切り捨て + エラー)
//! - timeout は呼び出し側指定 (1〜120s)、未指定なら 30s
//! - レスポンス body は UTF-8 文字列前提 (バイナリは別途 base64 等を検討)

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ssrf::{validate_external_url, PinningResolver};

use crate::context::Core;
use crate::error::Result;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 120;
const MIN_TIMEOUT_SECS: u64 = 1;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024; // 10 MB
const DEFAULT_USER_AGENT: &str = "NoteDeck";

/// Serialize / Default はコマンド表のフィクスチャ用。
#[derive(Debug, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

async fn http_fetch_inner(
    request: HttpFetchRequest,
) -> std::result::Result<HttpFetchResponse, String> {
    validate_external_url(&request.url)?;

    let method = parse_method(request.method.as_deref())?;

    let timeout_secs = request
        .timeout_ms
        .map(|ms| ms.div_ceil(1000))
        .unwrap_or(DEFAULT_TIMEOUT_SECS);
    if !(MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&timeout_secs) {
        return Err(format!(
            "timeoutMs must correspond to {}-{}s (got {}s)",
            MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS, timeout_secs
        ));
    }

    // DNS pinning resolver: 名前解決後の IP を check_ip_safe で検証してから
    // 接続する。validate_external_url の host 文字列検査だけでは、A レコードが
    // loopback / private / メタデータ (169.254.169.254) を指す公開ホスト名や
    // DNS rebinding を防げない。vault の外向き fetch と同じ防御を共有する。
    // resolver は redirect の各 hop でも呼ばれるため、リダイレクト先の内部宛ても
    // 同様に弾かれる。
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(5))
        .dns_resolver(Arc::new(PinningResolver::new()))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let mut req = client.request(method, &request.url);
    let mut has_ua = false;
    if let Some(headers) = &request.headers {
        for (k, v) in headers {
            if k.eq_ignore_ascii_case("user-agent") {
                has_ua = true;
            }
            req = req.header(k, v);
        }
    }
    if !has_ua {
        req = req.header("user-agent", DEFAULT_USER_AGENT);
    }
    if let Some(body) = request.body {
        req = req.body(body);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(s) = value.to_str() {
            headers.insert(name.as_str().to_string(), s.to_string());
        }
    }

    // Body size guard: bytes() で読みきり、その後 size 検証
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("response read failed: {e}"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(format!(
            "response body exceeds {} bytes limit ({})",
            MAX_RESPONSE_BYTES,
            bytes.len()
        ));
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();

    Ok(HttpFetchResponse {
        status,
        headers,
        body,
    })
}

fn parse_method(method: Option<&str>) -> std::result::Result<reqwest::Method, String> {
    let m = method.unwrap_or("GET").to_ascii_uppercase();
    match m.as_str() {
        "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" => {
            reqwest::Method::from_bytes(m.as_bytes()).map_err(|e| format!("invalid method: {e}"))
        }
        _ => Err(format!("method not allowed: {m}")),
    }
}

/// `http.fetch` capability 実装。
///
/// 検証 → reqwest 構築 → 送信 → response 整形 の単線。
/// `http.fetch` のコマンド面。エラー文字列は NoteDeckError::InvalidInput に包む (表の規約)。
pub async fn http_fetch(_core: &Core, request: HttpFetchRequest) -> Result<HttpFetchResponse> {
    http_fetch_inner(request)
        .await
        .map_err(notecli::error::NoteDeckError::InvalidInput)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_method_accepts_common_verbs() {
        for v in ["GET", "post", "Put", "delete", "patch", "HEAD", "OPTIONS"] {
            parse_method(Some(v)).unwrap();
        }
    }

    #[test]
    fn parse_method_rejects_unknown() {
        assert!(parse_method(Some("CONNECT")).is_err());
        assert!(parse_method(Some("FOO")).is_err());
    }

    #[test]
    fn parse_method_defaults_to_get() {
        assert_eq!(parse_method(None).unwrap(), reqwest::Method::GET);
    }
}
