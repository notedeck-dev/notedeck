//! 手元側 (WebView / notemaid のイベント面) への口。Core はこれらの trait を
//! 知らないので、Core の拡張スロット (`Core::ext_or_init`) に吊るし、
//! [`CoreMaidExt`] で従来どおり `core.ai_chat_sink()` の形で引く。

use std::sync::{Arc, OnceLock};

use notecli::error::NoteDeckError;
use notecore::context::Core;
use notecore::error::Result;

use crate::ai_chat_service::{AiChatEvent, AiChatSink};
use crate::ai_turn::{AiTurnEvent, AiTurnSink, CoreExecutor};
use crate::heartbeat::{HeartbeatEvent, HeartbeatSink};

/// チャットのストリーム (`nd:ai-chat-event`)
pub const CHAT_EVENT: &str = "nd:ai-chat-event";
/// ターン実行器の出来事 (`nd:ai-turn-event`)
pub const TURN_EVENT: &str = "nd:ai-turn-event";
/// HEARTBEAT の出来事 (`nd:ai-heartbeat-event`)
pub const HEARTBEAT_EVENT: &str = "nd:ai-heartbeat-event";

/// AI のイベントの届け先。名前は上の定数のどれか、payload はイベントの JSON
pub trait AiEventSink: Send + Sync + 'static {
    fn emit(&self, name: &'static str, payload: serde_json::Value);
}

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

#[derive(Default)]
struct MaidSinks {
    chat: OnceLock<Arc<dyn AiChatSink>>,
    turn: OnceLock<Arc<dyn AiTurnSink>>,
    heartbeat: OnceLock<Arc<dyn HeartbeatSink>>,
    executor: OnceLock<Arc<dyn CoreExecutor>>,
}

fn slot(core: &Core) -> Arc<MaidSinks> {
    core.ext_or_init(MaidSinks::default)
}

/// Core に AI 側の sink を出し入れする口。
pub trait CoreMaidExt {
    /// 届け先を 1 つ渡す。チャット / ターン / HEARTBEAT の 3 つの sink はこれに束ねられる
    fn set_ai_event_sink(&self, sink: Arc<dyn AiEventSink>);
    fn set_ai_chat_sink(&self, sink: Arc<dyn AiChatSink>);
    fn ai_chat_sink(&self) -> Result<Arc<dyn AiChatSink>>;
    fn set_ai_turn_sink(&self, sink: Arc<dyn AiTurnSink>);
    fn ai_turn_sink(&self) -> Result<Arc<dyn AiTurnSink>>;
    fn set_heartbeat_sink(&self, sink: Arc<dyn HeartbeatSink>);
    fn heartbeat_sink(&self) -> Option<Arc<dyn HeartbeatSink>>;
    fn set_core_executor(&self, executor: Arc<dyn CoreExecutor>);
    fn core_executor(&self) -> Result<Arc<dyn CoreExecutor>>;
}

impl CoreMaidExt for Core {
    fn set_ai_event_sink(&self, sink: Arc<dyn AiEventSink>) {
        let fan = Arc::new(Fanout(sink));
        self.set_ai_chat_sink(fan.clone());
        self.set_ai_turn_sink(fan.clone());
        self.set_heartbeat_sink(fan);
    }

    fn set_ai_chat_sink(&self, sink: Arc<dyn AiChatSink>) {
        let _ = slot(self).chat.set(sink);
    }

    fn ai_chat_sink(&self) -> Result<Arc<dyn AiChatSink>> {
        slot(self)
            .chat
            .get()
            .cloned()
            .ok_or_else(|| NoteDeckError::Internal("ai chat sink is not set".into()))
    }

    fn set_ai_turn_sink(&self, sink: Arc<dyn AiTurnSink>) {
        let _ = slot(self).turn.set(sink);
    }

    fn ai_turn_sink(&self) -> Result<Arc<dyn AiTurnSink>> {
        slot(self)
            .turn
            .get()
            .cloned()
            .ok_or_else(|| NoteDeckError::Internal("ai turn sink is not set".into()))
    }

    fn set_heartbeat_sink(&self, sink: Arc<dyn HeartbeatSink>) {
        let _ = slot(self).heartbeat.set(sink);
    }

    fn heartbeat_sink(&self) -> Option<Arc<dyn HeartbeatSink>> {
        slot(self).heartbeat.get().cloned()
    }

    fn set_core_executor(&self, executor: Arc<dyn CoreExecutor>) {
        let _ = slot(self).executor.set(executor);
    }

    fn core_executor(&self) -> Result<Arc<dyn CoreExecutor>> {
        slot(self)
            .executor
            .get()
            .cloned()
            .ok_or_else(|| NoteDeckError::Internal("core executor is not set".into()))
    }
}
