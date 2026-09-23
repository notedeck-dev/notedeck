use std::collections::{HashMap, HashSet};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::multipart::{Form, Part};
use reqwest::Client;
use serde_json::{json, Value};

use crate::error::{AuthErrorKind, NoteDeckError};
use crate::models::{
    Antenna, AuthResult, Channel, ChatMessage, ChatUser, Clip, CreateNoteParams, MutedWordsResult,
    NormalizedDriveFile, NormalizedNote, NormalizedNoteReaction, NormalizedNotification,
    NormalizedUser, NormalizedUserDetail, RawCreateNoteResponse, RawDriveFile, RawEmojisResponse,
    RawMiAuthResponse, RawNote, RawNoteReaction, RawNotification, RawUser, RawUserDetail,
    SearchOptions, ServerEmoji, TimelineKey, TimelineOptions, UserList,
};

/// Maximum response body size (50 MB) to prevent memory exhaustion from malicious servers.
const MAX_RESPONSE_BYTES: usize = 50 * 1024 * 1024;

/// Options for `search_users`.
#[derive(Default)]
pub struct SearchUsersOptions<'a> {
    pub query: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub sort: Option<&'a str>,
    pub state: Option<&'a str>,
    pub limit: i64,
    pub offset: Option<i64>,
}

/// Apply sinceId/untilId pagination to a JSON params object.
fn apply_pagination(params: &mut Value, since_id: Option<&str>, until_id: Option<&str>) {
    if let Some(id) = since_id {
        params["sinceId"] = json!(id);
    }
    if let Some(id) = until_id {
        params["untilId"] = json!(id);
    }
}

/// Misskey ID (aid / aidx) の時刻部の基準時刻 (2000-01-01T00:00:00Z)。
const TIME2000_MS: i64 = 946_684_800_000;

/// epoch ミリ秒を Misskey ID の時刻部 (base36 8 桁) に変換する。
///
/// サーバーは sinceId/untilId を `idService.parse()` で createdAt に戻して
/// 比較するため、時刻部だけの ID でも日付フィルタとして機能する。
fn misskey_id_at(ms: i64) -> String {
    let mut n = (ms - TIME2000_MS).max(0) as u64;
    let mut s = String::new();
    while n > 0 {
        s.insert(0, char::from_digit((n % 36) as u32, 36).unwrap());
        n /= 36;
    }
    format!("{s:0>8}")
}

pub struct MisskeyClient {
    client: Client,
    /// Override base URL for testing (e.g. "http://127.0.0.1:PORT").
    /// When set, requests use `{base_url}/api/{endpoint}` instead of `https://{host}/api/{endpoint}`.
    #[cfg(test)]
    base_url: Option<String>,
}

impl MisskeyClient {
    pub fn new() -> Result<Self, NoteDeckError> {
        Ok(Self {
            client: Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
                .timeout(Duration::from_secs(30))
                .connect_timeout(Duration::from_secs(10))
                .pool_max_idle_per_host(4)
                .build()?,
            #[cfg(test)]
            base_url: None,
        })
    }

    #[cfg(test)]
    pub(crate) fn with_base_url(base_url: &str) -> Self {
        Self {
            client: Client::new(),
            base_url: Some(base_url.to_string()),
        }
    }

    fn api_url(&self, host: &str, endpoint: &str) -> String {
        #[cfg(test)]
        if let Some(ref base) = self.base_url {
            return format!("{base}/api/{endpoint}");
        }
        let scheme = crate::insecure::http_scheme(host);
        format!("{scheme}://{host}/api/{endpoint}")
    }

    /// Read the response body with a streaming size limit to prevent DoS.
    /// Enforces the limit incrementally so chunked responses cannot bypass it.
    async fn read_body_limited(
        res: reqwest::Response,
        endpoint: &str,
    ) -> Result<String, NoteDeckError> {
        let content_len = res.content_length();
        if let Some(len) = content_len {
            if len > MAX_RESPONSE_BYTES as u64 {
                return Err(NoteDeckError::Api {
                    endpoint: endpoint.to_string(),
                    status: 0,
                    api_code: None,
                    message: "Response too large".to_string(),
                });
            }
        }
        let mut buf =
            Vec::with_capacity(content_len.unwrap_or(4096).min(MAX_RESPONSE_BYTES as u64) as usize);
        let mut stream = res.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(NoteDeckError::from)?;
            buf.extend_from_slice(&chunk);
            if buf.len() > MAX_RESPONSE_BYTES {
                return Err(NoteDeckError::Api {
                    endpoint: endpoint.to_string(),
                    status: 0,
                    api_code: None,
                    message: "Response too large".to_string(),
                });
            }
        }
        String::from_utf8(buf).map_err(|_| NoteDeckError::Api {
            endpoint: endpoint.to_string(),
            status: 0,
            api_code: None,
            message: "Invalid UTF-8 in response".to_string(),
        })
    }

    pub async fn request(
        &self,
        host: &str,
        token: &str,
        endpoint: &str,
        mut params: Value,
    ) -> Result<Value, NoteDeckError> {
        if let Some(obj) = params.as_object_mut() {
            if !token.is_empty() {
                obj.insert("i".to_string(), json!(token));
            }
        }

        let res = self
            .client
            .post(self.api_url(host, endpoint))
            .json(&params)
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status().as_u16();
            let (api_code, detail) = match res.json::<Value>().await {
                Ok(body) => {
                    let code = body
                        .pointer("/error/code")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let msg = body
                        .pointer("/error/message")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    (code, msg)
                }
                Err(_) => (None, None),
            };
            let message = match (&api_code, &detail) {
                (Some(c), Some(d)) => format!("{endpoint}: {c}: {d}"),
                (Some(c), None) => format!("{endpoint}: {c}"),
                (None, Some(d)) => format!("{endpoint}: {d}"),
                (None, None) => format!("{endpoint} ({status})"),
            };
            return Err(NoteDeckError::Api {
                endpoint: endpoint.to_string(),
                status,
                api_code,
                message,
            });
        }

        let text = Self::read_body_limited(res, endpoint).await?;
        if text.is_empty() {
            Ok(Value::Null)
        } else {
            serde_json::from_str(&text).map_err(NoteDeckError::from)
        }
    }

    /// タイムラインを取得する。endpoint と追加パラメータ (listId 等) は `key` から
    /// 導出する (`TimelineOptions.list_id` は境界アダプタ入力であり本 API は読まない)。
    /// 専用 API を持つ種別 (Favorites / Clip — `api_endpoint() == None`) は Err。
    pub async fn get_timeline(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        key: &TimelineKey,
        options: TimelineOptions,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let (endpoint, key_params) = key.api_endpoint().ok_or_else(|| {
            NoteDeckError::InvalidInput(format!(
                "timeline key '{key}' has no generic timeline endpoint"
            ))
        })?;
        let mut params = json!({ "limit": options.limit() });
        if let Value::Object(extra) = key_params {
            for (k, v) in extra {
                params[k] = v;
            }
        }
        apply_pagination(
            &mut params,
            options.since_id.as_deref(),
            options.until_id.as_deref(),
        );
        if let Some(ref f) = options.filters {
            if let Some(v) = f.with_renotes {
                params["withRenotes"] = json!(v);
            }
            if let Some(v) = f.with_replies {
                params["withReplies"] = json!(v);
            }
            if let Some(v) = f.with_files {
                params["withFiles"] = json!(v);
            }
            if let Some(v) = f.with_bots {
                params["withBots"] = json!(v);
                // Some forks use excludeBots (inverse semantics)
                params["excludeBots"] = json!(!v);
            }
            if let Some(v) = f.with_sensitive {
                params["withSensitive"] = json!(v);
                params["excludeNsfw"] = json!(!v);
            }
        }

        let data = self.request(host, token, &endpoint, params).await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn get_user_lists(
        &self,
        host: &str,
        token: &str,
    ) -> Result<Vec<UserList>, NoteDeckError> {
        let data = self
            .request(host, token, "users/lists/list", json!({}))
            .await?;
        let lists: Vec<UserList> = serde_json::from_value(data)?;
        Ok(lists)
    }

    pub async fn get_antennas(
        &self,
        host: &str,
        token: &str,
    ) -> Result<Vec<Antenna>, NoteDeckError> {
        let data = self
            .request(host, token, "antennas/list", json!({}))
            .await?;
        let antennas: Vec<Antenna> = serde_json::from_value(data)?;
        Ok(antennas)
    }

    /// 単一アンテナの設定を取得する (antennas/show)。
    pub async fn get_antenna(
        &self,
        host: &str,
        token: &str,
        antenna_id: &str,
    ) -> Result<Antenna, NoteDeckError> {
        let data = self
            .request(
                host,
                token,
                "antennas/show",
                json!({ "antennaId": antenna_id }),
            )
            .await?;
        let antenna: Antenna = serde_json::from_value(data)?;
        Ok(antenna)
    }

    /// アンテナ設定を更新する (antennas/update)。
    /// 本家 API は全フィールドを要求するため、変更済みの `Antenna` をそのまま往復させる。
    pub async fn update_antenna(
        &self,
        host: &str,
        token: &str,
        antenna: &Antenna,
    ) -> Result<Antenna, NoteDeckError> {
        let body = json!({
            "antennaId": antenna.id,
            "name": antenna.name,
            "src": antenna.src,
            "userListId": antenna.user_list_id,
            "users": antenna.users,
            "keywords": antenna.keywords,
            "excludeKeywords": antenna.exclude_keywords,
            "caseSensitive": antenna.case_sensitive,
            "localOnly": antenna.local_only,
            "excludeBots": antenna.exclude_bots,
            "withReplies": antenna.with_replies,
            "withFile": antenna.with_file,
            "notify": antenna.notify,
        });
        let data = self.request(host, token, "antennas/update", body).await?;
        let updated: Antenna = serde_json::from_value(data)?;
        Ok(updated)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_antenna_notes(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        antenna_id: &str,
        limit: i64,
        since_id: Option<&str>,
        until_id: Option<&str>,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({
            "antennaId": antenna_id,
            "limit": limit,
        });
        apply_pagination(&mut params, since_id, until_id);
        let data = self.request(host, token, "antennas/notes", params).await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn get_favorites(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        limit: i64,
        since_id: Option<&str>,
        until_id: Option<&str>,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({ "limit": limit });
        apply_pagination(&mut params, since_id, until_id);
        let data = self.request(host, token, "i/favorites", params).await?;
        // i/favorites returns [{ id, note: {...}, ... }]
        let items: Vec<Value> = serde_json::from_value(data)?;
        let mut notes = Vec::with_capacity(items.len());
        for mut item in items {
            if let Some(note_val) = item.get_mut("note").map(Value::take) {
                let raw: RawNote = serde_json::from_value(note_val)?;
                notes.push(raw.normalize(account_id, host));
            }
        }
        Ok(notes)
    }

    pub async fn get_featured_notes(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        limit: i64,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let params = json!({ "limit": limit });
        let data = self.request(host, token, "notes/featured", params).await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn get_clips(&self, host: &str, token: &str) -> Result<Vec<Clip>, NoteDeckError> {
        let data = self.request(host, token, "clips/list", json!({})).await?;
        let clips: Vec<Clip> = serde_json::from_value(data)?;
        Ok(clips)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_clip_notes(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        clip_id: &str,
        limit: i64,
        since_id: Option<&str>,
        until_id: Option<&str>,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({
            "clipId": clip_id,
            "limit": limit,
        });
        apply_pagination(&mut params, since_id, until_id);
        let data = self.request(host, token, "clips/notes", params).await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn get_channels(
        &self,
        host: &str,
        token: &str,
    ) -> Result<Vec<Channel>, NoteDeckError> {
        let search_fut = self.request(
            host,
            token,
            "channels/search",
            json!({"query": "", "limit": 100}),
        );
        let featured_fut = self.request(host, token, "channels/featured", json!({}));

        let (followed, favorites, owned, featured, search) = if token.is_empty() {
            let (fe, s) = tokio::join!(featured_fut, search_fut);
            (None, None, None, Some(fe), Some(s))
        } else {
            let (fo, fa, o, fe, s) = tokio::join!(
                self.request(host, token, "channels/followed", json!({"limit": 100})),
                self.request(host, token, "channels/my-favorites", json!({"limit": 100})),
                self.request(host, token, "channels/owned", json!({"limit": 100})),
                featured_fut,
                search_fut,
            );
            (Some(fo), Some(fa), Some(o), Some(fe), Some(s))
        };

        let mut seen = std::collections::HashSet::with_capacity(128);
        let mut channels = Vec::with_capacity(128);

        // User's own channels first, then public channels
        for data in [followed, favorites, owned, featured, search]
            .into_iter()
            .flatten()
            .flatten()
        {
            if let Ok(list) = serde_json::from_value::<Vec<Channel>>(data) {
                for ch in list {
                    if seen.insert(ch.id.clone()) {
                        channels.push(ch);
                    }
                }
            }
        }

        Ok(channels)
    }

    pub async fn search_channels(
        &self,
        host: &str,
        token: &str,
        query: &str,
    ) -> Result<Vec<Channel>, NoteDeckError> {
        let data = self
            .request(
                host,
                token,
                "channels/search",
                json!({"query": query, "limit": 100}),
            )
            .await?;
        let channels: Vec<Channel> = serde_json::from_value(data)?;
        Ok(channels)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_channel_notes(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        channel_id: &str,
        limit: i64,
        since_id: Option<&str>,
        until_id: Option<&str>,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({
            "channelId": channel_id,
            "limit": limit,
        });
        apply_pagination(&mut params, since_id, until_id);
        let data = self
            .request(host, token, "channels/timeline", params)
            .await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_mentions(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        limit: i64,
        since_id: Option<&str>,
        until_id: Option<&str>,
        visibility: Option<&str>,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({ "limit": limit });
        apply_pagination(&mut params, since_id, until_id);
        if let Some(v) = visibility {
            params["visibility"] = json!(v);
        }
        let data = self.request(host, token, "notes/mentions", params).await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn get_note(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        note_id: &str,
    ) -> Result<NormalizedNote, NoteDeckError> {
        let data = self
            .request(host, token, "notes/show", json!({ "noteId": note_id }))
            .await?;
        let raw: RawNote = serde_json::from_value(data)?;
        Ok(raw.normalize(account_id, host))
    }

    pub async fn create_note(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        params: CreateNoteParams,
    ) -> Result<NormalizedNote, NoteDeckError> {
        let mut body = json!({});
        if let Some(ref text) = params.text {
            body["text"] = json!(text);
        }
        if let Some(ref cw) = params.cw {
            body["cw"] = json!(cw);
        }
        if let Some(ref vis) = params.visibility {
            body["visibility"] = json!(vis);
        }
        if let Some(local_only) = params.local_only {
            body["localOnly"] = json!(local_only);
        }
        if let Some(ref flags) = params.mode_flags {
            for (key, value) in flags {
                // Only allow isNoteIn*Mode flags (e.g., isNoteInYamiMode)
                if key.starts_with("isNoteIn") && key.ends_with("Mode") && key.len() <= 30 {
                    body[key] = json!(value);
                }
            }
        }
        if let Some(ref id) = params.reply_id {
            body["replyId"] = json!(id);
        }
        if let Some(ref id) = params.renote_id {
            body["renoteId"] = json!(id);
        }
        if let Some(ref ids) = params.file_ids {
            body["fileIds"] = json!(ids);
        }
        if let Some(ref poll) = params.poll {
            body["poll"] = json!(poll);
        }
        if let Some(ref scheduled_at) = params.scheduled_at {
            body["scheduledAt"] = json!(scheduled_at);
        }

        let data = self.request(host, token, "notes/create", body).await?;
        let raw: RawCreateNoteResponse = serde_json::from_value(data)?;
        Ok(raw.created_note.normalize(account_id, host))
    }

    pub async fn create_reaction(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
        reaction: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "notes/reactions/create",
            json!({ "noteId": note_id, "reaction": reaction }),
        )
        .await?;
        Ok(())
    }

    pub async fn delete_reaction(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "notes/reactions/delete",
            json!({ "noteId": note_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn vote_poll(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
        choice: u32,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "notes/polls/vote",
            json!({ "noteId": note_id, "choice": choice }),
        )
        .await?;
        Ok(())
    }

    pub async fn get_note_reactions(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
        reaction_type: Option<&str>,
        limit: u32,
        until_id: Option<&str>,
    ) -> Result<Vec<NormalizedNoteReaction>, NoteDeckError> {
        let mut params = json!({ "noteId": note_id, "limit": limit });
        if let Some(rt) = reaction_type {
            params["type"] = json!(rt);
        }
        if let Some(uid) = until_id {
            params["untilId"] = json!(uid);
        }
        let data = self.request(host, token, "notes/reactions", params).await?;
        let raw: Vec<RawNoteReaction> = serde_json::from_value(data)?;
        Ok(raw.into_iter().map(Into::into).collect())
    }

    pub async fn update_note(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
        params: CreateNoteParams,
    ) -> Result<(), NoteDeckError> {
        let mut body = json!({ "noteId": note_id });
        if let Some(ref text) = params.text {
            body["text"] = json!(text);
        }
        if let Some(ref cw) = params.cw {
            body["cw"] = json!(cw);
        }
        if let Some(ref ids) = params.file_ids {
            body["fileIds"] = json!(ids);
        }
        self.request(host, token, "notes/update", body).await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn upload_file(
        &self,
        host: &str,
        token: &str,
        file_name: &str,
        file_data: Vec<u8>,
        content_type: &str,
        is_sensitive: bool,
        folder_id: Option<&str>,
    ) -> Result<NormalizedDriveFile, NoteDeckError> {
        let file_part = Part::bytes(file_data)
            .file_name(file_name.to_string())
            .mime_str(content_type)
            .map_err(|e| NoteDeckError::Api {
                endpoint: "drive/files/create".to_string(),
                status: 0,
                api_code: None,
                message: e.to_string(),
            })?;

        let mut form = Form::new()
            .text("i", token.to_string())
            .text("isSensitive", is_sensitive.to_string())
            .part("file", file_part);
        if let Some(id) = folder_id {
            form = form.text("folderId", id.to_string());
        }

        let url = self.api_url(host, "drive/files/create");
        let resp = self.client.post(&url).multipart(form).send().await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let message = Self::read_body_limited(resp, "drive/files/create")
                .await
                .unwrap_or_default();
            return Err(NoteDeckError::Api {
                endpoint: "drive/files/create".to_string(),
                status,
                api_code: None,
                message,
            });
        }

        let text = Self::read_body_limited(resp, "drive/files/create").await?;
        let raw: RawDriveFile = serde_json::from_str(&text)?;
        Ok(NormalizedDriveFile::from(raw))
    }

    pub async fn create_favorite(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "notes/favorites/create",
            json!({ "noteId": note_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn delete_favorite(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "notes/favorites/delete",
            json!({ "noteId": note_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn delete_note(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "notes/delete", json!({ "noteId": note_id }))
            .await?;
        Ok(())
    }

    pub async fn get_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<NormalizedUser, NoteDeckError> {
        let data = self
            .request(host, token, "users/show", json!({ "userId": user_id }))
            .await?;
        let raw: RawUser = serde_json::from_value(data)?;
        Ok(raw.into())
    }

    pub async fn get_user_detail(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        user_id: &str,
    ) -> Result<NormalizedUserDetail, NoteDeckError> {
        let data = self
            .request(host, token, "users/show", json!({ "userId": user_id }))
            .await?;
        let raw: RawUserDetail = serde_json::from_value(data)?;
        Ok(raw.normalize(account_id, host))
    }

    pub async fn get_server_emojis(
        &self,
        host: &str,
        token: &str,
    ) -> Result<Vec<ServerEmoji>, NoteDeckError> {
        let data = self.request(host, token, "emojis", json!({})).await?;
        let raw: RawEmojisResponse = serde_json::from_value(data)?;
        Ok(raw.emojis.into_iter().map(ServerEmoji::from).collect())
    }

    pub async fn get_pinned_reactions(
        &self,
        host: &str,
        token: &str,
    ) -> Result<Vec<String>, NoteDeckError> {
        // New Misskey preferences: scope ['client', 'preferences', 'sync'], key 'default:emojiPalettes'
        // Format: [[scope, palettes], ...] where palettes is [{id, name, emojis}, ...]
        if let Ok(data) = self.request(
            host, token, "i/registry/get",
            json!({ "scope": ["client", "preferences", "sync"], "key": "default:emojiPalettes" }),
        ).await {
            if let Some(emojis) = Self::extract_reaction_palette(&data) {
                if !emojis.is_empty() {
                    return Ok(emojis);
                }
            }
        }

        Ok(vec![])
    }

    fn extract_reaction_palette(data: &Value) -> Option<Vec<String>> {
        let entries = data.as_array()?;
        let (_, palettes_val) = entries.first().and_then(|e| {
            let arr = e.as_array()?;
            Some((arr.first()?, arr.get(1)?))
        })?;
        let palettes = palettes_val.as_array()?;
        let first = palettes.first()?;
        let emojis = first.get("emojis")?.as_array()?;
        Some(
            emojis
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect(),
        )
    }

    pub async fn get_user_notes(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        user_id: &str,
        options: TimelineOptions,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({ "userId": user_id, "limit": options.limit() });
        apply_pagination(
            &mut params,
            options.since_id.as_deref(),
            options.until_id.as_deref(),
        );
        let data = self.request(host, token, "users/notes", params).await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn search_notes(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        query: &str,
        options: SearchOptions,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({ "query": query, "limit": options.limit() });
        apply_pagination(
            &mut params,
            options.since_id.as_deref(),
            options.until_id.as_deref(),
        );
        if let Some(d) = options.since_date {
            params["sinceDate"] = json!(d);
        }
        if let Some(d) = options.until_date {
            params["untilDate"] = json!(d);
        }
        if let Some(ref uid) = options.user_id {
            params["userId"] = json!(uid);
        }
        let data = self.request(host, token, "notes/search", params).await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    /// はなみすきー (hanamisskey/misskey) 独自のノート検索。
    ///
    /// 本家 `notes/search` はロールポリシー `canSearchNotes` で無効化されており、
    /// 代わりに `notes/hanamisearch-v1` が開放されている。このエンドポイントは
    /// sinceDate/untilDate を受け付けないため、日付は ID の時刻部に変換して渡す。
    /// ページング用の sinceId/untilId が明示されていればそちらを優先する
    /// (untilId で遡る 2 ページ目以降は日付の上限より必ず古いため)。
    pub async fn search_notes_hanami(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        query: &str,
        options: SearchOptions,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({ "query": query, "limit": options.limit() });
        let since_id = options
            .since_id
            .clone()
            .or_else(|| options.since_date.map(misskey_id_at));
        let until_id = options
            .until_id
            .clone()
            .or_else(|| options.until_date.map(misskey_id_at));
        apply_pagination(&mut params, since_id.as_deref(), until_id.as_deref());
        if let Some(ref uid) = options.user_id {
            params["userId"] = json!(uid);
        }
        let data = self
            .request(host, token, "notes/hanamisearch-v1", params)
            .await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn get_notifications(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        options: TimelineOptions,
    ) -> Result<Vec<NormalizedNotification>, NoteDeckError> {
        let mut params = json!({ "limit": options.limit() });
        apply_pagination(
            &mut params,
            options.since_id.as_deref(),
            options.until_id.as_deref(),
        );
        let data = self.request(host, token, "i/notifications", params).await?;
        let raw: Vec<RawNotification> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn get_notifications_grouped(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        options: TimelineOptions,
    ) -> Result<Vec<NormalizedNotification>, NoteDeckError> {
        let mut params = json!({ "limit": options.limit() });
        apply_pagination(
            &mut params,
            options.since_id.as_deref(),
            options.until_id.as_deref(),
        );
        let data = self
            .request(host, token, "i/notifications-grouped", params)
            .await?;
        let raw: Vec<RawNotification> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    // --- Auth ---

    pub async fn complete_auth(
        &self,
        host: &str,
        session_id: &str,
    ) -> Result<AuthResult, NoteDeckError> {
        let res = self
            .client
            .post(self.api_url(host, &format!("miauth/{session_id}/check")))
            .json(&json!({}))
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(NoteDeckError::Auth(AuthErrorKind::MiAuthFailed(
                res.status().as_u16(),
            )));
        }

        let text = Self::read_body_limited(res, "miauth/check").await?;
        let data: RawMiAuthResponse = serde_json::from_str(&text)?;
        if !data.ok {
            return Err(NoteDeckError::Auth(AuthErrorKind::MiAuthPending));
        }

        let token = data
            .token
            .ok_or(NoteDeckError::Auth(AuthErrorKind::MiAuthMalformed("token")))?;
        let user = data
            .user
            .ok_or(NoteDeckError::Auth(AuthErrorKind::MiAuthMalformed("user")))?;

        Ok(AuthResult {
            token,
            user: user.into(),
        })
    }

    /// Fetch all keys in a registry scope. Returns None if empty or not found (API error).
    /// Propagates network and other non-API errors.
    pub async fn get_registry_all(
        &self,
        host: &str,
        token: &str,
        scope: &[String],
    ) -> Result<Option<Value>, NoteDeckError> {
        let data = self
            .request(host, token, "i/registry/get-all", json!({ "scope": scope }))
            .await;
        match data {
            Ok(v) => {
                if let Some(obj) = v.as_object() {
                    if obj.is_empty() {
                        return Ok(None);
                    }
                }
                Ok(Some(v))
            }
            Err(NoteDeckError::Api { .. }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Fetch a single registry value at the given scope/key.
    /// Returns None when the key does not exist (NO_SUCH_KEY) or the API errors.
    /// Propagates network and other non-API errors.
    pub async fn get_registry_value(
        &self,
        host: &str,
        token: &str,
        scope: &[String],
        key: &str,
    ) -> Result<Option<Value>, NoteDeckError> {
        let data = self
            .request(
                host,
                token,
                "i/registry/get",
                json!({ "scope": scope, "key": key }),
            )
            .await;
        match data {
            Ok(v) => Ok(Some(v)),
            Err(NoteDeckError::Api { .. }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Set a registry value at the given scope/key.
    pub async fn set_registry_value(
        &self,
        host: &str,
        token: &str,
        scope: &[String],
        key: &str,
        value: Value,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "i/registry/set",
            json!({ "scope": scope, "key": key, "value": value }),
        )
        .await?;
        Ok(())
    }

    /// Remove a registry value at the given scope/key.
    /// Returns Ok even if the key did not exist (NO_SUCH_KEY).
    pub async fn remove_registry_value(
        &self,
        host: &str,
        token: &str,
        scope: &[String],
        key: &str,
    ) -> Result<(), NoteDeckError> {
        let res = self
            .request(
                host,
                token,
                "i/registry/remove",
                json!({ "scope": scope, "key": key }),
            )
            .await;
        match res {
            Ok(_) => Ok(()),
            Err(NoteDeckError::Api { .. }) => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// List keys in a registry scope as `{ key: type }`.
    /// Returns an empty map when the scope is empty or the API errors.
    pub async fn list_registry_keys(
        &self,
        host: &str,
        token: &str,
        scope: &[String],
    ) -> Result<HashMap<String, String>, NoteDeckError> {
        let data = self
            .request(
                host,
                token,
                "i/registry/keys-with-type",
                json!({ "scope": scope }),
            )
            .await;
        match data {
            Ok(v) => Ok(serde_json::from_value(v).unwrap_or_default()),
            Err(NoteDeckError::Api { .. }) => Ok(HashMap::new()),
            Err(e) => Err(e),
        }
    }

    pub async fn get_note_children(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        note_id: &str,
        limit: u32,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let data = self
            .request(
                host,
                token,
                "notes/children",
                json!({ "noteId": note_id, "limit": limit }),
            )
            .await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn get_note_conversation(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        note_id: &str,
        limit: u32,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let data = self
            .request(
                host,
                token,
                "notes/conversation",
                json!({ "noteId": note_id, "limit": limit }),
            )
            .await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    pub async fn lookup_user(
        &self,
        host: &str,
        token: &str,
        username: &str,
        user_host: Option<&str>,
    ) -> Result<NormalizedUser, NoteDeckError> {
        let mut params = json!({ "username": username });
        if let Some(h) = user_host {
            params["host"] = json!(h);
        }
        let data = self.request(host, token, "users/show", params).await?;
        let raw: RawUser = serde_json::from_value(data)?;
        Ok(raw.into())
    }

    pub async fn follow_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "following/create",
            json!({ "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn unfollow_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "following/delete",
            json!({ "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn invalidate_follower(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "following/invalidate",
            json!({ "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    /// フォロー設定を更新する (following/update)。
    /// `notify` は 'normal' | 'none'、`with_replies` は TL に他者宛て返信を含めるか。
    /// いずれも指定されたものだけを送信する。
    pub async fn update_following(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
        notify: Option<&str>,
        with_replies: Option<bool>,
    ) -> Result<(), NoteDeckError> {
        let mut body = json!({ "userId": user_id });
        if let Some(n) = notify {
            body["notify"] = json!(n);
        }
        if let Some(w) = with_replies {
            body["withReplies"] = json!(w);
        }
        self.request(host, token, "following/update", body).await?;
        Ok(())
    }

    /// このユーザーに対する自分用メモを更新する (users/update-memo)。
    /// 空文字を渡すとメモが削除される (本家挙動準拠)。
    pub async fn update_user_memo(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
        memo: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "users/update-memo",
            json!({ "userId": user_id, "memo": memo }),
        )
        .await?;
        Ok(())
    }

    pub async fn accept_follow_request(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "following/requests/accept",
            json!({ "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn reject_follow_request(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "following/requests/reject",
            json!({ "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    /// 自分が送ったフォローリクエストを取り消す (following/requests/cancel)。
    /// 鍵アカウント宛ての未承認リクエストに使う (following/delete は notFollowing エラーになる)。
    pub async fn cancel_follow_request(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "following/requests/cancel",
            json!({ "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    /// Fetch server meta information.
    pub async fn get_meta(&self, host: &str, token: &str) -> Result<Value, NoteDeckError> {
        self.request(host, token, "meta", json!({})).await
    }

    /// Fetch boolean policy flags and mode flags from /api/i.
    /// Returns policies (e.g. ltlAvailable, yamiTlAvailable) and
    /// top-level mode flags matching isIn*Mode (e.g. isInYamiMode).
    pub async fn get_user_policies(
        &self,
        host: &str,
        token: &str,
    ) -> Result<HashMap<String, bool>, NoteDeckError> {
        let data = self.request(host, token, "i", json!({})).await?;
        let mut result = HashMap::new();
        if let Some(policies) = data.get("policies").and_then(|v| v.as_object()) {
            for (key, value) in policies {
                if let Some(b) = value.as_bool() {
                    result.insert(key.clone(), b);
                }
            }
        }
        // Extract top-level mode flags (fork features like yami/hanami mode)
        if let Some(obj) = data.as_object() {
            for (key, value) in obj {
                if key.starts_with("isIn") && key.ends_with("Mode") {
                    if let Some(b) = value.as_bool() {
                        result.insert(key.clone(), b);
                    }
                }
            }
        }
        Ok(result)
    }

    /// Update a user setting via /api/i/update.
    pub async fn update_user_setting(
        &self,
        host: &str,
        token: &str,
        key: &str,
        value: bool,
    ) -> Result<(), NoteDeckError> {
        let mut params = json!({});
        params[key] = json!(value);
        self.request(host, token, "i/update", params).await?;
        Ok(())
    }

    /// Fetch parameter names for a specific API endpoint (public, no auth required).
    pub async fn get_endpoint_params(
        &self,
        host: &str,
        endpoint: &str,
    ) -> Result<Vec<String>, NoteDeckError> {
        let res = self
            .client
            .post(self.api_url(host, "endpoint"))
            .json(&json!({ "endpoint": endpoint }))
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(NoteDeckError::Api {
                endpoint: "endpoint".to_string(),
                status: res.status().as_u16(),
                api_code: None,
                message: "Failed to fetch endpoint info".to_string(),
            });
        }

        let text = Self::read_body_limited(res, "endpoint").await?;
        let data: Value = serde_json::from_str(&text)?;
        let mut params = Vec::new();

        // Misskey 2024+: params.properties is an object keyed by param name
        if let Some(props) = data
            .pointer("/params/properties")
            .and_then(|v| v.as_object())
        {
            for key in props.keys() {
                params.push(key.clone());
            }
        }
        // Older Misskey: params is a flat array with { name, ... } items
        if params.is_empty() {
            if let Some(arr) = data.get("params").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                        params.push(name.to_string());
                    }
                }
            }
        }

        Ok(params)
    }

    /// Fetch enum values for a specific parameter of an endpoint.
    /// Fetch available API endpoints (public, no auth required).
    pub async fn get_endpoints(&self, host: &str) -> Result<Vec<String>, NoteDeckError> {
        let res = self
            .client
            .post(self.api_url(host, "endpoints"))
            .json(&json!({}))
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(NoteDeckError::Api {
                endpoint: "endpoints".to_string(),
                status: res.status().as_u16(),
                api_code: None,
                message: "Failed to fetch endpoints".to_string(),
            });
        }

        let text = Self::read_body_limited(res, "endpoints").await?;
        let endpoints: Vec<String> = serde_json::from_str(&text)?;
        Ok(endpoints)
    }

    // --- Notifications ---

    pub async fn get_unread_notification_count(
        &self,
        host: &str,
        token: &str,
    ) -> Result<i64, NoteDeckError> {
        let data = self
            .request(host, token, "notifications/unread-count", json!({}))
            .await?;
        Ok(data.get("count").and_then(|v| v.as_i64()).unwrap_or(0))
    }

    pub async fn mark_all_notifications_as_read(
        &self,
        host: &str,
        token: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "notifications/mark-all-as-read", json!({}))
            .await?;
        Ok(())
    }

    // --- Unread chat ---

    /// 未読チャットがあるかを返す。
    ///
    /// Misskey 新 Chat API ([#15686](https://github.com/misskey-dev/misskey/pull/15686), v2025) では
    /// legacy `messaging/unread` エンドポイントが廃止されたため、`chat/history` を
    /// `room=false` (DM) と `room=true` (room) で叩いて各 thread 最新メッセージの
    /// `isRead` フラグを集計する。`me_user_id` は自分送信メッセージを除外するために必要
    /// (自分送信メッセージで `isRead=false` でも自分の未読扱いにしないため)。
    pub async fn get_unread_chat(
        &self,
        host: &str,
        token: &str,
        me_user_id: &str,
    ) -> Result<bool, NoteDeckError> {
        for room in [false, true] {
            let mut params = json!({ "limit": 100 });
            if room {
                params["room"] = json!(true);
            }
            // 片方失敗しても他方を確認できるよう、エラーは握りつぶして次に進む
            let data = match self.request(host, token, "chat/history", params).await {
                Ok(d) => d,
                Err(_) => continue,
            };
            let Some(arr) = data.as_array() else { continue };
            for msg in arr {
                let from = msg.get("fromUserId").and_then(|v| v.as_str()).unwrap_or("");
                let is_read = msg.get("isRead").and_then(|v| v.as_bool()).unwrap_or(true);
                if from != me_user_id && !is_read {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    // --- Self (current user) ---

    pub async fn get_self(&self, host: &str, token: &str) -> Result<Value, NoteDeckError> {
        self.request(host, token, "i", json!({})).await
    }

    // --- Drive ---

    pub async fn get_drive_folders(
        &self,
        host: &str,
        token: &str,
        folder_id: Option<&str>,
        limit: i64,
    ) -> Result<Value, NoteDeckError> {
        let mut params = json!({ "limit": limit });
        if let Some(id) = folder_id {
            params["folderId"] = json!(id);
        }
        self.request(host, token, "drive/folders", params).await
    }

    pub async fn get_drive_files(
        &self,
        host: &str,
        token: &str,
        folder_id: Option<&str>,
        limit: i64,
        file_type: Option<&str>,
    ) -> Result<Value, NoteDeckError> {
        let mut params = json!({ "limit": limit });
        if let Some(id) = folder_id {
            params["folderId"] = json!(id);
        }
        if let Some(t) = file_type {
            params["type"] = json!(t);
        }
        self.request(host, token, "drive/files", params).await
    }

    pub async fn delete_drive_file(
        &self,
        host: &str,
        token: &str,
        file_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "drive/files/delete",
            json!({ "fileId": file_id }),
        )
        .await?;
        Ok(())
    }

    // --- Follow requests ---

    pub async fn get_follow_requests(
        &self,
        host: &str,
        token: &str,
        limit: i64,
    ) -> Result<Value, NoteDeckError> {
        self.request(
            host,
            token,
            "following/requests/list",
            json!({ "limit": limit }),
        )
        .await
    }

    pub async fn get_sent_follow_requests(
        &self,
        host: &str,
        token: &str,
        limit: i64,
    ) -> Result<Value, NoteDeckError> {
        self.request(
            host,
            token,
            "following/requests/sent",
            json!({ "limit": limit }),
        )
        .await
    }

    // --- Explore (users/roles) ---

    pub async fn search_users(
        &self,
        host: &str,
        token: &str,
        opts: SearchUsersOptions<'_>,
    ) -> Result<Value, NoteDeckError> {
        let mut params = json!({ "limit": opts.limit });
        if let Some(q) = opts.query {
            params["query"] = json!(q);
        }
        if let Some(o) = opts.origin {
            params["origin"] = json!(o);
        }
        if let Some(s) = opts.sort {
            params["sort"] = json!(s);
        }
        if let Some(s) = opts.state {
            params["state"] = json!(s);
        }
        if let Some(o) = opts.offset {
            params["offset"] = json!(o);
        }
        self.request(host, token, "users", params).await
    }

    pub async fn get_roles(&self, host: &str, token: &str) -> Result<Value, NoteDeckError> {
        self.request(host, token, "roles/list", json!({})).await
    }

    pub async fn get_role_users(
        &self,
        host: &str,
        token: &str,
        role_id: &str,
        limit: i64,
        offset: Option<i64>,
    ) -> Result<Value, NoteDeckError> {
        let mut params = json!({ "roleId": role_id, "limit": limit });
        if let Some(o) = offset {
            params["offset"] = json!(o);
        }
        self.request(host, token, "roles/users", params).await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn get_role_notes(
        &self,
        host: &str,
        token: &str,
        account_id: &str,
        role_id: &str,
        limit: i64,
        since_id: Option<&str>,
        until_id: Option<&str>,
    ) -> Result<Vec<NormalizedNote>, NoteDeckError> {
        let mut params = json!({
            "roleId": role_id,
            "limit": limit,
        });
        apply_pagination(&mut params, since_id, until_id);
        let data = self.request(host, token, "roles/notes", params).await?;
        let raw: Vec<RawNote> = serde_json::from_value(data)?;
        Ok(raw
            .into_iter()
            .map(|n| n.normalize(account_id, host))
            .collect())
    }

    // --- Announcements ---

    pub async fn get_announcements(
        &self,
        host: &str,
        token: &str,
        limit: i64,
        is_active: bool,
    ) -> Result<Value, NoteDeckError> {
        self.request(
            host,
            token,
            "announcements",
            json!({ "limit": limit, "isActive": is_active }),
        )
        .await
    }

    pub async fn read_announcement(
        &self,
        host: &str,
        token: &str,
        announcement_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "i/read-announcement",
            json!({ "announcementId": announcement_id }),
        )
        .await?;
        Ok(())
    }

    // --- Chat reactions ---

    pub async fn react_chat_message(
        &self,
        host: &str,
        token: &str,
        message_id: &str,
        reaction: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "chat/messages/react",
            json!({ "messageId": message_id, "reaction": reaction }),
        )
        .await?;
        Ok(())
    }

    pub async fn unreact_chat_message(
        &self,
        host: &str,
        token: &str,
        message_id: &str,
        reaction: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "chat/messages/unreact",
            json!({ "messageId": message_id, "reaction": reaction }),
        )
        .await?;
        Ok(())
    }

    /// Misskey 新 Chat API (#15686) の `chat/messages/delete`。
    /// ハード削除されるので `deletedAt` 等は無く、サーバー側からは
    /// WS `chat:deleted` event がブロードキャストされる。それを受けて
    /// `streaming.rs` 側でローカル `chat_messages_cache` も自動的に
    /// 消える経路があるため、呼び出し側でキャッシュ削除を別途行う必要はない。
    pub async fn delete_chat_message(
        &self,
        host: &str,
        token: &str,
        message_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "chat/messages/delete",
            json!({ "messageId": message_id }),
        )
        .await?;
        Ok(())
    }

    // --- Search ---

    pub async fn search_users_by_query(
        &self,
        host: &str,
        token: &str,
        query: &str,
        limit: i64,
    ) -> Result<Value, NoteDeckError> {
        self.request(
            host,
            token,
            "users/search",
            json!({ "query": query, "limit": limit }),
        )
        .await
    }

    pub async fn search_hashtags(
        &self,
        host: &str,
        token: &str,
        query: &str,
        limit: i64,
    ) -> Result<Vec<String>, NoteDeckError> {
        let data = self
            .request(
                host,
                token,
                "hashtags/search",
                json!({ "query": query, "limit": limit }),
            )
            .await?;
        let tags: Vec<String> = serde_json::from_value(data)?;
        Ok(tags)
    }

    // --- ActivityPub resolve ---

    pub async fn ap_show(
        &self,
        host: &str,
        token: &str,
        uri: &str,
    ) -> Result<Value, NoteDeckError> {
        self.request(host, token, "ap/show", json!({ "uri": uri }))
            .await
    }

    // --- Server stats ---

    pub async fn get_server_stats(&self, host: &str, token: &str) -> Result<Value, NoteDeckError> {
        self.request(host, token, "stats", json!({})).await
    }

    pub async fn get_meta_detail(&self, host: &str, token: &str) -> Result<Value, NoteDeckError> {
        self.request(host, token, "meta", json!({ "detail": true }))
            .await
    }

    // --- User achievements ---

    pub async fn get_user_achievements(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<Value, NoteDeckError> {
        self.request(
            host,
            token,
            "users/achievements",
            json!({ "userId": user_id }),
        )
        .await
    }

    // --- User notes (with filters) ---

    pub async fn get_user_notes_filtered(
        &self,
        host: &str,
        token: &str,
        params: Value,
    ) -> Result<Value, NoteDeckError> {
        self.request(host, token, "users/notes", params).await
    }

    pub async fn get_user_featured_notes(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
        limit: i64,
        until_id: Option<&str>,
    ) -> Result<Value, NoteDeckError> {
        let mut params = json!({ "userId": user_id, "limit": limit });
        apply_pagination(&mut params, None, until_id);
        self.request(host, token, "users/featured-notes", params)
            .await
    }

    // --- Pages ---

    pub async fn get_pages(
        &self,
        host: &str,
        token: &str,
        endpoint: &str,
        limit: i64,
    ) -> Result<Value, NoteDeckError> {
        self.request(host, token, endpoint, json!({ "limit": limit }))
            .await
    }

    pub async fn get_page(
        &self,
        host: &str,
        token: &str,
        page_id: &str,
    ) -> Result<Value, NoteDeckError> {
        self.request(host, token, "pages/show", json!({ "pageId": page_id }))
            .await
    }

    pub async fn like_page(
        &self,
        host: &str,
        token: &str,
        page_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "pages/like", json!({ "pageId": page_id }))
            .await?;
        Ok(())
    }

    pub async fn unlike_page(
        &self,
        host: &str,
        token: &str,
        page_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "pages/unlike", json!({ "pageId": page_id }))
            .await?;
        Ok(())
    }

    // --- Gallery ---

    pub async fn get_gallery_posts(
        &self,
        host: &str,
        token: &str,
        limit: i64,
        until_id: Option<&str>,
    ) -> Result<Value, NoteDeckError> {
        let mut params = json!({ "limit": limit });
        apply_pagination(&mut params, None, until_id);
        self.request(host, token, "gallery/posts", params).await
    }

    pub async fn like_gallery_post(
        &self,
        host: &str,
        token: &str,
        post_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "gallery/posts/like",
            json!({ "postId": post_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn unlike_gallery_post(
        &self,
        host: &str,
        token: &str,
        post_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "gallery/posts/unlike",
            json!({ "postId": post_id }),
        )
        .await?;
        Ok(())
    }

    // --- Flash (Play) ---

    pub async fn get_flashes(
        &self,
        host: &str,
        token: &str,
        endpoint: &str,
        limit: i64,
    ) -> Result<Value, NoteDeckError> {
        self.request(host, token, endpoint, json!({ "limit": limit }))
            .await
    }

    pub async fn get_flash(
        &self,
        host: &str,
        token: &str,
        flash_id: &str,
    ) -> Result<Value, NoteDeckError> {
        self.request(host, token, "flash/show", json!({ "flashId": flash_id }))
            .await
    }

    pub async fn like_flash(
        &self,
        host: &str,
        token: &str,
        flash_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "flash/like", json!({ "flashId": flash_id }))
            .await?;
        Ok(())
    }

    pub async fn unlike_flash(
        &self,
        host: &str,
        token: &str,
        flash_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "flash/unlike", json!({ "flashId": flash_id }))
            .await?;
        Ok(())
    }

    // --- Chat API ---

    pub async fn get_chat_history(
        &self,
        host: &str,
        token: &str,
        limit: i64,
        room: bool,
    ) -> Result<Vec<ChatMessage>, NoteDeckError> {
        let mut params = json!({ "limit": limit });
        if room {
            params["room"] = json!(true);
        }
        let data = self.request(host, token, "chat/history", params).await?;
        let messages: Vec<ChatMessage> = serde_json::from_value(data)?;
        Ok(messages)
    }

    pub async fn get_chat_user_messages(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
        limit: i64,
        since_id: Option<&str>,
        until_id: Option<&str>,
    ) -> Result<Vec<ChatMessage>, NoteDeckError> {
        let mut params = json!({
            "userId": user_id,
            "limit": limit,
        });
        apply_pagination(&mut params, since_id, until_id);
        let data = self
            .request(host, token, "chat/messages/user-timeline", params)
            .await?;
        let mut messages: Vec<ChatMessage> = serde_json::from_value(data)?;
        self.hydrate_chat_message_users(host, token, &mut messages)
            .await;
        Ok(messages)
    }

    pub async fn get_chat_room_messages(
        &self,
        host: &str,
        token: &str,
        room_id: &str,
        limit: i64,
        since_id: Option<&str>,
        until_id: Option<&str>,
    ) -> Result<Vec<ChatMessage>, NoteDeckError> {
        let mut params = json!({
            "roomId": room_id,
            "limit": limit,
        });
        apply_pagination(&mut params, since_id, until_id);
        let data = self
            .request(host, token, "chat/messages/room-timeline", params)
            .await?;
        let mut messages: Vec<ChatMessage> = serde_json::from_value(data)?;
        self.hydrate_chat_message_users(host, token, &mut messages)
            .await;
        Ok(messages)
    }

    /// `users/show?userIds=[...]` の bulk 取得。
    /// Misskey は `userIds` 配列で 1 回の API 呼び出しで複数ユーザーを返す。
    /// 空配列なら API を叩かず即 `Ok(vec![])` で return。
    pub async fn get_users_bulk(
        &self,
        host: &str,
        token: &str,
        user_ids: &[String],
    ) -> Result<Vec<ChatUser>, NoteDeckError> {
        if user_ids.is_empty() {
            return Ok(vec![]);
        }
        let data = self
            .request(host, token, "users/show", json!({ "userIds": user_ids }))
            .await?;
        let users: Vec<ChatUser> = serde_json::from_value(data)?;
        Ok(users)
    }

    /// `chat/messages/{user|room}-timeline` と WS chat:message の
    /// `fromUser` / `toUser` を `users/show?userIds=[...]` で 1 リクエストに
    /// まとめて hydrate する。失敗しても元のまま継続する best-effort 動作。
    ///
    /// 補完対象は「user が null」のときだけでなく「user は埋め込まれているが
    /// `avatarDecorations` が空」のときも含む。1on1 (`packMessageLiteFor1on1`)
    /// は `fromUser` を一切含まないため null 補完で足りるが、room
    /// (`packMessageLiteForRoom`) は `fromUser` を埋め込むため hydrate を
    /// 一切経由せず、サーバーがデコを埋め込まないとアバターデコが永遠に
    /// 出ない。デコ欠落を hydrate のトリガーにすることで room も 1on1 と
    /// 同じ経路に乗せる。
    pub(crate) async fn hydrate_chat_message_users(
        &self,
        host: &str,
        token: &str,
        messages: &mut [ChatMessage],
    ) {
        fn needs_hydration(u: Option<&ChatUser>) -> bool {
            u.is_none_or(|u| u.avatar_decorations.is_empty())
        }
        let mut needed: HashSet<String> = HashSet::new();
        for m in messages.iter() {
            if needs_hydration(m.from_user.as_ref()) {
                needed.insert(m.from_user_id.clone());
            }
            if let Some(uid) = &m.to_user_id {
                if needs_hydration(m.to_user.as_ref()) {
                    needed.insert(uid.clone());
                }
            }
        }
        if needed.is_empty() {
            return;
        }
        let user_ids: Vec<String> = needed.into_iter().collect();
        let users = match self.get_users_bulk(host, token, &user_ids).await {
            Ok(u) => u,
            Err(e) => {
                tracing::warn!(error = %e, "failed to hydrate chat users");
                return;
            }
        };
        let user_map: HashMap<String, ChatUser> =
            users.into_iter().map(|u| (u.id.clone(), u)).collect();
        for m in messages.iter_mut() {
            if needs_hydration(m.from_user.as_ref()) {
                if let Some(u) = user_map.get(&m.from_user_id) {
                    m.from_user = Some(u.clone());
                }
            }
            let to_uid = m.to_user_id.clone();
            if let Some(uid) = to_uid {
                if needs_hydration(m.to_user.as_ref()) {
                    if let Some(u) = user_map.get(&uid) {
                        m.to_user = Some(u.clone());
                    }
                }
            }
        }
    }

    /// Misskey 新 Chat API (#15686) `chat/messages/create-to-user`。
    ///
    /// `text` と `file_id` の両方を `Option<&str>` で受け取り、None の場合は
    /// JSON body から省く。Misskey 側のスキーマも nullable で、サーバ側で
    /// 「どちらか一方は必須」のバリデーションが走る。
    pub async fn create_chat_message_to_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
        text: Option<&str>,
        file_id: Option<&str>,
    ) -> Result<ChatMessage, NoteDeckError> {
        let mut body = json!({ "toUserId": user_id });
        if let Some(t) = text {
            body["text"] = json!(t);
        }
        if let Some(fid) = file_id {
            body["fileId"] = json!(fid);
        }
        let data = self
            .request(host, token, "chat/messages/create-to-user", body)
            .await?;
        let mut message: ChatMessage = serde_json::from_value(data)?;
        self.hydrate_chat_message_users(host, token, std::slice::from_mut(&mut message))
            .await;
        Ok(message)
    }

    /// Misskey 新 Chat API (#15686) `chat/messages/create-to-room`。
    /// `create_chat_message_to_user` と同じ optional ルール。
    pub async fn create_chat_message_to_room(
        &self,
        host: &str,
        token: &str,
        room_id: &str,
        text: Option<&str>,
        file_id: Option<&str>,
    ) -> Result<ChatMessage, NoteDeckError> {
        let mut body = json!({ "toRoomId": room_id });
        if let Some(t) = text {
            body["text"] = json!(t);
        }
        if let Some(fid) = file_id {
            body["fileId"] = json!(fid);
        }
        let data = self
            .request(host, token, "chat/messages/create-to-room", body)
            .await?;
        let mut message: ChatMessage = serde_json::from_value(data)?;
        self.hydrate_chat_message_users(host, token, std::slice::from_mut(&mut message))
            .await;
        Ok(message)
    }

    // --- Server Discovery (unauthenticated) ---

    /// Fetch nodeinfo via .well-known/nodeinfo.
    /// Returns the parsed nodeinfo JSON.
    pub async fn fetch_nodeinfo(&self, host: &str) -> Result<Value, NoteDeckError> {
        let scheme = crate::insecure::http_scheme(host);
        let well_known_url = format!("{scheme}://{host}/.well-known/nodeinfo");
        let res = self
            .client
            .get(&well_known_url)
            .timeout(Duration::from_secs(10))
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(NoteDeckError::Api {
                endpoint: ".well-known/nodeinfo".to_string(),
                status: res.status().as_u16(),
                api_code: None,
                message: "Failed to fetch well-known nodeinfo".to_string(),
            });
        }
        let text = Self::read_body_limited(res, ".well-known/nodeinfo").await?;
        let well_known: Value = serde_json::from_str(&text)?;

        let nodeinfo_url = well_known["links"]
            .as_array()
            .and_then(|links| {
                links.iter().find_map(|link| {
                    let rel = link["rel"].as_str().unwrap_or("");
                    if rel.contains("nodeinfo") {
                        link["href"].as_str().map(|s| s.to_string())
                    } else {
                        None
                    }
                })
            })
            .ok_or_else(|| NoteDeckError::Api {
                endpoint: ".well-known/nodeinfo".to_string(),
                status: 0,
                api_code: None,
                message: format!("No nodeinfo URL found for {host}"),
            })?;

        // Validate URL to prevent SSRF: must be https://{host}/...
        let expected_prefix = format!("{scheme}://{host}/");
        if !nodeinfo_url.starts_with(&expected_prefix) {
            return Err(NoteDeckError::Api {
                endpoint: ".well-known/nodeinfo".to_string(),
                status: 0,
                api_code: None,
                message: format!("Nodeinfo URL host/scheme mismatch for {host}"),
            });
        }

        let res = self
            .client
            .get(&nodeinfo_url)
            .timeout(Duration::from_secs(10))
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(NoteDeckError::Api {
                endpoint: "nodeinfo".to_string(),
                status: res.status().as_u16(),
                api_code: None,
                message: "Failed to fetch nodeinfo".to_string(),
            });
        }
        let text = Self::read_body_limited(res, "nodeinfo").await?;
        let nodeinfo: Value = serde_json::from_str(&text)?;
        Ok(nodeinfo)
    }

    // --- Pin/Unpin ---

    pub async fn pin_note(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "i/pin", json!({ "noteId": note_id }))
            .await?;
        Ok(())
    }

    pub async fn unpin_note(
        &self,
        host: &str,
        token: &str,
        note_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "i/unpin", json!({ "noteId": note_id }))
            .await?;
        Ok(())
    }

    pub async fn get_user_pinned_note_ids(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<Vec<String>, NoteDeckError> {
        let data = self
            .request(host, token, "users/show", json!({ "userId": user_id }))
            .await?;
        let ids = data
            .get("pinnedNoteIds")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();
        Ok(ids)
    }

    // --- Mute/Block ---

    pub async fn mute_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "mute/create", json!({ "userId": user_id }))
            .await?;
        Ok(())
    }

    pub async fn unmute_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "mute/delete", json!({ "userId": user_id }))
            .await?;
        Ok(())
    }

    /// 自分がミュート中のユーザー ID 一覧を取得する（`mute/list` を全ページ走査）。
    /// #574: 起動時にフロントの mute store を hydrate し、過去ノートを即時非表示にする。
    pub async fn muted_user_ids(
        &self,
        host: &str,
        token: &str,
    ) -> Result<Vec<String>, NoteDeckError> {
        const PAGE: usize = 100;
        let mut ids = Vec::new();
        let mut until_id: Option<String> = None;
        loop {
            let mut params = json!({ "limit": PAGE });
            apply_pagination(&mut params, None, until_id.as_deref());
            let data = self.request(host, token, "mute/list", params).await?;
            let Some(arr) = data.as_array() else { break };
            if arr.is_empty() {
                break;
            }
            for item in arr {
                if let Some(mutee_id) = item.get("muteeId").and_then(|v| v.as_str()) {
                    ids.push(mutee_id.to_string());
                }
            }
            // 次ページの起点は Muting レコードの id（mutee の id ではない）。
            until_id = arr
                .last()
                .and_then(|v| v.get("id"))
                .and_then(|v| v.as_str())
                .map(String::from);
            if arr.len() < PAGE || until_id.is_none() {
                break;
            }
        }
        Ok(ids)
    }

    /// `i`(meDetailed) から `mutedWords` / `hardMutedWords` を取得する（read のみ、#610）。
    /// 想定外の要素形は serde untagged で取り切れない場合があるため、欠損時は空配列にフォールバック。
    pub async fn muted_words(
        &self,
        host: &str,
        token: &str,
    ) -> Result<MutedWordsResult, NoteDeckError> {
        let data = self.request(host, token, "i", json!({})).await?;
        let muted_words = data
            .get("mutedWords")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let hard_muted_words = data
            .get("hardMutedWords")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        let muted_instances = data
            .get("mutedInstances")
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default();
        Ok(MutedWordsResult {
            muted_words,
            hard_muted_words,
            muted_instances,
        })
    }

    /// renote mute 中のユーザー ID 一覧を取得する（#614: 起動時の renote mute store hydrate）。
    /// `renote-mute/list` は RenoteMuting レコード配列を返すため muteeId を抽出する。
    pub async fn renote_muted_user_ids(
        &self,
        host: &str,
        token: &str,
    ) -> Result<Vec<String>, NoteDeckError> {
        const PAGE: usize = 100;
        let mut ids = Vec::new();
        let mut until_id: Option<String> = None;
        loop {
            let mut params = json!({ "limit": PAGE });
            apply_pagination(&mut params, None, until_id.as_deref());
            let data = self
                .request(host, token, "renote-mute/list", params)
                .await?;
            let Some(arr) = data.as_array() else { break };
            if arr.is_empty() {
                break;
            }
            for item in arr {
                if let Some(mutee_id) = item.get("muteeId").and_then(|v| v.as_str()) {
                    ids.push(mutee_id.to_string());
                }
            }
            // 次ページの起点は RenoteMuting レコードの id。
            until_id = arr
                .last()
                .and_then(|v| v.get("id"))
                .and_then(|v| v.as_str())
                .map(String::from);
            if arr.len() < PAGE || until_id.is_none() {
                break;
            }
        }
        Ok(ids)
    }

    pub async fn renote_mute_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "renote-mute/create",
            json!({ "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn unrenote_mute_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "renote-mute/delete",
            json!({ "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn block_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "blocking/create", json!({ "userId": user_id }))
            .await?;
        Ok(())
    }

    pub async fn unblock_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(host, token, "blocking/delete", json!({ "userId": user_id }))
            .await?;
        Ok(())
    }

    // --- Report ---

    pub async fn report_user(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
        comment: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "users/report-abuse",
            json!({ "userId": user_id, "comment": comment }),
        )
        .await?;
        Ok(())
    }

    // --- Clip operations ---

    pub async fn add_note_to_clip(
        &self,
        host: &str,
        token: &str,
        clip_id: &str,
        note_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "clips/add-note",
            json!({ "clipId": clip_id, "noteId": note_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn remove_note_from_clip(
        &self,
        host: &str,
        token: &str,
        clip_id: &str,
        note_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "clips/remove-note",
            json!({ "clipId": clip_id, "noteId": note_id }),
        )
        .await?;
        Ok(())
    }

    // --- User list operations ---

    pub async fn add_user_to_list(
        &self,
        host: &str,
        token: &str,
        list_id: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "users/lists/push",
            json!({ "listId": list_id, "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    pub async fn remove_user_from_list(
        &self,
        host: &str,
        token: &str,
        list_id: &str,
        user_id: &str,
    ) -> Result<(), NoteDeckError> {
        self.request(
            host,
            token,
            "users/lists/pull",
            json!({ "listId": list_id, "userId": user_id }),
        )
        .await?;
        Ok(())
    }

    // --- Follow list & relations ---

    pub async fn get_following(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
        limit: i64,
        until_id: Option<&str>,
    ) -> Result<Value, NoteDeckError> {
        let mut params = json!({ "userId": user_id, "limit": limit });
        apply_pagination(&mut params, None, until_id);
        self.request(host, token, "users/following", params).await
    }

    pub async fn get_followers(
        &self,
        host: &str,
        token: &str,
        user_id: &str,
        limit: i64,
        until_id: Option<&str>,
    ) -> Result<Value, NoteDeckError> {
        let mut params = json!({ "userId": user_id, "limit": limit });
        apply_pagination(&mut params, None, until_id);
        self.request(host, token, "users/followers", params).await
    }

    pub async fn get_user_relations(
        &self,
        host: &str,
        token: &str,
        user_ids: &[String],
    ) -> Result<Value, NoteDeckError> {
        self.request(host, token, "users/relation", json!({ "userId": user_ids }))
            .await
    }

    // --- Server Discovery (unauthenticated) ---

    /// Fetch server meta via /api/meta (unauthenticated).
    /// `detail: true` を渡すことで infoImageUrl, notFoundImageUrl, serverErrorImageUrl 等も取得。
    pub async fn fetch_server_meta(&self, host: &str) -> Result<Value, NoteDeckError> {
        let url = self.api_url(host, "meta");
        let res = self
            .client
            .post(&url)
            .json(&json!({ "detail": true }))
            .timeout(Duration::from_secs(10))
            .send()
            .await?;
        if !res.status().is_success() {
            return Err(NoteDeckError::Api {
                endpoint: "meta".to_string(),
                status: res.status().as_u16(),
                api_code: None,
                message: "Failed to fetch server meta".to_string(),
            });
        }
        let text = Self::read_body_limited(res, "meta").await?;
        let meta: Value = serde_json::from_str(&text)?;
        Ok(meta)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn raw_note_json(id: &str, text: &str) -> Value {
        json!({
            "id": id,
            "createdAt": "2025-01-01T00:00:00.000Z",
            "text": text,
            "cw": null,
            "user": {"id": "u1", "username": "testuser"},
            "visibility": "public",
            "poll": null,
            "replyId": null,
            "renoteId": null,
            "channelId": null,
            "reactionAcceptance": null,
            "uri": null,
            "url": null,
            "updatedAt": null,
            "reply": null,
            "renote": null,
            "myReaction": null
        })
    }

    #[tokio::test]
    async fn request_success() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/test/endpoint"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"ok": true})))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let result = client
            .request("unused", "token", "test/endpoint", json!({}))
            .await
            .unwrap();
        assert_eq!(result["ok"], true);
    }

    #[tokio::test]
    async fn muted_user_ids_collects_mutee_ids() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/mute/list"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                { "id": "muting1", "muteeId": "userA", "mutee": { "id": "userA" } },
                { "id": "muting2", "muteeId": "userB", "mutee": { "id": "userB" } }
            ])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let ids = client.muted_user_ids("h", "token").await.unwrap();
        assert_eq!(ids, vec!["userA".to_string(), "userB".to_string()]);
    }

    #[tokio::test]
    async fn request_includes_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .expect(1)
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let _ = client.request("h", "my-secret-token", "i", json!({})).await;

        // Verify the mock was hit (if token wasn't injected into body, request would still succeed)
    }

    #[tokio::test]
    async fn request_api_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/show"))
            .respond_with(ResponseTemplate::new(404).set_body_json(
                json!({"error": {"message": "No such note", "code": "NO_SUCH_NOTE"}}),
            ))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let err = client
            .request("h", "token", "notes/show", json!({"noteId": "n1"}))
            .await
            .unwrap_err();
        assert_eq!(err.code(), "API");
        assert!(err.to_string().contains("No such note"));
    }

    #[tokio::test]
    async fn request_api_error_without_message() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/test"))
            .respond_with(ResponseTemplate::new(500).set_body_string(""))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let err = client
            .request("h", "token", "test", json!({}))
            .await
            .unwrap_err();
        assert_eq!(err.code(), "API");
        // Falls back to endpoint (status)
        assert!(err.to_string().contains("test"));
    }

    #[tokio::test]
    async fn request_empty_response() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/delete"))
            .respond_with(ResponseTemplate::new(200).set_body_string(""))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let result = client
            .request("h", "token", "notes/delete", json!({}))
            .await
            .unwrap();
        assert_eq!(result, Value::Null);
    }

    #[tokio::test]
    async fn get_timeline_parses_notes() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/timeline"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                raw_note_json("n1", "Hello"),
                raw_note_json("n2", "World"),
            ])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let notes = client
            .get_timeline(
                "h",
                "token",
                "acc1",
                &TimelineKey::parse("home").unwrap(),
                TimelineOptions::default(),
            )
            .await
            .unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].id, "n1");
        assert_eq!(notes[0].text.as_deref(), Some("Hello"));
        assert_eq!(notes[0].account_id, "acc1");
        assert_eq!(notes[1].id, "n2");
    }

    #[tokio::test]
    async fn get_note_returns_normalized() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/show"))
            .respond_with(ResponseTemplate::new(200).set_body_json(raw_note_json("n1", "test")))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let note = client.get_note("h", "token", "acc1", "n1").await.unwrap();
        assert_eq!(note.id, "n1");
        assert_eq!(note.server_host, "h");
    }

    #[tokio::test]
    async fn create_note_parses_response() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/create"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"createdNote": raw_note_json("n1", "posted")})),
            )
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let params = CreateNoteParams {
            text: Some("posted".into()),
            cw: None,
            visibility: Some("public".into()),
            local_only: None,
            mode_flags: None,
            reply_id: None,
            renote_id: None,
            file_ids: None,
            poll: None,
            scheduled_at: None,
        };
        let note = client
            .create_note("h", "token", "acc1", params)
            .await
            .unwrap();
        assert_eq!(note.id, "n1");
        assert_eq!(note.text.as_deref(), Some("posted"));
    }

    #[tokio::test]
    async fn delete_note_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/delete"))
            .respond_with(ResponseTemplate::new(200).set_body_string(""))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        client.delete_note("h", "token", "n1").await.unwrap();
    }

    #[tokio::test]
    async fn create_reaction_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/reactions/create"))
            .respond_with(ResponseTemplate::new(200).set_body_string(""))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        client
            .create_reaction("h", "token", "n1", ":star:")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn vote_poll_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/polls/vote"))
            .respond_with(ResponseTemplate::new(200).set_body_string(""))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        client.vote_poll("h", "token", "n1", 2).await.unwrap();
    }

    #[tokio::test]
    async fn get_notifications_parses() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i/notifications"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "notif1",
                "createdAt": "2025-01-01T00:00:00.000Z",
                "type": "reaction",
                "user": {"id": "u1", "username": "taka"},
                "note": raw_note_json("n1", "test"),
                "reaction": ":star:"
            }])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let notifs = client
            .get_notifications("h", "token", "acc1", TimelineOptions::default())
            .await
            .unwrap();
        assert_eq!(notifs.len(), 1);
        assert_eq!(notifs[0].notification_type, "reaction");
        assert_eq!(notifs[0].reaction.as_deref(), Some(":star:"));
    }

    #[tokio::test]
    async fn get_notifications_parses_role_assigned() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i/notifications"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "notif1",
                "createdAt": "2025-01-01T00:00:00.000Z",
                "type": "roleAssigned",
                "role": {
                    "id": "role1",
                    "name": "Active",
                    "color": "#ff0000",
                    "iconUrl": "https://example.com/role.png",
                    "description": "active users",
                    "displayOrder": 0,
                    "isModerator": false
                }
            }])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let notifs = client
            .get_notifications("h", "token", "acc1", TimelineOptions::default())
            .await
            .unwrap();
        assert_eq!(notifs.len(), 1);
        assert_eq!(notifs[0].notification_type, "roleAssigned");
        let role = notifs[0].role.as_ref().expect("role present");
        assert_eq!(role.name, "Active");
        assert_eq!(role.color.as_deref(), Some("#ff0000"));
        assert_eq!(
            role.icon_url.as_deref(),
            Some("https://example.com/role.png")
        );
    }

    #[tokio::test]
    async fn search_notes_parses() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/search"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!([raw_note_json("n1", "Rust is great")])),
            )
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let notes = client
            .search_notes("h", "token", "acc1", "Rust", SearchOptions::default())
            .await
            .unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].text.as_deref(), Some("Rust is great"));
    }

    #[test]
    fn misskey_id_at_encodes_time_part() {
        // misskey.flowers の実 ID apfldnaym0v100e3 (createdAt 2026-08-02T16:41:40.666Z)
        assert_eq!(misskey_id_at(1_785_688_900_666), "apfldnay");
        assert_eq!(misskey_id_at(TIME2000_MS), "00000000");
        // 2000 年より前は下限に丸める
        assert_eq!(misskey_id_at(0), "00000000");
    }

    #[tokio::test]
    async fn search_notes_hanami_uses_hanamisearch_endpoint() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/hanamisearch-v1"))
            .and(body_partial_json(
                json!({ "query": "rust", "sinceId": "apfldnay", "untilId": "apfldnay" }),
            ))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([raw_note_json("n1", "rust note")])),
            )
            .mount(&server)
            .await;

        let mut options = SearchOptions::default();
        options.since_date = Some(1_785_688_900_666);
        options.until_date = Some(1_785_688_900_666);
        let client = MisskeyClient::with_base_url(&server.uri());
        let notes = client
            .search_notes_hanami("h", "token", "acc1", "rust", options)
            .await
            .unwrap();
        assert_eq!(notes.len(), 1);
    }

    #[tokio::test]
    async fn search_notes_hanami_prefers_explicit_pagination_ids() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/hanamisearch-v1"))
            .and(body_partial_json(json!({ "untilId": "n42" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let mut options = SearchOptions::default();
        options.until_id = Some("n42".to_string());
        options.until_date = Some(1_785_688_900_666);
        let client = MisskeyClient::with_base_url(&server.uri());
        client
            .search_notes_hanami("h", "token", "acc1", "rust", options)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn get_user_detail_parses() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": "u1",
                "username": "taka",
                "host": null,
                "name": "Taka",
                "avatarUrl": null,
                "bannerUrl": null,
                "description": "hello",
                "followersCount": 10,
                "followingCount": 5,
                "notesCount": 100,
                "createdAt": "2024-01-01T00:00:00.000Z"
            })))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let user = client
            .get_user_detail("h", "token", "acc1", "u1")
            .await
            .unwrap();
        assert_eq!(user.username, "taka");
        assert_eq!(user.followers_count, 10);
        assert_eq!(user.notes_count, 100);
    }

    #[tokio::test]
    async fn get_server_emojis_parses() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/emojis"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "emojis": [
                    {"name": "blobcat", "url": "https://example.com/blobcat.png", "category": "blob", "aliases": ["neko"]}
                ]
            })))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let emojis = client.get_server_emojis("h", "token").await.unwrap();
        assert_eq!(emojis.len(), 1);
        assert_eq!(emojis[0].name, "blobcat");
        assert_eq!(emojis[0].aliases, vec!["neko"]);
    }

    #[tokio::test]
    async fn get_user_lists_parses() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/users/lists/list"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"id": "l1", "name": "Friends", "isPublic": false},
                {"id": "l2", "name": "Tech", "isPublic": true}
            ])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let lists = client.get_user_lists("h", "token").await.unwrap();
        assert_eq!(lists.len(), 2);
        assert_eq!(lists[0].name, "Friends");
    }

    #[tokio::test]
    async fn get_favorites_unwraps_note_field() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i/favorites"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"id": "fav1", "note": raw_note_json("n1", "fav note")}
            ])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let notes = client
            .get_favorites("h", "token", "acc1", 20, None, None)
            .await
            .unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "n1");
        assert_eq!(notes[0].text.as_deref(), Some("fav note"));
    }

    #[tokio::test]
    async fn follow_user_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/following/create"))
            .respond_with(ResponseTemplate::new(200).set_body_string(""))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        client.follow_user("h", "token", "u1").await.unwrap();
    }

    #[tokio::test]
    async fn cancel_follow_request_succeeds() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/following/requests/cancel"))
            .and(body_partial_json(json!({ "userId": "u1" })))
            .respond_with(ResponseTemplate::new(200).set_body_string(""))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        client
            .cancel_follow_request("h", "token", "u1")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn extract_reaction_palette_valid() {
        let data = json!([
            [["client", "preferences", "sync"], [{"id": "default", "name": "Default", "emojis": [":star:", ":heart:", ":thumbsup:"]}]]
        ]);
        let result = MisskeyClient::extract_reaction_palette(&data).unwrap();
        assert_eq!(result, vec![":star:", ":heart:", ":thumbsup:"]);
    }

    #[tokio::test]
    async fn extract_reaction_palette_empty() {
        let data = json!([]);
        assert!(MisskeyClient::extract_reaction_palette(&data).is_none());
    }

    #[tokio::test]
    async fn get_note_children_parses() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/children"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([raw_note_json("r1", "reply")])),
            )
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let notes = client
            .get_note_children("h", "token", "acc1", "n1", 20)
            .await
            .unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, "r1");
    }

    #[tokio::test]
    async fn get_registry_value_returns_some_on_hit() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i/registry/get"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!("dark-theme-id")))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let scope = vec![
            "client".to_string(),
            "preferences".to_string(),
            "sync".to_string(),
        ];
        let result = client
            .get_registry_value("h", "token", &scope, "theme:dark")
            .await
            .unwrap();
        assert_eq!(result, Some(json!("dark-theme-id")));
    }

    #[tokio::test]
    async fn get_registry_value_returns_none_on_no_such_key() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i/registry/get"))
            .respond_with(
                ResponseTemplate::new(404).set_body_json(
                    json!({"error": {"message": "No such key", "code": "NO_SUCH_KEY"}}),
                ),
            )
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let scope = vec!["client".to_string(), "base".to_string()];
        let result = client
            .get_registry_value("h", "token", &scope, "missing")
            .await
            .unwrap();
        assert_eq!(result, None);
    }

    #[tokio::test]
    async fn set_registry_value_round_trip() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i/registry/set"))
            .respond_with(ResponseTemplate::new(204).set_body_string(""))
            .expect(1)
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let scope = vec![
            "client".to_string(),
            "preferences".to_string(),
            "sync".to_string(),
        ];
        client
            .set_registry_value("h", "token", &scope, "theme:dark", json!("my-theme"))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn remove_registry_value_swallows_no_such_key() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i/registry/remove"))
            .respond_with(
                ResponseTemplate::new(404).set_body_json(
                    json!({"error": {"message": "No such key", "code": "NO_SUCH_KEY"}}),
                ),
            )
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let scope = vec!["client".to_string(), "base".to_string()];
        client
            .remove_registry_value("h", "token", &scope, "missing")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn list_registry_keys_parses_type_map() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/i/registry/keys-with-type"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"theme:dark": "string", "plugins": "array"})),
            )
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let scope = vec![
            "client".to_string(),
            "preferences".to_string(),
            "sync".to_string(),
        ];
        let result = client
            .list_registry_keys("h", "token", &scope)
            .await
            .unwrap();
        assert_eq!(result.get("theme:dark").map(String::as_str), Some("string"));
        assert_eq!(result.get("plugins").map(String::as_str), Some("array"));
    }

    // --- Chat user hydration (#460) ---

    fn null_user_chat_message_json(id: &str, from: &str, to: &str) -> Value {
        json!({
            "id": id,
            "createdAt": "2025-01-01T00:00:00.000Z",
            "fromUserId": from,
            "fromUser": null,
            "toUserId": to,
            "toUser": null,
            "toRoomId": null,
            "toRoom": null,
            "text": "hi",
            "fileId": null,
            "file": null,
            "isRead": false,
            "reactions": []
        })
    }

    fn user_show_response_for(ids: &[(&str, &str)]) -> Value {
        let arr: Vec<Value> = ids
            .iter()
            .map(|(id, name)| {
                json!({
                    "id": id,
                    "username": name,
                    "name": name,
                    "host": null,
                    "avatarUrl": format!("https://example.com/{name}.png"),
                    "emojis": {}
                })
            })
            .collect();
        Value::Array(arr)
    }

    #[tokio::test]
    async fn get_users_bulk_returns_users() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(user_show_response_for(&[("u1", "alice"), ("u2", "bob")])),
            )
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let users = client
            .get_users_bulk("h", "token", &["u1".to_string(), "u2".to_string()])
            .await
            .unwrap();
        assert_eq!(users.len(), 2);
        assert_eq!(users[0].username, "alice");
        assert_eq!(users[1].username, "bob");
    }

    #[tokio::test]
    async fn get_users_bulk_empty_input_returns_empty_without_request() {
        let client = MisskeyClient::with_base_url("http://127.0.0.1:1");
        let users = client.get_users_bulk("h", "token", &[]).await.unwrap();
        assert!(users.is_empty());
    }

    #[tokio::test]
    async fn get_chat_user_messages_hydrates_null_users() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/chat/messages/user-timeline"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                null_user_chat_message_json("m1", "u_other", "u_self"),
                null_user_chat_message_json("m2", "u_self", "u_other"),
            ])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(user_show_response_for(&[
                    ("u_self", "me"),
                    ("u_other", "they"),
                ])),
            )
            .expect(1)
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let msgs = client
            .get_chat_user_messages("h", "token", "u_other", 30, None, None)
            .await
            .unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].from_user.as_ref().unwrap().username, "they");
        assert_eq!(msgs[0].to_user.as_ref().unwrap().username, "me");
        assert_eq!(msgs[1].from_user.as_ref().unwrap().username, "me");
        assert_eq!(msgs[1].to_user.as_ref().unwrap().username, "they");
    }

    #[tokio::test]
    async fn hydrate_keeps_user_with_decorations_and_skips_show() {
        let server = MockServer::start().await;
        // 埋め込み fromUser が既にデコを持つなら users/show は呼ばれない
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(ResponseTemplate::new(500))
            .expect(0)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/chat/messages/room-timeline"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "m1",
                "createdAt": "2025-01-01T00:00:00.000Z",
                "fromUserId": "u1",
                "fromUser": {
                    "id": "u1", "username": "alice", "name": "Alice",
                    "host": null, "avatarUrl": null, "emojis": {},
                    "avatarDecorations": [{"id": "d1", "url": "https://example.com/d1.png"}]
                },
                "toUserId": null,
                "toUser": null,
                "toRoomId": "r1",
                "toRoom": {"id": "r1", "name": "Room", "description": null},
                "text": "hi",
                "fileId": null,
                "file": null,
                "isRead": null,
                "reactions": []
            }])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let msgs = client
            .get_chat_room_messages("h", "token", "r1", 30, None, None)
            .await
            .unwrap();
        assert_eq!(msgs.len(), 1);
        let from = msgs[0].from_user.as_ref().unwrap();
        assert_eq!(from.username, "alice");
        assert_eq!(from.avatar_decorations.len(), 1);
    }

    #[tokio::test]
    async fn hydrate_refetches_room_user_missing_decorations() {
        // room-timeline は fromUser を埋め込むが Misskey が avatarDecorations を
        // 含めない場合がある。デコ欠落を hydrate トリガーにして users/show で
        // 補完することで、グループチャットでもアバターデコが出るようにする。
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/chat/messages/room-timeline"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "m1",
                "createdAt": "2025-01-01T00:00:00.000Z",
                "fromUserId": "u1",
                "fromUser": {
                    "id": "u1", "username": "alice", "name": "Alice",
                    "host": null, "avatarUrl": null, "emojis": {}
                },
                "toUserId": null,
                "toUser": null,
                "toRoomId": "r1",
                "toRoom": {"id": "r1", "name": "Room", "description": null},
                "text": "hi",
                "fileId": null,
                "file": null,
                "isRead": null,
                "reactions": []
            }])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{
                "id": "u1", "username": "alice", "name": "Alice",
                "host": null, "avatarUrl": null, "emojis": {},
                "avatarDecorations": [{"id": "d1", "url": "https://example.com/d1.png"}]
            }])))
            .expect(1)
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let msgs = client
            .get_chat_room_messages("h", "token", "r1", 30, None, None)
            .await
            .unwrap();
        assert_eq!(msgs.len(), 1);
        let from = msgs[0].from_user.as_ref().unwrap();
        assert_eq!(from.username, "alice");
        assert_eq!(from.avatar_decorations.len(), 1);
        assert_eq!(from.avatar_decorations[0].id, "d1");
    }

    #[tokio::test]
    async fn hydrate_swallows_users_show_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/chat/messages/user-timeline"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                null_user_chat_message_json("m1", "u_other", "u_self"),
            ])))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let msgs = client
            .get_chat_user_messages("h", "token", "u_other", 30, None, None)
            .await
            .unwrap();
        // 失敗時は null のまま。panic せず messages は返る。
        assert_eq!(msgs.len(), 1);
        assert!(msgs[0].from_user.is_none());
        assert!(msgs[0].to_user.is_none());
    }

    #[tokio::test]
    async fn create_chat_message_to_user_hydrates_sender() {
        // 送信レスポンス (create-to-user) は fromUser を含まないため、自分の
        // メッセージにアバターが出ない。hydrate で送信者を補完する。
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/chat/messages/create-to-user"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": "m1",
                "createdAt": "2025-01-01T00:00:00.000Z",
                "fromUserId": "u_self",
                "toUserId": "u_other",
                "toRoomId": null,
                "text": "hi",
                "fileId": null,
                "file": null,
                "isRead": null,
                "reactions": []
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                {"id": "u_self", "username": "me", "name": "Me",
                 "host": null, "avatarUrl": "https://example.com/me.png", "emojis": {},
                 "avatarDecorations": [{"id": "d1", "url": "https://example.com/d1.png"}]},
                {"id": "u_other", "username": "they", "name": "They",
                 "host": null, "avatarUrl": null, "emojis": {}}
            ])))
            .expect(1)
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let msg = client
            .create_chat_message_to_user("h", "token", "u_other", Some("hi"), None)
            .await
            .unwrap();
        let from = msg.from_user.as_ref().unwrap();
        assert_eq!(from.username, "me");
        assert_eq!(from.avatar_decorations.len(), 1);
        assert_eq!(msg.to_user.as_ref().unwrap().username, "they");
    }

    // --- Unread chat (#469: messaging/unread → chat/history isRead 集計) ---

    fn unread_chat_history_msg(
        id: &str,
        from_user_id: &str,
        is_read: bool,
        is_room: bool,
    ) -> Value {
        let mut m = json!({
            "id": id,
            "createdAt": "2025-01-01T00:00:00.000Z",
            "fromUserId": from_user_id,
            "fromUser": null,
            "toUserId": null,
            "toUser": null,
            "toRoomId": null,
            "toRoom": null,
            "text": "hi",
            "fileId": null,
            "file": null,
            "isRead": is_read,
            "reactions": []
        });
        if is_room {
            m["toRoomId"] = json!("r1");
            m["toRoom"] = json!({"id": "r1", "name": "R", "description": null});
        } else {
            m["toUserId"] = json!("u_self");
        }
        m
    }

    #[tokio::test]
    async fn get_unread_chat_returns_true_when_other_user_message_is_unread() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/chat/history"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                unread_chat_history_msg("m1", "u_other", false, false),
            ])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let unread = client
            .get_unread_chat("h", "token", "u_self")
            .await
            .unwrap();
        assert!(unread);
    }

    #[tokio::test]
    async fn get_unread_chat_excludes_self_messages() {
        let server = MockServer::start().await;
        // 自分送信の DM が isRead=false (= 相手未読) でも自分の未読扱いにしない
        Mock::given(method("POST"))
            .and(path("/api/chat/history"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                unread_chat_history_msg("m1", "u_self", false, false),
            ])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let unread = client
            .get_unread_chat("h", "token", "u_self")
            .await
            .unwrap();
        assert!(!unread);
    }

    #[tokio::test]
    async fn get_unread_chat_returns_false_when_all_read() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/chat/history"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([
                unread_chat_history_msg("m1", "u_other", true, false),
                unread_chat_history_msg("m2", "u_other", true, true),
            ])))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let unread = client
            .get_unread_chat("h", "token", "u_self")
            .await
            .unwrap();
        assert!(!unread);
    }

    #[tokio::test]
    async fn get_unread_chat_swallows_errors_and_returns_false() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/chat/history"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let unread = client
            .get_unread_chat("h", "token", "u_self")
            .await
            .unwrap();
        // 両方失敗 → false (panic せず正常 return)
        assert!(!unread);
    }

    #[tokio::test]
    async fn update_following_sends_notify_and_with_replies() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/following/update"))
            .and(body_partial_json(
                json!({ "userId": "u1", "notify": "none", "withReplies": true }),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        client
            .update_following("h", "token", "u1", Some("none"), Some(true))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn update_following_omits_unset_fields() {
        let server = MockServer::start().await;
        // withReplies のみ指定 → notify は body に含まれないこと
        Mock::given(method("POST"))
            .and(path("/api/following/update"))
            .and(body_partial_json(
                json!({ "userId": "u1", "withReplies": false }),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        client
            .update_following("h", "token", "u1", None, Some(false))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn update_user_memo_sends_memo() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/users/update-memo"))
            .and(body_partial_json(
                json!({ "userId": "u1", "memo": "friend" }),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        client
            .update_user_memo("h", "token", "u1", "friend")
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn get_antenna_parses_full_entity() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/antennas/show"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": "a1",
                "name": "friends",
                "src": "users",
                "users": ["@alice@example.com"],
                "keywords": [],
                "excludeKeywords": [],
                "caseSensitive": false,
                "localOnly": false,
                "excludeBots": false,
                "withReplies": false,
                "withFile": false,
                "notify": false
            })))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let antenna = client.get_antenna("h", "token", "a1").await.unwrap();
        assert_eq!(antenna.src, "users");
        assert_eq!(antenna.users, vec!["@alice@example.com".to_string()]);
    }

    #[tokio::test]
    async fn update_antenna_round_trips_users() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/antennas/update"))
            .and(body_partial_json(json!({
                "antennaId": "a1",
                "src": "users",
                "users": ["@alice@example.com", "@bob@example.com"]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": "a1",
                "name": "friends",
                "src": "users",
                "users": ["@alice@example.com", "@bob@example.com"]
            })))
            .mount(&server)
            .await;

        let antenna = Antenna {
            id: "a1".to_string(),
            name: "friends".to_string(),
            src: "users".to_string(),
            user_list_id: None,
            users: vec![
                "@alice@example.com".to_string(),
                "@bob@example.com".to_string(),
            ],
            keywords: vec![],
            exclude_keywords: vec![],
            case_sensitive: false,
            local_only: false,
            exclude_bots: false,
            with_replies: false,
            with_file: false,
            notify: false,
        };
        let client = MisskeyClient::with_base_url(&server.uri());
        let updated = client.update_antenna("h", "token", &antenna).await.unwrap();
        assert_eq!(updated.users.len(), 2);
    }

    #[tokio::test]
    async fn search_notes_sends_user_id_filter() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/notes/search"))
            .and(body_partial_json(
                json!({ "query": "rust", "userId": "u1" }),
            ))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([raw_note_json("n1", "rust note")])),
            )
            .mount(&server)
            .await;

        let mut options = SearchOptions::default();
        options.user_id = Some("u1".to_string());
        let client = MisskeyClient::with_base_url(&server.uri());
        let notes = client
            .search_notes("h", "token", "acc1", "rust", options)
            .await
            .unwrap();
        assert_eq!(notes.len(), 1);
    }

    #[tokio::test]
    async fn get_user_detail_parses_memo_notify_with_replies() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": "u1",
                "username": "taka",
                "host": null,
                "name": "Taka",
                "createdAt": "2024-01-01T00:00:00.000Z",
                "memo": "my note",
                "notify": "normal",
                "withReplies": true
            })))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let user = client
            .get_user_detail("h", "token", "acc1", "u1")
            .await
            .unwrap();
        assert_eq!(user.memo.as_deref(), Some("my note"));
        assert_eq!(user.notify.as_deref(), Some("normal"));
        assert_eq!(user.with_replies, Some(true));
    }

    /// users/show 応答に同梱される pinnedNoteIds / pinnedNotes を normalize する
    /// (notedeck#632: プロフィール表示を追加往復なしの 1 リクエストで完結させる)。
    #[tokio::test]
    async fn get_user_detail_normalizes_pinned_notes() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": "u1",
                "username": "taka",
                "createdAt": "2024-01-01T00:00:00.000Z",
                "pinnedNoteIds": ["n1", "n2"],
                "pinnedNotes": [
                    raw_note_json("n1", "pinned one"),
                    raw_note_json("n2", "pinned two"),
                ]
            })))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let user = client
            .get_user_detail("h", "token", "acc1", "u1")
            .await
            .unwrap();
        assert_eq!(user.pinned_note_ids, vec!["n1", "n2"]);
        assert_eq!(user.pinned_notes.len(), 2);
        assert_eq!(user.pinned_notes[0].text.as_deref(), Some("pinned one"));
        // ピン留めノートも他経路の note と同じく account/server が刻印される
        assert_eq!(user.pinned_notes[0].account_id, "acc1");
        assert_eq!(user.pinned_notes[0].server_host, "h");
    }

    /// pinnedNotes を返さない (古い/フォーク) サーバーでも空配列に落ちる
    #[tokio::test]
    async fn get_user_detail_defaults_pinned_notes_to_empty() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/api/users/show"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "id": "u1",
                "username": "taka",
                "createdAt": "2024-01-01T00:00:00.000Z"
            })))
            .mount(&server)
            .await;

        let client = MisskeyClient::with_base_url(&server.uri());
        let user = client
            .get_user_detail("h", "token", "acc1", "u1")
            .await
            .unwrap();
        assert!(user.pinned_note_ids.is_empty());
        assert!(user.pinned_notes.is_empty());
    }
}
