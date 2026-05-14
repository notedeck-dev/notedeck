//! レスポンスの redaction。
//!
//! 外部 API が注入済み secret を echo back する (例: httpbin `/bearer`) ケースに備え、
//! レスポンス body / header から secret 文字列を literal 検索で除去する。
//!
//! - placeholder は per-fetch nonce 付き (`<vault-redacted-<nonce>>`) — 攻撃者が
//!   レスポンスに固定の placeholder 文字列を仕込んで本物の redaction と混同させる
//!   confuse 攻撃を防ぐ。
//! - 最小 secret 長 16 文字未満は redaction 対象にしない (誤マッチ防止) — そもそも
//!   `vault_set_secret` 側で 16 文字未満を拒否しているため通常は到達しない。

use std::collections::HashMap;

/// redaction 対象外にする secret の最小長。
const MIN_REDACT_LEN: usize = 16;

/// レスポンスから除去するヘッダー (大文字小文字無視)。
const DROP_HEADERS: &[&str] = &[
    "set-cookie",
    "authorization",
    "proxy-authorization",
    "www-authenticate",
    "proxy-authenticate",
];

/// per-fetch の redaction nonce を生成する。
pub fn make_nonce() -> String {
    // ULID の下位 8 文字で十分なエントロピー。
    let ulid = ulid::Ulid::new().to_string();
    ulid[ulid.len() - 8..].to_lowercase()
}

/// redaction の結果。
pub struct Redacted {
    /// redaction 後の body 文字列。
    pub body: String,
    /// 何箇所 redact したか (デバッグ / AI への告知用)。
    pub count: u32,
}

/// body 文字列から secret の literal 出現を placeholder に置換する。
pub fn redact_body(body: &str, secret: &str, nonce: &str) -> Redacted {
    if secret.len() < MIN_REDACT_LEN {
        return Redacted {
            body: body.to_string(),
            count: 0,
        };
    }
    let placeholder = format!("<vault-redacted-{nonce}>");
    let count = body.matches(secret).count() as u32;
    let body = body.replace(secret, &placeholder);
    Redacted { body, count }
}

/// レスポンスヘッダーから機密ヘッダーを除去し、残りから secret を redact する。
pub fn redact_headers(
    headers: HashMap<String, String>,
    secret: &str,
    nonce: &str,
) -> HashMap<String, String> {
    let placeholder = format!("<vault-redacted-{nonce}>");
    headers
        .into_iter()
        .filter(|(k, _)| {
            let lk = k.to_ascii_lowercase();
            !DROP_HEADERS.contains(&lk.as_str())
        })
        .map(|(k, v)| {
            let v = if secret.len() >= MIN_REDACT_LEN {
                v.replace(secret, &placeholder)
            } else {
                v
            };
            (k, v)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_echoed_secret_in_body() {
        let secret = "ghp_abcdefghijklmnop"; // 20 chars
        let body = format!("{{\"token\":\"{secret}\"}}");
        let r = redact_body(&body, secret, "deadbeef");
        assert_eq!(r.count, 1);
        assert!(!r.body.contains(secret));
        assert!(r.body.contains("<vault-redacted-deadbeef>"));
    }

    #[test]
    fn short_secret_is_not_redacted() {
        let secret = "short"; // < 16
        let body = "value is short here";
        let r = redact_body(body, secret, "deadbeef");
        assert_eq!(r.count, 0);
        assert_eq!(r.body, body);
    }

    #[test]
    fn drop_headers_removes_set_cookie_and_authorization() {
        let mut headers = HashMap::new();
        headers.insert("Set-Cookie".to_string(), "session=abc".to_string());
        headers.insert("Authorization".to_string(), "Bearer x".to_string());
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        let out = redact_headers(headers, "unused-but-long-enough-secret", "n");
        assert!(!out.contains_key("Set-Cookie"));
        assert!(!out.contains_key("Authorization"));
        assert!(out.contains_key("Content-Type"));
    }

    #[test]
    fn secret_echoed_in_header_value_is_redacted() {
        let secret = "ghp_abcdefghijklmnop";
        let mut headers = HashMap::new();
        headers.insert("X-Echo".to_string(), format!("you sent {secret}"));
        let out = redact_headers(headers, secret, "n0nce123");
        assert!(!out.get("X-Echo").unwrap().contains(secret));
    }
}
