use serde_json::{json, Value};

use super::ExecContext;
use crate::account_service;
use crate::context::Core;
use crate::error::Result;
use notecli::models::AccountPublic;

/// TS 側 `stripCredentials` と同じ形 (トークンは含まない)。
fn project(a: &AccountPublic) -> Value {
    json!({
        "id": a.id,
        "host": a.host,
        "userId": a.user_id,
        "username": a.username,
        "displayName": a.display_name,
        "avatarUrl": a.avatar_url,
        "software": a.software,
        "hasToken": a.has_token,
    })
}

/// `account.list`: ログイン中の全アカウント。
pub async fn list(core: &Core) -> Result<Value> {
    let accounts = core.blocking(account_service::list_public).await?;
    Ok(Value::Array(accounts.iter().map(project).collect()))
}

/// `account.current`: 呼び出し文脈のアカウント。文脈が無ければ null。
pub async fn current(core: &Core, ctx: &ExecContext) -> Result<Value> {
    let Some(id) = ctx.account_id.clone().filter(|s| !s.is_empty()) else {
        return Ok(Value::Null);
    };
    let accounts = core.blocking(account_service::list_public).await?;
    Ok(accounts
        .iter()
        .find(|a| a.id == id)
        .map(project)
        .unwrap_or(Value::Null))
}
