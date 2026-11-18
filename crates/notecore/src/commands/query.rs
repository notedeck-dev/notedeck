//! query のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use notecli::error::NoteDeckError;
use notecli::models::TimelineKey;

use crate::query_runtime::{
    QueryKey, QueryReadModelSnapshot, QueryRuntimeState, QuerySnapshot, WARM_GRACE,
};

use crate::context::Core;
use crate::error::Result;

// query_open (QueryKey を invoke 引数に取る汎用オープン) は削除した。
// 折り畳み後は key 文字列が無検証で entry 化され TimelineKey の構築規約の
// 裏口になる上、フロント呼び出しもゼロだった。復活させる場合は
// TimelineKey::parse による検証を必須とすること (issue notecli#30 仕様 v5 §6-5)。

/// 照会の前にストリームを繋ぐ。手動のオフラインモード (門が断る) の間は繋がず、
/// `false` を返す: 照会はキャッシュだけで開き、購読は張らない (#1350)。解除後に同じ
/// 照会を開き直すと、購読が無いのでそこで繋いで張る
async fn connect_unless_offline(
    streaming: &notecli::streaming::StreamingManager,
    account_id: &str,
    host: &str,
    token: &str,
) -> Result<bool> {
    match streaming.connect(account_id, host, token).await {
        Ok(()) => Ok(true),
        Err(e) if e.code() == crate::offline::ERROR_CODE => Ok(false),
        Err(e) => Err(e),
    }
}

/// 購読が消えた照会に張り直す (#1399)。`disconnect` (オフラインモードに入る) は口座の
/// 購読をすべて消すが、開いたままのカラムの照会は残り、フロントは開き直さない。
/// 接続のたびに呼ぶ。購読をまだ持たない照会 (開いている途中 / オフライン中に開いた)
/// は触らない: 開いた側が張る
pub(crate) async fn reattach_lost_subscriptions(
    streaming: &notecli::streaming::StreamingManager,
    runtime: &crate::query_runtime::QueryRuntime,
    account_id: &str,
) -> Result<()> {
    // 復帰の信号でカラムの数だけ同時に呼ばれる。直列にしないと同じ照会に 2 本張る
    static REATTACHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _reattaching = REATTACHING.lock().await;

    for (query_id, key, lost, state) in runtime.stream_subscriptions_of(account_id)? {
        if streaming.has_subscription(&lost).await {
            continue;
        }
        let mentions = TimelineKey::Mentions.as_canonical();
        // 通知とメンションは main (口座に 1 本の共有チャンネル) に乗る
        let (subscribed, shared) = match &key {
            QueryKey::Notifications { .. } => (streaming.subscribe_main(account_id).await, true),
            QueryKey::Timeline { key, .. } if *key == mentions => {
                (streaming.subscribe_main(account_id).await, true)
            }
            QueryKey::Timeline { key, .. } => (
                streaming
                    .subscribe_notes(account_id, TimelineKey::parse(key)?, None)
                    .await,
                false,
            ),
            QueryKey::ChatUser { other_id, .. } => (
                streaming.subscribe_chat_user(account_id, other_id).await,
                false,
            ),
            QueryKey::ChatRoom { room_id, .. } => (
                streaming.subscribe_chat_room(account_id, room_id).await,
                false,
            ),
        };
        let subscription_id = match subscribed {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!(account_id, query_id, "[query] cannot resubscribe: {e}");
                continue;
            }
        };
        if shared {
            runtime.attach_shared_stream_subscription(&query_id, subscription_id)?;
            continue;
        }
        runtime.attach_stream_subscription(&query_id, subscription_id.clone())?;
        // 隠れているカラムの照会は、止めたまま張る
        if state == QueryRuntimeState::Suspended {
            streaming
                .suspend_subscription(account_id, &subscription_id)
                .await?;
        }
    }
    Ok(())
}

pub async fn query_subscribe_timeline(
    core: &Core,
    owner: Option<String>,
    account_id: String,
    timeline_type: String,
    list_id: Option<String>,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let (host, token) = core.credentials(&account_id)?;
    let online = connect_unless_offline(streaming, &account_id, &host, &token).await?;

    // 境界アダプタ: ('user-list', listId) → canonical キー合成 (api_get_timeline と同規約)
    let tl_key = if timeline_type == "user-list" {
        match list_id {
            Some(ref list_id) => TimelineKey::UserList {
                list_id: list_id.clone(),
            },
            None => {
                return Err(NoteDeckError::InvalidInput(
                    "user-list timeline requires listId".to_string(),
                ))
            }
        }
    } else {
        TimelineKey::parse(&timeline_type)?
    };
    let key = QueryKey::Timeline {
        account_id: account_id.clone(),
        key: tl_key.as_canonical(),
    };
    let opened = runtime.open(key, owner.as_deref())?;
    if opened.source_subscription_id.is_some() || !online {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_notes(&account_id, tl_key, None).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

pub async fn query_subscribe_antenna(
    core: &Core,
    owner: Option<String>,
    account_id: String,
    antenna_id: String,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let (host, token) = core.credentials(&account_id)?;
    let online = connect_unless_offline(streaming, &account_id, &host, &token).await?;

    let tl_key = TimelineKey::Antenna {
        antenna_id: antenna_id.clone(),
    };
    let opened = runtime.open(
        QueryKey::Timeline {
            account_id: account_id.clone(),
            key: tl_key.as_canonical(),
        },
        owner.as_deref(),
    )?;
    if opened.source_subscription_id.is_some() || !online {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_notes(&account_id, tl_key, None).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

pub async fn query_subscribe_channel(
    core: &Core,
    owner: Option<String>,
    account_id: String,
    channel_id: String,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let (host, token) = core.credentials(&account_id)?;
    let online = connect_unless_offline(streaming, &account_id, &host, &token).await?;

    let tl_key = TimelineKey::Channel {
        channel_id: channel_id.clone(),
    };
    let opened = runtime.open(
        QueryKey::Timeline {
            account_id: account_id.clone(),
            key: tl_key.as_canonical(),
        },
        owner.as_deref(),
    )?;
    if opened.source_subscription_id.is_some() || !online {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_notes(&account_id, tl_key, None).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

pub async fn query_subscribe_role(
    core: &Core,
    owner: Option<String>,
    account_id: String,
    role_id: String,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let (host, token) = core.credentials(&account_id)?;
    let online = connect_unless_offline(streaming, &account_id, &host, &token).await?;

    let tl_key = TimelineKey::Role {
        role_id: role_id.clone(),
    };
    let opened = runtime.open(
        QueryKey::Timeline {
            account_id: account_id.clone(),
            key: tl_key.as_canonical(),
        },
        owner.as_deref(),
    )?;
    if opened.source_subscription_id.is_some() || !online {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_notes(&account_id, tl_key, None).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

pub async fn query_subscribe_mentions(
    core: &Core,
    owner: Option<String>,
    account_id: String,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let (host, token) = core.credentials(&account_id)?;
    let online = connect_unless_offline(streaming, &account_id, &host, &token).await?;

    // mentions は QueryKey 識別子としてのみ Timeline に折り畳む。
    // 購読は従来どおり main チャンネル経由 (ws_channel を持たない種別)。
    let opened = runtime.open(
        QueryKey::Timeline {
            account_id: account_id.clone(),
            key: TimelineKey::Mentions.as_canonical(),
        },
        owner.as_deref(),
    )?;
    if opened.source_subscription_id.is_some() || !online {
        return Ok(opened);
    }

    // main はアカウント単位 1 本の共有チャンネル (notecli 側で dedup)。
    // イベントは (account, 種別) で解決するため shared attach を使う (#984)。
    let subscription_id = streaming.subscribe_main(&account_id).await?;
    runtime.attach_shared_stream_subscription(&opened.query_id, subscription_id)
}

pub async fn query_subscribe_notifications(
    core: &Core,
    owner: Option<String>,
    account_id: String,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let (host, token) = core.credentials(&account_id)?;
    let online = connect_unless_offline(streaming, &account_id, &host, &token).await?;

    let opened = runtime.open(
        QueryKey::Notifications {
            account_id: account_id.clone(),
        },
        owner.as_deref(),
    )?;
    if opened.source_subscription_id.is_some() || !online {
        return Ok(opened);
    }

    // main はアカウント単位 1 本の共有チャンネル (notecli 側で dedup)。
    // イベントは (account, 種別) で解決するため shared attach を使う (#984)。
    let subscription_id = streaming.subscribe_main(&account_id).await?;
    runtime.attach_shared_stream_subscription(&opened.query_id, subscription_id)
}

pub async fn query_subscribe_chat_user(
    core: &Core,
    owner: Option<String>,
    account_id: String,
    other_id: String,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let (host, token) = core.credentials(&account_id)?;
    let online = connect_unless_offline(streaming, &account_id, &host, &token).await?;

    let opened = runtime.open(
        QueryKey::ChatUser {
            account_id: account_id.clone(),
            other_id: other_id.clone(),
        },
        owner.as_deref(),
    )?;
    if opened.source_subscription_id.is_some() || !online {
        return Ok(opened);
    }

    let subscription_id = streaming
        .subscribe_chat_user(&account_id, &other_id)
        .await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

pub async fn query_subscribe_chat_room(
    core: &Core,
    owner: Option<String>,
    account_id: String,
    room_id: String,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let (host, token) = core.credentials(&account_id)?;
    let online = connect_unless_offline(streaming, &account_id, &host, &token).await?;

    let opened = runtime.open(
        QueryKey::ChatRoom {
            account_id: account_id.clone(),
            room_id: room_id.clone(),
        },
        owner.as_deref(),
    )?;
    if opened.source_subscription_id.is_some() || !online {
        return Ok(opened);
    }

    let subscription_id = streaming.subscribe_chat_room(&account_id, &room_id).await?;
    runtime.attach_stream_subscription(&opened.query_id, subscription_id)
}

pub async fn query_set_runtime_state(
    core: &Core,
    query_id: String,
    state: QueryRuntimeState,
) -> Result<QuerySnapshot> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    let result = runtime.set_runtime_state(&query_id, state)?;
    let stream_target = runtime.stream_subscription_for(&query_id)?;

    match state {
        QueryRuntimeState::Live => {
            // 既存の warm escalation を取り消す
            runtime.cancel_warm_timer(&query_id);
            if let Some((account_id, subscription_id)) = stream_target {
                streaming
                    .resume_subscription(&account_id, &subscription_id)
                    .await?;
            }
        }
        QueryRuntimeState::Suspended => {
            runtime.cancel_warm_timer(&query_id);
            if let Some((account_id, subscription_id)) = stream_target {
                streaming
                    .suspend_subscription(&account_id, &subscription_id)
                    .await?;
            }
        }
        QueryRuntimeState::Warm => {
            // WARM_GRACE 後に Suspended に遷移する task を spawn。途中で
            // Live に戻ったら cancel_warm_timer で abort される。
            if stream_target.is_some() {
                let runtime_task = runtime.clone();
                let streaming_task = streaming.clone();
                let query_id_owned = query_id.clone();
                let handle = tokio::spawn(async move {
                    tokio::time::sleep(WARM_GRACE).await;
                    // この時点で Warm のままなら Suspended に escalate
                    let snap = match runtime_task.snapshot(&query_id_owned).ok().flatten() {
                        Some(s) => s,
                        None => return,
                    };
                    if snap.runtime_state != QueryRuntimeState::Warm {
                        return;
                    }
                    let _ = runtime_task
                        .set_runtime_state(&query_id_owned, QueryRuntimeState::Suspended);
                    if let Ok(Some((account_id, subscription_id))) =
                        runtime_task.stream_subscription_for(&query_id_owned)
                    {
                        let _ = streaming_task
                            .suspend_subscription(&account_id, &subscription_id)
                            .await;
                    }
                });
                runtime.register_warm_timer(&query_id, handle);
            }
        }
    }
    Ok(result)
}

pub async fn query_close(core: &Core, owner: Option<String>, query_id: String) -> Result<()> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    if let Some((account_id, subscription_id)) = runtime.close(&query_id, owner.as_deref())? {
        runtime.cancel_warm_timer(&query_id);
        streaming.unsubscribe(&account_id, &subscription_id).await?;
    }
    Ok(())
}

/// 窓が消えた。その窓が所有する購読をすべて閉じる (#1131 段 5)。JS の unmount の
/// `query_close` と二重になっても、組が無ければ無視されるので安全
pub async fn query_close_owner(core: &Core, owner: &str) -> Result<()> {
    let streaming = core.streaming()?;
    let runtime = core.query_runtime()?;
    for (account_id, subscription_id) in runtime.close_owner(owner)? {
        if let Err(e) = streaming.unsubscribe(&account_id, &subscription_id).await {
            tracing::warn!(owner, "[query] unsubscribe after window closed failed: {e}");
        }
    }
    Ok(())
}

pub async fn query_get_snapshot(core: &Core, query_id: String) -> Result<Option<QuerySnapshot>> {
    let runtime = core.query_runtime()?;
    runtime.snapshot(&query_id)
}

pub async fn query_get_read_model_snapshot(
    core: &Core,
    query_id: String,
    limit: Option<u32>,
) -> Result<Option<QueryReadModelSnapshot>> {
    let runtime = core.query_runtime()?;
    runtime.read_model_snapshot(&query_id, limit)
}
