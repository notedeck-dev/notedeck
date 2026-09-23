//! streaming のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use notecli::db::Database;
use notecli::streaming::StreamingManager;

use crate::context::Core;
use crate::credentials::get_credentials;
use crate::error::Result;

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

pub async fn stream_connect(core: &Core, account_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    let db = core.db().await;
    ensure_stream_connected(&db, streaming, &account_id).await
}

pub async fn stream_disconnect(core: &Core, account_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    streaming.disconnect(&account_id).await;
    Ok(())
}

/// Switch between realtime (WebSocket) and polling (HTTP) mode.
/// Subscriptions are preserved across the switch.
pub async fn stream_set_mode(
    core: &Core,
    account_id: String,
    mode: String,
    interval_ms: Option<u64>,
) -> Result<()> {
    let streaming = core.streaming()?;
    let db = core.db().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    streaming
        .set_mode(&account_id, &host, &token, &mode, interval_ms)
        .await
}

pub async fn stream_sub_note(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    streaming.sub_note(&account_id, &note_id).await
}

pub async fn stream_unsub_note(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    streaming.unsub_note(&account_id, &note_id).await
}
