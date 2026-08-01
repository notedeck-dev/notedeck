//! SSRF 防御: DNS pinning resolver と redirect の各 hop 検証。
//!
//! `commands::http` の `validate_external_host` / `check_ip_safe` を再利用しつつ、
//! vault では更に踏み込んで:
//!
//! - **DNS pinning**: 1 回の `vault_fetch` 内で host を 1 度だけ解決し結果をキャッシュ。
//!   redirect 後の同名 host も同じ IP を使う → DNS rebinding を防ぐ。
//! - **解決済み IP の検証**: 名前解決の結果が private / loopback 等なら接続前に弾く。
//! - **redirect 各 hop の host 検証**: redirect 先が allowedHosts 外なら追わない。

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::{Arc, Mutex};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

use crate::commands::{check_ip_safe, validate_external_host};

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
#[derive(Clone)]
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
}
