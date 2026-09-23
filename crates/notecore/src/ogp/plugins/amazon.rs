use async_trait::async_trait;

use super::{Plugin, PluginError, SummaryData};

pub struct AmazonPlugin;
pub const PLUGIN: AmazonPlugin = AmazonPlugin;

const AMAZON_SUFFIXES: &[&str] = &[
    "amazon.co.jp",
    "amazon.com",
    "amazon.co.uk",
    "amazon.de",
    "amazon.fr",
    "amazon.it",
    "amazon.es",
    "amazon.ca",
    "amazon.com.au",
    "amazon.in",
    "amazon.com.br",
    "amazon.sg",
];

const SHORTLINK_HOSTS: &[&str] = &["amzn.to", "amzn.asia"];

fn is_amazon_host(host: &str) -> bool {
    let bare = host.strip_prefix("www.").unwrap_or(host);
    AMAZON_SUFFIXES.contains(&bare)
}

fn is_shortlink(host: &str) -> bool {
    SHORTLINK_HOSTS.contains(&host)
}

#[async_trait]
impl Plugin for AmazonPlugin {
    fn test(&self, url: &url::Url) -> bool {
        url.host_str()
            .is_some_and(|h| is_amazon_host(h) || is_shortlink(h))
    }

    async fn summarize(
        &self,
        url: &url::Url,
        client: &reqwest::Client,
    ) -> Result<SummaryData, PluginError> {
        let fetch_url = if url.host_str().is_some_and(is_shortlink) {
            resolve_shortlink(client, url.as_str()).await?
        } else {
            canonicalize(url)
        };

        let resp = client
            .get(&fetch_url)
            .header("Accept", "text/html,application/xhtml+xml")
            .header("Accept-Language", "ja,en;q=0.9")
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

        if data.thumbnail.is_none() {
            data.thumbnail = crate::ogp::parser::extract_amazon_product_image(&html)
                .or_else(|| crate::ogp::parser::extract_amazon_jsonld_image(&html));
        }
        if let Some(ref title) = data.title {
            data.title = Some(clean_title(title));
        }
        if data.sitename.is_none() {
            data.sitename = Some(make_sitename(&final_url));
        }

        Ok(data)
    }
}

// --- URL helpers ---

/// HEAD-follow redirects from a short-link, then canonicalize the resolved URL.
async fn resolve_shortlink(
    client: &reqwest::Client,
    short_url: &str,
) -> Result<String, PluginError> {
    let resp = client
        .head(short_url)
        .send()
        .await
        .map_err(|e| PluginError::FetchFailed(e.to_string()))?;

    let resolved = url::Url::parse(resp.url().as_str())
        .map_err(|e| PluginError::ParseFailed(e.to_string()))?;

    Ok(canonicalize(&resolved))
}

/// Strip tracking params and normalize to `/dp/{ASIN}` when possible.
fn canonicalize(url: &url::Url) -> String {
    if let Some(asin) = extract_asin(url.path()) {
        let host = url.host_str().unwrap_or("www.amazon.com");
        return format!("https://{host}/dp/{asin}");
    }
    let mut clean = url.clone();
    clean.set_query(None);
    clean.set_fragment(None);
    clean.to_string()
}

fn extract_asin(path: &str) -> Option<&str> {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    for (i, seg) in segments.iter().enumerate() {
        if (*seg == "dp" || *seg == "product") && i + 1 < segments.len() {
            let candidate = segments[i + 1];
            if candidate.len() == 10 && candidate.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Some(candidate);
            }
        }
    }
    None
}

// --- Text helpers ---

fn clean_title(title: &str) -> String {
    let title = title.trim();
    // Remove "Amazon.co.jp: " or "Amazon.com: " prefix
    if let Some(rest) = title.strip_prefix("Amazon") {
        if let Some(idx) = rest.find(": ") {
            return rest[idx + 2..].trim().to_string();
        }
    }
    title.to_string()
}

fn make_sitename(final_url: &str) -> String {
    let host = url::Url::parse(final_url)
        .ok()
        .and_then(|u| u.host_str().map(String::from))
        .unwrap_or_else(|| "amazon.com".to_string());
    let bare = host.strip_prefix("www.").unwrap_or(&host);
    let region = bare.strip_prefix("amazon.").unwrap_or(bare);
    format!("Amazon ({region})")
}
