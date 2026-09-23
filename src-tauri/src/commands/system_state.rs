//! OS 状態 (#931 / #935 / #928) の読み出し。観測とイベント配信は
//! `system_state.rs`。フロントは起動時にこれで初期値を取り、以後は
//! `SystemState` event で差分を受ける。

use tauri::State;

use super::Result;
use crate::system_state::{SharedSystemState, SystemState};

// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn system_state_get(state: State<'_, SharedSystemState>) -> Result<SystemState> {
    Ok(*state.lock().unwrap_or_else(|p| p.into_inner()))
}
