//! enrichment のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

use base64::Engine;

use notecli::error::NoteDeckError;

use crate::context::Core;
use crate::credentials::get_credentials;
use crate::error::Result;

// --- OGP Preview ---

// --- Server Discovery (unauthenticated, CORS-free) ---

pub async fn fetch_ogp(
    core: &Core,
    url: String,
    account_id: Option<String>,
) -> Result<crate::ogp::OgpData> {
    let ogp_cache = core.ogp_cache()?;
    let db = core.db().await;
    if url.len() > 2048 {
        return Err(NoteDeckError::InvalidInput("URL too long".to_string()));
    }

    // With server context: plugins → server → direct HTML parse
    // Without: plugins → direct HTML parse
    let result = if let Some(ref aid) = account_id {
        if let Ok((host, token)) = get_credentials(&db, aid) {
            ogp_cache.get_ogp_via_server(&url, &host, &token).await
        } else {
            ogp_cache.get_ogp(&url).await
        }
    } else {
        ogp_cache.get_ogp(&url).await
    };

    result.map_err(|e| NoteDeckError::InvalidInput(format!("OGP: {e}")))
}

pub async fn fetch_server_meta(core: &Core, host: String) -> Result<serde_json::Value> {
    let client = core.client().await;
    client.fetch_server_meta(&host).await
}

pub async fn fetch_image_base64(core: &Core, url: String) -> Result<Option<String>> {
    let http = core.http()?;
    if !url.starts_with("https://") {
        return Err(NoteDeckError::InvalidInput(
            "Only HTTPS URLs allowed".into(),
        ));
    }
    let resp = http.get(&url).send().await.map_err(NoteDeckError::from)?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = resp.bytes().await.map_err(NoteDeckError::from)?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:{content_type};base64,{b64}")))
}

/// 画像を取得して生のバイト列で返す。手元側の「画像を保存」(保存 dialog) が呼ぶ。
/// 共有クライアント (SSRF 検証 resolver つき) を使う。
pub async fn fetch_image_bytes(core: &Core, url: String) -> Result<Vec<u8>> {
    if !url.starts_with("https://") {
        return Err(NoteDeckError::InvalidInput(
            "Only HTTPS URLs allowed".into(),
        ));
    }
    let resp = core
        .http()?
        .get(&url)
        .send()
        .await
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to download image: {e}")))?;
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read image data: {e}")))?;
    Ok(bytes.to_vec())
}
