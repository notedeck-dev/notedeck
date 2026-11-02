//! 外向き fetch の client が環境変数のプロキシを使わないことの回帰テスト (#1308)。
//!
//! プロキシ経由だと対象 host をこちらで名前解決しないので、resolver の SSRF 検査が
//! 効かない。環境変数はプロセス全体で共有されるため、他のテストと同じバイナリで
//! 設定すると干渉する。integration test のファイルは 1 つで 1 プロセスなので、
//! ここだけに置く。
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn outbound_client_ignores_proxy_environment() {
    // 接続を数えるだけのダミーのプロキシ。応答はしない
    let proxy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let proxy_addr = proxy.local_addr().unwrap();
    let accepted = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&accepted);
    tokio::spawn(async move {
        loop {
            if proxy.accept().await.is_ok() {
                counter.fetch_add(1, Ordering::SeqCst);
            }
        }
    });

    // 直接繋がれば "ok" を返す相手
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = axum::Router::new().route("/", axum::routing::get(|| async { "ok" }));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

    // 開発環境の NO_PROXY で loopback が除外されていると検証が空振りするので外す
    for name in ["NO_PROXY", "no_proxy"] {
        std::env::remove_var(name);
    }
    for name in ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] {
        std::env::set_var(name, format!("http://{proxy_addr}"));
    }

    let client = notecore::ssrf::external_fetch_builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let body = client
        .get(format!("http://{addr}/"))
        .send()
        .await
        .expect("request must go directly, not through the proxy")
        .text()
        .await
        .unwrap();
    assert_eq!(body, "ok");
    assert_eq!(
        accepted.load(Ordering::SeqCst),
        0,
        "proxy must not be contacted"
    );
}
