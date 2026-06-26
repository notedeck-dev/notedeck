use std::collections::HashMap;

use futures_util::stream::{self, StreamExt};
use tauri::{Emitter, Manager, State};

use notecli::error::NoteDeckError;
use notecli::models::{
    Antenna, Channel, Clip, CreateNoteParams, NormalizedDriveFile, NormalizedNote,
    NormalizedNoteReaction, RawCreateNoteResponse, RawNote, SearchOptions, TimelineOptions,
    TimelineType, UserList,
};

use super::{
    extract_ogp_urls, get_credentials, get_credentials_or_anon, AppState, Result,
    MAX_UPLOAD_BYTES,
};

/// Maximum number of concurrent OGP prefetch requests per timeline load
const MAX_OGP_CONCURRENT: usize = 20;

// --- Timelines ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_timeline(
    app: tauri::AppHandle,
    app_state: State<'_, AppState>,
    account_id: String,
    timeline_type: TimelineType,
    options: Option<TimelineOptions>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let opts = options.unwrap_or_default();
    let cache_key = if timeline_type.as_str() == "user-list" {
        if let Some(ref list_id) = opts.list_id {
            format!("user-list:{list_id}")
        } else {
            timeline_type.as_str().to_string()
        }
    } else {
        timeline_type.as_str().to_string()
    };
    let notes = client
        .get_timeline(&host, &token, &account_id, timeline_type, opts)
        .await?;
    if let Err(e) = db.cache_notes(&notes, &cache_key) {
        tracing::warn!("[cache] failed to cache timeline notes: {e}");
    }

    // Background OGP prefetch: extract URLs and spawn async task (non-blocking)
    if !token.is_empty() {
        spawn_ogp_prefetch(&app, &notes, host, token);
    }

    Ok(notes)
}

/// Extract URLs from notes and spawn background OGP prefetch via Tauri events.
fn spawn_ogp_prefetch(
    app: &tauri::AppHandle,
    notes: &[NormalizedNote],
    host: String,
    token: String,
) {
    let mut urls: Vec<String> = Vec::new();
    for note in notes {
        if let Some(ref text) = note.text {
            urls.extend(extract_ogp_urls(text));
        }
        if let Some(ref renote) = note.renote {
            if let Some(ref text) = renote.text {
                urls.extend(extract_ogp_urls(text));
            }
        }
    }
    urls.sort_unstable();
    urls.dedup();

    if urls.is_empty() {
        return;
    }

    let ogp_cache: crate::ogp::OgpCache = (*app.state::<crate::ogp::OgpCache>()).clone();
    let app = app.clone();
    tokio::spawn(async move {
        let hints: HashMap<String, crate::ogp::OgpData> = stream::iter(urls)
            .map(|url| {
                let host = host.clone();
                let token = token.clone();
                let ogp = ogp_cache.clone();
                async move {
                    let result: std::result::Result<crate::ogp::OgpData, _> =
                        ogp.get_ogp_via_server(&url, &host, &token).await;
                    (url, result.ok())
                }
            })
            .buffer_unordered(MAX_OGP_CONCURRENT)
            .filter_map(|(url, data): (String, Option<crate::ogp::OgpData>)| async move {
                data.map(|d| (url, d))
            })
            .collect()
            .await;

        if !hints.is_empty() {
            let _ = app.emit("nd:ogp-hints", &hints);
        }
    });
}

// --- Lists / Antennas ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_lists(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<Vec<UserList>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.get_user_lists(&host, &token).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_antennas(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<Vec<Antenna>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.get_antennas(&host, &token).await
}

/// 単一アンテナの設定を取得する (antennas/show)。
#[tauri::command]
#[specta::specta]
pub async fn api_get_antenna(
    app_state: State<'_, AppState>,
    account_id: String,
    antenna_id: String,
) -> Result<Antenna> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.get_antenna(&host, &token, &antenna_id).await
}

/// アンテナ設定を更新する (antennas/update)。変更済みの Antenna を全フィールド往復させる。
#[tauri::command]
#[specta::specta]
pub async fn api_update_antenna(
    app_state: State<'_, AppState>,
    account_id: String,
    antenna: Antenna,
) -> Result<Antenna> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.update_antenna(&host, &token, &antenna).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_antenna_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    antenna_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    let notes = client
        .get_antenna_notes(
            &host,
            &token,
            &account_id,
            &antenna_id,
            limit.unwrap_or(20),
            since_id.as_deref(),
            until_id.as_deref(),
        )
        .await?;
    if let Err(e) = db.cache_notes(&notes, &format!("antenna:{antenna_id}")) {
        tracing::warn!("[cache] failed to cache antenna notes: {e}");
    }
    Ok(notes)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_favorites(
    app_state: State<'_, AppState>,
    account_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    let notes = client
        .get_favorites(
            &host,
            &token,
            &account_id,
            limit.unwrap_or(20),
            since_id.as_deref(),
            until_id.as_deref(),
        )
        .await?;
    if let Err(e) = db.cache_notes(&notes, "favorites") {
        tracing::warn!("[cache] failed to cache favorites: {e}");
    }
    Ok(notes)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_featured_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    limit: Option<i64>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let notes = client
        .get_featured_notes(&host, &token, &account_id, limit.unwrap_or(30))
        .await?;
    Ok(notes)
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_mentions(
    app_state: State<'_, AppState>,
    account_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
    visibility: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    let notes = client
        .get_mentions(
            &host,
            &token,
            &account_id,
            limit.unwrap_or(20),
            since_id.as_deref(),
            until_id.as_deref(),
            visibility.as_deref(),
        )
        .await?;
    // ダイレクト（specified）と通常メンションは別カラム・別キャッシュキー。
    // 同じキーに混ぜると read 側（cacheKey='specified' / 'mentions'）と不整合になる。
    let cache_key = if visibility.as_deref() == Some("specified") {
        "specified"
    } else {
        "mentions"
    };
    if let Err(e) = db.cache_notes(&notes, cache_key) {
        tracing::warn!("[cache] failed to cache mentions: {e}");
    }
    Ok(notes)
}

// --- Clips ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_clips(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<Vec<Clip>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.get_clips(&host, &token).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_clip_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    clip_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    let notes = client
        .get_clip_notes(
            &host,
            &token,
            &account_id,
            &clip_id,
            limit.unwrap_or(20),
            since_id.as_deref(),
            until_id.as_deref(),
        )
        .await?;
    if let Err(e) = db.cache_notes(&notes, &format!("clip:{clip_id}")) {
        tracing::warn!("[cache] failed to cache clip notes: {e}");
    }
    Ok(notes)
}

// --- Channels ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_channels(
    app_state: State<'_, AppState>,
    account_id: String,
) -> Result<Vec<Channel>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client.get_channels(&host, &token).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_search_channels(
    app_state: State<'_, AppState>,
    account_id: String,
    query: String,
) -> Result<Vec<Channel>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client.search_channels(&host, &token, &query).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_channel_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    channel_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let notes = client
        .get_channel_notes(
            &host,
            &token,
            &account_id,
            &channel_id,
            limit.unwrap_or(20),
            since_id.as_deref(),
            until_id.as_deref(),
        )
        .await?;
    if let Err(e) = db.cache_notes(&notes, &format!("channel:{channel_id}")) {
        tracing::warn!("[cache] failed to cache channel notes: {e}");
    }
    Ok(notes)
}

// --- Roles ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_role_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    role_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let notes = client
        .get_role_notes(
            &host,
            &token,
            &account_id,
            &role_id,
            limit.unwrap_or(20),
            since_id.as_deref(),
            until_id.as_deref(),
        )
        .await?;
    if let Err(e) = db.cache_notes(&notes, &format!("role:{role_id}")) {
        tracing::warn!("[cache] failed to cache role notes: {e}");
    }
    Ok(notes)
}

// --- Notes ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_note(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
) -> Result<NormalizedNote> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client.get_note(&host, &token, &account_id, &note_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_create_note(
    app_state: State<'_, AppState>,
    account_id: String,
    params: CreateNoteParams,
    channel_id: Option<String>,
) -> Result<NormalizedNote> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    // notecli の CreateNoteParams / CreateNotePoll は Option に
    // skip_serializing_if が付いていないため、struct をそのまま serde_json::json!
    // で包むと multiple: null / expiresAt: null 等が混入し Misskey 側で
    // INVALID_PARAM になる。安全のため body は常に手組みする。
    let body = build_create_note_body(&params, channel_id.as_deref());
    let data = client.request(&host, &token, "notes/create", body).await?;
    let raw: RawCreateNoteResponse = serde_json::from_value(data)?;
    Ok(raw.created_note.normalize(&account_id, &host))
}

fn build_create_note_body(
    params: &CreateNoteParams,
    channel_id: Option<&str>,
) -> serde_json::Value {
    let mut body = serde_json::json!({});
    if let Some(ch_id) = channel_id {
        body["channelId"] = serde_json::json!(ch_id);
    }
    if let Some(ref v) = params.text {
        body["text"] = serde_json::json!(v);
    }
    if let Some(ref v) = params.cw {
        body["cw"] = serde_json::json!(v);
    }
    if let Some(ref v) = params.visibility {
        body["visibility"] = serde_json::json!(v);
    }
    if let Some(v) = params.local_only {
        body["localOnly"] = serde_json::json!(v);
    }
    if let Some(ref flags) = params.mode_flags {
        for (key, value) in flags {
            if key.starts_with("isNoteIn") && key.ends_with("Mode") && key.len() <= 30 {
                body[key] = serde_json::json!(value);
            }
        }
    }
    if let Some(ref v) = params.reply_id {
        body["replyId"] = serde_json::json!(v);
    }
    if let Some(ref v) = params.renote_id {
        body["renoteId"] = serde_json::json!(v);
    }
    if let Some(ref v) = params.file_ids {
        body["fileIds"] = serde_json::json!(v);
    }
    if let Some(ref p) = params.poll {
        let mut poll = serde_json::json!({ "choices": p.choices });
        if let Some(m) = p.multiple {
            poll["multiple"] = serde_json::json!(m);
        }
        if let Some(e) = p.expires_at {
            poll["expiresAt"] = serde_json::json!(e);
        }
        body["poll"] = poll;
    }
    if let Some(ref v) = params.scheduled_at {
        body["scheduledAt"] = serde_json::json!(v);
    }
    body
}

#[tauri::command]
#[specta::specta]
pub async fn api_update_note(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
    params: CreateNoteParams,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.update_note(&host, &token, &note_id, params).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_delete_note(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.delete_note(&host, &token, &note_id).await
}

// --- Reactions ---

#[tauri::command]
#[specta::specta]
pub async fn api_create_reaction(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
    reaction: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .create_reaction(&host, &token, &note_id, &reaction)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_delete_reaction(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.delete_reaction(&host, &token, &note_id).await
}

// --- Poll vote ---

#[tauri::command]
#[specta::specta]
pub async fn api_vote_poll(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
    choice: u32,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.vote_poll(&host, &token, &note_id, choice).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_note_reactions(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
    reaction_type: Option<String>,
    limit: Option<u32>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNoteReaction>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .get_note_reactions(
            &host,
            &token,
            &note_id,
            reaction_type.as_deref(),
            limit.unwrap_or(11).clamp(1, 100),
            until_id.as_deref(),
        )
        .await
}

// --- Favorites ---

#[tauri::command]
#[specta::specta]
pub async fn api_create_favorite(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.create_favorite(&host, &token, &note_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_delete_favorite(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.delete_favorite(&host, &token, &note_id).await
}

// --- Pin/Unpin ---

#[tauri::command]
#[specta::specta]
pub async fn api_pin_note(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.pin_note(&host, &token, &note_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_unpin_note(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client.unpin_note(&host, &token, &note_id).await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_user_pinned_note_ids(
    app_state: State<'_, AppState>,
    account_id: String,
    user_id: String,
) -> Result<Vec<String>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .get_user_pinned_note_ids(&host, &token, &user_id)
        .await
}

// --- Clip operations ---

#[tauri::command]
#[specta::specta]
pub async fn api_add_note_to_clip(
    app_state: State<'_, AppState>,
    account_id: String,
    clip_id: String,
    note_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .add_note_to_clip(&host, &token, &clip_id, &note_id)
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_remove_note_from_clip(
    app_state: State<'_, AppState>,
    account_id: String,
    clip_id: String,
    note_id: String,
) -> Result<()> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .remove_note_from_clip(&host, &token, &clip_id, &note_id)
        .await
}

// --- Note thread ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_note_children(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
    limit: Option<u32>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .get_note_children(
            &host,
            &token,
            &account_id,
            &note_id,
            limit.unwrap_or(30).clamp(1, 100),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_note_renotes(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
    limit: Option<u32>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let data = client
        .request(
            &host,
            &token,
            "notes/renotes",
            serde_json::json!({ "noteId": note_id, "limit": limit.unwrap_or(30).clamp(1, 100) }),
        )
        .await?;
    let raw: Vec<RawNote> = serde_json::from_value(data)?;
    Ok(raw
        .into_iter()
        .map(|n| n.normalize(&account_id, &host))
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_note_conversation(
    app_state: State<'_, AppState>,
    account_id: String,
    note_id: String,
    limit: Option<u32>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .get_note_conversation(
            &host,
            &token,
            &account_id,
            &note_id,
            limit.unwrap_or(30).clamp(1, 100),
        )
        .await
}

// --- Search ---

#[tauri::command]
#[specta::specta]
pub async fn api_search_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    query: String,
    options: Option<SearchOptions>,
) -> Result<Vec<NormalizedNote>> {
    if query.len() > 1000 {
        return Err(NoteDeckError::InvalidInput(
            "Search query too long".to_string(),
        ));
    }
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .search_notes(
            &host,
            &token,
            &account_id,
            &query,
            options.unwrap_or_default(),
        )
        .await
}

// --- Upload ---

#[tauri::command]
#[specta::specta]
pub async fn api_upload_file(
    app_state: State<'_, AppState>,
    account_id: String,
    file_name: String,
    file_data: Vec<u8>,
    content_type: String,
    is_sensitive: bool,
    folder_id: Option<String>,
) -> Result<NormalizedDriveFile> {
    if file_data.len() > MAX_UPLOAD_BYTES {
        return Err(NoteDeckError::InvalidInput("File too large".to_string()));
    }
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .upload_file(
            &host,
            &token,
            &file_name,
            file_data,
            &content_type,
            is_sensitive,
            folder_id.as_deref(),
        )
        .await
}

#[tauri::command]
#[specta::specta]
pub async fn api_upload_file_from_path(
    app_state: State<'_, AppState>,
    account_id: String,
    file_path: String,
    is_sensitive: bool,
    folder_id: Option<String>,
) -> Result<NormalizedDriveFile> {
    let path = std::path::Path::new(&file_path);
    let file_data = std::fs::read(path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read file: {e}")))?;
    if file_data.len() > MAX_UPLOAD_BYTES {
        return Err(NoteDeckError::InvalidInput("File too large".to_string()));
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    let content_type = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials(&db, &account_id)?;
    client
        .upload_file(
            &host,
            &token,
            &file_name,
            file_data,
            &content_type,
            is_sensitive,
            folder_id.as_deref(),
        )
        .await
}

// --- Cache ---

#[tauri::command]
#[specta::specta]
pub async fn api_get_cached_timeline(
    app_state: State<'_, AppState>,
    account_id: String,
    timeline_type: String,
    limit: Option<i64>,
) -> Result<Vec<NormalizedNote>> {
    let db = app_state.db().await;
    db.get_cached_timeline(
        &account_id,
        &timeline_type,
        limit.unwrap_or(40).clamp(1, 200),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_cached_timeline_before(
    app_state: State<'_, AppState>,
    account_id: String,
    timeline_type: String,
    before: String,
    limit: Option<i64>,
) -> Result<Vec<NormalizedNote>> {
    if before.len() > 30 {
        return Err(NoteDeckError::InvalidInput("Invalid date".to_string()));
    }
    let db = app_state.db().await;
    db.get_cached_timeline_before(
        &account_id,
        &timeline_type,
        &before,
        limit.unwrap_or(40).clamp(1, 200),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn api_get_cache_date_range(
    app_state: State<'_, AppState>,
    account_id: String,
    timeline_type: String,
) -> Result<Option<(String, String)>> {
    let db = app_state.db().await;
    db.get_cache_date_range(&account_id, &timeline_type)
}

#[tauri::command]
#[specta::specta]
pub async fn api_find_notes_by_uri(
    app_state: State<'_, AppState>,
    uri: String,
) -> Result<Vec<NormalizedNote>> {
    let db = app_state.db().await;
    db.find_notes_by_uri(&uri)
}

#[tauri::command]
#[specta::specta]
pub async fn api_search_notes_local(
    app_state: State<'_, AppState>,
    account_id: String,
    query: String,
    limit: Option<i64>,
    since_date: Option<String>,
    until_date: Option<String>,
    ascending: Option<bool>,
) -> Result<Vec<NormalizedNote>> {
    if query.len() > 1000 {
        return Err(NoteDeckError::InvalidInput(
            "Search query too long".to_string(),
        ));
    }
    let db = app_state.db().await;
    db.search_cached_notes_advanced(
        &account_id,
        &query,
        limit.unwrap_or(30).clamp(1, 200),
        since_date.as_deref(),
        until_date.as_deref(),
        ascending.unwrap_or(false),
    )
}

#[tauri::command]
#[specta::specta]
pub async fn api_delete_cached_note(
    app_state: State<'_, AppState>,
    note_id: String,
) -> Result<()> {
    let db = app_state.db().await;
    db.delete_cached_note(&note_id)
}

/// Maximum number of concurrent note verification requests
const MAX_VERIFY_CONCURRENT: usize = 20;

/// Bulk-verify cached notes against the server.
/// Returns a map of note_id → fresh NormalizedNote for notes that still exist.
/// Missing notes (404) are omitted from the result.
#[tauri::command]
#[specta::specta]
pub async fn api_verify_notes(
    app_state: State<'_, AppState>,
    account_id: String,
    note_ids: Vec<String>,
) -> Result<HashMap<String, NormalizedNote>> {
    if note_ids.len() > 200 {
        return Err(NoteDeckError::InvalidInput(
            "Too many note IDs".to_string(),
        ));
    }
    let (db, client) = app_state.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;

    let verified: HashMap<String, NormalizedNote> = stream::iter(note_ids)
        .map(|id| {
            let host = host.clone();
            let token = token.clone();
            let account_id = account_id.clone();
            let client = client.clone();
            async move {
                let result = client.get_note(&host, &token, &account_id, &id).await;
                (id, result.ok())
            }
        })
        .buffer_unordered(MAX_VERIFY_CONCURRENT)
        .filter_map(
            |(id, note): (String, Option<NormalizedNote>)| async move {
                note.map(|n| (id, n))
            },
        )
        .collect()
        .await;

    Ok(verified)
}
