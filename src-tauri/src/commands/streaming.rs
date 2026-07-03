use tauri::State;

use notecli::db::Database;
use notecli::streaming::StreamingManager;

use super::{get_credentials, AppState, Result};

/// Ensure the streaming WebSocket is connected for the given account.
///
/// 初回接続失敗も notecli の再接続ループに委譲されるため、失敗しても Ok を
/// 返す (invoke の resolve は接続確立を意味しない)。接続の生死は
/// stream-status イベントでフロントへ伝わる。
async fn ensure_stream_connected(
    db: &Database,
    streaming: &StreamingManager,
    account_id: &str,
) -> Result<()> {
    let (host, token) = get_credentials(db, account_id)?;
    streaming.connect(account_id, &host, &token).await
}

#[tauri::command]
#[specta::specta]
pub async fn stream_connect(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    account_id: String,
) -> Result<()> {
    let db = app_state.db().await;
    ensure_stream_connected(&db, &streaming, &account_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn stream_disconnect(
    streaming: State<'_, StreamingManager>,
    account_id: String,
) -> Result<()> {
    streaming.disconnect(&account_id).await;
    Ok(())
}

/// Switch between realtime (WebSocket) and polling (HTTP) mode.
/// Subscriptions are preserved across the switch.
#[tauri::command]
#[specta::specta]
pub async fn stream_set_mode(
    app_state: State<'_, AppState>,
    streaming: State<'_, StreamingManager>,
    account_id: String,
    mode: String,
    interval_ms: Option<u64>,
) -> Result<()> {
    let db = app_state.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming
        .set_mode(&account_id, &host, &token, &mode, interval_ms)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn stream_sub_note(
    streaming: State<'_, StreamingManager>,
    account_id: String,
    note_id: String,
) -> Result<()> {
    streaming.sub_note(&account_id, &note_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn stream_unsub_note(
    streaming: State<'_, StreamingManager>,
    account_id: String,
    note_id: String,
) -> Result<()> {
    streaming.unsub_note(&account_id, &note_id).await
}
