//! ノートの同一性キー (identity) の導出。
//!
//! 複数サーバー (複数アカウント) で観測した同じノートを束ねるための正規化
//! ActivityPub object id。設計の正本は notedeck#1058。
//!
//! 規則:
//! - `uri` が無い (ローカルノート) → `https://{host}/notes/{id}` を組み立てる
//! - `uri` がある → そのまま。scheme と host だけ正規化し、末尾が完全一致で
//!   `/activity` なら除去する (純粋 Renote を連合先で受けると Announce activity の
//!   id が uri になり、origin 側の Renote 行と一致しないため)
//! - フラグメント・クエリ・末尾スラッシュには触れない (本家は uri を完全一致で引く)
//! - host は UTS#46 の ASCII 化 + 小文字、ポート保持。既定ポートは落ちる
//!
//! host の比較 (origin 判定・整合検査) もここで済ませ、フロントには真偽値だけを渡す。

use url::Url;

/// host を正規形 (ASCII 小文字、ポート保持) にする。解釈できなければ小文字化のみ。
pub fn normalize_host(host: &str) -> String {
    let h = host.trim();
    if let Ok(u) = Url::parse(&format!("https://{h}/")) {
        if let Some(hs) = u.host_str() {
            return match u.port() {
                Some(p) => format!("{hs}:{p}"),
                None => hs.to_string(),
            };
        }
    }
    h.to_ascii_lowercase()
}

/// `raw_uri` / 取得元サーバー / サーバー内 ID から identity を導出する。
pub fn identity_of(raw_uri: Option<&str>, server_host: &str, note_id: &str) -> String {
    match raw_uri.map(str::trim) {
        None | Some("") => format!("https://{}/notes/{}", normalize_host(server_host), note_id),
        Some(raw) => normalize_uri(raw),
    }
}

/// identity の host (正規形)。解釈できなければ None。
pub fn identity_host(identity: &str) -> Option<String> {
    let (_, authority, _) = split_uri(identity)?;
    Some(normalize_host(authority))
}

/// `scheme://authority rest` に分解する。`://` が無ければ None。
fn split_uri(uri: &str) -> Option<(&str, &str, &str)> {
    let idx = uri.find("://")?;
    let scheme = &uri[..idx];
    let after = &uri[idx + 3..];
    let end = after.find(['/', '?', '#']).unwrap_or(after.len());
    Some((scheme, &after[..end], &after[end..]))
}

fn normalize_uri(raw: &str) -> String {
    let Some((scheme, authority, rest)) = split_uri(raw) else {
        return raw.to_string();
    };
    if scheme.is_empty() || authority.is_empty() {
        return raw.to_string();
    }
    let mut out = format!(
        "{}://{}{}",
        scheme.to_ascii_lowercase(),
        normalize_host(authority),
        rest
    );
    if let Some(stripped) = out.strip_suffix("/activity") {
        out = stripped.to_string();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_note_builds_canonical_uri() {
        assert_eq!(
            identity_of(None, "misskey.io", "abc123"),
            "https://misskey.io/notes/abc123"
        );
        assert_eq!(
            identity_of(Some(""), "misskey.io", "abc123"),
            "https://misskey.io/notes/abc123"
        );
    }

    #[test]
    fn remote_note_keeps_uri() {
        assert_eq!(
            identity_of(
                Some("https://origin.example/notes/x1"),
                "b.example",
                "localB"
            ),
            "https://origin.example/notes/x1"
        );
    }

    #[test]
    fn pure_renote_announce_id_matches_origin_row() {
        // 連合先の Renote 行 (Announce の id) と origin 側の Renote 行 (uri なし) が一致する
        let remote = identity_of(
            Some("https://origin.example/notes/r1/activity"),
            "b.example",
            "localB",
        );
        let origin = identity_of(None, "origin.example", "r1");
        assert_eq!(remote, origin);
    }

    #[test]
    fn activity_suffix_is_exact_match_only() {
        assert_eq!(
            identity_of(Some("https://o.example/notes/x/activity/"), "b", "id"),
            "https://o.example/notes/x/activity/"
        );
        assert_eq!(
            identity_of(Some("https://o.example/notes/x/activity#frag"), "b", "id"),
            "https://o.example/notes/x/activity#frag"
        );
    }

    #[test]
    fn mastodon_uri_kept_and_boost_normalized() {
        assert_eq!(
            identity_of(
                Some("https://mastodon.example/users/alice/statuses/123"),
                "b",
                "id"
            ),
            "https://mastodon.example/users/alice/statuses/123"
        );
        assert_eq!(
            identity_of(
                Some("https://mastodon.example/users/alice/statuses/123/activity"),
                "b",
                "id"
            ),
            "https://mastodon.example/users/alice/statuses/123"
        );
    }

    #[test]
    fn scheme_and_host_are_lowercased_but_path_untouched() {
        assert_eq!(
            identity_of(Some("HTTPS://Origin.Example/notes/AbC"), "b", "id"),
            "https://origin.example/notes/AbC"
        );
    }

    #[test]
    fn unicode_host_is_punycoded_on_both_paths() {
        let remote = identity_of(Some("https://日本語.example/notes/x"), "b", "id");
        let local = identity_of(None, "日本語.example", "x");
        assert_eq!(remote, "https://xn--wgv71a119e.example/notes/x");
        assert_eq!(remote, local);
    }

    #[test]
    fn port_is_preserved_and_default_port_dropped() {
        assert_eq!(
            identity_of(Some("https://o.example:8443/notes/x"), "b", "id"),
            "https://o.example:8443/notes/x"
        );
        assert_eq!(normalize_host("O.Example:8443"), "o.example:8443");
        assert_eq!(normalize_host("o.example:443"), "o.example");
    }

    #[test]
    fn fragment_query_and_trailing_slash_are_untouched() {
        for u in [
            "https://o.example/notes/x#frag",
            "https://o.example/notes/x?p=1",
            "https://o.example/notes/x/",
        ] {
            assert_eq!(identity_of(Some(u), "b", "id"), u);
        }
    }

    #[test]
    fn unparseable_uri_is_kept_verbatim_not_emptied() {
        assert_eq!(identity_of(Some("not a uri"), "b", "id"), "not a uri");
        assert_eq!(identity_of(Some("urn:x"), "b", "id"), "urn:x");
    }

    #[test]
    fn identity_host_extracts_normalized_host() {
        assert_eq!(
            identity_host("https://Origin.Example:8443/notes/x").as_deref(),
            Some("origin.example:8443")
        );
        assert_eq!(identity_host("not a uri"), None);
    }
}
