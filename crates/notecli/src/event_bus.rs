use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast;

#[derive(Clone, Debug, Serialize)]
pub struct SseEvent {
    pub event_type: String,
    pub data: Value,
}

pub struct EventBus {
    tx: broadcast::Sender<SseEvent>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1024);
        Self { tx }
    }

    pub fn send(&self, event: SseEvent) {
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> broadcast::Receiver<SseEvent> {
        self.tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn send_and_receive() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        bus.send(SseEvent {
            event_type: "note".into(),
            data: json!({"id": "n1"}),
        });
        let event = rx.recv().await.unwrap();
        assert_eq!(event.event_type, "note");
        assert_eq!(event.data["id"], "n1");
    }

    #[tokio::test]
    async fn multiple_subscribers() {
        let bus = EventBus::new();
        let mut rx1 = bus.subscribe();
        let mut rx2 = bus.subscribe();
        bus.send(SseEvent {
            event_type: "notification".into(),
            data: json!({"id": "notif1"}),
        });
        let e1 = rx1.recv().await.unwrap();
        let e2 = rx2.recv().await.unwrap();
        assert_eq!(e1.event_type, e2.event_type);
        assert_eq!(e1.data, e2.data);
    }

    #[test]
    fn send_without_subscribers_does_not_panic() {
        let bus = EventBus::new();
        // Should silently discard
        bus.send(SseEvent {
            event_type: "test".into(),
            data: json!(null),
        });
    }

    #[test]
    fn sse_event_serialize() {
        let event = SseEvent {
            event_type: "note".into(),
            data: json!({"text": "hello"}),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["event_type"], "note");
        assert_eq!(json["data"]["text"], "hello");
    }
}
