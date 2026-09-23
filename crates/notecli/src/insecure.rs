//! E2E テスト用の insecure host 判定 (notedeck #702)。
//!
//! 環境変数 `NOTECLI_INSECURE_HOSTS` (カンマ区切り・完全一致) に列挙された
//! ホストへは https/wss の代わりに http/ws で接続する。ローカルのモック
//! Misskey サーバー (`127.0.0.1:PORT`) に接続するための仕組みで、
//! デバッグビルド限定 (リリースビルドでは常に secure)。

pub(crate) fn is_insecure_host(host: &str) -> bool {
    #[cfg(debug_assertions)]
    {
        std::env::var("NOTECLI_INSECURE_HOSTS")
            .map(|v| v.split(',').any(|h| h.trim().eq_ignore_ascii_case(host)))
            .unwrap_or(false)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = host;
        false
    }
}

pub(crate) fn http_scheme(host: &str) -> &'static str {
    if is_insecure_host(host) {
        "http"
    } else {
        "https"
    }
}

pub(crate) fn ws_scheme(host: &str) -> &'static str {
    if is_insecure_host(host) {
        "ws"
    } else {
        "wss"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insecure_only_for_exact_listed_host() {
        // 他テストと衝突しない値を使う (env はプロセス全体で共有されるため)
        unsafe { std::env::set_var("NOTECLI_INSECURE_HOSTS", "127.0.0.1:39821, mock.test:8080") };
        assert_eq!(http_scheme("127.0.0.1:39821"), "http");
        assert_eq!(ws_scheme("mock.test:8080"), "ws");
        // 完全一致のみ — 列挙外・部分一致は secure のまま
        assert_eq!(http_scheme("127.0.0.1:39999"), "https");
        assert_eq!(ws_scheme("127.0.0.1"), "wss");
        unsafe { std::env::remove_var("NOTECLI_INSECURE_HOSTS") };
    }

    #[test]
    fn secure_by_default() {
        assert_eq!(http_scheme("misskey.io"), "https");
        assert_eq!(ws_scheme("misskey.io"), "wss");
    }
}
