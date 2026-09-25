//! サーバー側データの読取 (registry / アナウンス / Pages / Play / Gallery / 連合)。
//! 生の応答をそのまま返すものが多い (移設前と同じ)。

use serde_json::{json, Value};

use super::{param_str, require_str, resolve_account_id, ExecContext};
use crate::commands::{charts, content, federation};
use crate::context::Core;
use crate::error::Result;
use notecli::error::NoteDeckError;

/// 移設前の `pickNumber` 相当: 数なら通す (整数でない数は API に渡せないのでエラー)。
pub(crate) fn pick_number(params: &Value, name: &str) -> Result<Option<i64>> {
    match params.get(name) {
        Some(Value::Number(n)) => n
            .as_i64()
            .map(Some)
            .ok_or_else(|| NoteDeckError::InvalidInput(format!("{name} must be an integer"))),
        _ => Ok(None),
    }
}

pub async fn registry_list_keys(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let scope = super::writes::pick_scope(params)?;
    let account_id = resolve_account_id(params, ctx)?;
    Ok(serde_json::to_value(
        content::api_list_registry_keys(core, account_id, scope).await?,
    )?)
}

pub async fn registry_get(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let scope = super::writes::pick_scope(params)?;
    let key = require_str(params, "key", "registry.get")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    Ok(
        content::api_get_registry_value(core, account_id, scope, key)
            .await?
            .unwrap_or(Value::Null),
    )
}

pub async fn announcements_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let account_id = resolve_account_id(params, ctx)?;
    let limit = pick_number(params, "limit")?;
    let is_active = params.get("isActive").and_then(Value::as_bool);
    content::api_get_announcements(core, account_id, limit, is_active).await
}

fn pick_endpoint(params: &Value, capability: &str, valid: &[&str]) -> Result<String> {
    let e = require_str(params, "endpoint", capability)?;
    if !valid.contains(&e) {
        return Err(NoteDeckError::InvalidInput(format!(
            "{capability}: invalid endpoint \"{e}\". Valid: {}",
            valid.join(", ")
        )));
    }
    Ok(e.to_string())
}

pub async fn pages_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let endpoint = pick_endpoint(
        params,
        "pages.list",
        &["pages/featured", "i/pages", "i/page-likes"],
    )?;
    let account_id = resolve_account_id(params, ctx)?;
    let limit = pick_number(params, "limit")?;
    Ok(serde_json::to_value(
        content::api_get_pages(core, account_id, endpoint, limit).await?,
    )?)
}

pub async fn pages_show(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let page_id = require_str(params, "pageId", "pages.show")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    content::api_get_page(core, account_id, page_id).await
}

pub async fn flash_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let endpoint = pick_endpoint(
        params,
        "flash.list",
        &["flash/featured", "flash/my", "flash/my-likes"],
    )?;
    let account_id = resolve_account_id(params, ctx)?;
    let limit = pick_number(params, "limit")?;
    content::api_get_flashes(core, account_id, endpoint, limit).await
}

pub async fn flash_show(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let flash_id = require_str(params, "flashId", "flash.show")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    content::api_get_flash(core, account_id, flash_id).await
}

pub async fn gallery_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let account_id = resolve_account_id(params, ctx)?;
    let limit = pick_number(params, "limit")?;
    let until_id = param_str(params, "untilId").map(str::to_string);
    Ok(serde_json::to_value(
        content::api_get_gallery_posts(core, account_id, limit, until_id).await?,
    )?)
}

pub async fn federation_chart(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let span = param_str(params, "span").unwrap_or("day");
    if !matches!(span, "day" | "hour") {
        return Err(NoteDeckError::InvalidInput(format!(
            "federation.chart: invalid span \"{span}\". Valid: day, hour"
        )));
    }
    let account_id = resolve_account_id(params, ctx)?;
    let limit = pick_number(params, "limit")?.unwrap_or(30).min(90);
    Ok(serde_json::to_value(
        charts::api_charts_federation(core, account_id, json!({ "span": span, "limit": limit }))
            .await?,
    )?)
}

const VALID_SORTS: &[&str] = &[
    "+pubSub",
    "-pubSub",
    "+notes",
    "-notes",
    "+users",
    "-users",
    "+following",
    "-following",
    "+followers",
    "-followers",
    "+firstRetrievedAt",
    "-firstRetrievedAt",
    "+latestRequestSentAt",
    "-latestRequestSentAt",
];

pub(crate) fn federation_instances_params(params: &Value) -> Result<Value> {
    let sort = param_str(params, "sort");
    if let Some(s) = sort {
        if !VALID_SORTS.contains(&s) {
            return Err(NoteDeckError::InvalidInput(format!(
                "federation.instances: invalid sort \"{s}\". Valid: {}",
                VALID_SORTS.join(", ")
            )));
        }
    }
    let mut out = json!({
        "limit": pick_number(params, "limit")?.unwrap_or(30),
        "offset": pick_number(params, "offset")?.unwrap_or(0),
        "sort": sort.unwrap_or("-pubSub"),
        "host": param_str(params, "host"),
    });
    for flag in [
        "blocked",
        "notResponding",
        "suspended",
        "federating",
        "subscribing",
        "publishing",
    ] {
        out[flag] = match params.get(flag).and_then(Value::as_bool) {
            Some(b) => Value::Bool(b),
            None => Value::Null,
        };
    }
    Ok(out)
}

pub async fn federation_instances(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let body = federation_instances_params(params)?;
    let account_id = resolve_account_id(params, ctx)?;
    Ok(serde_json::to_value(
        federation::api_get_federation_instances(core, account_id, body).await?,
    )?)
}

pub async fn federation_instance(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let host = require_str(params, "host", "federation.instance")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    Ok(serde_json::to_value(
        federation::api_get_federation_instance(core, account_id, json!({ "host": host })).await?,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_and_sort_validation_match_ts() {
        let err = pick_endpoint(&json!({"endpoint": "x"}), "pages.list", &["pages/featured"])
            .unwrap_err()
            .to_string();
        assert!(err.contains("pages.list: invalid endpoint \"x\". Valid: pages/featured"));
        assert!(pick_endpoint(&json!({}), "flash.list", &["flash/my"]).is_err());
        let p = federation_instances_params(&json!({"limit": 5, "blocked": true})).unwrap();
        assert_eq!(p["limit"], 5);
        assert_eq!(p["offset"], 0);
        assert_eq!(p["sort"], "-pubSub");
        assert_eq!(p["host"], Value::Null);
        assert_eq!(p["blocked"], true);
        assert_eq!(p["suspended"], Value::Null);
        assert!(federation_instances_params(&json!({"sort": "sideways"})).is_err());
        assert!(pick_number(&json!({"limit": 1.5}), "limit").is_err());
        assert_eq!(pick_number(&json!({"limit": "x"}), "limit").unwrap(), None);
    }
}
