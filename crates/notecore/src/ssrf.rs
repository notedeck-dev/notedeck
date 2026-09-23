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
/// hostname なら reserved TLD を弾く (= 一次防御)。DNS 解決後の IP 検証は
/// http_fetch が注入する PinningResolver が担う (二次防御・rebinding 対策)。
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
    validate_external_host(host)
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
            return Err(Box::from(format!(
                "host {host} resolved to a blocked address: {reason}"
            )));
        }
    }
    if resolved.is_empty() {
        return Err(Box::from(format!("host {host} did not resolve")));
    }
    Ok(resolved)
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
