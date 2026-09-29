//! AI のイベントの届け先。実体は notecore の `EventSink` (名前 + JSON) 1 つで、Tauri は
//! WebView へ emit、別プロセスは socket のイベント frame にする。チャット / ターン /
//! HEARTBEAT の 3 つの trait は、その 1 つに名前を付けて流す薄い変換で、状態は持たない。

use std::sync::Arc;

use notecore::context::Core;
pub use notecore::context::EventSink as AiEventSink;
use notecore::error::Result;

use crate::ai_chat_service::{AiChatEvent, AiChatSink};
use crate::ai_turn::{AiTurnEvent, AiTurnSink};
use crate::heartbeat::{HeartbeatEvent, HeartbeatSink};

/// チャットのストリーム (`nd:ai-chat-event`)
pub const CHAT_EVENT: &str = "nd:ai-chat-event";
/// ターン実行器の出来事 (`nd:ai-turn-event`)
pub const TURN_EVENT: &str = "nd:ai-turn-event";
/// HEARTBEAT の出来事 (`nd:ai-heartbeat-event`)
pub const HEARTBEAT_EVENT: &str = "nd:ai-heartbeat-event";

/// 1 つの [`AiEventSink`] を 3 つの trait に見せる
struct Fanout(Arc<dyn AiEventSink>);

impl Fanout {
    fn send<T: serde::Serialize>(&self, name: &'static str, event: &T) {
        match serde_json::to_value(event) {
            Ok(v) => self.0.emit(name, v),
            Err(e) => tracing::warn!(name, "ai event serialize failed: {e}"),
        }
    }
}

impl AiChatSink for Fanout {
    fn emit(&self, event: AiChatEvent) {
        self.send(CHAT_EVENT, &event);
    }
}

impl AiTurnSink for Fanout {
    fn emit(&self, event: AiTurnEvent) {
        self.send(TURN_EVENT, &event);
    }
}

impl HeartbeatSink for Fanout {
    fn emit(&self, event: HeartbeatEvent) {
        self.send(HEARTBEAT_EVENT, &event);
    }
}

/// Core の `EventSink` を AI 側の 3 つの sink の形で引く口
pub trait CoreMaidExt {
    fn ai_chat_sink(&self) -> Result<Arc<dyn AiChatSink>>;
    fn ai_turn_sink(&self) -> Result<Arc<dyn AiTurnSink>>;
    fn heartbeat_sink(&self) -> Option<Arc<dyn HeartbeatSink>>;
}

impl CoreMaidExt for Core {
    fn ai_chat_sink(&self) -> Result<Arc<dyn AiChatSink>> {
        Ok(Arc::new(Fanout(self.event_sink()?)))
    }

    fn ai_turn_sink(&self) -> Result<Arc<dyn AiTurnSink>> {
        Ok(Arc::new(Fanout(self.event_sink()?)))
    }

    fn heartbeat_sink(&self) -> Option<Arc<dyn HeartbeatSink>> {
        self.event_sink()
            .ok()
            .map(|s| Arc::new(Fanout(s)) as Arc<dyn HeartbeatSink>)
    }
}
