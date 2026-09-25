//! JSON5 の書き出し (`JSON5.stringify(value, null, 2)` と同じ整形) と、JSON5 の
//! オブジェクトリテラルへの id 注入 (`injectJson5Id`)。設定ファイル (テーマ等) の
//! 書き手をデバイスと揃えるため、キー順を保つ独自モデルで出す。

use serde_json::Value;

/// 順序つきの JSON5 値。
#[derive(Clone, Debug, PartialEq)]
pub enum J5 {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<J5>),
    Obj(Vec<(String, J5)>),
}

impl J5 {
    /// serde_json の Value から (オブジェクトはキーのソート順のまま)。
    pub fn from_value(v: &Value) -> J5 {
        match v {
            Value::Null => J5::Null,
            Value::Bool(b) => J5::Bool(*b),
            Value::Number(n) => J5::Num(n.as_f64().unwrap_or(0.0)),
            Value::String(s) => J5::Str(s.clone()),
            Value::Array(a) => J5::Arr(a.iter().map(J5::from_value).collect()),
            Value::Object(m) => J5::Obj(
                m.iter()
                    .map(|(k, v)| (k.clone(), J5::from_value(v)))
                    .collect(),
            ),
        }
    }
}

fn is_identifier(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_alphabetic() || first == '$' || first == '_') {
        return false;
    }
    chars.all(|c| c.is_alphanumeric() || c == '$' || c == '_')
}

/// `'` の数が `"` の数以下なら `'`、それ以外は `"`。選んだ引用符だけエスケープする。
pub fn quote_string(s: &str) -> String {
    let singles = s.chars().filter(|c| *c == '\'').count();
    let doubles = s.chars().filter(|c| *c == '"').count();
    let q = if singles <= doubles { '\'' } else { '"' };
    let mut out = String::with_capacity(s.len() + 2);
    out.push(q);
    let chars: Vec<char> = s.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        match *c {
            c if c == q => {
                out.push('\\');
                out.push(c);
            }
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{b}' => out.push_str("\\v"),
            '\0' => {
                let next_digit = chars
                    .get(i + 1)
                    .map(|n| n.is_ascii_digit())
                    .unwrap_or(false);
                out.push_str(if next_digit { "\\x00" } else { "\\0" });
            }
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\x{:02x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push(q);
    out
}

fn format_number(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else if n.is_finite() {
        format!("{n}")
    } else {
        "null".into()
    }
}

fn write(v: &J5, indent: usize, out: &mut String) {
    match v {
        J5::Null => out.push_str("null"),
        J5::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        J5::Num(n) => out.push_str(&format_number(*n)),
        J5::Str(s) => out.push_str(&quote_string(s)),
        J5::Arr(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            let pad = " ".repeat(indent + 2);
            out.push_str("[\n");
            for item in items {
                out.push_str(&pad);
                write(item, indent + 2, out);
                out.push_str(",\n");
            }
            out.push_str(&" ".repeat(indent));
            out.push(']');
        }
        J5::Obj(pairs) => {
            if pairs.is_empty() {
                out.push_str("{}");
                return;
            }
            let pad = " ".repeat(indent + 2);
            out.push_str("{\n");
            for (k, v) in pairs {
                out.push_str(&pad);
                if is_identifier(k) {
                    out.push_str(k);
                } else {
                    out.push_str(&quote_string(k));
                }
                out.push_str(": ");
                write(v, indent + 2, out);
                out.push_str(",\n");
            }
            out.push_str(&" ".repeat(indent));
            out.push('}');
        }
    }
}

/// `JSON5.stringify(value, null, 2)` (末尾改行なし)。
pub fn stringify(v: &J5) -> String {
    let mut out = String::new();
    write(v, 0, &mut out);
    out
}

/// `quoteJson5`: `\` → `\\`、`'` → `\'`、改行 → `\n`、CR → `\r` の順に置換して `'…'`。
fn quote_json5(value: &str) -> String {
    let s = value
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r");
    format!("'{s}'")
}

/// 最後の有意な文字 (`}` であること) と、その 1 つ前の有意な文字を探す。
/// コメントと文字列の中は読み飛ばす。
fn find_tail_significants(raw: &str) -> Option<(usize, usize, char)> {
    let chars: Vec<char> = raw.chars().collect();
    let mut sig: Vec<(usize, char)> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '/' && chars.get(i + 1) == Some(&'/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            continue;
        }
        if c == '"' || c == '\'' {
            sig.push((i, c));
            i += 1;
            while i < chars.len() && chars[i] != c {
                if chars[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }
            if i < chars.len() {
                sig.push((i, chars[i]));
            }
            i += 1;
            continue;
        }
        if !c.is_whitespace() {
            sig.push((i, c));
        }
        i += 1;
    }
    let (last_idx, last) = *sig.last()?;
    if last != '}' {
        return None;
    }
    let (before_idx, before) = *sig.get(sig.len().wrapping_sub(2))?;
    Some((last_idx, before_idx, before))
}

/// JSON5 オブジェクトリテラルの末尾に `key: 'value'` を足す (後勝ちで既存の不正な
/// 値を上書き)。オブジェクトリテラルでなければエラー。
pub fn inject_json5_id(raw: &str, key: &str, value: &str) -> Result<String, String> {
    let (_, before_idx, before) = find_tail_significants(raw)
        .ok_or_else(|| "injectJson5Id: not a JSON5 object literal".to_string())?;
    let comma = if before == '{' || before == ',' {
        ""
    } else {
        ","
    };
    let insertion = format!("{comma}\n  {key}: {},\n", quote_json5(value));
    let chars: Vec<char> = raw.chars().collect();
    let head: String = chars[..=before_idx].iter().collect();
    let tail: String = chars[before_idx + 1..].iter().collect();
    Ok(format!("{head}{insertion}{tail}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stringify_matches_json5_rules() {
        let v = J5::Obj(vec![
            ("id".into(), J5::Str("custom-1".into())),
            ("name".into(), J5::Str("My Theme".into())),
            (
                "props".into(),
                J5::Obj(vec![
                    ("accent".into(), J5::Str("#5f6".into())),
                    ("weird-key".into(), J5::Str("it's".into())),
                ]),
            ),
            (
                "$notedeck".into(),
                J5::Obj(vec![(
                    "installedFor".into(),
                    J5::Arr(vec![J5::Str("example.com:u1".into())]),
                )]),
            ),
            ("empty".into(), J5::Obj(vec![])),
            ("list".into(), J5::Arr(vec![])),
        ]);
        assert_eq!(
            stringify(&v),
            "{\n  id: 'custom-1',\n  name: 'My Theme',\n  props: {\n    accent: '#5f6',\n    'weird-key': \"it's\",\n  },\n  $notedeck: {\n    installedFor: [\n      'example.com:u1',\n    ],\n  },\n  empty: {},\n  list: [],\n}"
        );
        assert_eq!(quote_string("a\nb\tc\\"), "'a\\nb\\tc\\\\'");
        assert_eq!(quote_string("\"q\""), "'\"q\"'");
        assert_eq!(quote_string("it's \"x\""), "'it\\'s \"x\"'");
    }

    #[test]
    fn inject_id_matches_ts() {
        assert_eq!(
            inject_json5_id("{}", "installId", "wgt-1").unwrap(),
            "{\n  installId: 'wgt-1',\n}"
        );
        // 末尾カンマの後に挿入する (デバイスと同じく空行が 1 つ残る)
        let with_comma = inject_json5_id("{\n  name: 'a',\n}", "id", "qry-1").unwrap();
        assert_eq!(with_comma, "{\n  name: 'a',\n  id: 'qry-1',\n\n}");
        let parsed: serde_json::Value = json5::from_str(&with_comma).unwrap();
        assert_eq!(parsed["id"], "qry-1");
        // コメントは保ち、後勝ちで既存の不正な値を上書きし、文字列 / コメント内の
        // 波括弧に惑わされない (いずれも JSON5 として読めて id が入る)
        let parse = |src: &str| json5::from_str::<serde_json::Value>(src).unwrap();
        let out = inject_json5_id(
            "{\n  // 手書きコメント\n  name: 'a', /* inline */\n}",
            "id",
            "x",
        )
        .unwrap();
        assert!(out.contains("// 手書きコメント") && out.contains("/* inline */"));
        assert_eq!(parse(&out)["id"], "x");
        let over = inject_json5_id("{ installId: '', name: 'a' }", "installId", "frozen").unwrap();
        assert_eq!(parse(&over)["installId"], "frozen");
        assert_eq!(
            parse(&inject_json5_id("{ name: 'a}b' }", "id", "x").unwrap())["name"],
            "a}b"
        );
        assert_eq!(
            parse(&inject_json5_id("{ n: 1 /* } */ }", "id", "x").unwrap())["id"],
            "x"
        );
        let tricky = inject_json5_id("{}", "id", "it's \\ tricky").unwrap();
        assert!(tricky.contains("'it\\'s \\\\ tricky'"));
        assert_eq!(parse(&tricky)["id"], "it's \\ tricky");
        assert_eq!(
            inject_json5_id("{}", "id", "a").unwrap(),
            inject_json5_id("{}", "id", "a").unwrap()
        );
        assert!(inject_json5_id("[1, 2]", "id", "x").is_err());
    }
}
