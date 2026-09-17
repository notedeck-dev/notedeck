//! ペット (#1080) の IPC アダプタ。本体は `pet_store`。
//!
//! petdex のアセット CDN は CORS ヘッダを返さないので取得はここ (Rust) で行う。

use base64::Engine;
use notecli::error::NoteDeckError;

use crate::pet_store::{self, PetInfo};

use super::Result;

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PetLoaded {
    pub info: PetInfo,
    /// `data:image/...;base64,...` — WebView 側で Blob にして CSS 背景に敷く
    pub data_url: String,
}

fn app_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    crate::app_dir::resolve_app_dir(app).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))
}

fn invalid(e: String) -> NoteDeckError {
    NoteDeckError::InvalidInput(e)
}

/// petdex から slug のペットを取得してキャッシュに置く。
/// 他の slug のキャッシュは消える (保持は選択中の 1 体だけ)。
#[tauri::command]
#[specta::specta]
pub async fn pet_install(
    app: tauri::AppHandle,
    http: tauri::State<'_, reqwest::Client>,
    slug: String,
) -> Result<PetInfo> {
    pet_store::validate_slug(&slug).map_err(invalid)?;
    let dir = app_dir(&app)?;
    let (resolved, bytes) = pet_store::fetch_from_petdex(&http, &slug)
        .await
        .map_err(invalid)?;
    tauri::async_runtime::spawn_blocking(move || pet_store::store(&dir, &resolved, &bytes))
        .await
        .map_err(|e| invalid(e.to_string()))?
        .map_err(invalid)
}

/// キャッシュ済みのペットを読む。無ければ None (呼び出し側が再取得する)
#[tauri::command]
#[specta::specta]
pub async fn pet_load(app: tauri::AppHandle, slug: String) -> Result<Option<PetLoaded>> {
    let dir = app_dir(&app)?;
    let loaded = tauri::async_runtime::spawn_blocking(move || pet_store::load(&dir, &slug))
        .await
        .map_err(|e| invalid(e.to_string()))?
        .map_err(invalid)?;
    Ok(loaded.map(|(info, bytes)| {
        let mime = if info.sprite_ext == "png" {
            "image/png"
        } else {
            "image/webp"
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        PetLoaded {
            info,
            data_url: format!("data:{mime};base64,{b64}"),
        }
    }))
}

/// キャッシュを全部消す (ペットを外したとき)
#[tauri::command]
#[specta::specta]
pub async fn pet_clear(app: tauri::AppHandle) -> Result<()> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || pet_store::prune_except(&dir, None))
        .await
        .map_err(|e| invalid(e.to_string()))?
        .map_err(invalid)
}
