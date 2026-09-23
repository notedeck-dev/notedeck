mod amazon;
mod apple_music;
mod bluesky;
mod dlsite;
mod iwara;
mod komiflo;
mod niconico;
mod nijie;
mod pixiv;
mod soundcloud;
mod spotify;
mod tiktok;
mod twitter;
mod xfolio;
mod youtube;

use async_trait::async_trait;
use std::fmt;
use std::sync::LazyLock;

use super::SummaryData;

/// Error type for plugin operations.
#[derive(Debug)]
pub enum PluginError {
    /// The fetched URL returned a non-success HTTP status.
    HttpStatus(u16),
    /// Network or connection error.
    FetchFailed(String),
    /// Failed to parse the response body.
    ParseFailed(String),
}

impl fmt::Display for PluginError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::HttpStatus(code) => write!(f, "HTTP {code}"),
            Self::FetchFailed(msg) => write!(f, "fetch failed: {msg}"),
            Self::ParseFailed(msg) => write!(f, "parse failed: {msg}"),
        }
    }
}

/// A plugin that handles specific URL patterns.
///
/// # Adding a new plugin
///
/// 1. Create a new file under `plugins/` (e.g. `plugins/youtube.rs`)
/// 2. Define a unit struct and implement this trait:
///
/// ```ignore
/// pub struct YouTubePlugin;
/// pub const PLUGIN: YouTubePlugin = YouTubePlugin;
///
/// #[async_trait]
/// impl Plugin for YouTubePlugin {
///     fn test(&self, url: &url::Url) -> bool {
///         matches!(url.host_str(), Some("www.youtube.com" | "youtube.com" | "youtu.be"))
///     }
///
///     async fn summarize(&self, url: &url::Url, client: &reqwest::Client)
///         -> Result<SummaryData, PluginError>
///     {
///         // fetch oEmbed, build SummaryData ...
///     }
/// }
/// ```
///
/// 3. Add `mod youtube;` and `&youtube::PLUGIN` to [`all()`] below.
#[async_trait]
pub trait Plugin: Send + Sync {
    /// Return `true` if this plugin handles the given URL.
    fn test(&self, url: &url::Url) -> bool;

    /// Fetch and return summary data for the URL.
    /// Only called when [`test`] returned `true`.
    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError>;
}

/// All registered plugins, tried in order.
pub fn all() -> &'static [&'static dyn Plugin] {
    &[
        &twitter::PLUGIN,
        &bluesky::PLUGIN,
        &youtube::PLUGIN,
        &spotify::PLUGIN,
        &soundcloud::PLUGIN,
        &niconico::PLUGIN,
        &pixiv::PLUGIN,
        &tiktok::PLUGIN,
        &apple_music::PLUGIN,
        &dlsite::PLUGIN,
        &nijie::PLUGIN,
        &iwara::PLUGIN,
        &komiflo::PLUGIN,
        &amazon::PLUGIN,
        &xfolio::PLUGIN,
    ]
}

// --- oEmbed helpers ---

/// Shared oEmbed response structure for plugins that use oEmbed endpoints.
#[derive(Debug, serde::Deserialize)]
pub struct OEmbedResponse {
    pub title: Option<String>,
    pub author_name: Option<String>,
    pub thumbnail_url: Option<String>,
    pub provider_name: Option<String>,
    pub html: Option<String>,
    #[serde(default, deserialize_with = "flexible_u32")]
    pub width: Option<u32>,
    #[serde(default, deserialize_with = "flexible_u32")]
    pub height: Option<u32>,
}

/// Deserialize a value that may be a number or a non-numeric string (e.g. "100%").
fn flexible_u32<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let v = serde_json::Value::deserialize(deserializer)?;
    match &v {
        serde_json::Value::Number(n) => Ok(n.as_u64().map(|n| n as u32)),
        serde_json::Value::String(s) => Ok(s.parse().ok()),
        _ => Ok(None),
    }
}

/// Regex to extract iframe `src` from oEmbed HTML snippets.
static IFRAME_SRC_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r#"<iframe[^>]+src="([^"]+)""#).unwrap());

/// Extract iframe `src` URL from an oEmbed HTML snippet.
pub fn extract_iframe_src(html: &str) -> Option<String> {
    IFRAME_SRC_RE
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

/// Fetch an oEmbed JSON response from the given endpoint URL.
pub async fn fetch_oembed(
    client: &reqwest::Client,
    endpoint: &str,
) -> Result<OEmbedResponse, PluginError> {
    let resp = client
        .get(endpoint)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(PluginError::HttpStatus(resp.status().as_u16()));
    }

    resp.json()
        .await
        .map_err(|e| PluginError::ParseFailed(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> url::Url {
        url::Url::parse(s).unwrap()
    }

    // --- extract_iframe_src ---

    #[test]
    fn extract_iframe_src_found() {
        let html = r#"<iframe width="560" height="315" src="https://www.youtube.com/embed/abc" frameborder="0"></iframe>"#;
        assert_eq!(
            extract_iframe_src(html).as_deref(),
            Some("https://www.youtube.com/embed/abc")
        );
    }

    #[test]
    fn extract_iframe_src_missing() {
        assert!(extract_iframe_src("<div>no iframe</div>").is_none());
    }

    // --- Plugin URL matching ---

    #[test]
    fn youtube_plugin_matches() {
        let plugins = all();
        let yt = plugins
            .iter()
            .find(|p| p.test(&url("https://www.youtube.com/watch?v=abc")))
            .unwrap();
        assert!(yt.test(&url("https://youtube.com/watch?v=abc")));
        assert!(yt.test(&url("https://youtu.be/abc")));
        assert!(yt.test(&url("https://m.youtube.com/watch?v=abc")));
    }

    #[test]
    fn youtube_does_not_match_other() {
        let plugins = all();
        let yt = plugins
            .iter()
            .find(|p| p.test(&url("https://www.youtube.com/watch?v=abc")))
            .unwrap();
        assert!(!yt.test(&url("https://example.com")));
    }

    #[test]
    fn twitter_plugin_matches() {
        let plugins = all();
        let tw = plugins
            .iter()
            .find(|p| p.test(&url("https://x.com/user/status/123")))
            .unwrap();
        assert!(tw.test(&url("https://twitter.com/user/status/123")));
        assert!(tw.test(&url("https://x.com/user/status/123")));
        // fxtwitter/vxtwitter are third-party services, not handled by the Twitter plugin
    }

    #[test]
    fn spotify_plugin_matches() {
        let plugins = all();
        let sp = plugins
            .iter()
            .find(|p| p.test(&url("https://open.spotify.com/track/abc")));
        assert!(sp.is_some());
    }

    #[test]
    fn niconico_plugin_matches() {
        let plugins = all();
        let nico = plugins
            .iter()
            .find(|p| p.test(&url("https://www.nicovideo.jp/watch/sm123")));
        assert!(nico.is_some());
        let nico2 = plugins
            .iter()
            .find(|p| p.test(&url("https://nico.ms/sm123")));
        assert!(nico2.is_some());
    }

    #[test]
    fn no_plugin_matches_random_url() {
        let plugins = all();
        assert!(!plugins
            .iter()
            .any(|p| p.test(&url("https://example.com/page"))));
    }

    // --- flexible_u32 deserialization ---

    #[test]
    fn flexible_u32_from_number() {
        let json = r#"{"width": 640, "height": 360}"#;
        #[derive(serde::Deserialize)]
        struct T {
            #[serde(deserialize_with = "flexible_u32")]
            width: Option<u32>,
        }
        let t: T = serde_json::from_str(json).unwrap();
        assert_eq!(t.width, Some(640));
    }

    #[test]
    fn flexible_u32_from_string() {
        let json = r#"{"width": "800"}"#;
        #[derive(serde::Deserialize)]
        struct T {
            #[serde(deserialize_with = "flexible_u32")]
            width: Option<u32>,
        }
        let t: T = serde_json::from_str(json).unwrap();
        assert_eq!(t.width, Some(800));
    }

    #[test]
    fn flexible_u32_from_percentage_returns_none() {
        let json = r#"{"width": "100%"}"#;
        #[derive(serde::Deserialize)]
        struct T {
            #[serde(deserialize_with = "flexible_u32")]
            width: Option<u32>,
        }
        let t: T = serde_json::from_str(json).unwrap();
        assert_eq!(t.width, None);
    }

    #[test]
    fn flexible_u32_from_null() {
        let json = r#"{"width": null}"#;
        #[derive(serde::Deserialize)]
        struct T {
            #[serde(deserialize_with = "flexible_u32")]
            width: Option<u32>,
        }
        let t: T = serde_json::from_str(json).unwrap();
        assert_eq!(t.width, None);
    }
}
