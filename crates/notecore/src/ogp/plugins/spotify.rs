use async_trait::async_trait;

use super::{extract_iframe_src, fetch_oembed, Plugin, PluginError, SummaryData};
use crate::ogp::Player;

pub struct SpotifyPlugin;
pub const PLUGIN: SpotifyPlugin = SpotifyPlugin;

#[async_trait]
impl Plugin for SpotifyPlugin {
    fn test(&self, url: &url::Url) -> bool {
        url.host_str() == Some("open.spotify.com")
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        let mut endpoint = url::Url::parse("https://open.spotify.com/oembed").unwrap();
        endpoint.query_pairs_mut().append_pair("url", url.as_str());
        let oembed = fetch_oembed(client, endpoint.as_str()).await?;

        let player = oembed
            .html
            .as_deref()
            .and_then(extract_iframe_src)
            .map(|src| Player {
                url: src,
                width: oembed.width,
                height: oembed.height,
                allow: vec![
                    "autoplay".to_string(),
                    "clipboard-write".to_string(),
                    "encrypted-media".to_string(),
                ],
            });

        Ok(SummaryData {
            title: oembed.title,
            description: None,
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
