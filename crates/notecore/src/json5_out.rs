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

impl<'de> serde::Deserialize<'de> for J5 {
    /// json5 crate から順序を保って読む (オブジェクトは出現順)。
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = J5;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a JSON5 value")
            }
            fn visit_bool<E>(self, v: bool) -> std::result::Result<J5, E> {
                Ok(J5::Bool(v))
            }
            fn visit_i64<E>(self, v: i64) -> std::result::Result<J5, E> {
                Ok(J5::Num(v as f64))
            }
            fn visit_u64<E>(self, v: u64) -> std::result::Result<J5, E> {
                Ok(J5::Num(v as f64))
            }
            fn visit_f64<E>(self, v: f64) -> std::result::Result<J5, E> {
                Ok(J5::Num(v))
            }
            fn visit_str<E>(self, v: &str) -> std::result::Result<J5, E> {
                Ok(J5::Str(v.to_string()))
            }
            fn visit_string<E>(self, v: String) -> std::result::Result<J5, E> {
                Ok(J5::Str(v))
            }
            fn visit_none<E>(self) -> std::result::Result<J5, E> {
                Ok(J5::Null)
            }
            fn visit_unit<E>(self) -> std::result::Result<J5, E> {
                Ok(J5::Null)
            }
            fn visit_some<D2: serde::Deserializer<'de>>(
                self,
                d: D2,
            ) -> std::result::Result<J5, D2::Error> {
                <J5 as serde::Deserialize>::deserialize(d)
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> std::result::Result<J5, A::Error> {
                let mut out = Vec::new();
                while let Some(v) = seq.next_element::<J5>()? {
                    out.push(v);
                }
                Ok(J5::Arr(out))
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<J5, A::Error> {
                let mut out = Vec::new();
                while let Some((k, v)) = map.next_entry::<String, J5>()? {
                    out.push((k, v));
                }
                Ok(J5::Obj(out))
            }
        }
        d.deserialize_any(V)
    }
}

impl J5 {
    pub fn get(&self, key: &str) -> Option<&J5> {
        match self {
            J5::Obj(pairs) => pairs.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            J5::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            J5::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            J5::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_arr(&self) -> Option<&[J5]> {
        match self {
            J5::Arr(a) => Some(a),
            _ => None,
        }
    }

    /// オブジェクトのキーを置く (あれば同じ位置で置換、無ければ末尾に追加)。
    pub fn set(&mut self, key: &str, value: J5) {
        if let J5::Obj(pairs) = self {
            if let Some(slot) = pairs.iter_mut().find(|(k, _)| k == key) {
                slot.1 = value;
            } else {
                pairs.push((key.to_string(), value));
            }
        }
    }

    pub fn remove(&mut self, key: &str) {
        if let J5::Obj(pairs) = self {
            pairs.retain(|(k, _)| k != key);
        }
    }

    pub fn is_truthy(&self) -> bool {
        match self {
            J5::Null => false,
            J5::Bool(b) => *b,
            J5::Num(n) => *n != 0.0 && !n.is_nan(),
            J5::Str(s) => !s.is_empty(),
            J5::Arr(_) | J5::Obj(_) => true,
        }
    }

    /// 文字列の配列だけを残す。
    pub fn string_list(&self) -> Vec<String> {
        self.as_arr()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// serde_json の Value へ (順序は失われる)。
    pub fn to_value(&self) -> Value {
        match self {
            J5::Null => Value::Null,
            J5::Bool(b) => Value::Bool(*b),
            J5::Num(n) => {
                if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 {
                    Value::from(*n as i64)
                } else {
                    serde_json::Number::from_f64(*n)
                        .map(Value::Number)
                        .unwrap_or(Value::Null)
                }
            }
            J5::Str(s) => Value::String(s.clone()),
            J5::Arr(a) => Value::Array(a.iter().map(J5::to_value).collect()),
            J5::Obj(p) => Value::Object(p.iter().map(|(k, v)| (k.clone(), v.to_value())).collect()),
        }
    }

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
    fn deserializes_in_document_order() {
        let j: J5 =
            json5::from_str("{ b: 1, a: { z: true, y: [1, 'x'] }, // c\n c: null }").unwrap();
        assert_eq!(stringify(&j), "{\n  b: 1,\n  a: {\n    z: true,\n    y: [\n      1,\n      'x',\n    ],\n  },\n  c: null,\n}");
        assert_eq!(
            j.get("a").and_then(|a| a.get("z")).and_then(J5::as_bool),
            Some(true)
        );
        assert_eq!(
            j.get("a").unwrap().get("y").unwrap().string_list(),
            vec!["x"]
        );
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
