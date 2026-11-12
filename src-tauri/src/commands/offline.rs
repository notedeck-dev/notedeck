//! 手動のオフラインモードの切替 (#1350)。状態の読み書きは `notecore::offline`。
//!
//! 切替を専用の操作にしてあるのは、画面と状態を食い違わせないため: Rust が状態を書き、
//! 張っているストリーミングの接続を切り、失敗はエラーとして返す。以前は遅延つきの
//! 設定の書き戻しに載っていて、書けなかったとき (読み込みに失敗している間は黙って
//! 書かない) に、画面はオフラインで通信は出たまま、になりえた。

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;
use tauri_specta::Event;

use super::{AppState, Result};

/// 手動のオフラインモードが切り替わった。全窓へ流す (切り替えた窓にも届く)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct OfflineModeChanged {
    pub offline: bool,
}

/// 手動のオフラインモードか。状態が在るのに読めないときは true (`notecore::offline::manual`)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn offline_mode_get(app_state: State<'_, AppState>) -> Result<bool> {
    Ok(notecore::offline::manual(app_state.layout()?))
}

/// 手動のオフラインモードを切り替える。入るときは、張っているストリーミングの接続を
/// すべて切る (フロントの切断に頼らない。窓が 1 つも無くても切れる)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn offline_mode_set(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    offline: bool,
) -> Result<()> {
    notecore::offline::set(app_state.layout()?, offline)?;
    if offline {
        if let (Ok(streaming), Ok(accounts)) = (
            app_state.streaming(),
            notecore::commands::admin::load_accounts(&app_state).await,
        ) {
            for account in accounts {
                streaming.disconnect(&account.id).await;
            }
        }
    }
    // in-process の HEARTBEAT の timer を今の状態で組み直す
    super::sync_heartbeat_timer(&app);
    if let Err(e) = (OfflineModeChanged { offline }).emit(&app) {
        tracing::warn!("[offline] cannot notify the windows: {e}");
    }
    Ok(())
}
