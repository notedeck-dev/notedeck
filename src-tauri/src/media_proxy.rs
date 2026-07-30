//! リモートメディア (画像・効果音) を取り込むプロキシの共通ロジック。
//!
//! 経路が 2 つある:
//!   - HTTP API `/proxy/image` (port 19820) — 外部 principal にも開いている口
//!   - custom protocol `ndmedia:` — WebView 内から使う口
//!
//! モバイルの WebView は `http://127.0.0.1` への接続が制限される
//! (Android: cleartext policy / iOS: ATS) ため、以前はモバイルだけ
//! プロキシをバイパスして元 URL を直読みしていた。その結果リサイズ・
//! ディスクキャッシュ・サーキットブレーカーがモバイルでだけ効かず、
//! アバターは `proxyThumbUrl(url, 56)` を指定しても原寸が読まれていた。
//! custom protocol は WebView 自身が intercept するのでネットワーク
//! スタックを通らず、この制限を受けない。

use std::sync::Arc;

use futures_util::StreamExt;
use tauri::{AppHandle, Manager};

use crate::image_cache::{hex_hash, CacheEntry, ImageCache, StreamingFetchResult};

/// 変換パラメータ込みのメディアリクエスト。
/// 変換は画像にしか効かないが、効果音は変換なしで同じ経路を通る。
pub struct MediaRequest {
    pub url: String,
    /// サムネイル生成時の最大幅
    pub w: Option<u32>,
    /// 出力形式 ("webp" で変換)
    pub format: Option<String>,
}

impl MediaRequest {
    /// `url=...&w=...&format=...` 形式のクエリ文字列から組み立てる。
    /// `url` が無い / https 以外なら None。
    pub fn from_query(query: &str) -> Option<Self> {
        let mut url = None;
        let mut w = None;
        let mut format = None;
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            match key.as_ref() {
                "url" => url = Some(value.into_owned()),
                "w" => w = value.parse::<u32>().ok(),
                "format" => format = Some(value.into_owned()),
                _ => {}
            }
        }
        let url = url?;
        // 上流フェッチの宛先になるので scheme を絞る (ローカル資源への横取りを防ぐ)
        if !url.starts_with("https://") {
            return None;
        }
        Some(Self { url, w, format })
    }

    /// 変換パラメータもキーに含める (サイズ違いを別エントリとして扱う)
    pub fn cache_key(&self) -> String {
        match (&self.w, &self.format) {
            (None, None) => self.url.clone(),
            _ => format!(
                "{}|w={}|f={}",
                self.url,
                self.w.unwrap_or(0),
                self.format.as_deref().unwrap_or("")
            ),
        }
    }

    pub fn etag(&self) -> String {
        format!("\"{}\"", hex_hash(&self.cache_key()))
    }

    pub fn wants_transform(&self) -> bool {
        self.w.is_some() || self.format.is_some()
    }
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
pub fn transform_image(
    data: &[u8],
    max_width: Option<u32>,
    target_format: Option<&str>,
) -> Option<(Vec<u8>, String)> {
    let needs_resize = max_width.is_some();
    let needs_webp = target_format == Some("webp");
    if !needs_resize && !needs_webp {
        return None;
    }

    // 既に上限以下なら何もしない。縮まないのに decode + 再エンコードするのは
    // 純粋な無駄で、Misskey のアバターはサーバー側で縮小済みのことが多いため
    // この経路が大半を占める。寸法はヘッダだけ読む (フルデコードを避ける)。
    if let Some(w) = max_width {
        if let Some((width, _)) = image_dimensions(data) {
            if width <= w {
                return None;
            }
        }
    }

    let img = image::load_from_memory(data).ok()?;

    let img = if let Some(w) = max_width {
        if img.width() > w {
            img.resize(w, u32::MAX, image::imageops::FilterType::Triangle)
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
fn apply_transform(data: Vec<u8>, content_type: String, req: &MediaRequest) -> (Vec<u8>, String) {
    if req.wants_transform() {
        if let Some(transformed) = transform_image(&data, req.w, req.format.as_deref()) {
            return transformed;
        }
    }
    (data, content_type)
}

/// キャッシュエントリ (メモリ or ディスク) をバイト列にする。
pub async fn bytes_from_entry(
    entry: CacheEntry,
    req: &MediaRequest,
) -> Result<(Vec<u8>, String), String> {
    let data = match entry.mem_bytes {
        // メモリキャッシュ側も同じ Arc を保持しているので複製は避けられない
        Some(mem) => mem.as_ref().clone(),
        None => tokio::fs::read(&entry.path)
            .await
            .map_err(|e| e.to_string())?,
    };
    Ok(apply_transform(data, entry.content_type, req))
}

/// キャッシュ → 上流の順に解決し、変換適用済みのバイト列を返す。
pub async fn load_bytes(
    cache: &ImageCache,
    req: &MediaRequest,
) -> Result<(Vec<u8>, String), String> {
    if let Some(entry) = cache.check_cache_only(&req.url).await {
        return bytes_from_entry(entry, req).await;
    }
    match cache.fetch_streaming(&req.url).await {
        Ok(StreamingFetchResult::Cached(entry)) => bytes_from_entry(entry, req).await,
        Ok(StreamingFetchResult::Streaming {
            byte_stream,
            content_type,
        }) => {
            let mut all = Vec::with_capacity(65_536);
            let mut stream = byte_stream;
            while let Some(chunk) = stream.next().await {
                all.extend_from_slice(&chunk?);
            }
            Ok(apply_transform(all, content_type, req))
        }
        Err(msg) => Err(msg),
    }
}

/// custom protocol (`ndmedia:`) のハンドラ。
///
/// URL 形式はプラットフォームで割れる (macOS/iOS/Linux は
/// `ndmedia://localhost/m?...`、Windows/Android は
/// `http://ndmedia.localhost/m?...`) が、クエリの読み方は同じ。
/// フロントは `convertFileSrc('m', 'ndmedia')` で組み立てる。
pub async fn handle_uri_request(
    app: &AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let query = request.uri().query().unwrap_or_default();
    let Some(req) = MediaRequest::from_query(query) else {
        return error_response(tauri::http::StatusCode::BAD_REQUEST, "invalid url param");
    };

    let etag = req.etag();
    // 条件付きリクエスト: 同じ ETag を持っているなら本文を送らない
    if let Some(if_none_match) = request
        .headers()
        .get("if-none-match")
        .and_then(|v| v.to_str().ok())
    {
        if if_none_match == etag {
            return tauri::http::Response::builder()
                .status(tauri::http::StatusCode::NOT_MODIFIED)
                .header("ETag", &etag)
                .header("Cache-Control", CACHE_CONTROL)
                .header("Access-Control-Allow-Origin", "*")
                .body(Vec::new())
                .unwrap_or_else(|_| internal_error());
        }
    }

    // ImageCache は setup で manage されるため、起動直後は未登録でありうる
    let Some(cache) = app.try_state::<Arc<ImageCache>>() else {
        return error_response(
            tauri::http::StatusCode::SERVICE_UNAVAILABLE,
            "media cache not ready",
        );
    };

    match load_bytes(cache.inner(), &req).await {
        Ok((bytes, content_type)) => {
            tracing::debug!(
                url = %req.url,
                bytes = bytes.len(),
                content_type = %content_type,
                "ndmedia: served"
            );
            tauri::http::Response::builder()
                .status(tauri::http::StatusCode::OK)
                .header("Content-Type", content_type)
                .header("Cache-Control", CACHE_CONTROL)
                .header("ETag", &etag)
                // 効果音は fetch() + decodeAudioData で読むため CORS が要る。
                // img と違い ACAO が無いと access control で弾かれる。
                // custom protocol は WebView 内からしか到達できないので * で安全
                .header("Access-Control-Allow-Origin", "*")
                .body(bytes)
                .unwrap_or_else(|_| internal_error())
        }
        Err(msg) => {
            tracing::warn!(url = %req.url, error = %msg, "ndmedia: upstream fetch failed");
            error_response(tauri::http::StatusCode::BAD_GATEWAY, &msg)
        }
    }
}

const CACHE_CONTROL: &str = "public, max-age=86400, immutable";

fn error_response(status: tauri::http::StatusCode, message: &str) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        // 失敗も fetch 側で読めるようにする (CORS で潰れると原因が見えない)
        .header("Access-Control-Allow-Origin", "*")
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| internal_error())
}

fn internal_error() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::new(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_url_with_transform_params() {
        let req = MediaRequest::from_query("url=https%3A%2F%2Fexample.com%2Fa.png&w=56&format=webp")
            .expect("should parse");
        assert_eq!(req.url, "https://example.com/a.png");
        assert_eq!(req.w, Some(56));
        assert_eq!(req.format.as_deref(), Some("webp"));
        assert!(req.wants_transform());
    }

    #[test]
    fn rejects_non_https_url() {
        assert!(MediaRequest::from_query("url=http%3A%2F%2Fexample.com%2Fa.png").is_none());
        assert!(MediaRequest::from_query("url=file%3A%2F%2F%2Fetc%2Fpasswd").is_none());
        assert!(MediaRequest::from_query("w=56").is_none());
    }

    #[test]
    fn cache_key_separates_sizes() {
        let plain = MediaRequest::from_query("url=https%3A%2F%2Fe.com%2Fa.png").unwrap();
        let sized = MediaRequest::from_query("url=https%3A%2F%2Fe.com%2Fa.png&w=56").unwrap();
        let bigger = MediaRequest::from_query("url=https%3A%2F%2Fe.com%2Fa.png&w=112").unwrap();
        assert_ne!(plain.cache_key(), sized.cache_key());
        assert_ne!(sized.cache_key(), bigger.cache_key());
        assert_ne!(sized.etag(), bigger.etag());
        assert!(!plain.wants_transform());
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
        assert!(transform_image(&png_bytes(32, 32), Some(56), Some("webp")).is_none());
        // ちょうど上限も変換しない
        assert!(transform_image(&png_bytes(56, 56), Some(56), Some("webp")).is_none());
    }

    #[test]
    fn transforms_when_wider_than_limit() {
        let (out, ct) = transform_image(&png_bytes(200, 200), Some(56), Some("webp"))
            .expect("should transform");
        assert_eq!(ct, "image/webp");
        assert!(!out.is_empty());
    }

    /// 効果音は変換パラメータを持たないので素通しになる
    #[test]
    fn sound_url_passes_through_without_transform() {
        let req = MediaRequest::from_query(
            "url=https%3A%2F%2Fmisskey.example%2Fclient-assets%2Fsounds%2Fn-aec.mp3",
        )
        .expect("should parse");
        assert!(!req.wants_transform());
        assert_eq!(req.cache_key(), req.url);
    }
}
