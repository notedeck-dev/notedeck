//! drafts のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use serde::Deserialize;

use notecli::models::NoteDraft;

use crate::commands::typed_request;
use crate::context::Core;
use crate::error::Result;

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

pub async fn api_get_drafts(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<NoteDraft>> {
    let (client, host, token) = core.authed(&account_id).await?;
    typed_request(&client, &host, &token, "notes/drafts/list", params).await
}

pub async fn api_create_draft(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<NoteDraft> {
    let (client, host, token) = core.authed(&account_id).await?;
    let raw = client
        .request(&host, &token, "notes/drafts/create", params)
        .await?;
    let response: CreateDraftResponse = serde_json::from_value(raw)?;
    Ok(response.created_draft)
}

pub async fn api_update_draft(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<NoteDraft> {
    let (client, host, token) = core.authed(&account_id).await?;
    let raw = client
        .request(&host, &token, "notes/drafts/update", params)
        .await?;
    let response: UpdateDraftResponse = serde_json::from_value(raw)?;
    Ok(response.updated_draft)
}

pub async fn api_delete_draft(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .request(&host, &token, "notes/drafts/delete", params)
        .await?;
    Ok(())
}
