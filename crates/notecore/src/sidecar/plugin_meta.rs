//! AiScript プラグインのヘッダ (`/// @ <ver>` + `### { ... }`) の解析。
//! デバイス側 `src/aiscript/plugin-api.ts` の `parsePluginMeta` と同じ手順
//! (正規表現の置換で JSON に寄せてから読む)。失敗は None。

use regex::Regex;
use serde_json::{Map, Value};
use std::sync::LazyLock;

#[derive(Clone, Debug, PartialEq, Default)]
pub struct ParsedPluginMeta {
    pub name: String,
    pub version: String,
    pub author: Option<String>,
    pub description: Option<String>,
    pub permissions: Option<Vec<String>>,
    /// `config` (キー順は JSON の読み込み順に依らずソートされる)
    pub config: Option<Map<String, Value>>,
    /// 手元のポートの宣言 (`loopback: [8080, …]`、#1293)。正規化済み
    /// ([`normalize_loopback_ports`])。キーが無い / 配列でない / 正規化で空に
    /// なったときは None (宣言なし)
    pub loopback: Option<Vec<u16>>,
}

/// `loopback` に宣言できるポートの個数の上限 (TS と共有、golden の `maxPorts`)
pub const MAX_LOOPBACK_PORTS: usize = 8;

/// `loopback` の生の配列を正規化する: 整数で 1〜65535 のものだけ、重複は最初の
/// 出現、常に拒否するポート ([`crate::ssrf::is_always_denied_loopback_port`]) は
/// 捨て、[`MAX_LOOPBACK_PORTS`] で切る。TS の `normalizeLoopbackPorts` と同じ規則
pub fn normalize_loopback_ports(raw: &[Value]) -> Vec<u16> {
    let mut out: Vec<u16> = Vec::new();
    for v in raw {
        let Some(n) = v.as_u64() else { continue };
        let Ok(port) = u16::try_from(n) else { continue };
        if port == 0 || crate::ssrf::is_always_denied_loopback_port(port) {
            continue;
        }
        if out.contains(&port) {
            continue;
        }
        out.push(port);
        if out.len() >= MAX_LOOPBACK_PORTS {
            break;
        }
    }
    out
}

static LANG_VERSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)^\s*///\s*@\s*([A-Z0-9_.-]+)(?:[\r\n].*)?$").unwrap());
static META_START: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^[^\n]*###\s*\{").unwrap());
static UNQUOTED_KEY: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^\s*(\w+)\s*:").unwrap());
static MISSING_COMMA: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?m)("|\d+|true|false|null|\]|\})\s*$"#).unwrap());
static TRAILING_COMMA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s),\s*([}\]])").unwrap());
static END_COMMA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s),\s*$").unwrap());
static SIMPLE_PAIR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^\s*(\w+)\s*:\s*"([^"]*)""#).unwrap());

/// `utils.getLangVersion`: 先頭行の `/// @ <ver>`。
pub fn lang_version(code: &str) -> Option<String> {
    LANG_VERSION.captures(code).map(|c| c[1].to_string())
}

/// `isSupportedAiScriptVersion`: 0.12 以上。
pub fn is_supported_version(version: &str) -> bool {
    let mut parts = version.split('.').map(|p| p.parse::<f64>().ok());
    let major = parts.next().flatten();
    let minor = parts.next().flatten().unwrap_or(0.0);
    match major {
        Some(m) => m >= 1.0 || (m == 0.0 && minor >= 12.0),
        None => false,
    }
}

fn extract_meta_block(code: &str) -> Option<&str> {
    let m = META_START.find(code)?;
    let open = m.end();
    let bytes = code.as_bytes();
    let mut depth = 1usize;
    let mut i = open;
    while i < bytes.len() && depth > 0 {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => depth -= 1,
            _ => {}
        }
        i += 1;
    }
    if depth != 0 {
        return None;
    }
    Some(&code[open..i - 1])
}

/// `// …` の行コメントを落とす。文字列リテラルの中の `//` (`"https://…"`) は
/// 残す (#1340)。
fn strip_line_comments(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut quote: Option<char> = None;
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        if let Some(q) = quote {
            out.push(c);
            if c == '\\' {
                if let Some(next) = chars.next() {
                    out.push(next);
                }
            } else if c == q {
                quote = None;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            quote = Some(c);
            out.push(c);
            continue;
        }
        if c == '/' && chars.peek() == Some(&'/') {
            for d in chars.by_ref() {
                if d == '\n' {
                    out.push('\n');
                    break;
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

fn parse_meta_block(body: &str) -> Option<Map<String, Value>> {
    let stripped = strip_line_comments(body);
    let wrapped = format!("{{{stripped}}}");
    let s = UNQUOTED_KEY.replace_all(&wrapped, "\"$1\":");
    let s = s.replace('\'', "\"");
    let s = MISSING_COMMA.replace_all(&s, "$1,");
    let s = TRAILING_COMMA.replace_all(&s, "$1");
    let s = END_COMMA.replace(&s, "");
    if let Ok(Value::Object(obj)) = serde_json::from_str::<Value>(&s) {
        return Some(obj);
    }
    // Fallback: 行ごとの `key: "value"`
    let mut out = Map::new();
    for line in body.split('\n') {
        if let Some(c) = SIMPLE_PAIR.captures(line) {
            out.insert(c[1].to_string(), Value::String(c[2].to_string()));
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

pub fn parse_plugin_meta(code: &str) -> Option<ParsedPluginMeta> {
    let ver = lang_version(code)?;
    if !is_supported_version(&ver) {
        return None;
    }
    let body = extract_meta_block(code)?;
    let obj = parse_meta_block(body)?;
    let name = obj.get("name")?.as_str()?.to_string();
    let version = obj.get("version")?.as_str()?.to_string();
    let mut meta = ParsedPluginMeta {
        name,
        version,
        ..Default::default()
    };
    if let Some(a) = obj.get("author").and_then(Value::as_str) {
        meta.author = Some(a.to_string());
    }
    if let Some(d) = obj.get("description").and_then(Value::as_str) {
        meta.description = Some(d.to_string());
    }
    if let Some(p) = obj.get("permissions").and_then(Value::as_array) {
        meta.permissions = Some(
            p.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
        );
    }
    if let Some(Value::Object(c)) = obj.get("config") {
        meta.config = Some(c.clone());
    }
    if let Some(Value::Array(ports)) = obj.get("loopback") {
        let ports = normalize_loopback_ports(ports);
        if !ports.is_empty() {
            meta.loopback = Some(ports);
        }
    }
    Some(meta)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_full_header() {
        let code = "/// @ 1.2.1\n### {\n  name: \"Hello\"\n  version: \"1.2.0\"\n  author: \"alice\"\n  description: \"greets\"\n  permissions: [\"read:account\"]\n  config: {\n    msg: {\n      type: \"string\"\n      label: \"Message\"\n      default: \"hi\"\n    }\n  }\n}\nMk:toast(\"hi\")\n";
        let m = parse_plugin_meta(code).unwrap();
        assert_eq!(m.name, "Hello");
        assert_eq!(m.version, "1.2.0");
        assert_eq!(m.author.as_deref(), Some("alice"));
        assert_eq!(m.description.as_deref(), Some("greets"));
        assert_eq!(m.permissions, Some(vec!["read:account".to_string()]));
        assert_eq!(
            m.config.unwrap().get("msg").unwrap(),
            &json!({"type": "string", "label": "Message", "default": "hi"})
        );
    }

    #[test]
    fn accepts_old_supported_and_strips_comments() {
        assert!(
            parse_plugin_meta("/// @ 0.19.0\n### {\n  name: \"Old\"\n  version: \"1\"\n}\n")
                .is_some()
        );
        let m =
            parse_plugin_meta("/// @ 0.19.0\n### {\n  // c\n  name: 'N' // x\n  version: '2'\n}\n")
                .unwrap();
        assert_eq!(m.name, "N");
    }

    #[test]
    fn keeps_double_slash_inside_strings() {
        let m = parse_plugin_meta(
            "/// @ 1.2.1\n### {\n  name: \"R\"\n  version: \"1\"\n  description: \"see https://example.com // not a comment\"\n  config: {\n    url: {\n      type: \"string\"\n      default: \"https://example.com\" // trailing\n    }\n  }\n}\n",
        )
        .unwrap();
        assert_eq!(
            m.description.as_deref(),
            Some("see https://example.com // not a comment")
        );
        assert_eq!(
            m.config.unwrap()["url"]["default"],
            json!("https://example.com")
        );
    }

    #[test]
    fn rejects_malformed() {
        assert!(parse_plugin_meta("/// @ 0.19.0\nname: 'x'").is_none());
        assert!(parse_plugin_meta("### {\n  name: \"A\"\n  version: \"1\"\n}\n").is_none());
        assert!(
            parse_plugin_meta("/// @ 0.11.0\n### {\n  name: \"A\"\n  version: \"1\"\n}\n")
                .is_none()
        );
        assert!(parse_plugin_meta("/// @ 0.19.0\n### {\n  name: \"A\"\n}\n").is_none());
        assert!(parse_plugin_meta("/// @ 0.19.0\n### {\n  version: \"1\"\n}\n").is_none());
        assert!(
            parse_plugin_meta("/// @ 0.19.0\n### {\n  name: \"A\"\n  version: \"1\"\n").is_none()
        );
        // 数値の version は null
        assert!(
            parse_plugin_meta("/// @ 0.19.0\n### {\n  name: \"A\"\n  version: 1\n}\n").is_none()
        );
    }

    #[test]
    fn keeps_only_string_permissions() {
        let m = parse_plugin_meta("/// @ 0.19.0\n### {\n  name: \"A\"\n  version: \"1\"\n  permissions: [\"a\", 1, true]\n}\n").unwrap();
        assert_eq!(m.permissions, Some(vec!["a".to_string()]));
    }

    /// `loopback` の正規化は TS (`parsePluginMeta`) と同じ golden を通す (#1293)
    #[test]
    fn loopback_header_matches_shared_golden() {
        let golden: Value = serde_json::from_str(include_str!(
            "../../../../src/aiscript/golden/loopbackHeader.json"
        ))
        .unwrap();
        assert_eq!(
            golden["maxPorts"].as_u64().unwrap() as usize,
            MAX_LOOPBACK_PORTS
        );
        for v in golden["vectors"].as_array().unwrap() {
            let name = v["name"].as_str().unwrap();
            let meta = parse_plugin_meta(v["source"].as_str().unwrap()).unwrap();
            let expected: Option<Vec<u16>> = serde_json::from_value(v["expected"].clone()).unwrap();
            assert_eq!(meta.loopback, expected, "{name}");
        }
    }
}
