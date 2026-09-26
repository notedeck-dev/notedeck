//! pet のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

//! ペット (#1080) の IPC アダプタ。本体は `pet_store`。
//!
//! petdex のアセット CDN は CORS ヘッダを返さないので取得はここ (Rust) で行う。

use base64::Engine;
use notecli::error::NoteDeckError;

use crate::pet_store::{self, PetHitMask, PetInfo};

use crate::context::Core;
use crate::error::Result;

#[derive(serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PetLoaded {
    pub info: PetInfo,
    /// `data:image/...;base64,...` — WebView 側で Blob にして CSS 背景に敷く
    pub data_url: String,
    /// 状態ごとの当たり判定 (clip-path の元)。作れなければ None = 矩形のまま
    pub hit_mask: Option<PetHitMask>,
}

fn app_dir(core: &Core) -> Result<std::path::PathBuf> {
    Ok(core.app_dir()?.to_path_buf())
}

fn invalid(e: String) -> NoteDeckError {
    NoteDeckError::InvalidInput(e)
}

/// petdex から slug のペットを取得してキャッシュに置く。
/// 他の slug のキャッシュは消える (保持は選択中の 1 体だけ)。
pub async fn pet_install(core: &Core, slug: String) -> Result<PetInfo> {
    let http = core.http()?;
    pet_store::validate_slug(&slug).map_err(invalid)?;
    let dir = app_dir(core)?;
    let (resolved, bytes) = pet_store::fetch_from_petdex(http, &slug)
        .await
        .map_err(invalid)?;
    tokio::task::spawn_blocking(move || pet_store::store(&dir, &resolved, &bytes))
        .await
        .map_err(|e| invalid(e.to_string()))?
        .map_err(invalid)
}

/// キャッシュ済みのペットを読む。無ければ None (呼び出し側が再取得する)
pub async fn pet_load(core: &Core, slug: String) -> Result<Option<PetLoaded>> {
    let dir = app_dir(core)?;
    let loaded = tokio::task::spawn_blocking(move || pet_store::load(&dir, &slug))
        .await
        .map_err(|e| invalid(e.to_string()))?
        .map_err(invalid)?;
    let Some((info, bytes)) = loaded else {
        return Ok(None);
    };
    let rows = info.rows;
    // マスク計算はブロッキングスレッドへ渡すが、本体は base64 にも使う。
    // 上限サイズのシートを複製しないよう所有権だけ共有する
    let bytes = std::sync::Arc::new(bytes);
    let mask_bytes = std::sync::Arc::clone(&bytes);
    let hit_mask = tokio::task::spawn_blocking(move || pet_store::hit_mask(&mask_bytes, rows))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r)
        .map_err(|e| tracing::warn!("[pet] hit mask unavailable, falling back to box: {e}"))
        .ok();
    let mime = if info.sprite_ext == "png" {
        "image/png"
    } else {
        "image/webp"
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes.as_slice());
    Ok(Some(PetLoaded {
        info,
        data_url: format!("data:{mime};base64,{b64}"),
        hit_mask,
    }))
}

/// キャッシュを全部消す (ペットを外したとき)
pub async fn pet_clear(core: &Core) -> Result<()> {
    let dir = app_dir(core)?;
    tokio::task::spawn_blocking(move || pet_store::prune_except(&dir, None))
        .await
        .map_err(|e| invalid(e.to_string()))?
        .map_err(invalid)
}
