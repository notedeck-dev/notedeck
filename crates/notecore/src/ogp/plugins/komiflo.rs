use async_trait::async_trait;
use serde::Deserialize;
use std::sync::LazyLock;

use super::{Plugin, PluginError, SummaryData};

pub struct KomifloPlugin;
pub const PLUGIN: KomifloPlugin = KomifloPlugin;

static COMIC_ID_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"/comics/(\d+)").unwrap());

#[derive(Debug, Deserialize)]
struct KomifloContent {
    title: Option<String>,
    named_imgs: Option<KomifloImages>,
    children: Option<Vec<KomifloContent>>,
}

#[derive(Debug, Deserialize)]
struct KomifloImages {
    cover: Option<KomifloImage>,
}

#[derive(Debug, Deserialize)]
struct KomifloImage {
    filename: Option<String>,
}

#[async_trait]
impl Plugin for KomifloPlugin {
    fn test(&self, url: &url::Url) -> bool {
        url.host_str() == Some("komiflo.com") && COMIC_ID_RE.is_match(url.path())
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        let id = COMIC_ID_RE
            .captures(url.path())
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
            .ok_or_else(|| PluginError::ParseFailed("no comic ID".into()))?;

        let api_url = format!("https://api.komiflo.com/content/id/{id}");
        let resp = client
            .get(&api_url)
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(PluginError::HttpStatus(resp.status().as_u16()));
        }

        let content: KomifloContent = resp
            .json()
            .await
            .map_err(|e| PluginError::ParseFailed(e.to_string()))?;

        let thumbnail = extract_cover(&content)
            .map(|filename| format!("https://t.komiflo.com/346_mobile/{filename}"));

        Ok(SummaryData {
            title: content.title,
            description: None,
            icon: None,
            sitename: Some("Komiflo".to_string()),
            thumbnail,
            medias: Vec::new(),
            player: None,
            url: url.to_string(),
            sensitive: true,
        })
    }
}

fn extract_cover(content: &KomifloContent) -> Option<&str> {
    content
        .named_imgs
        .as_ref()
        .and_then(|imgs| imgs.cover.as_ref())
        .and_then(|cover| cover.filename.as_deref())
        .or_else(|| {
            content
                .children
                .as_ref()
                .and_then(|children| children.first())
                .and_then(|child| {
                    child
                        .named_imgs
                        .as_ref()
                        .and_then(|imgs| imgs.cover.as_ref())
                        .and_then(|cover| cover.filename.as_deref())
                })
        })
}
