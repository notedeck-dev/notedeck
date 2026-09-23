//! clips のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use notecli::models::Clip;

use crate::commands::typed_request;
use crate::context::Core;
use crate::error::Result;

// 既存 `api_get_clips` (timeline.rs, clips/list 自分用) は notecli が直接
// 型化メソッド `client.get_clips()` を提供している。ここでは clips/show・
// clips/create・clips/my-favorites・users/clips 等を補完する。

pub async fn api_get_clip(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<Clip> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "clips/show", params).await
}

pub async fn api_get_my_favorite_clips(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<Clip>> {
    let (client, host, token) = core.authed(&account_id).await?;
    typed_request(&client, &host, &token, "clips/my-favorites", params).await
}

pub async fn api_create_clip(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<Clip> {
    let (client, host, token) = core.authed(&account_id).await?;
    typed_request(&client, &host, &token, "clips/create", params).await
}

pub async fn api_favorite_clip(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .request(&host, &token, "clips/favorite", params)
        .await?;
    Ok(())
}

pub async fn api_unfavorite_clip(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .request(&host, &token, "clips/unfavorite", params)
        .await?;
    Ok(())
}

pub async fn api_get_user_clips(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<Clip>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "users/clips", params).await
}
