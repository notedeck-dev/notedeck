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

use std::collections::{BTreeSet, HashMap};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::ssrf::{external_fetch_builder, loopback_port, validate_external_url};

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

/// 1 回の fetch に許す例外 (#1293)。要求の形 ([`HttpFetchRequest`]) とは分けて
/// 持ち、呼び出し側 (notemaid の exec) が同意の記録から組む。params から来る
/// 構造体には載せない (プラグインが `Nd:call('http.fetch', …)` で直接組めるため)。
/// Deserialize / specta は付けず、コマンド表にも載せない
#[derive(Debug, Default, Clone)]
pub struct FetchPolicy {
    /// この端末の中 (loopback の 3 表記) で繋いでよいポート。空なら従来どおり
    /// loopback は一次検査で拒む
    pub loopback_ports: BTreeSet<u16>,
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

/// 外向き fetch の client。SSRF 防御の土台は `ssrf::external_fetch_builder`
/// (redirect の各 hop の検査 / DNS pinning / no_proxy / referer なし) と共有し、
/// fetch ごとに 1 つ作る
fn build_client(timeout: Duration) -> std::result::Result<reqwest::Client, String> {
    external_fetch_builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

/// 同意済みの loopback 宛 (#1293) の client。外向きの client と違い名前解決は
/// 起きない (`localhost` は 127.0.0.1 の 1 つに固定する。::1 も渡すとダイアログの
/// 表示と違うソケットに繋がりうる) ので resolver は付けない。redirect は最初の
/// 要求と同じ host:port の loopback 宛だけ追う (外から loopback へも、loopback から
/// 外へも、境界をまたぐ hop は拒む)
fn build_loopback_client(
    timeout: Duration,
    host: &str,
    port: u16,
) -> std::result::Result<reqwest::Client, String> {
    let host = host.to_ascii_lowercase();
    reqwest::Client::builder()
        .redirect(loopback_redirect_policy(5, host.clone(), port))
        .resolve(
            "localhost",
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        )
        .no_proxy()
        .referer(false)
        .timeout(timeout)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

fn loopback_redirect_policy(max: usize, host: String, port: u16) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= max {
            return attempt.error("too many redirects");
        }
        let url = attempt.url();
        let same_target = url
            .host_str()
            .map(|h| h.eq_ignore_ascii_case(&host))
            .unwrap_or(false)
            && loopback_port(url) == Some(port);
        if same_target {
            attempt.follow()
        } else {
            attempt.error("redirect leaves the consented loopback target")
        }
    })
}

/// 同意済みの loopback 宛なら `Some((host, port))`。それ以外 (外向き、または
/// 同意の無い loopback) は None で、従来の一次検査に進む
fn consented_loopback(url_str: &str, policy: &FetchPolicy) -> Option<(String, u16)> {
    if policy.loopback_ports.is_empty() {
        return None;
    }
    let url = reqwest::Url::parse(url_str).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    let port = loopback_port(&url)?;
    if !policy.loopback_ports.contains(&port) {
        return None;
    }
    Some((url.host_str()?.to_string(), port))
}

async fn http_fetch_inner(
    request: HttpFetchRequest,
    policy: &FetchPolicy,
) -> std::result::Result<HttpFetchResponse, String> {
    let loopback = consented_loopback(&request.url, policy);
    if loopback.is_none() {
        // scheme / host / port の一次検査 (ポートも redirect の各 hop と同じ規則、#1308)
        validate_external_url(&request.url)?;
    }

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

    let timeout = Duration::from_secs(timeout_secs);
    let client = match &loopback {
        Some((host, port)) => build_loopback_client(timeout, host, *port)?,
        None => build_client(timeout)?,
    };

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
    http_fetch_with(request, &FetchPolicy::default()).await
}

/// 例外つきの fetch (#1293)。同意済みの loopback 宛 (`policy.loopback_ports`) だけ
/// 一次検査の loopback 拒否を通し、それ以外は [`http_fetch`] と同じ
pub async fn http_fetch_with(
    request: HttpFetchRequest,
    policy: &FetchPolicy,
) -> Result<HttpFetchResponse> {
    http_fetch_inner(request, policy)
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
        let res = http_fetch_inner(
            HttpFetchRequest {
                // RFC 6761 の予約 TLD: 名前解決が必ず失敗する
                url: "https://nonexistent.invalid/".into(),
                method: None,
                headers: None,
                body: None,
                timeout_ms: Some(2_000),
            },
            &FetchPolicy::default(),
        )
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
        let err = http_fetch_inner(
            HttpFetchRequest {
                url: "https://example.com:25/".into(),
                ..Default::default()
            },
            &FetchPolicy::default(),
        )
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
        let res = http_fetch_inner(
            HttpFetchRequest {
                url: "http://127.0.0.1/".into(),
                method: None,
                headers: None,
                body: None,
                timeout_ms: None,
            },
            &FetchPolicy::default(),
        )
        .await;
        assert!(res.is_err());
    }

    /// loopback に待ち受けるテスト用サーバー。`/ok` は本文、`/out` は外部へ、
    /// `/same` は同じ host:port の `/ok` へ、`/other` は別表記の loopback へ飛ばす
    async fn loopback_server() -> SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let port = addr.port();
        let app = axum::Router::new()
            .route("/ok", axum::routing::get(|| async { "local" }))
            .route(
                "/same",
                axum::routing::get(move || async move {
                    axum::response::Redirect::temporary(&format!("http://127.0.0.1:{port}/ok"))
                }),
            )
            .route(
                "/other",
                axum::routing::get(move || async move {
                    axum::response::Redirect::temporary(&format!("http://localhost:{port}/ok"))
                }),
            )
            .route(
                "/out",
                axum::routing::get(|| async {
                    axum::response::Redirect::temporary("https://example.com/")
                }),
            );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        addr
    }

    fn policy_for(port: u16) -> FetchPolicy {
        FetchPolicy {
            loopback_ports: BTreeSet::from([port]),
        }
    }

    fn req(url: String) -> HttpFetchRequest {
        HttpFetchRequest {
            url,
            timeout_ms: Some(5_000),
            ..Default::default()
        }
    }

    /// 同意済みのポートなら loopback の 3 表記のどれでも届く (#1293)。`localhost`
    /// は名前解決せず 127.0.0.1 に固定される
    #[tokio::test]
    async fn consented_loopback_port_is_reachable_by_all_three_spellings() {
        let addr = loopback_server().await;
        let policy = policy_for(addr.port());
        for host in ["127.0.0.1", "localhost"] {
            let res = http_fetch_inner(req(format!("http://{host}:{}/ok", addr.port())), &policy)
                .await
                .unwrap();
            assert_eq!(res.status, 200, "{host}");
            assert_eq!(res.body, "local");
        }
    }

    /// 同意の無いポート / 同意が空なら従来どおり一次検査で Err
    #[tokio::test]
    async fn loopback_without_consent_is_still_rejected() {
        let addr = loopback_server().await;
        let url = format!("http://127.0.0.1:{}/ok", addr.port());
        assert!(http_fetch_inner(req(url.clone()), &FetchPolicy::default())
            .await
            .is_err());
        assert!(http_fetch_inner(req(url), &policy_for(addr.port() ^ 1))
            .await
            .is_err());
    }

    /// redirect は同じ host:port の loopback 宛だけ追う。外へも別表記へも出ない
    #[tokio::test]
    async fn loopback_redirects_stay_on_the_consented_target() {
        let addr = loopback_server().await;
        let policy = policy_for(addr.port());
        let base = format!("http://127.0.0.1:{}", addr.port());
        let same = http_fetch_inner(req(format!("{base}/same")), &policy)
            .await
            .unwrap();
        assert_eq!(same.body, "local");
        for path in ["/out", "/other"] {
            let res = http_fetch_inner(req(format!("{base}{path}")), &policy)
                .await
                .unwrap();
            assert_eq!(res.status, 0, "{path} must not be followed");
        }
    }
}
