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
//! - ブラウザが繋がないポート (SMTP / SSH 等) には最初の URL でも redirect の
//!   各 hop でも繋がない
//! - redirect の各 hop の host も一次検査と同じ規則で検査する (名前解決を
//!   通らない IP literal の飛び先は resolver では止まらないため、#1308)
//! - 環境変数のプロキシは使わない (プロキシ経由だと名前解決の検査が効かない)。
//!   Referer は送らない
//!
//! # 制限
//! - response body は 10 MB まで (超過は status 0 + error)
//! - timeout は呼び出し側指定 (1〜120s)、未指定なら 30s
//! - レスポンス body は UTF-8 文字列前提 (バイナリは別途 base64 等を検討)
//!
//! # 失敗の返し方 (#1294)
//! - 要求の形の誤り (URL / method / timeout の範囲 / SSRF 拒否) → Err
//! - 通信断 (名前解決の失敗 / 接続拒否 / タイムアウト / 応答の読み取り失敗 /
//!   body 上限超過) → Ok で `status: 0` + `error`。HTTP の 4xx / 5xx と同じく
//!   値で返すので、try/catch の無い AiScript (ウィジェット) でも分岐できる

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ssrf::{
    check_port_safe, external_redirect_policy, validate_external_url, PinningResolver,
};

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

#[derive(Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpFetchResponse {
    /// HTTP ステータス。通信断 (名前解決の失敗 / 接続拒否 / タイムアウト /
    /// 応答の読み取り失敗) は 0 で、理由は `error` に入る (#1294)
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    /// 通信断の理由。status が 0 のときだけ Some
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl HttpFetchResponse {
    /// 通信断を表す応答。要求の形は正しかったが相手に届かなかった /
    /// 応答が使えなかったときに返す。AiScript には try/catch が無いので、
    /// Err (= throw) にするとウィジェットが「通信できません」を描けない
    fn transport_failure(message: String) -> Self {
        Self {
            status: 0,
            headers: HashMap::new(),
            body: String::new(),
            error: Some(message),
        }
    }
}

/// 外向き fetch の client。fetch ごとに 1 つ作る (resolver の pin が fetch 単位)。
///
/// - DNS pinning resolver: 名前解決後の IP を check_ip_safe で検証してから接続する。
///   validate_external_url の host 文字列検査だけでは、A レコードが loopback /
///   private / メタデータ (169.254.169.254) を指す公開ホスト名や DNS rebinding を
///   防げない
/// - redirect の各 hop は external_redirect_policy で host と port を一次検査と同じ
///   規則で検査する。resolver は名前解決を通らない IP literal の飛び先を見ないので、
///   `Policy::limited` のままだと `Location: http://127.0.0.1/...` が通る (#1308)
/// - no_proxy: 環境変数のプロキシに流れると、対象 host をこちらで名前解決しないので
///   resolver の検査そのものが効かない (vault の外向き fetch と同じ)
/// - referer(false): プラグインが組んだ URL (query を含む) を飛び先に漏らさない
fn build_client(timeout: Duration) -> std::result::Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(external_redirect_policy(5))
        .dns_resolver(Arc::new(PinningResolver::new()))
        .no_proxy()
        .referer(false)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

async fn http_fetch_inner(
    request: HttpFetchRequest,
) -> std::result::Result<HttpFetchResponse, String> {
    validate_external_url(&request.url)?;
    // validate_external_url が通った URL は解析できる。最初の URL のポートも
    // redirect の各 hop と同じ規則で検査する
    let parsed = reqwest::Url::parse(&request.url).map_err(|e| format!("invalid URL: {e}"))?;
    check_port_safe(parsed.port())?;

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

    let client = build_client(Duration::from_secs(timeout_secs))?;

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

    let response = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(HttpFetchResponse::transport_failure(format!(
                "request failed: {e}"
            )))
        }
    };
    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(s) = value.to_str() {
            headers.insert(name.as_str().to_string(), s.to_string());
        }
    }

    // Body size guard: bytes() で読みきり、その後 size 検証
    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return Ok(HttpFetchResponse::transport_failure(format!(
                "response read failed: {e}"
            )))
        }
    };
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Ok(HttpFetchResponse::transport_failure(format!(
            "response body exceeds {} bytes limit ({})",
            MAX_RESPONSE_BYTES,
            bytes.len()
        )));
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();

    Ok(HttpFetchResponse {
        status,
        headers,
        body,
        error: None,
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

    /// 通信断 (名前解決の失敗 / 接続拒否 / タイムアウト) は Err ではなく
    /// status 0 の応答。AiScript には try/catch が無いので、throw にすると
    /// ウィジェットが「通信できません」を描けない (#1294)
    #[tokio::test]
    async fn transport_failure_is_a_status_zero_response() {
        let res = http_fetch_inner(HttpFetchRequest {
            // RFC 6761 の予約 TLD: 名前解決が必ず失敗する
            url: "https://nonexistent.invalid/".into(),
            method: None,
            headers: None,
            body: None,
            timeout_ms: Some(2_000),
        })
        .await
        .expect("transport failure must not be Err");
        assert_eq!(res.status, 0);
        assert!(res.body.is_empty());
        assert!(res.headers.is_empty());
        assert!(res
            .error
            .as_deref()
            .unwrap_or("")
            .starts_with("request failed: "));
    }

    /// 最初の URL のポートも、ブラウザが繋がないポート (SMTP 等) なら Err (#1308)
    #[tokio::test]
    async fn bad_port_in_first_url_is_an_error() {
        let err = http_fetch_inner(HttpFetchRequest {
            url: "https://example.com:25/".into(),
            ..Default::default()
        })
        .await
        .expect_err("bad port must be rejected before any request");
        assert!(err.contains("port"), "{err}");
    }

    /// 名前解決を通らない IP literal の飛び先は resolver では止まらない。
    /// client のリダイレクト方針で各 hop を検査する (#1308)
    #[tokio::test]
    async fn client_refuses_redirect_to_ip_literal() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = axum::Router::new()
            .route(
                "/r",
                axum::routing::get(move || async move {
                    axum::response::Redirect::temporary(&format!("http://{addr}/ok"))
                }),
            )
            .route("/ok", axum::routing::get(|| async { "internal" }));
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = build_client(Duration::from_secs(5)).unwrap();
        let err = client
            .get(format!("http://{addr}/r"))
            .send()
            .await
            .expect_err("redirect to a loopback literal must not be followed");
        assert!(err.is_redirect(), "{err:#}");
    }

    /// 要求の形の誤り (method / timeout の範囲 / SSRF) は従来どおり Err
    #[tokio::test]
    async fn invalid_request_shape_is_still_an_error() {
        let res = http_fetch_inner(HttpFetchRequest {
            url: "http://127.0.0.1/".into(),
            method: None,
            headers: None,
            body: None,
            timeout_ms: None,
        })
        .await;
        assert!(res.is_err());
    }
}
