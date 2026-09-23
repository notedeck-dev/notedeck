use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::perf_config::SharedPerfConfig;

/// Sliding window duration
const WINDOW_DURATION: Duration = Duration::from_secs(60);
/// Default max requests per host (used in tests)
#[cfg(test)]
const DEFAULT_MAX_REQUESTS_PER_WINDOW: usize = 200;

/// Per-host sliding window rate limiter.
///
/// Tracks request timestamps per Misskey host and rejects requests that exceed
/// the configured threshold, preventing upstream servers from blocking this client.
#[derive(Clone)]
pub struct RateLimiter {
    windows: Arc<RwLock<HashMap<String, VecDeque<Instant>>>>,
    perf: SharedPerfConfig,
}

impl RateLimiter {
    pub fn new(perf: SharedPerfConfig) -> Self {
        Self {
            windows: Arc::new(RwLock::new(HashMap::new())),
            perf,
        }
    }

    /// Check if a request to `host` is allowed. Returns `true` if within limit.
    pub async fn check(&self, host: &str) -> bool {
        let max_requests = self.perf.read().await.max_requests_per_window;
        let now = Instant::now();
        let mut windows = self.windows.write().await;
        let window = windows.entry(host.to_string()).or_default();

        // Evict expired entries
        while window
            .front()
            .is_some_and(|&t| now.duration_since(t) > WINDOW_DURATION)
        {
            window.pop_front();
        }

        if window.len() >= max_requests {
            false
        } else {
            window.push_back(now);
            true
        }
    }

    /// Remove stale host entries (call periodically from a background task).
    pub async fn cleanup(&self) {
        let now = Instant::now();
        let mut windows = self.windows.write().await;
        windows.retain(|_, w| {
            w.back()
                .is_some_and(|&t| now.duration_since(t) <= WINDOW_DURATION)
        });
    }
}

/// Extract the Misskey host segment from `/api/{host}/...`.
///
/// Returns `None` for non-host paths (deck, commands, events, etc.)
/// so that only upstream-proxied routes are rate-limited.
fn extract_host_from_path(path: &str) -> Option<&str> {
    let rest = path.strip_prefix("/api/")?;
    let end = rest.find('/')?;
    let segment = &rest[..end];
    // Skip internal route prefixes that are not remote hosts
    if matches!(
        segment,
        "deck" | "commands" | "events" | "openapi.json" | "accounts" | "docs"
    ) {
        return None;
    }
    Some(segment)
}

/// Axum middleware that enforces per-host rate limits on Misskey API proxy routes.
pub async fn rate_limit_middleware(
    State(limiter): State<RateLimiter>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    if let Some(host) = extract_host_from_path(req.uri().path()) {
        if !limiter.check(host).await {
            tracing::warn!(host, "rate limit exceeded");
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({
                    "error": "RATE_LIMITED",
                    "message": format!("Too many requests to {host}. Try again later.")
                })),
            )
                .into_response());
        }
    }
    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_host_from_path() {
        assert_eq!(
            extract_host_from_path("/api/misskey.io/timeline/home"),
            Some("misskey.io")
        );
        assert_eq!(
            extract_host_from_path("/api/example.com/notes/abc"),
            Some("example.com")
        );
        // Internal paths should return None
        assert_eq!(extract_host_from_path("/api/deck/columns"), None);
        assert_eq!(extract_host_from_path("/api/commands/list"), None);
        assert_eq!(extract_host_from_path("/api/events"), None);
        assert_eq!(extract_host_from_path("/api/accounts"), None);
        // No sub-path → None
        assert_eq!(extract_host_from_path("/api/misskey.io"), None);
        // Unrelated path
        assert_eq!(extract_host_from_path("/proxy/image"), None);
    }

    #[tokio::test]
    async fn test_rate_limiter_allows_within_limit() {
        let limiter = RateLimiter::new(std::sync::Arc::new(tokio::sync::RwLock::new(
            crate::perf_config::PerformanceConfig::default(),
        )));
        for _ in 0..DEFAULT_MAX_REQUESTS_PER_WINDOW {
            assert!(limiter.check("test.host").await);
        }
        // Next request should be rejected
        assert!(!limiter.check("test.host").await);
    }

    #[tokio::test]
    async fn test_rate_limiter_independent_hosts() {
        let limiter = RateLimiter::new(std::sync::Arc::new(tokio::sync::RwLock::new(
            crate::perf_config::PerformanceConfig::default(),
        )));
        for _ in 0..DEFAULT_MAX_REQUESTS_PER_WINDOW {
            limiter.check("host-a.example").await;
        }
        // host-a is full, but host-b should still be allowed
        assert!(limiter.check("host-b.example").await);
    }

    #[tokio::test]
    async fn test_cleanup_removes_stale_entries() {
        let limiter = RateLimiter::new(std::sync::Arc::new(tokio::sync::RwLock::new(
            crate::perf_config::PerformanceConfig::default(),
        )));
        limiter.check("stale.host").await;

        // Manually inject an old timestamp
        {
            let mut windows = limiter.windows.write().await;
            let window = windows.get_mut("stale.host").unwrap();
            window.clear();
            window.push_back(Instant::now() - WINDOW_DURATION - Duration::from_secs(1));
        }

        limiter.cleanup().await;

        let windows = limiter.windows.read().await;
        assert!(!windows.contains_key("stale.host"));
    }
}
