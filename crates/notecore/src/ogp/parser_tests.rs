#[cfg(test)]
mod tests {
    use crate::ogp::parser::*;

    // --- parse_html ---

    #[test]
    fn parse_og_tags() {
        let html = r#"<html><head>
            <meta property="og:title" content="Test Title">
            <meta property="og:description" content="Test Description">
            <meta property="og:image" content="https://example.com/img.png">
            <meta property="og:site_name" content="Example">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        assert_eq!(data.title.as_deref(), Some("Test Title"));
        assert_eq!(data.description.as_deref(), Some("Test Description"));
        assert_eq!(
            data.thumbnail.as_deref(),
            Some("https://example.com/img.png")
        );
        assert_eq!(data.sitename.as_deref(), Some("Example"));
    }

    #[test]
    fn parse_twitter_card_fallback() {
        let html = r#"<html><head>
            <meta name="twitter:title" content="Twitter Title">
            <meta name="twitter:description" content="Twitter Desc">
            <meta name="twitter:image" content="https://example.com/tw.png">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        assert_eq!(data.title.as_deref(), Some("Twitter Title"));
        assert_eq!(data.description.as_deref(), Some("Twitter Desc"));
        assert_eq!(
            data.thumbnail.as_deref(),
            Some("https://example.com/tw.png")
        );
    }

    #[test]
    fn parse_html_title_fallback() {
        let html = "<html><head><title>Page Title</title></head></html>";
        let data = parse_html(html, "https://example.com");
        assert_eq!(data.title.as_deref(), Some("Page Title"));
    }

    #[test]
    fn parse_og_video_player() {
        let html = r#"<html><head>
            <meta property="og:video" content="https://example.com/player">
            <meta property="og:video:width" content="640">
            <meta property="og:video:height" content="360">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        let player = data.player.unwrap();
        assert_eq!(player.url, "https://example.com/player");
        assert_eq!(player.width, Some(640));
        assert_eq!(player.height, Some(360));
    }

    #[test]
    fn parse_twitter_player() {
        let html = r#"<html><head>
            <meta name="twitter:card" content="player">
            <meta name="twitter:player" content="https://example.com/embed">
            <meta name="twitter:player:width" content="800">
            <meta name="twitter:player:height" content="450">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        let player = data.player.unwrap();
        assert_eq!(player.url, "https://example.com/embed");
    }

    #[test]
    fn skip_twitter_player_for_summary_large_image() {
        let html = r#"<html><head>
            <meta name="twitter:card" content="summary_large_image">
            <meta name="twitter:player" content="https://example.com/embed">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        assert!(data.player.is_none());
    }

    #[test]
    fn parse_sensitive_via_mixi_rating() {
        let html = r#"<html><head>
            <meta property="mixi:content-rating" content="adult">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        assert!(data.sensitive);
    }

    #[test]
    fn parse_not_sensitive_rating_1() {
        let html = r#"<html><head>
            <meta property="mixi:content-rating" content="1">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        assert!(!data.sensitive);
    }

    #[test]
    fn parse_icon_resolved() {
        let html = r#"<html><head>
            <link rel="icon" href="/favicon.ico">
        </head></html>"#;
        let data = parse_html(html, "https://example.com/page");
        assert_eq!(
            data.icon.as_deref(),
            Some("https://example.com/favicon.ico")
        );
    }

    #[test]
    fn parse_multiple_og_images_as_medias() {
        let html = r#"<html><head>
            <meta property="og:image" content="https://example.com/1.png">
            <meta property="og:image" content="https://example.com/2.png">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        assert_eq!(data.medias.len(), 2);
        assert_eq!(data.thumbnail.as_deref(), Some("https://example.com/1.png"));
    }

    #[test]
    fn reject_http_image() {
        let html = r#"<html><head>
            <meta property="og:image" content="http://insecure.com/img.png">
        </head></html>"#;
        let data = parse_html(html, "https://example.com");
        assert!(data.thumbnail.is_none());
        assert!(data.medias.is_empty());
    }

    #[test]
    fn empty_html_returns_empty_summary() {
        let data = parse_html("", "https://example.com");
        assert!(data.title.is_none());
        assert!(data.description.is_none());
        assert!(data.thumbnail.is_none());
        assert!(!data.sensitive);
    }

    // --- extract_oembed_url ---

    #[test]
    fn extract_oembed_url_found() {
        let html = r#"<html><head>
            <link type="application/json+oembed" href="https://example.com/oembed?url=test">
        </head></html>"#;
        let url = extract_oembed_url(html);
        assert_eq!(url.as_deref(), Some("https://example.com/oembed?url=test"));
    }

    #[test]
    fn extract_oembed_url_missing() {
        let html = "<html><head></head></html>";
        assert!(extract_oembed_url(html).is_none());
    }

    // --- is_challenge_page ---

    #[test]
    fn detect_cloudflare_challenge() {
        assert!(is_challenge_page("<div id='cf-browser-verification'>"));
        assert!(is_challenge_page("<script>cf_chl_opt={}</script>"));
    }

    #[test]
    fn detect_datadome_challenge() {
        assert!(is_challenge_page(
            "<script src='https://geo.captcha-delivery.com/captcha'></script>"
        ));
        assert!(is_challenge_page("interstitialUrl"));
    }

    #[test]
    fn normal_page_not_challenge() {
        assert!(!is_challenge_page("<html><body>Hello</body></html>"));
    }

    // --- resolve_url ---

    #[test]
    fn resolve_absolute_url() {
        assert_eq!(
            resolve_url("https://cdn.example.com/img.png", "https://example.com"),
            "https://cdn.example.com/img.png"
        );
    }

    #[test]
    fn resolve_protocol_relative() {
        assert_eq!(
            resolve_url("//cdn.example.com/img.png", "https://example.com"),
            "https://cdn.example.com/img.png"
        );
    }

    #[test]
    fn resolve_relative_path() {
        assert_eq!(
            resolve_url("/favicon.ico", "https://example.com/page/1"),
            "https://example.com/favicon.ico"
        );
    }

    #[test]
    fn resolve_relative_no_leading_slash() {
        assert_eq!(
            resolve_url("icon.png", "https://example.com/page/"),
            "https://example.com/page/icon.png"
        );
    }

    // --- default_player_allow ---

    #[test]
    fn default_player_allow_values() {
        let allow = default_player_allow();
        assert!(allow.contains(&"autoplay".to_string()));
        assert!(allow.contains(&"encrypted-media".to_string()));
        assert!(allow.contains(&"fullscreen".to_string()));
    }
}
