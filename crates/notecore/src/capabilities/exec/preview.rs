//! `exec: core` な capability の確認内容 (デバイスの `ConfirmOptions` と同じ JSON)。
//! 帰属 / 理由 / クロスアカウントの行 / 記憶のラベルはデバイスの dispatcher が足す。
//! 移設前の TS の `requiresConfirmation` と同じ文面。

use serde_json::{json, Value};

/// 汎用の確認 (移設前の `buildConfirmOptions` と同じ): ラベル + 引数 JSON。
pub fn generic(label: &str, params: &Value) -> Value {
    let mut out = json!({
        "title": format!("{label} を実行しますか?"),
        "message": "",
        "okLabel": "実行",
        "cancelLabel": "やめる",
        "type": "danger",
    });
    let has_args = params.as_object().map(|o| !o.is_empty()).unwrap_or(false);
    if has_args {
        out["code"] = Value::String(serde_json::to_string_pretty(params).unwrap_or_default());
        out["codeLanguage"] = json!("json");
    }
    out
}

fn s<'a>(params: &'a Value, name: &str) -> &'a str {
    params.get(name).and_then(Value::as_str).unwrap_or("")
}

/// capability 固有の確認。None = 汎用でよい。
pub fn custom(id: &str, params: &Value) -> Option<Value> {
    Some(match id {
        "notes.delete" => json!({
            "title": "ノートを削除",
            "message": format!(
                "noteId `{}` を削除します。この操作は元に戻せません (リノート・引用・お気に入り・クリップ等も同時に消えます)。",
                s(params, "noteId")
            ),
            "okLabel": "削除",
            "cancelLabel": "やめる",
            "type": "danger",
        }),
        "user.follow" => json!({
            "title": "フォローを送る",
            "message": format!(
                "userId `{}` にフォローリクエストを送ります (相手に「フォローされた」通知が飛びます)。鍵アカウントなら承認待ち。",
                s(params, "userId")
            ),
            "okLabel": "フォロー",
            "cancelLabel": "やめる",
            "type": "warning",
        }),
        "user.unfollow" => json!({
            "title": "フォローを解除",
            "message": format!(
                "userId `{}` のフォローを解除します (相手に「フォロワー減少」通知は飛びません)。",
                s(params, "userId")
            ),
            "okLabel": "フォロー解除",
            "cancelLabel": "やめる",
            "type": "warning",
        }),
        "notifications.markRead" => {
            let account = s(params, "accountId");
            json!({
                "title": "通知をすべて既読化",
                "message": if account.is_empty() {
                    "ログイン中の全アカウントの通知をすべて既読化します。".to_string()
                } else {
                    format!("アカウント `{account}` の通知をすべて既読化します。")
                },
                "okLabel": "既読化",
                "cancelLabel": "やめる",
                "type": "warning",
            })
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
            if id == "registry.set" {
                json!({
                    "title": "registry に書込",
                    "message": format!(
                        "Misskey サーバー側 registry の `{scope}/{key}` に値を書込みます。 **Misskey 公式 Web Client と共有される設定エリア** なので、公式 UI の挙動 (テーマ / 設定等) にも影響する可能性があります。"
                    ),
                    "code": serde_json::to_string_pretty(params.get("value").unwrap_or(&Value::Null)).unwrap_or_default(),
                    "codeLanguage": "json",
                    "okLabel": "書込",
                    "cancelLabel": "やめる",
                    "type": "warning",
                })
            } else {
                json!({
                    "title": "registry の値を削除",
                    "message": format!(
                        "Misskey サーバー側 registry の `{scope}/{key}` を削除します。 **Misskey 公式 Web Client と共有される設定エリア** なので、公式 UI でも該当設定が初期化されます。"
                    ),
                    "okLabel": "削除",
                    "cancelLabel": "やめる",
                    "type": "danger",
                })
            }
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_preview_matches_ts_shape() {
        let g = generic("ノートを投稿", &json!({"text": "hi"}));
        assert_eq!(g["title"], "ノートを投稿 を実行しますか?");
        assert_eq!(g["codeLanguage"], "json");
        assert!(g["code"].as_str().unwrap().contains("\"text\": \"hi\""));
        let empty = generic("x", &json!({}));
        assert!(empty.get("code").is_none());
    }

    #[test]
    fn custom_previews_carry_the_ts_wording() {
        let d = custom("notes.delete", &json!({"noteId": "n1"})).unwrap();
        assert!(d["message"]
            .as_str()
            .unwrap()
            .starts_with("noteId `n1` を削除します"));
        let m = custom("notifications.markRead", &json!({})).unwrap();
        assert_eq!(
            m["message"],
            "ログイン中の全アカウントの通知をすべて既読化します。"
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
