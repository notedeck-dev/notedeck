use async_trait::async_trait;
use serde::Deserialize;

use super::{Plugin, PluginError, SummaryData};
use crate::ogp::Player;

pub struct TwitterPlugin;
pub const PLUGIN: TwitterPlugin = TwitterPlugin;

// FxTwitter API response (subset)
#[derive(Debug, Deserialize)]
struct FxResponse {
    tweet: Option<FxTweet>,
}

#[derive(Debug, Deserialize)]
struct FxTweet {
    text: Option<String>,
    author: Option<FxAuthor>,
    media: Option<FxMedia>,
    #[serde(rename = "possibly_sensitive")]
    sensitive: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct FxAuthor {
    name: Option<String>,
    screen_name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FxMedia {
    photos: Option<Vec<FxPhoto>>,
    videos: Option<Vec<FxVideo>>,
}

#[derive(Debug, Deserialize)]
struct FxPhoto {
    url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct FxVideo {
    url: Option<String>,
    thumbnail_url: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

#[async_trait]
impl Plugin for TwitterPlugin {
    fn test(&self, url: &url::Url) -> bool {
        let host = url.host_str().unwrap_or("");
        (host == "twitter.com"
            || host == "www.twitter.com"
            || host == "x.com"
            || host == "www.x.com")
            && url.path().contains("/status/")
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        // Build FxTwitter API URL from the original path
        // e.g. /user/status/123 -> https://api.fxtwitter.com/user/status/123
        let api_url = format!("https://api.fxtwitter.com{}", url.path());

        let resp = client
            .get(&api_url)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(PluginError::HttpStatus(resp.status().as_u16()));
        }

        let fx: FxResponse = resp
            .json()
            .await
            .map_err(|e| PluginError::ParseFailed(e.to_string()))?;

        let tweet = fx
            .tweet
            .ok_or_else(|| PluginError::ParseFailed("missing tweet field".to_string()))?;

        let author = tweet.author.as_ref();
        let title = match (
            author.and_then(|a| a.name.as_deref()),
            author.and_then(|a| a.screen_name.as_deref()),
        ) {
            (Some(name), Some(screen)) => Some(format!("{name} (@{screen})")),
            (Some(name), None) => Some(name.to_string()),
            (None, Some(screen)) => Some(format!("@{screen}")),
            _ => None,
        };

        let icon = author.and_then(|a| a.avatar_url.clone());

        // Thumbnail: first photo, or video thumbnail
        let media = tweet.media.as_ref();
        let thumbnail = media
            .and_then(|m| {
                m.photos
                    .as_ref()
                    .and_then(|ps| ps.first().and_then(|p| p.url.clone()))
            })
            .or_else(|| {
                media.and_then(|m| {
                    m.videos
                        .as_ref()
                        .and_then(|vs| vs.first().and_then(|v| v.thumbnail_url.clone()))
                })
            });

        // Additional photo URLs (for medias array)
        let medias: Vec<String> = media
            .and_then(|m| m.photos.as_ref())
            .map(|ps| ps.iter().filter_map(|p| p.url.clone()).collect())
            .unwrap_or_default();

        // Tweet embed player: extract tweet ID from path (e.g. /user/status/123)
        let player = url
            .path()
            .rsplit('/')
            .next()
            .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))
            .map(|tweet_id| Player {
                url: format!("https://platform.twitter.com/embed/Tweet.html?id={tweet_id}"),
                width: None,
                height: Some(350),
                allow: vec![],
            });

        Ok(SummaryData {
            title,
            description: tweet.text,
            icon,
            sitename: Some("X (Twitter)".to_string()),
            thumbnail,
            medias,
            player,
            url: url.to_string(),
            sensitive: tweet.sensitive.unwrap_or(false),
        })
    }
}
