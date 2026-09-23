use async_trait::async_trait;

use super::{Plugin, PluginError, SummaryData};

pub struct IwaraPlugin;
pub const PLUGIN: IwaraPlugin = IwaraPlugin;

#[async_trait]
impl Plugin for IwaraPlugin {
    fn test(&self, url: &url::Url) -> bool {
        matches!(
            url.host_str(),
            Some("www.iwara.tv" | "iwara.tv" | "ecchi.iwara.tv")
        )
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
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
            .map_err(|e| PluginError::ParseFailed(e.to_string()))?;

        let mut data = crate::ogp::parser::parse_html(&html, &final_url);
        data.sensitive = true;
        data.sitename = Some("Iwara".to_string());
        Ok(data)
    }
}
