use async_trait::async_trait;

use super::{fetch_oembed, Plugin, PluginError, SummaryData};

pub struct TikTokPlugin;
pub const PLUGIN: TikTokPlugin = TikTokPlugin;

#[async_trait]
impl Plugin for TikTokPlugin {
    fn test(&self, url: &url::Url) -> bool {
        matches!(
            url.host_str(),
            Some("www.tiktok.com" | "tiktok.com" | "m.tiktok.com" | "vm.tiktok.com")
        )
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        let mut endpoint = url::Url::parse("https://www.tiktok.com/oembed").unwrap();
        endpoint.query_pairs_mut().append_pair("url", url.as_str());
        let oembed = fetch_oembed(client, endpoint.as_str()).await?;

        Ok(SummaryData {
            title: oembed.title,
            description: oembed.author_name.map(|a| format!("by {a}")),
            icon: None,
            sitename: oembed.provider_name,
            thumbnail: oembed.thumbnail_url,
            medias: Vec::new(),
            player: None,
            url: url.to_string(),
            sensitive: false,
        })
    }
}
