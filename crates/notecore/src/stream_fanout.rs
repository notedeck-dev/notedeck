//! ストリームの生イベントを配る前の共通の判断 (#1106 段階 3a の順序 4)。
//!
//! 生封筒 (`stream-envelope`、全イベントの tagged union) は Stream Inspector の観測が
//! 開いているときだけ流す。未読カウンタが要る合図は専用イベント (`stream-unread`) に
//! 切り出し、生封筒に依存する消費者を無くす。emitter はすべてここを通るので、
//! どの構成でも同じ判断になる。

use std::sync::atomic::{AtomicUsize, Ordering};

use notecli::models::ChatMessage;
use notecli::streaming::StreamEvent;
use serde::{Deserialize, Serialize};
use specta::Type;

/// 生封筒のイベント名
pub const ENVELOPE_EVENT: &str = "stream-envelope";
/// 未読の合図のイベント名
pub const UNREAD_EVENT: &str = "stream-unread";

/// 観測 (Stream Inspector) の口の数。1 つでも開いていれば生封筒を流す
#[derive(Debug, Default)]
pub struct StreamObservation {
    observers: AtomicUsize,
}

impl StreamObservation {
    pub fn start(&self) {
        self.observers.fetch_add(1, Ordering::Relaxed);
    }

    /// 開いていない状態で閉じても 0 のまま
    pub fn stop(&self) {
        let _ = self
            .observers
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                Some(n.saturating_sub(1))
            });
    }

    pub fn is_on(&self) -> bool {
        self.observers.load(Ordering::Relaxed) > 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum UnreadKind {
    Notification,
    Chat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum UnreadOp {
    /// 1 件増えた
    Increment,
    /// サーバー側で既読になった (0 に戻す)
    Clear,
}

/// 未読カウンタへの合図。件数そのものは持たない (正は REST の取得)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StreamUnreadEvent {
    pub account_id: String,
    pub kind: UnreadKind,
    pub op: UnreadOp,
}

/// 生イベントから未読の合図を取り出す。通知の着信 / 全既読 / チャットの着信だけ
pub fn unread_signal(event: &StreamEvent) -> Option<StreamUnreadEvent> {
    match event {
        StreamEvent::Notification(e) => Some(StreamUnreadEvent {
            account_id: e.account_id.clone(),
            kind: UnreadKind::Notification,
            op: UnreadOp::Increment,
        }),
        StreamEvent::MainEvent(e) if e.event_type == "readAllNotifications" => {
            Some(StreamUnreadEvent {
                account_id: e.account_id.clone(),
                kind: UnreadKind::Notification,
                op: UnreadOp::Clear,
            })
        }
        StreamEvent::ChatMessage(e) => Some(StreamUnreadEvent {
            account_id: e.account_id.clone(),
            kind: UnreadKind::Chat,
            op: UnreadOp::Increment,
        }),
        _ => None,
    }
}

/// 別の会話に来たチャットの新着 (main チャンネルの `newChatMessage`)。
///
/// 本家は受信から 3 秒たっても既読にならなかったメッセージだけをこの名前で流す
/// (ChatService の createMessageToUser / createMessageToRoom)。会話のチャンネルを
/// 開いていなくても届くので、チャットの履歴一覧の新着に使う
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StreamNewChatMessageEvent {
    pub account_id: String,
    pub message: ChatMessage,
}

/// 生イベントからチャットの新着を取り出す。読めない本文は捨てる
pub fn new_chat_message(event: &StreamEvent) -> Option<StreamNewChatMessageEvent> {
    match event {
        StreamEvent::MainEvent(e) if e.event_type == "newChatMessage" => {
            let message = serde_json::from_value::<ChatMessage>(e.body.clone()).ok()?;
            Some(StreamNewChatMessageEvent {
                account_id: e.account_id.clone(),
                message,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notecli::streaming::{StreamMainEvent, StreamStatusEvent};
    use serde_json::json;

    #[test]
    fn observation_counts_open_ends_and_never_goes_negative() {
        let o = StreamObservation::default();
        assert!(!o.is_on());
        o.stop();
        assert!(!o.is_on());
        o.start();
        o.start();
        o.stop();
        assert!(o.is_on());
        o.stop();
        assert!(!o.is_on());
    }

    #[test]
    fn unread_signal_picks_only_notification_and_chat_events() {
        let read_all = StreamEvent::MainEvent(Box::new(StreamMainEvent {
            account_id: "a".into(),
            subscription_id: "s".into(),
            event_type: "readAllNotifications".into(),
            body: json!({}),
        }));
        assert_eq!(
            unread_signal(&read_all),
            Some(StreamUnreadEvent {
                account_id: "a".into(),
                kind: UnreadKind::Notification,
                op: UnreadOp::Clear,
            })
        );
        let other_main = StreamEvent::MainEvent(Box::new(StreamMainEvent {
            account_id: "a".into(),
            subscription_id: "s".into(),
            event_type: "followed".into(),
            body: json!({}),
        }));
        assert_eq!(unread_signal(&other_main), None);
        let status = StreamEvent::Status(Box::new(StreamStatusEvent {
            account_id: "a".into(),
            state: notecli::streaming::StreamConnectionState::Connected,
        }));
        assert_eq!(unread_signal(&status), None);
        let wire = serde_json::to_value(unread_signal(&read_all).unwrap()).unwrap();
        assert_eq!(
            wire,
            json!({ "accountId": "a", "kind": "notification", "op": "clear" })
        );
    }

    fn main_event(event_type: &str, body: serde_json::Value) -> StreamEvent {
        StreamEvent::MainEvent(Box::new(StreamMainEvent {
            account_id: "a".into(),
            subscription_id: "s".into(),
            event_type: event_type.into(),
            body,
        }))
    }

    #[test]
    fn new_chat_message_picks_main_new_chat_message_only() {
        let body = json!({
            "id": "m1",
            "createdAt": "2026-10-10T00:00:00.000Z",
            "fromUserId": "u2",
            "fromUser": { "id": "u2", "username": "bob", "name": null, "host": null, "avatarUrl": null },
            "toUserId": "u1",
            "text": "hi",
            "reactions": []
        });
        let got = new_chat_message(&main_event("newChatMessage", body.clone())).unwrap();
        assert_eq!(got.account_id, "a");
        assert_eq!(got.message.id, "m1");
        assert_eq!(got.message.text.as_deref(), Some("hi"));
        assert_eq!(got.message.from_user.unwrap().username, "bob");

        assert!(new_chat_message(&main_event("followed", body)).is_none());
        // 形の合わない本文は捨てる
        assert!(new_chat_message(&main_event("newChatMessage", json!({ "id": 1 }))).is_none());
    }
}
