use async_trait::async_trait;

use super::{Plugin, PluginError, SummaryData};

pub struct XfolioPlugin;
pub const PLUGIN: XfolioPlugin = XfolioPlugin;

#[async_trait]
impl Plugin for XfolioPlugin {
    fn test(&self, url: &url::Url) -> bool {
        matches!(url.host_str(), Some("xfolio.jp" | "www.xfolio.jp"))
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

        // reCAPTCHA bot protection: OGP tags are present but all empty
        if html.contains("/system/recaptcha") {
            return Ok(SummaryData {
                title: Some("xfolio - Bot保護によりプレビューできません".to_string()),
                description: None,
                icon: None,
                sitename: Some("xfolio".to_string()),
                thumbnail: None,
                medias: vec![],
                player: None,
                url: url.to_string(),
                sensitive: false,
            });
        }

        let mut data = crate::ogp::parser::parse_html(&html, &final_url);

        // R18/R18G content detection
        if html.contains("class=\"tags__example_list age_limit\"")
            || html.contains("data-is_r18g_portfolio=\"1\"")
        {
            data.sensitive = true;
        }

        data.sitename = Some("xfolio".to_string());
        Ok(data)
    }
}
