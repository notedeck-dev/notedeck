use serde::Deserialize;
use tauri::State;

use notecli::models::NoteDraft;

use super::{typed_request, AppState, Result};

// Misskey の create / update は `{ createdDraft: ... }` / `{ updatedDraft: ... }`
// とラップして返すので、ここで剥がして直接 NoteDraft を返す。

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDraftResponse {
    created_draft: NoteDraft,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDraftResponse {
    updated_draft: NoteDraft,
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_drafts(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<NoteDraft>> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    typed_request(&client, &host, &token, "notes/drafts/list", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_create_draft(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<NoteDraft> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    let raw = client
        .request(&host, &token, "notes/drafts/create", params)
        .await?;
    let response: CreateDraftResponse = serde_json::from_value(raw)?;
    Ok(response.created_draft)
}

#[tauri::command]
#[specta::specta]
pub async fn api_update_draft(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<NoteDraft> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    let raw = client
        .request(&host, &token, "notes/drafts/update", params)
        .await?;
    let response: UpdateDraftResponse = serde_json::from_value(raw)?;
    Ok(response.updated_draft)
}

#[tauri::command]
#[specta::specta]
pub async fn api_delete_draft(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = app_state.authed(&account_id).await?;
    client
        .request(&host, &token, "notes/drafts/delete", params)
        .await?;
    Ok(())
}
