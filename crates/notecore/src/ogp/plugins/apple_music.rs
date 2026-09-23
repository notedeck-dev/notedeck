use async_trait::async_trait;

use super::{Plugin, PluginError, SummaryData};
use crate::ogp::Player;

pub struct AppleMusicPlugin;
pub const PLUGIN: AppleMusicPlugin = AppleMusicPlugin;

#[async_trait]
impl Plugin for AppleMusicPlugin {
    fn test(&self, url: &url::Url) -> bool {
        url.host_str() == Some("music.apple.com")
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        // Fetch OGP from the page
        let resp = client
            .get(url.as_str())
            .header("Accept", "text/html")
            .send()
            .await
            .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(PluginError::HttpStatus(resp.status().as_u16()));
        }

        let final_url = resp.url().to_string();
        let html = resp
            .text()
            .await
            .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

        let mut data = crate::ogp::parser::parse_html(&html, &final_url);

        // Build embed URL: music.apple.com → embed.music.apple.com
        let embed_url = format!("https://embed.music.apple.com{}", url.path());

        // Height depends on content type (album has tracklist)
        let is_album = url.path().contains("/album/");
        let height = if is_album { 450 } else { 175 };

        data.player = Some(Player {
            url: embed_url,
            width: Some(660),
            height: Some(height),
            allow: vec!["autoplay".to_string(), "encrypted-media".to_string()],
        });

        Ok(data)
    }
}
