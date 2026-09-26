//! メモの frontmatter 用の小さな YAML (#1133 縦切り 4 第 3 弾)。
//!
//! デバイス側は js-yaml で読み書きしている。ここは「js-yaml の dump が出す形と、
//! 人が手で書きうる素直な形」を読み、書くときは js-yaml と同じ引用規則
//! (数値 / 真偽 / null / 日時に見える文字列、先頭の記号、制御文字は二重引用符)
//! で出す。対応するのは block mapping (入れ子 1 段以上) / block sequence / flow
//! sequence / plain・単引用・二重引用のスカラー / block literal (`|` `|-` `>` `>-`)。
//! アンカー・タグ・flow mapping は扱わない (文字列として残る)。数値は文字列の
//! まま (メモの frontmatter に数値の意味を持つキーは無い)。

use serde_json::{Map, Value};

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

struct Line<'a> {
    indent: usize,
    /// インデントを除いた本文
    text: &'a str,
    /// インデントを含む行全体 (block scalar は本文の基準より深い字下げを残す)
    raw: &'a str,
}

fn split_lines(src: &str) -> Vec<Line<'_>> {
    src.split('\n')
        .map(|raw| {
            let raw = raw.strip_suffix('\r').unwrap_or(raw);
            let indent = raw.chars().take_while(|c| *c == ' ').count();
            Line {
                indent,
                text: &raw[indent..],
                raw,
            }
        })
        .collect()
}

fn is_blank_or_comment(l: &Line<'_>) -> bool {
    l.text.trim().is_empty() || l.text.trim_start().starts_with('#')
}

/// frontmatter 本文 → mapping。壊れた入力は読める範囲で返す (例外にしない)。
pub fn parse(src: &str) -> Map<String, Value> {
    let lines = split_lines(src);
    let mut i = 0;
    parse_mapping(&lines, &mut i, 0)
}

fn parse_mapping(lines: &[Line<'_>], i: &mut usize, indent: usize) -> Map<String, Value> {
    let mut out = Map::new();
    while *i < lines.len() {
        let l = &lines[*i];
        if is_blank_or_comment(l) {
            *i += 1;
            continue;
        }
        if l.indent < indent {
            break;
        }
        if l.indent > indent {
            // 想定外の深いインデント (前のキーの続きでない) は読み飛ばす
            *i += 1;
            continue;
        }
        let Some((key, rest)) = split_key(l.text) else {
            *i += 1;
            continue;
        };
        *i += 1;
        let rest_trim = rest.trim();
        if rest_trim.is_empty() {
            // 次の行で決まる: シーケンス / 入れ子の mapping / 空
            let next = next_content(lines, *i);
            match next {
                Some(n) if lines[n].text.starts_with("- ") || lines[n].text == "-" => {
                    let seq_indent = lines[n].indent;
                    if seq_indent >= indent {
                        out.insert(key, Value::Array(parse_sequence(lines, i, seq_indent)));
                        continue;
                    }
                }
                Some(n) if lines[n].indent > indent => {
                    let nested = parse_mapping(lines, i, lines[n].indent);
                    out.insert(key, Value::Object(nested));
                    continue;
                }
                _ => {}
            }
            out.insert(key, Value::Null);
            continue;
        }
        if let Some(block) = block_scalar(rest_trim) {
            let text = parse_block_scalar(lines, i, indent, block);
            out.insert(key, Value::String(text));
            continue;
        }
        out.insert(key, parse_scalar(rest_trim));
    }
    out
}

fn next_content(lines: &[Line<'_>], from: usize) -> Option<usize> {
    (from..lines.len()).find(|&n| !is_blank_or_comment(&lines[n]))
}

/// `key: rest` を分ける。引用符付きのキーも許す。
fn split_key(text: &str) -> Option<(String, &str)> {
    let text = text.trim_end();
    if text.starts_with('"') || text.starts_with('\'') {
        let q = text.chars().next()?;
        let end = text[1..].find(q)? + 1;
        let key = text[1..end].to_string();
        let rest = text[end + 1..].trim_start();
        let rest = rest.strip_prefix(':')?;
        return Some((key, rest));
    }
    // `: ` か行末の `:` で区切る (URL の `://` は区切らない)
    let mut idx = None;
    let bytes = text.as_bytes();
    for (n, b) in bytes.iter().enumerate() {
        if *b == b':' && (n + 1 == bytes.len() || bytes[n + 1] == b' ') {
            idx = Some(n);
            break;
        }
    }
    let n = idx?;
    Some((text[..n].trim().to_string(), &text[n + 1..]))
}

fn parse_sequence(lines: &[Line<'_>], i: &mut usize, indent: usize) -> Vec<Value> {
    let mut out = Vec::new();
    while *i < lines.len() {
        let l = &lines[*i];
        if is_blank_or_comment(l) {
            *i += 1;
            continue;
        }
        if l.indent != indent || !(l.text.starts_with("- ") || l.text == "-") {
            break;
        }
        let item = l.text[1..].trim();
        *i += 1;
        if item.is_empty() {
            out.push(Value::Null);
        } else if let Some(block) = block_scalar(item) {
            out.push(Value::String(parse_block_scalar(lines, i, indent, block)));
        } else {
            out.push(parse_scalar(item));
        }
    }
    out
}

#[derive(Clone, Copy)]
struct BlockScalar {
    folded: bool,
    /// '-' = 末尾改行なし / '+' = 全部保持 / ' ' = 1 つ
    chomp: char,
}

fn block_scalar(s: &str) -> Option<BlockScalar> {
    let mut chars = s.chars();
    let first = chars.next()?;
    if first != '|' && first != '>' {
        return None;
    }
    let rest: String = chars.collect();
    let rest = rest.trim();
    let chomp = match rest.chars().next() {
        Some('-') => '-',
        Some('+') => '+',
        None => ' ',
        // インデント指示子など: 対応しないので plain として扱わない (空扱い)
        Some(_) => ' ',
    };
    Some(BlockScalar {
        folded: first == '>',
        chomp,
    })
}

fn parse_block_scalar(
    lines: &[Line<'_>],
    i: &mut usize,
    parent_indent: usize,
    block: BlockScalar,
) -> String {
    // 最初の非空行のインデントが本文のインデント
    let mut body: Vec<&str> = Vec::new();
    let mut content_indent: Option<usize> = None;
    while *i < lines.len() {
        let l = &lines[*i];
        if l.text.trim().is_empty() {
            body.push("");
            *i += 1;
            continue;
        }
        let ci = *content_indent.get_or_insert(l.indent);
        if l.indent <= parent_indent || l.indent < ci {
            break;
        }
        body.push(&lines[*i].raw[ci..]);
        *i += 1;
    }
    // 末尾の空行は chomping の対象
    let mut trailing_blank = 0;
    while body.last().map(|s| s.is_empty()).unwrap_or(false) {
        body.pop();
        trailing_blank += 1;
    }
    let mut text = if block.folded {
        let mut out = String::new();
        let mut prev_blank = true;
        for line in &body {
            if line.is_empty() {
                out.push('\n');
                prev_blank = true;
            } else {
                if !prev_blank {
                    out.push(' ');
                }
                out.push_str(line);
                prev_blank = false;
            }
        }
        out
    } else {
        body.join("\n")
    };
    match block.chomp {
        '-' => {}
        '+' => {
            text.push('\n');
            for _ in 0..trailing_blank {
                text.push('\n');
            }
        }
        _ => {
            if !text.is_empty() {
                text.push('\n');
            }
        }
    }
    text
}

fn strip_inline_comment(s: &str) -> &str {
    match s.find(" #") {
        Some(n) => s[..n].trim_end(),
        None => s,
    }
}

pub fn parse_scalar(raw: &str) -> Value {
    let raw = raw.trim();
    if let Some(inner) = raw.strip_prefix('"') {
        if let Some(end) = find_closing_double(inner) {
            return Value::String(unescape_double(&inner[..end]));
        }
        return Value::String(raw.to_string());
    }
    if let Some(inner) = raw.strip_prefix('\'') {
        if let Some(end) = find_closing_single(inner) {
            return Value::String(inner[..end].replace("''", "'"));
        }
        return Value::String(raw.to_string());
    }
    if raw.starts_with('[') && raw.ends_with(']') {
        return Value::Array(parse_flow_sequence(&raw[1..raw.len() - 1]));
    }
    let plain = strip_inline_comment(raw);
    match plain {
        "" | "~" | "null" | "Null" | "NULL" => Value::Null,
        "true" | "True" | "TRUE" => Value::Bool(true),
        "false" | "False" | "FALSE" => Value::Bool(false),
        other => Value::String(other.to_string()),
    }
}

fn find_closing_double(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut n = 0;
    while n < bytes.len() {
        match bytes[n] {
            b'\\' => n += 2,
            b'"' => return Some(n),
            _ => n += 1,
        }
    }
    None
}

fn find_closing_single(s: &str) -> Option<usize> {
    let bytes = s.as_bytes();
    let mut n = 0;
    while n < bytes.len() {
        if bytes[n] == b'\'' {
            if n + 1 < bytes.len() && bytes[n + 1] == b'\'' {
                n += 2;
                continue;
            }
            return Some(n);
        }
        n += 1;
    }
    None
}

fn unescape_double(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('0') => out.push('\0'),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some('/') => out.push('/'),
            Some(' ') => out.push(' '),
            Some('x') => push_hex(&mut out, &mut chars, 2),
            Some('u') => push_hex(&mut out, &mut chars, 4),
            Some('U') => push_hex(&mut out, &mut chars, 8),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

fn push_hex(out: &mut String, chars: &mut std::iter::Peekable<std::str::Chars<'_>>, n: usize) {
    let hex: String = chars.by_ref().take(n).collect();
    match u32::from_str_radix(&hex, 16).ok().and_then(char::from_u32) {
        Some(c) => out.push(c),
        None => {
            out.push('\\');
            out.push_str(&hex);
        }
    }
}

fn parse_flow_sequence(inner: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut chars = inner.chars().peekable();
    while let Some(c) = chars.next() {
        match quote {
            Some(q) => {
                cur.push(c);
                if c == '\\' && q == '"' {
                    if let Some(n) = chars.next() {
                        cur.push(n);
                    }
                } else if c == q {
                    quote = None;
                }
            }
            None => match c {
                '"' | '\'' => {
                    quote = Some(c);
                    cur.push(c);
                }
                ',' => {
                    items.push(cur.trim().to_string());
                    cur.clear();
                }
                _ => cur.push(c),
            },
        }
    }
    if !cur.trim().is_empty() || !items.is_empty() {
        items.push(cur.trim().to_string());
    }
    items
        .into_iter()
        .filter(|s| !s.is_empty())
        .map(|s| parse_scalar(&s))
        .collect()
}

// ---------------------------------------------------------------------------
// emit (js-yaml `dump(fm, { lineWidth: -1, quotingType: '"' })` と同じ引用規則)
// ---------------------------------------------------------------------------

fn looks_like_number(s: &str) -> bool {
    let t = s.trim_start_matches(['+', '-']);
    if t.is_empty() {
        return false;
    }
    if t.chars().all(|c| c.is_ascii_digit() || c == '_') {
        return true;
    }
    if t.parse::<f64>().is_ok() {
        return true;
    }
    let lower = t.to_ascii_lowercase();
    lower.starts_with("0x") && t.len() > 2 && t[2..].chars().all(|c| c.is_ascii_hexdigit())
        || lower.starts_with("0o") && t.len() > 2 && t[2..].chars().all(|c| c.is_ascii_digit())
        || lower == ".inf"
        || lower == ".nan"
}

fn looks_like_timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 8
        && b[..4].iter().all(|c| c.is_ascii_digit())
        && b[4] == b'-'
        && b[5].is_ascii_digit()
}

fn looks_like_bool_or_null(s: &str) -> bool {
    matches!(
        s.to_ascii_lowercase().as_str(),
        "true" | "false" | "yes" | "no" | "on" | "off" | "y" | "n" | "null" | "~"
    )
}

pub fn needs_quotes(s: &str) -> bool {
    if s.is_empty() {
        return true;
    }
    let first = s.chars().next().expect("non-empty");
    if first.is_whitespace() || s.ends_with(char::is_whitespace) {
        return true;
    }
    if matches!(
        first,
        '-' | '?'
            | ':'
            | ','
            | '['
            | ']'
            | '{'
            | '}'
            | '#'
            | '&'
            | '*'
            | '!'
            | '|'
            | '>'
            | '\''
            | '"'
            | '%'
            | '@'
            | '`'
    ) {
        return true;
    }
    if s.contains(": ") || s.contains(" #") || s.ends_with(':') {
        return true;
    }
    if s.chars().any(|c| c.is_control()) {
        return true;
    }
    looks_like_number(s) || looks_like_timestamp(s) || looks_like_bool_or_null(s)
}

fn quote_double(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn emit_scalar(s: &str, indent: usize, out: &mut String) {
    if s.contains('\n') {
        // js-yaml と同じく block literal。末尾改行の有無で `|` / `|-`
        let (body, chomp) = match s.strip_suffix('\n') {
            Some(b) if !b.ends_with('\n') => (b, "|"),
            _ => (s, "|-"),
        };
        out.push_str(chomp);
        out.push('\n');
        let pad = " ".repeat(indent + 2);
        for line in body.split('\n') {
            if line.is_empty() {
                out.push('\n');
            } else {
                out.push_str(&pad);
                out.push_str(line);
                out.push('\n');
            }
        }
        return;
    }
    if needs_quotes(s) {
        out.push_str(&quote_double(s));
    } else {
        out.push_str(s);
    }
    out.push('\n');
}

fn emit_value(v: &Value, indent: usize, out: &mut String) {
    match v {
        Value::Null => out.push_str("null\n"),
        Value::Bool(b) => out.push_str(if *b { "true\n" } else { "false\n" }),
        Value::Number(n) => {
            out.push_str(&n.to_string());
            out.push('\n');
        }
        Value::String(s) => emit_scalar(s, indent, out),
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]\n");
                return;
            }
            out.push('\n');
            let pad = " ".repeat(indent + 2);
            for item in items {
                out.push_str(&pad);
                out.push_str("- ");
                emit_value(item, indent + 4, out);
            }
        }
        Value::Object(map) => {
            if map.is_empty() {
                out.push_str("{}\n");
                return;
            }
            out.push('\n');
            // serde_json の Map はキー順を保たないので、デバイス (js-yaml) と同じ
            // 並びになるよう、既知のキーを先に決まった順で出す
            const PRIORITY: &[&str] = &["id", "displayName", "avatarUrl"];
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by_key(|k| {
                (
                    PRIORITY
                        .iter()
                        .position(|p| p == k)
                        .unwrap_or(PRIORITY.len()),
                    k.as_str(),
                )
            });
            emit_mapping_pairs(
                keys.into_iter().map(|k| (k.as_str(), &map[k])),
                indent + 2,
                out,
            );
        }
    }
}

fn emit_mapping_pairs<'a>(
    pairs: impl Iterator<Item = (&'a str, &'a Value)>,
    indent: usize,
    out: &mut String,
) {
    let pad = " ".repeat(indent);
    for (k, v) in pairs {
        out.push_str(&pad);
        if needs_quotes(k) {
            out.push_str(&quote_double(k));
        } else {
            out.push_str(k);
        }
        out.push(':');
        match v {
            Value::Array(items) if !items.is_empty() => emit_value(v, indent, out),
            Value::Object(m) if !m.is_empty() => emit_value(v, indent, out),
            _ => {
                out.push(' ');
                emit_value(v, indent, out);
            }
        }
    }
}

/// 順序つきの pairs → YAML 文書 (末尾改行つき)。
pub fn emit(pairs: &[(String, Value)]) -> String {
    let mut out = String::new();
    emit_mapping_pairs(pairs.iter().map(|(k, v)| (k.as_str(), v)), 0, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn block_literal_keeps_indentation_deeper_than_its_baseline() {
        let m = parse("cw: |-\n  a\n    b\n  c\nx: 1\n");
        assert_eq!(m["cw"], "a\n  b\nc");
        assert!(m.contains_key("x"));
    }

    #[test]
    fn parses_js_yaml_dump_output() {
        let src = "id: \"20260510120000\"\ncreatedAt: \"2026-05-10T10:00:00.000Z\"\nupdatedAt: \"2026-05-10T10:00:00.000Z\"\ncw: |-\n  a\n  b\nfileIds: []\ntags:\n  - idea\n  - \"true\"\ntainted: true\nauthor:\n  id: skill:aizu\n  displayName: 藍 \"q\"\n  avatarUrl: https://x.y/z?a=b#c\n";
        let m = parse(src);
        assert_eq!(m["id"], "20260510120000");
        assert_eq!(m["createdAt"], "2026-05-10T10:00:00.000Z");
        assert_eq!(m["cw"], "a\nb");
        assert_eq!(m["fileIds"], json!([]));
        assert_eq!(m["tags"], json!(["idea", "true"]));
        assert_eq!(m["tainted"], true);
        assert_eq!(m["author"]["id"], "skill:aizu");
        assert_eq!(m["author"]["displayName"], "藍 \"q\"");
        assert_eq!(m["author"]["avatarUrl"], "https://x.y/z?a=b#c");
    }

    #[test]
    fn parses_hand_written_forms() {
        let src = "# comment\ntags: [a, 'b c', \"d,e\"]\nvisibility: home # inline\nempty:\nlist:\n- x\n- y\nquoted: 'it''s'\nfolded: >-\n  one\n  two\n\n  three\nunquoted_ts: 2026-05-10T10:00:00Z\n";
        let m = parse(src);
        assert_eq!(m["tags"], json!(["a", "b c", "d,e"]));
        assert_eq!(m["visibility"], "home");
        assert_eq!(m["empty"], Value::Null);
        assert_eq!(m["list"], json!(["x", "y"]));
        assert_eq!(m["quoted"], "it's");
        assert_eq!(m["folded"], "one two\nthree");
        // 引用なしの日時も文字列のまま (js-yaml は Date にするが、ここでは失わない)
        assert_eq!(m["unquoted_ts"], "2026-05-10T10:00:00Z");
    }

    #[test]
    fn emits_with_js_yaml_quoting_rules() {
        let pairs = vec![
            ("id".to_string(), json!("20260510120000")),
            ("createdAt".to_string(), json!("2026-05-10T10:00:00.000Z")),
            ("visibility".to_string(), json!("home")),
            ("cw".to_string(), json!("a\nb")),
            ("fileIds".to_string(), json!([])),
            (
                "tags".to_string(),
                json!(["idea", "yes", "- x", "it's", "a:b"]),
            ),
            ("tainted".to_string(), json!(true)),
            (
                "author".to_string(),
                json!({"displayName": "藍 \"q\"", "id": "skill:aizu"}),
            ),
        ];
        let out = emit(&pairs);
        assert_eq!(
            out,
            "id: \"20260510120000\"\ncreatedAt: \"2026-05-10T10:00:00.000Z\"\nvisibility: home\ncw: |-\n  a\n  b\nfileIds: []\ntags:\n  - idea\n  - \"yes\"\n  - \"- x\"\n  - it's\n  - a:b\ntainted: true\nauthor:\n  id: skill:aizu\n  displayName: 藍 \"q\"\n"
        );
        // 往復
        let back = parse(&out);
        assert_eq!(back["cw"], "a\nb");
        assert_eq!(back["tags"], json!(["idea", "yes", "- x", "it's", "a:b"]));
        assert_eq!(back["author"]["displayName"], "藍 \"q\"");
        assert!(needs_quotes(""));
        assert!(needs_quotes(" lead"));
        assert!(needs_quotes("1.5"));
        assert!(needs_quotes("0x1F"));
        assert!(needs_quotes("a #b"));
        assert!(needs_quotes("a\tb"));
        assert!(!needs_quotes("https://x.y/z?a=b#c"));
        assert!(!needs_quotes("😀"));
    }
}
