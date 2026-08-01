use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use super::{typed_request, AppState, Result};

/// Misskey `federation/instances` / `federation/show-instance` の 1 件分。
/// 本家 schema (packages/backend/src/models/Instance.ts) に準拠。
/// `show-instance` でのみ返るフィールドは Option にする。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FederationInstance {
    pub id: String,
    pub host: String,
    pub users_count: i64,
    pub notes_count: i64,
    pub following_count: i64,
    pub followers_count: i64,
    pub is_not_responding: bool,
    pub is_suspended: bool,
    pub is_blocked: Option<bool>,
    pub is_silenced: Option<bool>,
    pub is_media_silenced: Option<bool>,
    pub suspension_state: Option<String>,
    pub moderation_note: Option<String>,
    pub software_name: Option<String>,
    pub software_version: Option<String>,
    pub open_registrations: Option<bool>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub maintainer_name: Option<String>,
    pub maintainer_email: Option<String>,
    pub icon_url: Option<String>,
    pub favicon_url: Option<String>,
    pub theme_color: Option<String>,
    pub first_retrieved_at: String,
    pub info_updated_at: Option<String>,
    pub latest_request_sent_at: Option<String>,
    pub latest_request_received_at: Option<String>,
    pub latest_status: Option<i64>,
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_federation_instances(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<FederationInstance>> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "federation/instances", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_federation_instance(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<FederationInstance> {
    let (client, host, token) = app_state.authed_or_anon(&account_id).await?;
    typed_request(&client, &host, &token, "federation/show-instance", params).await
}
