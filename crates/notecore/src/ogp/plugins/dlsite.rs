use async_trait::async_trait;

use super::{Plugin, PluginError, SummaryData};

pub struct DLsitePlugin;
pub const PLUGIN: DLsitePlugin = DLsitePlugin;

/// R18 categories on DLsite.
const SENSITIVE_PATHS: &[&str] = &["/maniax/", "/girls/", "/bl/", "/gay/"];

#[async_trait]
impl Plugin for DLsitePlugin {
    fn test(&self, url: &url::Url) -> bool {
        matches!(url.host_str(), Some("www.dlsite.com" | "dlsite.com"))
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        let mut data = self.fetch_and_parse(client, url.as_str()).await?;

        // If 404, try swapping /announce/ ↔ /work/ path
        // (DLsite has both paths for the same product)
        if data.is_none() {
            let alt = swap_path(url.as_str());
            if let Some(alt_url) = alt {
                data = self.fetch_and_parse(client, &alt_url).await?;
            }
        }

        let mut summary = data.ok_or(PluginError::HttpStatus(404))?;

        // Detect sensitive content from URL path
        let path = url.path();
        summary.sensitive = SENSITIVE_PATHS.iter().any(|p| path.contains(p));

        Ok(summary)
    }
}

impl DLsitePlugin {
    async fn fetch_and_parse(
        &self,
        client: &reqwest::Client,
        url: &str,
    ) -> Result<Option<SummaryData>, PluginError> {
        let resp = client
            .get(url)
            .header("Accept", "text/html")
            .send()
            .await
            .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

        if resp.status().as_u16() == 404 {
            return Ok(None);
        }
        if !resp.status().is_success() {
            return Err(PluginError::HttpStatus(resp.status().as_u16()));
        }

        let final_url = resp.url().to_string();
        let html = resp
            .text()
            .await
            .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

        Ok(Some(crate::ogp::parser::parse_html(&html, &final_url)))
    }
}

fn swap_path(url: &str) -> Option<String> {
    if url.contains("/announce/") {
        Some(url.replace("/announce/", "/work/"))
    } else if url.contains("/work/") {
        Some(url.replace("/work/", "/announce/"))
    } else {
        None
    }
}
