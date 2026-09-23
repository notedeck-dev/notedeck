use async_trait::async_trait;
use std::sync::LazyLock;

use super::{Plugin, PluginError, SummaryData};
use crate::ogp::Player;

static VIDEO_ID_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"/(sm|nm|so)\d+").unwrap());

pub struct NiconicoPlugin;
pub const PLUGIN: NiconicoPlugin = NiconicoPlugin;

#[async_trait]
impl Plugin for NiconicoPlugin {
    fn test(&self, url: &url::Url) -> bool {
        let host = url.host_str().unwrap_or("");
        let is_nico = host == "www.nicovideo.jp"
            || host == "nicovideo.jp"
            || host == "sp.nicovideo.jp"
            || host == "nico.ms";
        is_nico && VIDEO_ID_RE.is_match(url.path())
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        let video_id = VIDEO_ID_RE
            .find(url.path())
            .map(|m| &m.as_str()[1..]) // strip leading '/'
            .ok_or_else(|| PluginError::ParseFailed("no video ID found".to_string()))?;

        // Use getthumbinfo API (no auth required, returns XML)
        let api_url = format!("https://ext.nicovideo.jp/api/getthumbinfo/{video_id}");
        let resp = client
            .get(&api_url)
            .send()
            .await
            .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

        if !resp.status().is_success() {
            return Err(PluginError::HttpStatus(resp.status().as_u16()));
        }

        let xml = resp
            .text()
            .await
            .map_err(|e| PluginError::ParseFailed(e.to_string()))?;

        let title = extract_xml_tag(&xml, "title");
        let description = extract_xml_tag(&xml, "description");
        let thumbnail = extract_xml_tag(&xml, "thumbnail_url");
        let icon = extract_xml_tag(&xml, "user_icon_url");

        // embeddable=1 の動画のみ embed プレイヤーを付与
        let player = if extract_xml_tag(&xml, "embeddable").as_deref() == Some("1") {
            Some(Player {
                url: format!("https://embed.nicovideo.jp/watch/{video_id}"),
                width: Some(640),
                height: Some(360),
                allow: vec!["autoplay".to_string(), "fullscreen".to_string()],
            })
        } else {
            None
        };

        Ok(SummaryData {
            title,
            description,
            icon,
            sitename: Some("ニコニコ動画".to_string()),
            thumbnail,
            medias: Vec::new(),
            player,
            url: url.to_string(),
            sensitive: false,
        })
    }
}

/// Simple XML tag value extractor.
fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let value = xml[start..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}
