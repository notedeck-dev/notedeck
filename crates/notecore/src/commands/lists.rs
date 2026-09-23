//! lists のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use notecli::models::UserList;

use crate::commands::typed_request;
use crate::context::Core;
use crate::error::Result;

// 既存 `api_get_user_lists` (timeline.rs, users/lists/list 自分用) は notecli の
// `client.get_user_lists()` を経由する型化済みコマンド。ここでは
// users/lists/show・他人用 users/lists/list・お気に入り操作を補完する。

pub async fn api_get_list(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<UserList> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "users/lists/show", params).await
}

pub async fn api_get_user_lists_by(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<UserList>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "users/lists/list", params).await
}

pub async fn api_favorite_list(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .request(&host, &token, "users/lists/favorite", params)
        .await?;
    Ok(())
}

pub async fn api_unfavorite_list(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .request(&host, &token, "users/lists/unfavorite", params)
        .await?;
    Ok(())
}
