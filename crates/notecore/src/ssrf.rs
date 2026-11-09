//! SSRF 防御 (サーバー側から内部アドレスへ要求させる攻撃の防止)。
//!
//! 一次防御 (`validate_external_url` / `validate_external_host` / `check_ip_safe`:
//! URL 文字列と IP literal の検査) と、DNS 解決後の二次防御をここに一元化する。
//! 汎用 fetch (`commands::http`) / 画像キャッシュ / Vault / エクスポートが共用する。
//! Vault 向けには更に踏み込んで:
//!
//! - **DNS pinning**: 1 回の `vault_fetch` 内で host を 1 度だけ解決し結果をキャッシュ。
//!   redirect 後の同名 host も同じ IP を使う → DNS rebinding を防ぐ。
//! - **解決済み IP の検証**: 名前解決の結果が private / loopback 等なら接続前に弾く。
//! - **redirect 各 hop の host 検証**: redirect 先が allowedHosts 外なら追わない。

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::{Arc, Mutex};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// URL が外部公開向けに安全か検証する。host 名が IP 直書きならその IP を、
/// hostname なら reserved TLD を弾き、ポートはブラウザが繋がないもの
/// ([`check_port_safe`]) を弾く (= 一次防御)。DNS 解決後の IP 検証は
/// http_fetch が注入する PinningResolver が担う (二次防御・rebinding 対策)。
/// redirect の各 hop は [`external_redirect_policy`] が同じ規則で検査する。
pub fn validate_external_url(url_str: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(url_str).map_err(|e| format!("invalid URL: {e}"))?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!(
            "only http / https schemes are allowed (got {scheme})"
        ));
    }
    let host = url
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or_else(|| "URL missing host".to_string())?;
    validate_external_host(host)?;
    // 最初の URL のポートも redirect の各 hop と同じ規則で検査する (#1308)
    check_port_safe(url.port())
}

/// host 文字列単体の検証。Misskey 用の `commands::validate_host` とは
/// 「Misskey host 制約 (path 不可など) を引き締めない」点で異なるが、
/// SSRF 防御 (loopback / private / link-local / reserved TLD) は同等。
pub fn validate_external_host(host: &str) -> Result<(), String> {
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

/// ブラウザが繋がないポート (Fetch 標準の "bad port")。SMTP / SSH / IRC 等の
/// 別プロトコルのサービスに当たるので、中継もここへは繋がない (#1228)。
/// 443 だけに絞ると標準以外のポートで配るサーバーの画像が出なくなるため、
/// WebView が直接読むのと同じ範囲に揃える
const BAD_PORTS: &[u16] = &[
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
    103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
    512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
    995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
    6669, 6679, 6697, 10080,
];

/// URL の明示ポート (`Url::port()`、既定ポートなら `None`) を検査する
pub fn check_port_safe(port: Option<u16>) -> Result<(), String> {
    match port {
        Some(p) if BAD_PORTS.contains(&p) => Err(format!("port {p} not allowed")),
        _ => Ok(()),
    }
}

/// 自アプリが listen するポート。この端末の中のサービスへの到達を許す経路 (ローカル接続
/// #880、プラグインの loopback 同意 #1293) でも、ここへは設定に依らず常に繋がない。
/// `http_server::PORT` は cfg で変わるので、release / debug の両方と Dev Dashboard
/// (`pnpm tauri:dev` の Vite) を literal で並べる
pub const SELF_PORTS: &[u16] = &[19820, 19821, 5173];

/// 同意があっても繋がない、この端末の中の危険なサービス (#1293): Docker API
/// (2375 / 2376)、Chrome DevTools Protocol (9222)、Node inspector (9229)。
/// いずれも認証無しで任意のコード実行に届く
pub const DANGEROUS_LOCAL_PORTS: &[u16] = &[2375, 2376, 9222, 9229];

/// プラグインの loopback 同意 (#1293) で「宣言しても同意しても通さない」ポート:
/// 自アプリ ([`SELF_PORTS`]) / ブラウザが繋がないポート ([`check_port_safe`]) /
/// 危険なローカルサービス ([`DANGEROUS_LOCAL_PORTS`])。宣言の正規化と fetch の
/// 両方がこれで捨てる
pub fn is_always_denied_loopback_port(port: u16) -> bool {
    SELF_PORTS.contains(&port) || BAD_PORTS.contains(&port) || DANGEROUS_LOCAL_PORTS.contains(&port)
}

/// URL の host が loopback の 3 表記 (`localhost` / `127.0.0.1` / `[::1]`) に
/// 完全一致するなら、そのポート (既定ポートなら scheme の既定) を返す (#1293)。
/// `localhost.` / `0.0.0.0` / `127.0.0.2` / IPv4 射影表記 / `*.nip.io` は None
/// (それらは外向きの宛先として [`validate_external_url`] が別に拒む)
pub fn loopback_port(url: &reqwest::Url) -> Option<u16> {
    let host = url.host_str()?.to_ascii_lowercase();
    if !matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]") {
        return None;
    }
    url.port_or_known_default()
}

/// URL がこの端末の中 (loopback) を指すなら、正規化した URL を返す (#880 / #1293 共用)。
///
/// - 受ける表記は `localhost` / `127.0.0.1` / `[::1]` の 3 つだけ。`localhost` は名前解決
///   せず `127.0.0.1` に書き換える (resolver は緩めない。実行時は IP literal だけになる)
/// - それ以外の host は `Ok(None)` (loopback 帯の別 IP や `.local` も含む。それらは
///   [`validate_external_url`] が外向きの宛先として別に拒む)
/// - loopback なら scheme は http / https、ポートは明示必須、[`SELF_PORTS`] と
///   ブラウザが繋がないポート ([`check_port_safe`]) は拒む
pub fn normalize_loopback_url(raw: &str) -> Result<Option<String>, String> {
    let mut url = reqwest::Url::parse(raw).map_err(|e| format!("invalid URL: {e}"))?;
    let host = match url.host_str() {
        Some(h) => h.to_ascii_lowercase(),
        None => return Ok(None),
    };
    if !matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]") {
        return Ok(None);
    }
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!(
            "only http / https schemes are allowed (got {})",
            url.scheme()
        ));
    }
    let port = url
        .port()
        .ok_or_else(|| "a loopback URL must name its port explicitly".to_string())?;
    if SELF_PORTS.contains(&port) {
        return Err(format!("port {port} belongs to NoteDeck itself"));
    }
    check_port_safe(Some(port))?;
    if host == "localhost" {
        url.set_host(Some("127.0.0.1"))
            .map_err(|e| format!("cannot normalize localhost: {e}"))?;
    }
    Ok(Some(url.to_string()))
}

/// 外向きの単発 fetch (汎用 `http_fetch` / export の添付取得) の client の土台。
/// fetch ごとに 1 つ作る (resolver の pin が fetch 単位、#857)。呼び出し側は
/// timeout 等を足して build する。
///
/// - redirect の各 hop は [`external_redirect_policy`] で host と port を一次検査と
///   同じ規則で検査する。resolver は名前解決を通らない IP literal の飛び先を見ない
///   ので、`Policy::limited` のままだと `Location: http://127.0.0.1/...` が通る (#1308)
/// - [`PinningResolver`]: 名前解決後の IP を検証してから接続し、redirect を跨いで
///   同じ結果を使う (rebinding 防御)
/// - `no_proxy`: 環境変数のプロキシに流れると、対象 host をこちらで名前解決しない
///   ので resolver の検査そのものが効かない (vault の外向き fetch と同じ)
/// - `referer(false)`: 呼び出し側が組んだ URL (query を含む) を飛び先に漏らさない
pub fn external_fetch_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .redirect(external_redirect_policy(5))
        .dns_resolver(Arc::new(PinningResolver::new()))
        .no_proxy()
        .referer(false)
}

/// 外部へ取りに行く client のリダイレクト方針。各 hop の host も
/// [`validate_external_host`] で検査する。[`ValidatingResolver`] は名前解決の
/// 結果しか見ないので、IP literal の飛び先 (`https://127.0.0.1/` 等) はここで拒む
pub fn external_redirect_policy(max: usize) -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= max {
            return attempt.error("too many redirects");
        }
        let host = attempt.url().host_str().unwrap_or("").to_string();
        match validate_external_host(&host).and_then(|()| check_port_safe(attempt.url().port())) {
            Ok(()) => attempt.follow(),
            Err(e) => attempt.error(e),
        }
    })
}

/// 解決済み IP アドレスが外部接続向けに安全か検証する (DNS pinning からも使う)。
pub fn check_ip_safe(ip: IpAddr) -> Result<(), String> {
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
            // 100.64.0.0/10 (CGNAT 共有アドレス)。Tailscale などのトンネルが使う帯で、
            // 自ホストや同じ網の機器に届きうるので private と同じ扱いにする (#1106 §9)
            if v4.octets()[0] == 100 && (v4.octets()[1] & 0xC0) == 64 {
                return Err("shared-address (CGNAT) IPv4 not allowed".to_string());
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

/// host を名前解決し、全 IP を `check_ip_safe` で検証して返す共通処理。
///
/// 1 つでも危険な IP があれば host 全体を deny (Happy Eyeballs で危険な IP に
/// 接続される可能性を排除)。名前解決は blocking なので spawn_blocking に逃がす。
async fn resolve_and_validate(
    host: &str,
) -> Result<Vec<IpAddr>, Box<dyn std::error::Error + Send + Sync>> {
    let host_for_lookup = host.to_string();
    let resolved: Vec<IpAddr> = tokio::task::spawn_blocking(move || {
        (host_for_lookup.as_str(), 0u16)
            .to_socket_addrs()
            .map(|iter| iter.map(|sa| sa.ip()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::from(e.to_string()) })?
    .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::from(e.to_string()) })?;

    for ip in &resolved {
        if let Err(reason) = check_ip_safe(*ip) {
            return Err(Box::new(BlockedAddress {
                host: host.to_string(),
                reason,
            }));
        }
    }
    if resolved.is_empty() {
        return Err(Box::from(format!("host {host} did not resolve")));
    }
    Ok(resolved)
}

/// 名前解決の結果が内部アドレスだった (設定の誤り、#1321)。reqwest は接続エラーとして
/// 包むので、呼び出し側は [`blocked_address_in`] で `source()` の連鎖から取り出す
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockedAddress {
    pub host: String,
    pub reason: String,
}

impl std::fmt::Display for BlockedAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "host {} resolved to a blocked address: {}",
            self.host, self.reason
        )
    }
}

impl std::error::Error for BlockedAddress {}

/// `err` の `source()` の連鎖に [`BlockedAddress`] があればそれ
pub fn blocked_address_in<'a>(
    err: &'a (dyn std::error::Error + 'static),
) -> Option<&'a BlockedAddress> {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = Some(err);
    while let Some(e) = cur {
        if let Some(b) = e.downcast_ref::<BlockedAddress>() {
            return Some(b);
        }
        cur = e.source();
    }
    None
}

/// 1 回の fetch スコープで DNS を pin する resolver。
///
/// `vault_fetch` ごとに 1 インスタンス生成すること。redirect を跨いでも
/// 同じインスタンスを共有することで、同名 host の再解決による rebinding を防ぐ。
#[derive(Clone, Default)]
pub struct PinningResolver {
    cache: Arc<Mutex<HashMap<String, Vec<IpAddr>>>>,
}

impl PinningResolver {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Resolve for PinningResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        let cache = Arc::clone(&self.cache);
        Box::pin(async move {
            // キャッシュ済みならそれを使う (rebinding 防御の要)。
            if let Some(ips) = cache.lock().unwrap().get(&host).cloned() {
                let addrs: Addrs = Box::new(ips.into_iter().map(|ip| SocketAddr::new(ip, 0)));
                return Ok(addrs);
            }

            let resolved = resolve_and_validate(&host).await?;

            cache.lock().unwrap().insert(host.clone(), resolved.clone());
            let addrs: Addrs = Box::new(resolved.into_iter().map(|ip| SocketAddr::new(ip, 0)));
            Ok(addrs)
        })
    }
}

/// 長寿命の共有 client (メディアプロキシ・OGP) 用: 解決のたびに検証する
/// resolver (#857)。
///
/// PinningResolver と違い結果をキャッシュしない — 長寿命 client で永続 pin
/// すると正当な IP 変更に追随できず、エントリも無限に積もる。rebinding 防御は
/// pin ではなく構造で成立する: resolver が返した (検証済みの) IP がそのまま
/// 接続に使われるため、検証と実接続の解決結果が食い違う余地がない。攻撃者が
/// 再解決で private IP を返しても、その解決自体が検証で弾かれる。redirect の
/// 各 hop でも呼ばれるため、リダイレクト先の内部宛ても同様に弾く。
#[derive(Clone)]
pub struct ValidatingResolver;

impl Resolve for ValidatingResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let resolved = resolve_and_validate(&host).await?;
            let addrs: Addrs = Box::new(resolved.into_iter().map(|ip| SocketAddr::new(ip, 0)));
            Ok(addrs)
        })
    }
}

/// redirect 先 URL が安全か検証する。
///
/// - scheme は http / https
/// - host は SSRF 検証 (loopback / private / reserved TLD) を通過
/// - host は connection の `allowed_hosts` に含まれる (大文字小文字無視)
pub fn validate_redirect_url(url: &reqwest::Url, allowed_hosts: &[String]) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!("redirect scheme not allowed: {}", url.scheme()));
    }
    let host = url
        .host_str()
        .filter(|h| !h.is_empty())
        .ok_or_else(|| "redirect URL missing host".to_string())?;
    validate_external_host(host)?;
    if !host_in_allowed(host, allowed_hosts) {
        return Err(format!("redirect host not in allowedHosts: {host}"));
    }
    Ok(())
}

/// host が allowedHosts に含まれるか (完全一致、大文字小文字無視)。
pub fn host_in_allowed(host: &str, allowed_hosts: &[String]) -> bool {
    let h = host.trim().to_ascii_lowercase();
    allowed_hosts
        .iter()
        .any(|a| a.trim().to_ascii_lowercase() == h)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ブラウザが繋がないポート (SMTP / SSH 等) は拒み、標準以外でも
    /// それ以外のポート (8443 等) と既定のポートは通す (#1228)
    #[test]
    fn check_port_safe_refuses_fetch_bad_ports() {
        for port in [22, 25, 110, 143, 465, 587, 6667, 10080] {
            assert!(check_port_safe(Some(port)).is_err(), "{port} は拒む");
        }
        for port in [None, Some(443), Some(80), Some(8443), Some(3000)] {
            assert!(check_port_safe(port).is_ok(), "{port:?} は通す");
        }
    }

    /// 名前解決を通らない IP literal の飛び先 (http://127.0.0.1/ 等) は
    /// ValidatingResolver では止まらないので、リダイレクトの方針で拒む
    #[tokio::test]
    async fn external_redirect_policy_refuses_ip_literal_hops() {
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

        let client = reqwest::Client::builder()
            .redirect(external_redirect_policy(5))
            .build()
            .unwrap();
        let err = client
            .get(format!("http://{addr}/r"))
            .send()
            .await
            .expect_err("redirect to a loopback literal must not be followed");
        assert!(err.is_redirect(), "{err:#}");
    }

    /// 一次検査は最初の URL のポートも見る。redirect の各 hop と同じ規則 (#1308)
    #[test]
    fn validate_external_url_rejects_bad_ports() {
        let err = validate_external_url("https://example.com:25/").unwrap_err();
        assert!(err.contains("port"), "{err}");
        assert!(validate_external_url("https://example.com:8443/").is_ok());
        assert!(validate_external_url("https://example.com/").is_ok());
    }

    /// 飛び先の host が公開名でも、ブラウザが繋がないポート (SMTP 等) なら
    /// 名前解決も通信もせずに拒む
    #[tokio::test]
    async fn external_redirect_policy_refuses_bad_port_hops() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = axum::Router::new().route(
            "/r",
            axum::routing::get(|| async {
                axum::response::Redirect::temporary("http://example.com:25/")
            }),
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let client = reqwest::Client::builder()
            .redirect(external_redirect_policy(5))
            .build()
            .unwrap();
        let err = client
            .get(format!("http://{addr}/r"))
            .send()
            .await
            .expect_err("redirect to a bad port must not be followed");
        assert!(err.is_redirect(), "{err:#}");
    }

    #[test]
    fn host_in_allowed_is_case_insensitive() {
        let allowed = vec!["api.github.com".to_string()];
        assert!(host_in_allowed("API.GitHub.com", &allowed));
        assert!(host_in_allowed("api.github.com", &allowed));
        assert!(!host_in_allowed("evil.com", &allowed));
    }

    #[test]
    fn validate_redirect_rejects_disallowed_host() {
        let allowed = vec!["api.github.com".to_string()];
        let ok = reqwest::Url::parse("https://api.github.com/x").unwrap();
        assert!(validate_redirect_url(&ok, &allowed).is_ok());

        let off = reqwest::Url::parse("https://evil.com/x").unwrap();
        assert!(validate_redirect_url(&off, &allowed).is_err());
    }

    #[tokio::test]
    async fn resolve_and_validate_rejects_loopback_resolution() {
        // localhost は /etc/hosts で必ず loopback に解決される。「hostname の
        // 文字列検査は通るが解決先が内部」という DNS rebinding 相当のケースを
        // 接続前に弾けることの検証 (#857)
        let err = resolve_and_validate("localhost").await.unwrap_err();
        assert!(err.to_string().contains("blocked address"), "{err}");
        // 型で取り出せる (reqwest の source() の連鎖から見分けるため、#1321)
        let blocked = blocked_address_in(err.as_ref()).expect("typed");
        assert_eq!(blocked.host, "localhost");
    }

    #[tokio::test]
    async fn resolve_and_validate_rejects_private_ip_literal() {
        for host in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1"] {
            let err = resolve_and_validate(host).await.unwrap_err();
            assert!(err.to_string().contains("blocked address"), "{host}: {err}");
        }
    }

    #[test]
    fn validate_redirect_rejects_loopback_even_if_allowed() {
        let allowed = vec!["localhost".to_string()];
        let url = reqwest::Url::parse("http://localhost/x").unwrap();
        assert!(validate_redirect_url(&url, &allowed).is_err());
    }

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
    fn rejects_cgnat_shared_range() {
        assert!(check("http://100.64.0.1/").is_err());
        assert!(check("http://100.100.1.1/").is_err()); // Tailscale の典型
        assert!(check("http://100.127.255.254/").is_err());
        check("http://100.63.255.255/").unwrap();
        check("http://100.128.0.1/").unwrap();
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
}

#[cfg(test)]
mod loopback_tests {
    use super::*;

    /// この端末の中で動くサービス (ローカル接続、#880) の宛先。3 表記だけを受け、
    /// `localhost` は名前解決せず 127.0.0.1 に正規化する (#1293 と同じ規則)
    #[test]
    fn loopback_urls_are_recognized_and_localhost_is_normalized() {
        assert_eq!(
            normalize_loopback_url("http://localhost:11434/v1").unwrap(),
            Some("http://127.0.0.1:11434/v1".to_string())
        );
        assert_eq!(
            normalize_loopback_url("http://127.0.0.1:11434/v1").unwrap(),
            Some("http://127.0.0.1:11434/v1".to_string())
        );
        assert_eq!(
            normalize_loopback_url("http://[::1]:11434").unwrap(),
            Some("http://[::1]:11434/".to_string())
        );
        assert_eq!(
            normalize_loopback_url("http://LOCALHOST:1234/").unwrap(),
            Some("http://127.0.0.1:1234/".to_string())
        );
    }

    #[test]
    fn non_loopback_urls_are_not_classified_as_loopback() {
        assert_eq!(
            normalize_loopback_url("https://api.openai.com/v1").unwrap(),
            None
        );
        // 3 表記以外の loopback 帯や未解決の名前は「ローカル」とは見なさない
        // (一次検査 validate_external_url が loopback として別に拒む)
        assert_eq!(
            normalize_loopback_url("http://127.0.0.2:11434").unwrap(),
            None
        );
        assert_eq!(
            normalize_loopback_url("http://ollama.local:11434").unwrap(),
            None
        );
    }

    #[test]
    fn loopback_urls_require_an_explicit_port_and_http_scheme() {
        assert!(normalize_loopback_url("http://127.0.0.1/v1").is_err());
        assert!(normalize_loopback_url("http://localhost").is_err());
        assert!(normalize_loopback_url("ftp://127.0.0.1:21").is_err());
        assert!(normalize_loopback_url("not a url").is_err());
    }

    /// 自アプリのポート (内蔵 HTTP API の release / debug、Dev Dashboard) とブラウザが
    /// 繋がないポートは、設定に依らず常に拒む
    #[test]
    fn loopback_urls_to_our_own_ports_or_bad_ports_are_rejected() {
        for port in SELF_PORTS {
            let err = normalize_loopback_url(&format!("http://127.0.0.1:{port}/v1"))
                .expect_err("self port");
            assert!(err.contains(&port.to_string()), "{err}");
        }
        assert!(normalize_loopback_url("http://127.0.0.1:25").is_err());
    }

    #[test]
    fn loopback_port_accepts_only_the_three_spellings() {
        let p = |u: &str| loopback_port(&reqwest::Url::parse(u).unwrap());
        assert_eq!(p("http://localhost:8080/x"), Some(8080));
        assert_eq!(p("http://LOCALHOST:8080/x"), Some(8080));
        assert_eq!(p("http://127.0.0.1:3000/"), Some(3000));
        assert_eq!(p("http://[::1]:3000/"), Some(3000));
        // 既定ポートは scheme から
        assert_eq!(p("http://localhost/"), Some(80));
        assert_eq!(p("https://127.0.0.1/"), Some(443));
        for other in [
            "http://localhost./",
            "http://0.0.0.0:80/",
            "http://[::]:80/",
            "http://127.0.0.2:80/",
            "http://[::ffff:127.0.0.1]:80/",
            "http://127.0.0.1.nip.io:80/",
            "https://example.com/",
        ] {
            assert_eq!(p(other), None, "{other}");
        }
    }

    #[test]
    fn always_denied_loopback_ports_cover_self_bad_and_dangerous() {
        for port in [19820u16, 19821, 5173, 25, 22, 2375, 2376, 9222, 9229] {
            assert!(is_always_denied_loopback_port(port), "{port}");
        }
        for port in [8080u16, 3000, 11434, 1234] {
            assert!(!is_always_denied_loopback_port(port), "{port}");
        }
    }
}
