use tauri::State;

use notecli::models::Clip;

use super::{typed_request, AppState, Result};

// 既存 `api_get_clips` (timeline.rs, clips/list 自分用) は notecli が直接
// 型化メソッド `client.get_clips()` を提供している。ここでは clips/show・
// clips/create・clips/my-favorites・users/clips 等を補完する。

#[tauri::command]
#[specta::specta]
pub async fn api_get_clip(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Clip> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "clips/show", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_my_favorite_clips(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<Clip>> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    typed_request(&client, &host, &token, "clips/my-favorites", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_create_clip(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Clip> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    typed_request(&client, &host, &token, "clips/create", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_favorite_clip(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    client
        .request(&host, &token, "clips/favorite", params)
        .await?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn api_unfavorite_clip(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    client
        .request(&host, &token, "clips/unfavorite", params)
        .await?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_clips(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<Clip>> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "users/clips", params).await
}
