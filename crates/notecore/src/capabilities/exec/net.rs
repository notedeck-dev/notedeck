//! 外部ネットワーク: `http.fetch` (SSRF 検査つきの汎用 fetch) と `misstore.search`。

use std::collections::HashMap;

use serde_json::{json, Value};

use crate::commands::http::{self, HttpFetchRequest};
use crate::context::Core;
use crate::error::Result;
use notecli::error::NoteDeckError;

/// `http.fetch`: 引数の形は移設前と同じ (url 以外は型が合わなければ無視)。
pub(crate) fn fetch_request(params: &Value) -> Result<HttpFetchRequest> {
    let url = params
        .get("url")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| NoteDeckError::InvalidInput("url is required".into()))?
        .to_string();
    let headers = params
        .get("headers")
        .and_then(Value::as_object)
        .and_then(|o| {
            let mut m = HashMap::new();
            for (k, v) in o {
                m.insert(k.clone(), v.as_str()?.to_string());
            }
            Some(m)
        });
    Ok(HttpFetchRequest {
        url,
        method: params
            .get("method")
            .and_then(Value::as_str)
            .map(str::to_string),
        headers,
        body: params
            .get("body")
            .and_then(Value::as_str)
            .map(str::to_string),
        timeout_ms: params
            .get("timeoutMs")
            .and_then(Value::as_f64)
            .filter(|n| n.is_finite() && *n >= 0.0)
            .map(|n| n as u64),
    })
}

pub async fn http_fetch(core: &Core, params: &Value) -> Result<Value> {
    let req = fetch_request(params)?;
    Ok(serde_json::to_value(http::http_fetch(core, req).await?)?)
}

const MISSTORE_KINDS: &[&str] = &["plugin", "widget", "skill", "theme"];
const MISSTORE_BASE: &str = "https://store.notedeck.io/registry";

/// `misstore.search`: registry の JSON を種別ごとに取り、id / name / description /
/// category の部分一致で絞る。取得や解析の失敗は warn に残して飛ばす。
pub async fn misstore_search(core: &Core, params: &Value) -> Result<Value> {
    let query = params
        .get("query")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| NoteDeckError::InvalidInput("misstore.search: query is required".into()))?;
    let needle = query.to_lowercase();
    let limit = params
        .get("limit")
        .and_then(Value::as_f64)
        .filter(|n| *n > 0.0)
        .map(|n| n as usize)
        .unwrap_or(20);
    let kinds: Vec<&str> = match params.get("kind").and_then(Value::as_str) {
        Some(k) if MISSTORE_KINDS.contains(&k) => vec![k],
        _ => MISSTORE_KINDS.to_vec(),
    };
    let mut out: Vec<Value> = Vec::new();
    for kind in kinds {
        if out.len() >= limit {
            break;
        }
        let res = match http::http_fetch(
            core,
            HttpFetchRequest {
                url: format!("{MISSTORE_BASE}/{kind}s.json"),
                method: Some("GET".into()),
                headers: None,
                body: None,
                timeout_ms: Some(15_000),
            },
        )
        .await
        {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(kind, "misstore fetch failed: {e}");
                continue;
            }
        };
        if !(200..300).contains(&res.status) {
            tracing::warn!(
                kind,
                status = res.status,
                "misstore registry returned non-2xx"
            );
            continue;
        }
        let parsed: Value = match serde_json::from_str(&res.body) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(kind, "misstore registry parse failed: {e}");
                continue;
            }
        };
        let Some(items) = parsed.get(format!("{kind}s")).and_then(Value::as_array) else {
            continue;
        };
        for item in items {
            if out.len() >= limit {
                break;
            }
            if matches_registry_item(item, &needle) {
                out.push(json!({
                    "id": item.get("id").cloned().unwrap_or(Value::Null),
                    "name": item.get("name").cloned().unwrap_or(Value::Null),
                    "description": item.get("description").cloned().unwrap_or(Value::Null),
                    "category": item.get("category").cloned().unwrap_or(Value::Null),
                    "kind": kind,
                    "iconUrl": item.get("iconUrl").cloned().unwrap_or(Value::Null),
                }));
            }
        }
    }
    Ok(Value::Array(out))
}

pub(crate) fn matches_registry_item(item: &Value, needle: &str) -> bool {
    let s = |k: &str| item.get(k).and_then(Value::as_str).unwrap_or("");
    [s("id"), s("name"), s("description"), s("category")]
        .join(" ")
        .to_lowercase()
        .contains(needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetch_request_parses_like_ts() {
        let r = fetch_request(&json!({
            "url": "https://example.com", "method": "POST",
            "headers": {"a": "1", "b": 2}, "body": "x", "timeoutMs": 1500.7
        }))
        .unwrap();
        assert_eq!(r.method.as_deref(), Some("POST"));
        // 値が全部文字列でない headers は落とす
        assert!(r.headers.is_none());
        assert_eq!(r.body.as_deref(), Some("x"));
        assert_eq!(r.timeout_ms, Some(1500));
        let ok =
            fetch_request(&json!({"url": "https://example.com", "headers": {"a": "1"}})).unwrap();
        assert_eq!(ok.headers.unwrap()["a"], "1");
        assert!(fetch_request(&json!({"url": ""})).is_err());
    }

    #[test]
    fn registry_item_match_is_case_insensitive_over_four_fields() {
        let item = json!({"id": "x", "name": "Clock", "description": null, "category": "Tools"});
        assert!(matches_registry_item(&item, "clock"));
        assert!(matches_registry_item(&item, "tools"));
        assert!(!matches_registry_item(&item, "weather"));
    }
}
