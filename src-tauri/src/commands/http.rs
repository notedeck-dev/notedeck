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
use std::net::IpAddr;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::vault::ssrf::PinningResolver;

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_TIMEOUT_SECS: u64 = 120;
const MIN_TIMEOUT_SECS: u64 = 1;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024; // 10 MB
const DEFAULT_USER_AGENT: &str = "NoteDeck";

#[derive(Debug, Deserialize, Type)]
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

/// `http.fetch` capability 実装。
///
/// 検証 → reqwest 構築 → 送信 → response 整形 の単線。
#[tauri::command]
#[specta::specta]
pub async fn http_fetch(
    request: HttpFetchRequest,
) -> Result<HttpFetchResponse, String> {
    validate_external_url(&request.url)?;

    let method = parse_method(request.method.as_deref())?;

    let timeout_secs = request
        .timeout_ms
        .map(|ms| ms.div_ceil(1000))
        .unwrap_or(DEFAULT_TIMEOUT_SECS);
    if !(MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&timeout_secs) {
        return Err(format!(
            "timeoutMs must correspond to {}〜{}s (got {}s)",
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

    let response = req.send().await.map_err(|e| format!("request failed: {e}"))?;
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

fn parse_method(method: Option<&str>) -> Result<reqwest::Method, String> {
    let m = method.unwrap_or("GET").to_ascii_uppercase();
    match m.as_str() {
        "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" => {
            reqwest::Method::from_bytes(m.as_bytes()).map_err(|e| format!("invalid method: {e}"))
        }
        _ => Err(format!("method not allowed: {m}")),
    }
}

/// URL が外部公開向けに安全か検証する。host 名が IP 直書きならその IP を、
/// hostname なら reserved TLD を弾く (= 一次防御)。DNS 解決後の IP 検証は
/// http_fetch が注入する PinningResolver が担う (二次防御・rebinding 対策)。
pub fn validate_external_url(url_str: &str) -> Result<(), String> {
    let url =
        reqwest::Url::parse(url_str).map_err(|e| format!("invalid URL: {e}"))?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("only http / https schemes are allowed (got {scheme})"));
    }
    let host = url
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or_else(|| "URL missing host".to_string())?;
    validate_external_host(host)
}

/// host 文字列単体の検証。Misskey 用の `commands::validate_host` とは
/// 「Misskey host 制約 (path 不可など) を引き締めない」点で異なるが、
/// SSRF 防御 (loopback / private / link-local / reserved TLD) は同等。
///
/// vault モジュール (`vault::ssrf`) からも再利用する。
pub(crate) fn validate_external_host(host: &str) -> Result<(), String> {
    let h = host.trim().to_ascii_lowercase();
    if h.is_empty() {
        return Err("host is empty".to_string());
    }
    if h.len() > 253 {
        return Err("host too long".to_string());
    }

    // host が IP literal なら IpAddr メソッドで判定
    let ip_check = if h.starts_with('[') && h.ends_with(']') {
        // IPv6 literal: [::1] 等
        h[1..h.len() - 1].parse::<IpAddr>().ok()
    } else {
        h.parse::<IpAddr>().ok()
    };
    if let Some(ip) = ip_check {
        return check_ip_safe(ip);
    }

    // hostname: 既知の特殊文字列を block
    if matches!(h.as_str(), "localhost" | "broadcasthost") {
        return Err("loopback/private hostname not allowed".to_string());
    }
    if h.ends_with(".local") || h.ends_with(".internal") || h.ends_with(".localhost") {
        return Err("reserved TLD not allowed".to_string());
    }
    Ok(())
}

/// 解決済み IP アドレスが外部接続向けに安全か検証する。
/// vault モジュール (`vault::ssrf` の DNS pinning) からも再利用する。
pub(crate) fn check_ip_safe(ip: IpAddr) -> Result<(), String> {
    if ip.is_loopback() {
        return Err("loopback address not allowed".to_string());
    }
    if ip.is_unspecified() {
        return Err("unspecified address not allowed".to_string());
    }
    if ip.is_multicast() {
        return Err("multicast address not allowed".to_string());
    }
    match ip {
        IpAddr::V4(v4) => {
            if v4.is_private() {
                return Err("private IPv4 not allowed".to_string());
            }
            if v4.is_link_local() {
                return Err("link-local IPv4 not allowed".to_string());
            }
            // 0.0.0.0/8 (current network) はカバー済 (is_unspecified は 0.0.0.0 のみ)
            // ここで 0.x も拒否
            if v4.octets()[0] == 0 {
                return Err("current-network IPv4 not allowed".to_string());
            }
        }
        IpAddr::V6(v6) => {
            // unique local: fc00::/7
            if (v6.segments()[0] & 0xfe00) == 0xfc00 {
                return Err("unique-local IPv6 not allowed".to_string());
            }
            // link-local: fe80::/10
            if (v6.segments()[0] & 0xffc0) == 0xfe80 {
                return Err("link-local IPv6 not allowed".to_string());
            }
            // IPv4-mapped IPv6 (::ffff:x.x.x.x) もチェック
            if let Some(v4) = v6.to_ipv4_mapped() {
                return check_ip_safe(IpAddr::V4(v4));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(url: &str) -> Result<(), String> {
        validate_external_url(url)
    }

    #[test]
    fn allows_public_https() {
        check("https://example.com/path?q=1").unwrap();
        check("https://api.github.com/zen").unwrap();
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert!(check("file:///etc/passwd").is_err());
        assert!(check("ftp://example.com").is_err());
        assert!(check("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_localhost_and_loopback() {
        assert!(check("http://localhost/").is_err());
        assert!(check("http://localhost:19820/").is_err());
        assert!(check("http://127.0.0.1/").is_err());
        assert!(check("http://127.255.0.1/").is_err());
        assert!(check("http://[::1]/").is_err());
    }

    #[test]
    fn rejects_private_ipv4_ranges() {
        assert!(check("http://10.0.0.1/").is_err());
        assert!(check("http://172.16.0.1/").is_err());
        assert!(check("http://172.31.0.1/").is_err());
        assert!(check("http://192.168.1.1/").is_err());
    }

    #[test]
    fn allows_172_outside_private() {
        check("http://172.15.0.1/").unwrap();
        check("http://172.32.0.1/").unwrap();
    }

    #[test]
    fn rejects_link_local_and_unspecified() {
        assert!(check("http://169.254.169.254/").is_err()); // AWS metadata
        assert!(check("http://0.0.0.0/").is_err());
    }

    #[test]
    fn rejects_ipv4_zero_network() {
        assert!(check("http://0.1.2.3/").is_err());
    }

    #[test]
    fn rejects_reserved_tlds() {
        assert!(check("http://printer.local/").is_err());
        assert!(check("http://app.internal/").is_err());
        assert!(check("http://test.localhost/").is_err());
    }

    #[test]
    fn rejects_ipv6_unique_local_and_link_local() {
        assert!(check("http://[fc00::1]/").is_err());
        assert!(check("http://[fd00::1]/").is_err());
        assert!(check("http://[fe80::1]/").is_err());
    }

    #[test]
    fn rejects_ipv4_mapped_loopback_in_ipv6() {
        // ::ffff:127.0.0.1
        assert!(check("http://[::ffff:7f00:1]/").is_err());
    }

    #[test]
    fn rejects_multicast() {
        assert!(check("http://224.0.0.1/").is_err());
        assert!(check("http://[ff02::1]/").is_err());
    }

    #[test]
    fn rejects_malformed_urls() {
        // Parser-level rejections: just a scheme, or no scheme at all.
        assert!(check("http:").is_err());
        assert!(check("not-a-url").is_err());
    }

    #[test]
    fn rejects_empty_host_directly() {
        // Defence in depth: even if url crate accepts an empty host,
        // validate_external_host should refuse it.
        assert!(validate_external_host("").is_err());
        assert!(validate_external_host("   ").is_err());
    }

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
