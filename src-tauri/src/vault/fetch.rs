//! `vault_fetch` の本体。
//!
//! 接続のメタデータと secret を読み、SSRF 防御を施した HTTP クライアントで
//! リクエストを送り、レスポンスを redaction して返す。
//!
//! セキュリティ上の要点:
//! - `path` は baseUrl 相対のみ (絶対 URL / protocol-relative / host 変更を拒否)
//! - HTTP/1.1 only (HTTP/2 の header table への secret 滞留を避ける)
//! - DNS pinning resolver + redirect 各 hop の host 再検証
//! - proxy 環境変数を無視 (`no_proxy`)
//! - レスポンス body は 500 KiB 上限でストリーミング打ち切り
//! - レスポンスから secret を redaction、機密ヘッダーを除去

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use secrecy::SecretString;
use serde::{Deserialize, Serialize};

use super::auth_inject::{inject_auth, strip_caller_auth_headers};
use super::connections_store;
use super::error::{VaultError, VaultResult};
use super::model::validate_connection_id;
use super::redaction::{make_nonce, redact_body, redact_headers};
use super::ssrf::{host_in_allowed, validate_redirect_url, PinningResolver};
use super::{KeychainBackend, SecretBackend};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 120_000;
const MAX_RESPONSE_BYTES: usize = 512 * 1024; // 500 KiB
const MAX_REDIRECTS: usize = 5;
const DEFAULT_USER_AGENT: &str = "NoteDeck";

/// `vault_fetch` のリクエスト。
#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultFetchRequest {
    /// baseUrl からの相対パス。絶対 URL は拒否。
    pub path: String,
    /// HTTP メソッド。未指定なら GET。
    #[serde(default)]
    pub method: Option<String>,
    /// 追加ヘッダー。`Authorization` / `Cookie` 等は除去される。
    #[serde(default)]
    pub headers: Option<HashMap<String, String>>,
    /// リクエストボディ (文字列)。
    #[serde(default)]
    pub body: Option<String>,
    /// タイムアウト (ミリ秒)。1000〜120000、未指定なら 30000。
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    /// 使う secret slot。未指定なら "primary"。
    #[serde(default)]
    pub slot: Option<String>,
}

/// `vault_fetch` のレスポンス。
#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VaultFetchResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    /// redaction 済みの body。
    pub body: String,
    /// 何箇所 secret を redact したか。
    pub redacted_count: u32,
    /// レスポンス body のバイト数 (打ち切り後)。
    pub bytes_total: u32,
    /// 500 KiB 上限で打ち切ったか。
    pub truncated: bool,
}

fn parse_method(method: Option<&str>) -> VaultResult<reqwest::Method> {
    let m = method.unwrap_or("GET").to_ascii_uppercase();
    match m.as_str() {
        "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" => {
            reqwest::Method::from_bytes(m.as_bytes()).map_err(|e| VaultError::InvalidInput {
                message: format!("invalid method: {e}"),
            })
        }
        _ => Err(VaultError::InvalidInput {
            message: format!("method not allowed: {m}"),
        }),
    }
}

/// `path` を baseUrl と結合して最終 URL を作る。
///
/// 絶対 URL / protocol-relative / host 変更を拒否する。
fn resolve_url(base_url: &str, path: &str) -> VaultResult<reqwest::Url> {
    if path.contains("://") {
        return Err(VaultError::InvalidPath {
            message: "absolute URLs are not allowed in path".to_string(),
        });
    }
    if path.starts_with("//") {
        return Err(VaultError::InvalidPath {
            message: "protocol-relative paths are not allowed".to_string(),
        });
    }
    let base = reqwest::Url::parse(base_url).map_err(|e| VaultError::InvalidInput {
        message: format!("baseUrl parse error: {e}"),
    })?;
    let joined = base.join(path).map_err(|e| VaultError::InvalidPath {
        message: format!("path join error: {e}"),
    })?;
    // defense in depth: join 後に host が変わっていないこと。
    if joined.host_str() != base.host_str() {
        return Err(VaultError::InvalidPath {
            message: "path must not change the host".to_string(),
        });
    }
    if !matches!(joined.scheme(), "http" | "https") {
        return Err(VaultError::InvalidPath {
            message: "resolved URL scheme must be http or https".to_string(),
        });
    }
    Ok(joined)
}

/// `vault_fetch` の本体。
pub async fn vault_fetch(
    app: &tauri::AppHandle,
    connection_id: &str,
    request: VaultFetchRequest,
) -> VaultResult<VaultFetchResponse> {
    validate_connection_id(connection_id)?;

    // 接続メタデータを読む。
    let file = connections_store::load(app)?;
    let connection = file
        .connections
        .iter()
        .find(|c| c.id == connection_id)
        .ok_or(VaultError::ConnectionNotFound)?
        .clone();

    // secret を読む。
    let slot = request.slot.as_deref().unwrap_or("primary");
    super::model::validate_slot(slot)?;
    let secret: SecretString = KeychainBackend
        .load(connection_id, slot)?
        .ok_or(VaultError::SecretNotSet)?;

    // 最終 URL を組み立て、host を SSRF + allowedHosts で検証する。
    let url = resolve_url(&connection.base_url, &request.path)?;
    let host = url
        .host_str()
        .ok_or_else(|| VaultError::InvalidInput {
            message: "resolved URL has no host".to_string(),
        })?
        .to_string();
    crate::commands::validate_external_host(&host)
        .map_err(|reason| VaultError::SsrfDenied { reason })?;
    if !host_in_allowed(&host, &connection.allowed_hosts) {
        return Err(VaultError::HostNotAllowed { host });
    }

    // タイムアウト。
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);

    // SSRF 防御済みクライアントを fetch ごとに 1 つ生成する。
    let resolver = Arc::new(PinningResolver::new());
    let allowed_for_redirect = connection.allowed_hosts.clone();
    let redirect_policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        match validate_redirect_url(attempt.url(), &allowed_for_redirect) {
            Ok(()) => attempt.follow(),
            Err(reason) => attempt.error(reason),
        }
    });

    let client = reqwest::Client::builder()
        .http1_only()
        .no_proxy()
        .timeout(Duration::from_millis(timeout_ms))
        .redirect(redirect_policy)
        .dns_resolver(resolver)
        .pool_max_idle_per_host(0)
        .build()
        .map_err(|e| VaultError::RequestFailed {
            message: format!("failed to build client: {e}"),
        })?;

    // リクエストを組み立てる。
    let method = parse_method(request.method.as_deref())?;
    let mut req = client.request(method, url);

    // 呼び出し側ヘッダーから禁止ヘッダーを除去してから付与する。
    let caller_headers = strip_caller_auth_headers(request.headers.unwrap_or_default());
    let mut has_ua = false;
    for (k, v) in &caller_headers {
        if k.eq_ignore_ascii_case("user-agent") {
            has_ua = true;
        }
        req = req.header(k, v);
    }
    if !has_ua {
        req = req.header("user-agent", DEFAULT_USER_AGENT);
    }
    if let Some(body) = request.body {
        req = req.body(body);
    }

    // 認証情報を注入する (secret を展開するのはここだけ)。
    req = inject_auth(req, &connection.auth_type, &secret);

    // 送信。
    let response = req.send().await.map_err(|e| {
        if e.is_timeout() {
            VaultError::Timeout
        } else {
            VaultError::RequestFailed {
                message: e.to_string(),
            }
        }
    })?;

    let status = response.status().as_u16();

    // ヘッダーを収集する。
    let mut raw_headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(s) = value.to_str() {
            raw_headers.insert(name.as_str().to_string(), s.to_string());
        }
    }

    // body を 500 KiB 上限でストリーミング受信する。
    let mut buf: Vec<u8> = Vec::new();
    let mut truncated = false;
    let mut response = response;
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = MAX_RESPONSE_BYTES.saturating_sub(buf.len());
                if chunk.len() > remaining {
                    buf.extend_from_slice(&chunk[..remaining]);
                    truncated = true;
                    break;
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => {
                return Err(VaultError::RequestFailed {
                    message: format!("response read failed: {e}"),
                });
            }
        }
    }
    let bytes_total = buf.len() as u32;
    let body_raw = String::from_utf8_lossy(&buf).into_owned();

    // redaction: secret の echo back を除去する。
    let nonce = make_nonce();
    let secret_raw = secrecy::ExposeSecret::expose_secret(&secret);
    let redacted = redact_body(&body_raw, secret_raw, &nonce);
    let headers = redact_headers(raw_headers, secret_raw, &nonce);

    Ok(VaultFetchResponse {
        status,
        headers,
        body: redacted.body,
        redacted_count: redacted.count,
        bytes_total,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_url_rejects_absolute_and_protocol_relative() {
        assert!(resolve_url("https://api.github.com", "https://evil.com/x").is_err());
        assert!(resolve_url("https://api.github.com", "//evil.com/x").is_err());
    }

    #[test]
    fn resolve_url_joins_relative_path() {
        let u = resolve_url("https://api.github.com", "/user/repos").unwrap();
        assert_eq!(u.as_str(), "https://api.github.com/user/repos");
    }

    #[test]
    fn resolve_url_keeps_host() {
        // path が host を変えようとしても base host を維持する。
        let u = resolve_url("https://api.github.com/v3", "repos/foo").unwrap();
        assert_eq!(u.host_str(), Some("api.github.com"));
    }

    #[test]
    fn parse_method_rejects_connect() {
        assert!(parse_method(Some("CONNECT")).is_err());
        assert_eq!(parse_method(None).unwrap(), reqwest::Method::GET);
    }
}
