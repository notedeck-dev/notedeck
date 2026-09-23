#[cfg(test)]
#[path = "parser_tests.rs"]
mod parser_tests;

use regex::Regex;
use std::sync::LazyLock;

use super::SummaryData;

// --- Regex patterns for meta/link/title extraction ---

/// Match `<meta property="..." content="...">` or `<meta content="..." property="...">`
static META_PROPERTY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<meta\s+(?:[^>]*?\s)?property\s*=\s*["']([^"']+)["'][^>]*?\scontent\s*=\s*["']([^"']*)["']|<meta\s+(?:[^>]*?\s)?content\s*=\s*["']([^"']*)["'][^>]*?\sproperty\s*=\s*["']([^"']+)["']"#,
    ).unwrap()
});

/// Match `<meta name="..." content="...">` or `<meta content="..." name="...">`
static META_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<meta\s+(?:[^>]*?\s)?name\s*=\s*["']([^"']+)["'][^>]*?\scontent\s*=\s*["']([^"']*)["']|<meta\s+(?:[^>]*?\s)?content\s*=\s*["']([^"']*)["'][^>]*?\sname\s*=\s*["']([^"']+)["']"#,
    ).unwrap()
});

/// Match `<title>...</title>`
static TITLE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)<title[^>]*>(.*?)</title>").unwrap());

/// Match `<link ... type="application/json+oembed" ... href="...">`
static OEMBED_LINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<link\s+[^>]*?type\s*=\s*["']application/json\+oembed["'][^>]*?href\s*=\s*["']([^"']+)["']|<link\s+[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?type\s*=\s*["']application/json\+oembed["']"#,
    ).unwrap()
});

/// Match `<link rel="icon|shortcut icon|apple-touch-icon" href="...">`
static ICON_LINK_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)<link\s+[^>]*?rel\s*=\s*["'](icon|shortcut icon|apple-touch-icon)["'][^>]*?href\s*=\s*["']([^"']+)["']|<link\s+[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?rel\s*=\s*["'](icon|shortcut icon|apple-touch-icon)["']"#,
    ).unwrap()
});

// --- Helpers to collect meta values ---

fn collect_meta_property(html: &str) -> Vec<(&str, &str)> {
    META_PROPERTY
        .captures_iter(html)
        .map(|c| {
            if let (Some(prop), Some(content)) = (c.get(1), c.get(2)) {
                (prop.as_str(), content.as_str())
            } else if let (Some(content), Some(prop)) = (c.get(3), c.get(4)) {
                (prop.as_str(), content.as_str())
            } else {
                ("", "")
            }
        })
        .filter(|(p, _)| !p.is_empty())
        .collect()
}

fn collect_meta_name(html: &str) -> Vec<(&str, &str)> {
    META_NAME
        .captures_iter(html)
        .map(|c| {
            if let (Some(name), Some(content)) = (c.get(1), c.get(2)) {
                (name.as_str(), content.as_str())
            } else if let (Some(content), Some(name)) = (c.get(3), c.get(4)) {
                (name.as_str(), content.as_str())
            } else {
                ("", "")
            }
        })
        .filter(|(n, _)| !n.is_empty())
        .collect()
}

fn find_property(props: &[(&str, &str)], key: &str) -> Option<String> {
    props
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn find_all_property(props: &[(&str, &str)], key: &str) -> Vec<String> {
    props
        .iter()
        .filter(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn find_name(names: &[(&str, &str)], key: &str) -> Option<String> {
    names
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Parse an HTML document into a SummaryData struct.
/// `final_url` is the URL after any redirects.
pub fn parse_html(html: &str, final_url: &str) -> SummaryData {
    let props = collect_meta_property(html);
    let names = collect_meta_name(html);

    let title = find_property(&props, "og:title")
        .or_else(|| find_name(&names, "twitter:title"))
        .or_else(|| {
            TITLE_RE
                .captures(html)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().trim().to_string())
                .filter(|s| !s.is_empty())
        });

    let description = find_property(&props, "og:description")
        .or_else(|| find_name(&names, "twitter:description"))
        .or_else(|| find_name(&names, "description"));

    let sitename = find_property(&props, "og:site_name");

    // Collect all og:image URLs (HTTPS only)
    let medias: Vec<String> = find_all_property(&props, "og:image")
        .into_iter()
        .filter(|u| u.starts_with("https://"))
        .collect();
    let thumbnail = medias
        .first()
        .cloned()
        .or_else(|| find_name(&names, "twitter:image").filter(|u| u.starts_with("https://")));

    // Player detection: og:video → twitter:player (same priority as summaly)
    let player = find_property(&props, "og:video")
        .or_else(|| find_property(&props, "og:video:url"))
        .or_else(|| find_property(&props, "og:video:secure_url"))
        .filter(|u| u.starts_with("https://"))
        .map(|video_url| {
            let width = find_property(&props, "og:video:width").and_then(|w| w.parse().ok());
            let height = find_property(&props, "og:video:height").and_then(|h| h.parse().ok());
            super::Player {
                url: video_url,
                width,
                height,
                allow: default_player_allow(),
            }
        })
        .or_else(|| {
            // twitter:player (skip if card is summary_large_image)
            let card = find_name(&names, "twitter:card").unwrap_or_default();
            if card == "summary_large_image" {
                return None;
            }
            find_name(&names, "twitter:player")
                .filter(|u| u.starts_with("https://"))
                .map(|player_url| {
                    let width =
                        find_name(&names, "twitter:player:width").and_then(|w| w.parse().ok());
                    let height =
                        find_name(&names, "twitter:player:height").and_then(|h| h.parse().ok());
                    super::Player {
                        url: player_url,
                        width,
                        height,
                        allow: default_player_allow(),
                    }
                })
        });

    // Sensitive detection via mixi:content-rating
    let sensitive = find_property(&props, "mixi:content-rating")
        .map(|r| r != "1")
        .unwrap_or(false);

    // Favicon: resolve relative URLs against final_url
    let icon = ICON_LINK_RE
        .captures(html)
        .and_then(|c| c.get(2).or_else(|| c.get(3)))
        .map(|m| resolve_url(m.as_str().trim(), final_url))
        .filter(|u| u.starts_with("https://"));

    SummaryData {
        title,
        description,
        icon,
        sitename,
        thumbnail,
        medias,
        player,
        url: final_url.to_string(),
        sensitive,
    }
}

/// Extract oEmbed endpoint URL from HTML `<link>` tag (if present).
pub fn extract_oembed_url(html: &str) -> Option<String> {
    OEMBED_LINK_RE
        .captures(html)
        .and_then(|c| c.get(1).or_else(|| c.get(2)))
        .map(|m| m.as_str().trim().to_string())
        .filter(|s| s.starts_with("https://") || s.starts_with("http://"))
}

/// Default `allow` attributes for player iframes (matches summaly).
pub fn default_player_allow() -> Vec<String> {
    vec![
        "autoplay".to_string(),
        "encrypted-media".to_string(),
        "fullscreen".to_string(),
    ]
}

/// Detect bot-challenge / captcha pages (Cloudflare, Datadome, etc.)
/// so we don't show them as valid URL previews.
pub fn is_challenge_page(html: &str) -> bool {
    // Cloudflare challenge
    if html.contains("cf-browser-verification") || html.contains("cf_chl_opt") {
        return true;
    }
    // Datadome (used by SoundCloud, etc.)
    if html.contains("geo.captcha-delivery.com") || html.contains("interstitialUrl") {
        return true;
    }
    false
}

/// Resolve a potentially relative URL against a base URL.
pub(crate) fn resolve_url(href: &str, base: &str) -> String {
    if href.starts_with("https://") || href.starts_with("http://") {
        return href.to_string();
    }
    if href.starts_with("//") {
        return format!("https:{href}");
    }
    // Try to parse as relative URL
    if let Ok(base_url) = url::Url::parse(base) {
        if let Ok(resolved) = base_url.join(href) {
            return resolved.to_string();
        }
    }
    href.to_string()
}

// --- Amazon plugin helpers (regex-based DOM extraction) ---

/// Match `<img id="landingImage|imgBlkFront|ebooksImgBlkFront" ...>`
static LANDING_IMAGE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<img\s+[^>]*?id\s*=\s*["'](landingImage|imgBlkFront|ebooksImgBlkFront)["'][^>]*?>"#,
    )
    .unwrap()
});

/// Extract an attribute value from a tag string.
fn extract_attr<'a>(tag: &'a str, attr: &str) -> Option<&'a str> {
    let pattern = format!(r#"(?i){}\s*=\s*["']([^"']+)["']"#, regex::escape(attr));
    let re = Regex::new(&pattern).ok()?;
    re.captures(tag).and_then(|c| c.get(1)).map(|m| m.as_str())
}

/// Extract product image from Amazon landing image element.
pub fn extract_amazon_product_image(html: &str) -> Option<String> {
    let tag = LANDING_IMAGE_RE.find(html)?.as_str();

    // data-old-hires (high-res) → src → data-a-dynamic-image (JSON)
    if let Some(url) =
        extract_attr(tag, "data-old-hires").filter(|s| !s.is_empty() && s.starts_with("https://"))
    {
        return Some(url.to_string());
    }
    if let Some(url) = extract_attr(tag, "src").filter(|s| s.starts_with("https://")) {
        return Some(url.to_string());
    }
    // data-a-dynamic-image is a JSON object mapping URL → [w, h]
    if let Some(json_str) = extract_attr(tag, "data-a-dynamic-image") {
        let map: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(json_str).ok()?;
        return map
            .into_iter()
            .filter(|(url, _)| url.starts_with("https://"))
            .max_by_key(|(_, dims)| {
                dims.as_array()
                    .and_then(|a| a.first())
                    .and_then(|w| w.as_u64())
                    .unwrap_or(0)
            })
            .map(|(url, _)| url);
    }
    None
}

/// Match `<script type="application/ld+json">...</script>`
static JSON_LD_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<script\s+[^>]*?type\s*=\s*["']application/ld\+json["'][^>]*>(.*?)</script>"#,
    )
    .unwrap()
});

/// Extract product image from JSON-LD structured data.
pub fn extract_amazon_jsonld_image(html: &str) -> Option<String> {
    for cap in JSON_LD_RE.captures_iter(html) {
        let text = cap.get(1)?.as_str();
        let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else {
            continue;
        };

        let is_product =
            |v: &serde_json::Value| v.get("@type").and_then(|t| t.as_str()) == Some("Product");

        let product = if is_product(&json) {
            &json
        } else if let Some(p) = json
            .get("@graph")
            .and_then(|g| g.as_array())
            .and_then(|arr| arr.iter().find(|v| is_product(v)))
        {
            p
        } else {
            continue;
        };

        let img = product.get("image")?;
        let url = img
            .as_str()
            .map(String::from)
            .or_else(|| img.as_array()?.first()?.as_str().map(String::from));
        if let Some(url) = url.filter(|u| u.starts_with("https://")) {
            return Some(url);
        }
    }
    None
}
