//! streaming のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use notecli::streaming::StreamingManager;

use crate::context::Core;
use crate::error::Result;

/// Ensure the streaming WebSocket is connected for the given account.
///
/// 初回接続失敗も notecli の再接続ループに委譲されるため、失敗しても Ok を
/// 返す (invoke の resolve は接続確立を意味しない)。接続の生死は
/// stream-status イベントでフロントへ伝わる。
async fn ensure_stream_connected(
    core: &Core,
    streaming: &StreamingManager,
    account_id: &str,
) -> Result<()> {
    let (host, token) = core.credentials(account_id)?;
    streaming.connect(account_id, &host, &token).await?;
    // 切断で購読を失った照会があれば張り直す (#1399)。照会を持たないプロセスでは何もしない
    if let Ok(runtime) = core.query_runtime() {
        super::query::reattach_lost_subscriptions(streaming, runtime, account_id).await?;
    }
    Ok(())
}

pub async fn stream_connect(core: &Core, account_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    ensure_stream_connected(core, streaming, &account_id).await
}

/// アカウントの main チャンネルを張る。main はアカウント単位の共有チャンネルで、
/// 外す口は無い (解放は disconnect だけ、#984)。チャットの履歴一覧が別の会話の
/// 新着 (`newChatMessage`) を受けるのに使う。チャット用なので新着だけを受け、
/// 通知などは配らない (チャットを開いただけで OS 通知が出ないように、#1223)
pub async fn stream_subscribe_main(core: &Core, account_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    ensure_stream_connected(core, streaming, &account_id).await?;
    streaming.subscribe_main_chat(&account_id).await?;
    Ok(())
}

/// 口座の「通知を配る main」を張る (接続も含む、冪等)。通知の OS 通知の消費者は
/// Rust なので、カラムの有無に関わらず口座セッションが張る (#330 §3.1)
pub async fn subscribe_main_for_account(core: &Core, account_id: &str) -> Result<()> {
    let streaming = core.streaming()?;
    ensure_stream_connected(core, streaming, account_id).await?;
    streaming.subscribe_main(account_id).await?;
    Ok(())
}

/// トークンのある全口座について main を張る。起動時 (接続モードの適用後)、復帰時、
/// オフラインモードの解除時に呼ぶ。失敗した口座は warn して続け、張れた口座の id を返す
pub async fn stream_subscribe_main_all(core: &Core) -> Result<Vec<String>> {
    let accounts = crate::commands::admin::load_accounts(core).await?;
    let mut done = Vec::new();
    for account in accounts.into_iter().filter(|a| a.has_token) {
        match subscribe_main_for_account(core, &account.id).await {
            Ok(()) => done.push(account.id),
            Err(e) => tracing::warn!(account = account.id, "[stream] main: {e}"),
        }
    }
    Ok(done)
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
    let (host, token) = core.credentials(&account_id)?;
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

/// 可視の通知カラムに新着が届いたときの既読化。本家 Web が可視ウィンドウへの到着で
/// 送る `readNotification` と同じで、権限の検査が無い。接続が無い (polling) ときは
/// 何もしないので、呼ぶ側は次の可視中の取得に任せる
pub async fn stream_read_notifications(core: &Core, account_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    streaming.read_notifications(&account_id).await
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use notecli::event_bus::EventBus;
    use notecli::models::Account;
    use notecli::streaming::{NoopEmitter, StreamingManager};

    use crate::context::test_support::temp_core;

    fn account(id: &str, token: &str) -> Account {
        Account {
            id: id.into(),
            host: "127.0.0.1:9".into(),
            token: token.into(),
            user_id: format!("u-{id}"),
            username: id.into(),
            display_name: None,
            avatar_url: None,
            software: "misskey".into(),
        }
    }

    /// 通知を配る main は、カラムではなく口座セッションが全口座について張る (#330 §3.1)。
    /// トークンの無い口座 (ログアウト済み) は対象外
    #[tokio::test]
    async fn subscribe_main_all_targets_every_account_with_a_token() {
        let (_dir, core) = temp_core();
        let db = core.db().await;
        db.upsert_account(&account("with-token", "tok")).unwrap();
        db.upsert_account(&account("logged-out", "")).unwrap();
        core.set_streaming(Arc::new(StreamingManager::new(
            Arc::new(NoopEmitter),
            Arc::new(EventBus::new()),
            db.clone(),
            Arc::new(notecli::egress::AllowAll),
        )));

        let done = super::stream_subscribe_main_all(&core).await.unwrap();
        assert_eq!(done, vec!["with-token".to_string()]);
    }

    /// 切断 (オフラインモードに入る) は口座の購読をすべて消す。開いたままの照会は
    /// 次の接続で購読を張り直す。張り直さないと、解除後もカラムに新着が流れない (#1399)
    #[tokio::test]
    async fn connect_reattaches_open_queries_after_disconnect() {
        let (_dir, core) = temp_core();
        let db = core.db().await;
        db.upsert_account(&account("acc", "tok")).unwrap();
        let streaming = Arc::new(StreamingManager::new(
            Arc::new(NoopEmitter),
            Arc::new(EventBus::new()),
            db.clone(),
            Arc::new(notecli::egress::AllowAll),
        ));
        core.set_streaming(streaming.clone());
        let runtime = core.query_runtime().unwrap().clone();

        let opened = crate::commands::query::query_subscribe_timeline(
            &core,
            None,
            "acc".into(),
            "home".into(),
            None,
        )
        .await
        .unwrap();
        let before = opened.source_subscription_id.clone().unwrap();

        streaming.disconnect_all().await;
        super::stream_connect(&core, "acc".into()).await.unwrap();

        let after = runtime
            .snapshot(&opened.query_id)
            .unwrap()
            .unwrap()
            .source_subscription_id
            .unwrap();
        assert_ne!(after, before, "消えた購読の id を持ち続けない");
        // 管理役の表に載っている購読だけが再開できる
        streaming.resume_subscription("acc", &after).await.unwrap();

        // 生きている購読は張り替えない
        super::stream_connect(&core, "acc".into()).await.unwrap();
        let again = runtime.snapshot(&opened.query_id).unwrap().unwrap();
        assert_eq!(again.source_subscription_id, Some(after));
    }
}
