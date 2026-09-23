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
/// 受け付ける寸法の上限 = 正規寸法 (v2) の 2 倍。detect_atlas は比が合えば
/// どんな倍率でも通すので、デコード時のメモリを抑えるために別途上限を置く
pub const MAX_SPRITE_WIDTH: u32 = 2 * PET_COLUMNS * PET_FRAME_WIDTH;
pub const MAX_SPRITE_HEIGHT: u32 = 2 * 11 * PET_FRAME_HEIGHT;

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

/// 寸法の上限検査 (デコード前)。圧縮後のサイズ検査 (MAX_SPRITE_BYTES) とは別
pub fn check_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width > MAX_SPRITE_WIDTH || height > MAX_SPRITE_HEIGHT {
        return Err(format!(
            "sprite too large: {width}x{height} (max {MAX_SPRITE_WIDTH}x{MAX_SPRITE_HEIGHT})"
        ));
    }
    Ok(())
}

/// ピクセルをデコードせずヘッダから寸法を読む
pub fn sprite_dimensions(bytes: &[u8]) -> Result<(u32, u32), String> {
    image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("unreadable image: {e}"))?
        .into_dimensions()
        .map_err(|e| format!("unreadable image: {e}"))
}

/// 当たり判定マスクの粒度。正規コマ (192×208) を 4px ブロックで刻む
pub const HIT_BLOCK: u32 = 4;
pub const HIT_COLS: u32 = PET_FRAME_WIDTH / HIT_BLOCK;
pub const HIT_ROWS: u32 = PET_FRAME_HEIGHT / HIT_BLOCK;
/// 不透明画素の周りを正規座標で何 px 膨らませるか。clip-path の境界線が
/// 必ず完全に透明な領域を通るようにして、縁の画素が薄くならないようにする
pub const HIT_DILATE: u32 = 1;

/// スプライト行 (= 状態) ごとの当たり判定マスク。行内の全コマで alpha > 0 の
/// 画素を HIT_DILATE だけ膨らませ、HIT_BLOCK のブロックに丸めた上位集合。
/// clip-path は描画も切るので「見える画素を必ず含む」ことが不変条件
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PetHitMask {
    pub cols: u32,
    pub rows: u32,
    /// スプライト行ごとの水平ラン。`[y, x, w, y, x, w, ...]` の平坦な三つ組
    pub runs: Vec<Vec<u32>>,
}

/// スプライトをデコードして行ごとのマスクを作る。縮小シートも正規座標に
/// 写して同じグリッドにする (寸法は detect_atlas を通った前提)
pub fn hit_mask(sprite: &[u8], sprite_rows: u32) -> Result<PetHitMask, String> {
    let img = image::load_from_memory(sprite)
        .map_err(|e| format!("undecodable sprite: {e}"))?
        .into_rgba8();
    let (width, height) = img.dimensions();
    if sprite_rows == 0 || width < PET_COLUMNS || height < sprite_rows {
        return Err(format!("not a petdex sprite grid: {width}x{height}"));
    }
    let cell_w = u64::from(width / PET_COLUMNS);
    let cell_h = u64::from(height / sprite_rows);
    // 正規座標 1px = cell_w (横) / cell_h (縦) 単位の固定小数で扱う
    let block_w = u64::from(HIT_BLOCK) * cell_w;
    let block_h = u64::from(HIT_BLOCK) * cell_h;
    let dilate_x = u64::from(HIT_DILATE) * cell_w;
    let dilate_y = u64::from(HIT_DILATE) * cell_h;
    let (cols, rows) = (HIT_COLS as usize, HIT_ROWS as usize);

    let mut runs = Vec::with_capacity(sprite_rows as usize);
    for r in 0..sprite_rows {
        let mut grid = vec![false; cols * rows];
        let y0 = u64::from(r) * cell_h;
        for ly in 0..cell_h {
            for x in 0..u64::from(width) {
                if img.get_pixel(x as u32, (y0 + ly) as u32)[3] == 0 {
                    continue;
                }
                let lx = x % cell_w;
                // 画素の占める範囲 [lx, lx+1) を正規座標に写して膨らませる
                let nx0 = (lx * u64::from(PET_FRAME_WIDTH)).saturating_sub(dilate_x);
                let nx1 = (lx + 1) * u64::from(PET_FRAME_WIDTH) + dilate_x;
                let ny0 = (ly * u64::from(PET_FRAME_HEIGHT)).saturating_sub(dilate_y);
                let ny1 = (ly + 1) * u64::from(PET_FRAME_HEIGHT) + dilate_y;
                let bx1 = (((nx1 - 1) / block_w) as usize).min(cols - 1);
                let by1 = (((ny1 - 1) / block_h) as usize).min(rows - 1);
                for by in ((ny0 / block_h) as usize)..=by1 {
                    for bx in ((nx0 / block_w) as usize)..=bx1 {
                        grid[by * cols + bx] = true;
                    }
                }
            }
        }
        let mut row_runs = Vec::new();
        for by in 0..rows {
            let line = &grid[by * cols..(by + 1) * cols];
            let mut bx = 0;
            while bx < cols {
                if !line[bx] {
                    bx += 1;
                    continue;
                }
                let start = bx;
                while bx < cols && line[bx] {
                    bx += 1;
                }
                row_runs.extend([by as u32, start as u32, (bx - start) as u32]);
            }
        }
        runs.push(row_runs);
    }
    Ok(PetHitMask {
        cols: HIT_COLS,
        rows: HIT_ROWS,
        runs,
    })
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

/// petdex から slug のペットを解決して本体を取る。本文は受信しながら
/// MAX_SPRITE_BYTES で打ち切る (Content-Length は無い・嘘をつくことがある)
pub async fn fetch_from_petdex(
    http: &reqwest::Client,
    slug: &str,
) -> Result<(ResolvedPet, Vec<u8>), String> {
    validate_slug(slug)?;
    let resolve_url = format!("{PETDEX_API_BASE}/api/install-pet/{slug}");
    let body: serde_json::Value = http
        .get(&resolve_url)
        .send()
        .await
        .map_err(|e| format!("petdex: resolve failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("petdex: resolve response invalid: {e}"))?;
    let resolved = parse_install_response(&body)?;

    let resp = http
        .get(&resolved.spritesheet_url)
        .send()
        .await
        .map_err(|e| format!("petdex: sprite download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "petdex: sprite download failed ({})",
            resp.status()
        ));
    }
    let bytes = read_bounded(resp).await?;
    Ok((resolved, bytes))
}

async fn read_bounded(resp: reqwest::Response) -> Result<Vec<u8>, String> {
    use tokio_stream::StreamExt;
    if resp
        .content_length()
        .is_some_and(|len| len > MAX_SPRITE_BYTES as u64)
    {
        return Err("petdex: sprite too large".into());
    }
    let mut buf = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("petdex: sprite download failed: {e}"))?;
        if buf.len() + chunk.len() > MAX_SPRITE_BYTES {
            return Err("petdex: sprite too large".into());
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
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
    check_dimensions(width, height)?;
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

    /// 指定画素だけ不透明 (alpha) にしたシート
    fn png_with(width: u32, height: u32, pixels: &[(u32, u32, u8)]) -> Vec<u8> {
        let mut img = image::RgbaImage::from_pixel(width, height, image::Rgba([0, 0, 0, 0]));
        for &(x, y, a) in pixels {
            img.put_pixel(x, y, image::Rgba([255, 255, 255, a]));
        }
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .unwrap();
        buf
    }

    /// ランをグリッドに展開する
    fn grid_of(mask: &PetHitMask, row: usize) -> Vec<Vec<bool>> {
        let mut g = vec![vec![false; mask.cols as usize]; mask.rows as usize];
        for run in mask.runs[row].chunks(3) {
            let (y, x, w) = (run[0] as usize, run[1] as usize, run[2] as usize);
            for cell in &mut g[y][x..x + w] {
                *cell = true;
            }
        }
        g
    }

    #[test]
    fn hit_mask_marks_blocks_around_opaque_pixel_with_dilation() {
        // 列 0 / 行 0 のコマ内 (100, 50) だけ不透明。4px ブロックで x=25 だが、
        // 1px 膨らませるので x=24 (99px) も入る。y は 49..51 が同じブロック
        let sheet = png_with(1536, 1872, &[(100, 50, 255)]);
        let mask = hit_mask(&sheet, 9).unwrap();
        assert_eq!((mask.cols, mask.rows), (48, 52));
        assert_eq!(mask.runs.len(), 9);
        assert_eq!(mask.runs[0], vec![12, 24, 2]);
        for row in 1..9 {
            assert!(mask.runs[row].is_empty(), "row {row} must be empty");
        }
    }

    #[test]
    fn hit_mask_covers_every_frame_of_the_row() {
        // 同じ行の別コマ (列 3) の画素も行のマスクに入る
        let sheet = png_with(1536, 1872, &[(4, 4, 255), (3 * 192 + 180, 200, 1)]);
        let mask = hit_mask(&sheet, 9).unwrap();
        let g = grid_of(&mask, 0);
        assert!(g[1][1]);
        assert!(g[49][44] && g[50][45]);
    }

    #[test]
    fn hit_mask_is_a_superset_of_opaque_pixels() {
        // 擬似乱数で散らした半透明込みの画素が、どれもマスクの内側にある
        let mut seed: u32 = 0x1234_5678;
        let mut next = || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            seed
        };
        let (w, h) = (1536u32, 2288u32);
        let pixels: Vec<(u32, u32, u8)> = (0..400)
            .map(|_| (next() % w, next() % h, (next() % 255 + 1) as u8))
            .collect();
        let mask = hit_mask(&png_with(w, h, &pixels), 11).unwrap();
        for &(x, y, _) in &pixels {
            let row = (y / 208) as usize;
            let (lx, ly) = (x % 192, y % 208);
            let g = grid_of(&mask, row);
            for bx in [lx.saturating_sub(1) / 4, (lx + 1) / 4] {
                for by in [ly.saturating_sub(1) / 4, (ly + 1) / 4] {
                    assert!(
                        g[by.min(51) as usize][bx.min(47) as usize],
                        "pixel ({x},{y}) block ({bx},{by}) not covered"
                    );
                }
            }
        }
    }

    #[test]
    fn hit_mask_of_scaled_sheet_matches_canonical() {
        // 正規寸法で列 2 / 行 3 に置いた矩形と、半分に縮小したシートの同じ矩形
        let mut canon = Vec::new();
        let mut half = Vec::new();
        for x in 40..80 {
            for y in 60..100 {
                canon.push((2 * 192 + x, 3 * 208 + y, 255));
            }
        }
        for x in 20..40 {
            for y in 30..50 {
                half.push((2 * 96 + x, 3 * 104 + y, 255));
            }
        }
        let a = hit_mask(&png_with(1536, 1872, &canon), 9).unwrap();
        let b = hit_mask(&png_with(768, 936, &half), 9).unwrap();
        assert_eq!(a.runs, b.runs);
        assert!(!a.runs[3].is_empty());
    }

    #[test]
    fn hit_mask_rejects_undecodable_bytes() {
        assert!(hit_mask(b"not an image", 9).is_err());
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
    fn oversized_dimensions_are_rejected_before_decode() {
        assert!(check_dimensions(1536, 1872).is_ok());
        assert!(check_dimensions(3072, 4576).is_ok());
        // 比は合っている (v1 の 3 倍) が上限を超える
        assert_eq!(detect_atlas(4608, 5616), Some((1, 9)));
        assert!(check_dimensions(4608, 5616).is_err());
        assert!(check_dimensions(1536, 4577).is_err());
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
