//! ストリームの生イベントを配る前の共通の判断 (#1106 段階 3a の順序 4)。
//!
//! 生封筒 (`stream-envelope`、全イベントの tagged union) は Stream Inspector の観測が
//! 開いているときだけ流す。未読カウンタが要る合図は専用イベント (`stream-unread`) に
//! 切り出し、生封筒に依存する消費者を無くす。emitter はすべてここを通るので、
//! どの構成でも同じ判断になる。

use std::sync::atomic::{AtomicUsize, Ordering};

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
}
