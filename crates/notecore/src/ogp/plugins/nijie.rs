use async_trait::async_trait;
use serde::Deserialize;
use std::sync::LazyLock;

use super::{Plugin, PluginError, SummaryData};

pub struct NijiePlugin;
pub const PLUGIN: NijiePlugin = NijiePlugin;

static JSON_LD_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<script[^>]+type="application/ld\+json"[^>]*>([\s\S]*?)</script>"#)
        .unwrap()
});

#[derive(Debug, Deserialize)]
struct JsonLd {
    name: Option<String>,
    description: Option<String>,
    #[serde(rename = "thumbnailUrl")]
    thumbnail_url: Option<String>,
}

#[async_trait]
impl Plugin for NijiePlugin {
    fn test(&self, url: &url::Url) -> bool {
        matches!(url.host_str(), Some("nijie.info" | "www.nijie.info"))
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

        // Try JSON-LD for richer metadata (summaly approach)
        for cap in JSON_LD_RE.captures_iter(&html) {
            if let Some(json_str) = cap.get(1) {
                let cleaned = json_str.as_str().replace('\n', "\\n").replace('\r', "");
                if let Ok(ld) = serde_json::from_str::<JsonLd>(&cleaned) {
                    if data.title.is_none() {
                        data.title = ld.name;
                    }
                    if data.description.is_none() {
                        data.description = ld.description;
                    }
                    if data.thumbnail.is_none() {
                        data.thumbnail = ld.thumbnail_url;
                    }
                }
            }
        }

        data.sensitive = true;
        data.sitename = Some("ニジエ".to_string());
        Ok(data)
    }
}
