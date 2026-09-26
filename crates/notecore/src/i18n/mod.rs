//! Rust が画面向けに出す文言 (#135 段 4)。
//!
//! 文言の正本は `locales/*.yml` の `_native` 節で、`pnpm gen:i18n` が言語ごとの
//! JSON (`crates/notecore/locales/`) に書き出したものを埋め込んでいる。Rust の
//! ソースには文言を書かず、辞書のキーで指す。
//!
//! notecore が画面向けに返す値は「英語の正本文 + 辞書のキーと param」
//! ([`Text`])。英語の正本文は AI・HTTP・CLI、デバイスとの版ずれのときの
//! fallback に使い、デバイスは表示するときにキーを自分の表示言語の辞書で引き直す。
//! 端末側 (src-tauri) の OS 通知などは [`render`] で表示言語の文を直接組む。

#[path = "dictionaries.generated.rs"]
mod dictionaries;

use serde_json::{json, Map, Value};
use std::sync::LazyLock;

/// 英語の正本文を組む言語
pub const CANONICAL: &str = "en-US";

static DICTS: LazyLock<Vec<(&'static str, Value)>> = LazyLock::new(|| {
    dictionaries::DICTIONARIES
        .iter()
        .map(|(code, text)| {
            (
                *code,
                serde_json::from_str(text).expect("生成された辞書は JSON"),
            )
        })
        .collect()
});

fn dictionary(lang: &str) -> Option<&'static Value> {
    DICTS.iter().find(|(code, _)| *code == lang).map(|(_, v)| v)
}

fn lookup<'a>(dict: &'a Value, key: &str) -> Option<&'a Value> {
    key.split('.').try_fold(dict, |node, part| node.get(part))
}

fn param_text(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn fill(template: &str, params: &Map<String, Value>) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end)
                if after[..end]
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '_') =>
            {
                let name = &after[..end];
                match params.get(name) {
                    Some(v) => out.push_str(&param_text(v)),
                    None => out.push_str(&rest[start..start + end + 2]),
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// 複数形のカテゴリ。今の対象言語 (ja / en) は one / other で足りる
fn plural_category(lang: &str, count: f64) -> &'static str {
    if lang.starts_with("en") && count == 1.0 {
        "one"
    } else {
        "other"
    }
}

/// `lang` の辞書で `key` の文を組む。辞書に無ければ英語、それも無ければキーそのもの
pub fn render(lang: &str, key: &str, params: &Value) -> String {
    let empty = Map::new();
    let params = params.as_object().unwrap_or(&empty);
    let found = [lang, CANONICAL]
        .iter()
        .filter_map(|l| dictionary(l).and_then(|d| lookup(d, key)).map(|v| (*l, v)))
        .next();
    match found {
        Some((_, Value::String(template))) => fill(template, params),
        Some((l, Value::Object(forms))) => {
            let count = params.get("count").and_then(Value::as_f64).unwrap_or(0.0);
            let form = forms
                .get(plural_category(l, count))
                .or_else(|| forms.get("other"))
                .and_then(Value::as_str)
                .unwrap_or(key);
            fill(form, params)
        }
        _ => key.to_string(),
    }
}

/// 英語の正本文と、表示言語で引き直すための手がかり
#[derive(Debug, Clone, PartialEq)]
pub struct Text {
    /// 英語の正本文
    pub text: String,
    /// `{ key, params }`。デバイスはこれを自分の表示言語の辞書で引き直す
    pub i18n: Value,
}

/// 画面向けの文言を組む
pub fn text(key: &str, params: Value) -> Text {
    Text {
        text: render(CANONICAL, key, &params),
        i18n: json!({ "key": key, "params": params }),
    }
}

/// 表示用の欄 (`title` / `message` ...) に英語の正本文を入れ、`i18n` 欄に
/// 各欄の手がかりを添える。確認プレビューなど、デバイスがそのまま描く JSON 用
pub fn localize_fields(target: &mut Value, fields: Vec<(&str, Text)>) {
    let mut hints = target
        .get("i18n")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (name, t) in fields {
        target[name] = Value::String(t.text);
        hints.insert(name.to_string(), t.i18n);
    }
    target["i18n"] = Value::Object(hints);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_in_the_requested_language() {
        let params = json!({ "label": "X" });
        assert_eq!(
            render("ja-JP", "_native.preview.generic.title", &params),
            "X を実行しますか？"
        );
        assert_eq!(
            render("en-US", "_native.preview.generic.title", &params),
            "Run X?"
        );
    }

    #[test]
    fn falls_back_to_english_then_to_the_key() {
        assert_eq!(
            render("xx-XX", "_native.preview.generic.ok", &json!({})),
            "Run"
        );
        assert_eq!(
            render("ja-JP", "_native.no.such.key", &json!({})),
            "_native.no.such.key"
        );
    }

    #[test]
    fn leaves_unknown_params_and_braces_alone() {
        let params = Map::new();
        assert_eq!(fill("{label} と {x", &params), "{label} と {x");
        assert_eq!(
            fill("a {n} b", json!({ "n": 3 }).as_object().unwrap()),
            "a 3 b"
        );
    }

    #[test]
    fn text_carries_english_and_the_hint() {
        let t = text("_native.preview.generic.title", json!({ "label": "X" }));
        assert_eq!(t.text, "Run X?");
        assert_eq!(
            t.i18n,
            json!({ "key": "_native.preview.generic.title", "params": { "label": "X" } })
        );
    }

    #[test]
    fn localize_fields_fills_text_and_hints() {
        let mut v = json!({ "type": "danger" });
        localize_fields(
            &mut v,
            vec![("okLabel", text("_native.preview.generic.ok", json!({})))],
        );
        assert_eq!(v["okLabel"], "Run");
        assert_eq!(v["i18n"]["okLabel"]["key"], "_native.preview.generic.ok");
        assert_eq!(v["type"], "danger");
    }

    #[test]
    fn capability_labels_are_embedded() {
        assert_eq!(
            render("en-US", "_capabilities.time.now", &json!({})),
            "Get current time"
        );
    }
}
