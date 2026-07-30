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
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::image_cache::{hex_hash, CacheEntry, ImageCache, StreamingFetchResult};

/// 二段階配信 (フェーズ 2) の背景取得が終わったことをフロントへ知らせる。
/// mediaProxy.ts がこれを受けて該当 URL の `<img>` に再要求させる
/// (成否によらず emit する。失敗時の再要求は negative cache が 502 で
/// 受け止め、`onerror` フォールバックに繋がる)。
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, tauri_specta::Event)]
#[serde(rename_all = "camelCase")]
pub struct MediaFetched {
    pub url: String,
    pub ok: bool,
}

/// 1×1 透明 GIF。キャッシュミス時の仮応答 (フェーズ 1)。
/// 404 を返すと `<img>` の onerror が発火して MkAvatar などのフォールバック
/// (プロキシ迂回で原寸直読み) を誤爆させるため、成功扱いの透明画像で場を
/// 持たせ、取得完了イベントで差し替えさせる。
const PLACEHOLDER_GIF: &[u8] = &[
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00,
    0x00, 0xFF, 0xFF, 0xFF, 0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x01, 0x44, 0x00, 0x3B,
];

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

/// デコードを許す寸法の上限 (px/辺)。ファイルサイズ上限 (20MB) 内でも
/// 20000×20000 の PNG は RGBA 展開で 1.6GB に膨らみ、Android では malloc
/// abort がログを残さずプロセスを殺す。変換対象はサムネイル用途なので
/// これを超える原本は変換せずそのまま返す (WebView 側に委ねる)。
const MAX_DECODE_DIMENSION: u32 = 8192;

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
            pos = pos.saturating_add(12 + len); // len(4) + type(4) + data + crc(4)
        }
        return false;
    }
    if data.len() >= 16 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        // ANIM チャンクは VP8X 直後に来るのでヘッダ近傍だけ見れば足りる
        return data[12..data.len().min(64)].windows(4).any(|w| w == b"ANIM");
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

    // アニメーションは変換で潰れるため、明示 format があっても素通し
    // (壊れた静止画を返すより原本を返す方が正しい)
    if may_be_animated(data) {
        return None;
    }

    // リサイズだけを求められていて既に上限以下なら何もしない。縮まないのに
    // decode + 再エンコードするのは純粋な無駄で、Misskey のアバターはサーバー側で
    // 縮小済みのことが多いためこの経路が大半を占める。
    // 寸法はヘッダだけ読む (フルデコードを避ける)。
    //
    // format が明示されている場合はスキップしない。HTTP API (`/proxy/image`) は
    // 外部 principal にも開いており、webp を要求されたのに元形式を返すと契約違反。
    if target_format.is_none() {
        if let Some(w) = max_width {
            if let Some((width, _)) = image_dimensions(data) {
                if width <= w {
                    return None;
                }
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
///
/// decode + WebP エンコードは端末によって CPU を数秒占有するため blocking pool
/// へ逃がす。async ワーカー上で回すと他の応答 (IPC の channel-fetch を含む) まで
/// 詰まり、Android では応答締切 (RESPONSE_DEADLINE) の超過に直結する。
async fn apply_transform(
    data: Vec<u8>,
    content_type: String,
    req: &MediaRequest,
) -> (Vec<u8>, String) {
    if !req.wants_transform() {
        return (data, content_type);
    }
    let w = req.w;
    let format = req.format.clone();
    tokio::task::spawn_blocking(move || {
        match transform_image(&data, w, format.as_deref()) {
            Some(transformed) => transformed,
            None => (data, content_type),
        }
    })
    .await
    // JoinError は closure の panic のみ (release は panic = "abort" が先に効く)
    .unwrap_or_else(|_| (Vec::new(), "application/octet-stream".to_string()))
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


/// custom protocol の応答締切。
///
/// wry の Android 実装は全 custom protocol を単一の Mutex で直列処理し、
/// 各リクエストの応答を 10 秒で打ち切って `unwrap()` で panic する
/// (wry-0.54.4 src/android/mod.rs:247 の `rx.recv_timeout(MAIN_PIPE_TIMEOUT)`)。
/// `panic = "abort"` のためそのままプロセス即死になる。応答さえ返れば panic
/// しないので、どの経路でもこの締切までに必ず何かを応答する。
const RESPONSE_DEADLINE: std::time::Duration = std::time::Duration::from_secs(7);

/// custom protocol (`ndmedia:`) のハンドラ。
///
/// URL 形式はプラットフォームで割れる (macOS/iOS/Linux は
/// `ndmedia://localhost/m?...`、Windows/Android は
/// `http://ndmedia.localhost/m?...`) が、クエリの読み方は同じ。
/// フロントは `convertFileSrc('m', 'ndmedia')` で組み立てる。
///
/// 実作業は detach したタスクに任せて RESPONSE_DEADLINE で応答だけ打ち切る。
/// 途中キャンセルすると inflight 登録が宙に浮くため、作業自体は完走させる
/// (キャッシュも温まるので、フロントの再要求はヒットで返せる)。
pub async fn handle_uri_request(
    app: &AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let query_for_log = request.uri().query().unwrap_or_default().to_string();
    let app = app.clone();
    let work = tokio::spawn(async move { handle_uri_request_inner(app, request).await });
    match tokio::time::timeout(RESPONSE_DEADLINE, work).await {
        Ok(Ok(response)) => response,
        // JoinError: 実作業タスクの panic (release では panic = "abort" が先に効く)
        Ok(Err(_)) => error_response(
            tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
            "media task failed",
        ),
        Err(_) => {
            tracing::warn!(query = %query_for_log, "ndmedia: response deadline exceeded");
            error_response(
                tauri::http::StatusCode::GATEWAY_TIMEOUT,
                "media fetch deadline exceeded",
            )
        }
    }
}

async fn handle_uri_request_inner(
    app: AppHandle,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let query = request.uri().query().unwrap_or_default();
    let Some(req) = MediaRequest::from_query(query) else {
        return error_response(tauri::http::StatusCode::BAD_REQUEST, "invalid url param");
    };
    // wait=1: 上流取得を待つブロッキング応答 (上限は RESPONSE_DEADLINE)。
    // fetch()/Audio 要素のようにプレースホルダを飲み込めない消費者 (効果音) 用。
    let wait = url::form_urlencoded::parse(query.as_bytes()).any(|(k, v)| k == "wait" && v == "1");

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
    let cache = cache.inner().clone();

    // ── フェーズ 1: ローカル (メモリ/ディスク) だけで応答する ──
    // variant (変換結果) は cache_key で保存済みなので、ヒットすれば
    // 変換なしの読み出しだけで返せる。ここが応答時間の実質上限になる。
    let key = req.cache_key();
    if let Some(entry) = cache.check_cache_only(&key).await {
        return match entry_bytes(&entry).await {
            Ok(bytes) => ok_response(bytes, &entry.content_type, &etag),
            Err(msg) => {
                tracing::warn!(url = %req.url, error = %msg, "ndmedia: cache read failed");
                error_response(tauri::http::StatusCode::INTERNAL_SERVER_ERROR, &msg)
            }
        };
    }

    if wait {
        // ブロッキング経路: プレースホルダを飲み込めない消費者 (効果音の
        // fetch/Audio 要素) と、直列パイプ制約のない非 Android の単一トリップ
        // 配信用。ensure と同じ経路なので変換結果 (variant) も永続化される
        return match ensure_media_inner(&cache, &req).await {
            Ok((bytes, content_type)) => ok_response(bytes, &content_type, &etag),
            Err(msg) => {
                tracing::warn!(url = %req.url, error = %msg, "ndmedia: upstream fetch failed");
                error_response(tauri::http::StatusCode::BAD_GATEWAY, &msg)
            }
        };
    }

    // 失敗直後 (negative cache) / 既知のダウンホスト (circuit breaker) は
    // ensure を発行せず即エラー。ここで遮断しないと「失敗イベント → img
    // 再要求 → ensure → 失敗イベント」が空回りし続ける
    if cache.is_fast_fail(&req.url).await {
        return error_response(
            tauri::http::StatusCode::BAD_GATEWAY,
            "upstream recently failed",
        );
    }

    // ── フェーズ 2: 取得+変換は背景で行い、即プレースホルダを返す ──
    // wry Android は custom protocol を単一 Mutex で直列処理するため、
    // ここで上流を待つと他の全メディア + 8KB 超の IPC 応答まで道連れになる。
    // 完了は MediaFetched イベントで通知し、フロントが再要求してくる。
    if cache.begin_ensure(&key).await {
        tokio::spawn(ensure_media(app, cache, req));
    }
    placeholder_response()
}

/// 背景取得: オリジナルを (キャッシュ or 上流から) 用意し、変換を適用して
/// cache_key で保存し、完了イベントを emit する。
///
/// 変換が不要・不能でも必ず cache_key で保存する。保存しないとフェーズ 1 が
/// 永遠にミスして ensure と完了イベントを打ち続ける。
async fn ensure_media(app: AppHandle, cache: Arc<ImageCache>, req: MediaRequest) {
    let key = req.cache_key();
    let result = ensure_media_inner(&cache, &req).await;
    cache.finish_ensure(&key).await;
    if let Err(ref msg) = result {
        tracing::warn!(url = %req.url, error = %msg, "ndmedia: background fetch failed");
    }
    use tauri_specta::Event;
    MediaFetched {
        url: req.url.clone(),
        ok: result.is_ok(),
    }
    .emit(&app)
    .ok();
}

/// オリジナルを (キャッシュ or 上流から) 用意し、変換を適用して cache_key で
/// 永続化し、配信可能なバイト列と content-type を返す。
async fn ensure_media_inner(
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

    let (bytes, content_type) = if req.wants_transform() {
        apply_transform(data, content_type, req).await
    } else {
        (data, content_type)
    };
    // fetch_streaming の背景タスクもオリジナルを書くが、それを待たずに emit
    // すると再要求がミスする競合があるため、ここで確実に書き切ってから返す
    cache
        .store_variant(&req.cache_key(), bytes.clone(), &content_type)
        .await;
    Ok((bytes, content_type))
}

fn ok_response(
    bytes: Vec<u8>,
    content_type: &str,
    etag: &str,
) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::OK)
        .header("Content-Type", content_type)
        .header("Cache-Control", CACHE_CONTROL)
        .header("ETag", etag)
        // 効果音は fetch() + decodeAudioData で読むため CORS が要る。
        // img と違い ACAO が無いと access control で弾かれる。
        // custom protocol は WebView 内からしか到達できないので * で安全
        .header("Access-Control-Allow-Origin", "*")
        .body(bytes)
        .unwrap_or_else(|_| internal_error())
}

fn placeholder_response() -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(tauri::http::StatusCode::OK)
        .header("Content-Type", "image/gif")
        // 仮応答をどの層にもキャッシュさせない (本物はイベント後の再要求で返す)
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .header("X-ND-Pending", "1")
        .body(PLACEHOLDER_GIF.to_vec())
        .unwrap_or_else(|_| internal_error())
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
        assert!(transform_image(&png_bytes(32, 32), Some(56), None).is_none());
        // ちょうど上限も変換しない
        assert!(transform_image(&png_bytes(56, 56), Some(56), None).is_none());
    }

    /// format を明示されたら縮まなくても変換する。HTTP API は外部にも開いて
    /// いるので、webp を要求されたのに元形式を返すのは契約違反。
    #[test]
    fn honors_explicit_format_even_when_small() {
        let (_, ct) = transform_image(&png_bytes(32, 32), Some(56), Some("webp"))
            .expect("explicit format must be honored");
        assert_eq!(ct, "image/webp");
    }

    #[test]
    fn transforms_when_wider_than_limit() {
        let (out, ct) = transform_image(&png_bytes(200, 200), Some(56), Some("webp"))
            .expect("should transform");
        assert_eq!(ct, "image/webp");
        assert!(!out.is_empty());
    }

    /// フェーズ 1 の仮応答が本物の画像としてデコードできること
    /// (壊れたバイト列だと WebView が broken image を描いてしまう)
    #[test]
    fn placeholder_gif_is_valid_1x1() {
        let img = image::load_from_memory(PLACEHOLDER_GIF).expect("must decode");
        assert_eq!((img.width(), img.height()), (1, 1));
    }

    /// 寸法が大きすぎる画像はデコードを拒否して原本のまま返す (None)。
    /// ファイルサイズ上限 (20MB) 内でも巨大寸法 PNG は RGBA 展開でギガ単位に
    /// 膨らみ、Android では malloc abort がログを残さずプロセスを殺す。
    #[test]
    fn refuses_decode_of_oversized_dimensions() {
        // 高さ 2px なのでテスト自体のメモリは軽い
        let wide = png_bytes(MAX_DECODE_DIMENSION + 1, 2);
        assert!(transform_image(&wide, Some(56), Some("webp")).is_none());
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
            enc.encode_frame(image::Frame::new(img)).expect("encode gif");
            drop(enc);
            buf.into_inner()
        };
        assert!(transform_image(&gif, Some(56), Some("webp")).is_none());

        // APNG: IDAT より前の acTL チャンクで判定 (CRC は見ない)
        let mut apng = png_bytes(100, 100);
        let mut actl = Vec::new();
        actl.extend_from_slice(&8u32.to_be_bytes());
        actl.extend_from_slice(b"acTL");
        actl.extend_from_slice(&[0u8; 12]); // frames(4) + plays(4) + crc(4)
        apng.splice(33..33, actl); // IHDR 直後 (8 sig + 25 IHDR chunk)
        assert!(may_be_animated(&apng));
        assert!(transform_image(&apng, Some(56), Some("webp")).is_none());

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

        let req = MediaRequest::from_query("url=https%3A%2F%2Fe.com%2Fa.png&w=56")
            .expect("should parse");
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
        let req = MediaRequest::from_query(
            "url=https%3A%2F%2Fmisskey.example%2Fclient-assets%2Fsounds%2Fn-aec.mp3",
        )
        .expect("should parse");
        assert!(!req.wants_transform());
        assert_eq!(req.cache_key(), req.url);
    }
}
