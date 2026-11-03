//! 外部ネットワーク: `http.fetch` (SSRF 検査つきの汎用 fetch) と `misstore.search`。

use std::collections::HashMap;

use serde_json::{json, Value};

use notecli::error::NoteDeckError;
use notecore::commands::http::{self, FetchPolicy, HttpFetchRequest};
use notecore::context::Core;
use notecore::error::Result;
use notecore::loopback_consent;

use super::ExecContext;

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

pub async fn http_fetch(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let req = fetch_request(params)?;
    let policy = loopback_policy(core, &req.url, ctx)?;
    Ok(serde_json::to_value(
        http::http_fetch_with(req, &policy).await?,
    )?)
}

/// 手元のポートへの要求 (#1293) に許す例外を、同意の記録から組む。
///
/// - URL が loopback の 3 表記でなければ空 (従来の外向きの検査だけ)
/// - 例外を持てるのは principal が plugin で、id に `:` を含まない (widget / play /
///   page でない) ときだけ。それ以外の loopback 宛は空のまま一次検査で拒まれる
/// - 「対象外」「自アプリのポート」「宣言が無い」「本文が古い」「未同意」は code を
///   分けて Err にする (デバイスはバッジの理由に写す)
fn loopback_policy(core: &Core, url: &str, ctx: &ExecContext) -> Result<FetchPolicy> {
    let Some(port) = reqwest::Url::parse(url)
        .ok()
        .and_then(|u| notecore::ssrf::loopback_port(&u))
    else {
        return Ok(FetchPolicy::default());
    };
    if ctx.principal != "plugin" {
        return Ok(FetchPolicy::default());
    }
    let plugin_id = ctx.plugin_id.as_deref().unwrap_or_default();
    if plugin_id.is_empty() || plugin_id.contains(':') {
        return Err(notecore::i18n::error(
            "LOOPBACK_NOT_ELIGIBLE",
            "_native.loopback.notEligible",
            json!({ "port": port }),
        ));
    }
    let running_hash = ctx.body_hash.as_deref().unwrap_or_default();
    let c = loopback_consent::classify(core, url, plugin_id, running_hash)?;
    if c.always_denied {
        return Err(notecore::i18n::error(
            "LOOPBACK_SELF_PORT",
            "_native.loopback.selfPort",
            json!({ "port": port }),
        ));
    }
    if !c.declared {
        return Err(notecore::i18n::error(
            "LOOPBACK_UNDECLARED",
            "_native.loopback.undeclared",
            json!({ "port": port }),
        ));
    }
    if c.stale {
        return Err(notecore::i18n::error(
            "LOOPBACK_STALE",
            "_native.loopback.stale",
            json!({ "port": port }),
        ));
    }
    if !c.granted {
        return Err(notecore::i18n::error(
            "LOOPBACK_NOT_GRANTED",
            "_native.loopback.notGranted",
            json!({ "port": port }),
        ));
    }
    let ports = loopback_consent::effective_ports(core, plugin_id, running_hash)?;
    if !ports.contains(&port) {
        return Err(notecore::i18n::error(
            "LOOPBACK_NOT_GRANTED",
            "_native.loopback.notGranted",
            json!({ "port": port }),
        ));
    }
    Ok(FetchPolicy {
        loopback_ports: ports,
    })
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

    use notecore::json5_out::J5;
    use notecore::sidecar::{plugins, test_support::temp_core, write_item};

    fn plugin_ctx(id: &str, hash: &str) -> ExecContext {
        ExecContext {
            principal: "plugin".into(),
            plugin_id: Some(id.into()),
            body_hash: Some(hash.into()),
            ..Default::default()
        }
    }

    fn put_plugin(core: &Core, id: &str, ports: &str) -> String {
        let src = format!(
            "/// @ 1.2.1\n### {{\n  name: \"A\"\n  version: \"1\"\n  loopback: {ports}\n}}\n<: 1\n"
        );
        let meta = J5::Obj(vec![
            ("installId".into(), J5::Str(id.into())),
            ("name".into(), J5::Str("A".into())),
            ("version".into(), J5::Str("1".into())),
        ]);
        write_item(core, &plugins::KIND, id, &src, &meta).unwrap();
        loopback_consent::body_hash(&src)
    }

    fn code_of(e: NoteDeckError) -> String {
        e.code().to_string()
    }

    /// loopback 宛の例外は plugin principal × 宣言 × 同意 × 同じ本文のときだけ (#1293)
    #[test]
    fn loopback_policy_reasons_are_distinguished_by_code() {
        let (_dir, core, _base) = temp_core();
        let hash = put_plugin(&core, "p1", "[8080]");
        let url = "http://localhost:8080/x";
        // 外向きは空の policy
        assert!(
            loopback_policy(&core, "https://example.com/", &plugin_ctx("p1", &hash))
                .unwrap()
                .loopback_ports
                .is_empty()
        );
        // plugin 以外は空 (一次検査が拒む)
        let ai = ExecContext {
            principal: "ai.chat".into(),
            ..Default::default()
        };
        assert!(loopback_policy(&core, url, &ai)
            .unwrap()
            .loopback_ports
            .is_empty());
        // widget は対象外
        assert_eq!(
            code_of(loopback_policy(&core, url, &plugin_ctx("widget:w1", &hash)).unwrap_err()),
            "LOOPBACK_NOT_ELIGIBLE"
        );
        assert_eq!(
            code_of(
                loopback_policy(&core, "http://127.0.0.1:19820/", &plugin_ctx("p1", &hash))
                    .unwrap_err()
            ),
            "LOOPBACK_SELF_PORT"
        );
        assert_eq!(
            code_of(
                loopback_policy(&core, "http://127.0.0.1:9000/", &plugin_ctx("p1", &hash))
                    .unwrap_err()
            ),
            "LOOPBACK_UNDECLARED"
        );
        assert_eq!(
            code_of(loopback_policy(&core, url, &plugin_ctx("p1", "old")).unwrap_err()),
            "LOOPBACK_STALE"
        );
        assert_eq!(
            code_of(loopback_policy(&core, url, &plugin_ctx("p1", &hash)).unwrap_err()),
            "LOOPBACK_NOT_GRANTED"
        );
        loopback_consent::grant(&core, "p1", 8080, &hash).unwrap();
        let policy = loopback_policy(&core, url, &plugin_ctx("p1", &hash)).unwrap();
        assert_eq!(
            policy.loopback_ports,
            std::collections::BTreeSet::from([8080])
        );
    }
}
