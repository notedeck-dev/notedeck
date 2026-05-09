use std::sync::Arc;

use tauri::State;

use notecli::db::Database;
use notecli::models::{ChatMessage, NormalizedNotification, TimelineOptions};

use super::{get_credentials, AppState, Result};

/// REST レスポンスで取得した chat メッセージを fire-and-forget で DB に upsert する。
/// `cache` フラグが false なら何もしない (`chat.cacheEnabled = false` 時の opt-out)。
fn cache_chat_response(
    db: &Arc<Database>,
    msgs: &[ChatMessage],
    account_id: &str,
    host: &str,
    cache: Option<bool>,
) {
    if !cache.unwrap_or(true) {
        return;
    }
    if msgs.is_empty() {
        return;
    }
    // user_id が取れない (account 削除直後等) は skip
    let Ok(Some(account)) = db.get_account(account_id) else {
        return;
    };
    let db = db.clone();
    let msgs = msgs.to_vec();
    let account_id = account_id.to_string();
    let host = host.to_string();
    let user_id = account.user_id.clone();
    tokio::task::spawn_blocking(move || {
        if let Err(e) = db.cache_chat_messages(&msgs, &account_id, &user_id, &host) {
            tracing::warn!(error = %e, "failed to cache chat REST response");
        }
    });
}

// --- Notifications ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_notifications(
    app_state: State<'_, AppState>,
    account_id: String,
    options: Option<TimelineOptions>,
) -> Result<Vec<NormalizedNotification>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_notifications(&host, &token, &account_id, options.unwrap_or_default())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_notifications_grouped(
    app_state: State<'_, AppState>,
    account_id: String,
    options: Option<TimelineOptions>,
) -> Result<Vec<NormalizedNotification>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_notifications_grouped(&host, &token, &account_id, options.unwrap_or_default())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_unread_notification_count(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<i64> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_unread_notification_count(&host, &token)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_mark_all_notifications_as_read(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .mark_all_notifications_as_read(&host, &token)
        .await
}

// --- Unread chat ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_unread_chat(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<bool> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    // notecli #9 (#469) で `messaging/unread` 廃止に伴い `chat/history` の
    // isRead 集計に切り替わったため、自分送信メッセージ除外用に user_id を渡す。
    let me_user_id = match db.get_account(&account_id) {
        Ok(Some(account)) => account.user_id.clone(),
        _ => return Ok(false),
    };
    client.get_unread_chat(&host, &token, &me_user_id).await
}

// --- Chat ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_chat_history(
    app_state: State<'_, AppState>,
    account_id: String,
    limit: Option<i64>,
    room: Option<bool>,
    cache: Option<bool>,
) -> Result<Vec<ChatMessage>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    let msgs = client
        .get_chat_history(&host, &token, limit.unwrap_or(100), room.unwrap_or(false))
        .await?;
    cache_chat_response(&db, &msgs, &account_id, &host, cache);
    Ok(msgs)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_chat_user_messages(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
    cache: Option<bool>,
) -> Result<Vec<ChatMessage>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    let msgs = client
        .get_chat_user_messages(
            &host,
            &token,
            &user_id,
            limit.unwrap_or(30),
            since_id.as_deref(),
            until_id.as_deref(),
        )
        .await?;
    cache_chat_response(&db, &msgs, &account_id, &host, cache);
    Ok(msgs)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_chat_room_messages(
    app_state: State<'_, AppState>,
    account_id: String,
    room_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
    cache: Option<bool>,
) -> Result<Vec<ChatMessage>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    let msgs = client
        .get_chat_room_messages(
            &host,
            &token,
            &room_id,
            limit.unwrap_or(30),
            since_id.as_deref(),
            until_id.as_deref(),
        )
        .await?;
    cache_chat_response(&db, &msgs, &account_id, &host, cache);
    Ok(msgs)
}

/// Misskey 新 Chat API の `chat/messages/create-to-{user,room}` をラップする。
/// `text` / `file_id` は両方 Option で、どちらか一方は必須 (Misskey 側で
/// バリデーション)。`user_id` / `room_id` も両方 Option で、どちらか一方は必須
/// (こちらは本関数で先回り検証)。
#[tauri::command]
#[specta::specta]
pub async fn api_create_chat_message(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: Option<String>,
    room_id: Option<String>,
    text: Option<String>,
    file_id: Option<String>,
) -> Result<ChatMessage> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    let text_ref = text.as_deref();
    let file_id_ref = file_id.as_deref();
    let msg = match (user_id, room_id) {
        (Some(uid), _) => {
            client
                .create_chat_message_to_user(&host, &token, &uid, text_ref, file_id_ref)
                .await?
        }
        (_, Some(rid)) => {
            client
                .create_chat_message_to_room(&host, &token, &rid, text_ref, file_id_ref)
                .await?
        }
        _ => {
            return Err(notecli::error::NoteDeckError::InvalidInput(
                "Either userId or roomId is required".to_string(),
            ))
        }
    };
    // 送信メッセージも DB に書く (WS で同じ msg が往復するが UPSERT で冪等)
    cache_chat_response(&db, std::slice::from_ref(&msg), &account_id, &host, None);
    Ok(msg)
}

// --- Cached chat (offline-first hydrate / gap reconcile 用) ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_cached_chat_history(
    app_state: State<'_, AppState>,
    account_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>> {
    let db = app_state.db().await;
    db.get_cached_chat_history(&account_id, limit.unwrap_or(100))
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_cached_chat_thread_messages(
    app_state: State<'_, AppState>,
    account_id: String,
    thread_id: String,
    until_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>> {
    let db = app_state.db().await;
    db.get_cached_chat_thread_messages(
        &account_id,
        &thread_id,
        until_id.as_deref(),
        limit.unwrap_or(30),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_cached_chat_latest_message_id(
    app_state: State<'_, AppState>,
    account_id: String,
    thread_id: String,
) -> Result<Option<String>> {
    let db = app_state.db().await;
    db.get_cached_chat_latest_message_id(&account_id, &thread_id)
}

// --- Chat reactions ---

#[tauri::command]
#[specta::specta]
pub async fn api_react_chat_message(
    app_state: State<'_, AppState>,
    account_id: String,
    message_id: String,
    reaction: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .react_chat_message(&host, &token, &message_id, &reaction)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_unreact_chat_message(
    app_state: State<'_, AppState>,
    account_id: String,
    message_id: String,
    reaction: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .unreact_chat_message(&host, &token, &message_id, &reaction)
        .await
}

// --- Chat delete ---

/// Misskey 新 Chat API の `chat/messages/delete` をラップする (#468)。
/// Misskey はハード削除のみで、削除成功後 WS `chat:deleted` event が
/// 配信される。notecli 側の streaming.rs がそれを受けて
/// `chat_messages_cache` から自動削除し、フロントには
/// `stream-chat-message-deleted` event が emit される。フロントの
/// QuerySubscription はその event を受けて UI からも消すため、
/// この command の呼び出し側で楽観更新は不要。
#[tauri::command]
#[specta::specta]
pub async fn api_delete_chat_message(
    app_state: State<'_, AppState>,
    account_id: String,
    message_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .delete_chat_message(&host, &token, &message_id)
        .await
}

