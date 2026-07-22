mod admin;
pub(crate) mod ai;
mod ai_chat;
mod api_tokens;
mod auth;
mod charts;
mod clips;
mod content;
mod drafts;
mod enrichment;
mod federation;
mod health;
mod heartbeat;
mod lists;
mod http;
mod messaging;
mod settings;
mod streaming;
mod timeline;
mod user;
mod utility;
mod vault;

// Re-export all commands so lib.rs `commands::xxx` paths remain unchanged
pub use admin::*;
// `ai` モジュールは現在 `pub(crate)` ヘルパー (read_ai_api_key 等) のみで
// Tauri コマンドを export しない。利用側は `crate::commands::ai::...` を直接参照。
pub use ai_chat::*;
pub use api_tokens::*;
pub use auth::*;
pub use charts::*;
pub use clips::*;
pub use content::*;
pub use drafts::*;
pub use enrichment::*;
pub use federation::*;
pub use health::*;
pub use heartbeat::*;
pub use lists::*;
pub use http::*;
pub use messaging::*;
pub use settings::*;
pub use streaming::*;
pub use timeline::*;
pub use user::*;
pub use utility::*;
pub use vault::*;

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use zeroize::Zeroize;

use notecli::api::MisskeyClient;
use notecli::db::Database;
use notecli::error::NoteDeckError;
use notecli::keychain;

// ── AppState: deferred initialization wrapper ──

struct AppStateInner {
    db: Arc<Database>,
    client: Arc<MisskeyClient>,
    server_info: Arc<notecli::server_info::ServerInfoService>,
}

/// Heavy state (DB, MisskeyClient) wrapped for two-stage deferred initialization.
/// Registered in setup() as empty, initialized in a background thread.
///
/// **Two-stage init**: DB becomes available first (after migrations), unblocking
/// DB-only commands like `load_accounts`. The full state (DB + client) is signalled
/// later once MisskeyClient is also ready.
pub struct AppState {
    // Full init (DB + client) — used by client() and ready()
    rx: tokio::sync::watch::Receiver<Option<Arc<AppStateInner>>>,
    tx: tokio::sync::watch::Sender<Option<Arc<AppStateInner>>>,
    // DB-only early init — used by db()
    db_rx: tokio::sync::watch::Receiver<Option<Arc<Database>>>,
    db_tx: tokio::sync::watch::Sender<Option<Arc<Database>>>,
}

impl AppState {
    pub fn new() -> Self {
        let (tx, rx) = tokio::sync::watch::channel(None);
        let (db_tx, db_rx) = tokio::sync::watch::channel(None);
        Self { rx, tx, db_rx, db_tx }
    }

    /// Called as soon as DB is ready (after migrations, before client).
    /// Unblocks all commands that only need `db()`.
    pub fn initialize_db(&self, db: Arc<Database>) {
        let _ = self.db_tx.send(Some(db));
    }

    /// Called once from the background init thread when DB + client are ready.
    pub fn initialize(&self, db: Arc<Database>, client: Arc<MisskeyClient>) {
        // Also signal DB channel in case initialize_db() wasn't called
        let _ = self.db_tx.send(Some(Arc::clone(&db)));
        let server_info =
            notecli::server_info::ServerInfoService::new(Arc::clone(&db), Arc::clone(&client));
        let _ = self.tx.send(Some(Arc::new(AppStateInner { db, client, server_info })));
    }

    /// Non-blocking check of full readiness (DB + MisskeyClient). Used by the
    /// healthcheck so it can report startup state without awaiting init.
    pub fn is_ready(&self) -> bool {
        self.rx.borrow().is_some()
    }

    /// Await until DB is ready (fast path — does not wait for MisskeyClient).
    pub async fn db(&self) -> Arc<Database> {
        let mut rx = self.db_rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        Arc::clone(r.as_ref().unwrap())
    }

    /// Await until fully initialized, then return MisskeyClient reference.
    pub async fn client(&self) -> Arc<MisskeyClient> {
        let mut rx = self.rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        Arc::clone(&r.as_ref().unwrap().client)
    }

    /// Await until fully initialized, then return the server-info SWR service.
    pub async fn server_info(&self) -> Arc<notecli::server_info::ServerInfoService> {
        let mut rx = self.rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        Arc::clone(&r.as_ref().unwrap().server_info)
    }

    /// `ready()` + `get_credentials` の定型を 1 行に畳む (#782 R2)。
    /// db を後続で使わないコマンド用 — 使う場合は従来どおり `ready()` を使う。
    pub async fn authed(
        &self,
        account_id: &str,
    ) -> Result<(Arc<MisskeyClient>, String, String)> {
        let (db, client) = self.ready().await;
        let (host, token) = get_credentials(&db, account_id)?;
        Ok((client, host, token))
    }

    /// 匿名フォールバック版 (公開エンドポイント用)。
    pub async fn authed_or_anon(
        &self,
        account_id: &str,
    ) -> Result<(Arc<MisskeyClient>, String, String)> {
        let (db, client) = self.ready().await;
        let (host, token) = get_credentials_or_anon(&db, account_id)?;
        Ok((client, host, token))
    }

    /// Await until fully initialized, then return both.
    pub async fn ready(&self) -> (Arc<Database>, Arc<MisskeyClient>) {
        let mut rx = self.rx.clone();
        let r = rx.wait_for(|v| v.is_some()).await.unwrap();
        let inner = r.as_ref().unwrap();
        (Arc::clone(&inner.db), Arc::clone(&inner.client))
    }
}

/// Regex for extracting HTTPS URLs from note text
static URL_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"https?://[\w\-._~:/?#\[\]@!$&'()*+,;=%]+").unwrap());

/// Media extensions to skip OGP prefetch for (they won't have OGP tags)
static MEDIA_EXT_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|mp3|ogg|wav)(\?.*)?$")
        .unwrap()
});

pub(crate) fn extract_ogp_urls(text: &str) -> Vec<String> {
    URL_RE
        .find_iter(text)
        .map(|m| m.as_str().to_string())
        .filter(|u| !MEDIA_EXT_RE.is_match(u))
        .collect()
}

pub(crate) type Result<T> = std::result::Result<T, NoteDeckError>;

pub(crate) const MAX_UPLOAD_BYTES: usize = 50 * 1024 * 1024; // 50 MB

const CREDENTIAL_CACHE_TTL: Duration = Duration::from_secs(60);

struct CachedCredential {
    host: String,
    token: String,
    cached_at: Instant,
}

impl Drop for CachedCredential {
    fn drop(&mut self) {
        self.token.zeroize();
    }
}

pub struct CredentialCache {
    cache: Mutex<HashMap<String, CachedCredential>>,
}

impl CredentialCache {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(HashMap::new()),
        }
    }

    fn get(&self, account_id: &str) -> Option<(String, String)> {
        let mut cache = self.cache.lock().ok()?;
        if let Some(entry) = cache.get(account_id) {
            if entry.cached_at.elapsed() < CREDENTIAL_CACHE_TTL {
                return Some((entry.host.clone(), entry.token.clone()));
            }
            // Expired: remove immediately (triggers Drop → zeroize)
            cache.remove(account_id);
        }
        None
    }

    fn insert(&self, account_id: &str, host: &str, token: &str) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(
                account_id.to_string(),
                CachedCredential {
                    host: host.to_string(),
                    token: token.to_string(),
                    cached_at: Instant::now(),
                },
            );
        }
    }

    pub fn invalidate(&self, account_id: &str) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.remove(account_id); // Drop → zeroize
        }
    }

    /// Remove all expired entries (triggers Drop → zeroize on each).
    pub fn cleanup_expired(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.retain(|_, entry| entry.cached_at.elapsed() < CREDENTIAL_CACHE_TTL);
        }
    }
}

/// Tracks MiAuth sessions to prevent replay attacks.
/// Sessions expire after 15 minutes and are consumed on completion.
pub struct AuthSessionTracker {
    sessions: Mutex<HashMap<String, (String, Instant)>>, // session_id -> (host, created_at)
}

const AUTH_SESSION_TTL_SECS: u64 = 900; // 15 minutes

impl AuthSessionTracker {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn register(&self, session_id: &str, host: &str) {
        let Ok(mut sessions) = self.sessions.lock() else {
            tracing::error!("AuthSessionTracker mutex poisoned in register");
            return;
        };
        // Purge expired entries while we have the lock
        sessions.retain(|_, (_, created)| created.elapsed().as_secs() < AUTH_SESSION_TTL_SECS);
        sessions.insert(session_id.to_string(), (host.to_string(), Instant::now()));
    }

    pub(crate) fn consume(
        &self,
        session_id: &str,
        host: &str,
    ) -> std::result::Result<(), NoteDeckError> {
        let mut sessions = self.sessions.lock().map_err(|_| {
            NoteDeckError::Auth("Internal error: session lock poisoned".to_string())
        })?;
        match sessions.remove(session_id) {
            Some((stored_host, created)) => {
                if created.elapsed().as_secs() >= AUTH_SESSION_TTL_SECS {
                    return Err(NoteDeckError::Auth("Auth session expired".to_string()));
                }
                if stored_host != host {
                    return Err(NoteDeckError::Auth("Host mismatch".to_string()));
                }
                Ok(())
            }
            None => Err(NoteDeckError::Auth(
                "Invalid or already consumed auth session".to_string(),
            )),
        }
    }
}

static CREDENTIAL_CACHE: LazyLock<CredentialCache> = LazyLock::new(CredentialCache::new);

/// Look up account credentials: uses in-memory cache, then keychain, then DB (lazy migration)
/// `client.request` + `serde_json::from_value::<T>` の型付き汎用ラッパ (#782 R2)。
/// charts / clips / drafts / lists / federation 等の「生 request → 型へ
/// デシリアライズ」定型を 1 行に畳む。
pub(crate) async fn typed_request<T: serde::de::DeserializeOwned>(
    client: &MisskeyClient,
    host: &str,
    token: &str,
    endpoint: &str,
    params: serde_json::Value,
) -> Result<T> {
    let raw = client.request(host, token, endpoint, params).await?;
    Ok(serde_json::from_value(raw)?)
}

pub fn get_credentials(db: &Database, account_id: &str) -> Result<(String, String)> {
    // Fast path: check in-memory cache first
    if let Some(cached) = CREDENTIAL_CACHE.get(account_id) {
        return Ok(cached);
    }

    let account = db
        .get_account(account_id)?
        .ok_or_else(|| NoteDeckError::AccountNotFound(account_id.to_string()))?;
    let host = account.host.clone();

    // Try keychain first (ignore errors — keychain may be unavailable)
    if let Some(token) = keychain::get_token(account_id).ok().flatten() {
        // Keychain has the token; clear DB copy if still present.
        // 再起動非永続な store (Linux keyutils) では DB フォールバックを消さない (#785)
        if !account.token.is_empty() && keychain::is_persistent() {
            let _ = db.clear_token(account_id);
        }
        CREDENTIAL_CACHE.insert(account_id, &host, &token);
        return Ok((host, token));
    }

    // Fallback: use DB token
    let mut db_token = account.token.clone();
    if !db_token.is_empty() {
        // Try lazy migration to keychain; verify before clearing DB
        if keychain::is_persistent()
            && keychain::store_token(account_id, &db_token).is_ok()
            && keychain::get_token(account_id).ok().flatten().is_some()
        {
            let _ = db.clear_token(account_id);
        }
        let token = db_token.clone();
        db_token.zeroize();
        CREDENTIAL_CACHE.insert(account_id, &host, &token);
        return Ok((host, token));
    }

    Err(NoteDeckError::Auth(format!(
        "No token found for account {account_id}"
    )))
}

/// Invalidate cached credentials (call on logout/token change)
pub fn invalidate_credentials(account_id: &str) {
    CREDENTIAL_CACHE.invalidate(account_id);
}

/// Remove expired credential cache entries (call periodically)
pub fn cleanup_expired_credentials() {
    CREDENTIAL_CACHE.cleanup_expired();
}

/// Get host only from account_id (no token required).
fn get_host(db: &Database, account_id: &str) -> Result<String> {
    let account = db
        .get_account(account_id)?
        .ok_or_else(|| NoteDeckError::AccountNotFound(account_id.to_string()))?;
    Ok(account.host.clone())
}

/// Get credentials with anonymous fallback.
/// Returns (host, token) where token is empty if not authenticated.
/// Public Misskey endpoints work with empty token (skipped by notecli).
pub(crate) fn get_credentials_or_anon(
    db: &Database,
    account_id: &str,
) -> Result<(String, String)> {
    match get_credentials(db, account_id) {
        Ok(creds) => Ok(creds),
        Err(_) => Ok((get_host(db, account_id)?, String::new())),
    }
}

/// Write account list (non-secret metadata only) to a JSON file for background workers.
/// The file contains host, account_id, and username — no tokens.
pub fn export_account_list(app: &tauri::AppHandle, db: &Database) {
    let Ok(app_dir) = crate::app_dir::resolve_app_dir(app) else {
        return;
    };
    let Ok(accounts) = db.load_accounts() else {
        return;
    };
    let list: Vec<serde_json::Value> = accounts
        .iter()
        .map(|a| {
            serde_json::json!({
                "id": a.id,
                "host": a.host,
                "username": a.username,
            })
        })
        .collect();
    let _ = std::fs::write(
        app_dir.join("poll_accounts.json"),
        serde_json::to_string(&list).unwrap_or_default(),
    );
}

/// Emit account list to frontend via Tauri event before AppState is initialized.
/// This lets the accounts store populate early, bypassing the AppState readiness gate.
/// Uses the same AccountPublic format as the load_accounts command.
pub fn emit_accounts_early(app: &tauri::AppHandle, db: &Database) {
    use tauri::Emitter;
    let Ok(accounts) = db.load_accounts() else {
        return;
    };
    let list: Vec<notecli::models::AccountPublic> = accounts
        .iter()
        .map(crate::account_service::to_public)
        .collect();
    let _ = app.emit("nd:accounts-early", &list);
}

pub(crate) fn validate_host(host: &str) -> Result<String> {
    let normalized = host.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "Host cannot be empty".to_string(),
        ));
    }
    if normalized.len() > 253 {
        return Err(NoteDeckError::InvalidInput("Host too long".to_string()));
    }
    if normalized.contains(['/', '?', '#', '@', ' ', '\n', '\r']) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid host: {normalized}"
        )));
    }

    // E2E テスト用 (#702): デバッグビルド限定で、環境変数に明示列挙された
    // ホストだけ SSRF ガードをバイパスする (モック Misskey サーバーが
    // 127.0.0.1 で動くため)。リリースビルドでは常に無効。
    #[cfg(debug_assertions)]
    if let Ok(allowed) = std::env::var("NOTEDECK_E2E_ALLOW_HOSTS") {
        if allowed.split(',').any(|h| h.trim() == normalized) {
            return Ok(normalized);
        }
    }

    // SSRF prevention: block loopback, private, and link-local addresses
    let ssrf_blocked = [
        "localhost",
        "127.",
        "0.0.0.0",
        "[::1]",
        "::1",
        "10.",
        "192.168.",
        "169.254.",
        "[fc",      // IPv6 ULA (fc00::/7)
        "[fd",      // IPv6 ULA (fd00::/8)
        "[fe80:",   // IPv6 link-local
        "[::ffff:", // IPv4-mapped IPv6
    ];
    if ssrf_blocked.iter().any(|p| normalized.starts_with(p)) {
        return Err(NoteDeckError::InvalidInput(
            "Loopback and private addresses are not allowed".to_string(),
        ));
    }
    // 172.16.0.0/12
    if normalized.starts_with("172.") {
        if let Some(second) = normalized
            .strip_prefix("172.")
            .and_then(|s| s.split('.').next())
        {
            if let Ok(n) = second.parse::<u8>() {
                if (16..=31).contains(&n) {
                    return Err(NoteDeckError::InvalidInput(
                        "Loopback and private addresses are not allowed".to_string(),
                    ));
                }
            }
        }
    }
    // Block reserved TLDs
    if normalized.ends_with(".local")
        || normalized.ends_with(".internal")
        || normalized.ends_with(".localhost")
    {
        return Err(NoteDeckError::InvalidInput(
            "Reserved domain names are not allowed".to_string(),
        ));
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- extract_ogp_urls ---

    #[test]
    fn extract_urls_from_text() {
        let text = "Check https://example.com/article and https://blog.example.com/post";
        let urls = extract_ogp_urls(text);
        assert_eq!(urls.len(), 2);
        assert!(urls.contains(&"https://example.com/article".to_string()));
    }

    #[test]
    fn skip_media_urls() {
        let text = "Image: https://example.com/photo.jpg and https://example.com/video.mp4";
        let urls = extract_ogp_urls(text);
        assert!(urls.is_empty());
    }

    #[test]
    fn skip_media_with_query_params() {
        let text = "https://example.com/image.png?w=800";
        let urls = extract_ogp_urls(text);
        assert!(urls.is_empty());
    }

    #[test]
    fn extract_non_media_urls_only() {
        let text = "See https://example.com/page and https://example.com/photo.webp";
        let urls = extract_ogp_urls(text);
        assert_eq!(urls.len(), 1);
        assert_eq!(urls[0], "https://example.com/page");
    }

    #[test]
    fn empty_text_no_urls() {
        assert!(extract_ogp_urls("").is_empty());
        assert!(extract_ogp_urls("no urls here").is_empty());
    }

    // --- validate_host ---

    #[test]
    fn valid_host() {
        assert_eq!(validate_host("Misskey.IO").unwrap(), "misskey.io");
    }

    #[test]
    fn valid_host_trims_whitespace() {
        assert_eq!(validate_host("  example.com  ").unwrap(), "example.com");
    }

    #[test]
    fn reject_empty_host() {
        assert!(validate_host("").is_err());
        assert!(validate_host("   ").is_err());
    }

    #[test]
    fn reject_host_with_path() {
        assert!(validate_host("example.com/path").is_err());
    }

    #[test]
    fn reject_localhost() {
        assert!(validate_host("localhost").is_err());
        assert!(validate_host("localhost:3000").is_err());
    }

    #[test]
    fn reject_loopback_ipv4() {
        assert!(validate_host("127.0.0.1").is_err());
        assert!(validate_host("127.0.0.1:8080").is_err());
    }

    #[test]
    fn e2e_allowlist_bypasses_ssrf_guard_for_exact_match_only() {
        // 他テストと衝突しない値を使う (env はプロセス全体で共有されるため)
        // SAFETY: テスト専用。並行テストは別の値を検証しており影響しない。
        unsafe { std::env::set_var("NOTEDECK_E2E_ALLOW_HOSTS", "127.0.0.1:39821") };
        assert_eq!(
            validate_host("127.0.0.1:39821").unwrap(),
            "127.0.0.1:39821"
        );
        // 列挙外の loopback は引き続き拒否
        assert!(validate_host("127.0.0.1:39999").is_err());
        unsafe { std::env::remove_var("NOTEDECK_E2E_ALLOW_HOSTS") };
    }

    #[test]
    fn reject_private_ranges() {
        assert!(validate_host("10.0.0.1").is_err());
        assert!(validate_host("192.168.1.1").is_err());
        assert!(validate_host("172.16.0.1").is_err());
        assert!(validate_host("172.31.255.255").is_err());
    }

    #[test]
    fn allow_172_outside_private() {
        // 172.15.x.x and 172.32.x.x are public
        assert!(validate_host("172.15.0.1").is_ok());
        assert!(validate_host("172.32.0.1").is_ok());
    }

    #[test]
    fn reject_ipv6_loopback() {
        assert!(validate_host("[::1]").is_err());
        assert!(validate_host("::1").is_err());
    }

    #[test]
    fn reject_reserved_tlds() {
        assert!(validate_host("myserver.local").is_err());
        assert!(validate_host("app.internal").is_err());
        assert!(validate_host("test.localhost").is_err());
    }

    #[test]
    fn reject_long_host() {
        let long = "a".repeat(254);
        assert!(validate_host(&long).is_err());
    }

    // --- AuthSessionTracker ---

    #[test]
    fn auth_session_register_and_consume() {
        let tracker = AuthSessionTracker::new();
        tracker.register("sess-1", "misskey.io");
        assert!(tracker.consume("sess-1", "misskey.io").is_ok());
    }

    #[test]
    fn auth_session_double_consume_fails() {
        let tracker = AuthSessionTracker::new();
        tracker.register("sess-1", "misskey.io");
        tracker.consume("sess-1", "misskey.io").unwrap();
        assert!(tracker.consume("sess-1", "misskey.io").is_err());
    }

    #[test]
    fn auth_session_host_mismatch() {
        let tracker = AuthSessionTracker::new();
        tracker.register("sess-1", "misskey.io");
        let err = tracker.consume("sess-1", "evil.com").unwrap_err();
        assert!(err.to_string().contains("Host mismatch"));
    }

    #[test]
    fn auth_session_unknown_id() {
        let tracker = AuthSessionTracker::new();
        assert!(tracker.consume("nonexistent", "misskey.io").is_err());
    }

    // --- CredentialCache ---

    #[test]
    fn credential_cache_insert_and_get() {
        let cache = CredentialCache::new();
        cache.insert("acc-1", "misskey.io", "token-123");
        let (host, token) = cache.get("acc-1").unwrap();
        assert_eq!(host, "misskey.io");
        assert_eq!(token, "token-123");
    }

    #[test]
    fn credential_cache_miss() {
        let cache = CredentialCache::new();
        assert!(cache.get("nonexistent").is_none());
    }

    #[test]
    fn credential_cache_invalidate() {
        let cache = CredentialCache::new();
        cache.insert("acc-1", "misskey.io", "token");
        cache.invalidate("acc-1");
        assert!(cache.get("acc-1").is_none());
    }
}
