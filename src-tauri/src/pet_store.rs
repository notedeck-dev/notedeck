//! petdex 形式のペットをローカルに置く (#1080)。
//!
//! ペットは設定ではなくキャッシュ: 設定 (`settings.json5` の `pet.slug`) が
//! 「どれを選んだか」を持ち、本体 (スプライトシート + メタ) はここに置く。
//! 消えても再取得できるのでバックアップ対象外 (settings_store の allowlist に
//! 入れない)。保持するのは選択中の 1 体だけで、切り替えたら前のを消す (#987)。
//!
//! Tauri に依存しない純サービス。`commands/pet.rs` が IPC アダプタ。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const PET_CACHE_DIR: &str = "pet_cache";
pub const PET_META_FILE: &str = "pet.json";
/// petdex のスプライトは 2 MB 台。異常なサイズは弾く
pub const MAX_SPRITE_BYTES: usize = 16 * 1024 * 1024;

pub const PET_COLUMNS: u32 = 8;
pub const PET_FRAME_WIDTH: u32 = 192;
pub const PET_FRAME_HEIGHT: u32 = 208;

/// petdex の解決 API (`/api/install-pet/<slug>`) とアセット CDN
pub const PETDEX_API_BASE: &str = "https://petdex.dev";
const TRUSTED_ASSET_HOSTS: &[&str] = &["assets.petdex.dev", "petdex.dev"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PetInfo {
    pub slug: String,
    pub display_name: String,
    /// 1 = 8×9 行, 2 = 8×11 行
    pub sprite_version: u8,
    pub rows: u32,
    pub width: u32,
    pub height: u32,
    /// "webp" | "png"
    pub sprite_ext: String,
}

impl PetInfo {
    pub fn sprite_file_name(&self) -> String {
        format!("spritesheet.{}", self.sprite_ext)
    }
}

/// petdex の解決 API が返すダウンロード先
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedPet {
    pub slug: String,
    pub display_name: String,
    pub spritesheet_url: String,
    pub sprite_ext: String,
}

pub fn validate_slug(slug: &str) -> Result<(), String> {
    let bytes = slug.as_bytes();
    let ok = !bytes.is_empty()
        && bytes.len() <= 63
        && bytes[0].is_ascii_lowercase() | bytes[0].is_ascii_digit()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-');
    if ok {
        Ok(())
    } else {
        Err(format!("invalid pet slug: {slug:?}"))
    }
}

/// 画像寸法から対応グリッドを判定 (petdex の sprite-atlas と同じ規則)。
/// 整数のセル境界に乗る縮小だけ許す。返り値は (version, rows)。
pub fn detect_atlas(width: u32, height: u32) -> Option<(u8, u32)> {
    if width == 0 || height == 0 {
        return None;
    }
    let canonical_width = u64::from(PET_COLUMNS * PET_FRAME_WIDTH);
    for (version, rows) in [(1u8, 9u32), (2u8, 11u32)] {
        let canonical_height = u64::from(rows * PET_FRAME_HEIGHT);
        if !width.is_multiple_of(PET_COLUMNS) || !height.is_multiple_of(rows) {
            continue;
        }
        if u64::from(width) * canonical_height != u64::from(height) * canonical_width {
            continue;
        }
        return Some((version, rows));
    }
    None
}

/// ピクセルをデコードせずヘッダから寸法を読む
pub fn sprite_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("unreadable image: {e}"))?
        .into_dimensions()
        .map_err(|e| format!("unreadable image: {e}"))
}

/// 解決 API の応答から必要な項目を取り出す。アセット URL は petdex の
/// ホストに限る (応答を信用してどこへでも取りに行かない)
pub fn parse_install_response(body: &serde_json::Value) -> Result<ResolvedPet, String> {
    if body.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let err = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(format!("petdex: {err}"));
    }
    let pet = body.get("pet").ok_or("petdex: missing pet")?;
    let field = |k: &str| -> Result<String, String> {
        pet.get(k)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| format!("petdex: missing {k}"))
    };
    let slug = field("slug")?;
    validate_slug(&slug)?;
    let spritesheet_url = field("spritesheetUrl")?;
    require_trusted_asset_url(&spritesheet_url)?;
    let sprite_ext = match field("spriteExt")?.as_str() {
        "png" => "png",
        "webp" => "webp",
        other => return Err(format!("petdex: unsupported sprite format {other:?}")),
    }
    .to_string();
    Ok(ResolvedPet {
        slug,
        display_name: field("displayName")?,
        spritesheet_url,
        sprite_ext,
    })
}

fn require_trusted_asset_url(url: &str) -> Result<(), String> {
    let rest = url
        .strip_prefix("https://")
        .ok_or_else(|| format!("petdex: asset must be https: {url}"))?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if TRUSTED_ASSET_HOSTS.contains(&host) {
        Ok(())
    } else {
        Err(format!("petdex: untrusted asset host {host:?}"))
    }
}

pub fn pet_dir(app_dir: &Path, slug: &str) -> PathBuf {
    app_dir.join(PET_CACHE_DIR).join(slug)
}

/// スプライトを検査して保存し、他の slug のキャッシュを消す
pub fn store(app_dir: &Path, resolved: &ResolvedPet, sprite: &[u8]) -> Result<PetInfo, String> {
    if sprite.len() > MAX_SPRITE_BYTES {
        return Err(format!("sprite too large: {} bytes", sprite.len()));
    }
    let (width, height) = sprite_dimensions(sprite)?;
    let (sprite_version, rows) = detect_atlas(width, height)
        .ok_or_else(|| format!("not a petdex sprite grid: {width}x{height}"))?;
    let info = PetInfo {
        slug: resolved.slug.clone(),
        display_name: resolved.display_name.clone(),
        sprite_version,
        rows,
        width,
        height,
        sprite_ext: resolved.sprite_ext.clone(),
    };
    let dir = pet_dir(app_dir, &info.slug);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(info.sprite_file_name()), sprite).map_err(|e| e.to_string())?;
    let meta = serde_json::to_vec_pretty(&info).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(PET_META_FILE), meta).map_err(|e| e.to_string())?;
    prune_except(app_dir, Some(&info.slug))?;
    Ok(info)
}

/// 保存済みのメタとスプライト本体。無ければ None
pub fn load(app_dir: &Path, slug: &str) -> Result<Option<(PetInfo, Vec<u8>)>, String> {
    validate_slug(slug)?;
    let dir = pet_dir(app_dir, slug);
    let meta = match std::fs::read(dir.join(PET_META_FILE)) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let info: PetInfo = serde_json::from_slice(&meta).map_err(|e| e.to_string())?;
    let sprite = match std::fs::read(dir.join(info.sprite_file_name())) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    Ok(Some((info, sprite)))
}

/// `keep` 以外の slug ディレクトリを消す。None で全部消す
pub fn prune_except(app_dir: &Path, keep: Option<&str>) -> Result<(), String> {
    let root = app_dir.join(PET_CACHE_DIR);
    let entries = match std::fs::read_dir(&root) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if keep.is_some_and(|k| name.to_str() == Some(k)) {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 0]));
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        buf
    }

    fn resolved(slug: &str) -> ResolvedPet {
        ResolvedPet {
            slug: slug.into(),
            display_name: slug.to_uppercase(),
            spritesheet_url: format!("https://assets.petdex.dev/curated/{slug}/sprite.png"),
            sprite_ext: "png".into(),
        }
    }

    #[test]
    fn slug_accepts_petdex_shape_only() {
        assert!(validate_slug("boba").is_ok());
        assert!(validate_slug("mecha-xiaobai").is_ok());
        assert!(validate_slug("").is_err());
        assert!(validate_slug("-x").is_err());
        assert!(validate_slug("Boba").is_err());
        assert!(validate_slug("../etc").is_err());
        assert!(validate_slug(&"a".repeat(64)).is_err());
    }

    #[test]
    fn atlas_is_detected_from_dimensions() {
        assert_eq!(detect_atlas(1536, 1872), Some((1, 9)));
        assert_eq!(detect_atlas(1536, 2288), Some((2, 11)));
        // 1/8 に縮小されたシートも整数境界に乗るので受ける
        assert_eq!(detect_atlas(192, 234), Some((1, 9)));
        assert_eq!(detect_atlas(1000, 1000), None);
        assert_eq!(detect_atlas(0, 1872), None);
    }

    #[test]
    fn dimensions_are_read_from_header() {
        assert_eq!(sprite_dimensions(&png(192, 234)).unwrap(), (192, 234));
        assert!(sprite_dimensions(b"not an image").is_err());
    }

    #[test]
    fn install_response_is_parsed_and_asset_host_is_pinned() {
        let body = serde_json::json!({
            "ok": true,
            "pet": {
                "slug": "boba",
                "displayName": "Boba",
                "petJsonUrl": "https://assets.petdex.dev/curated/boba/petjson-v2.json",
                "spritesheetUrl": "https://assets.petdex.dev/curated/boba/sprite-v2.webp",
                "spriteExt": "webp"
            }
        });
        let pet = parse_install_response(&body).unwrap();
        assert_eq!(pet.slug, "boba");
        assert_eq!(pet.display_name, "Boba");
        assert_eq!(pet.sprite_ext, "webp");

        let not_found = serde_json::json!({ "ok": false, "error": "not_found" });
        assert_eq!(
            parse_install_response(&not_found).unwrap_err(),
            "petdex: not_found"
        );

        let mut evil = body.clone();
        evil["pet"]["spritesheetUrl"] = "https://evil.example/x.webp".into();
        assert!(parse_install_response(&evil)
            .unwrap_err()
            .contains("untrusted asset host"));

        let mut http = body.clone();
        http["pet"]["spritesheetUrl"] = "http://assets.petdex.dev/x.webp".into();
        assert!(parse_install_response(&http).is_err());

        let mut gif = body;
        gif["pet"]["spriteExt"] = "gif".into();
        assert!(parse_install_response(&gif).is_err());
    }

    #[test]
    fn store_writes_meta_and_sprite_then_load_reads_them_back() {
        let tmp = tempfile::tempdir().unwrap();
        let sprite = png(192, 234);
        let info = store(tmp.path(), &resolved("boba"), &sprite).unwrap();
        assert_eq!(info.sprite_version, 1);
        assert_eq!(info.rows, 9);
        assert_eq!((info.width, info.height), (192, 234));

        let (loaded, bytes) = load(tmp.path(), "boba").unwrap().unwrap();
        assert_eq!(loaded, info);
        assert_eq!(bytes, sprite);
        assert!(load(tmp.path(), "nope").unwrap().is_none());
    }

    #[test]
    fn store_rejects_non_grid_images() {
        let tmp = tempfile::tempdir().unwrap();
        let err = store(tmp.path(), &resolved("boba"), &png(100, 100)).unwrap_err();
        assert!(err.contains("not a petdex sprite grid"), "{err}");
        assert!(!pet_dir(tmp.path(), "boba").exists());
    }

    #[test]
    fn store_keeps_only_the_selected_pet() {
        let tmp = tempfile::tempdir().unwrap();
        store(tmp.path(), &resolved("boba"), &png(192, 234)).unwrap();
        store(tmp.path(), &resolved("dalek"), &png(192, 286)).unwrap();
        assert!(!pet_dir(tmp.path(), "boba").exists());
        assert!(pet_dir(tmp.path(), "dalek").exists());

        prune_except(tmp.path(), None).unwrap();
        assert!(!pet_dir(tmp.path(), "dalek").exists());
        // キャッシュディレクトリが無くても失敗しない
        prune_except(&tmp.path().join("missing"), None).unwrap();
    }

    #[test]
    fn load_refuses_traversal_slugs() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(load(tmp.path(), "../settings").is_err());
    }
}
