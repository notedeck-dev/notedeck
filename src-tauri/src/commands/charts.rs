use tauri::State;

use notecli::models::{
    ActiveUsersChart, ApRequestChart, FederationChart, ServerDriveChart, ServerNotesChart,
    ServerUsersChart, UserFollowingChart, UserNotesChart, UserPvChart,
};

use super::{typed_request, AppState, Result};

// チャート系エンドポイントは public (未ログインでも閲覧可)。

#[tauri::command]
#[specta::specta]
pub async fn api_charts_user_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<UserNotesChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/user/notes", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_charts_user_following(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<UserFollowingChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/user/following", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_charts_user_pv(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<UserPvChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/user/pv", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_charts_active_users(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<ActiveUsersChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/active-users", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_charts_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<ServerNotesChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/notes", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_charts_users(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<ServerUsersChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/users", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_charts_federation(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<FederationChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/federation", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_charts_ap_request(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<ApRequestChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/ap-request", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_charts_drive(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<ServerDriveChart> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "charts/drive", params).await
}
