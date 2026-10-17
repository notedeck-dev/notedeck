//! 内蔵接続テンプレの宣言 (Rust 側、#1160)。正本は `crates/notecore/connection_templates.json5`、
//! 表そのものは `connection_templates.generated.rs` に生成される (`pnpm gen:connection-templates`)。
//!
//! テンプレは「提供元ごとに、どこへどう繋ぐか」の宣言で、プロバイダー固有のリクエスト要件
//! (会話アフィニティ ID を載せるヘッダー名) もここにある。リクエストを組む側は
//! **テンプレ id ではなく接続の base URL のホスト**で引く。接続はホストを持っているので、
//! テンプレから作った既存の接続にも、手動追加 / URL ペーストで作った接続にも、
//! 同じホストの別 API (OpenCode Zen) にもアップデートだけで効く。
//!
//! 照合は URL をパースしたホスト名との完全一致 (大文字小文字は正規化、ポートは無視、
//! サブドメインは一致させない、パースできなければ何も当たらない。`http://` でも当てる =
//! API キーを `http://` でも送っている現状に揃える)。

/// 1 テンプレの、Rust が使う分だけの宣言。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectionTemplateDecl {
    pub id: &'static str,
    /// 許可ホスト (小文字)。先頭が base URL のホスト
    pub allowed_hosts: &'static [&'static str],
    /// 会話アフィニティ ID を載せるヘッダー名 (小文字)。無ければ載せない
    pub affinity_header: Option<&'static str>,
}

include!("connection_templates.generated.rs");

/// `base_url` のホスト名 (小文字)。パースできない / ホストが無ければ None。
fn host_of(base_url: &str) -> Option<String> {
    let url = url::Url::parse(base_url).ok()?;
    url.host_str().map(|h| h.to_ascii_lowercase())
}

/// 接続の base URL のホストが許可ホストに一致するテンプレ。
pub fn find_by_base_url(base_url: &str) -> Option<&'static ConnectionTemplateDecl> {
    let host = host_of(base_url)?;
    CONNECTION_TEMPLATES
        .iter()
        .find(|t| t.allowed_hosts.contains(&host.as_str()))
}

/// この宛先に会話アフィニティ ID を載せるなら、そのヘッダー名。
pub fn affinity_header_for(base_url: &str) -> Option<&'static str> {
    find_by_base_url(base_url).and_then(|t| t.affinity_header)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opencode_host_gets_the_session_header_regardless_of_path_scheme_or_port() {
        for url in [
            "https://opencode.ai/zen/go/v1",
            "https://opencode.ai/zen/v1",
            "https://OpenCode.AI/zen/go/v1/",
            "https://opencode.ai:8443/zen/go/v1",
            "http://opencode.ai/zen/go/v1",
        ] {
            assert_eq!(
                affinity_header_for(url),
                Some("x-opencode-session"),
                "{url}"
            );
        }
    }

    #[test]
    fn other_hosts_lookalikes_and_subdomains_get_nothing() {
        for url in [
            "https://api.openai.com/v1",
            "https://api.anthropic.com",
            "https://notopencode.ai/zen/go/v1",
            "https://opencode.ai.example/zen/go/v1",
            "https://api.opencode.ai/zen/go/v1",
            "https://example.com/opencode.ai/zen/go/v1",
            "https://user:pw@example.com/?host=opencode.ai",
        ] {
            assert_eq!(affinity_header_for(url), None, "{url}");
        }
    }

    #[test]
    fn unparsable_or_hostless_urls_match_nothing() {
        for url in [
            "",
            "opencode.ai",
            "not a url",
            "file:///tmp/x",
            "mailto:a@opencode.ai",
        ] {
            assert_eq!(find_by_base_url(url), None, "{url:?}");
        }
    }

    #[test]
    fn templates_are_found_by_every_allowed_host() {
        assert_eq!(
            find_by_base_url("https://api.deepl.com").map(|t| t.id),
            Some("builtin:deepl@1")
        );
        assert_eq!(
            find_by_base_url("https://api-free.deepl.com/v2").map(|t| t.id),
            Some("builtin:deepl@1")
        );
    }

    #[test]
    fn declared_hosts_are_lowercase_and_unique_across_templates() {
        let mut seen = std::collections::HashSet::new();
        for t in CONNECTION_TEMPLATES {
            for h in t.allowed_hosts {
                assert_eq!(*h, h.to_ascii_lowercase(), "{}: {h}", t.id);
                assert!(
                    seen.insert(*h),
                    "{h} は複数のテンプレにある (ホストで引けない)"
                );
            }
            if let Some(name) = t.affinity_header {
                assert_eq!(name, name.to_ascii_lowercase(), "{}: {name}", t.id);
            }
        }
    }
}
