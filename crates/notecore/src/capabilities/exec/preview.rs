//! `exec: core` な capability の確認内容 (デバイスの `ConfirmOptions` と同じ JSON)。
//! 帰属 / 理由 / クロスアカウントの行 / 記憶のラベルはデバイスの dispatcher が足す。
//!
//! 文面は辞書の `_native.preview` 節 (#135)。表示用の欄には英語の正本文が入り、
//! `i18n` 欄の手がかりでデバイスが表示言語に描き直す (`crate::i18n`)。

use crate::i18n::{localize_fields, text, Text};
use serde_json::{json, Value};

/// 確認の取り消しボタン
pub(super) fn cancel() -> Text {
    text("_native.preview.cancel", json!({}))
}

/// 確認の JSON を組む。`extra` は code / diff など文言以外の欄
pub(super) fn confirm(
    kind: &str,
    title: Text,
    message: Option<Text>,
    ok: Text,
    mut extra: Value,
) -> Value {
    if !extra.is_object() {
        extra = json!({});
    }
    extra["type"] = json!(kind);
    extra["message"] = json!("");
    let mut fields = vec![("title", title), ("okLabel", ok), ("cancelLabel", cancel())];
    if let Some(m) = message {
        fields.push(("message", m));
    }
    localize_fields(&mut extra, fields);
    extra
}

/// 汎用の確認 (移設前の `buildConfirmOptions` と同じ): 表示名 + 引数 JSON。
/// 表示名は辞書の capability 節から引き、デバイスは `capability` で引き直す
pub fn generic(id: &str, params: &Value) -> Value {
    let label = crate::i18n::render(
        crate::i18n::CANONICAL,
        &format!("_capabilities.{id}"),
        &json!({}),
    );
    let has_args = params.as_object().map(|o| !o.is_empty()).unwrap_or(false);
    let extra = if has_args {
        json!({
            "code": serde_json::to_string_pretty(params).unwrap_or_default(),
            "codeLanguage": "json",
        })
    } else {
        json!({})
    };
    confirm(
        "danger",
        text(
            "_native.preview.generic.title",
            json!({ "label": label, "capability": id }),
        ),
        None,
        text("_native.preview.generic.ok", json!({})),
        extra,
    )
}

fn s<'a>(params: &'a Value, name: &str) -> &'a str {
    params.get(name).and_then(Value::as_str).unwrap_or("")
}

/// capability 固有の確認。None = 汎用でよい。
pub fn custom(id: &str, params: &Value) -> Option<Value> {
    Some(match id {
        "notes.delete" => confirm(
            "danger",
            text("_native.preview.notesDelete.title", json!({})),
            Some(text(
                "_native.preview.notesDelete.message",
                json!({ "noteId": s(params, "noteId") }),
            )),
            text("_native.preview.notesDelete.ok", json!({})),
            json!({}),
        ),
        "user.follow" => confirm(
            "warning",
            text("_native.preview.userFollow.title", json!({})),
            Some(text(
                "_native.preview.userFollow.message",
                json!({ "userId": s(params, "userId") }),
            )),
            text("_native.preview.userFollow.ok", json!({})),
            json!({}),
        ),
        "user.unfollow" => confirm(
            "warning",
            text("_native.preview.userUnfollow.title", json!({})),
            Some(text(
                "_native.preview.userUnfollow.message",
                json!({ "userId": s(params, "userId") }),
            )),
            text("_native.preview.userUnfollow.ok", json!({})),
            json!({}),
        ),
        "notifications.markRead" => {
            let account = s(params, "accountId");
            let message = if account.is_empty() {
                text("_native.preview.markRead.messageAll", json!({}))
            } else {
                text(
                    "_native.preview.markRead.messageAccount",
                    json!({ "accountId": account }),
                )
            };
            confirm(
                "warning",
                text("_native.preview.markRead.title", json!({})),
                Some(message),
                text("_native.preview.markRead.ok", json!({})),
                json!({}),
            )
        }
        "registry.set" | "registry.delete" => {
            let scope = match params.get("scope").and_then(Value::as_array) {
                Some(a) => a
                    .iter()
                    .map(|v| v.as_str().unwrap_or("").to_string())
                    .collect::<Vec<_>>()
                    .join("/"),
                None => "?".to_string(),
            };
            let key = params.get("key").and_then(Value::as_str).unwrap_or("?");
            let path = format!("{scope}/{key}");
            if id == "registry.set" {
                confirm(
                    "warning",
                    text("_native.preview.registrySet.title", json!({})),
                    Some(text(
                        "_native.preview.registrySet.message",
                        json!({ "path": path }),
                    )),
                    text("_native.preview.registrySet.ok", json!({})),
                    json!({
                        "code": serde_json::to_string_pretty(params.get("value").unwrap_or(&Value::Null)).unwrap_or_default(),
                        "codeLanguage": "json",
                    }),
                )
            } else {
                confirm(
                    "danger",
                    text("_native.preview.registryDelete.title", json!({})),
                    Some(text(
                        "_native.preview.registryDelete.message",
                        json!({ "path": path }),
                    )),
                    text("_native.preview.registryDelete.ok", json!({})),
                    json!({}),
                )
            }
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::render;

    fn ja(v: &Value, field: &str) -> String {
        let hint = &v["i18n"][field];
        render("ja-JP", hint["key"].as_str().unwrap(), &hint["params"])
    }

    #[test]
    fn generic_preview_matches_ts_shape() {
        let g = generic("notes.create", &json!({"text": "hi"}));
        assert_eq!(g["title"], "Run Post note?");
        assert_eq!(g["i18n"]["title"]["params"]["capability"], "notes.create");
        assert_eq!(g["codeLanguage"], "json");
        assert!(g["code"].as_str().unwrap().contains("\"text\": \"hi\""));
        assert_eq!(ja(&g, "cancelLabel"), "キャンセル");
        let empty = generic("time.now", &json!({}));
        assert!(empty.get("code").is_none());
    }

    #[test]
    fn custom_previews_carry_english_and_the_dictionary_hint() {
        let d = custom("notes.delete", &json!({"noteId": "n1"})).unwrap();
        assert!(d["message"]
            .as_str()
            .unwrap()
            .starts_with("Deletes noteId `n1`"));
        assert!(ja(&d, "message").starts_with("noteId `n1` を削除します"));
        let m = custom("notifications.markRead", &json!({})).unwrap();
        assert_eq!(
            ja(&m, "message"),
            "ログイン中の全アカウントの通知をすべて既読にします。"
        );
        let r = custom(
            "registry.set",
            &json!({"scope": ["client", "x"], "key": "k", "value": {"a": 1}}),
        )
        .unwrap();
        assert!(r["message"].as_str().unwrap().contains("`client/x/k`"));
        assert!(r["code"].as_str().unwrap().contains("\"a\": 1"));
        let r2 = custom("registry.delete", &json!({"scope": "bad"})).unwrap();
        assert!(r2["message"].as_str().unwrap().contains("`?/?`"));
        assert!(custom("notes.create", &json!({})).is_none());
    }
}
