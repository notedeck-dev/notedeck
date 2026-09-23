//! utility のデータ系コマンド本体 (#1106 段階 0b): CLI メタデータ / OpenAPI spec /
//! EXIF 読み取り / 画像キャッシュ統計。各関数は `&Core` と引数を取り、コマンド表から呼ばれる。

use notecli::error::NoteDeckError;

use crate::context::Core;
use crate::error::Result;

pub async fn get_cli_commands(_core: &Core) -> Result<Vec<notecli::cli::CliCommandInfo>> {
    Ok(notecli::cli::command_metadata())
}

/// 公開 HTTP API の OpenAPI spec (info.version は埋め込む側のバージョン)。
pub async fn get_openapi_spec(core: &Core) -> Result<serde_json::Value> {
    Ok(
        serde_json::to_value(crate::http_server::build_openapi(core.app_version()))
            .unwrap_or_default(),
    )
}

// --- EXIF viewer (#797) ---

/// EXIF 1 フィールド。tag はタグ名 (例: "DateTimeOriginal", "GPSLatitude")。
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExifField {
    /// IFD 名 ("primary" / "thumbnail")
    pub ifd: String,
    pub tag: String,
    pub value: String,
}

/// MakerNote 等の巨大なバイナリ値を UI 向けに切り詰める上限
const EXIF_VALUE_MAX_CHARS: usize = 200;
/// EXIF 読み取りのためにダウンロードする画像サイズの上限
const EXIF_FETCH_MAX_BYTES: usize = 64 * 1024 * 1024;

fn parse_exif_fields(buf: &[u8]) -> Result<Vec<ExifField>> {
    let exif = match exif::Reader::new().read_from_container(&mut std::io::Cursor::new(buf)) {
        Ok(exif) => exif,
        // EXIF セグメント自体が無い = メタデータなし（正常系）
        Err(exif::Error::NotFound(_)) => return Ok(Vec::new()),
        Err(e) => {
            return Err(NoteDeckError::InvalidInput(format!(
                "Failed to parse image: {e}"
            )))
        }
    };
    Ok(exif
        .fields()
        .map(|f| {
            let mut value = f.display_value().with_unit(&exif).to_string();
            if value.chars().count() > EXIF_VALUE_MAX_CHARS {
                value = value.chars().take(EXIF_VALUE_MAX_CHARS).collect::<String>() + "…";
            }
            ExifField {
                ifd: if f.ifd_num == exif::In::PRIMARY {
                    "primary".to_string()
                } else {
                    "thumbnail".to_string()
                },
                tag: f.tag.to_string(),
                value,
            }
        })
        .collect())
}

/// 画像 URL から EXIF フィールド一覧を読み取る。EXIF が無い場合は空リスト。
pub async fn read_image_exif(_core: &Core, url: String) -> Result<Vec<ExifField>> {
    if !url.starts_with("https://") {
        return Err(NoteDeckError::InvalidInput(
            "Only https URLs are allowed".to_string(),
        ));
    }

    let mut response = reqwest::get(&url)
        .await
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to download image: {e}")))?;
    if let Some(len) = response.content_length() {
        if len as usize > EXIF_FETCH_MAX_BYTES {
            return Err(NoteDeckError::InvalidInput(
                "Image is too large to inspect".to_string(),
            ));
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read image data: {e}")))?
    {
        if buf.len() + chunk.len() > EXIF_FETCH_MAX_BYTES {
            return Err(NoteDeckError::InvalidInput(
                "Image is too large to inspect".to_string(),
            ));
        }
        buf.extend_from_slice(&chunk);
    }

    parse_exif_fields(&buf)
}

/// 画像ディスクキャッシュの使用量 (#815)。設定のキャッシュ画面で表示する
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ImageCacheStats {
    pub bytes: u64,
    pub files: usize,
}

pub async fn image_cache_stats(core: &Core) -> Result<ImageCacheStats> {
    let cache = core.image_cache()?;
    let (bytes, files) = cache.disk_stats().await;
    Ok(ImageCacheStats { bytes, files })
}

/// メディアの先行取得 (絵文字辞書の到着時など)。キューに積むだけで即返る。
/// 受理した件数を返す (重複・https 以外は数えない)
pub async fn warm_media(core: &Core, urls: Vec<String>, h: Option<u32>) -> Result<u32> {
    let warmer = core.media_warmer()?;
    let reqs = urls
        .into_iter()
        .map(|url| crate::media_proxy::MediaRequest {
            url,
            w: None,
            h,
            format: None,
            static_frame: false,
        })
        .collect();
    Ok(warmer.enqueue(reqs).await as u32)
}

pub async fn clear_image_cache(core: &Core) -> Result<()> {
    let cache = core.image_cache()?;
    cache
        .clear_disk()
        .await
        .map_err(NoteDeckError::InvalidInput)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_exif_fields_reads_tiff_tags() {
        // 最小の TIFF (little endian): Make = "abc" の 1 エントリ IFD
        let buf: Vec<u8> = vec![
            0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, // II*\0, IFD offset 8
            0x01, 0x00, // entry count = 1
            0x0F, 0x01, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, // Make, ASCII, count 4
            0x61, 0x62, 0x63, 0x00, // "abc\0" (inline)
            0x00, 0x00, 0x00, 0x00, // next IFD = 0
        ];
        let fields = parse_exif_fields(&buf).unwrap();
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].tag, "Make");
        assert_eq!(fields[0].ifd, "primary");
        assert!(fields[0].value.contains("abc"));
    }

    #[test]
    fn parse_exif_fields_returns_empty_for_jpeg_without_exif() {
        // SOI + EOI のみの JPEG (EXIF セグメントなし)
        let buf: Vec<u8> = vec![0xFF, 0xD8, 0xFF, 0xD9];
        let fields = parse_exif_fields(&buf).unwrap();
        assert!(fields.is_empty());
    }

    #[test]
    fn parse_exif_fields_rejects_non_image_bytes() {
        assert!(parse_exif_fields(b"this is not an image at all").is_err());
    }
}
