//! コアの切替 (#1106 段階 3a 順序 7)。本体は crate::core_switch
use tauri::State;

use super::{AppState, Result};
use crate::core_switch::{self, CoreStatus, SwitchBack, SwitchSummary};

/// 状態面。WebView の「コア」設定がこれから文言を組む
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn core_status(app_state: State<'_, AppState>) -> Result<CoreStatus> {
    let mut status = core_switch::status(app_state.app_dir()?);
    status.daemon = core_switch::daemon_status().await;
    Ok(status)
}

/// 常駐へ切り替える (unit の用意 + 移行パッケージ + pending)。完了は再起動
// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn core_switch_to_resident(
    app_state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<SwitchSummary> {
    main_window_only(&window)?;
    crate::client_layer::ensure_embedded("core_switch_to_resident")?;
    let db = app_state.db().await;
    core_switch::switch_to_resident(app_state.app_dir()?, &db)
}

/// 埋め込みへ戻す (常駐を止めて secret を取り戻す)。完了は再起動
// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn core_switch_to_embedded(
    app_state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<SwitchBack> {
    main_window_only(&window)?;
    core_switch::switch_to_embedded(app_state.app_dir()?)
}

/// 切替の途中をやめる
// nd-command: authz
#[tauri::command]
#[specta::specta]
pub async fn core_cancel_pending(
    app_state: State<'_, AppState>,
    window: tauri::Window,
) -> Result<()> {
    main_window_only(&window)?;
    core_switch::cancel_pending(app_state.app_dir()?)
}

fn main_window_only(window: &tauri::Window) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(notecli::error::NoteDeckError::InvalidInput(
            "core switch commands are restricted to the main window".into(),
        ))
    }
}
