//! 動画本体のプロキシ (`/proxy/media`)。
//!
//! 画像プロキシ (`/proxy/image`、[`crate::media_proxy`]) とは別の経路にする。
//! 画像側は取得をメモリに溜めてディスクに書き、1 ファイルの上限で打ち切り、
//! Range 要求に答えず常に 200 で全体を返す。動画にはどれも合わない:
//! - WebKit (macOS / iOS / WebKitGTK) は Range に答えないサーバーの動画を
//!   再生しない。Chromium (WebView2) も未読の位置へシークできない
//! - 動画は 1 ファイルの上限を普通に超える
//!
//! なのでここは「Range をそのまま上流へ転送し、206 / Content-Range /
//! Accept-Ranges を中継するだけ」でキャッシュしない。ディスクにも
//! メモリにも溜めず、上流の body をそのまま流す。
//!
//! SSRF の守りは画像側と同じ: https 限定 + host の一次検査
//! ([`validate_url`])、名前解決の結果の検査 ([`crate::ssrf::ValidatingResolver`])、
//! リダイレクトの各 hop も https + host 検査 ([`redirect_policy`])。

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{HeaderMap, HeaderName, StatusCode};
use axum::response::{IntoResponse, Response};

/// 上流へそのまま渡す要求ヘッダー。Range / If-Range がシークの本体。
/// User-Agent は WebView のものを引き写す (画像側のように固定の値を持たない)
const FORWARD_REQUEST_HEADERS: &[HeaderName] = &[
    axum::http::header::RANGE,
    axum::http::header::IF_RANGE,
    axum::http::header::USER_AGENT,
];

/// WebView へ中継する応答ヘッダー。Content-Length と Content-Range が
/// 無いと WebKit は 206 を受け付けない
const RELAY_RESPONSE_HEADERS: &[HeaderName] = &[
    axum::http::header::CONTENT_TYPE,
    axum::http::header::CONTENT_LENGTH,
    axum::http::header::CONTENT_RANGE,
    axum::http::header::ACCEPT_RANGES,
    axum::http::header::ETAG,
    axum::http::header::LAST_MODIFIED,
];

const MAX_REDIRECTS: usize = 5;

/// 上流の URL を検査する (接続前の一次防御)。https 以外と、loopback /
/// private / 予約 TLD の host は拒む
pub fn validate_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Only HTTPS URLs are allowed".to_string());
    }
    let host = parsed.host_str().ok_or("url has no host")?;
    crate::ssrf::validate_external_host(host)
}

/// リダイレクトの各 hop も https + host 検査を通ったものだけ追う。
/// 名前解決の結果は client の resolver が別途検査する
fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        match validate_url(attempt.url().as_str()) {
            Ok(()) => attempt.follow(),
            Err(e) => attempt.error(e),
        }
    })
}

/// 動画用の上流 client。
///
/// 画像側の共有 client は全体の timeout (10 秒) を持つが、動画の応答は
/// 再生している間ずっと続くので全体の timeout は付けない。代わりに接続と
/// 読み取りの間隔だけを区切る (止まった上流に WebView の接続を握らせ続けない)
pub fn build_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(4)
        .pool_idle_timeout(Duration::from_secs(60))
        .redirect(redirect_policy())
        .dns_resolver(Arc::new(crate::ssrf::ValidatingResolver))
        .build()
}

/// 要求の Range などを上流へ転送し、応答をそのまま流して返す。
/// URL の検査 ([`validate_url`]) は呼び出し側で済ませておくこと。
pub async fn forward(client: &reqwest::Client, url: &str, headers: &HeaderMap) -> Response {
    let mut req = client.get(url);
    for name in FORWARD_REQUEST_HEADERS {
        if let Some(v) = headers.get(name) {
            req = req.header(name, v);
        }
    }
    // 画像側と同じく、Referer を要求するホスト (i.pximg.net 等) 向けに
    // 上流の origin を付ける
    if let Some(origin) = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| format!("{}://{h}/", u.scheme())))
    {
        req = req.header(reqwest::header::REFERER, origin);
    }

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(%url, error = %format!("{e:#}"), "proxy_media: upstream fetch failed");
            return (StatusCode::BAD_GATEWAY, "Upstream fetch failed").into_response();
        }
    };

    let status = resp.status();
    // 200 (上流が Range を無視した / Range なし) と 206 はそのまま流す。
    // 416 は WebView が範囲を読み直す合図なので中継する。それ以外の失敗は
    // 上流の本文を見せずに 502 にする
    let relay_status = match status.as_u16() {
        200 | 206 | 416 => StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
        code => {
            tracing::warn!(%url, code, "proxy_media: upstream returned an error");
            return (StatusCode::BAD_GATEWAY, format!("Upstream HTTP {code}")).into_response();
        }
    };

    let mut builder = Response::builder().status(relay_status);
    for name in RELAY_RESPONSE_HEADERS {
        if let Some(v) = resp.headers().get(name) {
            builder = builder.header(name, v);
        }
    }
    // キャッシュしない経路なので WebView のディスクキャッシュにも残さない。
    // URL は起動毎のトークンを含むので、次の起動では当たらない
    builder = builder.header(axum::http::header::CACHE_CONTROL, "no-store");

    builder
        .body(Body::from_stream(resp.bytes_stream()))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::State;
    use axum::routing::get;
    use axum::Router;

    /// Range に答える上流のモック。WebKit が最初に送る `bytes=0-1` や
    /// Chromium の `bytes=0-`、シーク先の `bytes=N-` を返せる
    async fn upstream_media(headers: HeaderMap) -> Response {
        let data: Vec<u8> = (0..=255u8).cycle().take(1000).collect();
        let total = data.len();
        let Some(range) = headers
            .get(axum::http::header::RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("bytes="))
        else {
            return Response::builder()
                .status(200)
                .header("content-type", "video/mp4")
                .header("accept-ranges", "bytes")
                .header("content-length", total)
                .body(Body::from(data))
                .unwrap();
        };
        let (start, end) = range.split_once('-').unwrap();
        let start: usize = start.parse().unwrap();
        let end: usize = if end.is_empty() {
            total - 1
        } else {
            end.parse::<usize>().unwrap().min(total - 1)
        };
        if start >= total {
            return Response::builder()
                .status(416)
                .header("content-range", format!("bytes */{total}"))
                .body(Body::empty())
                .unwrap();
        }
        let slice = data[start..=end].to_vec();
        Response::builder()
            .status(206)
            .header("content-type", "video/mp4")
            .header("accept-ranges", "bytes")
            .header("content-range", format!("bytes {start}-{end}/{total}"))
            .header("content-length", slice.len())
            .body(Body::from(slice))
            .unwrap()
    }

    async fn spawn(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}")
    }

    #[derive(Clone)]
    struct ProxyState {
        client: reqwest::Client,
        upstream: String,
    }

    /// 上流のモックと、forward を載せた中継を立てる。中継は本物の route と
    /// 同じく hyper を通すので、ヘッダーと body の流し方まで確かめられる。
    /// テストの上流は http の loopback なので validate_url は通さない
    /// (validate_url 自体は別のテストで確かめる)
    async fn spawn_pair() -> String {
        let upstream = spawn(Router::new().route("/v.mp4", get(upstream_media))).await;
        let proxy = Router::new()
            .route(
                "/proxy/media",
                get(
                    |State(s): State<ProxyState>, headers: HeaderMap| async move {
                        forward(&s.client, &format!("{}/v.mp4", s.upstream), &headers).await
                    },
                ),
            )
            .with_state(ProxyState {
                client: reqwest::Client::new(),
                upstream,
            });
        spawn(proxy).await
    }

    async fn get_with_range(base: &str, range: Option<&str>) -> reqwest::Response {
        let mut req = reqwest::Client::new().get(format!("{base}/proxy/media"));
        if let Some(r) = range {
            req = req.header("range", r);
        }
        req.send().await.unwrap()
    }

    fn header<'a>(resp: &'a reqwest::Response, name: &str) -> Option<&'a str> {
        resp.headers().get(name).and_then(|v| v.to_str().ok())
    }

    /// WebKit は最初に `bytes=0-1` を送り、206 + Content-Range の全長 +
    /// Content-Length が揃っていないと再生しない
    #[tokio::test]
    async fn relays_webkit_probe_range() {
        let base = spawn_pair().await;
        let resp = get_with_range(&base, Some("bytes=0-1")).await;
        assert_eq!(resp.status(), 206);
        assert_eq!(header(&resp, "content-range"), Some("bytes 0-1/1000"));
        assert_eq!(header(&resp, "content-length"), Some("2"));
        assert_eq!(header(&resp, "accept-ranges"), Some("bytes"));
        assert_eq!(header(&resp, "content-type"), Some("video/mp4"));
        assert_eq!(header(&resp, "cache-control"), Some("no-store"));
        assert_eq!(resp.bytes().await.unwrap().as_ref(), &[0u8, 1]);
    }

    /// Chromium の最初の要求 (`bytes=0-`) と、シーク先からの読み直し
    #[tokio::test]
    async fn relays_open_ended_and_seek_ranges() {
        let base = spawn_pair().await;
        let resp = get_with_range(&base, Some("bytes=0-")).await;
        assert_eq!(resp.status(), 206);
        assert_eq!(header(&resp, "content-range"), Some("bytes 0-999/1000"));
        assert_eq!(resp.bytes().await.unwrap().len(), 1000);

        let resp = get_with_range(&base, Some("bytes=600-")).await;
        assert_eq!(resp.status(), 206);
        assert_eq!(header(&resp, "content-range"), Some("bytes 600-999/1000"));
        assert_eq!(header(&resp, "content-length"), Some("400"));
        let body = resp.bytes().await.unwrap();
        assert_eq!(body.len(), 400);
        assert_eq!(body[0], (600 % 256) as u8);
    }

    #[tokio::test]
    async fn relays_full_body_without_range() {
        let base = spawn_pair().await;
        let resp = get_with_range(&base, None).await;
        assert_eq!(resp.status(), 200);
        assert_eq!(header(&resp, "accept-ranges"), Some("bytes"));
        assert_eq!(header(&resp, "content-length"), Some("1000"));
        assert_eq!(resp.bytes().await.unwrap().len(), 1000);
    }

    /// 範囲外は 416 のまま返す (WebView が範囲を読み直す合図)
    #[tokio::test]
    async fn relays_range_not_satisfiable() {
        let base = spawn_pair().await;
        let resp = get_with_range(&base, Some("bytes=5000-")).await;
        assert_eq!(resp.status(), 416);
        assert_eq!(header(&resp, "content-range"), Some("bytes */1000"));
    }

    /// 上流の失敗は本文を見せずに 502
    #[tokio::test]
    async fn maps_upstream_errors_to_bad_gateway() {
        let upstream = spawn(Router::new().route(
            "/v.mp4",
            get(|| async { (StatusCode::NOT_FOUND, "secret detail") }),
        ))
        .await;
        let resp = forward(
            &reqwest::Client::new(),
            &format!("{upstream}/v.mp4"),
            &HeaderMap::new(),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
    }

    #[test]
    fn validate_url_requires_https_and_public_host() {
        assert!(validate_url("https://media.example.com/v.mp4").is_ok());
        for bad in [
            "http://media.example.com/v.mp4",
            "file:///etc/passwd",
            "https://localhost/v.mp4",
            "https://127.0.0.1/v.mp4",
            "https://[::1]/v.mp4",
            "https://10.0.0.1/v.mp4",
            "https://169.254.169.254/latest",
            "https://printer.local/v.mp4",
            "https://foo.internal/v.mp4",
            "not a url",
        ] {
            assert!(validate_url(bad).is_err(), "{bad}");
        }
    }

    /// リダイレクトの各 hop も検査する。https の公開 host から http や
    /// 内部宛てへ飛ばされても追わない (テストの上流は http の loopback なので、
    /// 飛び先がそのまま拒まれる)
    #[tokio::test]
    async fn redirect_policy_refuses_unsafe_hops() {
        // 飛び先 (/ok) は 200 を返すので、追ってしまえば 502 にならない
        let upstream = spawn(
            Router::new()
                .route(
                    "/r",
                    get(|| async {
                        Response::builder()
                            .status(302)
                            .header("location", "/ok")
                            .body(Body::empty())
                            .unwrap()
                    }),
                )
                .route("/ok", get(|| async { "internal" })),
        )
        .await;
        let client = reqwest::Client::builder()
            .redirect(redirect_policy())
            .build()
            .unwrap();
        let resp = forward(&client, &format!("{upstream}/r"), &HeaderMap::new()).await;
        assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
    }

    #[test]
    fn client_builds() {
        assert!(build_client().is_ok());
    }
}
