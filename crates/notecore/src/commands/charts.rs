//! charts のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use notecli::models::{
    ActiveUsersChart, ApRequestChart, FederationChart, ServerDriveChart, ServerNotesChart,
    ServerUsersChart, UserFollowingChart, UserNotesChart, UserPvChart,
};

use crate::commands::typed_request;
use crate::context::Core;
use crate::error::Result;

// チャート系エンドポイントは public (未ログインでも閲覧可)。

pub async fn api_charts_user_notes(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<UserNotesChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/user/notes", params).await
}

pub async fn api_charts_user_following(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<UserFollowingChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/user/following", params).await
}

pub async fn api_charts_user_pv(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<UserPvChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/user/pv", params).await
}

pub async fn api_charts_active_users(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<ActiveUsersChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/active-users", params).await
}

pub async fn api_charts_notes(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<ServerNotesChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/notes", params).await
}

pub async fn api_charts_users(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<ServerUsersChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/users", params).await
}

pub async fn api_charts_federation(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<FederationChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/federation", params).await
}

pub async fn api_charts_ap_request(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<ApRequestChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/ap-request", params).await
}

pub async fn api_charts_drive(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<ServerDriveChart> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/drive", params).await
}
