//! MiAuth 認証コマンド。実体は `notecore::auth_service` (#782 R3)。
//! リプレイ防止のセッション追跡 (register/consume) のみここに残る。

use tauri::State;

use notecli::models::{AccountPublic, AuthSession};

use super::{export_account_list, AppState, Result};
use notecore::auth_service;

// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn auth_complete_and_save(
    app_state: State<'_, AppState>,
    session: AuthSession,
    software: String,
) -> Result<AccountPublic> {
    crate::client_layer::ensure_embedded("auth_complete_and_save")?;
    let (db, client) = app_state.ready().await;

    // Validate this session was created by auth_start and hasn't been replayed
    app_state
        .auth_sessions()
        .consume(&session.session_id, &session.host)?;

    let saved =
        auth_service::complete_and_save(&db, &client, &session.host, &session.session_id, software)
            .await?;

    export_account_list(&app_state, &db);

    Ok(saved)
}
