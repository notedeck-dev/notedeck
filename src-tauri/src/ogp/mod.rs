pub mod parser;
pub mod plugins;

use lru::LruCache;
use notecli::db::SummaryRow;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{watch, Mutex};

const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const CACHE_TTL_SECS: i64 = 24 * 60 * 60;
use crate::perf_config::SharedPerfConfig;

const DEFAULT_MAX_ENTRIES: usize = 64;
const MAX_HTML_SIZE: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct Player {
    pub url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[serde(default)]
    pub allow: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SummaryData {
    pub title: Option<String>,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub sitename: Option<String>,
    pub thumbnail: Option<String>,
    pub medias: Vec<String>,
    pub player: Option<Player>,
    pub url: String,
    pub sensitive: bool,
}

/// Legacy alias — kept for backward compatibility in commands.rs / frontend
pub type OgpData = SummaryData;

// --- Conversion between SummaryData and SummaryRow ---

impl SummaryData {
    /// Convert from a DB row into SummaryData.
    pub fn from_row(row: &SummaryRow) -> Self {
        let player = row.player_url.as_ref().map(|pu| {
            let allow: Vec<String> = row
                .player_allow
                .as_deref()
                .and_then(|j| serde_json::from_str(j).ok())
                .unwrap_or_default();
            Player {
                url: pu.clone(),
                width: row.player_width,
                height: row.player_height,
                allow,
            }
        });
        let medias: Vec<String> = row
            .medias_json
            .as_deref()
            .and_then(|j| serde_json::from_str(j).ok())
            .unwrap_or_default();
        SummaryData {
            title: row.title.clone(),
            description: row.description.clone(),
            icon: row.icon.clone(),
            sitename: row.sitename.clone(),
            thumbnail: row.thumbnail.clone(),
            medias,
            player,
            url: row.final_url.clone().unwrap_or_else(|| row.url.clone()),
            sensitive: row.sensitive,
        }
    }

    /// Convert into a DB row for caching.
    pub fn to_row(&self, cache_key: &str) -> SummaryRow {
        let medias_json = if self.medias.is_empty() {
            None
        } else {
            serde_json::to_string(&self.medias).ok()
        };
        SummaryRow {
            url: cache_key.to_string(),
            title: self.title.clone(),
            description: self.description.clone(),
            thumbnail: self.thumbnail.clone(),
            sitename: self.sitename.clone(),
            icon: self.icon.clone(),
            player_url: self.player.as_ref().map(|p| p.url.clone()),
            player_width: self.player.as_ref().and_then(|p| p.width),
            player_height: self.player.as_ref().and_then(|p| p.height),
            player_allow: self.player.as_ref().and_then(|p| {
                if p.allow.is_empty() {
                    None
                } else {
                    serde_json::to_string(&p.allow).ok()
                }
            }),
            final_url: Some(self.url.clone()),
            sensitive: self.sensitive,
            medias_json,
        }
    }
}

// --- Cache ---

struct CacheEntry {
    data: SummaryData,
    fetched_at: Instant,
}

type InflightMap = HashMap<String, watch::Receiver<Option<Result<SummaryData, String>>>>;

#[derive(Clone)]
pub struct OgpCache {
    cache: Arc<Mutex<LruCache<String, CacheEntry>>>,
    inflight: Arc<Mutex<InflightMap>>,
    http_client: reqwest::Client,
    db: Arc<notecli::db::Database>,
    loaded: Arc<std::sync::atomic::AtomicBool>,
    perf: SharedPerfConfig,
}

impl OgpCache {
    /// Create with a default HTTP client (used in tests).
    #[allow(dead_code)]
    pub fn new(db: Arc<notecli::db::Database>) -> Self {
        let perf = Arc::new(tokio::sync::RwLock::new(crate::perf_config::PerformanceConfig::default()));
        Self::with_client(db, reqwest::Client::default(), perf)
    }

    pub fn with_client(db: Arc<notecli::db::Database>, http_client: reqwest::Client, perf: SharedPerfConfig) -> Self {
        Self {
            cache: Arc::new(Mutex::new(LruCache::new(
                NonZeroUsize::new(DEFAULT_MAX_ENTRIES).unwrap(),
            ))),
            inflight: Arc::new(Mutex::new(HashMap::new())),
            http_client,
            db,
            loaded: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            perf,
        }
    }

    /// Load DB cache on first use (lazy init).
    async fn ensure_loaded(&self) {
        if self.loaded.load(std::sync::atomic::Ordering::Acquire) {
            return;
        }
        self.loaded
            .store(true, std::sync::atomic::Ordering::Release);

        self.db.cleanup_expired_ogp().ok();

        let max_entries = self.perf.read().await.rust_ogp_cache_max;
        if let Ok(rows) = self.db.load_summary_cache(max_entries) {
            let mut cache = self.cache.lock().await;
            // Insert in reverse so the most recent entries are promoted to MRU
            for row in rows.iter().rev() {
                cache.push(
                    row.url.clone(),
                    CacheEntry {
                        data: SummaryData::from_row(row),
                        fetched_at: Instant::now(),
                    },
                );
            }
        }
    }

    /// Fetch without server context (plugins → direct HTML parse).
    pub async fn get_ogp(&self, url: &str) -> Result<SummaryData, String> {
        self.cached_or_fetch(url, |this| Box::pin(this.resolve(url.to_string(), None)))
            .await
    }

    /// Fetch with server context.
    /// Priority: plugins → server `/api/url` → direct HTML parse.
    pub async fn get_ogp_via_server(
        &self,
        url: &str,
        host: &str,
        token: &str,
    ) -> Result<SummaryData, String> {
        let host = host.to_string();
        let token = token.to_string();
        let url_owned = url.to_string();
        self.cached_or_fetch(url, |this| {
            Box::pin(this.resolve(url_owned, Some((host, token))))
        })
        .await
    }

    /// Shared cache-check + inflight-dedup + fetch logic.
    async fn cached_or_fetch<F>(&self, url: &str, fetch_fn: F) -> Result<SummaryData, String>
    where
        F: FnOnce(
            &Self,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<SummaryData, String>> + Send + '_>,
        >,
    {
        if !url.starts_with("https://") {
            return Err("Only HTTPS URLs are allowed".to_string());
        }

        self.ensure_loaded().await;

        // Memory cache
        {
            let mut cache = self.cache.lock().await;
            if let Some(entry) = cache.get(url) {
                if entry.fetched_at.elapsed() < CACHE_TTL {
                    let mut data = entry.data.clone();
                    Self::sanitize_player(&mut data);
                    return Ok(data);
                }
            }
        }

        // Disk cache
        if let Some(mut data) = self.load_from_disk(url) {
            Self::sanitize_player(&mut data);
            self.store_mem_cache(url, &data).await;
            return Ok(data);
        }

        // Inflight dedup
        let mut inflight = self.inflight.lock().await;
        if let Some(rx) = inflight.get(url) {
            let mut rx = rx.clone();
            drop(inflight);
            while rx.changed().await.is_ok() {
                if let Some(result) = rx.borrow().as_ref() {
                    return result.clone();
                }
            }
            return Err("Inflight request dropped".to_string());
        }

        let (tx, rx) = watch::channel(None);
        inflight.insert(url.to_string(), rx);
        drop(inflight);

        let result = fetch_fn(self).await.map(|mut data| {
            Self::sanitize_player(&mut data);
            data
        });

        if let Ok(ref data) = result {
            self.store_cache(url, data).await;
        }

        tx.send(Some(result.clone())).ok();
        self.inflight.lock().await.remove(url);

        result
    }

    fn load_from_disk(&self, url: &str) -> Option<SummaryData> {
        let row = self.db.get_cached_summary(url).ok()??;
        Some(SummaryData::from_row(&row))
    }

    fn persist_to_disk(&self, url: &str, data: &SummaryData) {
        let row = data.to_row(url);
        self.db.cache_summary(url, &row, CACHE_TTL_SECS).ok();
    }

    async fn store_mem_cache(&self, url: &str, data: &SummaryData) {
        let mut cache = self.cache.lock().await;
        cache.push(
            url.to_string(),
            CacheEntry {
                data: data.clone(),
                fetched_at: Instant::now(),
            },
        );
    }

    async fn store_cache(&self, url: &str, data: &SummaryData) {
        self.store_mem_cache(url, data).await;
        self.persist_to_disk(url, data);
    }

    async fn fetch_from_server(
        &self,
        url: &str,
        host: &str,
        token: &str,
    ) -> Result<SummaryData, String> {
        let body = serde_json::json!({ "i": token, "url": url });
        let resp = self
            .http_client
            .post(format!("https://{host}/api/url"))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Server OGP fetch failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("Server OGP HTTP {}", resp.status()));
        }

        let server_data: ServerUrlResponse = resp
            .json()
            .await
            .map_err(|e| format!("Server OGP parse failed: {e}"))?;

        let player = server_data.player.and_then(|p| {
            let player_url = p.url.filter(|u| !u.is_empty())?;
            Some(Player {
                url: player_url,
                width: p.width,
                height: p.height,
                allow: p.allow.unwrap_or_default(),
            })
        });

        // Treat response without a title as a failure so we fall through
        // to the direct HTML parser (e.g. note.com, zenn.dev).
        let title = server_data
            .title
            .filter(|t| !t.is_empty())
            .ok_or("Server returned no title")?;

        Ok(SummaryData {
            title: Some(title),
            description: server_data.description,
            icon: server_data.icon,
            sitename: server_data.sitename,
            thumbnail: server_data.thumbnail,
            medias: Vec::new(),
            player,
            url: server_data.url.unwrap_or_else(|| url.to_string()),
            sensitive: server_data.sensitive.unwrap_or(false),
        })
    }

    /// Player URLs that are known to be broken (e.g. Cloudflare challenge).
    const BLOCKED_PLAYER_HOSTS: &'static [&'static str] = &["embed.pixiv.net"];

    /// Remove player if its URL belongs to a blocked host.
    fn sanitize_player(data: &mut SummaryData) {
        if let Some(ref player) = data.player {
            if let Ok(u) = url::Url::parse(&player.url) {
                if Self::BLOCKED_PLAYER_HOSTS
                    .iter()
                    .any(|h| u.host_str() == Some(h))
                {
                    data.player = None;
                }
            }
        }
    }

    /// Resolve URL summary with priority: plugins → server → direct HTML parse.
    ///
    /// Plugins are tried first because they are only registered when they produce
    /// better results than the server (e.g. richer oEmbed data).
    /// The server's `/api/url` endpoint is used next — it is fast and already
    /// cached server-side, so we prefer it over a direct HTTP fetch.
    async fn resolve(
        &self,
        url: String,
        server: Option<(String, String)>,
    ) -> Result<SummaryData, String> {
        // 1. Plugins (only registered when they beat the server)
        if let Ok(parsed) = url::Url::parse(&url) {
            for plugin in plugins::all() {
                if plugin.test(&parsed) {
                    match plugin.summarize(&parsed, &self.http_client).await {
                        Ok(data) => return Ok(data),
                        Err(e) => {
                            tracing::warn!("[ogp] plugin failed for {url}: {e}, falling back");
                            break;
                        }
                    }
                }
            }
        }

        // 2. Server summary (fast, already cached on server)
        if let Some((host, token)) = server {
            if let Ok(data) = self.fetch_from_server(&url, &host, &token).await {
                return Ok(data);
            }
        }

        // 3. Direct HTML fetch + parse (fallback)
        self.fetch_and_parse(&url).await
    }

    async fn fetch_and_parse(&self, url: &str) -> Result<SummaryData, String> {
        let referer = url::Url::parse(url)
            .ok()
            .map(|u| format!("{}://{}/", u.scheme(), u.host_str().unwrap_or_default()));

        let mut req = self.http_client.get(url).header("Accept", "text/html");
        if let Some(ref referer) = referer {
            req = req.header(reqwest::header::REFERER, referer);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("Fetch failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }

        let final_url = resp.url().to_string();

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !content_type.contains("text/html") && !content_type.contains("application/xhtml") {
            return Err("Not an HTML page".to_string());
        }

        if let Some(cl) = resp.content_length() {
            if cl > MAX_HTML_SIZE as u64 {
                return Err("Page too large".to_string());
            }
        }

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Read failed: {e}"))?;
        if bytes.len() > MAX_HTML_SIZE {
            return Err("Page too large".to_string());
        }

        let html = decode_html_bytes(&bytes, &content_type);

        // Detect bot-challenge / captcha pages (Cloudflare, etc.)
        if parser::is_challenge_page(&html) {
            return Err("Bot challenge page detected".to_string());
        }
        let mut data = parser::parse_html(&html, &final_url);

        // If no player found but page has an oEmbed link, try fetching it
        if data.player.is_none() {
            if let Some(oembed_url) = parser::extract_oembed_url(&html) {
                if let Ok(oembed) = plugins::fetch_oembed(&self.http_client, &oembed_url).await {
                    if let Some(src) = oembed.html.as_deref().and_then(plugins::extract_iframe_src)
                    {
                        data.player = Some(Player {
                            url: src,
                            width: oembed.width,
                            height: oembed.height,
                            allow: parser::default_player_allow(),
                        });
                    }
                    // Supplement missing fields from oEmbed
                    if data.title.is_none() {
                        data.title = oembed.title;
                    }
                    if data.thumbnail.is_none() {
                        data.thumbnail = oembed.thumbnail_url;
                    }
                    if data.sitename.is_none() {
                        data.sitename = oembed.provider_name;
                    }
                }
            }
        }

        Ok(data)
    }
}

/// Decode HTML bytes using charset from Content-Type header or `<meta charset>` tag.
/// Falls back to UTF-8 if no charset is specified or detected.
fn decode_html_bytes(bytes: &[u8], content_type: &str) -> String {
    // 1. Try charset from Content-Type header (e.g. "text/html; charset=Shift_JIS")
    let encoding = extract_charset_from_content_type(content_type)
        .and_then(|name| encoding_rs::Encoding::for_label(name.as_bytes()))
        // 2. Try <meta charset="..."> or <meta http-equiv="Content-Type" content="...; charset=...">
        .or_else(|| detect_charset_from_html(bytes));

    match encoding {
        Some(enc) if enc != encoding_rs::UTF_8 => {
            let (decoded, _, _) = enc.decode(bytes);
            decoded.into_owned()
        }
        _ => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn extract_charset_from_content_type(content_type: &str) -> Option<String> {
    content_type
        .split(';')
        .find_map(|part| {
            let part = part.trim();
            if part.to_ascii_lowercase().starts_with("charset=") {
                Some(part["charset=".len()..].trim_matches('"').trim().to_string())
            } else {
                None
            }
        })
}

/// Scan the first 1024 bytes for <meta charset="..."> or
/// <meta http-equiv="Content-Type" content="...; charset=...">
fn detect_charset_from_html(bytes: &[u8]) -> Option<&'static encoding_rs::Encoding> {
    let head = &bytes[..bytes.len().min(4096)];
    // Use lossy conversion just for scanning — only the ASCII meta tags matter
    let snippet = String::from_utf8_lossy(head);
    let lower = snippet.to_ascii_lowercase();

    // <meta charset="Shift_JIS">
    if let Some(pos) = lower.find("charset=") {
        let rest = &lower[pos + "charset=".len()..];
        let rest = rest.trim_start_matches(['"', '\'', ' ']);
        let end = rest.find(['"', '\'', ' ', ';', '>'])
            .unwrap_or(rest.len());
        let name = &rest[..end];
        if !name.is_empty() {
            return encoding_rs::Encoding::for_label(name.as_bytes());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use notecli::db::SummaryRow;

    fn sample_row() -> SummaryRow {
        SummaryRow {
            url: "https://example.com".to_string(),
            title: Some("Title".to_string()),
            description: Some("Desc".to_string()),
            thumbnail: Some("https://example.com/img.png".to_string()),
            sitename: Some("Example".to_string()),
            icon: Some("https://example.com/icon.png".to_string()),
            player_url: Some("https://example.com/player".to_string()),
            player_width: Some(640),
            player_height: Some(360),
            player_allow: Some(r#"["autoplay","fullscreen"]"#.to_string()),
            final_url: Some("https://example.com/final".to_string()),
            sensitive: false,
            medias_json: Some(r#"["https://example.com/1.png","https://example.com/2.png"]"#.to_string()),
        }
    }

    #[test]
    fn from_row_converts_all_fields() {
        let data = SummaryData::from_row(&sample_row());
        assert_eq!(data.title.as_deref(), Some("Title"));
        assert_eq!(data.description.as_deref(), Some("Desc"));
        assert_eq!(data.icon.as_deref(), Some("https://example.com/icon.png"));
        assert_eq!(data.url, "https://example.com/final");
        assert_eq!(data.medias.len(), 2);
        let player = data.player.unwrap();
        assert_eq!(player.url, "https://example.com/player");
        assert_eq!(player.width, Some(640));
        assert_eq!(player.allow, vec!["autoplay", "fullscreen"]);
    }

    #[test]
    fn from_row_uses_url_when_no_final_url() {
        let mut row = sample_row();
        row.final_url = None;
        let data = SummaryData::from_row(&row);
        assert_eq!(data.url, "https://example.com");
    }

    #[test]
    fn from_row_no_player_when_url_none() {
        let mut row = sample_row();
        row.player_url = None;
        let data = SummaryData::from_row(&row);
        assert!(data.player.is_none());
    }

    #[test]
    fn to_row_roundtrip() {
        let original = SummaryData::from_row(&sample_row());
        let row = original.to_row("https://example.com");
        let roundtrip = SummaryData::from_row(&row);
        assert_eq!(original.title, roundtrip.title);
        assert_eq!(original.description, roundtrip.description);
        assert_eq!(original.medias, roundtrip.medias);
        assert_eq!(
            original.player.as_ref().map(|p| &p.url),
            roundtrip.player.as_ref().map(|p| &p.url),
        );
    }

    #[test]
    fn to_row_empty_medias_none_json() {
        let data = SummaryData {
            title: None,
            description: None,
            icon: None,
            sitename: None,
            thumbnail: None,
            medias: Vec::new(),
            player: None,
            url: "https://example.com".to_string(),
            sensitive: false,
        };
        let row = data.to_row("key");
        assert!(row.medias_json.is_none());
        assert!(row.player_url.is_none());
    }

    #[test]
    fn sanitize_player_blocks_pixiv_embed() {
        let mut data = SummaryData {
            title: None,
            description: None,
            icon: None,
            sitename: None,
            thumbnail: None,
            medias: Vec::new(),
            player: Some(Player {
                url: "https://embed.pixiv.net/player.html".to_string(),
                width: None,
                height: None,
                allow: Vec::new(),
            }),
            url: "https://pixiv.net/artworks/123".to_string(),
            sensitive: false,
        };
        OgpCache::sanitize_player(&mut data);
        assert!(data.player.is_none());
    }

    #[test]
    fn sanitize_player_keeps_allowed_host() {
        let mut data = SummaryData {
            title: None,
            description: None,
            icon: None,
            sitename: None,
            thumbnail: None,
            medias: Vec::new(),
            player: Some(Player {
                url: "https://www.youtube.com/embed/abc".to_string(),
                width: None,
                height: None,
                allow: Vec::new(),
            }),
            url: "https://youtube.com/watch?v=abc".to_string(),
            sensitive: false,
        };
        OgpCache::sanitize_player(&mut data);
        assert!(data.player.is_some());
    }
}

/// Response from Misskey's POST /api/url endpoint (summaly format)
#[derive(Debug, Deserialize)]
struct ServerUrlResponse {
    title: Option<String>,
    description: Option<String>,
    icon: Option<String>,
    thumbnail: Option<String>,
    sitename: Option<String>,
    url: Option<String>,
    sensitive: Option<bool>,
    player: Option<ServerPlayer>,
}

#[derive(Debug, Deserialize)]
struct ServerPlayer {
    url: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    allow: Option<Vec<String>>,
}
