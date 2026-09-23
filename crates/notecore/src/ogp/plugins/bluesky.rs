use async_trait::async_trait;
use serde::Deserialize;

use super::{Plugin, PluginError, SummaryData};

pub struct BlueskyPlugin;
pub const PLUGIN: BlueskyPlugin = BlueskyPlugin;

const PUBLIC_API: &str = "https://public.api.bsky.app/xrpc";

// AT Protocol API response types (subset)
#[derive(Debug, Deserialize)]
struct ResolveHandleResponse {
    did: String,
}

#[derive(Debug, Deserialize)]
struct GetPostsResponse {
    posts: Vec<BskyPostView>,
}

#[derive(Debug, Deserialize)]
struct BskyPostView {
    author: BskyAuthor,
    record: BskyRecord,
    embed: Option<BskyEmbedView>,
}

#[derive(Debug, Deserialize)]
struct BskyAuthor {
    handle: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    avatar: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BskyRecord {
    text: Option<String>,
}

// Embed views returned by the API
#[derive(Debug, Deserialize)]
#[serde(tag = "$type")]
#[allow(dead_code)]
enum BskyEmbedView {
    #[serde(rename = "app.bsky.embed.images#view")]
    Images { images: Vec<BskyImageView> },
    #[serde(rename = "app.bsky.embed.video#view")]
    Video {
        thumbnail: Option<String>,
        playlist: Option<String>,
        aspect_ratio: Option<BskyAspectRatio>,
    },
    #[serde(rename = "app.bsky.embed.external#view")]
    External { external: BskyExternalView },
    #[serde(rename = "app.bsky.embed.record#view")]
    Record { record: serde_json::Value },
    #[serde(rename = "app.bsky.embed.recordWithMedia#view")]
    RecordWithMedia {
        media: Box<BskyEmbedView>,
        record: serde_json::Value,
    },
}

#[derive(Debug, Deserialize)]
struct BskyImageView {
    thumb: Option<String>,
    fullsize: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BskyAspectRatio {
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct BskyExternalView {
    uri: Option<String>,
    title: Option<String>,
    description: Option<String>,
    thumb: Option<String>,
}

#[async_trait]
impl Plugin for BlueskyPlugin {
    fn test(&self, url: &url::Url) -> bool {
        matches!(url.host_str(), Some("bsky.app" | "www.bsky.app")) && url.path().contains("/post/")
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        // Parse URL: /profile/{handle}/post/{postId}
        let segments: Vec<&str> = url.path().trim_matches('/').split('/').collect();
        let (handle, post_id) = match segments.as_slice() {
            ["profile", handle, "post", post_id] => (*handle, *post_id),
            _ => return Err(PluginError::ParseFailed("invalid bsky URL path".into())),
        };

        // Step 1: Resolve handle → DID
        let resolve_url =
            format!("{PUBLIC_API}/com.atproto.identity.resolveHandle?handle={handle}");
        let did = fetch_json::<ResolveHandleResponse>(client, &resolve_url)
            .await?
            .did;

        // Step 2: Fetch post via getPosts
        let at_uri = format!("at://{did}/app.bsky.feed.post/{post_id}");
        let mut posts_url =
            url::Url::parse(&format!("{PUBLIC_API}/app.bsky.feed.getPosts")).unwrap();
        posts_url.query_pairs_mut().append_pair("uris", &at_uri);
        let posts_url = posts_url.as_str();
        let mut posts = fetch_json::<GetPostsResponse>(client, posts_url)
            .await?
            .posts;

        let post = if posts.is_empty() {
            return Err(PluginError::ParseFailed("post not found".into()));
        } else {
            posts.swap_remove(0)
        };

        // Build SummaryData
        let author = &post.author;
        let title = match &author.display_name {
            Some(name) => Some(format!("{name} (@{})", author.handle)),
            None => Some(format!("@{}", author.handle)),
        };

        let (thumbnail, medias) = extract_media(post.embed.as_ref());

        Ok(SummaryData {
            title,
            description: post.record.text,
            icon: author.avatar.clone(),
            sitename: Some("Bluesky".to_string()),
            thumbnail,
            medias,
            player: None,
            url: url.to_string(),
            sensitive: false,
        })
    }
}

fn extract_media(embed: Option<&BskyEmbedView>) -> (Option<String>, Vec<String>) {
    match embed {
        Some(BskyEmbedView::Images { images }) => {
            let urls: Vec<String> = images
                .iter()
                .filter_map(|img| img.fullsize.clone().or_else(|| img.thumb.clone()))
                .collect();
            let thumb = urls.first().cloned();
            (thumb, urls)
        }
        Some(BskyEmbedView::Video { thumbnail, .. }) => (thumbnail.clone(), Vec::new()),
        Some(BskyEmbedView::External { external }) => (external.thumb.clone(), Vec::new()),
        Some(BskyEmbedView::RecordWithMedia { media, .. }) => extract_media(Some(media)),
        _ => (None, Vec::new()),
    }
}

async fn fetch_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T, PluginError> {
    let resp = client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(PluginError::HttpStatus(resp.status().as_u16()));
    }

    resp.json()
        .await
        .map_err(|e| PluginError::ParseFailed(e.to_string()))
}
