//! アカウント管理のうち認可境界 (資格情報の失効・削除) に当たるコマンド。
//! データ系は notecore のコマンド表へ移行済み (#1106 段階 0b)。

use tauri::State;

use super::{export_account_list, AppState, Result};
use notecore::account_service;

// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn delete_account(app_state: State<'_, AppState>, id: String) -> Result<()> {
    let db = app_state.db().await;
    account_service::delete(&db, &id)?;
    export_account_list(&app_state, &db);
    Ok(())
}

/// Logout: delete token only, keep account record and columns
// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn logout_account(app_state: State<'_, AppState>, id: String) -> Result<()> {
    let db = app_state.db().await;
    account_service::logout(&db, &id)?;
    export_account_list(&app_state, &db);
    Ok(())
}
