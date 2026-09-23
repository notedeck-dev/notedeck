use async_trait::async_trait;

use super::{extract_iframe_src, fetch_oembed, Plugin, PluginError, SummaryData};
use crate::ogp::Player;

pub struct YouTubePlugin;
pub const PLUGIN: YouTubePlugin = YouTubePlugin;

#[async_trait]
impl Plugin for YouTubePlugin {
    fn test(&self, url: &url::Url) -> bool {
        matches!(
            url.host_str(),
            Some(
                "www.youtube.com"
                    | "youtube.com"
                    | "m.youtube.com"
                    | "music.youtube.com"
                    | "youtu.be"
            )
        )
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        let mut endpoint = url::Url::parse("https://www.youtube.com/oembed").unwrap();
        endpoint
            .query_pairs_mut()
            .append_pair("url", url.as_str())
            .append_pair("format", "json");
        let oembed = fetch_oembed(client, endpoint.as_str()).await?;

        let player = oembed
            .html
            .as_deref()
            .and_then(extract_iframe_src)
            .map(|src| {
                // Replace youtube.com with youtube-nocookie.com for privacy
                let nocookie = src.replace("youtube.com/", "youtube-nocookie.com/");
                Player {
                    url: nocookie,
                    width: oembed.width,
                    height: oembed.height,
                    allow: vec!["autoplay".to_string(), "encrypted-media".to_string()],
                }
            });

        Ok(SummaryData {
            title: oembed.title,
            description: oembed.author_name.map(|a| format!("by {a}")),
            icon: None,
            sitename: oembed.provider_name,
            thumbnail: oembed.thumbnail_url,
            medias: Vec::new(),
            player,
            url: url.to_string(),
            sensitive: false,
        })
    }
}
