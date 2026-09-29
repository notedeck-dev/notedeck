//! 手元側 (WebView / notecored のイベント面) への口。Core はこれらの trait を
//! 知らないので、Core の拡張スロット (`Core::ext_or_init`) に吊るし、
//! [`CoreMaidExt`] で従来どおり `core.ai_chat_sink()` の形で引く。

use std::sync::{Arc, OnceLock};

use notecli::error::NoteDeckError;
use notecore::context::Core;
use notecore::error::Result;

use crate::ai_chat_service::AiChatSink;
use crate::ai_turn::{AiTurnSink, CoreExecutor};
use crate::heartbeat::HeartbeatSink;

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
