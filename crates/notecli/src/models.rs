use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use zeroize::Zeroize;

fn deserialize_nullable_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    let opt: Option<Vec<T>> = Option::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

// --- DB models ---

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub host: String,
    pub token: String,
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub software: String,
}

// token をログ・panic メッセージに漏らさないため Debug は手書き
impl std::fmt::Debug for Account {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Account")
            .field("id", &self.id)
            .field("host", &self.host)
            .field("token", &"<redacted>")
            .field("user_id", &self.user_id)
            .field("username", &self.username)
            .field("display_name", &self.display_name)
            .field("avatar_url", &self.avatar_url)
            .field("software", &self.software)
            .finish()
    }
}

impl Drop for Account {
    fn drop(&mut self) {
        self.token.zeroize();
    }
}

/// Token を含まない、フロントエンド向け Account 構造体
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AccountPublic {
    pub id: String,
    pub host: String,
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub software: String,
    pub has_token: bool,
}

impl AccountPublic {
    pub fn new(a: &Account, has_token: bool) -> Self {
        Self {
            id: a.id.clone(),
            host: a.host.clone(),
            user_id: a.user_id.clone(),
            username: a.username.clone(),
            display_name: a.display_name.clone(),
            avatar_url: a.avatar_url.clone(),
            software: a.software.clone(),
            has_token,
        }
    }
}

impl From<&Account> for AccountPublic {
    fn from(a: &Account) -> Self {
        Self::new(a, !a.token.is_empty())
    }
}

impl From<Account> for AccountPublic {
    fn from(mut a: Account) -> Self {
        let has_token = !a.token.is_empty();
        // Zeroize token before taking fields via clone to maintain security invariant
        a.token.zeroize();
        Self {
            id: std::mem::take(&mut a.id),
            host: std::mem::take(&mut a.host),
            user_id: std::mem::take(&mut a.user_id),
            username: std::mem::take(&mut a.username),
            display_name: a.display_name.take(),
            avatar_url: a.avatar_url.take(),
            software: std::mem::take(&mut a.software),
            has_token,
        }
    }
}

/// サーバー検出結果の生キャッシュ (notedeck#782)。
///
/// nodeinfo の software 情報と /api/meta の生 JSON をそのまま保存する。
/// フォーク解決 (software 名 → ServerSoftware) と feature 判定はアプリ側が
/// 読取時に行う — 判定ロジックの更新が古いキャッシュに埋まらないようにする。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerDetection {
    pub host: String,
    /// nodeinfo `software.name` (例: "misskey")
    pub software_name: String,
    /// nodeinfo `software.version`
    pub software_version: String,
    /// nodeinfo 2.1 `software.repository` (例: "https://github.com/misskey-dev/misskey")
    pub software_repository: Option<String>,
    /// /api/meta (detail: true) の生 JSON。取得失敗時は "{}"
    pub meta_json: String,
    pub updated_at: i64,
}

// --- Normalized models (sent to frontend via IPC) ---

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NormalizedNote {
    pub id: String,
    #[serde(rename = "_accountId")]
    pub account_id: String,
    #[serde(rename = "_serverHost")]
    pub server_host: String,
    /// 同一性キー (正規化 AP object id)。導出は `identity::identity_of` (notedeck#1058)。
    /// 旧 JSON には無いので default で読み、`fill_identity` で補う。
    #[serde(rename = "_identity", default)]
    pub identity: String,
    /// identity の host == 取得元サーバー (このビューが origin か)
    #[serde(rename = "_isOrigin", default)]
    pub is_origin: bool,
    /// 整合検査: リモート投稿者の host と identity の host が一致するか。
    /// ローカル投稿者 (user.host = None) は identity を自分で組むので常に true。
    #[serde(rename = "_identityTrusted", default)]
    pub identity_trusted: bool,
    /// サーバーが本文を隠した状態 (packed の isHidden)。ミュート由来の非表示とは別概念。
    #[serde(default)]
    pub content_hidden: bool,
    pub created_at: String,
    pub text: Option<String>,
    pub cw: Option<String>,
    pub user: NormalizedUser,
    pub visibility: String,
    #[serde(default)]
    pub emojis: HashMap<String, String>,
    #[serde(default)]
    pub reaction_emojis: HashMap<String, String>,
    #[serde(default)]
    pub reactions: HashMap<String, i64>,
    pub my_reaction: Option<String>,
    pub renote_count: i64,
    pub replies_count: i64,
    #[serde(default)]
    pub files: Vec<NormalizedDriveFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub poll: Option<NormalizedPoll>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renote_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<Channel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reaction_acceptance: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub local_only: bool,
    #[serde(default)]
    pub visible_user_ids: Vec<String>,
    #[serde(default)]
    pub is_favorited: bool,
    /// Fork-specific mode flags (e.g., isNoteInYamiMode)
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub mode_flags: HashMap<String, bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<Box<serde_json::Value>>))]
    #[schema(no_recursion)]
    pub reply: Option<Box<NormalizedNote>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(type = Option<Box<serde_json::Value>>))]
    #[schema(no_recursion)]
    pub renote: Option<Box<NormalizedNote>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AvatarDecoration {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub angle: Option<f64>,
    #[serde(default)]
    pub flip_h: Option<bool>,
    #[serde(default)]
    pub offset_x: Option<f64>,
    #[serde(default)]
    pub offset_y: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserInstance {
    pub name: Option<String>,
    pub favicon_url: Option<String>,
    pub icon_url: Option<String>,
    pub theme_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NormalizedUser {
    pub id: String,
    pub username: String,
    pub host: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub is_bot: bool,
    #[serde(default)]
    pub is_cat: bool,
    #[serde(default)]
    pub avatar_decorations: Vec<AvatarDecoration>,
    #[serde(default)]
    pub emojis: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance: Option<UserInstance>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserRole {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon_url: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub display_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct UserField {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NormalizedUserDetail {
    pub id: String,
    pub username: String,
    pub host: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub banner_url: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub followers_count: i64,
    #[serde(default)]
    pub following_count: i64,
    #[serde(default)]
    pub notes_count: i64,
    #[serde(default)]
    pub is_bot: bool,
    #[serde(default)]
    pub is_cat: bool,
    #[serde(default)]
    pub is_following: bool,
    #[serde(default)]
    pub is_followed: bool,
    /// 鍵アカウント (フォローに承認が必要) かどうか
    #[serde(default)]
    pub is_locked: bool,
    /// 鍵アカウントへフォローリクエスト送信済みで未承認の状態
    #[serde(default)]
    pub has_pending_follow_request_from_you: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub avatar_decorations: Vec<AvatarDecoration>,
    #[serde(default)]
    pub emojis: HashMap<String, String>,
    #[serde(default)]
    pub roles: Vec<UserRole>,
    #[serde(default)]
    pub fields: Vec<UserField>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub birthday: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub online_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub following_visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub followers_visibility: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub followed_message: Option<String>,
    /// このユーザーに対する自分用メモ (users/update-memo)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
    /// フォロー中のみ意味を持つ: 'normal' | 'none' (投稿通知)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notify: Option<String>,
    /// フォロー中のみ意味を持つ: TL に他者への返信を含めるか
    #[serde(skip_serializing_if = "Option::is_none")]
    pub with_replies: Option<bool>,
    /// users/show 応答に同梱されるピン留めノート ID (notedeck#632)
    #[serde(default)]
    pub pinned_note_ids: Vec<String>,
    /// users/show 応答に同梱されるピン留めノート本体。追加の users/show +
    /// notes/show × N を往復せずプロフィールを 1 リクエストで描ける (notedeck#632)
    #[serde(default)]
    pub pinned_notes: Vec<NormalizedNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPoll {
    pub choices: Vec<NormalizedPollChoice>,
    #[serde(default)]
    pub multiple: bool,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NormalizedPollChoice {
    pub text: String,
    #[serde(default)]
    pub votes: i64,
    #[serde(default)]
    pub is_voted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NormalizedDriveFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub url: String,
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub is_sensitive: bool,
    /// 画像の幅 (px)。フロントの aspect-ratio 予約 (レイアウトシフト防止) 用
    #[serde(default)]
    pub width: Option<i64>,
    /// 画像の高さ (px)
    #[serde(default)]
    pub height: Option<i64>,
    /// blurhash プレースホルダ文字列
    #[serde(default)]
    pub blurhash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ReactionInfo {
    pub user: NormalizedUser,
    pub reaction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NormalizedNotification {
    pub id: String,
    #[serde(rename = "_accountId")]
    pub account_id: String,
    #[serde(rename = "_serverHost")]
    pub server_host: String,
    pub created_at: String,
    #[serde(rename = "type")]
    pub notification_type: String,
    pub user: Option<NormalizedUser>,
    pub note: Option<NormalizedNote>,
    pub reaction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub achievement: Option<String>,
    /// Grouped reactions (for reaction:grouped type)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reactions: Option<Vec<ReactionInfo>>,
    /// Grouped users (for renote:grouped type)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub users: Option<Vec<NormalizedUser>>,
    /// Assigned role (for roleAssigned type)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<UserRole>,
    /// App notification header (for app type; notifications/create の header)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    /// App notification body (for app type; notifications/create の body)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// App notification icon URL (for app type; notifications/create の icon)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CreateNoteParams {
    pub text: Option<String>,
    pub cw: Option<String>,
    pub visibility: Option<String>,
    pub local_only: Option<bool>,
    pub mode_flags: Option<HashMap<String, bool>>,
    pub reply_id: Option<String>,
    pub renote_id: Option<String>,
    pub file_ids: Option<Vec<String>>,
    pub poll: Option<CreateNotePoll>,
    pub scheduled_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct CreateNotePoll {
    pub choices: Vec<String>,
    pub multiple: Option<bool>,
    pub expires_at: Option<i64>,
}

/// タイムライン所属キーの正本。
///
/// canonical 文字列形式（DB の `timeline_key` 列・TS 境界の `string` はこの形式）:
///
/// | variant | canonical |
/// |---|---|
/// | `Basic` | `home` / `local` / `social` / `global` / `bubble` 等（`:` を含まない非予約語） |
/// | `UserList` | `user-list:{listId}` |
/// | `Antenna` | `antenna:{antennaId}` |
/// | `Channel` | `channel:{channelId}` |
/// | `Role` | `role:{roleId}` |
/// | `Clip` | `clip:{clipId}` |
/// | `UserNotes` | `user:{userId}` |
/// | `Mentions` | `mentions` |
/// | `Specified` | `specified` |
/// | `Favorites` | `favorites` |
///
/// `explore` は DeckExploreColumn の読み出し専用キー（`Basic` として parse は通るが
/// 書込経路なし・常に空読み）。
///
/// prefix と bare 語は小文字で定義する。id 部は不透明バイト列として入力どおり保持し、
/// 大小文字の正規化・検証を行わない（ULID 形式の id は大文字を含む）。
/// 構築は `parse` か境界アダプタ経由に限る。`Basic` へ予約語・`:`・空文字列を直接
/// 渡してはならない（canonical 衝突 / parse 不能を生む）。
/// Tauri コマンドの invoke 引数型には使わない（String 受け → parse を維持）。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum TimelineKey {
    Basic(String),
    UserList { list_id: String },
    Antenna { antenna_id: String },
    Channel { channel_id: String },
    Role { role_id: String },
    Clip { clip_id: String },
    UserNotes { user_id: String },
    Mentions,
    Specified,
    Favorites,
}

/// bare 単独で現れたら parse エラーになる prefix 予約語
const RESERVED_PREFIXES: [&str; 6] = ["user-list", "antenna", "channel", "role", "clip", "user"];

/// `Basic` タイムライン名として許す形（lowercase ASCII 英数 + `-`）か。
///
/// 名前は API パス (`notes/{t}-timeline`) と WS チャンネル名 (`{t}Timeline`) へ
/// 直接補間されるため、パス区切りやクエリ文字を含む名前を通すとリクエスト先を
/// 差し替えられてしまう。既知のフォーク TL (bubble / vmimi-relay / hanami 等) は
/// すべてこの形に収まる。
fn is_valid_basic_name(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// kebab-case を lowerCamelCase に変換（"vmimi-relay" → "vmimiRelay"）。
/// Misskey の WS チャンネル名は lowerCamel、endpoint は kebab が慣行。
fn kebab_to_lower_camel(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for (i, seg) in s.split('-').enumerate() {
        if i == 0 {
            out.push_str(seg);
        } else {
            let mut chars = seg.chars();
            if let Some(first) = chars.next() {
                out.extend(first.to_uppercase());
                out.push_str(chars.as_str());
            }
        }
    }
    out
}

impl TimelineKey {
    /// canonical 文字列から構築する。分割は最初の `:` による splitn(2)（id 内に `:` が
    /// 残る場合も id の一部として保持）。
    pub fn parse(s: &str) -> Result<Self, crate::error::NoteDeckError> {
        use crate::error::NoteDeckError;
        if s.is_empty() {
            return Err(NoteDeckError::InvalidInput(
                "timeline key must not be empty".to_string(),
            ));
        }
        if s.len() > 256 {
            return Err(NoteDeckError::InvalidInput(
                "timeline key exceeds 256 bytes".to_string(),
            ));
        }
        if s.bytes().any(|b| b < 0x20 || b == 0x7F) {
            return Err(NoteDeckError::InvalidInput(
                "timeline key contains control characters".to_string(),
            ));
        }
        if let Some((prefix, id)) = s.split_once(':') {
            if id.is_empty() {
                return Err(NoteDeckError::InvalidInput(format!(
                    "timeline key '{prefix}:' has empty id"
                )));
            }
            let id = id.to_string();
            match prefix {
                "user-list" => Ok(Self::UserList { list_id: id }),
                "antenna" => Ok(Self::Antenna { antenna_id: id }),
                "channel" => Ok(Self::Channel { channel_id: id }),
                "role" => Ok(Self::Role { role_id: id }),
                "clip" => Ok(Self::Clip { clip_id: id }),
                "user" => Ok(Self::UserNotes { user_id: id }),
                _ => Err(NoteDeckError::InvalidInput(format!(
                    "unknown timeline key prefix '{prefix}'"
                ))),
            }
        } else {
            match s {
                "mentions" => Ok(Self::Mentions),
                "specified" => Ok(Self::Specified),
                "favorites" => Ok(Self::Favorites),
                _ if RESERVED_PREFIXES.contains(&s) => Err(NoteDeckError::InvalidInput(format!(
                    "bare reserved timeline key '{s}' (id required)"
                ))),
                // Basic 名は `api_endpoint` が `notes/{t}-timeline` として API パスへ
                // 補間し、`ws_channel` が `{t}Timeline` としてチャンネル名にする。
                // `/` `.` `?` `#` 等を許すとリクエスト先そのものを差し替えられる
                // (例: `../../admin/x?` → `/api/admin/x`) ため、Misskey の TL 命名
                // 慣行どおり lowercase kebab に限定する。
                _ if is_valid_basic_name(s) => Ok(Self::Basic(s.to_string())),
                _ => Err(NoteDeckError::InvalidInput(format!(
                    "invalid basic timeline key '{s}'"
                ))),
            }
        }
    }

    pub fn as_canonical(&self) -> String {
        match self {
            Self::Basic(t) => t.clone(),
            Self::UserList { list_id } => format!("user-list:{list_id}"),
            Self::Antenna { antenna_id } => format!("antenna:{antenna_id}"),
            Self::Channel { channel_id } => format!("channel:{channel_id}"),
            Self::Role { role_id } => format!("role:{role_id}"),
            Self::Clip { clip_id } => format!("clip:{clip_id}"),
            Self::UserNotes { user_id } => format!("user:{user_id}"),
            Self::Mentions => "mentions".to_string(),
            Self::Specified => "specified".to_string(),
            Self::Favorites => "favorites".to_string(),
        }
    }

    /// REST エンドポイントと追加パラメータ。Favorites / Clip は応答形状・API 方針の
    /// 都合で専用 API を維持するため None。
    pub fn api_endpoint(&self) -> Option<(std::borrow::Cow<'static, str>, Value)> {
        use std::borrow::Cow;
        match self {
            Self::Basic(t) => Some(match t.as_str() {
                "home" => (Cow::Borrowed("notes/timeline"), serde_json::json!({})),
                "local" => (Cow::Borrowed("notes/local-timeline"), serde_json::json!({})),
                "social" => (
                    Cow::Borrowed("notes/hybrid-timeline"),
                    serde_json::json!({}),
                ),
                "global" => (
                    Cow::Borrowed("notes/global-timeline"),
                    serde_json::json!({}),
                ),
                other => (
                    Cow::Owned(format!("notes/{other}-timeline")),
                    serde_json::json!({}),
                ),
            }),
            Self::UserList { list_id } => Some((
                Cow::Borrowed("notes/user-list-timeline"),
                serde_json::json!({ "listId": list_id }),
            )),
            Self::Antenna { antenna_id } => Some((
                Cow::Borrowed("antennas/notes"),
                serde_json::json!({ "antennaId": antenna_id }),
            )),
            Self::Channel { channel_id } => Some((
                Cow::Borrowed("channels/timeline"),
                serde_json::json!({ "channelId": channel_id }),
            )),
            Self::Role { role_id } => Some((
                Cow::Borrowed("roles/notes"),
                serde_json::json!({ "roleId": role_id }),
            )),
            Self::UserNotes { user_id } => Some((
                Cow::Borrowed("users/notes"),
                serde_json::json!({ "userId": user_id }),
            )),
            Self::Mentions => Some((Cow::Borrowed("notes/mentions"), serde_json::json!({}))),
            Self::Specified => Some((
                Cow::Borrowed("notes/mentions"),
                serde_json::json!({ "visibility": "specified" }),
            )),
            Self::Favorites | Self::Clip { .. } => None,
        }
    }

    /// WS チャンネル名とパラメータ。streaming 購読を持たない種別は None。
    /// 未知 Basic の fallback は kebab→lowerCamel 変換付き
    /// （"vmimi-relay" → "vmimiRelayTimeline"）。
    pub fn ws_channel(&self) -> Option<(std::borrow::Cow<'static, str>, Option<Value>)> {
        use std::borrow::Cow;
        match self {
            Self::Basic(t) => Some(match t.as_str() {
                "home" => (Cow::Borrowed("homeTimeline"), None),
                "local" => (Cow::Borrowed("localTimeline"), None),
                "social" => (Cow::Borrowed("hybridTimeline"), None),
                "global" => (Cow::Borrowed("globalTimeline"), None),
                other => (
                    Cow::Owned(format!("{}Timeline", kebab_to_lower_camel(other))),
                    None,
                ),
            }),
            Self::UserList { list_id } => Some((
                Cow::Borrowed("userList"),
                Some(serde_json::json!({ "listId": list_id })),
            )),
            Self::Antenna { antenna_id } => Some((
                Cow::Borrowed("antenna"),
                Some(serde_json::json!({ "antennaId": antenna_id })),
            )),
            Self::Channel { channel_id } => Some((
                Cow::Borrowed("channel"),
                Some(serde_json::json!({ "channelId": channel_id })),
            )),
            Self::Role { role_id } => Some((
                Cow::Borrowed("roleTimeline"),
                Some(serde_json::json!({ "roleId": role_id })),
            )),
            Self::UserNotes { .. }
            | Self::Mentions
            | Self::Specified
            | Self::Favorites
            | Self::Clip { .. } => None,
        }
    }
}

impl std::fmt::Display for TimelineKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.as_canonical())
    }
}

impl Serialize for TimelineKey {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.as_canonical())
    }
}

impl<'de> Deserialize<'de> for TimelineKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        Self::parse(&s).map_err(serde::de::Error::custom)
    }
}

// derive(specta::Type) は serde 属性しか読まず手書き Serialize を無視して
// tagged union を TS に生成するため、String へ委譲する手書き impl を使う
// （前例: error.rs の NoteDeckError）。TS 上は常に string に inline される。
#[cfg(feature = "specta")]
impl specta::Type for TimelineKey {
    fn inline(
        type_map: &mut specta::TypeCollection,
        generics: specta::Generics,
    ) -> specta::datatype::DataType {
        String::inline(type_map, generics)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TimelineFilter {
    pub with_renotes: Option<bool>,
    pub with_replies: Option<bool>,
    pub with_files: Option<bool>,
    pub with_bots: Option<bool>,
    pub with_sensitive: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TimelineOptions {
    #[serde(default = "default_limit")]
    limit: i64,
    pub since_id: Option<String>,
    pub until_id: Option<String>,
    #[serde(default)]
    pub filters: Option<TimelineFilter>,
    pub list_id: Option<String>,
}

impl TimelineOptions {
    pub fn new(limit: i64, since_id: Option<String>, until_id: Option<String>) -> Self {
        Self {
            limit,
            since_id,
            until_id,
            filters: None,
            list_id: None,
        }
    }

    /// Returns limit clamped to 1..=100
    pub fn limit(&self) -> i64 {
        self.limit.clamp(1, 100)
    }
}

impl Default for TimelineOptions {
    fn default() -> Self {
        Self {
            limit: 20,
            since_id: None,
            until_id: None,
            filters: None,
            list_id: None,
        }
    }
}

fn default_limit() -> i64 {
    20
}

/// Misskey `users/lists/*` (list, show) の共通レスポンス。本家 schema
/// (packages/backend/src/models/json-schema/user-list.ts) に準拠。
///
/// `forPublic=true` で他人の公開リストを取得した時のみ `isLiked` /
/// `likedCount` が付加される (Clips の `isFavorited` / `favoritedCount` と
/// 非対称な命名は本家準拠)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserList {
    pub id: String,
    pub name: String,
    pub is_public: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_liked: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liked_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema, Default)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Antenna {
    pub id: String,
    pub name: String,
    /// 'home' | 'all' | 'users' | 'list' | 'users_blacklist'
    #[serde(default)]
    pub src: String,
    #[serde(default)]
    pub user_list_id: Option<String>,
    /// ソースが 'users' / 'users_blacklist' のときの対象 (["@user@host", ...])
    #[serde(default)]
    pub users: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<Vec<String>>,
    #[serde(default)]
    pub exclude_keywords: Vec<Vec<String>>,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub local_only: bool,
    #[serde(default)]
    pub exclude_bots: bool,
    #[serde(default)]
    pub with_replies: bool,
    #[serde(default)]
    pub with_file: bool,
    #[serde(default)]
    pub notify: bool,
}

// =============================================================================
// Misskey users 系個別エンドポイント (users/reactions, users/pages,
// users/flashs, users/gallery/posts)。本家 schema 準拠。
// =============================================================================

/// `users/reactions` がレスポンス内で含む note への薄い参照。
///
/// users/reactions のレスポンスは raw Misskey note schema を含むが、
/// notecli の NormalizedNote は `RawNote.normalize(account_id, host)` を経て
/// 構築する独自モデルなので直接デシリアライズできない。
/// notedeck 側ではこの id を使って adapter 経由で再取得・正規化する設計のため、
/// id のみ抜き出す。サーバーから来る他のフィールドは serde の default で破棄。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserReactionNoteRef {
    pub id: String,
}

/// `users/reactions` の 1 件分。自分のプロフィールで「リアクション」タブを
/// 開いたときに、自分が付けたリアクションとその対象 note を一覧する。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserReaction {
    pub id: String,
    pub created_at: String,
    /// `type` は Rust 予約語。サーバーの JSON キーは "type"。
    #[serde(rename = "type")]
    pub reaction_type: String,
    pub note: UserReactionNoteRef,
}

/// `users/pages` / `pages/show` の 1 件分。本家 packages/backend/src/models/Page.ts。
/// プロフィール一覧で使うのは title / summary / createdAt のみだが、
/// `pages/show` でも同型を使えるようフルセットで定義。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub title: String,
    pub name: String,
    pub summary: Option<String>,
    pub user_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<NormalizedUser>,
    /// `content` / `variables` はブロック構造で複雑。生 JSON で運ぶ。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variables: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script: Option<String>,
    #[serde(default)]
    pub align_center: bool,
    #[serde(default)]
    pub hide_title_when_pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eye_catching_image_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eye_catching_image: Option<NormalizedDriveFile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liked_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_liked: Option<bool>,
}

/// `users/flashs` / `flash/show` の 1 件分。本家
/// packages/backend/src/models/Flash.ts。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Flash {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub title: String,
    pub summary: String,
    pub script: String,
    pub user_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<NormalizedUser>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liked_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_liked: Option<bool>,
}

/// `users/gallery/posts` / `gallery/posts/show` の 1 件分。本家
/// packages/backend/src/models/GalleryPost.ts。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct GalleryPost {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub title: String,
    pub description: Option<String>,
    pub user_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<NormalizedUser>,
    pub files: Vec<NormalizedDriveFile>,
    #[serde(default)]
    pub is_sensitive: bool,
    #[serde(default)]
    pub liked_count: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_liked: Option<bool>,
}

// =============================================================================
// Misskey `charts/*` レスポンス。9 種類のエンドポイントごとに別構造体。
// 各フィールドは時系列データ点 (新→古順、index 0 = 今日) を i64 配列で持つ。
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserNotesChartDiffs {
    pub normal: Vec<i64>,
    pub reply: Vec<i64>,
    pub renote: Vec<i64>,
    pub with_file: Vec<i64>,
}

/// `charts/user/notes`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserNotesChart {
    pub inc: Vec<i64>,
    pub dec: Vec<i64>,
    pub diffs: UserNotesChartDiffs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FollowChartGroup {
    pub inc: Vec<i64>,
    pub dec: Vec<i64>,
    pub total: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FollowChartSection {
    pub followings: FollowChartGroup,
    pub followers: FollowChartGroup,
}

/// `charts/user/following`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserFollowingChart {
    pub local: FollowChartSection,
    pub remote: FollowChartSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct PvChartGroup {
    pub user: Vec<i64>,
    pub visitor: Vec<i64>,
}

/// `charts/user/pv` (pv = Natural PV、upv = Unique PV)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct UserPvChart {
    pub pv: PvChartGroup,
    pub upv: PvChartGroup,
}

/// `charts/active-users`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ActiveUsersChart {
    pub read_write: Vec<i64>,
    pub read: Vec<i64>,
    pub write: Vec<i64>,
    pub registered_within_week: Vec<i64>,
    pub registered_within_month: Vec<i64>,
    pub registered_within_year: Vec<i64>,
    pub registered_outside_week: Vec<i64>,
    pub registered_outside_month: Vec<i64>,
    pub registered_outside_year: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerNotesChartSection {
    pub total: Vec<i64>,
    pub inc: Vec<i64>,
    pub dec: Vec<i64>,
    pub diffs: UserNotesChartDiffs,
}

/// `charts/notes`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerNotesChart {
    pub local: ServerNotesChartSection,
    pub remote: ServerNotesChartSection,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerUsersChartSection {
    pub total: Vec<i64>,
    pub inc: Vec<i64>,
    pub dec: Vec<i64>,
}

/// `charts/users`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerUsersChart {
    pub local: ServerUsersChartSection,
    pub remote: ServerUsersChartSection,
}

/// `charts/federation`
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct FederationChart {
    pub delivered_instances: Vec<i64>,
    pub inbox_instances: Vec<i64>,
    pub stalled: Vec<i64>,
    pub sub: Vec<i64>,
    /// `pub` は Rust 予約語。サーバーの JSON キーは "pub"。
    #[serde(rename = "pub")]
    pub pub_: Vec<i64>,
    pub pubsub: Vec<i64>,
    pub sub_active: Vec<i64>,
    #[serde(rename = "pubActive")]
    pub pub_active: Vec<i64>,
}

/// `charts/ap-request` (ActivityPub の配送成功/失敗/受信数)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ApRequestChart {
    pub deliver_succeeded: Vec<i64>,
    pub deliver_failed: Vec<i64>,
    pub inbox_received: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerDriveChartSection {
    pub inc_count: Vec<i64>,
    pub inc_size: Vec<i64>,
    pub dec_count: Vec<i64>,
    pub dec_size: Vec<i64>,
}

/// `charts/drive` (Size は KB 単位)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ServerDriveChart {
    pub local: ServerDriveChartSection,
    pub remote: ServerDriveChartSection,
}

/// Misskey `notes/drafts/*` (2025.6+) のレスポンス。`notes/drafts/list` は
/// `Vec<NoteDraft>`、`notes/drafts/create` は `{ createdDraft: NoteDraft }`、
/// `notes/drafts/update` は `{ updatedDraft: NoteDraft }` を返す
/// (notedeck 側でラッパーを剥がして直接 NoteDraft を渡す)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NoteDraftPoll {
    pub choices: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multiple: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub id: String,
    pub created_at: String,
    pub text: Option<String>,
    pub cw: Option<String>,
    pub visibility: String,
    #[serde(default)]
    pub local_only: bool,
    #[serde(default)]
    pub file_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hashtag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub renote_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poll: Option<NoteDraftPoll>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheduled_at: Option<i64>,
    #[serde(default)]
    pub is_actually_scheduled: bool,
}

/// Misskey `clips/*` (clips/list, clips/show, clips/create, users/clips,
/// clips/my-favorites) の共通レスポンス。本家 schema
/// (packages/backend/src/models/json-schema/clip.ts) に準拠。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub created_at: String,
    pub last_clipped_at: Option<String>,
    pub user_id: String,
    pub user: NormalizedUser,
    pub name: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub favorited_count: i64,
    /// `isFavorited` はログイン時のみサーバーから返る。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_favorited: Option<bool>,
    /// `notesCount` は一部エンドポイントのみ返る。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub created_at: String,
    pub from_user_id: String,
    pub from_user: Option<ChatUser>,
    pub to_user_id: Option<String>,
    pub to_user: Option<ChatUser>,
    pub to_room_id: Option<String>,
    pub to_room: Option<ChatRoom>,
    pub text: Option<String>,
    pub file_id: Option<String>,
    pub file: Option<NormalizedDriveFile>,
    pub is_read: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_nullable_vec")]
    pub reactions: Vec<ChatMessageReaction>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageReaction {
    pub user: Option<ChatReactionUser>,
    pub reaction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ChatReactionUser {
    pub id: String,
    pub name: Option<String>,
    pub username: String,
    pub host: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ChatUser {
    pub id: String,
    pub name: Option<String>,
    pub username: String,
    pub host: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub emojis: HashMap<String, String>,
    #[serde(default)]
    pub avatar_decorations: Vec<AvatarDecoration>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ChatRoom {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    #[serde(default = "default_limit")]
    limit: i64,
    pub since_id: Option<String>,
    pub until_id: Option<String>,
    pub since_date: Option<i64>,
    pub until_date: Option<i64>,
    /// 指定ユーザーのノートのみに絞る (notes/search の userId)
    #[serde(default)]
    pub user_id: Option<String>,
}

impl SearchOptions {
    pub fn new(limit: i64) -> Self {
        Self {
            limit,
            since_id: None,
            until_id: None,
            since_date: None,
            until_date: None,
            user_id: None,
        }
    }

    pub fn limit(&self) -> i64 {
        self.limit.clamp(1, 100)
    }
}

impl Default for SearchOptions {
    fn default() -> Self {
        Self {
            limit: 20,
            since_id: None,
            until_id: None,
            since_date: None,
            until_date: None,
            user_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub session_id: String,
    pub url: String,
    pub host: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AuthResult {
    pub token: String,
    pub user: NormalizedUser,
}

// token をログ・panic メッセージに漏らさないため Debug は手書き
impl std::fmt::Debug for AuthResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthResult")
            .field("token", &"<redacted>")
            .field("user", &self.user)
            .finish()
    }
}

// --- Streaming noteUpdated payloads (#781 typed events) ---

/// Typed body of a Misskey `noteUpdated` streaming event.
/// Adjacent tagging (`updateType` + `body`) preserves the historical wire shape
/// `{ updateType: "reacted", body: { ... } }` so the JSON consumers read is
/// unchanged while the contract becomes typed end-to-end.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "updateType", content = "body", rename_all = "camelCase")]
pub enum NoteUpdateBody {
    Reacted(NoteReactedBody),
    Unreacted(NoteUnreactedBody),
    PollVoted(NotePollVotedBody),
    Deleted(NoteDeletedBody),
}

impl NoteUpdateBody {
    /// Parse the raw `{ type, body }` of a Misskey `noteUpdated` event.
    /// Unknown update types (fork extensions) yield `None` and are dropped at
    /// the WS boundary; the inspector's raw tap is unaffected.
    pub fn from_raw(update_type: &str, body: Value) -> Option<Self> {
        Some(match update_type {
            "reacted" => Self::Reacted(serde_json::from_value(body).ok()?),
            "unreacted" => Self::Unreacted(serde_json::from_value(body).ok()?),
            "pollVoted" => Self::PollVoted(serde_json::from_value(body).ok()?),
            // deleted は body を省略するフォークがありうる。削除イベントを
            // 落とすとゴーストノートが残るため null は空 body として扱う。
            "deleted" if body.is_null() => Self::Deleted(NoteDeletedBody { deleted_at: None }),
            "deleted" => Self::Deleted(serde_json::from_value(body).ok()?),
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NoteReactedBody {
    pub reaction: String,
    /// Custom emoji info。本家は `{ name, url }`、unicode 絵文字は null/欠落。
    /// フォークが bare string を送る揺れもここで吸収する。
    #[serde(default)]
    pub emoji: Option<ReactionEmoji>,
    #[serde(default)]
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(untagged)]
pub enum ReactionEmoji {
    Custom { name: String, url: String },
    Code(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NoteUnreactedBody {
    pub reaction: String,
    #[serde(default)]
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NotePollVotedBody {
    pub choice: i64,
    #[serde(default)]
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NoteDeletedBody {
    #[serde(default)]
    pub deleted_at: Option<String>,
}

// --- Raw Misskey API response types (for deserialization) ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawNote {
    pub id: String,
    pub created_at: String,
    pub text: Option<String>,
    pub cw: Option<String>,
    pub user: RawUser,
    #[serde(default)]
    pub visibility: String,
    #[serde(default)]
    pub emojis: HashMap<String, String>,
    #[serde(default)]
    pub reaction_emojis: HashMap<String, String>,
    #[serde(default)]
    pub reactions: HashMap<String, i64>,
    pub my_reaction: Option<String>,
    #[serde(default)]
    pub renote_count: i64,
    #[serde(default)]
    pub replies_count: i64,
    #[serde(default)]
    pub files: Vec<RawDriveFile>,
    pub poll: Option<RawPoll>,
    pub reply_id: Option<String>,
    pub renote_id: Option<String>,
    pub channel_id: Option<String>,
    pub channel: Option<Channel>,
    pub reaction_acceptance: Option<String>,
    pub uri: Option<String>,
    pub url: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub local_only: bool,
    #[serde(default)]
    pub visible_user_ids: Vec<String>,
    #[serde(default)]
    pub is_favorited: bool,
    /// packed の isHidden (followers/specified の非可視、投稿者の隠す設定、未ログイン制限)
    #[serde(default)]
    pub is_hidden: bool,
    pub reply: Option<Box<RawNote>>,
    pub renote: Option<Box<RawNote>>,
    /// Catch-all for fork-specific fields (e.g., isNoteInYamiMode)
    #[serde(flatten)]
    pub extra: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawUser {
    pub id: String,
    pub username: String,
    pub host: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub is_bot: bool,
    #[serde(default)]
    pub is_cat: bool,
    #[serde(default)]
    pub avatar_decorations: Vec<AvatarDecoration>,
    #[serde(default)]
    pub emojis: HashMap<String, String>,
    pub instance: Option<UserInstance>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawPoll {
    pub choices: Vec<RawPollChoice>,
    #[serde(default)]
    pub multiple: bool,
    pub expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawPollChoice {
    pub text: String,
    #[serde(default)]
    pub votes: i64,
    #[serde(default)]
    pub is_voted: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawDriveFile {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub url: String,
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub size: i64,
    #[serde(default)]
    pub is_sensitive: bool,
    #[serde(default)]
    pub properties: Option<RawDriveFileProperties>,
    #[serde(default)]
    pub blurhash: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawDriveFileProperties {
    #[serde(default)]
    pub width: Option<i64>,
    #[serde(default)]
    pub height: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawReactionInfo {
    pub user: RawUser,
    pub reaction: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawNotification {
    pub id: String,
    pub created_at: String,
    #[serde(rename = "type")]
    pub notification_type: String,
    pub user: Option<RawUser>,
    pub note: Option<RawNote>,
    pub reaction: Option<String>,
    pub message: Option<String>,
    pub achievement: Option<String>,
    /// Grouped reactions (for reaction:grouped type from notifications-grouped API)
    pub reactions: Option<Vec<RawReactionInfo>>,
    /// Grouped users (for renote:grouped type from notifications-grouped API)
    pub users: Option<Vec<RawUser>>,
    /// Assigned role (for roleAssigned type)
    pub role: Option<UserRole>,
    /// App notification header / body / icon (for app type)
    pub header: Option<String>,
    pub body: Option<String>,
    pub icon: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawUserRole {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub icon_url: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub display_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct RawUserField {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawUserDetail {
    pub id: String,
    pub username: String,
    pub host: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub banner_url: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub followers_count: i64,
    #[serde(default)]
    pub following_count: i64,
    #[serde(default)]
    pub notes_count: i64,
    #[serde(default)]
    pub is_bot: bool,
    #[serde(default)]
    pub is_cat: bool,
    #[serde(default)]
    pub is_following: bool,
    #[serde(default)]
    pub is_followed: bool,
    /// 鍵アカウント (フォローに承認が必要) かどうか
    #[serde(default)]
    pub is_locked: bool,
    /// 鍵アカウントへフォローリクエスト送信済みで未承認の状態
    #[serde(default)]
    pub has_pending_follow_request_from_you: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub avatar_decorations: Vec<AvatarDecoration>,
    #[serde(default)]
    pub emojis: HashMap<String, String>,
    #[serde(default)]
    pub roles: Vec<RawUserRole>,
    #[serde(default)]
    pub fields: Vec<RawUserField>,
    pub url: Option<String>,
    pub birthday: Option<String>,
    pub location: Option<String>,
    pub online_status: Option<String>,
    #[serde(default)]
    pub following_visibility: Option<String>,
    #[serde(default)]
    pub followers_visibility: Option<String>,
    pub followed_message: Option<String>,
    #[serde(default)]
    pub memo: Option<String>,
    #[serde(default)]
    pub notify: Option<String>,
    #[serde(default)]
    pub with_replies: Option<bool>,
    #[serde(default)]
    pub pinned_note_ids: Vec<String>,
    #[serde(default)]
    pub pinned_notes: Vec<RawNote>,
}

/// Misskey の `mutedWords` / `hardMutedWords` の 1 要素。
/// 文字列配列なら AND 語群（全語含むとマッチ）、文字列なら `/regex/flags` 形式の正規表現。
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(untagged)]
pub enum MutedWord {
    Group(Vec<String>),
    Pattern(String),
}

/// `i`(meDetailed) から取得する word mute 設定（read のみ、#610）。
/// soft = `mutedWords`（隠して展開可）、hard = `hardMutedWords`（完全非表示）。
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct MutedWordsResult {
    pub muted_words: Vec<MutedWord>,
    pub hard_muted_words: Vec<MutedWord>,
    /// インスタンスミュート（#613）。ミュート対象ホスト名の配列。同じ `i` から取得。
    pub muted_instances: Vec<String>,
}

#[derive(Deserialize)]
pub struct RawMiAuthResponse {
    pub ok: bool,
    pub token: Option<String>,
    pub user: Option<RawUser>,
}

// token をログ・panic メッセージに漏らさないため Debug は手書き
impl std::fmt::Debug for RawMiAuthResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RawMiAuthResponse")
            .field("ok", &self.ok)
            .field("token", &self.token.as_ref().map(|_| "<redacted>"))
            .field("user", &self.user)
            .finish()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawCreateNoteResponse {
    pub created_note: RawNote,
}

#[derive(Debug, Deserialize)]
pub struct RawEmojisResponse {
    pub emojis: Vec<RawEmoji>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawEmoji {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
}

/// Emoji info exposed to the frontend via Tauri commands.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ServerEmoji {
    pub name: String,
    pub url: String,
    pub category: Option<String>,
    pub aliases: Vec<String>,
}

impl From<RawEmoji> for ServerEmoji {
    fn from(raw: RawEmoji) -> Self {
        Self {
            name: raw.name,
            url: raw.url,
            category: raw.category,
            aliases: raw.aliases,
        }
    }
}

// --- Conversion: Raw -> Normalized ---

/// identity / is_origin / identity_trusted を (uri, server_host, id, user.host) から計算する。
fn identity_fields(
    uri: Option<&str>,
    server_host: &str,
    note_id: &str,
    user_host: Option<&str>,
) -> (String, bool, bool) {
    let identity = crate::identity::identity_of(uri, server_host, note_id);
    let ident_host = crate::identity::identity_host(&identity);
    let is_origin =
        ident_host.as_deref() == Some(crate::identity::normalize_host(server_host).as_str());
    let identity_trusted = match user_host {
        Some(h) => ident_host.as_deref() == Some(crate::identity::normalize_host(h).as_str()),
        None => true,
    };
    (identity, is_origin, identity_trusted)
}

impl NormalizedNote {
    /// identity 系フィールドを再計算する (reply / renote も再帰)。
    /// DB から読み出した旧 JSON (`_identity` 無し) の補完に使う。決定的なので
    /// 既に値がある行に適用しても同値になる。
    pub fn fill_identity(&mut self) {
        let (identity, is_origin, identity_trusted) = identity_fields(
            self.uri.as_deref(),
            &self.server_host,
            &self.id,
            self.user.host.as_deref(),
        );
        self.identity = identity;
        self.is_origin = is_origin;
        self.identity_trusted = identity_trusted;
        if let Some(r) = self.reply.as_mut() {
            r.fill_identity();
        }
        if let Some(r) = self.renote.as_mut() {
            r.fill_identity();
        }
    }
}

impl RawNote {
    pub fn normalize(self, account_id: &str, server_host: &str) -> NormalizedNote {
        let (identity, is_origin, identity_trusted) = identity_fields(
            self.uri.as_deref(),
            server_host,
            &self.id,
            self.user.host.as_deref(),
        );
        NormalizedNote {
            id: self.id,
            account_id: account_id.to_string(),
            server_host: server_host.to_string(),
            identity,
            is_origin,
            identity_trusted,
            content_hidden: self.is_hidden,
            created_at: self.created_at,
            text: self.text,
            cw: self.cw,
            user: self.user.into(),
            visibility: self.visibility,
            emojis: self.emojis,
            reaction_emojis: self.reaction_emojis,
            reactions: self.reactions,
            my_reaction: self.my_reaction,
            renote_count: self.renote_count,
            replies_count: self.replies_count,
            files: self.files.into_iter().map(Into::into).collect(),
            poll: self.poll.map(|p| NormalizedPoll {
                choices: p
                    .choices
                    .into_iter()
                    .map(|c| NormalizedPollChoice {
                        text: c.text,
                        votes: c.votes,
                        is_voted: c.is_voted,
                    })
                    .collect(),
                multiple: p.multiple,
                expires_at: p.expires_at,
            }),
            reply_id: self.reply_id,
            renote_id: self.renote_id,
            channel_id: self.channel_id,
            channel: self.channel,
            reaction_acceptance: self.reaction_acceptance,
            uri: self.uri,
            url: self.url,
            updated_at: self.updated_at,
            local_only: self.local_only,
            visible_user_ids: self.visible_user_ids,
            is_favorited: self.is_favorited,
            mode_flags: self
                .extra
                .into_iter()
                .filter(|(k, _)| k.starts_with("isNoteIn") && k.ends_with("Mode"))
                .filter_map(|(k, v)| v.as_bool().map(|b| (k, b)))
                .collect(),
            reply: self
                .reply
                .map(|r| Box::new(r.normalize(account_id, server_host))),
            renote: self
                .renote
                .map(|r| Box::new(r.normalize(account_id, server_host))),
        }
    }
}

// --- Note reaction (who reacted) ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawNoteReaction {
    pub id: String,
    pub created_at: String,
    pub user: RawUser,
    #[serde(rename = "type")]
    pub reaction_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NormalizedNoteReaction {
    pub id: String,
    pub created_at: String,
    pub user: NormalizedUser,
    #[serde(rename = "type")]
    pub reaction_type: String,
}

impl From<RawNoteReaction> for NormalizedNoteReaction {
    fn from(r: RawNoteReaction) -> Self {
        Self {
            id: r.id,
            created_at: r.created_at,
            user: r.user.into(),
            reaction_type: r.reaction_type,
        }
    }
}

impl From<RawUser> for NormalizedUser {
    fn from(user: RawUser) -> Self {
        Self {
            id: user.id,
            username: user.username,
            host: user.host,
            name: user.name,
            avatar_url: user.avatar_url,
            is_bot: user.is_bot,
            is_cat: user.is_cat,
            avatar_decorations: user.avatar_decorations,
            emojis: user.emojis,
            instance: user.instance,
        }
    }
}

impl From<RawDriveFile> for NormalizedDriveFile {
    fn from(file: RawDriveFile) -> Self {
        Self {
            id: file.id,
            name: file.name,
            file_type: file.file_type,
            url: file.url,
            thumbnail_url: file.thumbnail_url,
            size: file.size,
            is_sensitive: file.is_sensitive,
            width: file.properties.as_ref().and_then(|p| p.width),
            height: file.properties.as_ref().and_then(|p| p.height),
            blurhash: file.blurhash,
        }
    }
}

impl RawUserDetail {
    pub fn normalize(self, account_id: &str, server_host: &str) -> NormalizedUserDetail {
        NormalizedUserDetail {
            id: self.id,
            username: self.username,
            host: self.host,
            name: self.name,
            avatar_url: self.avatar_url,
            banner_url: self.banner_url,
            description: self.description,
            followers_count: self.followers_count,
            following_count: self.following_count,
            notes_count: self.notes_count,
            is_bot: self.is_bot,
            is_cat: self.is_cat,
            is_following: self.is_following,
            is_followed: self.is_followed,
            is_locked: self.is_locked,
            has_pending_follow_request_from_you: self.has_pending_follow_request_from_you,
            created_at: self.created_at,
            avatar_decorations: self.avatar_decorations,
            emojis: self.emojis,
            roles: self
                .roles
                .into_iter()
                .map(|r| UserRole {
                    id: r.id,
                    name: r.name,
                    color: r.color,
                    icon_url: r.icon_url,
                    description: r.description,
                    display_order: r.display_order,
                })
                .collect(),
            fields: self
                .fields
                .into_iter()
                .map(|f| UserField {
                    name: f.name,
                    value: f.value,
                })
                .collect(),
            url: self.url,
            birthday: self.birthday,
            location: self.location,
            online_status: self.online_status,
            following_visibility: self.following_visibility,
            followers_visibility: self.followers_visibility,
            followed_message: self.followed_message,
            memo: self.memo,
            notify: self.notify,
            with_replies: self.with_replies,
            pinned_note_ids: self.pinned_note_ids,
            pinned_notes: self
                .pinned_notes
                .into_iter()
                .map(|n| n.normalize(account_id, server_host))
                .collect(),
        }
    }
}

impl RawNotification {
    pub fn normalize(self, account_id: &str, server_host: &str) -> NormalizedNotification {
        NormalizedNotification {
            id: self.id,
            account_id: account_id.to_string(),
            server_host: server_host.to_string(),
            created_at: self.created_at,
            notification_type: self.notification_type,
            user: self.user.map(Into::into),
            note: self.note.map(|n| n.normalize(account_id, server_host)),
            reaction: self.reaction,
            message: self.message,
            achievement: self.achievement,
            reactions: self.reactions.map(|rs| {
                rs.into_iter()
                    .map(|r| ReactionInfo {
                        user: r.user.into(),
                        reaction: r.reaction,
                    })
                    .collect()
            }),
            users: self
                .users
                .map(|us| us.into_iter().map(Into::into).collect()),
            role: self.role,
            header: self.header,
            body: self.body,
            icon: self.icon,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---- NoteUpdateBody (#781) ----

    #[test]
    fn note_update_body_from_raw_reacted_parses_custom_emoji() {
        let body = json!({
            "reaction": ":ablobcat:",
            "emoji": { "name": "ablobcat", "url": "https://example.com/e.png" },
            "userId": "u1"
        });
        let parsed = NoteUpdateBody::from_raw("reacted", body).expect("should parse");
        match &parsed {
            NoteUpdateBody::Reacted(b) => {
                assert_eq!(b.reaction, ":ablobcat:");
                assert!(matches!(b.emoji, Some(ReactionEmoji::Custom { .. })));
                assert_eq!(b.user_id.as_deref(), Some("u1"));
            }
            other => panic!("expected Reacted, got {other:?}"),
        }
        // ワイヤ形は歴史的な { updateType, body } を維持する
        let wire = serde_json::to_value(&parsed).unwrap();
        assert_eq!(wire["updateType"], "reacted");
        assert_eq!(wire["body"]["reaction"], ":ablobcat:");
    }

    #[test]
    fn note_update_body_from_raw_reacted_accepts_null_and_string_emoji() {
        // unicode 絵文字: emoji は null
        let parsed =
            NoteUpdateBody::from_raw("reacted", json!({ "reaction": "👍", "emoji": null }))
                .expect("null emoji should parse");
        assert!(matches!(parsed, NoteUpdateBody::Reacted(ref b) if b.emoji.is_none()));

        // フォーク揺れ: emoji が bare string
        let parsed =
            NoteUpdateBody::from_raw("reacted", json!({ "reaction": "x", "emoji": "blob" }))
                .expect("string emoji should parse");
        assert!(matches!(
            parsed,
            NoteUpdateBody::Reacted(ref b)
                if matches!(b.emoji, Some(ReactionEmoji::Code(_)))
        ));
    }

    #[test]
    fn note_update_body_from_raw_deleted_and_poll_voted() {
        let deleted =
            NoteUpdateBody::from_raw("deleted", json!({ "deletedAt": "2026-01-01T00:00:00Z" }))
                .expect("deleted should parse");
        assert!(matches!(
            deleted,
            NoteUpdateBody::Deleted(ref b) if b.deleted_at.is_some()
        ));

        let voted = NoteUpdateBody::from_raw("pollVoted", json!({ "choice": 2, "userId": "u1" }))
            .expect("pollVoted should parse");
        assert!(matches!(voted, NoteUpdateBody::PollVoted(ref b) if b.choice == 2));
    }

    #[test]
    fn note_update_body_from_raw_unknown_type_is_none() {
        assert!(NoteUpdateBody::from_raw("madePrivate", json!({})).is_none());
    }

    #[test]
    fn note_update_body_from_raw_deleted_tolerates_null_body() {
        // body を省略するフォークで削除イベントを落とさない
        let parsed = NoteUpdateBody::from_raw("deleted", Value::Null)
            .expect("null body deleted should parse");
        assert!(matches!(
            parsed,
            NoteUpdateBody::Deleted(ref b) if b.deleted_at.is_none()
        ));
    }

    // ---- TimelineKey ----

    #[test]
    fn timeline_key_parse_canonical_roundtrip() {
        // parse が生成した値に対して parse(as_canonical(k)) == k が成立する
        let cases = [
            "home",
            "local",
            "social",
            "global",
            "bubble",
            "explore",
            "user-list:abc123",
            "antenna:01H8XGJWBWBAAMV5ZRWPS2N4EY", // ULID 大文字 id はそのまま保持
            "channel:xyz",
            "role:r1",
            "clip:c1",
            "user:u1",
            "mentions",
            "specified",
            "favorites",
        ];
        for s in cases {
            let key = TimelineKey::parse(s).unwrap();
            assert_eq!(key.as_canonical(), s, "canonical mismatch for {s}");
            assert_eq!(TimelineKey::parse(&key.as_canonical()).unwrap(), key);
        }
    }

    #[test]
    fn timeline_key_parse_err_conditions() {
        // 空 / 未知 prefix / 空 id / bare 予約語 / 256B 超 / 制御文字
        for s in [
            "",
            "xxx:yyy",
            "antenna:",
            "user-list",
            "antenna",
            "channel",
            "role",
            "clip",
            "user",
            ":",
            ":b",
            &"a".repeat(257),
            "home\n",
            "antenna:\x01abc",
        ] {
            assert!(TimelineKey::parse(s).is_err(), "expected Err for {s:?}");
        }
    }

    #[test]
    fn timeline_key_rejects_path_unsafe_basic_names() {
        // Basic 名は API パス (notes/{t}-timeline) へ補間されるため、リクエスト先を
        // 差し替え得る文字を含む名前は parse で弾く
        for s in [
            "../../admin/x?",
            "notes/../admin",
            "home/x",
            "home?x",
            "home#x",
            "home.x",
            "home%2f",
            "home x",
            "Home",   // 大文字は endpoint scan 由来の実キーに現れない
            "ホーム", // 非 ASCII
        ] {
            assert!(TimelineKey::parse(s).is_err(), "expected Err for {s:?}");
        }
        // 既知のフォーク TL は従来どおり通ること
        for s in ["home", "bubble", "vmimi-relay", "hanami", "yami2"] {
            assert!(TimelineKey::parse(s).is_ok(), "expected Ok for {s:?}");
        }
    }

    #[test]
    fn timeline_key_splitn_keeps_colon_in_id() {
        // 最初の ':' で分割し、id 内の ':' は保持する
        let key = TimelineKey::parse("antenna:a:b").unwrap();
        assert_eq!(
            key,
            TimelineKey::Antenna {
                antenna_id: "a:b".to_string()
            }
        );
        assert_eq!(key.as_canonical(), "antenna:a:b");
    }

    #[test]
    fn timeline_key_api_endpoint_table() {
        let ep = |s: &str| {
            let (e, p) = TimelineKey::parse(s).unwrap().api_endpoint().unwrap();
            (e.to_string(), p)
        };
        assert_eq!(ep("home"), ("notes/timeline".into(), serde_json::json!({})));
        assert_eq!(
            ep("local"),
            ("notes/local-timeline".into(), serde_json::json!({}))
        );
        assert_eq!(
            ep("social"),
            ("notes/hybrid-timeline".into(), serde_json::json!({}))
        );
        assert_eq!(
            ep("global"),
            ("notes/global-timeline".into(), serde_json::json!({}))
        );
        assert_eq!(
            ep("bubble"),
            ("notes/bubble-timeline".into(), serde_json::json!({}))
        );
        assert_eq!(
            ep("user-list:l1"),
            (
                "notes/user-list-timeline".into(),
                serde_json::json!({ "listId": "l1" })
            )
        );
        assert_eq!(
            ep("antenna:a1"),
            (
                "antennas/notes".into(),
                serde_json::json!({ "antennaId": "a1" })
            )
        );
        assert_eq!(
            ep("channel:c1"),
            (
                "channels/timeline".into(),
                serde_json::json!({ "channelId": "c1" })
            )
        );
        assert_eq!(
            ep("role:r1"),
            ("roles/notes".into(), serde_json::json!({ "roleId": "r1" }))
        );
        assert_eq!(
            ep("user:u1"),
            ("users/notes".into(), serde_json::json!({ "userId": "u1" }))
        );
        assert_eq!(
            ep("mentions"),
            ("notes/mentions".into(), serde_json::json!({}))
        );
        assert_eq!(
            ep("specified"),
            (
                "notes/mentions".into(),
                serde_json::json!({ "visibility": "specified" })
            )
        );
        assert!(TimelineKey::Favorites.api_endpoint().is_none());
        assert!(TimelineKey::parse("clip:c1")
            .unwrap()
            .api_endpoint()
            .is_none());
    }

    #[test]
    fn timeline_key_ws_channel_table() {
        let ws = |s: &str| {
            let (c, p) = TimelineKey::parse(s).unwrap().ws_channel().unwrap();
            (c.to_string(), p)
        };
        assert_eq!(ws("home"), ("homeTimeline".into(), None));
        assert_eq!(ws("local"), ("localTimeline".into(), None));
        assert_eq!(ws("social"), ("hybridTimeline".into(), None));
        assert_eq!(ws("global"), ("globalTimeline".into(), None));
        // userList: 現行の user-listTimeline 誤生成バグの解消点
        assert_eq!(
            ws("user-list:l1"),
            (
                "userList".into(),
                Some(serde_json::json!({ "listId": "l1" }))
            )
        );
        assert_eq!(
            ws("antenna:a1"),
            (
                "antenna".into(),
                Some(serde_json::json!({ "antennaId": "a1" }))
            )
        );
        assert_eq!(
            ws("channel:c1"),
            (
                "channel".into(),
                Some(serde_json::json!({ "channelId": "c1" }))
            )
        );
        assert_eq!(
            ws("role:r1"),
            (
                "roleTimeline".into(),
                Some(serde_json::json!({ "roleId": "r1" }))
            )
        );
        // kebab→lowerCamel fallback（VRTL 実例）。単語 1 語は挙動不変
        assert_eq!(ws("vmimi-relay"), ("vmimiRelayTimeline".into(), None));
        assert_eq!(ws("bubble"), ("bubbleTimeline".into(), None));
        // 購読を持たない種別は None
        for s in ["user:u1", "mentions", "specified", "favorites", "clip:c1"] {
            assert!(TimelineKey::parse(s).unwrap().ws_channel().is_none());
        }
    }

    #[test]
    fn timeline_key_serde_is_canonical_string() {
        let key = TimelineKey::parse("user-list:l1").unwrap();
        let json = serde_json::to_string(&key).unwrap();
        assert_eq!(json, "\"user-list:l1\"");
        let back: TimelineKey = serde_json::from_str(&json).unwrap();
        assert_eq!(back, key);
        // Deserialize は parse に委譲し不正キーを弾く
        assert!(serde_json::from_str::<TimelineKey>("\"user-list\"").is_err());
    }

    #[cfg(feature = "specta")]
    #[test]
    fn timeline_key_specta_inlines_to_string() {
        // TS へは常に string として inline される（tagged union にならない）
        let mut type_map = specta::TypeCollection::default();
        let dt = <TimelineKey as specta::Type>::inline(&mut type_map, specta::Generics::Definition);
        let string_dt =
            <String as specta::Type>::inline(&mut type_map, specta::Generics::Definition);
        assert_eq!(format!("{dt:?}"), format!("{string_dt:?}"));
    }

    // ---- TimelineOptions ----

    #[test]
    fn timeline_options_limit_clamp() {
        assert_eq!(TimelineOptions::new(0, None, None).limit(), 1);
        assert_eq!(TimelineOptions::new(-5, None, None).limit(), 1);
        assert_eq!(TimelineOptions::new(50, None, None).limit(), 50);
        assert_eq!(TimelineOptions::new(200, None, None).limit(), 100);
    }

    #[test]
    fn timeline_options_default() {
        let opts = TimelineOptions::default();
        assert_eq!(opts.limit(), 20);
        assert!(opts.since_id.is_none());
        assert!(opts.until_id.is_none());
        assert!(opts.filters.is_none());
        assert!(opts.list_id.is_none());
    }

    #[test]
    fn timeline_options_deserialize_missing_limit_uses_default() {
        let json = r#"{}"#;
        let opts: TimelineOptions = serde_json::from_str(json).unwrap();
        assert_eq!(opts.limit(), 20);
    }

    // ---- SearchOptions ----

    #[test]
    fn search_options_limit_clamp() {
        assert_eq!(SearchOptions::new(0).limit(), 1);
        assert_eq!(SearchOptions::new(-1).limit(), 1);
        assert_eq!(SearchOptions::new(50).limit(), 50);
        assert_eq!(SearchOptions::new(999).limit(), 100);
    }

    #[test]
    fn search_options_default() {
        let opts = SearchOptions::default();
        assert_eq!(opts.limit(), 20);
    }

    // ---- AccountPublic from Account ----

    #[test]
    fn account_public_strips_token() {
        let account = Account {
            id: "acc1".into(),
            host: "misskey.io".into(),
            token: "secret-token".into(),
            user_id: "uid1".into(),
            username: "taka".into(),
            display_name: Some("Taka".into()),
            avatar_url: Some("https://example.com/avatar.png".into()),
            software: "misskey".into(),
        };
        let public = AccountPublic::new(&account, true);
        assert_eq!(public.id, "acc1");
        assert_eq!(public.host, "misskey.io");
        assert_eq!(public.username, "taka");
        assert!(public.has_token);
        // AccountPublic has no token field
        let json = serde_json::to_value(&public).unwrap();
        assert!(json.get("token").is_none());
        assert_eq!(json.get("hasToken").unwrap(), true);
    }

    // ---- Debug redaction ----

    #[test]
    fn account_debug_redacts_token() {
        let account = Account {
            id: "acc1".into(),
            host: "misskey.io".into(),
            token: "secret-token".into(),
            user_id: "uid1".into(),
            username: "taka".into(),
            display_name: None,
            avatar_url: None,
            software: "misskey".into(),
        };
        let debug = format!("{account:?}");
        assert!(!debug.contains("secret-token"), "token leaked: {debug}");
        assert!(debug.contains("<redacted>"));
        assert!(debug.contains("misskey.io"));
    }

    #[test]
    fn auth_result_debug_redacts_token() {
        let user: NormalizedUser =
            serde_json::from_value(json!({"id": "u1", "username": "taka"})).unwrap();
        let result = AuthResult {
            token: "secret-token".into(),
            user,
        };
        let debug = format!("{result:?}");
        assert!(!debug.contains("secret-token"), "token leaked: {debug}");
        assert!(debug.contains("<redacted>"));
    }

    #[test]
    fn raw_miauth_response_debug_redacts_token() {
        let resp = RawMiAuthResponse {
            ok: true,
            token: Some("secret-token".into()),
            user: None,
        };
        let debug = format!("{resp:?}");
        assert!(!debug.contains("secret-token"), "token leaked: {debug}");
        assert!(debug.contains("<redacted>"));
    }

    #[test]
    fn account_public_without_token() {
        let account = Account {
            id: "acc2".into(),
            host: "misskey.io".into(),
            token: "".into(),
            user_id: "uid2".into(),
            username: "user2".into(),
            display_name: None,
            avatar_url: None,
            software: "misskey".into(),
        };
        let public = AccountPublic::new(&account, false);
        assert!(!public.has_token);
        let json = serde_json::to_value(&public).unwrap();
        assert_eq!(json.get("hasToken").unwrap(), false);
    }

    // ---- Raw -> Normalized conversions ----

    fn raw_user_json() -> Value {
        json!({
            "id": "u1",
            "username": "testuser",
            "host": null,
            "name": "Test User",
            "avatarUrl": "https://example.com/avatar.png",
            "isBot": false,
            "avatarDecorations": [],
            "emojis": {},
            "instance": null
        })
    }

    fn raw_note_json() -> Value {
        json!({
            "id": "n1",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "text": "Hello, world!",
            "cw": null,
            "user": raw_user_json(),
            "visibility": "public",
            "emojis": {"smile": "https://example.com/smile.png"},
            "reactionEmojis": {},
            "reactions": {":star:": 3},
            "myReaction": null,
            "renoteCount": 1,
            "repliesCount": 2,
            "files": [],
            "poll": null,
            "replyId": null,
            "renoteId": null,
            "channelId": null,
            "reactionAcceptance": null,
            "uri": null,
            "url": null,
            "updatedAt": null,
            "localOnly": false,
            "visibleUserIds": [],
            "isFavorited": false,
            "reply": null,
            "renote": null
        })
    }

    #[test]
    fn raw_note_normalize_basic() {
        let raw: RawNote = serde_json::from_value(raw_note_json()).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        assert_eq!(note.id, "n1");
        assert_eq!(note.account_id, "acc1");
        assert_eq!(note.server_host, "misskey.io");
        assert_eq!(note.text.as_deref(), Some("Hello, world!"));
        assert_eq!(note.visibility, "public");
        assert_eq!(note.user.username, "testuser");
        assert_eq!(note.renote_count, 1);
        assert_eq!(note.replies_count, 2);
        assert_eq!(*note.reactions.get(":star:").unwrap(), 3);
        assert_eq!(
            *note.emojis.get("smile").unwrap(),
            "https://example.com/smile.png"
        );
    }

    #[test]
    fn raw_note_normalize_with_poll() {
        let mut j = raw_note_json();
        j["poll"] = json!({
            "choices": [
                {"text": "Rust", "votes": 10, "isVoted": true},
                {"text": "Go", "votes": 5, "isVoted": false}
            ],
            "multiple": false,
            "expiresAt": "2025-12-31T00:00:00.000Z"
        });
        let raw: RawNote = serde_json::from_value(j).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        let poll = note.poll.unwrap();
        assert_eq!(poll.choices.len(), 2);
        assert_eq!(poll.choices[0].text, "Rust");
        assert_eq!(poll.choices[0].votes, 10);
        assert!(poll.choices[0].is_voted);
        assert!(!poll.multiple);
    }

    #[test]
    fn raw_note_normalize_with_files() {
        let mut j = raw_note_json();
        j["files"] = json!([{
            "id": "f1",
            "name": "photo.jpg",
            "type": "image/jpeg",
            "url": "https://example.com/photo.jpg",
            "thumbnailUrl": "https://example.com/photo_thumb.jpg",
            "size": 12345,
            "isSensitive": true
        }]);
        let raw: RawNote = serde_json::from_value(j).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        assert_eq!(note.files.len(), 1);
        assert_eq!(note.files[0].id, "f1");
        assert_eq!(note.files[0].file_type, "image/jpeg");
        assert!(note.files[0].is_sensitive);
        assert_eq!(note.files[0].size, 12345);
    }

    #[test]
    fn raw_note_normalize_nested_renote() {
        let mut j = raw_note_json();
        j["renoteId"] = json!("n2");
        j["renote"] = raw_note_json();
        j["renote"]["id"] = json!("n2");
        j["renote"]["text"] = json!("Original note");
        let raw: RawNote = serde_json::from_value(j).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        assert_eq!(note.renote_id.as_deref(), Some("n2"));
        let renote = note.renote.unwrap();
        assert_eq!(renote.id, "n2");
        assert_eq!(renote.text.as_deref(), Some("Original note"));
        assert_eq!(renote.account_id, "acc1");
    }

    #[test]
    fn raw_note_normalize_mode_flags() {
        let mut j = raw_note_json();
        j["isNoteInYamiMode"] = json!(true);
        j["isNoteInSuperMode"] = json!(false);
        j["unrelatedField"] = json!("ignored");
        let raw: RawNote = serde_json::from_value(j).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        assert!(*note.mode_flags.get("isNoteInYamiMode").unwrap());
        assert!(!*note.mode_flags.get("isNoteInSuperMode").unwrap());
        assert!(!note.mode_flags.contains_key("unrelatedField"));
    }

    #[test]
    fn raw_note_normalize_mode_flags_non_bool_ignored() {
        let mut j = raw_note_json();
        j["isNoteInStringMode"] = json!("not a bool");
        let raw: RawNote = serde_json::from_value(j).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        assert!(!note.mode_flags.contains_key("isNoteInStringMode"));
    }

    #[test]
    fn raw_user_to_normalized() {
        let raw: RawUser = serde_json::from_value(raw_user_json()).unwrap();
        let user: NormalizedUser = raw.into();
        assert_eq!(user.id, "u1");
        assert_eq!(user.username, "testuser");
        assert!(user.host.is_none());
        assert_eq!(user.name.as_deref(), Some("Test User"));
        assert!(!user.is_bot);
    }

    #[test]
    fn raw_user_detail_normalize() {
        let j = json!({
            "id": "u1",
            "username": "testuser",
            "host": "remote.example.com",
            "name": "Test User",
            "avatarUrl": null,
            "bannerUrl": "https://example.com/banner.png",
            "description": "Hello!",
            "followersCount": 100,
            "followingCount": 50,
            "notesCount": 200,
            "isBot": true,
            "isCat": true,
            "isFollowing": false,
            "isFollowed": false,
            "isLocked": true,
            "hasPendingFollowRequestFromYou": true,
            "createdAt": "2024-01-01T00:00:00.000Z",
            "avatarDecorations": [],
            "emojis": {},
            "roles": [{"id": "r1", "name": "Admin", "color": "#ff0000", "iconUrl": null, "description": "Administrator", "displayOrder": 1}],
            "fields": [{"name": "Website", "value": "https://example.com"}],
            "url": "https://remote.example.com/@testuser",
            "birthday": "2000-01-01",
            "location": "Tokyo",
            "onlineStatus": "online"
        });
        let raw: RawUserDetail = serde_json::from_value(j).unwrap();
        let detail = raw.normalize("acc1", "h");
        assert_eq!(detail.id, "u1");
        assert_eq!(detail.host.as_deref(), Some("remote.example.com"));
        assert!(detail.is_bot);
        assert!(detail.is_cat);
        assert!(!detail.is_following);
        assert!(detail.is_locked);
        assert!(detail.has_pending_follow_request_from_you);
        assert_eq!(detail.followers_count, 100);
        assert_eq!(detail.notes_count, 200);
        assert_eq!(detail.roles.len(), 1);
        assert_eq!(detail.roles[0].name, "Admin");
        assert_eq!(detail.fields.len(), 1);
        assert_eq!(detail.fields[0].name, "Website");
        assert_eq!(detail.birthday.as_deref(), Some("2000-01-01"));
    }

    #[test]
    fn raw_notification_normalize() {
        let j = json!({
            "id": "notif1",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "type": "reaction",
            "user": raw_user_json(),
            "note": raw_note_json(),
            "reaction": ":star:"
        });
        let raw: RawNotification = serde_json::from_value(j).unwrap();
        let notif = raw.normalize("acc1", "misskey.io");
        assert_eq!(notif.id, "notif1");
        assert_eq!(notif.account_id, "acc1");
        assert_eq!(notif.notification_type, "reaction");
        assert!(notif.user.is_some());
        assert!(notif.note.is_some());
        assert_eq!(notif.reaction.as_deref(), Some(":star:"));
    }

    #[test]
    fn raw_notification_normalize_without_user_or_note() {
        let j = json!({
            "id": "notif2",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "type": "followRequestAccepted",
            "user": null,
            "note": null,
            "reaction": null
        });
        let raw: RawNotification = serde_json::from_value(j).unwrap();
        let notif = raw.normalize("acc1", "misskey.io");
        assert!(notif.user.is_none());
        assert!(notif.note.is_none());
        assert!(notif.reaction.is_none());
    }

    // 外部アプリ (notifications/create) が飛ばす app 通知は header / body / icon を持つ
    #[test]
    fn raw_notification_normalize_app_type() {
        let j = json!({
            "id": "notif3",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "type": "app",
            "header": "Mewk | 実績解除",
            "body": "Mewkで実績を獲得しました！\n\nスケジューラー",
            "icon": "https://mewk.app/icon.png"
        });
        let raw: RawNotification = serde_json::from_value(j).unwrap();
        let notif = raw.normalize("acc1", "misskey.io");
        assert_eq!(notif.notification_type, "app");
        assert_eq!(notif.header.as_deref(), Some("Mewk | 実績解除"));
        assert_eq!(
            notif.body.as_deref(),
            Some("Mewkで実績を獲得しました！\n\nスケジューラー")
        );
        assert_eq!(notif.icon.as_deref(), Some("https://mewk.app/icon.png"));
    }

    // header / icon は nullable。body だけの app 通知でも落ちない
    #[test]
    fn raw_notification_normalize_app_type_without_header() {
        let j = json!({
            "id": "notif4",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "type": "app",
            "header": null,
            "body": "本文のみ",
            "icon": null
        });
        let raw: RawNotification = serde_json::from_value(j).unwrap();
        let notif = raw.normalize("acc1", "misskey.io");
        assert!(notif.header.is_none());
        assert_eq!(notif.body.as_deref(), Some("本文のみ"));
        assert!(notif.icon.is_none());
    }

    #[test]
    fn raw_emoji_to_server_emoji() {
        let raw = RawEmoji {
            name: "blobcat".into(),
            url: "https://example.com/blobcat.png".into(),
            category: Some("blob".into()),
            aliases: vec!["cat".into(), "neko".into()],
        };
        let emoji: ServerEmoji = raw.into();
        assert_eq!(emoji.name, "blobcat");
        assert_eq!(emoji.category.as_deref(), Some("blob"));
        assert_eq!(emoji.aliases, vec!["cat", "neko"]);
    }

    #[test]
    fn raw_drive_file_to_normalized() {
        let raw = RawDriveFile {
            id: "f1".into(),
            name: "test.png".into(),
            file_type: "image/png".into(),
            url: "https://example.com/test.png".into(),
            thumbnail_url: None,
            size: 0,
            is_sensitive: false,
            properties: Some(RawDriveFileProperties {
                width: Some(800),
                height: Some(600),
            }),
            blurhash: Some("LEHV6nWB2yk8pyo0adR*.7kCMdnj".into()),
        };
        let file: NormalizedDriveFile = raw.into();
        assert_eq!(file.id, "f1");
        assert_eq!(file.file_type, "image/png");
        assert!(file.thumbnail_url.is_none());
        assert_eq!(file.width, Some(800));
        assert_eq!(file.height, Some(600));
        assert!(file.blurhash.is_some());
    }

    #[test]
    fn raw_note_reaction_to_normalized() {
        let j = json!({
            "id": "r1",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "user": raw_user_json(),
            "type": ":star:"
        });
        let raw: RawNoteReaction = serde_json::from_value(j).unwrap();
        let reaction: NormalizedNoteReaction = raw.into();
        assert_eq!(reaction.id, "r1");
        assert_eq!(reaction.reaction_type, ":star:");
        assert_eq!(reaction.user.username, "testuser");
    }

    // ---- Deserialization edge cases ----

    #[test]
    fn deserialize_note_with_minimal_fields() {
        let j = json!({
            "id": "n1",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "text": null,
            "cw": null,
            "user": {"id": "u1", "username": "a"},
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
        });
        let raw: RawNote = serde_json::from_value(j).unwrap();
        assert_eq!(raw.visibility, "");
        assert!(raw.files.is_empty());
        assert!(raw.reactions.is_empty());
        assert_eq!(raw.renote_count, 0);
    }

    #[test]
    fn chat_message_with_null_reactions() {
        let j = json!({
            "id": "cm1",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "fromUserId": "u1",
            "fromUser": null,
            "toUserId": null,
            "toUser": null,
            "toRoomId": null,
            "toRoom": null,
            "text": "Hello",
            "fileId": null,
            "file": null,
            "isRead": null,
            "reactions": null
        });
        let msg: ChatMessage = serde_json::from_value(j).unwrap();
        assert!(msg.reactions.is_empty());
        assert_eq!(msg.text.as_deref(), Some("Hello"));
    }

    #[test]
    fn chat_message_with_reactions() {
        let j = json!({
            "id": "cm1",
            "createdAt": "2025-01-01T00:00:00.000Z",
            "fromUserId": "u1",
            "fromUser": null,
            "toUserId": null,
            "toUser": null,
            "toRoomId": null,
            "toRoom": null,
            "text": null,
            "fileId": null,
            "file": null,
            "isRead": true,
            "reactions": [{"user": null, "reaction": ":star:"}]
        });
        let msg: ChatMessage = serde_json::from_value(j).unwrap();
        assert_eq!(msg.reactions.len(), 1);
        assert_eq!(msg.reactions[0].reaction, ":star:");
    }

    #[test]
    fn normalized_note_serde_roundtrip() {
        let raw: RawNote = serde_json::from_value(raw_note_json()).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        let json = serde_json::to_string(&note).unwrap();
        let back: NormalizedNote = serde_json::from_str(&json).unwrap();
        assert_eq!(back.id, note.id);
        assert_eq!(back.account_id, note.account_id);
        assert_eq!(back.server_host, note.server_host);
    }

    #[test]
    fn create_note_params_serialize() {
        let params = CreateNoteParams {
            text: Some("test".into()),
            cw: None,
            visibility: Some("public".into()),
            local_only: Some(true),
            mode_flags: None,
            reply_id: None,
            renote_id: None,
            file_ids: None,
            poll: Some(CreateNotePoll {
                choices: vec!["A".into(), "B".into()],
                multiple: Some(false),
                expires_at: None,
            }),
            scheduled_at: None,
        };
        let json = serde_json::to_value(&params).unwrap();
        assert_eq!(json["text"], "test");
        assert_eq!(json["visibility"], "public");
        assert_eq!(json["localOnly"], true);
        assert_eq!(json["poll"]["choices"], json!(["A", "B"]));
    }

    #[test]
    fn server_detection_serde_roundtrip() {
        let det = ServerDetection {
            host: "misskey.io".into(),
            software_name: "misskey".into(),
            software_version: "2024.1.0".into(),
            software_repository: Some("https://github.com/misskey-dev/misskey".into()),
            meta_json: r#"{"iconUrl":"/icon.png"}"#.into(),
            updated_at: 1700000000,
        };
        let json = serde_json::to_string(&det).unwrap();
        assert!(json.contains("softwareName"));
        let back: ServerDetection = serde_json::from_str(&json).unwrap();
        assert_eq!(back.host, "misskey.io");
        assert_eq!(back.software_version, "2024.1.0");
    }

    // ---- identity (notedeck#1058) ----

    #[test]
    fn normalize_derives_identity_for_local_note() {
        let raw: RawNote = serde_json::from_value(raw_note_json()).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        assert_eq!(note.identity, "https://misskey.io/notes/n1");
        assert!(note.is_origin);
        assert!(note.identity_trusted);
        assert!(!note.content_hidden);
    }

    #[test]
    fn normalize_derives_identity_for_remote_note_and_checks_author_host() {
        let mut v = raw_note_json();
        v["uri"] = serde_json::json!("https://origin.example/notes/x1");
        v["user"]["host"] = serde_json::json!("origin.example");
        let note: NormalizedNote = serde_json::from_value::<RawNote>(v.clone())
            .unwrap()
            .normalize("acc1", "misskey.io");
        assert_eq!(note.identity, "https://origin.example/notes/x1");
        assert!(!note.is_origin);
        assert!(note.identity_trusted);

        // 投稿者 host と uri の host が食い違えば不整合
        v["user"]["host"] = serde_json::json!("evil.example");
        let spoofed: NormalizedNote = serde_json::from_value::<RawNote>(v)
            .unwrap()
            .normalize("acc1", "misskey.io");
        assert!(!spoofed.identity_trusted);
    }

    #[test]
    fn normalize_passes_is_hidden_through_as_content_hidden() {
        let mut v = raw_note_json();
        v["isHidden"] = serde_json::json!(true);
        let note = serde_json::from_value::<RawNote>(v)
            .unwrap()
            .normalize("acc1", "misskey.io");
        assert!(note.content_hidden);
        // mode_flags には混ざらない
        assert!(!note.mode_flags.contains_key("isHidden"));
    }

    #[test]
    fn normalize_recurses_identity_into_renote_and_reply() {
        let mut v = raw_note_json();
        let mut inner = raw_note_json();
        inner["id"] = serde_json::json!("inner1");
        inner["uri"] = serde_json::json!("https://origin.example/notes/inner1");
        inner["user"]["host"] = serde_json::json!("origin.example");
        v["renote"] = inner.clone();
        v["reply"] = inner;
        let note = serde_json::from_value::<RawNote>(v)
            .unwrap()
            .normalize("acc1", "misskey.io");
        let renote = note.renote.as_ref().unwrap();
        assert_eq!(renote.identity, "https://origin.example/notes/inner1");
        assert!(!renote.is_origin);
        assert_eq!(
            note.reply.as_ref().unwrap().identity,
            "https://origin.example/notes/inner1"
        );
    }

    #[test]
    fn fill_identity_recomputes_from_legacy_json() {
        let raw: RawNote = serde_json::from_value(raw_note_json()).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        let mut json: Value = serde_json::to_value(&note).unwrap();
        let obj = json.as_object_mut().unwrap();
        obj.remove("_identity");
        obj.remove("_isOrigin");
        obj.remove("_identityTrusted");
        let mut back: NormalizedNote = serde_json::from_value(json).unwrap();
        assert_eq!(back.identity, "");
        back.fill_identity();
        assert_eq!(back.identity, note.identity);
        assert_eq!(back.is_origin, note.is_origin);
        assert_eq!(back.identity_trusted, note.identity_trusted);
    }

    #[test]
    fn identity_fields_serialize_with_frontend_names() {
        let raw: RawNote = serde_json::from_value(raw_note_json()).unwrap();
        let note = raw.normalize("acc1", "misskey.io");
        let json = serde_json::to_value(&note).unwrap();
        assert_eq!(json["_identity"], "https://misskey.io/notes/n1");
        assert_eq!(json["_isOrigin"], true);
        assert_eq!(json["_identityTrusted"], true);
        assert_eq!(json["contentHidden"], false);
    }
}
