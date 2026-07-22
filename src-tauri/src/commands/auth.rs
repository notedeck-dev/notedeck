//! MiAuth 認証コマンド。実体は `crate::auth_service` (#782 R3)。
//! リプレイ防止のセッション追跡 (register/consume) のみここに残る。

use tauri::State;

use notecli::models::{AccountPublic, AuthSession};

use super::{export_account_list, validate_host, AppState, AuthSessionTracker, Result};
use crate::auth_service;

#[tauri::command]
#[specta::specta]
pub async fn auth_start(
    tracker: State<'_, AuthSessionTracker>,
    host: String,
    permissions: Option<Vec<String>>,
) -> Result<AuthSession> {
    let host = validate_host(&host)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let perms = permissions.unwrap_or_else(|| {
        auth_service::DEFAULT_MIAUTH_PERMISSIONS
            .iter()
            .map(|s| s.to_string())
            .collect()
    });
    auth_service::validate_permissions(&perms)?;
    let url = auth_service::build_miauth_url(&host, &session_id, &perms);
    tracker.register(&session_id, &host);
    Ok(AuthSession {
        session_id,
        url,
        host,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn auth_complete_and_save(
    app: tauri::AppHandle,
    tracker: State<'_, AuthSessionTracker>,
    app_state: State<'_, AppState>,
    session: AuthSession,
    software: String,
) -> Result<AccountPublic> {
    let (db, client) = app_state.ready().await;

    // Validate this session was created by auth_start and hasn't been replayed
    tracker.consume(&session.session_id, &session.host)?;

    let saved =
        auth_service::complete_and_save(&db, &client, &session.host, &session.session_id, software)
            .await?;

    export_account_list(&app, &db);

    Ok(saved)
}
