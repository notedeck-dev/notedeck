//! 本家の Web Push の中身の解釈 (純関数、#330 §5.4)。
//!
//! 本家は `{ type, body, userId, dateTime }` の JSON を送る。復号できたもの (= 本物) だけが
//! ここに来る。どの口座のものかは、届いた instance (= ホスト) と `userId` の組で手元側が
//! 引く (`userId` だけで引くと、悪意あるサーバーが他ホストの ID を名乗れる)。
//! 描画はストリーミング / ワーカーと同じ `notify_plan` を通す。
//! ネットワーク・端末には触らない (tests/lint/rustCoreBoundary が検査)。

use notecli::models::{ChatMessage, NormalizedNotification, RawNotification};
use serde_json::{json, Value};

/// これより古い push は捨てる (本家の Service Worker と同じ 1 日)。配送アプリが
/// 端末の圏外中に溜めた分をまとめて再配送したとき、古い通知を今さら鳴らさない
pub const MAX_AGE_MS: u64 = 24 * 60 * 60 * 1000;

/// push 1 件の扱い
#[derive(Debug, Clone)]
pub enum PushEvent {
    /// 通知。`notify_plan::plan` で描く
    Notification(Box<NormalizedNotification>),
    /// メッセージの新着。`notify_plan::plan_chat` で描く
    Chat(Box<ChatMessage>),
    /// 他端末などで全部既読にした。その口座の通知を全部消す
    ReadAllNotifications,
    /// 扱わない (アンテナ / 古すぎる / 読めない)
    Ignored,
}

/// どの口座宛てか (`userId`)。読めなければ None
pub fn payload_user_id(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    value.get("userId")?.as_str().map(str::to_string)
}

/// 中身を解釈する。`host` / `account_id` は振り分け済みの口座、`now_ms` は今の時刻
pub fn parse(payload: &str, host: &str, account_id: &str, now_ms: u64) -> PushEvent {
    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        return PushEvent::Ignored;
    };
    let sent_at = value.get("dateTime").and_then(Value::as_u64).unwrap_or(0);
    if now_ms.saturating_sub(sent_at) > MAX_AGE_MS {
        return PushEvent::Ignored;
    }
    let mut body = value.get("body").cloned().unwrap_or(Value::Null);
    match value.get("type").and_then(Value::as_str) {
        Some("notification") => {
            // 本家は push の字数制限のため、通知のノートから投稿者を落として送る。
            // 組み立て (notify_plan) はノートの投稿者を使わないので、型を満たす空の
            // 投稿者を補って読む。落ちた情報は取り直さない (§5.4)
            if let Some(note) = body.get_mut("note").and_then(Value::as_object_mut) {
                note.entry("user")
                    .or_insert_with(|| json!({ "id": "", "username": "" }));
            }
            match serde_json::from_value::<RawNotification>(body) {
                Ok(raw) => PushEvent::Notification(Box::new(raw.normalize(account_id, host))),
                Err(_) => PushEvent::Ignored,
            }
        }
        Some("newChatMessage") => match serde_json::from_value::<ChatMessage>(body) {
            Ok(mut message) => {
                message.account_id = account_id.to_string();
                PushEvent::Chat(Box::new(message))
            }
            Err(_) => PushEvent::Ignored,
        },
        Some("readAllNotifications") => PushEvent::ReadAllNotifications,
        // unreadAntennaNote はアンテナの OS 通知を出していないので捨てる
        _ => PushEvent::Ignored,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notify_plan;

    const NOW: u64 = 1_800_000_000_000;

    fn push(kind: &str, body: Value, sent_at: u64) -> String {
        json!({ "type": kind, "body": body, "userId": "u9", "dateTime": sent_at }).to_string()
    }

    /// 本家が切り詰めた通知 (ノートの投稿者が無い) も読め、ストリーミングと同じ組み立てを通る
    #[test]
    fn truncated_notification_is_read_and_planned_like_streaming() {
        let body = json!({
            "id": "n1",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "type": "reaction",
            "reaction": "👍",
            "user": { "id": "u1", "username": "alice" },
            "note": {
                "id": "note-1",
                "createdAt": "2026-01-01T00:00:00.000Z",
                "text": "要約",
                "visibility": "public",
                "renoteCount": 0,
                "repliesCount": 0,
            },
        });
        let event = parse(
            &push("notification", body, NOW - 2_000),
            "misskey.example",
            "acct-1",
            NOW,
        );
        let PushEvent::Notification(n) = event else {
            panic!("通知として読める: {event:?}");
        };
        assert_eq!(n.account_id, "acct-1");
        assert_eq!(n.server_host, "misskey.example");
        let plan = notify_plan::plan(&n, "ja-JP").expect("リアクションは出す");
        assert_eq!(plan.title, "alice");
        assert_eq!(plan.tag, "notif:acct-1");
        assert_eq!(plan.id, notify_plan::notify_id("n1"));
        assert_eq!(
            plan.deep_link.as_deref(),
            Some("notedeck://misskey.example/note/note-1")
        );
    }

    #[test]
    fn chat_message_gets_the_routed_account() {
        let body = json!({
            "id": "m1",
            "createdAt": "2026-01-01T00:00:00.000Z",
            "fromUserId": "u2",
            "fromUser": { "id": "u2", "username": "bob" },
            "toUserId": "u9",
            "text": "やあ",
            "reactions": [],
        });
        let PushEvent::Chat(m) = parse(&push("newChatMessage", body, NOW), "h", "acct-1", NOW)
        else {
            panic!("メッセージとして読める");
        };
        assert_eq!(m.account_id, "acct-1");
        assert_eq!(m.text.as_deref(), Some("やあ"));
    }

    /// 全既読は消す合図、アンテナ・古すぎるもの・読めないものは捨てる
    #[test]
    fn read_all_antenna_stale_and_garbage() {
        let ignored = |payload: &str| matches!(parse(payload, "h", "a", NOW), PushEvent::Ignored);
        assert!(matches!(
            parse(
                &push("readAllNotifications", Value::Null, NOW),
                "h",
                "a",
                NOW
            ),
            PushEvent::ReadAllNotifications
        ));
        assert!(ignored(&push("unreadAntennaNote", json!({}), NOW)));
        assert!(ignored(&push(
            "readAllNotifications",
            Value::Null,
            NOW - MAX_AGE_MS - 1
        )));
        assert!(ignored("{not json"));
        assert!(ignored(&push("notification", json!({ "id": 1 }), NOW)));
        assert_eq!(
            payload_user_id(&push("readAllNotifications", Value::Null, NOW)).as_deref(),
            Some("u9")
        );
        assert_eq!(payload_user_id("[]"), None);
    }
}
