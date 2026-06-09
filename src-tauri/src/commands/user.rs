use tauri::State;

use notecli::api::SearchUsersOptions;
use notecli::error::NoteDeckError;
use notecli::models::{
    Flash, GalleryPost, MutedWordsResult, NormalizedNote, NormalizedUser, NormalizedUserDetail,
    Page, TimelineOptions, UserReaction,
};

use super::{get_credentials, get_credentials_or_anon, validate_host, AppState, Result};

// --- User profile ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<NormalizedUser> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client.get_user(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_detail(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<NormalizedUserDetail> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client.get_user_detail(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
    options: Option<TimelineOptions>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let notes = client
        .get_user_notes(
            &host,
            &token,
            &account_id,
            &user_id,
            options.unwrap_or_default(),
        )
        .await?;
    if let Err(e) = db.cache_notes(&notes, &format!("user:{user_id}")) {
        eprintln!("[cache] failed to cache user notes: {e}");
    }
    Ok(notes)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_notes_filtered(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_user_notes_filtered(&host, &token, params)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_featured_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
    limit: Option<i64>,
    until_id: Option<String>,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_user_featured_notes(
            &host,
            &token,
            &user_id,
            limit.unwrap_or(30).clamp(1, 100),
            until_id.as_deref(),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_achievements(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_user_achievements(&host, &token, &user_id)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_lookup_user(
    app_state: State<'_, AppState>,
    account_id: String,
    username: String,
    host: Option<String>,
) -> Result<NormalizedUser> {
    if username.is_empty() || username.len() > 255 {
        return Err(NoteDeckError::InvalidInput("Invalid username".to_string()));
    }
    let validated_host = host.map(|h| validate_host(&h)).transpose()?;
    let (db, client) = app_state.ready().await;
    let (server_host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .lookup_user(&server_host, &token, &username, validated_host.as_deref())
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_self(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.get_self(&host, &token).await
}

// --- Follow / Unfollow ---

#[tauri::command]
#[specta::specta]
pub async fn api_follow_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.follow_user(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_unfollow_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.unfollow_user(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_invalidate_follower(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.invalidate_follower(&host, &token, &user_id).await
}

/// フォロー設定を更新する (following/update)。
/// `notify` は "normal" | "none"、`with_replies` は TL に他者宛て返信を含めるか。
#[tauri::command]
#[specta::specta]
pub async fn api_update_following(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
    notify: Option<String>,
    with_replies: Option<bool>,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .update_following(&host, &token, &user_id, notify.as_deref(), with_replies)
        .await
}

/// このユーザーに対する自分用メモを更新する (users/update-memo)。
#[tauri::command]
#[specta::specta]
pub async fn api_update_user_memo(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
    memo: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.update_user_memo(&host, &token, &user_id, &memo).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_accept_follow_request(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.accept_follow_request(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_reject_follow_request(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.reject_follow_request(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_follow_requests(
    app_state: State<'_, AppState>,
    account_id: String,
    limit: Option<i64>,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_follow_requests(&host, &token, limit.unwrap_or(30).clamp(1, 100))
        .await
}

// --- Follow list & relations ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_following(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
    limit: Option<i64>,
    until_id: Option<String>,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_following(
            &host,
            &token,
            &user_id,
            limit.unwrap_or(30).clamp(1, 100),
            until_id.as_deref(),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_followers(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
    limit: Option<i64>,
    until_id: Option<String>,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_followers(
            &host,
            &token,
            &user_id,
            limit.unwrap_or(30).clamp(1, 100),
            until_id.as_deref(),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_relations(
    app_state: State<'_, AppState>,
    account_id: String,
    user_ids: Vec<String>,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.get_user_relations(&host, &token, &user_ids).await
}

// --- Mute / Block ---

#[tauri::command]
#[specta::specta]
pub async fn api_mute_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.mute_user(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_unmute_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.unmute_user(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_renote_mute_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.renote_mute_user(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_unrenote_mute_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.unrenote_mute_user(&host, &token, &user_id).await
}

/// 自分がミュート中のユーザー ID 一覧を取得する（#574: 起動時の mute store hydrate）。
#[tauri::command]
#[specta::specta]
pub async fn api_get_muted_users(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<Vec<String>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.muted_user_ids(&host, &token).await
}

/// 自分の mutedWords / hardMutedWords / mutedInstances を取得する
/// （#610/#613: 起動時の word/instance mute store hydrate、read のみ）。
#[tauri::command]
#[specta::specta]
pub async fn api_get_muted_words(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<MutedWordsResult> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.muted_words(&host, &token).await
}

/// 自分が renote mute 中のユーザー ID 一覧を取得する（#614: 起動時の renote mute store hydrate）。
#[tauri::command]
#[specta::specta]
pub async fn api_get_renote_muted_users(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<Vec<String>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.renote_muted_user_ids(&host, &token).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_block_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.block_user(&host, &token, &user_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_unblock_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.unblock_user(&host, &token, &user_id).await
}

// --- Report ---

#[tauri::command]
#[specta::specta]
pub async fn api_report_user(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
    comment: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.report_user(&host, &token, &user_id, &comment).await
}

// --- User list operations ---

#[tauri::command]
#[specta::specta]
pub async fn api_add_user_to_list(
    app_state: State<'_, AppState>,
    account_id: String,
    list_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .add_user_to_list(&host, &token, &list_id, &user_id)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_remove_user_from_list(
    app_state: State<'_, AppState>,
    account_id: String,
    list_id: String,
    user_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .remove_user_from_list(&host, &token, &list_id, &user_id)
        .await
}

// --- Search ---

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn api_search_users(
    app_state: State<'_, AppState>,
    account_id: String,
    query: Option<String>,
    origin: Option<String>,
    sort: Option<String>,
    state: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .search_users(
            &host,
            &token,
            SearchUsersOptions {
                query: query.as_deref(),
                origin: origin.as_deref(),
                sort: sort.as_deref(),
                state: state.as_deref(),
                limit: limit.unwrap_or(30).clamp(1, 100),
                offset,
            },
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_search_users_by_query(
    app_state: State<'_, AppState>,
    account_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .search_users_by_query(&host, &token, &query, limit.unwrap_or(10).clamp(1, 100))
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_search_hashtags(
    app_state: State<'_, AppState>,
    account_id: String,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<String>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .search_hashtags(&host, &token, &query, limit.unwrap_or(10).clamp(1, 100))
        .await
}

// --- ActivityPub resolve ---

#[tauri::command]
#[specta::specta]
pub async fn api_ap_show(
    app_state: State<'_, AppState>,
    account_id: String,
    uri: String,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client.ap_show(&host, &token, &uri).await
}

// --- User-scoped raw endpoints (薄ラッパー) ---
//
// 既存の型付き `api_get_user` (NormalizedUser) とは別に、生 JSON が欲しい
// インスペクタ系 UI 用の薄ラッパー。

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_raw(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client.request(&host, &token, "users/show", params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_reactions(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<UserReaction>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let raw = client
        .request(&host, &token, "users/reactions", params)
        .await?;
    Ok(serde_json::from_value(raw)?)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_pages_by(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<Page>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let raw = client.request(&host, &token, "users/pages", params).await?;
    Ok(serde_json::from_value(raw)?)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_flashs(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<Flash>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let raw = client.request(&host, &token, "users/flashs", params).await?;
    Ok(serde_json::from_value(raw)?)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_gallery_by(
    app_state: State<'_, AppState>,
    account_id: String,
    params: serde_json::Value,
) -> Result<Vec<GalleryPost>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let raw = client
        .request(&host, &token, "users/gallery/posts", params)
        .await?;
    Ok(serde_json::from_value(raw)?)
}

