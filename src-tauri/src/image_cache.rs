use bytes::Bytes;
use futures_util::StreamExt;
use lru::LruCache;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::{watch, Mutex, RwLock, Semaphore};

use crate::perf_config::SharedPerfConfig;

/// メディア 1 件の取得予算 (接続〜ボディ読み切りまで)。共有 client の全体
/// timeout (10s) より優先される。wry Android の custom protocol は応答を
/// 10 秒で打ち切って panic するため (media_proxy::RESPONSE_DEADLINE 参照)、
/// その内側で確実にエラーへ落とし、negative cache / circuit breaker に
/// 学習させる。上流のストールを 10 秒付き合う価値のあるメディアは無い。
const MEDIA_FETCH_TIMEOUT: Duration = Duration::from_secs(6);

// Negative cache TTLs by error class
const NEGATIVE_TTL_CLIENT: Duration = Duration::from_secs(24 * 60 * 60); // 4xx: 24h
const NEGATIVE_TTL_SERVER: Duration = Duration::from_secs(2 * 60); // 5xx: 2min
const NEGATIVE_TTL_NETWORK: Duration = Duration::from_secs(5); // timeout/conn: 5s

// Fallback defaults (used when perf_config is not available, e.g. in tests)
const DEFAULT_MEMORY_CACHE_MAX_ITEM: usize = 256 * 1024;
const DEFAULT_MEMORY_CACHE_MAX_TOTAL: usize = 32 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT_FETCHES: usize = 30;
#[allow(dead_code)]
const DEFAULT_CIRCUIT_BREAKER_THRESHOLD: u32 = 5;

struct HostCircuitState {
    consecutive_failures: u32,
    tripped_at: Option<Instant>,
}

type InflightMap = HashMap<String, watch::Receiver<Option<Result<CacheEntry, String>>>>;

#[derive(Clone)]
pub struct CacheEntry {
    pub path: PathBuf,
    pub content_type: String,
    pub mem_bytes: Option<Arc<Vec<u8>>>,
}

pub enum StreamingFetchResult {
    /// Cache hit – serve immediately
    Cached(CacheEntry),
    /// Cache miss – stream chunks from upstream
    Streaming {
        byte_stream: Pin<Box<dyn futures_util::Stream<Item = Result<Bytes, String>> + Send>>,
        content_type: String,
    },
}

struct MemEntry {
    data: Arc<Vec<u8>>,
    content_type: String,
}

struct MemCacheState {
    entries: LruCache<String, MemEntry>,
    total_size: usize,
}

pub struct ImageCache {
    cache_dir: PathBuf,
    inflight: Arc<Mutex<InflightMap>>,
    http_client: reqwest::Client,
    fetch_semaphore: Arc<Semaphore>,
    negative_cache: Arc<RwLock<HashMap<String, (Instant, Duration)>>>,
    mem_cache: Arc<RwLock<MemCacheState>>,
    host_circuits: Arc<RwLock<HashMap<String, HostCircuitState>>>,
    /// 二段階配信の背景 ensure (取得+変換) の重複防止 (cache_key 単位)
    ensure_pending: Arc<Mutex<std::collections::HashSet<String>>>,
    perf: SharedPerfConfig,
}

impl ImageCache {
    /// Create with a default HTTP client and default perf config (used in tests).
    #[cfg(test)]
    pub fn new(app_dir: &Path) -> Self {
        let perf = Arc::new(RwLock::new(crate::perf_config::PerformanceConfig::default()));
        Self::with_client(app_dir, reqwest::Client::default(), perf)
    }

    pub fn with_client(app_dir: &Path, http_client: reqwest::Client, perf: SharedPerfConfig) -> Self {
        let cache_dir = app_dir.join("image_cache");
        std::fs::create_dir_all(&cache_dir).ok();
        let max_total = DEFAULT_MEMORY_CACHE_MAX_TOTAL;
        let max_item = DEFAULT_MEMORY_CACHE_MAX_ITEM;
        let capacity = max_total / (max_item / 2);

        Self {
            cache_dir,
            inflight: Arc::new(Mutex::new(HashMap::new())),
            http_client,
            fetch_semaphore: Arc::new(Semaphore::new(DEFAULT_MAX_CONCURRENT_FETCHES)),
            negative_cache: Arc::new(RwLock::new(HashMap::new())),
            mem_cache: Arc::new(RwLock::new(MemCacheState {
                entries: LruCache::new(NonZeroUsize::new(capacity).unwrap()),
                total_size: 0,
            })),
            host_circuits: Arc::new(RwLock::new(HashMap::new())),
            ensure_pending: Arc::new(Mutex::new(std::collections::HashSet::new())),
            perf,
        }
    }

    /// 変換結果 (variant) を cache_key 単位で保存する。オリジナルと同じ
    /// .dat/.meta 形式なので sweep / clear / メモリ昇格がそのまま効く。
    pub async fn store_variant(&self, key: &str, bytes: Vec<u8>, content_type: &str) {
        let hash = hex_hash(key);
        let data_path = self.cache_dir.join(format!("{hash}.dat"));
        let meta_path = self.cache_dir.join(format!("{hash}.meta"));
        let bytes_arc = Arc::new(bytes);

        let bytes_for_disk = bytes_arc.clone();
        let ct_for_disk = content_type.to_string();
        tokio::task::spawn_blocking(move || {
            std::fs::write(&data_path, &*bytes_for_disk).ok();
            std::fs::write(&meta_path, &ct_for_disk).ok();
        })
        .await
        .ok();

        let max_item = self.perf.read().await.memory_cache_max_item;
        if bytes_arc.len() <= max_item {
            self.insert_mem_cache(&hash, &bytes_arc, content_type).await;
        }
    }

    /// URL (または cache_key) が negative cache 中か。二段階配信のフェーズ 1 が
    /// これを見ずに ensure を再発行すると、失敗イベント → img 再試行 → 失敗
    /// イベントの無限ループになる。
    pub async fn is_negative_cached(&self, url: &str) -> bool {
        let neg = self.negative_cache.read().await;
        match neg.get(&hex_hash(url)) {
            Some((failed_at, ttl)) => failed_at.elapsed() < *ttl,
            None => false,
        }
    }

    /// 直近失敗 (negative cache) か既知のダウンホスト (circuit breaker) か。
    /// 二段階配信のフェーズ 1 はこれが真なら ensure を発行せず即エラーを返す。
    pub async fn is_fast_fail(&self, url: &str) -> bool {
        if self.is_negative_cached(url).await {
            return true;
        }
        if let Some(host) = Self::extract_host(url) {
            if self.is_host_blocked(&host).await {
                return true;
            }
        }
        false
    }

    /// ensure (背景取得+変換) の開始を予約する。既に進行中なら false。
    pub async fn begin_ensure(&self, key: &str) -> bool {
        self.ensure_pending.lock().await.insert(key.to_string())
    }

    pub async fn finish_ensure(&self, key: &str) {
        self.ensure_pending.lock().await.remove(key);
    }

    async fn check_cache(
        &self,
        hash: &str,
        meta_path: &Path,
        data_path: &Path,
    ) -> Option<CacheEntry> {
        let meta_path_owned = meta_path.to_path_buf();
        let data_path_owned = data_path.to_path_buf();
        let cache_ttl_days = self.perf.read().await.image_cache_ttl_days;
        let cache_ttl = Duration::from_secs(cache_ttl_days * 24 * 60 * 60);
        let (content_type, bytes) = tokio::task::spawn_blocking(move || {
            if !data_path_owned.exists() || !meta_path_owned.exists() {
                return None;
            }
            let meta = data_path_owned.metadata().ok()?;
            let modified = meta.modified().ok()?;
            if SystemTime::now()
                .duration_since(modified)
                .unwrap_or_default()
                > cache_ttl
            {
                return None;
            }
            let content_type = std::fs::read_to_string(&meta_path_owned).ok()?;
            let bytes = std::fs::read(&data_path_owned).ok()?;
            Some((content_type, bytes))
        })
        .await
        .ok()??;
        let data_path = data_path.to_path_buf();

        // Promote small files to memory cache
        let max_item = self.perf.read().await.memory_cache_max_item;
        let mem_bytes = if bytes.len() <= max_item {
            let arc = Arc::new(bytes);
            self.insert_mem_cache(hash, &arc, &content_type).await;
            Some(arc)
        } else {
            None
        };

        Some(CacheEntry {
            path: data_path,
            content_type,
            mem_bytes,
        })
    }

    async fn insert_mem_cache(&self, hash: &str, data: &Arc<Vec<u8>>, content_type: &str) {
        let max_total = self.perf.read().await.memory_cache_max_total;
        let mut state = self.mem_cache.write().await;
        // LRU eviction: pop least-recently-used until there is room
        while state.total_size + data.len() > max_total && !state.entries.is_empty() {
            if let Some((_key, removed)) = state.entries.pop_lru() {
                state.total_size = state.total_size.saturating_sub(removed.data.len());
            } else {
                break;
            }
        }
        // If key already exists, subtract old size
        if let Some(old) = state.entries.pop(hash) {
            state.total_size = state.total_size.saturating_sub(old.data.len());
        }
        state.total_size += data.len();
        state.entries.push(
            hash.to_string(),
            MemEntry {
                data: data.clone(),
                content_type: content_type.to_string(),
            },
        );
    }

    /// Check all cache layers without fetching. Returns `None` on miss.
    pub async fn check_cache_only(&self, url: &str) -> Option<CacheEntry> {
        if !url.starts_with("https://") {
            return None;
        }
        let hash = hex_hash(url);
        let meta_path = self.cache_dir.join(format!("{hash}.meta"));
        let data_path = self.cache_dir.join(format!("{hash}.dat"));

        // L1: Memory cache
        {
            let mut mem = self.mem_cache.write().await;
            if let Some(entry) = mem.entries.get(&hash) {
                return Some(CacheEntry {
                    path: data_path,
                    content_type: entry.content_type.clone(),
                    mem_bytes: Some(entry.data.clone()),
                });
            }
        }

        // L2: Disk cache
        self.check_cache(&hash, &meta_path, &data_path).await
    }

    /// Extract host from a URL for circuit breaker keying.
    fn extract_host(url: &str) -> Option<String> {
        url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_string()))
    }

    /// Check if a host's circuit breaker is tripped.
    async fn is_host_blocked(&self, host: &str) -> bool {
        let cb_duration = Duration::from_secs(self.perf.read().await.circuit_breaker_duration);
        let circuits = self.host_circuits.read().await;
        if let Some(state) = circuits.get(host) {
            if let Some(tripped_at) = state.tripped_at {
                if tripped_at.elapsed() < cb_duration {
                    return true;
                }
            }
        }
        false
    }

    /// Fetch with streaming for cache misses. First requester gets a byte stream;
    /// inflight waiters get the cached result after the first fetch completes.
    pub async fn fetch_streaming(&self, url: &str) -> Result<StreamingFetchResult, String> {
        if !url.starts_with("https://") {
            return Err("Only HTTPS URLs are allowed".to_string());
        }

        // SSRF 防御は commands::http の validate_external_host に一元化
        // (IP literal に加えて localhost / .local / .internal 等の hostname も
        // 弾く)。DNS 解決結果の検証 + pinning は vault::ssrf の per-fetch
        // resolver が要るため未適用 — 共有 client の経路では別途検討
        {
            let parsed = url::Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
            let host = parsed.host_str().ok_or("url has no host")?;
            crate::commands::validate_external_host(host)?;
        }

        // Circuit breaker: reject early if host is known-down
        if let Some(host) = Self::extract_host(url) {
            if self.is_host_blocked(&host).await {
                return Err(format!("Host {host} temporarily blocked (circuit breaker)"));
            }
        }

        let hash = hex_hash(url);

        // Negative cache check
        {
            let neg = self.negative_cache.read().await;
            if let Some((failed_at, ttl)) = neg.get(&hash) {
                if failed_at.elapsed() < *ttl {
                    return Err("Temporarily unavailable".to_string());
                }
            }
        }

        // Inflight dedup: wait for existing fetch, then return from cache
        let mut inflight = self.inflight.lock().await;
        if let Some(rx) = inflight.get(&hash) {
            let mut rx = rx.clone();
            drop(inflight);
            while rx.changed().await.is_ok() {
                if let Some(result) = rx.borrow().as_ref() {
                    return result.clone().map(StreamingFetchResult::Cached);
                }
            }
            return Err("Inflight request dropped".to_string());
        }

        // Register inflight
        let (tx, rx) = watch::channel(None);
        inflight.insert(hash.clone(), rx);
        drop(inflight);

        // Acquire semaphore
        let _permit = self
            .fetch_semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| "Semaphore closed".to_string())?;

        // Start HTTP request (headers only, don't consume body yet)
        // Some hosts (e.g. i.pximg.net) require a valid Referer header
        let referer = url::Url::parse(url)
            .ok()
            .map(|u| format!("{}://{}/", u.scheme(), u.host_str().unwrap_or_default()));

        let mut req = self.http_client.get(url).timeout(MEDIA_FETCH_TIMEOUT);
        if let Some(ref referer) = referer {
            req = req.header(reqwest::header::REFERER, referer);
        }
        let resp = req.send().await.map_err(|e| {
            let msg = format!("Fetch failed: {e:#}");
            self.record_negative_and_notify(url, &hash, &tx, &msg, NEGATIVE_TTL_NETWORK);
            msg
        })?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let ttl = if (400..500).contains(&status) {
                NEGATIVE_TTL_CLIENT
            } else {
                NEGATIVE_TTL_SERVER
            };
            let msg = format!("HTTP {status}");
            self.record_negative_and_notify(url, &hash, &tx, &msg, ttl);
            return Err(msg);
        }

        let max_file_bytes = self.perf.read().await.image_cache_max_file_bytes;

        if let Some(cl) = resp.content_length() {
            if cl > max_file_bytes {
                let msg = "File too large".to_string();
                self.record_negative_and_notify(url, &hash, &tx, &msg, NEGATIVE_TTL_CLIENT);
                return Err(msg);
            }
        }

        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_string();

        // Set up a channel to relay chunks to the HTTP response
        let (chunk_tx, chunk_rx) = tokio::sync::mpsc::channel::<Result<Bytes, String>>(32);

        // Background task: collect bytes, write cache, notify inflight waiters
        let cache_dir = self.cache_dir.clone();
        let ct_clone = content_type.clone();
        let hash_clone = hash.clone();
        let inflight_ref = self.inflight.clone();
        let negative_cache = self.negative_cache.clone();
        let mem_cache = self.mem_cache.clone();
        let host_circuits = self.host_circuits.clone();
        let perf = self.perf.clone();
        let url_host = Self::extract_host(url).unwrap_or_default();

        tokio::spawn(async move {
            let _permit = _permit; // move permit into task to hold it
            let mut all_bytes = Vec::new();
            let mut stream = resp.bytes_stream();
            let mut error = false;

            while let Some(chunk_result) = stream.next().await {
                match chunk_result {
                    Ok(chunk) => {
                        all_bytes.extend_from_slice(&chunk);
                        if all_bytes.len() as u64 > max_file_bytes {
                            let _ = chunk_tx.send(Err("File too large".to_string())).await;
                            error = true;
                            break;
                        }
                        if chunk_tx.send(Ok(chunk)).await.is_err() {
                            // Receiver dropped (client disconnected), but still cache
                            // Continue reading to completion for caching
                            while let Some(r) = stream.next().await {
                                match r {
                                    Ok(c) => all_bytes.extend_from_slice(&c),
                                    Err(_) => {
                                        error = true;
                                        break;
                                    }
                                }
                            }
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = chunk_tx.send(Err(format!("Stream error: {e}"))).await;
                        error = true;
                        break;
                    }
                }
            }
            drop(chunk_tx);

            let data_path = cache_dir.join(format!("{hash_clone}.dat"));
            let meta_path = cache_dir.join(format!("{hash_clone}.meta"));

            if error {
                let mut neg = negative_cache.write().await;
                neg.insert(hash_clone.clone(), (Instant::now(), NEGATIVE_TTL_NETWORK));
                tx.send(Some(Err("Stream failed".to_string()))).ok();
                // Update host circuit breaker on stream failure
                if !url_host.is_empty() {
                    let mut circuits = host_circuits.write().await;
                    let state = circuits.entry(url_host.clone()).or_insert(HostCircuitState {
                        consecutive_failures: 0,
                        tripped_at: None,
                    });
                    state.consecutive_failures += 1;
                    let threshold = perf.read().await.circuit_breaker_threshold;
                    if state.consecutive_failures >= threshold {
                        state.tripped_at = Some(Instant::now());
                    }
                }
            } else {
                // Wrap in Arc first to avoid cloning the full buffer for disk I/O
                let bytes_arc = Arc::new(all_bytes);

                // Write to disk cache (Arc clone = ref-count bump only)
                let bytes_for_disk = bytes_arc.clone();
                let ct_for_disk = ct_clone.clone();
                let dp = data_path.clone();
                let mp = meta_path.clone();
                tokio::task::spawn_blocking(move || {
                    std::fs::write(&dp, &*bytes_for_disk).ok();
                    std::fs::write(&mp, &ct_for_disk).ok();
                })
                .await
                .ok();

                // Store in memory cache if small enough
                let pc = perf.read().await;
                let max_item = pc.memory_cache_max_item;
                let max_total = pc.memory_cache_max_total;
                drop(pc);
                let mem_bytes = if bytes_arc.len() <= max_item {
                    let mut state = mem_cache.write().await;
                    while state.total_size + bytes_arc.len() > max_total
                        && !state.entries.is_empty()
                    {
                        if let Some((_key, removed)) = state.entries.pop_lru() {
                            state.total_size = state.total_size.saturating_sub(removed.data.len());
                        } else {
                            break;
                        }
                    }
                    if let Some(old) = state.entries.pop(&hash_clone) {
                        state.total_size = state.total_size.saturating_sub(old.data.len());
                    }
                    state.total_size += bytes_arc.len();
                    state.entries.push(
                        hash_clone.clone(),
                        MemEntry {
                            data: bytes_arc.clone(),
                            content_type: ct_clone.clone(),
                        },
                    );
                    Some(bytes_arc)
                } else {
                    None
                };

                // Notify inflight waiters with the cached entry
                tx.send(Some(Ok(CacheEntry {
                    path: data_path,
                    content_type: ct_clone,
                    mem_bytes,
                })))
                .ok();

                // Reset host circuit breaker on success
                if !url_host.is_empty() {
                    host_circuits.write().await.remove(&url_host);
                }
            }

            inflight_ref.lock().await.remove(&hash_clone);
        });

        // Convert mpsc receiver into a stream
        let stream = tokio_stream::wrappers::ReceiverStream::new(chunk_rx);

        Ok(StreamingFetchResult::Streaming {
            byte_stream: Box::pin(stream),
            content_type,
        })
    }

    fn record_negative_and_notify(
        &self,
        url: &str,
        hash: &str,
        tx: &watch::Sender<Option<Result<CacheEntry, String>>>,
        msg: &str,
        ttl: Duration,
    ) {
        let neg = self.negative_cache.clone();
        let inflight = self.inflight.clone();
        let host_circuits = self.host_circuits.clone();
        let perf = self.perf.clone();
        let host = Self::extract_host(url).unwrap_or_default();
        let hash = hash.to_string();
        let msg = msg.to_string();
        let tx_msg = msg.clone();
        tx.send(Some(Err(tx_msg))).ok();
        tokio::spawn(async move {
            neg.write()
                .await
                .insert(hash.clone(), (Instant::now(), ttl));
            inflight.lock().await.remove(&hash);
            // Update host circuit breaker
            if !host.is_empty() {
                let mut circuits = host_circuits.write().await;
                let state = circuits.entry(host).or_insert(HostCircuitState {
                    consecutive_failures: 0,
                    tripped_at: None,
                });
                state.consecutive_failures += 1;
                let threshold = perf.read().await.circuit_breaker_threshold;
                if state.consecutive_failures >= threshold {
                    state.tripped_at = Some(Instant::now());
                }
            }
        });
    }

    /// ディスクキャッシュを掃除する。TTL 超過分を削除したうえで、なお上限を
    /// 超えていれば古い順に削除する。
    ///
    /// TTL 超過分は従来 read 側で「無視」されるだけでファイルは残り続けて
    /// いた。上限・削除処理がどこにも無く、際限なく溜まる状態だったため
    /// 定期実行の掃除口をここに置く (#815)。
    ///
    /// 古さの基準は mtime (= 書き込み時刻)。read で更新しないので厳密な LRU
    /// ではなく投入順に近いが、キャッシュミスは再取得で回復するため許容する。
    pub async fn sweep_disk(&self) -> SweepStats {
        let (ttl_days, max_bytes) = {
            let perf = self.perf.read().await;
            (perf.image_cache_ttl_days, perf.image_cache_max_bytes)
        };
        let dir = self.cache_dir.clone();
        tokio::task::spawn_blocking(move || sweep_dir(&dir, ttl_days, max_bytes))
            .await
            .unwrap_or_default()
    }

    /// ディスクキャッシュの使用量 (設定 UI の表示用)
    pub async fn disk_stats(&self) -> (u64, usize) {
        let dir = self.cache_dir.clone();
        tokio::task::spawn_blocking(move || {
            let Ok(entries) = std::fs::read_dir(&dir) else {
                return (0, 0);
            };
            let mut bytes = 0u64;
            let mut files = 0usize;
            for entry in entries.flatten() {
                if entry.path().extension().and_then(|e| e.to_str()) != Some("dat") {
                    continue;
                }
                if let Ok(meta) = entry.metadata() {
                    bytes += meta.len();
                    files += 1;
                }
            }
            (bytes, files)
        })
        .await
        .unwrap_or((0, 0))
    }

    /// ディスクキャッシュを全削除する。メモリキャッシュも合わせて捨てないと
    /// 削除したはずの画像が返り続ける
    pub async fn clear_disk(&self) -> Result<(), String> {
        {
            let mut mem = self.mem_cache.write().await;
            mem.entries.clear();
            mem.total_size = 0;
        }
        let dir = self.cache_dir.clone();
        tokio::task::spawn_blocking(move || {
            let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
            for entry in entries.flatten() {
                let path = entry.path();
                let ext = path.extension().and_then(|e| e.to_str());
                if ext == Some("dat") || ext == Some("meta") {
                    let _ = std::fs::remove_file(&path);
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SweepStats {
    pub expired_removed: usize,
    pub evicted_removed: usize,
    pub bytes_after: u64,
}

/// `<hash>.dat` と対の `<hash>.meta` を 1 エントリとして扱い、まとめて消す
fn remove_entry(dir: &Path, stem: &str) {
    let _ = std::fs::remove_file(dir.join(format!("{stem}.dat")));
    let _ = std::fs::remove_file(dir.join(format!("{stem}.meta")));
}

fn sweep_dir(dir: &Path, ttl_days: u64, max_bytes: u64) -> SweepStats {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return SweepStats::default();
    };
    let ttl = Duration::from_secs(ttl_days * 24 * 60 * 60);
    let now = SystemTime::now();
    let mut stats = SweepStats::default();
    // (mtime, size, stem) — .dat のみを対象にし .meta は道連れで消す
    let mut alive: Vec<(SystemTime, u64, String)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("dat") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()).map(String::from) else {
            continue;
        };
        let Ok(meta) = entry.metadata() else { continue };
        let modified = meta.modified().unwrap_or(now);
        if now.duration_since(modified).unwrap_or_default() > ttl {
            remove_entry(dir, &stem);
            stats.expired_removed += 1;
            continue;
        }
        alive.push((modified, meta.len(), stem));
    }

    let mut total: u64 = alive.iter().map(|(_, size, _)| size).sum();
    if total > max_bytes {
        // 古い順に消して上限まで落とす
        alive.sort_by_key(|(modified, _, _)| *modified);
        for (_, size, stem) in &alive {
            if total <= max_bytes {
                break;
            }
            remove_entry(dir, stem);
            total = total.saturating_sub(*size);
            stats.evicted_removed += 1;
        }
    }
    stats.bytes_after = total;
    stats
}

pub fn hex_hash(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_hash_deterministic() {
        let a = hex_hash("https://example.com/image.png");
        let b = hex_hash("https://example.com/image.png");
        assert_eq!(a, b);
    }

    #[test]
    fn hex_hash_different_inputs() {
        let a = hex_hash("https://example.com/a.png");
        let b = hex_hash("https://example.com/b.png");
        assert_ne!(a, b);
    }

    #[test]
    fn hex_hash_is_64_chars() {
        let h = hex_hash("test");
        assert_eq!(h.len(), 64); // SHA256 = 32 bytes = 64 hex chars
    }

    #[test]
    fn image_cache_creates_dir() {
        let dir = tempfile::tempdir().unwrap();
        let _cache = ImageCache::new(dir.path());
        assert!(dir.path().join("image_cache").exists());
    }

    #[tokio::test]
    async fn check_cache_only_returns_none_for_http() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        assert!(cache.check_cache_only("http://insecure.com/img.png").await.is_none());
    }

    #[tokio::test]
    async fn check_cache_only_miss() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        assert!(cache.check_cache_only("https://example.com/missing.png").await.is_none());
    }

    #[tokio::test]
    async fn mem_cache_insert_and_retrieve() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        let data = Arc::new(vec![1u8, 2, 3]);
        cache.insert_mem_cache("test-hash", &data, "image/png").await;

        let mut mem = cache.mem_cache.write().await;
        let entry = mem.entries.get("test-hash").unwrap();
        assert_eq!(entry.content_type, "image/png");
        assert_eq!(&**entry.data, &[1u8, 2, 3]);
    }

    #[tokio::test]
    async fn mem_cache_lru_eviction() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());

        // Insert entries that fill the memory budget
        let big = Arc::new(vec![0u8; DEFAULT_MEMORY_CACHE_MAX_TOTAL / 2]);
        cache.insert_mem_cache("a", &big, "image/png").await;
        cache.insert_mem_cache("b", &big, "image/png").await;

        // Third insert should evict "a"
        cache.insert_mem_cache("c", &big, "image/png").await;

        let mem = cache.mem_cache.read().await;
        assert!(mem.entries.peek("a").is_none(), "LRU entry 'a' should be evicted");
        assert!(mem.entries.peek("b").is_some() || mem.entries.peek("c").is_some());
    }

    /// 変換結果 (variant) はオリジナルと同じ .dat/.meta 形式で cache_key の
    /// ハッシュに保存し、check_cache_only で引けること。変換を毎回やり直すと
    /// モバイルの CPU を秒単位で食い続ける (#855 の根本対策の一部)。
    #[tokio::test]
    async fn store_variant_roundtrips_via_check_cache_only() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        let key = "https://e.com/a.png|w=56|f=";
        cache.store_variant(key, vec![9u8; 128], "image/webp").await;

        let entry = cache
            .check_cache_only(key)
            .await
            .expect("variant should be served from cache");
        assert_eq!(entry.content_type, "image/webp");
        // ディスクにも書かれている (プロセス再起動後も変換不要)
        let dat = dir
            .path()
            .join("image_cache")
            .join(format!("{}.dat", hex_hash(key)));
        assert!(dat.exists());
    }

    /// 二段階配信のフェーズ 1 が「失敗直後の URL」へ ensure を再発行すると
    /// 失敗イベント → 再試行 → 失敗イベントの無限ループになる。
    /// negative cache を外から照会できることが再試行ループの遮断条件。
    #[tokio::test]
    async fn negative_cache_is_queryable_with_ttl() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        let url = "https://down.example/a.png";
        assert!(!cache.is_negative_cached(url).await);

        cache
            .negative_cache
            .write()
            .await
            .insert(hex_hash(url), (Instant::now(), Duration::from_secs(60)));
        assert!(cache.is_negative_cached(url).await);

        // TTL 切れは negative 扱いしない (自然回復)
        cache.negative_cache.write().await.insert(
            hex_hash(url),
            (Instant::now() - Duration::from_secs(10), Duration::from_secs(5)),
        );
        assert!(!cache.is_negative_cached(url).await);
    }

    /// SSRF 防御は commands::http の validate_external_host に一元化。
    /// IP literal だけでなく localhost / 予約 TLD などの hostname も
    /// ネットワークに出る前に弾く (ローカル HTTP API からも叩ける面のため)
    #[tokio::test]
    async fn fetch_rejects_unsafe_hosts_before_network() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        for url in [
            "https://localhost/a.png",
            "https://127.0.0.1/a.png",
            "https://[::1]/a.png",
            "https://foo.internal/a.png",
            "https://printer.local/a.png",
        ] {
            let err = cache
                .fetch_streaming(url)
                .await
                .err()
                .unwrap_or_else(|| panic!("should reject {url}"));
            // 接続失敗 (ネットワークに出た) ではなく検証で弾いたことを確かめる
            assert!(err.contains("not allowed"), "{url}: {err}");
        }
    }

    /// circuit breaker で塞がれたホストもフェーズ 1 の即時失敗対象になること。
    /// (negative cache に入らない失敗経路なので、これを見落とすと ensure が
    /// 高速に空振りし続ける)
    #[tokio::test]
    async fn fast_fail_covers_circuit_breaker() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        let url = "https://down.example/a.png";
        assert!(!cache.is_fast_fail(url).await);

        cache.host_circuits.write().await.insert(
            "down.example".to_string(),
            HostCircuitState {
                consecutive_failures: 9,
                tripped_at: Some(Instant::now()),
            },
        );
        assert!(cache.is_fast_fail(url).await);
    }

    /// 同じ variant への ensure が並走しないこと (変換 CPU の二重払い防止)
    #[tokio::test]
    async fn ensure_dedup_via_begin_finish() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        assert!(cache.begin_ensure("k").await);
        assert!(!cache.begin_ensure("k").await, "must not start twice");
        cache.finish_ensure("k").await;
        assert!(cache.begin_ensure("k").await, "finished key can start again");
    }

    /// `<stem>.dat` + `.meta` の対を作り、mtime を指定秒だけ過去にずらす
    fn write_entry(dir: &Path, stem: &str, size: usize, age_secs: u64) {
        std::fs::write(dir.join(format!("{stem}.dat")), vec![0u8; size]).unwrap();
        std::fs::write(dir.join(format!("{stem}.meta")), "image/png").unwrap();
        let mtime = SystemTime::now() - Duration::from_secs(age_secs);
        let f = std::fs::File::options()
            .write(true)
            .open(dir.join(format!("{stem}.dat")))
            .unwrap();
        f.set_modified(mtime).unwrap();
    }

    #[test]
    fn sweep_removes_entries_past_ttl_with_their_meta() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let day = 24 * 60 * 60;
        write_entry(dir, "fresh", 10, 0);
        write_entry(dir, "stale", 10, 8 * day);

        let stats = sweep_dir(dir, 7, u64::MAX);

        assert_eq!(stats.expired_removed, 1);
        assert!(dir.join("fresh.dat").exists());
        assert!(!dir.join("stale.dat").exists());
        // .meta を残すと孤児になるので道連れで消える
        assert!(!dir.join("stale.meta").exists());
    }

    #[test]
    fn sweep_evicts_oldest_until_under_the_size_cap() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_entry(dir, "oldest", 100, 300);
        write_entry(dir, "middle", 100, 200);
        write_entry(dir, "newest", 100, 100);

        let stats = sweep_dir(dir, 7, 250);

        assert_eq!(stats.evicted_removed, 1);
        assert!(stats.bytes_after <= 250);
        assert!(!dir.join("oldest.dat").exists());
        assert!(dir.join("middle.dat").exists());
        assert!(dir.join("newest.dat").exists());
    }

    #[test]
    fn sweep_keeps_everything_when_within_limits() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        write_entry(dir, "a", 100, 10);
        write_entry(dir, "b", 100, 20);

        let stats = sweep_dir(dir, 7, 10_000);

        assert_eq!(stats, SweepStats {
            expired_removed: 0,
            evicted_removed: 0,
            bytes_after: 200,
        });
    }

    #[tokio::test]
    async fn clear_disk_removes_all_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(tmp.path());
        let dir = tmp.path().join("image_cache");
        write_entry(&dir, "a", 10, 0);
        write_entry(&dir, "b", 10, 0);
        assert_eq!(cache.disk_stats().await, (20, 2));

        cache.clear_disk().await.unwrap();

        assert_eq!(cache.disk_stats().await, (0, 0));
        assert!(!dir.join("a.meta").exists());
    }

    #[tokio::test]
    async fn fetch_streaming_rejects_http() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ImageCache::new(dir.path());
        let result = cache.fetch_streaming("http://insecure.com/img.png").await;
        match result {
            Err(msg) => assert!(msg.contains("HTTPS")),
            Ok(_) => panic!("Expected error for HTTP URL"),
        }
    }
}
