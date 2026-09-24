//! ユーザー系の読取 (`user.lookup` / `user.search` / `user.followers` / `user.following`)。

use serde_json::Value;

use super::{clamp_limit, param_str, project, require_str, resolve_account_id, ExecContext};
use crate::commands::user;
use crate::context::Core;
use crate::error::Result;
use notecli::error::NoteDeckError;

/// `user.lookup`: 先頭の `@` を 1 つ落とす。host は空なら None。
pub(crate) fn lookup_args(params: &Value) -> Result<(String, Option<String>)> {
    let raw = require_str(params, "username", "user.lookup")?;
    let username = raw.strip_prefix('@').unwrap_or(raw).to_string();
    let host = param_str(params, "host").map(str::to_string);
    Ok((username, host))
}

pub async fn lookup(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let (username, host) = lookup_args(params)?;
    let account_id = resolve_account_id(params, ctx)?;
    let u = user::api_lookup_user(core, account_id, username, host).await?;
    Ok(project::strip_credentials(serde_json::to_value(u)?))
}

/// `user.search`: query はそのまま (空も許す)。
pub async fn search(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let query = params
        .get("query")
        .and_then(Value::as_str)
        .ok_or_else(|| NoteDeckError::InvalidInput("user.search: query is required".into()))?
        .to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = clamp_limit(params, 10, 100);
    let v = user::api_search_users_by_query(core, account_id, query, Some(limit as i64)).await?;
    Ok(match v {
        Value::Array(a) => Value::Array(a.into_iter().map(project::strip_credentials).collect()),
        _ => Value::Array(Vec::new()),
    })
}

/// followers / following の limit: 有限の数ならそのまま (丸めは API 側)、それ以外は 30。
pub(crate) fn follow_limit(params: &Value) -> Result<i64> {
    match params.get("limit") {
        Some(Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Ok(i)
            } else {
                Err(NoteDeckError::InvalidInput(
                    "limit must be an integer".into(),
                ))
            }
        }
        _ => Ok(30),
    }
}

async fn follow_list(
    core: &Core,
    params: &Value,
    ctx: &ExecContext,
    capability: &str,
    followers: bool,
) -> Result<Value> {
    let user_id = params
        .get("userId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| NoteDeckError::InvalidInput(format!("{capability}: userId is required")))?
        .to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = follow_limit(params)?;
    let until_id = param_str(params, "untilId").map(str::to_string);
    if followers {
        user::api_get_followers(core, account_id, user_id, Some(limit), until_id).await
    } else {
        user::api_get_following(core, account_id, user_id, Some(limit), until_id).await
    }
}

pub async fn followers(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    follow_list(core, params, ctx, "user.followers", true).await
}

pub async fn following(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    follow_list(core, params, ctx, "user.following", false).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn lookup_strips_one_at_and_empties_host() {
        let (u, h) = lookup_args(&json!({"username": " @alice ", "host": " "})).unwrap();
        assert_eq!(u, "alice");
        assert!(h.is_none());
        let (u, h) = lookup_args(&json!({"username": "@@bob", "host": "example.com"})).unwrap();
        assert_eq!(u, "@bob");
        assert_eq!(h.as_deref(), Some("example.com"));
        assert!(lookup_args(&json!({"username": ""})).is_err());
    }

    #[test]
    fn follow_limit_passes_integers_and_rejects_floats() {
        assert_eq!(follow_limit(&json!({})).unwrap(), 30);
        assert_eq!(follow_limit(&json!({"limit": 5})).unwrap(), 5);
        assert_eq!(follow_limit(&json!({"limit": "x"})).unwrap(), 30);
        assert!(follow_limit(&json!({"limit": 2.5})).is_err());
    }
}
