//! 永続 API トークンの管理コマンド (#709)。ストア本体は [`notecore::api_tokens`]。

use std::sync::Arc;

use notecli::error::NoteDeckError;
use tauri::State;

use super::Result;
use notecore::api_tokens::{ApiTokenMeta, ApiTokenStore};

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreatedApiToken {
    pub meta: ApiTokenMeta,
    /// 発行時にのみ返る raw トークン。ハッシュしか保存されないため、
    /// UI はこの場でユーザーに提示 (コピー) させること。
    pub token: String,
}

// nd-command: authz
#[tauri::command]
#[specta::specta]
pub fn list_api_tokens(store: State<'_, Arc<ApiTokenStore>>) -> Vec<ApiTokenMeta> {
    store.list()
}

// nd-command: authz
#[tauri::command]
#[specta::specta]
pub fn create_api_token(
    store: State<'_, Arc<ApiTokenStore>>,
    name: String,
) -> Result<CreatedApiToken> {
    if name.trim().is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "トークン名を入力してください".into(),
        ));
    }
    let (meta, token) = store
        .create(&name)
        .map_err(|e| NoteDeckError::InvalidInput(format!("failed to save token: {e}")))?;
    Ok(CreatedApiToken { meta, token })
}

// nd-command: authz
#[tauri::command]
#[specta::specta]
pub fn revoke_api_token(store: State<'_, Arc<ApiTokenStore>>, id: String) -> Result<bool> {
    store
        .revoke(&id)
        .map_err(|e| NoteDeckError::InvalidInput(format!("failed to save token: {e}")))
}
