use crate::cli::ColorWhen;
use crate::models::{NormalizedNote, NormalizedNotification, NormalizedUser, ServerEmoji};

// --- Color control ---

/// `--color` 指定と環境変数・TTY から実際に色付けするか決定する純粋関数。
fn resolve_color(when: ColorWhen, no_color: bool, clicolor_force: bool, is_tty: bool) -> bool {
    match when {
        ColorWhen::Always => true,
        ColorWhen::Never => false,
        // NO_COLOR 最優先 → CLICOLOR_FORCE → TTY (NO_COLOR.org / bat/exa 慣例)
        ColorWhen::Auto => !no_color && (clicolor_force || is_tty),
    }
}

/// `--color` 指定を解決し、colored クレートのグローバル状態へ反映する。
pub fn init_color(when: ColorWhen) {
    use std::io::IsTerminal;
    let enabled = resolve_color(
        when,
        std::env::var_os("NO_COLOR").is_some(),
        std::env::var_os("CLICOLOR_FORCE").is_some_and(|v| v != "0"),
        std::io::stdout().is_terminal(),
    );
    colored::control::set_override(enabled);
}

// --- Semantic color theme ---

/// 意味から色への対応をここ一箇所に集約する。
pub(crate) mod theme {
    use colored::{ColoredString, Colorize};

    pub fn user(s: &str) -> ColoredString {
        s.cyan()
    }
    pub fn muted(s: &str) -> ColoredString {
        s.dimmed() // id, 時刻, 補助テキスト
    }
    pub fn count(s: &str) -> ColoredString {
        s.green()
    }
    pub fn badge(s: &str) -> ColoredString {
        s.yellow() // CW, Bot/Cat, reaction
    }
    pub fn name(s: &str) -> ColoredString {
        s.bold()
    }
    pub fn heading(s: &str) -> ColoredString {
        s.bold().blue()
    }
    pub fn success(s: &str) -> ColoredString {
        s.green()
    }
    pub fn error(s: &str) -> ColoredString {
        s.red() // 失敗・エラー
    }
    pub fn link(s: &str) -> ColoredString {
        s.cyan()
    }
    pub fn following(s: &str) -> ColoredString {
        s.green()
    }
    pub fn followed(s: &str) -> ColoredString {
        s.blue()
    }
    pub fn renote(s: &str) -> ColoredString {
        s.magenta()
    }

    /// 通知種別ごとの色。
    pub fn notif_kind(kind: &str) -> ColoredString {
        match kind {
            "follow" => kind.green(),
            "reply" => kind.cyan(),
            "renote" => kind.magenta(),
            "mention" => kind.blue(),
            "quote" => kind.white(),
            _ => kind.yellow(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum OutputFormat {
    Default,
    Json,
    Ids,
    Compact,
    Jsonl,
}

impl OutputFormat {
    pub fn from_cli(cli: &crate::cli::Cli) -> Self {
        if cli.json {
            Self::Json
        } else if cli.ids {
            Self::Ids
        } else if cli.compact {
            Self::Compact
        } else if cli.jsonl {
            Self::Jsonl
        } else {
            Self::Default
        }
    }
}

// --- Action result helper ---

/// Print a simple action result (used by delete, react, follow, favorite, etc.)
pub fn print_action(fmt: OutputFormat, json_obj: &str, id: &str, default_msg: &str) {
    match fmt {
        OutputFormat::Json | OutputFormat::Jsonl => println!("{json_obj}"),
        OutputFormat::Ids => println!("{id}"),
        _ => println!("{default_msg}"),
    }
}

// --- Notes ---

pub fn print_notes(notes: &[NormalizedNote], fmt: OutputFormat) {
    match fmt {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string(notes).unwrap());
        }
        OutputFormat::Jsonl => {
            for note in notes {
                println!("{}", serde_json::to_string(note).unwrap());
            }
        }
        OutputFormat::Ids => {
            for note in notes {
                println!("{}", note.id);
            }
        }
        OutputFormat::Compact => {
            for note in notes {
                print_note_compact(note);
            }
        }
        OutputFormat::Default => {
            for note in notes {
                print_note_detail(note);
            }
        }
    }
}

pub fn print_note_compact(note: &NormalizedNote) {
    let user = format_user(&note.user);
    let time = &note.created_at[..16].replace('T', " ");
    let text = compact_note_text(note);
    println!(
        "{}\t{}\t{}\t{}",
        theme::muted(&note.id),
        theme::user(&user),
        theme::muted(time),
        text
    );
}

pub fn print_note_detail(note: &NormalizedNote) {
    let user = format_user(&note.user);
    let time = &note.created_at[..16].replace('T', " ");
    println!(
        "{}  {}  {}{}",
        theme::user(&user),
        theme::muted(time),
        theme::muted("id:"),
        theme::muted(&note.id)
    );
    if let Some(ref cw) = note.cw {
        println!("{}", theme::badge(&format!("[CW: {cw}]")));
    }
    if let Some(ref text) = note.text {
        println!("{text}");
    }
    if let Some(ref renote) = note.renote {
        let ru = format_user(&renote.user);
        println!(
            "  {} {}: {}",
            theme::renote("RN"),
            theme::user(&ru),
            theme::muted(renote.text.as_deref().unwrap_or(""))
        );
    }
    let reactions: i64 = note.reactions.values().sum();
    if reactions > 0 || note.renote_count > 0 || note.replies_count > 0 {
        println!(
            "  reactions:{} renotes:{} replies:{}",
            theme::count(&reactions.to_string()),
            theme::count(&note.renote_count.to_string()),
            theme::count(&note.replies_count.to_string())
        );
    }
    println!();
}

// --- Notifications ---

pub fn print_notifications(notifications: &[NormalizedNotification], fmt: OutputFormat) {
    match fmt {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string(notifications).unwrap());
        }
        OutputFormat::Jsonl => {
            for n in notifications {
                println!("{}", serde_json::to_string(n).unwrap());
            }
        }
        OutputFormat::Ids => {
            for n in notifications {
                if let Some(ref note) = n.note {
                    println!("{}", note.id);
                } else {
                    println!("{}", n.id);
                }
            }
        }
        OutputFormat::Compact => {
            for n in notifications {
                print_notification_compact(n);
            }
        }
        OutputFormat::Default => {
            for n in notifications {
                print_notification(n);
            }
        }
    }
}

fn print_notification_compact(n: &NormalizedNotification) {
    let user = n.user.as_ref().map(format_user).unwrap_or_default();
    let note_id = n.note.as_ref().map(|n| n.id.as_str()).unwrap_or("-");
    let reaction = n.reaction.as_deref().unwrap_or("");
    let preview = n
        .note
        .as_ref()
        .and_then(|n| n.text.as_deref())
        .map(oneline)
        .unwrap_or_default();
    println!(
        "{}\t{}\t{}\t{}\t{}",
        theme::muted(note_id),
        theme::notif_kind(&n.notification_type),
        theme::user(&user),
        theme::badge(reaction),
        theme::muted(&preview)
    );
}

fn print_notification(n: &NormalizedNotification) {
    let user = n.user.as_ref().map(format_user);
    let reaction = if n.notification_type == "reaction" {
        n.reaction.as_deref()
    } else {
        None
    };
    let preview = n
        .note
        .as_ref()
        .and_then(|note| note.text.as_deref())
        .map(|t| truncate_chars(&oneline(t), 50))
        .filter(|p| !p.is_empty());

    // 種別ラベルしか中身が無いシステム通知 (createToken 等) は
    // 人間向け表示では省く (json/jsonl では全件保持される)
    if user.is_none() && reaction.is_none() && preview.is_none() {
        return;
    }

    // 種別ラベルを固定幅で揃える (パディングは色付けの前に行う)
    let mut line = theme::notif_kind(&format!("{:<9}", n.notification_type)).to_string();
    if let Some(user) = user {
        line.push_str(&format!("  {}", theme::user(&user)));
    }
    if let Some(reaction) = reaction {
        line.push_str(&format!("  {}", theme::badge(reaction)));
    }
    if let Some(preview) = preview {
        line.push_str(&format!("  {}", theme::muted(&format!("\"{preview}\""))));
    }
    println!("{line}");
}

// --- User ---

pub fn print_user_detail(u: &crate::models::NormalizedUserDetail) {
    let host_str = u.host.as_deref().unwrap_or("(local)");
    let name = u.name.as_deref().unwrap_or(&u.username);
    println!(
        "{} ({})",
        theme::name(name),
        theme::user(&format!("@{}@{}", u.username, host_str))
    );
    println!("  {}{}", theme::muted("ID: "), theme::muted(&u.id));
    if let Some(ref desc) = u.description {
        println!("  {}{}", theme::muted("Bio: "), desc);
    }
    println!(
        "  Notes: {}  Following: {}  Followers: {}",
        theme::count(&u.notes_count.to_string()),
        theme::count(&u.following_count.to_string()),
        theme::count(&u.followers_count.to_string())
    );
    if u.is_bot {
        print!("  {}", theme::badge("[Bot]"));
    }
    if u.is_cat {
        print!("  {}", theme::badge("[Cat]"));
    }
    if u.is_following {
        print!("  {}", theme::following("[Following]"));
    }
    if u.is_followed {
        print!("  {}", theme::followed("[Followed by]"));
    }
    if u.is_bot || u.is_cat || u.is_following || u.is_followed {
        println!();
    }
    println!();
}

// --- Emojis ---

pub fn print_emojis(emojis: &[ServerEmoji], fmt: OutputFormat) {
    match fmt {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string(emojis).unwrap());
        }
        OutputFormat::Jsonl => {
            for e in emojis {
                println!("{}", serde_json::to_string(e).unwrap());
            }
        }
        OutputFormat::Ids => {
            for e in emojis {
                println!(":{}:", e.name);
            }
        }
        OutputFormat::Compact => {
            for e in emojis {
                let cat = e.category.as_deref().unwrap_or("");
                println!(":{}:\t{}\t{}", e.name, cat, e.aliases.join(","));
            }
        }
        OutputFormat::Default => {
            let mut by_category: std::collections::BTreeMap<&str, Vec<&ServerEmoji>> =
                std::collections::BTreeMap::new();
            for emoji in emojis {
                let cat = emoji.category.as_deref().unwrap_or("(uncategorized)");
                by_category.entry(cat).or_default().push(emoji);
            }
            for (category, list) in &by_category {
                println!("{}", theme::heading(&format!("[{category}]")));
                for emoji in list {
                    let aliases = if emoji.aliases.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", emoji.aliases.join(", "))
                    };
                    println!(
                        "  {} {}",
                        theme::link(&format!(":{}:", emoji.name)),
                        theme::muted(&aliases)
                    );
                }
            }
            println!(
                "\n{}",
                theme::muted(&format!("Total: {} emojis", emojis.len()))
            );
        }
    }
}

// --- Utilities ---

pub fn format_user(user: &NormalizedUser) -> String {
    match &user.host {
        Some(host) => format!("@{}@{}", user.username, host),
        None => format!("@{}", user.username),
    }
}

pub fn oneline(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 文字境界を尊重して先頭 max 文字に切り詰める (超過時は "..." を付与)。
fn truncate_chars(s: &str, max: usize) -> String {
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}...")
    } else {
        head
    }
}

fn compact_note_text(note: &NormalizedNote) -> String {
    let mut parts = Vec::new();
    if let Some(ref cw) = note.cw {
        parts.push(format!("[CW: {}]", oneline(cw)));
    }
    if let Some(ref text) = note.text {
        parts.push(oneline(text));
    } else if let Some(ref renote) = note.renote {
        let ru = format_user(&renote.user);
        let rt = renote.text.as_deref().unwrap_or("");
        parts.push(format!("[RN {}] {}", ru, oneline(rt)));
    }
    if parts.is_empty() {
        "(empty)".to_string()
    } else {
        parts.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_never_always_ignore_env() {
        assert!(!resolve_color(ColorWhen::Never, false, true, true));
        assert!(resolve_color(ColorWhen::Always, true, false, false));
    }

    #[test]
    fn color_auto_respects_no_color_first() {
        // NO_COLOR が最優先 (FORCE/TTY があっても無効)
        assert!(!resolve_color(ColorWhen::Auto, true, true, true));
    }

    #[test]
    fn color_auto_force_overrides_non_tty() {
        assert!(resolve_color(ColorWhen::Auto, false, true, false));
    }

    #[test]
    fn color_auto_tty_enables() {
        assert!(resolve_color(ColorWhen::Auto, false, false, true));
    }

    #[test]
    fn color_auto_pipe_disables() {
        assert!(!resolve_color(ColorWhen::Auto, false, false, false));
    }

    #[test]
    fn truncate_chars_respects_char_boundary() {
        // マルチバイト文字をバイト境界で切らない (旧バグ &s[..n] の回帰防止)
        let s = "すごく眠いというか疲れてるんだけど傾眠なのかなぁ";
        let out = truncate_chars(s, 10);
        assert_eq!(out, "すごく眠いというか疲...");
        assert_eq!(out.chars().count(), 13); // 10 + "..."
    }

    #[test]
    fn truncate_chars_keeps_short_string_intact() {
        assert_eq!(truncate_chars("短い", 50), "短い");
    }
}
