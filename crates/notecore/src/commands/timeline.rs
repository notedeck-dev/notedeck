//! タイムライン / ノート系のデータ系コマンド本体 (#1106 段階 0b)。
//! 各関数は `&Core` と引数を取り、コマンド表 (commands/table.rs) から呼ばれる。

use std::collections::HashMap;

use futures_util::stream::{self, StreamExt};

use notecli::error::NoteDeckError;
use notecli::models::{
    Antenna, Channel, Clip, CreateNoteParams, NormalizedDriveFile, NormalizedNote,
    NormalizedNoteReaction, RawCreateNoteResponse, RawNote, SearchOptions, TimelineKey,
    TimelineOptions, UserList,
};

use crate::commands::{extract_ogp_urls, MAX_UPLOAD_BYTES};
use crate::context::Core;
use crate::credentials::{get_credentials, get_credentials_or_anon};
use crate::error::Result;

/// Maximum number of concurrent OGP prefetch requests per timeline load
const MAX_OGP_CONCURRENT: usize = 20;

// --- Timelines ---

pub async fn api_get_timeline(
    core: &Core,
    account_id: String,
    timeline_type: String,
    options: Option<TimelineOptions>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = core.ready().await;
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let opts = options.unwrap_or_default();
    // 境界アダプタ: フロントの呼び出し規約 getTimeline('user-list', {listId}) を
    // canonical キーへ合成する (parse の前段。api 層は options.list_id を読まない)
    let key = if timeline_type == "user-list" {
        match opts.list_id {
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
    let notes = client
        .get_timeline(&host, &token, &account_id, &key, opts)
        .await?;
    let notes = core
        .blocking(move |db| {
            if let Err(e) = db.ingest_notes(&notes, &key) {
                tracing::warn!("[cache] failed to cache timeline notes: {e}");
            }
            Ok(notes)
        })
        .await?;

    // Background OGP prefetch: extract URLs and spawn async task (non-blocking)
    if !token.is_empty() {
        spawn_ogp_prefetch(core, &notes, host, token);
    }

    Ok(notes)
}

/// Extract URLs from notes and spawn background OGP prefetch. 結果は手元側の
/// [`crate::context::HintSink`] に渡す (無ければ何もしない)。
fn spawn_ogp_prefetch(core: &Core, notes: &[NormalizedNote], host: String, token: String) {
    let (Some(ogp_cache), Some(_)) = (core.ogp(), core.hints()) else {
        return;
    };
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

    let ogp_cache = ogp_cache.clone();
    let sink = core.hints_arc();
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
            .filter_map(
                |(url, data): (String, Option<crate::ogp::OgpData>)| async move {
                    data.map(|d| (url, d))
                },
            )
            .collect()
            .await;

        if !hints.is_empty() {
            if let Some(sink) = sink {
                sink.ogp_hints(hints);
            }
        }
    });
}

// --- Lists / Antennas ---

pub async fn api_get_user_lists(core: &Core, account_id: String) -> Result<Vec<UserList>> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.get_user_lists(&host, &token).await
}

pub async fn api_get_antennas(core: &Core, account_id: String) -> Result<Vec<Antenna>> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.get_antennas(&host, &token).await
}

/// 単一アンテナの設定を取得する (antennas/show)。
pub async fn api_get_antenna(
    core: &Core,
    account_id: String,
    antenna_id: String,
) -> Result<Antenna> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.get_antenna(&host, &token, &antenna_id).await
}

/// アンテナ設定を更新する (antennas/update)。変更済みの Antenna を全フィールド往復させる。
pub async fn api_update_antenna(
    core: &Core,
    account_id: String,
    antenna: Antenna,
) -> Result<Antenna> {
    let (client, host, token) = core.authed(&account_id).await?;
    let updated = client.update_antenna(&host, &token, &antenna).await?;
    // 設定変更後の旧マッチ分は個別ノートへ逆引きできないためバケット破棄 →
    // 次回フェッチで再構築 (失敗は warn + Ok)。writer lock を秒単位で保持し得る
    // ため spawn_blocking で退避しつつ、完了は待ってから返す — detach すると
    // フロントの再フェッチが ingest した直後に破棄が走り、再構築したばかりの
    // バケットを消すレースになる
    let db = core.db().await;
    let account_id_owned = account_id.clone();
    let key = TimelineKey::Antenna {
        antenna_id: updated.id.clone(),
    };
    let cleared =
        tokio::task::spawn_blocking(move || db.clear_timeline(&account_id_owned, &key)).await;
    match cleared {
        Ok(Err(e)) => tracing::warn!("[cache] failed to clear antenna bucket: {e}"),
        Err(e) => tracing::warn!("[cache] clear antenna bucket task failed: {e}"),
        Ok(Ok(_)) => {}
    }
    Ok(updated)
}

/// エンティティ削除 (antenna / clip / list — フロントは汎用 api_request で
/// サーバー削除する) の後始末: 死にバケットの membership を破棄する。
/// これが無いと削除済みエンティティの membership が sweep 対象外のまま
/// per-account cap まで残留する (issue notecli#30 仕様 v5 §6-7)。
pub async fn api_clear_timeline_cache(
    core: &Core,
    account_id: String,
    timeline_key: String,
) -> Result<u32> {
    // parse Err は Err 返却 (フロントのキー組み間違いを顕在化)
    let key = TimelineKey::parse(&timeline_key)?;
    let db = core.db().await;
    let removed = tokio::task::spawn_blocking(move || db.clear_timeline(&account_id, &key))
        .await
        .map_err(|e| NoteDeckError::Internal(format!("clear_timeline task failed: {e}")))??;
    Ok(removed.min(u32::MAX as u64) as u32)
}

pub async fn api_get_antenna_notes(
    core: &Core,
    account_id: String,
    antenna_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = core.ready().await;
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
    let notes = core
        .blocking(move |db| {
            if let Err(e) = db.ingest_notes(
                &notes,
                &TimelineKey::Antenna {
                    antenna_id: antenna_id.clone(),
                },
            ) {
                tracing::warn!("[cache] failed to cache antenna notes: {e}");
            }
            Ok(notes)
        })
        .await?;
    Ok(notes)
}

pub async fn api_get_favorites(
    core: &Core,
    account_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = core.ready().await;
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
    let notes = core
        .blocking(move |db| {
            if let Err(e) = db.ingest_notes(&notes, &TimelineKey::Favorites) {
                tracing::warn!("[cache] failed to cache favorites: {e}");
            }
            Ok(notes)
        })
        .await?;
    Ok(notes)
}

pub async fn api_get_featured_notes(
    core: &Core,
    account_id: String,
    limit: Option<i64>,
) -> Result<Vec<NormalizedNote>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    let notes = client
        .get_featured_notes(&host, &token, &account_id, limit.unwrap_or(30))
        .await?;
    Ok(notes)
}

pub async fn api_get_mentions(
    core: &Core,
    account_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
    visibility: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = core.ready().await;
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
        TimelineKey::Specified
    } else {
        TimelineKey::Mentions
    };
    let notes = core
        .blocking(move |db| {
            if let Err(e) = db.ingest_notes(&notes, &cache_key) {
                tracing::warn!("[cache] failed to cache mentions: {e}");
            }
            Ok(notes)
        })
        .await?;
    Ok(notes)
}

// --- Clips ---

pub async fn api_get_clips(core: &Core, account_id: String) -> Result<Vec<Clip>> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.get_clips(&host, &token).await
}

pub async fn api_get_clip_notes(
    core: &Core,
    account_id: String,
    clip_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = core.ready().await;
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
    let notes = core
        .blocking(move |db| {
            if let Err(e) = db.ingest_notes(
                &notes,
                &TimelineKey::Clip {
                    clip_id: clip_id.clone(),
                },
            ) {
                tracing::warn!("[cache] failed to cache clip notes: {e}");
            }
            Ok(notes)
        })
        .await?;
    Ok(notes)
}

// --- Channels ---

pub async fn api_get_channels(core: &Core, account_id: String) -> Result<Vec<Channel>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client.get_channels(&host, &token).await
}

pub async fn api_search_channels(
    core: &Core,
    account_id: String,
    query: String,
) -> Result<Vec<Channel>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client.search_channels(&host, &token, &query).await
}

pub async fn api_get_channel_notes(
    core: &Core,
    account_id: String,
    channel_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = core.ready().await;
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
    let notes = core
        .blocking(move |db| {
            if let Err(e) = db.ingest_notes(
                &notes,
                &TimelineKey::Channel {
                    channel_id: channel_id.clone(),
                },
            ) {
                tracing::warn!("[cache] failed to cache channel notes: {e}");
            }
            Ok(notes)
        })
        .await?;
    Ok(notes)
}

// --- Roles ---

pub async fn api_get_role_notes(
    core: &Core,
    account_id: String,
    role_id: String,
    limit: Option<i64>,
    since_id: Option<String>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNote>> {
    let (db, client) = core.ready().await;
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
    let notes = core
        .blocking(move |db| {
            if let Err(e) = db.ingest_notes(
                &notes,
                &TimelineKey::Role {
                    role_id: role_id.clone(),
                },
            ) {
                tracing::warn!("[cache] failed to cache role notes: {e}");
            }
            Ok(notes)
        })
        .await?;
    Ok(notes)
}

// --- Notes ---

pub async fn api_get_note(
    core: &Core,
    account_id: String,
    note_id: String,
) -> Result<NormalizedNote> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client.get_note(&host, &token, &account_id, &note_id).await
}

pub async fn api_create_note(
    core: &Core,
    account_id: String,
    params: CreateNoteParams,
    channel_id: Option<String>,
) -> Result<NormalizedNote> {
    let (client, host, token) = core.authed(&account_id).await?;
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

pub async fn api_update_note(
    core: &Core,
    account_id: String,
    note_id: String,
    params: CreateNoteParams,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.update_note(&host, &token, &note_id, params).await
}

pub async fn api_delete_note(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.delete_note(&host, &token, &note_id).await
}

// --- Reactions ---

pub async fn api_create_reaction(
    core: &Core,
    account_id: String,
    note_id: String,
    reaction: String,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .create_reaction(&host, &token, &note_id, &reaction)
        .await
}

pub async fn api_delete_reaction(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.delete_reaction(&host, &token, &note_id).await
}

// --- Poll vote ---

pub async fn api_vote_poll(
    core: &Core,
    account_id: String,
    note_id: String,
    choice: u32,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.vote_poll(&host, &token, &note_id, choice).await
}

pub async fn api_get_note_reactions(
    core: &Core,
    account_id: String,
    note_id: String,
    reaction_type: Option<String>,
    limit: Option<u32>,
    until_id: Option<String>,
) -> Result<Vec<NormalizedNoteReaction>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
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

pub async fn api_create_favorite(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.create_favorite(&host, &token, &note_id).await
}

pub async fn api_delete_favorite(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.delete_favorite(&host, &token, &note_id).await?;
    // サーバー成功後に favorites バケットの所属を外す (失敗は warn + Ok —
    // サーバー状態は成功済みのため。stale は TTL/cap で最終解消)
    core.blocking(move |db| {
        if let Err(e) = db.remove_membership(&account_id, &TimelineKey::Favorites, &note_id) {
            tracing::warn!("[cache] failed to remove favorites membership: {e}");
        }
        Ok(())
    })
    .await?;
    Ok(())
}

// --- Pin/Unpin ---

pub async fn api_pin_note(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.pin_note(&host, &token, &note_id).await
}

pub async fn api_unpin_note(core: &Core, account_id: String, note_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.unpin_note(&host, &token, &note_id).await
}

// --- Clip operations ---

pub async fn api_add_note_to_clip(
    core: &Core,
    account_id: String,
    clip_id: String,
    note_id: String,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .add_note_to_clip(&host, &token, &clip_id, &note_id)
        .await
}

pub async fn api_remove_note_from_clip(
    core: &Core,
    account_id: String,
    clip_id: String,
    note_id: String,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .remove_note_from_clip(&host, &token, &clip_id, &note_id)
        .await?;
    core.blocking(move |db| {
        if let Err(e) = db.remove_membership(
            &account_id,
            &TimelineKey::Clip {
                clip_id: clip_id.clone(),
            },
            &note_id,
        ) {
            tracing::warn!("[cache] failed to remove clip membership: {e}");
        }
        Ok(())
    })
    .await?;
    Ok(())
}

// --- Note thread ---

pub async fn api_get_note_children(
    core: &Core,
    account_id: String,
    note_id: String,
    limit: Option<u32>,
) -> Result<Vec<NormalizedNote>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
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

pub async fn api_get_note_renotes(
    core: &Core,
    account_id: String,
    note_id: String,
    limit: Option<u32>,
) -> Result<Vec<NormalizedNote>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
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

pub async fn api_get_note_conversation(
    core: &Core,
    account_id: String,
    note_id: String,
    limit: Option<u32>,
) -> Result<Vec<NormalizedNote>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
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

pub async fn api_search_notes(
    core: &Core,
    account_id: String,
    query: String,
    options: Option<SearchOptions>,
) -> Result<Vec<NormalizedNote>> {
    if query.len() > 1000 {
        return Err(NoteDeckError::InvalidInput(
            "Search query too long".to_string(),
        ));
    }
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
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

/// はなみすきー専用のノート検索 (`notes/hanamisearch-v1`)。
///
/// 本家 `notes/search` はロールポリシーで無効化されているため、フォーク別
/// アダプター (`src/adapters/hanamisskey/`) がこちらを呼ぶ。エンドポイントは
/// 匿名アクセスでサーバー側が 500 になるので、認証必須として扱う。
pub async fn api_search_notes_hanami(
    core: &Core,
    account_id: String,
    query: String,
    options: Option<SearchOptions>,
) -> Result<Vec<NormalizedNote>> {
    if query.len() > 1000 {
        return Err(NoteDeckError::InvalidInput(
            "Search query too long".to_string(),
        ));
    }
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .search_notes_hanami(
            &host,
            &token,
            &account_id,
            &query,
            options.unwrap_or_default(),
        )
        .await
}

// --- Upload ---

pub async fn api_upload_file(
    core: &Core,
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
    let (client, host, token) = core.authed(&account_id).await?;
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

pub async fn api_get_cached_timeline(
    core: &Core,
    account_id: String,
    timeline_type: String,
    limit: Option<i64>,
) -> Result<Vec<NormalizedNote>> {
    // 不正キーは黙殺せず Err で顕在化させる (フロントは catch → [] で安全)
    let key = TimelineKey::parse(&timeline_type)?;
    core.blocking(move |db| {
        db.get_cached_timeline(&account_id, &key, limit.unwrap_or(40).clamp(1, 200))
    })
    .await
}

pub async fn api_get_cached_timeline_before(
    core: &Core,
    account_id: String,
    timeline_type: String,
    before: String,
    before_note_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<NormalizedNote>> {
    if before.len() > 30 {
        return Err(NoteDeckError::InvalidInput("Invalid date".to_string()));
    }
    let key = TimelineKey::parse(&timeline_type)?;
    core.blocking(move |db| {
        db.get_cached_timeline_before(
            &account_id,
            &key,
            &before,
            before_note_id.as_deref(),
            limit.unwrap_or(40).clamp(1, 200),
        )
    })
    .await
}

pub async fn api_get_cache_date_range(
    core: &Core,
    account_id: String,
    timeline_type: String,
) -> Result<Option<(String, String)>> {
    let key = TimelineKey::parse(&timeline_type)?;
    core.blocking(move |db| db.get_cache_date_range(&account_id, &key))
        .await
}

/// identity (正規化 AP object id) でローカルキャッシュを account 横断で引く (#1058)。
/// 引数は生の URI でもよい (notecli 側で同じ規則で正規化する)。
pub async fn api_find_notes_by_identity(core: &Core, uri: String) -> Result<Vec<NormalizedNote>> {
    core.blocking(move |db| db.find_notes_by_identity(&uri))
        .await
}

/// URI を identity に正規化する。導出規則は notecli 側の 1 か所に閉じ、
/// フロントは結果を読むだけにする (#1058)。
/// URI からノートの同一性キーを返す (#1058)。純関数だが表の規約どおり Result で返す。
pub async fn api_note_identity(_core: &Core, uri: String) -> Result<String> {
    Ok(notecli::identity::identity_of(Some(&uri), "", ""))
}

pub async fn api_search_notes_local(
    core: &Core,
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
    core.blocking(move |db| {
        db.search_cached_notes_advanced(
            &account_id,
            &query,
            limit.unwrap_or(30).clamp(1, 200),
            since_date.as_deref(),
            until_date.as_deref(),
            ascending.unwrap_or(false),
        )
    })
    .await
}

/// クライアント検索 (notedeck#945 / #958): 複数アカウントのキャッシュを横断して
/// 引く。結果は取得元アカウントごとの variant のまま返し、束ねはフロントが行う。
#[allow(clippy::too_many_arguments)]
pub async fn api_search_notes_cached_across(
    core: &Core,
    account_ids: Vec<String>,
    query: String,
    limit: Option<i64>,
    since_date: Option<String>,
    until_date: Option<String>,
    ascending: Option<bool>,
    author: Option<String>,
    has_files: Option<bool>,
    public_only: Option<bool>,
) -> Result<Vec<NormalizedNote>> {
    if query.len() > 1000 {
        return Err(NoteDeckError::InvalidInput(
            "Search query too long".to_string(),
        ));
    }
    core.blocking(move |db| {
        let ids: Vec<&str> = account_ids.iter().map(String::as_str).collect();
        db.search_cached_notes_across(
            &ids,
            &notecli::db::CachedSearchOptions {
                query: &query,
                limit: limit.unwrap_or(50).clamp(1, 200),
                since_date: since_date.as_deref(),
                until_date: until_date.as_deref(),
                ascending: ascending.unwrap_or(false),
                author: author.as_deref().filter(|a| !a.trim().is_empty()),
                has_files,
                public_only: public_only.unwrap_or(false),
            },
        )
    })
    .await
}

pub async fn api_delete_cached_note(
    core: &Core,
    account_id: String,
    note_id: String,
) -> Result<()> {
    core.blocking(move |db| db.delete_cached_note(&account_id, &note_id))
        .await?;
    Ok(())
}

/// Maximum number of concurrent note verification requests
const MAX_VERIFY_CONCURRENT: usize = 20;

/// `api_verify_notes` の結果。
#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VerifyNotesResult {
    /// サーバー上に現存が確認できたノート (note_id → 最新の NormalizedNote)
    pub verified: HashMap<String, NormalizedNote>,
    /// サーバーが NO_SUCH_NOTE を返した = 削除が確認できたノート id。
    /// 通信エラー・レート制限・タイムアウトはどちらにも含まれない (生存扱い) —
    /// 復帰直後の不安定なネットワークでキャッシュを誤って恒久削除しないため
    /// (issue notecli#30 仕様 v5 §6-8)。
    pub missing: Vec<String>,
}

/// Bulk-verify cached notes against the server.
pub async fn api_verify_notes(
    core: &Core,
    account_id: String,
    note_ids: Vec<String>,
) -> Result<VerifyNotesResult> {
    if note_ids.len() > 200 {
        return Err(NoteDeckError::InvalidInput("Too many note IDs".to_string()));
    }
    let (client, host, token) = core.authed_or_anon(&account_id).await?;

    let results: Vec<(String, std::result::Result<NormalizedNote, NoteDeckError>)> =
        stream::iter(note_ids)
            .map(|id| {
                let host = host.clone();
                let token = token.clone();
                let account_id = account_id.clone();
                let client = client.clone();
                async move {
                    let result = client.get_note(&host, &token, &account_id, &id).await;
                    (id, result)
                }
            })
            .buffer_unordered(MAX_VERIFY_CONCURRENT)
            .collect()
            .await;

    let mut verified = HashMap::new();
    let mut missing = Vec::new();
    for (id, result) in results {
        match result {
            Ok(note) => {
                verified.insert(id, note);
            }
            // 削除確認は NO_SUCH_NOTE のみ。それ以外のエラーは生存扱いでスキップ
            Err(NoteDeckError::Api {
                api_code: Some(code),
                ..
            }) if code == "NO_SUCH_NOTE" => {
                missing.push(id);
            }
            Err(e) => {
                tracing::debug!(note_id = %id, error = %e, "note verification inconclusive; treating as alive");
            }
        }
    }

    Ok(VerifyNotesResult { verified, missing })
}
