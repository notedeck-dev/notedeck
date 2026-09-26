//! content のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use std::collections::HashMap;

use notecli::error::NoteDeckError;
use notecli::models::{GalleryPost, Page, ServerEmoji};

use crate::commands::{typed_request, validate_host};
use crate::context::Core;
use crate::credentials::{get_credentials, get_credentials_or_anon};
use crate::error::Result;

// --- Server metadata ---

// --- Roles ---

// --- Announcements ---

// --- Pages ---

/// `i/page-likes` のレスポンス 1 件分。`{ id, page: Page }` という wrapper で
/// 返るため、Rust 側で剥がして TS 側に Vec<Page> として渡す。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageLikeWrapper {
    page: Page,
}

// --- Gallery ---

// --- Flash (Play) ---

// --- Drive ---

// --- Drive: 整理（フォルダ CRUD・ファイル移動/リネーム） ---

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CreatedDriveFolder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
}

// --- Page / Flash / Note / Drive: 詳細取得 + エディタ更新 ---

// --- Generic API proxy ---

// --- Theme ---

// --- Registry CRUD ---
//
// per-account 設定 (テーマ #339 / プラグイン #340 / ウィジェット #387) で
// 本家 Misskey Web UI と互換な scope/key を読み書きするための基盤コマンド群。
// 実体は notecli の registry CRUD ラッパーを呼び出すだけの薄い Tauri command。

pub async fn api_get_endpoints(core: &Core, host: String) -> Result<Vec<String>> {
    let client = core.client().await;
    let host = validate_host(&host)?;
    client.get_endpoints(&host).await
}

pub async fn api_get_endpoint_params(
    core: &Core,
    host: String,
    endpoint: String,
) -> Result<Vec<String>> {
    let client = core.client().await;
    let host = validate_host(&host)?;
    if endpoint.len() > 100
        || !endpoint
            .chars()
            .all(|c| c.is_alphanumeric() || c == '/' || c == '-')
    {
        return Err(NoteDeckError::InvalidInput(
            "Invalid endpoint name".to_string(),
        ));
    }
    client.get_endpoint_params(&host, &endpoint).await
}

pub async fn api_get_user_policies(
    core: &Core,
    account_id: String,
) -> Result<HashMap<String, bool>> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.get_user_policies(&host, &token).await
}

pub async fn api_update_user_setting(
    core: &Core,
    account_id: String,
    key: String,
    value: bool,
) -> Result<()> {
    let (db, client) = core.ready().await;
    // Only allow mode-flag toggles (e.g., isInYamiMode, isInHanamiMode)
    if !(key.starts_with("isIn") && key.ends_with("Mode") && key.len() <= 30) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Disallowed setting key: {key}"
        )));
    }
    let (host, token) = get_credentials(&db, &account_id)?;
    client.update_user_setting(&host, &token, &key, value).await
}

/// サーバーの絵文字辞書。`refresh=false` ならディスクキャッシュ
/// (`emoji_cache_store`) が鮮度内のときネットワークも Rust 側の full-ready
/// 待ちも省いて返す — 起動直後、DB キャッシュから描いたノートの絵文字を
/// 辞書到着まで unknown で見せないため。`refresh=true` はフロントの miss
/// 駆動 / 経年リフレッシュで、必ずサーバーへ取りに行く。
pub async fn api_get_server_emojis(
    core: &Core,
    account_id: String,
    refresh: bool,
) -> Result<Vec<ServerEmoji>> {
    use crate::emoji_cache_store as cache;

    let app_dir = core.app_dir()?.to_path_buf();
    let now_ms = || {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    };

    if !refresh {
        // host の解決は DB (Stage 1) だけで済ませ、命中時は full-ready を待たない
        let host = {
            let db = core.db().await;
            get_credentials_or_anon(&db, &account_id)?.0
        };
        let dir = app_dir.clone();
        let cached = tokio::task::spawn_blocking(move || cache::read(&dir, &host))
            .await
            .ok()
            .flatten();
        if let Some(cached) = cached {
            if cache::is_fresh(cached.fetched_at_ms, now_ms()) {
                return Ok(cached.emojis);
            }
        }
    }

    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    let emojis = client.get_server_emojis(&host, &token).await?;
    let snapshot = emojis.clone();
    let fetched_at_ms = now_ms();
    tokio::task::spawn_blocking(move || {
        if let Err(e) = cache::write(&app_dir, &host, &snapshot, fetched_at_ms) {
            tracing::warn!(host, error = %e, "emoji cache write failed");
        }
    });
    Ok(emojis)
}

pub async fn api_get_pinned_reactions(core: &Core, account_id: String) -> Result<Vec<String>> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.get_pinned_reactions(&host, &token).await
}

pub async fn api_get_server_stats(core: &Core, account_id: String) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client.get_server_stats(&host, &token).await
}

pub async fn api_get_meta_detail(core: &Core, account_id: String) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client.get_meta_detail(&host, &token).await
}

pub async fn api_get_roles(core: &Core, account_id: String) -> Result<serde_json::Value> {
    let (db, client) = core.ready().await;
    // roles/list は本家 Misskey で requireCredential: true（roles/users は匿名可）。
    // 匿名トークンでは必ず 401 になるため認証必須として扱う。
    let (host, token) = get_credentials(&db, &account_id)?;
    client.get_roles(&host, &token).await
}

pub async fn api_get_role_users(
    core: &Core,
    account_id: String,
    role_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client
        .get_role_users(
            &host,
            &token,
            &role_id,
            limit.unwrap_or(30).clamp(1, 100),
            offset,
        )
        .await
}

pub async fn api_get_announcements(
    core: &Core,
    account_id: String,
    limit: Option<i64>,
    is_active: Option<bool>,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client
        .get_announcements(
            &host,
            &token,
            limit.unwrap_or(30).clamp(1, 100),
            is_active.unwrap_or(true),
        )
        .await
}

pub async fn api_read_announcement(
    core: &Core,
    account_id: String,
    announcement_id: String,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .read_announcement(&host, &token, &announcement_id)
        .await
}

pub async fn api_get_pages(
    core: &Core,
    account_id: String,
    endpoint: String,
    limit: Option<i64>,
) -> Result<Vec<Page>> {
    let (db, client) = core.ready().await;
    // Validate endpoint to only allow page-related endpoints
    let allowed = ["pages/featured", "i/pages", "i/page-likes"];
    if !allowed.contains(&endpoint.as_str()) {
        return Err(NoteDeckError::InvalidInput(
            "Invalid page endpoint".to_string(),
        ));
    }
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    let raw = client
        .get_pages(&host, &token, &endpoint, limit.unwrap_or(30).clamp(1, 100))
        .await?;
    if endpoint == "i/page-likes" {
        let likes: Vec<PageLikeWrapper> = serde_json::from_value(raw)?;
        Ok(likes.into_iter().map(|l| l.page).collect())
    } else {
        Ok(serde_json::from_value(raw)?)
    }
}

pub async fn api_get_page(
    core: &Core,
    account_id: String,
    page_id: String,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client.get_page(&host, &token, &page_id).await
}

pub async fn api_like_page(core: &Core, account_id: String, page_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.like_page(&host, &token, &page_id).await
}

pub async fn api_unlike_page(core: &Core, account_id: String, page_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.unlike_page(&host, &token, &page_id).await
}

pub async fn api_get_gallery_posts(
    core: &Core,
    account_id: String,
    limit: Option<i64>,
    until_id: Option<String>,
) -> Result<Vec<GalleryPost>> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    let raw = client
        .get_gallery_posts(
            &host,
            &token,
            limit.unwrap_or(20).clamp(1, 100),
            until_id.as_deref(),
        )
        .await?;
    Ok(serde_json::from_value(raw)?)
}

pub async fn api_like_gallery_post(core: &Core, account_id: String, post_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.like_gallery_post(&host, &token, &post_id).await
}

pub async fn api_unlike_gallery_post(
    core: &Core,
    account_id: String,
    post_id: String,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.unlike_gallery_post(&host, &token, &post_id).await
}

pub async fn api_get_flashes(
    core: &Core,
    account_id: String,
    endpoint: String,
    limit: Option<i64>,
) -> Result<serde_json::Value> {
    let (db, client) = core.ready().await;
    let allowed = ["flash/featured", "flash/my", "flash/my-likes"];
    if !allowed.contains(&endpoint.as_str()) {
        return Err(NoteDeckError::InvalidInput(
            "Invalid flash endpoint".to_string(),
        ));
    }
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .get_flashes(&host, &token, &endpoint, limit.unwrap_or(30).clamp(1, 100))
        .await
}

pub async fn api_get_flash(
    core: &Core,
    account_id: String,
    flash_id: String,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client.get_flash(&host, &token, &flash_id).await
}

pub async fn api_like_flash(core: &Core, account_id: String, flash_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.like_flash(&host, &token, &flash_id).await
}

pub async fn api_unlike_flash(core: &Core, account_id: String, flash_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.unlike_flash(&host, &token, &flash_id).await
}

pub async fn api_get_drive_folders(
    core: &Core,
    account_id: String,
    folder_id: Option<String>,
    limit: Option<i64>,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .get_drive_folders(
            &host,
            &token,
            folder_id.as_deref(),
            limit.unwrap_or(30).clamp(1, 100),
        )
        .await
}

pub async fn api_get_drive_files(
    core: &Core,
    account_id: String,
    folder_id: Option<String>,
    limit: Option<i64>,
    file_type: Option<String>,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .get_drive_files(
            &host,
            &token,
            folder_id.as_deref(),
            limit.unwrap_or(30).clamp(1, 100),
            file_type.as_deref(),
        )
        .await
}

pub async fn api_delete_drive_file(core: &Core, account_id: String, file_id: String) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.delete_drive_file(&host, &token, &file_id).await
}

pub async fn api_create_drive_folder(
    core: &Core,
    account_id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<CreatedDriveFolder> {
    let (client, host, token) = core.authed(&account_id).await?;
    let params = serde_json::json!({ "name": name, "parentId": parent_id });
    typed_request(&client, &host, &token, "drive/folders/create", params).await
}

pub async fn api_update_drive_folder(
    core: &Core,
    account_id: String,
    folder_id: String,
    name: String,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    let params = serde_json::json!({ "folderId": folder_id, "name": name });
    client
        .request(&host, &token, "drive/folders/update", params)
        .await?;
    Ok(())
}

pub async fn api_delete_drive_folder(
    core: &Core,
    account_id: String,
    folder_id: String,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    let params = serde_json::json!({ "folderId": folder_id });
    client
        .request(&host, &token, "drive/folders/delete", params)
        .await?;
    Ok(())
}

/// drive/files/update。None のフィールドは送信されず変更されない。
/// comment は空文字で null 送信 = alt テキストのクリア (#753)。
pub async fn api_update_drive_file(
    core: &Core,
    account_id: String,
    file_id: String,
    name: Option<String>,
    comment: Option<String>,
    is_sensitive: Option<bool>,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    let mut params = serde_json::json!({ "fileId": file_id });
    let obj = params.as_object_mut().expect("params is an object");
    if let Some(name) = name {
        obj.insert("name".into(), name.into());
    }
    if let Some(comment) = comment {
        let value = if comment.is_empty() {
            serde_json::Value::Null
        } else {
            comment.into()
        };
        obj.insert("comment".into(), value);
    }
    if let Some(is_sensitive) = is_sensitive {
        obj.insert("isSensitive".into(), is_sensitive.into());
    }
    client
        .request(&host, &token, "drive/files/update", params)
        .await?;
    Ok(())
}

pub async fn api_move_drive_files(
    core: &Core,
    account_id: String,
    file_ids: Vec<String>,
    folder_id: Option<String>,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    // folder_id: None は JSON null（= ルートへ移動）として送る
    let params = serde_json::json!({ "fileIds": file_ids, "folderId": folder_id });
    client
        .request(&host, &token, "drive/files/move-bulk", params)
        .await?;
    Ok(())
}

pub async fn api_update_page(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.request(&host, &token, "pages/update", params).await
}

pub async fn api_update_flash(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.request(&host, &token, "flash/update", params).await
}

pub async fn api_get_note_raw(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed_or_anon(&account_id).await?;
    client.request(&host, &token, "notes/show", params).await
}

pub async fn api_get_drive_file(
    core: &Core,
    account_id: String,
    params: serde_json::Value,
) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .request(&host, &token, "drive/files/show", params)
        .await
}

pub async fn api_request(
    core: &Core,
    account_id: String,
    endpoint: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value> {
    let (db, client) = core.ready().await;
    if endpoint.is_empty() || endpoint.len() > 100 {
        return Err(NoteDeckError::InvalidInput(
            "Invalid endpoint name".to_string(),
        ));
    }
    if !endpoint
        .chars()
        .all(|c| c.is_alphanumeric() || c == '/' || c == '-' || c == '_')
    {
        return Err(NoteDeckError::InvalidInput(
            "Invalid endpoint name".to_string(),
        ));
    }
    // 匿名フォールバック: ゲストアカウントでも public エンドポイント
    // (charts/*, meta, users/show 等) を呼び出せるようにする。
    // 認証必須エンドポイントはサーバーが 401 を返し上位でハンドリングされる。
    let (host, token) = get_credentials_or_anon(&db, &account_id)?;
    client
        .request(
            &host,
            &token,
            &endpoint,
            params.unwrap_or(serde_json::json!({})),
        )
        .await
}

/// インスタンス管理者が Branding → Default Theme で設定したテーマを取得する。
///
/// 本家 Misskey の "現在選択中のテーマ" (`darkTheme`/`lightTheme` Pref) はデバイス
/// local 設定で registry に書かれない設計のため、サーバー側からは admin が設定した
/// meta default のみを取得する。NoteDeck 内 per-column 適用 / MisStore からの
/// インストールはすべて NoteDeck 内部 state (localStorage / settings.json) で完結。
pub async fn api_fetch_account_theme(core: &Core, account_id: String) -> Result<serde_json::Value> {
    let (client, host, token) = core.authed(&account_id).await?;

    let mut result = serde_json::json!({});

    // detail: true でないと MetaLite が返り defaultDarkTheme/defaultLightTheme が
    // 含まれない (Misskey の MetaDetailed にしか乗らないフィールド)。
    let meta = client.get_meta_detail(&host, &token).await?;
    if let Some(dark) = meta.get("defaultDarkTheme") {
        result["metaDark"] = dark.clone();
    }
    if let Some(light) = meta.get("defaultLightTheme") {
        result["metaLight"] = light.clone();
    }

    Ok(result)
}

/// Get a single registry value at the given scope/key.
/// Returns None when the key does not exist (NO_SUCH_KEY) or the API errors.
pub async fn api_get_registry_value(
    core: &Core,
    account_id: String,
    scope: Vec<String>,
    key: String,
) -> Result<Option<serde_json::Value>> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.get_registry_value(&host, &token, &scope, &key).await
}

/// Set a registry value at the given scope/key.
pub async fn api_set_registry_value(
    core: &Core,
    account_id: String,
    scope: Vec<String>,
    key: String,
    value: serde_json::Value,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .set_registry_value(&host, &token, &scope, &key, value)
        .await
}

/// Remove a registry value at the given scope/key.
/// Idempotent: returns Ok even if the key did not exist.
pub async fn api_delete_registry_value(
    core: &Core,
    account_id: String,
    scope: Vec<String>,
    key: String,
) -> Result<()> {
    let (client, host, token) = core.authed(&account_id).await?;
    client
        .remove_registry_value(&host, &token, &scope, &key)
        .await
}

/// List keys in a registry scope as `{ key: type }`.
pub async fn api_list_registry_keys(
    core: &Core,
    account_id: String,
    scope: Vec<String>,
) -> Result<HashMap<String, String>> {
    let (client, host, token) = core.authed(&account_id).await?;
    client.list_registry_keys(&host, &token, &scope).await
}

#[cfg(test)]
mod tests {
    use super::CreatedDriveFolder;

    #[test]
    fn created_drive_folder_deserializes_packed_response() {
        // Misskey packed DriveFolder は他フィールドを含むが無視される
        let raw = serde_json::json!({
            "id": "abc123",
            "createdAt": "2026-07-20T00:00:00.000Z",
            "name": "新しいフォルダ",
            "parentId": "parent1",
            "foldersCount": 0,
            "filesCount": 2
        });
        let folder: CreatedDriveFolder = serde_json::from_value(raw).unwrap();
        assert_eq!(folder.id, "abc123");
        assert_eq!(folder.name, "新しいフォルダ");
        assert_eq!(folder.parent_id.as_deref(), Some("parent1"));
    }

    #[test]
    fn created_drive_folder_accepts_null_and_missing_parent() {
        let with_null = serde_json::json!({ "id": "a", "name": "n", "parentId": null });
        let folder: CreatedDriveFolder = serde_json::from_value(with_null).unwrap();
        assert!(folder.parent_id.is_none());

        let missing = serde_json::json!({ "id": "a", "name": "n" });
        let folder: CreatedDriveFolder = serde_json::from_value(missing).unwrap();
        assert!(folder.parent_id.is_none());
    }

    #[test]
    fn move_bulk_params_serialize_none_folder_as_null() {
        let folder_id: Option<String> = None;
        let params = serde_json::json!({ "fileIds": ["f1", "f2"], "folderId": folder_id });
        assert!(params["folderId"].is_null());
        assert_eq!(params["fileIds"].as_array().unwrap().len(), 2);
    }
}
