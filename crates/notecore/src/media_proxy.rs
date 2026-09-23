//! リモートメディア (画像・効果音) を取り込むプロキシの共通ロジック。
//!
//! 配信の口は HTTP API `/proxy/image` (port 19820) の一本 (#921 Phase 3)。
//! WebView は全プラットフォームでループバック HTTP を読む — cleartext/ATS の
//! localhost 例外は src-tauri/android/ の networkSecurityConfig と
//! src-tauri/Info.plist で許可する。以前あった custom protocol `ndmedia:` は、
//! wry Android の直列ロック ([[project_wry_android_pipe_fuse]] 相当の制約) を
//! 補う二段階配信とフロント側の自己修復機構を必要とし続けたため廃止した。
//!
//! バックエンドは ImageCache (リサイズ・ディスクキャッシュ・サーキット
//! ブレーカー・オフライン配信)。OS 通知の画像取得 (notify_media) も
//! [`ensure_media_inner`] の同じ口を使う。

use futures_util::StreamExt;

use crate::image_cache::{hex_hash, CacheEntry, ImageCache, StreamingFetchResult};

/// 変換パラメータ込みのメディアリクエスト。
/// 変換は画像にしか効かないが、効果音は変換なしで同じ経路を通る。
pub struct MediaRequest {
    pub url: String,
    /// サムネイル生成時の最大幅
    pub w: Option<u32>,
    /// サムネイル生成時の最大高さ。絵文字は横長が普通に存在する資産なので、
    /// 絵文字経路は幅ではなく高さで丸める (本家 media-proxy の `emoji=1` =
    /// 最大高さ 128px と同じ意味論、#921)。幅基準だと横長絵文字の高さが
    /// 潰れ、表示側の引き伸ばしで荒れる
    pub h: Option<u32>,
    /// 出力形式 ("webp" で変換)
    pub format: Option<String>,
    /// アニメーション (GIF / APNG / animated WebP) を 1 フレーム目の静止画に
    /// 潰す (本家 media-proxy の `static=1`)。バッテリー駆動・省電力モードで
    /// 絵文字アニメを止める用途 (#931)。静止画には何もしない
    pub static_frame: bool,
}

impl MediaRequest {
    /// 変換パラメータもキーに含める (サイズ違いを別エントリとして扱う)。
    /// `h` は指定時のみ付ける — h 導入前からある variant (アバター等の w 指定)
    /// のキーを変えると、更新直後に全端末で再変換とディスクの二重保存が走る
    pub fn cache_key(&self) -> String {
        if !self.wants_transform() {
            return self.url.clone();
        }
        let mut key = format!(
            "{}|w={}|f={}",
            self.url,
            self.w.unwrap_or(0),
            self.format.as_deref().unwrap_or("")
        );
        if let Some(h) = self.h {
            key.push_str(&format!("|h={h}"));
        }
        // static も h と同じく指定時のみ付け、既存 variant のキーを変えない
        if self.static_frame {
            key.push_str("|s=1");
        }
        key
    }

    pub fn etag(&self) -> String {
        format!("\"{}\"", hex_hash(&self.cache_key()))
    }

    pub fn wants_transform(&self) -> bool {
        self.w.is_some() || self.h.is_some() || self.format.is_some() || self.static_frame
    }
}

/// デコードを許す寸法の上限 (px/辺)。ファイルサイズ上限 (20MB) 内でも
/// 20000×20000 の PNG は RGBA 展開で 1.6GB に膨らみ、Android では malloc
/// abort がログを残さずプロセスを殺す。変換対象はサムネイル用途なので
/// これを超える原本は変換せずそのまま返す (WebView 側に委ねる)。
/// os_notify (デスクトップ通知画像の PNG 変換) も同じ上限を使う。
pub const MAX_DECODE_DIMENSION: u32 = 8192;

/// アニメーションの可能性があるか (ヘッダ走査のみ、デコードしない)。
/// 変換 (リサイズ/再エンコード) はアニメーションを 1 フレーム目に潰すため、
/// 真なら変換せず原本を素通しする。
/// - GIF: 静的判定にはブロック走査が要るため一律アニメ扱い (Misskey の
///   GIF 絵文字はほぼアニメーション)
/// - APNG: IDAT より前に現れる acTL チャンク (CRC は検証しない)
/// - WebP: ヘッダ近傍の ANIM チャンク
fn may_be_animated(data: &[u8]) -> bool {
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return true;
    }
    if data.starts_with(&[0x89, b'P', b'N', b'G']) {
        let mut pos = 8;
        while pos + 8 <= data.len() {
            let len = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]])
                as usize;
            let ctype = &data[pos + 4..pos + 8];
            if ctype == b"acTL" {
                return true;
            }
            if ctype == b"IDAT" {
                return false;
            }
            // len(4) + type(4) + data + crc(4)。len は untrusted なので
            // 32bit ターゲットでの加算オーバーフローも飽和させる
            pos = pos.saturating_add(len.saturating_add(12));
        }
        return false;
    }
    if data.len() >= 16 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        // ANIM チャンクは VP8X 直後に来るのでヘッダ近傍だけ見れば足りる
        return data[12..data.len().min(64)]
            .windows(4)
            .any(|w| w == b"ANIM");
    }
    false
}

/// ヘッダだけ読んで寸法を得る。判定できない形式は None。
fn image_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    image::ImageReader::new(std::io::Cursor::new(data))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()
}

/// Apply resize and/or format conversion to raw image bytes.
/// Returns (transformed_bytes, content_type) or None if no transform needed / failed.
///
/// `max_width` / `max_height` は「収まる箱」の指定 (アスペクト維持・拡大しない)。
/// 片方だけなら他方は無制限 — 絵文字は `max_height` のみ指定し、横長でも
/// 高さが潰れないようにする (本家 media-proxy と同じ意味論、#921)。
///
/// `static_frame` はアニメーションを 1 フレーム目に潰す指示。指定が無ければ
/// アニメーションは (他の変換指定があっても) 素通しする。
pub fn transform_image(
    data: &[u8],
    max_width: Option<u32>,
    max_height: Option<u32>,
    target_format: Option<&str>,
    static_frame: bool,
) -> Option<(Vec<u8>, String)> {
    let needs_resize = max_width.is_some() || max_height.is_some();
    let needs_webp = target_format == Some("webp");
    // 「アニメを静止させる」は動く画像にだけ意味がある変換
    let flatten = static_frame && may_be_animated(data);
    if !needs_resize && !needs_webp && !flatten {
        return None;
    }

    // アニメーションは変換で潰れるため、静止化の指示が無い限り明示 format が
    // あっても素通し (壊れた静止画を返すより原本を返す方が正しい)
    if may_be_animated(data) && !flatten {
        return None;
    }

    // リサイズだけを求められていて既に上限以下なら何もしない。縮まないのに
    // decode + 再エンコードするのは純粋な無駄で、Misskey のアバターはサーバー側で
    // 縮小済みのことが多いためこの経路が大半を占める。
    // 寸法はヘッダだけ読む (フルデコードを避ける)。
    //
    // format が明示されている場合はスキップしない。HTTP API (`/proxy/image`) は
    // 外部 principal にも開いており、webp を要求されたのに元形式を返すと契約違反。
    if target_format.is_none() && !flatten {
        if let Some((width, height)) = image_dimensions(data) {
            let fits_w = max_width.is_none_or(|w| width <= w);
            let fits_h = max_height.is_none_or(|h| height <= h);
            if fits_w && fits_h {
                return None;
            }
        }
    }

    let mut reader = image::ImageReader::new(std::io::Cursor::new(data))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_DECODE_DIMENSION);
    limits.max_image_height = Some(MAX_DECODE_DIMENSION);
    reader.limits(limits);
    let img = reader.decode().ok()?;

    let img = if needs_resize {
        let box_w = max_width.unwrap_or(u32::MAX);
        let box_h = max_height.unwrap_or(u32::MAX);
        if img.width() > box_w || img.height() > box_h {
            img.resize(box_w, box_h, image::imageops::FilterType::Triangle)
        } else {
            img
        }
    } else {
        img
    };

    // Always encode as WebP (lossless) — smaller than PNG and avoids
    // format-mismatch issues (e.g. resized JPEG re-encoded as PNG).
    let mut buf = Vec::with_capacity((data.len() / 4).max(4096));
    let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut buf);
    img.write_with_encoder(encoder).ok()?;

    Some((buf, "image/webp".to_string()))
}

/// 要求されていれば変換を適用する。変換不要・失敗時 (効果音など) は元のまま返す。
///
/// decode + WebP エンコードは端末によって CPU を数秒占有するため blocking pool
/// へ逃がす。async ワーカー上で回すと他の応答まで詰まる。
async fn apply_transform(
    data: Vec<u8>,
    content_type: String,
    req: &MediaRequest,
) -> Result<(Vec<u8>, String), String> {
    if !req.wants_transform() {
        return Ok((data, content_type));
    }
    let w = req.w;
    let h = req.h;
    let format = req.format.clone();
    let static_frame = req.static_frame;
    tokio::task::spawn_blocking(move || {
        match transform_image(&data, w, h, format.as_deref(), static_frame) {
            Some(transformed) => transformed,
            None => (data, content_type),
        }
    })
    .await
    // JoinError は closure の panic のみ (release は panic = "abort" が先に
    // 効く)。空バイト列を成功として返すと variant に永続化されて TTL の間
    // 空画像を配り続けるため、エラーとして伝播する
    .map_err(|e| format!("transform task failed: {e}"))
}

/// キャッシュエントリ (メモリ or ディスク) を変換なしでバイト列にする。
async fn entry_bytes(entry: &CacheEntry) -> Result<Vec<u8>, String> {
    match &entry.mem_bytes {
        // メモリキャッシュ側も同じ Arc を保持しているので複製は避けられない
        Some(mem) => Ok(mem.as_ref().clone()),
        None => tokio::fs::read(&entry.path)
            .await
            .map_err(|e| e.to_string()),
    }
}

/// オリジナルを (キャッシュ or 上流から) 用意し、変換を適用して cache_key で
/// 永続化し、配信可能なバイト列と content-type を返す。
/// notify_media (OS 通知の画像取得) も同じ口を使う。
pub async fn ensure_media_inner(
    cache: &ImageCache,
    req: &MediaRequest,
) -> Result<(Vec<u8>, String), String> {
    // オリジナルを取得 (キャッシュ or 上流)
    let (data, content_type) = match cache.check_cache_only(&req.url).await {
        Some(entry) => {
            let content_type = entry.content_type.clone();
            (entry_bytes(&entry).await?, content_type)
        }
        None => match cache.fetch_streaming(&req.url).await {
            Ok(StreamingFetchResult::Cached(entry)) => {
                let content_type = entry.content_type.clone();
                (entry_bytes(&entry).await?, content_type)
            }
            Ok(StreamingFetchResult::Streaming {
                byte_stream,
                content_type,
            }) => {
                let mut all = Vec::with_capacity(65_536);
                let mut stream = byte_stream;
                while let Some(chunk) = stream.next().await {
                    all.extend_from_slice(&chunk?);
                }
                (all, content_type)
            }
            Err(msg) => return Err(msg),
        },
    };

    let (bytes, content_type) = apply_transform(data, content_type, req).await?;
    // fetch_streaming の背景タスクもオリジナルを書くが、それを待たずに返すと
    // 直後の再表示・lookup が variant をミスする競合があるため、ここで確実に
    // 書き切ってから返す
    cache
        .store_variant(&req.cache_key(), bytes.clone(), &content_type)
        .await;
    Ok((bytes, content_type))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(url: &str, w: Option<u32>, h: Option<u32>, format: Option<&str>) -> MediaRequest {
        MediaRequest {
            url: url.to_string(),
            w,
            h,
            format: format.map(str::to_string),
            static_frame: false,
        }
    }

    fn gif_bytes(size: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(size, size, image::Rgba([1, 2, 3, 255]));
        let mut buf = std::io::Cursor::new(Vec::new());
        let mut enc = image::codecs::gif::GifEncoder::new(&mut buf);
        enc.encode_frame(image::Frame::new(img))
            .expect("encode gif");
        drop(enc);
        buf.into_inner()
    }

    #[test]
    fn cache_key_separates_static_frame() {
        let moving = req("https://e.com/a.gif", None, Some(128), None);
        let still = MediaRequest {
            static_frame: true,
            ..req("https://e.com/a.gif", None, Some(128), None)
        };
        assert_ne!(moving.cache_key(), still.cache_key());
        // static だけの指定でも原本とは別 variant
        let only_static = MediaRequest {
            static_frame: true,
            ..req("https://e.com/a.gif", None, None, None)
        };
        assert!(only_static.wants_transform());
        assert_ne!(only_static.cache_key(), "https://e.com/a.gif");
    }

    /// static=1 は動く画像を 1 フレーム目の静止画 (WebP) に潰す (#931)
    #[test]
    fn static_frame_flattens_animated_gif() {
        let (out, ct) =
            transform_image(&gif_bytes(100), None, Some(128), None, true).expect("should flatten");
        assert_eq!(ct, "image/webp");
        let decoded = image::load_from_memory(&out).expect("decode webp");
        assert_eq!((decoded.width(), decoded.height()), (100, 100));
        // static だけでも (h 指定なし) 静止化は走る
        assert!(transform_image(&gif_bytes(10), None, None, None, true).is_some());
    }

    /// static=1 でも静止画には手を付けない (無駄な再エンコードをしない)
    #[test]
    fn static_frame_leaves_still_images_untouched() {
        assert!(transform_image(&png_bytes(10, 10), None, None, None, true).is_none());
        // 上限以下で h 指定のみなら従来どおりスキップ
        assert!(transform_image(&png_bytes(10, 10), None, Some(128), None, true).is_none());
    }

    #[test]
    fn cache_key_separates_sizes() {
        let plain = req("https://e.com/a.png", None, None, None);
        let sized = req("https://e.com/a.png", Some(56), None, None);
        let bigger = req("https://e.com/a.png", Some(112), None, None);
        let tall = req("https://e.com/a.png", None, Some(128), None);
        assert_ne!(plain.cache_key(), sized.cache_key());
        assert_ne!(sized.cache_key(), bigger.cache_key());
        assert_ne!(sized.etag(), bigger.etag());
        assert_ne!(tall.cache_key(), plain.cache_key());
        assert_ne!(tall.cache_key(), sized.cache_key());
        assert!(!plain.wants_transform());
        assert!(tall.wants_transform());
    }

    /// h 導入前からある variant (アバター等の w 指定) のキーは変えない。
    /// 変わると更新直後に全端末で再変換 + ディスクの二重保存が走る
    #[test]
    fn cache_key_is_stable_for_width_only_requests() {
        let sized = req("https://e.com/a.png", Some(56), None, None);
        assert_eq!(sized.cache_key(), "https://e.com/a.png|w=56|f=");
    }

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([10, 20, 30, 255]));
        let mut buf = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .expect("encode png");
        buf
    }

    /// 上限以下の画像を decode + 再エンコードするのは純粋な無駄。
    /// Misskey のアバターはサーバー側で縮小済みなので、この経路が大半を占める。
    #[test]
    fn skips_transform_when_already_within_limit() {
        assert!(transform_image(&png_bytes(32, 32), Some(56), None, None, false).is_none());
        // ちょうど上限も変換しない
        assert!(transform_image(&png_bytes(56, 56), Some(56), None, None, false).is_none());
    }

    /// format を明示されたら縮まなくても変換する。HTTP API は外部にも開いて
    /// いるので、webp を要求されたのに元形式を返すのは契約違反。
    #[test]
    fn honors_explicit_format_even_when_small() {
        let (_, ct) = transform_image(&png_bytes(32, 32), Some(56), None, Some("webp"), false)
            .expect("explicit format must be honored");
        assert_eq!(ct, "image/webp");
    }

    #[test]
    fn transforms_when_wider_than_limit() {
        let (out, ct) = transform_image(&png_bytes(200, 200), Some(56), None, Some("webp"), false)
            .expect("should transform");
        assert_eq!(ct, "image/webp");
        assert!(!out.is_empty());
    }

    /// 横長絵文字の核心 (#921): h だけ指定すると幅は制限されず、アスペクト
    /// 維持で高さが h に丸まる。旧実装 (w=64 固定) は 512×128 を 64×16 に
    /// 潰していた
    #[test]
    fn height_only_resize_preserves_wide_aspect() {
        let (out, ct) = transform_image(&png_bytes(400, 100), None, Some(50), None, false)
            .expect("should transform");
        assert_eq!(ct, "image/webp");
        let img = image::load_from_memory(&out).expect("must decode");
        assert_eq!((img.width(), img.height()), (200, 50));
    }

    /// 高さが収まっている横長画像は、幅がどれだけ大きくても素通し
    /// (h 基準では幅を理由に再エンコードしない)
    #[test]
    fn skips_wide_image_when_height_within_limit() {
        assert!(transform_image(&png_bytes(400, 100), None, Some(128), None, false).is_none());
    }

    /// w と h の両指定は「収まる箱」: きつい方の辺が効く
    #[test]
    fn width_and_height_fit_within_box() {
        let (out, _) = transform_image(&png_bytes(400, 100), Some(100), Some(50), None, false)
            .expect("should transform");
        let img = image::load_from_memory(&out).expect("must decode");
        assert_eq!((img.width(), img.height()), (100, 25));
    }

    /// format 明示で変換は走っても拡大はしない (小さい原本はそのままの寸法)
    #[test]
    fn never_upscales_small_images() {
        let (out, _) = transform_image(&png_bytes(40, 10), None, Some(50), Some("webp"), false)
            .expect("explicit format must be honored");
        let img = image::load_from_memory(&out).expect("must decode");
        assert_eq!((img.width(), img.height()), (40, 10));
    }

    /// 寸法が大きすぎる画像はデコードを拒否して原本のまま返す (None)。
    /// ファイルサイズ上限 (20MB) 内でも巨大寸法 PNG は RGBA 展開でギガ単位に
    /// 膨らみ、Android では malloc abort がログを残さずプロセスを殺す。
    #[test]
    fn refuses_decode_of_oversized_dimensions() {
        // 高さ 2px なのでテスト自体のメモリは軽い
        let wide = png_bytes(MAX_DECODE_DIMENSION + 1, 2);
        assert!(transform_image(&wide, Some(56), None, Some("webp"), false).is_none());
    }

    /// アニメーションの可能性がある形式は変換で 1 フレーム目に潰れるため、
    /// 明示 format があっても素通しする (壊れた静止画を返すより原本が正しい)
    #[test]
    fn animated_formats_pass_through_untouched() {
        // GIF は静的判定にブロック走査が要るため一律素通し
        let gif = {
            let img = image::RgbaImage::from_pixel(100, 100, image::Rgba([1, 2, 3, 255]));
            let mut buf = std::io::Cursor::new(Vec::new());
            let mut enc = image::codecs::gif::GifEncoder::new(&mut buf);
            enc.encode_frame(image::Frame::new(img))
                .expect("encode gif");
            drop(enc);
            buf.into_inner()
        };
        assert!(transform_image(&gif, Some(56), None, Some("webp"), false).is_none());

        // APNG: IDAT より前の acTL チャンクで判定 (CRC は見ない)
        let mut apng = png_bytes(100, 100);
        let mut actl = Vec::new();
        actl.extend_from_slice(&8u32.to_be_bytes());
        actl.extend_from_slice(b"acTL");
        actl.extend_from_slice(&[0u8; 12]); // frames(4) + plays(4) + crc(4)
        apng.splice(33..33, actl); // IHDR 直後 (8 sig + 25 IHDR chunk)
        assert!(may_be_animated(&apng));
        assert!(transform_image(&apng, Some(56), None, Some("webp"), false).is_none());

        // Animated WebP: ヘッダ近傍の ANIM チャンク
        let mut awebp = Vec::new();
        awebp.extend_from_slice(b"RIFF");
        awebp.extend_from_slice(&[0u8; 4]);
        awebp.extend_from_slice(b"WEBPVP8X");
        awebp.extend_from_slice(&[0u8; 14]);
        awebp.extend_from_slice(b"ANIM");
        assert!(may_be_animated(&awebp));
    }

    /// 静止 PNG はアニメ扱いされない (変換が生き続けること)
    #[test]
    fn static_png_is_not_animated() {
        assert!(!may_be_animated(&png_bytes(10, 10)));
    }

    /// チャンク長は untrusted な入力。u32::MAX を仕込んだ PNG でも
    /// 32bit ターゲット (armv7 Android) の加算オーバーフローで panic しない
    #[test]
    fn png_scan_survives_huge_chunk_length() {
        let mut evil = Vec::new();
        evil.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        evil.extend_from_slice(&u32::MAX.to_be_bytes());
        evil.extend_from_slice(b"IHDR");
        evil.extend_from_slice(&[0u8; 32]);
        assert!(!may_be_animated(&evil));
    }

    /// wait (ブロッキング) 経路もキャッシュ済みオリジナルから変換して
    /// variant を永続化し、バイト列を直接返すこと。これが無いと非 Android の
    /// 単一トリップ配信が表示のたびに再変換で CPU を払い続ける
    #[tokio::test]
    async fn ensure_media_inner_transforms_cached_original_and_persists_variant() {
        let dir = tempfile::tempdir().unwrap();
        let cache = crate::image_cache::ImageCache::new(dir.path());
        let url = "https://e.com/a.png";
        // オリジナルをキャッシュ済みにしておく (key == url)
        cache
            .store_variant(url, png_bytes(200, 200), "image/png")
            .await;

        let req = req("https://e.com/a.png", Some(56), None, None);
        let (bytes, content_type) = ensure_media_inner(&cache, &req)
            .await
            .expect("cached original should transform without network");
        assert_eq!(content_type, "image/webp");
        assert!(!bytes.is_empty());
        // variant がフェーズ 1 (check_cache_only) で引ける
        assert!(cache.check_cache_only(&req.cache_key()).await.is_some());
    }

    /// 効果音は変換パラメータを持たないので素通しになる
    #[test]
    fn sound_url_passes_through_without_transform() {
        let req = req(
            "https://misskey.example/client-assets/sounds/n-aec.mp3",
            None,
            None,
            None,
        );
        assert!(!req.wants_transform());
        assert_eq!(req.cache_key(), req.url);
    }
}
