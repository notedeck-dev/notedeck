//! 認証情報の注入。
//!
//! secret は Rust 側でのみ展開し、JS / AI には渡さない。
//! 呼び出し側が `headers` に `Authorization` 等を混ぜてきても、
//! [`strip_caller_auth_headers`] で除去してから注入する。

use secrecy::{ExposeSecret, SecretString};

use super::model::AuthType;

/// 呼び出し側が指定してはいけないヘッダー (大文字小文字無視)。
/// vault が注入する認証情報を上書き・汚染させないために除去する。
const FORBIDDEN_CALLER_HEADERS: &[&str] = &[
    "authorization",
    "proxy-authorization",
    "cookie",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
];

/// 呼び出し側ヘッダーから禁止ヘッダーを除去する。
pub fn strip_caller_auth_headers(
    headers: std::collections::HashMap<String, String>,
) -> std::collections::HashMap<String, String> {
    headers
        .into_iter()
        .filter(|(k, _)| {
            let lk = k.to_ascii_lowercase();
            !FORBIDDEN_CALLER_HEADERS.contains(&lk.as_str())
        })
        .collect()
}

/// `RequestBuilder` に認証情報を注入する。
///
/// secret を展開するのはこの関数内のみ。`SecretString` は呼び出し元の
/// スコープを抜けると zeroize される。
pub fn inject_auth(
    req: reqwest::RequestBuilder,
    auth_type: &AuthType,
    secret: &SecretString,
) -> reqwest::RequestBuilder {
    let raw = secret.expose_secret();
    match auth_type {
        AuthType::Bearer => req.header("Authorization", format!("Bearer {raw}")),
        AuthType::Header { name } => req.header(name, raw),
        AuthType::Query { param } => req.query(&[(param.as_str(), raw)]),
        AuthType::Basic { username } => req.basic_auth(username, Some(raw)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn strips_forbidden_caller_headers() {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer leaked".to_string());
        headers.insert("Cookie".to_string(), "session=x".to_string());
        headers.insert("X-Forwarded-For".to_string(), "1.2.3.4".to_string());
        headers.insert("Content-Type".to_string(), "application/json".to_string());
        let out = strip_caller_auth_headers(headers);
        assert_eq!(out.len(), 1);
        assert!(out.contains_key("Content-Type"));
    }
}
