//! AI に返す形への整形 (TS 側 `useAiSystemContext.ts` の projectOneNote /
//! projectOneNotification / stripCredentials と同じ規則)。

use serde_json::{json, Map, Value};

use notecli::models::{NormalizedNote, NormalizedNotification};

/// `[CW: …]` か本文。どちらも無ければ None (キーごと省く)。
fn note_text(text: Option<&str>, cw: Option<&str>) -> Option<String> {
    match cw {
        Some(cw) if !cw.is_empty() => Some(format!("[CW: {cw}]")),
        _ => text.map(str::to_string),
    }
}

/// ノート 1 件: `{ id, username, text?, createdAt }`。
pub fn note(o: &NormalizedNote) -> Value {
    let mut m = Map::new();
    m.insert("id".into(), Value::String(o.id.clone()));
    m.insert("username".into(), Value::String(o.user.username.clone()));
    if let Some(t) = note_text(o.text.as_deref(), o.cw.as_deref()) {
        m.insert("text".into(), Value::String(t));
    }
    m.insert("createdAt".into(), Value::String(o.created_at.clone()));
    Value::Object(m)
}

/// 先頭 `limit` 件をノート整形する。
pub fn notes(list: &[NormalizedNote], limit: usize) -> Value {
    Value::Array(list.iter().take(limit).map(note).collect())
}

/// 通知 1 件: `{ kind: "notification", id, type, reaction?, createdAt, username?, noteText? }`。
pub fn notification(n: &NormalizedNotification) -> Value {
    let mut m = Map::new();
    m.insert("kind".into(), json!("notification"));
    m.insert("id".into(), Value::String(n.id.clone()));
    m.insert("type".into(), Value::String(n.notification_type.clone()));
    if let Some(r) = &n.reaction {
        m.insert("reaction".into(), Value::String(r.clone()));
    }
    m.insert("createdAt".into(), Value::String(n.created_at.clone()));
    if let Some(u) = &n.user {
        m.insert("username".into(), Value::String(u.username.clone()));
    }
    if let Some(note) = &n.note {
        if let Some(t) = note_text(note.text.as_deref(), note.cw.as_deref()) {
            m.insert("noteText".into(), Value::String(t));
        }
    }
    Value::Object(m)
}

pub fn notifications(list: &[NormalizedNotification], limit: usize) -> Value {
    Value::Array(list.iter().take(limit).map(notification).collect())
}

const SENSITIVE_KEYS: &[&str] = &[
    "token",
    "i",
    "accessToken",
    "refreshToken",
    "apiKey",
    "password",
    "secret",
];

/// 資格情報らしいキーを再帰的に落とす (TS 側 stripCredentials と同じ集合)。
pub fn strip_credentials(v: Value) -> Value {
    match v {
        Value::Array(a) => Value::Array(a.into_iter().map(strip_credentials).collect()),
        Value::Object(o) => Value::Object(
            o.into_iter()
                .filter(|(k, _)| !SENSITIVE_KEYS.contains(&k.as_str()))
                .map(|(k, v)| (k, strip_credentials(v)))
                .collect(),
        ),
        other => other,
    }
}

#[cfg(test)]
pub(crate) mod fixtures {
    use notecli::models::{NormalizedNote, NormalizedNotification};

    pub fn note(id: &str, username: &str, text: Option<&str>, cw: Option<&str>) -> NormalizedNote {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "createdAt": "2026-09-24T00:00:00.000Z",
            "text": text,
            "cw": cw,
            "user": { "id": "u1", "username": username, "host": null, "name": null,
                      "avatarUrl": "", "isBot": false, "isCat": false,
                      "avatarDecorations": [], "emojis": {} },
            "visibility": "public",
            "emojis": {}, "reactionEmojis": {}, "reactions": {}, "myReaction": null,
            "renoteCount": 0, "repliesCount": 0, "files": [],
            "localOnly": false, "visibleUserIds": [], "isFavorited": false,
            "contentHidden": false, "modeFlags": {},
            "_accountId": "acc-1", "_serverHost": "example.com",
            "_identity": "", "_isOrigin": true, "_identityTrusted": true
        }))
        .expect("note fixture")
    }

    pub fn notification(
        id: &str,
        kind: &str,
        note: Option<NormalizedNote>,
    ) -> NormalizedNotification {
        serde_json::from_value(serde_json::json!({
            "id": id,
            "_accountId": "acc-1",
            "_serverHost": "example.com",
            "createdAt": "2026-09-24T00:00:00.000Z",
            "type": kind,
            "user": { "id": "u2", "username": "bob", "host": null, "name": null,
                      "avatarUrl": "", "isBot": false, "isCat": false,
                      "avatarDecorations": [], "emojis": {} },
            "note": note,
            "reaction": if kind == "reaction" { Some("👍") } else { None },
            "withBots": false,
            "withSensitive": false
        }))
        .expect("notification fixture")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_projection_applies_cw_rule_and_omits_missing_text() {
        let plain = note(&fixtures::note("n1", "alice", Some("hi"), None));
        assert_eq!(
            plain,
            json!({"id": "n1", "username": "alice", "text": "hi", "createdAt": "2026-09-24T00:00:00.000Z"})
        );
        let cw = note(&fixtures::note(
            "n2",
            "alice",
            Some("secret"),
            Some("spoiler"),
        ));
        assert_eq!(cw["text"], "[CW: spoiler]");
        let none = note(&fixtures::note("n3", "alice", None, Some("")));
        assert!(none.get("text").is_none());
        let three: Vec<_> = (0..3)
            .map(|_| fixtures::note("a", "u", None, None))
            .collect();
        assert_eq!(notes(&three, 2).as_array().unwrap().len(), 2);
    }

    #[test]
    fn notification_projection_matches_ts_shape() {
        let n = notification(&fixtures::notification(
            "no1",
            "reaction",
            Some(fixtures::note("n1", "alice", Some("hi"), None)),
        ));
        assert_eq!(
            n,
            json!({
                "kind": "notification", "id": "no1", "type": "reaction", "reaction": "👍",
                "createdAt": "2026-09-24T00:00:00.000Z", "username": "bob", "noteText": "hi"
            })
        );
        let bare = notification(&fixtures::notification("no2", "follow", None));
        assert!(bare.get("reaction").is_none());
        assert!(bare.get("noteText").is_none());
    }

    #[test]
    fn strip_credentials_removes_sensitive_keys_recursively() {
        let v = strip_credentials(json!({
            "id": "x", "token": "t", "nested": { "apiKey": "k", "keep": [{"secret": 1, "ok": 2}] }
        }));
        assert_eq!(v, json!({"id": "x", "nested": {"keep": [{"ok": 2}]}}));
    }
}
