//! リモートメディア (画像・効果音) を取り込むプロキシの共通ロジック。
//!
//! 経路が 2 つある:
//!   - HTTP API `/proxy/image` (port 19820) — 外部 principal に加え、
//!     **Android の WebView の主経路** (#921)。wry Android の custom protocol
//!     は全リクエストが単一ロックで直列化されるため、メディアはループバック
//!     HTTP に載せて WebView の並列スタックとブラウザキャッシュを使う。
//!     cleartext-to-localhost は networkSecurityConfig で許可 (src-tauri/android/)
//!   - custom protocol `ndmedia:` — デスクトップ / iOS の WebView が使う口。
//!     WebView 自身が intercept するのでネットワークスタックを通らず、
//!     iOS の ATS 制限も受けない
//!
//! どちらもバックエンドは同じ ImageCache なので、リサイズ・ディスク
//! キャッシュ・サーキットブレーカー・オフライン動作は共通。

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
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xFF, 0xFF, 0xFF, 0x21, 0xF9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2C, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x01, 0x44, 0x00, 0x3B,
];

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
}

impl MediaRequest {
    /// `url=...&w=...&format=...` 形式のクエリ文字列から組み立てる。
    /// `url` が無い / https 以外なら None。
    pub fn from_query(query: &str) -> Option<Self> {
        let mut url = None;
        let mut w = None;
        let mut h = None;
        let mut format = None;
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            match key.as_ref() {
                "url" => url = Some(value.into_owned()),
                "w" => w = value.parse::<u32>().ok(),
                "h" => h = value.parse::<u32>().ok(),
                "format" => format = Some(value.into_owned()),
                _ => {}
            }
        }
        let url = url?;
        // 上流フェッチの宛先になるので scheme を絞る (ローカル資源への横取りを防ぐ)
        if !url.starts_with("https://") {
            return None;
        }
        Some(Self { url, w, h, format })
    }

    /// 変換パラメータもキーに含める (サイズ違いを別エントリとして扱う)。
    /// `h` は指定時のみ付ける — h 導入前からある variant (アバター等の w 指定)
    /// のキーを変えると、更新直後に全端末で再変換とディスクの二重保存が走る
    pub fn cache_key(&self) -> String {
        match (&self.w, &self.h, &self.format) {
            (None, None, None) => self.url.clone(),
            _ => {
                let mut key = format!(
                    "{}|w={}|f={}",
                    self.url,
                    self.w.unwrap_or(0),
                    self.format.as_deref().unwrap_or("")
                );
                if let Some(h) = self.h {
                    key.push_str(&format!("|h={h}"));
                }
                key
            }
        }
    }

    pub fn etag(&self) -> String {
        format!("\"{}\"", hex_hash(&self.cache_key()))
    }

    pub fn wants_transform(&self) -> bool {
        self.w.is_some() || self.h.is_some() || self.format.is_some()
    }
}

/// デコードを許す寸法の上限 (px/辺)。ファイルサイズ上限 (20MB) 内でも
/// 20000×20000 の PNG は RGBA 展開で 1.6GB に膨らみ、Android では malloc
/// abort がログを残さずプロセスを殺す。変換対象はサムネイル用途なので
/// これを超える原本は変換せずそのまま返す (WebView 側に委ねる)。
/// os_notify (デスクトップ通知画像の PNG 変換) も同じ上限を使う。
pub(crate) const MAX_DECODE_DIMENSION: u32 = 8192;

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
pub fn transform_image(
    data: &[u8],
    max_width: Option<u32>,
    max_height: Option<u32>,
    target_format: Option<&str>,
) -> Option<(Vec<u8>, String)> {
    let needs_resize = max_width.is_some() || max_height.is_some();
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
/// へ逃がす。async ワーカー上で回すと他の応答 (IPC の channel-fetch を含む) まで
/// 詰まり、Android では応答締切 (RESPONSE_DEADLINE) の超過に直結する。
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
    tokio::task::spawn_blocking(
        move || match transform_image(&data, w, h, format.as_deref()) {
            Some(transformed) => transformed,
            None => (data, content_type),
        },
    )
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
    // soft=1 (wait と併用): 待ちはソフト予算までで、超過したらプレースホルダ +
    // MediaFetched の二段階配信へ降格してよい (非 Android の画像用)。
    let wait = url::form_urlencoded::parse(query.as_bytes()).any(|(k, v)| k == "wait" && v == "1");
    let soft = url::form_urlencoded::parse(query.as_bytes()).any(|(k, v)| k == "soft" && v == "1");

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

    // ImageCache は Phase 1 (ウィンドウ表示前) で manage されるため通常は
    // 必ず居るが、setup 失敗系の防御として残す (#921 で Phase 2 から前倒し —
    // 以前は起動直後の絵文字要求がここで 503 になり、unknown アイコンが
    // カラム再 mount まで焼き付いていた)
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

    if wait && soft {
        return soft_wait_response(app, cache, req, &etag).await;
    }

    if wait {
        // ブロッキング経路: プレースホルダを飲み込めない消費者 (効果音の
        // fetch/Audio 要素) 用。ensure と同じ経路なので変換結果 (variant) も
        // 永続化される
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

/// ソフト予算付きブロッキング (非 Android の画像) の待ち時間上限。
///
/// キャッシュ済み・軽い取得はこの予算内に収まり単一トリップで返る。
/// セマフォ枯渇 (大量絵文字バースト・プリフェッチ競合) や遅い上流では
/// 予算超過でプレースホルダに降格し、二段階配信 (MediaFetched → 再要求)
/// が引き継ぐ。以前はここが RESPONSE_DEADLINE (7s) までのフルブロッキング
/// だったため、バースト時に `<img>` が 7 秒空白のまま → 504 → onerror の
/// unknown 固定化、という経路になっていた。
const SOFT_WAIT_BUDGET: std::time::Duration = std::time::Duration::from_millis(1500);

/// wait=1&soft=1 の応答。予算内に取得できれば本物を返し、超過したら
/// プレースホルダへ降格する。取得タスクは応答後も完走し、降格した場合
/// (受信側 drop) のみ MediaFetched を emit して `<img>` に再要求させる
/// (予算内に返せた場合の emit は余計な世代 bump = 再読込になるので送らない)。
///
/// begin_ensure の重複排除は使わない: 同一 key の同時要求は fetch_streaming
/// の inflight dedup が上流アクセスを 1 本にまとめるので、重複するのは
/// 軽い変換だけ。ここで dedup すると「後着がプレースホルダを受け取ったのに
/// 完了イベントが来ない」競合を生む。
async fn soft_wait_response(
    app: AppHandle,
    cache: Arc<ImageCache>,
    req: MediaRequest,
    etag: &str,
) -> tauri::http::Response<Vec<u8>> {
    // 失敗直後 (negative cache) / 既知のダウンホストは即エラー。hard wait と
    // 違い、ここで遮断しないと「プレースホルダ → 失敗イベント → 再要求」の
    // 空回りに合流する
    if cache.is_fast_fail(&req.url).await {
        return error_response(
            tauri::http::StatusCode::BAD_GATEWAY,
            "upstream recently failed",
        );
    }
    let (done_tx, done_rx) = tokio::sync::oneshot::channel::<Result<(Vec<u8>, String), String>>();
    tokio::spawn(async move {
        let result = ensure_media_inner(&cache, &req).await;
        if let Err(ref msg) = result {
            tracing::warn!(url = %req.url, error = %msg, "ndmedia: soft-wait fetch failed");
        }
        if let Err(result) = done_tx.send(result) {
            // 受信側が予算超過でプレースホルダに降格済み → 完了イベントで
            // 再要求させる (成否によらず emit — 失敗は negative cache が
            // 502 で受け止め、onerror → バックオフ再試行に繋がる)
            use tauri_specta::Event;
            MediaFetched {
                url: req.url.clone(),
                ok: result.is_ok(),
            }
            .emit(&app)
            .ok();
        }
    });
    match tokio::time::timeout(SOFT_WAIT_BUDGET, done_rx).await {
        Ok(Ok(Ok((bytes, content_type)))) => ok_response(bytes, &content_type, etag),
        Ok(Ok(Err(msg))) => error_response(tauri::http::StatusCode::BAD_GATEWAY, &msg),
        // 予算超過 (or 取得タスクの panic — release では abort が先に効く)
        _ => placeholder_response(),
    }
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
/// notify_media (OS 通知の画像取得) も同じ口を使う。
pub(crate) async fn ensure_media_inner(
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
    // fetch_streaming の背景タスクもオリジナルを書くが、それを待たずに emit
    // すると再要求がミスする競合があるため、ここで確実に書き切ってから返す
    cache
        .store_variant(&req.cache_key(), bytes.clone(), &content_type)
        .await;
    Ok((bytes, content_type))
}

fn ok_response(bytes: Vec<u8>, content_type: &str, etag: &str) -> tauri::http::Response<Vec<u8>> {
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

fn error_response(
    status: tauri::http::StatusCode,
    message: &str,
) -> tauri::http::Response<Vec<u8>> {
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
        let req =
            MediaRequest::from_query("url=https%3A%2F%2Fexample.com%2Fa.png&w=56&format=webp")
                .expect("should parse");
        assert_eq!(req.url, "https://example.com/a.png");
        assert_eq!(req.w, Some(56));
        assert_eq!(req.h, None);
        assert_eq!(req.format.as_deref(), Some("webp"));
        assert!(req.wants_transform());
    }

    /// 絵文字経路は h (最大高さ) だけを指定する (#921)
    #[test]
    fn parses_height_param() {
        let req = MediaRequest::from_query("url=https%3A%2F%2Fexample.com%2Fa.png&h=128")
            .expect("should parse");
        assert_eq!(req.w, None);
        assert_eq!(req.h, Some(128));
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
        let tall = MediaRequest::from_query("url=https%3A%2F%2Fe.com%2Fa.png&h=128").unwrap();
        assert_ne!(plain.cache_key(), sized.cache_key());
        assert_ne!(sized.cache_key(), bigger.cache_key());
        assert_ne!(sized.etag(), bigger.etag());
        assert_ne!(tall.cache_key(), plain.cache_key());
        assert_ne!(tall.cache_key(), sized.cache_key());
        assert!(!plain.wants_transform());
    }

    /// h 導入前からある variant (アバター等の w 指定) のキーは変えない。
    /// 変わると更新直後に全端末で再変換 + ディスクの二重保存が走る
    #[test]
    fn cache_key_is_stable_for_width_only_requests() {
        let sized = MediaRequest::from_query("url=https%3A%2F%2Fe.com%2Fa.png&w=56").unwrap();
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
        assert!(transform_image(&png_bytes(32, 32), Some(56), None, None).is_none());
        // ちょうど上限も変換しない
        assert!(transform_image(&png_bytes(56, 56), Some(56), None, None).is_none());
    }

    /// format を明示されたら縮まなくても変換する。HTTP API は外部にも開いて
    /// いるので、webp を要求されたのに元形式を返すのは契約違反。
    #[test]
    fn honors_explicit_format_even_when_small() {
        let (_, ct) = transform_image(&png_bytes(32, 32), Some(56), None, Some("webp"))
            .expect("explicit format must be honored");
        assert_eq!(ct, "image/webp");
    }

    #[test]
    fn transforms_when_wider_than_limit() {
        let (out, ct) = transform_image(&png_bytes(200, 200), Some(56), None, Some("webp"))
            .expect("should transform");
        assert_eq!(ct, "image/webp");
        assert!(!out.is_empty());
    }

    /// 横長絵文字の核心 (#921): h だけ指定すると幅は制限されず、アスペクト
    /// 維持で高さが h に丸まる。旧実装 (w=64 固定) は 512×128 を 64×16 に
    /// 潰していた
    #[test]
    fn height_only_resize_preserves_wide_aspect() {
        let (out, ct) =
            transform_image(&png_bytes(400, 100), None, Some(50), None).expect("should transform");
        assert_eq!(ct, "image/webp");
        let img = image::load_from_memory(&out).expect("must decode");
        assert_eq!((img.width(), img.height()), (200, 50));
    }

    /// 高さが収まっている横長画像は、幅がどれだけ大きくても素通し
    /// (h 基準では幅を理由に再エンコードしない)
    #[test]
    fn skips_wide_image_when_height_within_limit() {
        assert!(transform_image(&png_bytes(400, 100), None, Some(128), None).is_none());
    }

    /// w と h の両指定は「収まる箱」: きつい方の辺が効く
    #[test]
    fn width_and_height_fit_within_box() {
        let (out, _) = transform_image(&png_bytes(400, 100), Some(100), Some(50), None)
            .expect("should transform");
        let img = image::load_from_memory(&out).expect("must decode");
        assert_eq!((img.width(), img.height()), (100, 25));
    }

    /// format 明示で変換は走っても拡大はしない (小さい原本はそのままの寸法)
    #[test]
    fn never_upscales_small_images() {
        let (out, _) = transform_image(&png_bytes(40, 10), None, Some(50), Some("webp"))
            .expect("explicit format must be honored");
        let img = image::load_from_memory(&out).expect("must decode");
        assert_eq!((img.width(), img.height()), (40, 10));
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
        assert!(transform_image(&wide, Some(56), None, Some("webp")).is_none());
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
        assert!(transform_image(&gif, Some(56), None, Some("webp")).is_none());

        // APNG: IDAT より前の acTL チャンクで判定 (CRC は見ない)
        let mut apng = png_bytes(100, 100);
        let mut actl = Vec::new();
        actl.extend_from_slice(&8u32.to_be_bytes());
        actl.extend_from_slice(b"acTL");
        actl.extend_from_slice(&[0u8; 12]); // frames(4) + plays(4) + crc(4)
        apng.splice(33..33, actl); // IHDR 直後 (8 sig + 25 IHDR chunk)
        assert!(may_be_animated(&apng));
        assert!(transform_image(&apng, Some(56), None, Some("webp")).is_none());

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

        let req =
            MediaRequest::from_query("url=https%3A%2F%2Fe.com%2Fa.png&w=56").expect("should parse");
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
