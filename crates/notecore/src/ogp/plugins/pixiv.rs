use async_trait::async_trait;

use super::{fetch_oembed, Plugin, PluginError, SummaryData};

pub struct PixivPlugin;
pub const PLUGIN: PixivPlugin = PixivPlugin;

#[async_trait]
impl Plugin for PixivPlugin {
    fn test(&self, url: &url::Url) -> bool {
        matches!(url.host_str(), Some("www.pixiv.net" | "pixiv.net"))
            && url.path().contains("/artworks/")
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        let mut endpoint = url::Url::parse("https://embed.pixiv.net/oembed.php").unwrap();
        endpoint
            .query_pairs_mut()
            .append_pair("url", url.as_str())
            .append_pair("format", "json");
        let oembed = fetch_oembed(client, endpoint.as_str()).await?;

        // pixiv embed iframe is behind Cloudflare challenge and won't render
        // in Tauri WebView, so we only use the thumbnail image via proxy.
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
