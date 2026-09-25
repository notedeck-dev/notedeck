//! 設定ファイル名 (slug) の規則 (#913)。TS の `src/services/settingsSlug.ts` と同じ
//! 規則で、collection (skill / テーマ / プラグイン等) のファイル名を決める。

pub const SLUG_MAX_LENGTH: usize = 48;

const RESERVED: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

fn is_reserved(s: &str) -> bool {
    RESERVED.contains(&s)
}

fn collapse_dashes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for c in s.chars() {
        if c == '-' {
            if !prev_dash {
                out.push('-');
            }
            prev_dash = true;
        } else {
            out.push(c);
            prev_dash = false;
        }
    }
    out
}

/// 表示名 → slug。小文字化し、`[a-z0-9-]` 以外の連続を `-` に、連続する `-` を
/// 1 つに、両端の `-` を落とし、上限で切る。空なら fallback、予約名なら `-x`。
pub fn slugify_name(name: &str, fallback: &str) -> String {
    let lower = name.to_lowercase();
    let mut replaced = String::with_capacity(lower.len());
    let mut in_run = false;
    for c in lower.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' {
            replaced.push(c);
            in_run = false;
        } else if !in_run {
            replaced.push('-');
            in_run = true;
        }
    }
    let mut slug = collapse_dashes(&replaced);
    slug = slug.trim_matches('-').to_string();
    if slug.len() > SLUG_MAX_LENGTH {
        slug.truncate(SLUG_MAX_LENGTH);
        slug = slug.trim_end_matches('-').to_string();
    }
    if slug.is_empty() {
        slug = fallback.to_string();
    }
    if is_reserved(&slug) {
        slug = format!("{slug}-x");
    }
    slug
}

/// slug 規約に沿った名前か (空でない / `[a-z0-9-]` のみ / 上限内 / `--` 無し /
/// 両端が `-` でない / 予約名でない)。
pub fn is_slug_conforming(b: &str) -> bool {
    !b.is_empty()
        && b.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && b.len() <= SLUG_MAX_LENGTH
        && !b.contains("--")
        && !b.starts_with('-')
        && !b.ends_with('-')
        && !is_reserved(b)
}

/// `base-n`。上限を超えるなら base を削ってから付ける。
pub fn compose_suffixed(base: &str, n: usize) -> String {
    let suffix = format!("-{n}");
    if base.len() + suffix.len() <= SLUG_MAX_LENGTH {
        return format!("{base}{suffix}");
    }
    let keep = SLUG_MAX_LENGTH - suffix.len();
    let mut head: String = base.chars().take(keep).collect();
    head = head.trim_end_matches('-').to_string();
    format!("{head}{suffix}")
}

/// 空いていればそのまま、占有されていれば `-2`, `-3`, … で最初に空くものを返す。
pub fn resolve_available(base: &str, is_taken: impl Fn(&str) -> bool) -> String {
    if !is_taken(base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = compose_suffixed(base, n);
        if !is_taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

pub fn casefold(s: &str) -> String {
    s.to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_matches_ts_examples() {
        assert_eq!(slugify_name("My Theme", "theme"), "my-theme");
        assert_eq!(slugify_name("Weather_2", "widget"), "weather-2");
        assert_eq!(slugify_name("日本語だけ", "skill"), "skill");
        assert_eq!(slugify_name("プロファイル 1", "profile"), "1");
        assert_eq!(slugify_name("CON", "x"), "con-x");
        assert_eq!(slugify_name("auxiliary", "x"), "auxiliary");
        let long = format!("{}-bbbb", "a".repeat(47));
        assert_eq!(slugify_name(&long, "x"), "a".repeat(47));
        for s in ["My Theme", "Weather_2", "CON", &long] {
            let once = slugify_name(s, "x");
            assert_eq!(slugify_name(&once, "x"), once, "fixed point for {s}");
        }
    }

    #[test]
    fn conforming_and_suffix_rules() {
        assert!(is_slug_conforming("my-skill"));
        assert!(!is_slug_conforming("My-skill"));
        assert!(!is_slug_conforming("a--b"));
        assert!(!is_slug_conforming("-a"));
        assert!(!is_slug_conforming("con"));
        assert!(!is_slug_conforming(""));
        let taken = ["foo", "foo-2", "foo-3"];
        assert_eq!(resolve_available("foo", |c| taken.contains(&c)), "foo-4");
        let s = compose_suffixed(&"a".repeat(48), 2);
        assert!(s.len() <= 48 && s.ends_with("-2"));
    }
}
