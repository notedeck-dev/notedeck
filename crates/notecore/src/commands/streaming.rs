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

/// アカウントの main チャンネルを張る。main はアカウント単位の共有チャンネルで、
/// 外す口は無い (解放は disconnect だけ、#984)。チャットの履歴一覧が別の会話の
/// 新着 (`newChatMessage`) を受けるのに使う
pub async fn stream_subscribe_main(core: &Core, account_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    let db = core.db().await;
    ensure_stream_connected(&db, streaming, &account_id).await?;
    streaming.subscribe_main(&account_id).await?;
    Ok(())
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

/// 開いている会話のチャンネルで既読をサーバーに送る (#1222)。本家 Web UI が会話を
/// 開いている間に届いた他人のメッセージごとに送る `read` と同じ
pub async fn stream_chat_read(
    core: &Core,
    account_id: String,
    subscription_id: String,
    message_id: String,
) -> Result<()> {
    let streaming = core.streaming()?;
    streaming
        .read_chat(&account_id, &subscription_id, &message_id)
        .await
}

pub async fn stream_unsub_note(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    streaming.unsub_note(&account_id, &note_id).await
}

/// Stream Inspector の観測を開く。開いている間だけ生封筒 (`stream-envelope`) が流れる。
/// 観測は開いた側 (Stream Inspector のウィンドウ) が閉じる
pub async fn stream_observe_start(core: &Core) -> Result<()> {
    core.stream_observation().start();
    Ok(())
}

pub async fn stream_observe_stop(core: &Core) -> Result<()> {
    core.stream_observation().stop();
    Ok(())
}
