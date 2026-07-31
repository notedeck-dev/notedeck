use tauri::State;

use notecli::models::UserList;

use super::{typed_request, AppState, Result};

// 既存 `api_get_user_lists` (timeline.rs, users/lists/list 自分用) は notecli の
// `client.get_user_lists()` を経由する型化済みコマンド。ここでは
// users/lists/show・他人用 users/lists/list・お気に入り操作を補完する。

#[tauri::command]
#[specta::specta]
pub async fn api_get_list(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<UserList> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "users/lists/show", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_lists_by(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<UserList>> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "users/lists/list", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_favorite_list(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    client
        .request(&host, &token, "users/lists/favorite", params)
        .await?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn api_unfavorite_list(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    client
        .request(&host, &token, "users/lists/unfavorite", params)
        .await?;
    Ok(())
}
