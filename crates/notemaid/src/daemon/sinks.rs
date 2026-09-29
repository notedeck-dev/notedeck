//! notemaid が出すもの (AI のイベント / 設定変更) をイベント frame に変えて
//! 接続中のセッションに配る。Tauri 側の各 Sink に相当する。

use std::sync::Arc;

use crate::ai_chat_service::{AiChatEvent, AiChatSink};
use crate::ai_turn::{AiTurnEvent, AiTurnSink};
use crate::heartbeat::{HeartbeatEvent, HeartbeatSink};
use notecore::rpc::Frame;
use notecore::settings_events::{SettingsChange, SettingsSink};
use serde::Serialize;
use tokio::sync::broadcast;

/// 接続中の全セッションへの配信路
#[derive(Clone)]
pub struct Events(pub broadcast::Sender<Frame>);

impl Default for Events {
    fn default() -> Self {
        Self::new()
    }
}

impl Events {
    pub fn new() -> Self {
        Self(broadcast::channel(4096).0)
    }

    pub fn emit<T: Serialize>(&self, name: &str, payload: &T) {
        match serde_json::to_value(payload) {
            Ok(payload) => {
                // 受信者が居なければ Err (捨ててよい)
                let _ = self.0.send(Frame::Event {
                    name: name.to_string(),
                    payload,
                    seq: 0,
                });
            }
            Err(e) => tracing::warn!(name, "event serialize failed: {e}"),
        }
    }
}

pub struct ChatSink(pub Events);
impl AiChatSink for ChatSink {
    fn emit(&self, event: AiChatEvent) {
        self.0.emit("nd:ai-chat-event", &event);
    }
}

pub struct TurnSink(pub Events);
impl AiTurnSink for TurnSink {
    fn emit(&self, event: AiTurnEvent) {
        self.0.emit("nd:ai-turn-event", &event);
    }
}

pub struct HbSink(pub Events);
impl HeartbeatSink for HbSink {
    fn emit(&self, event: HeartbeatEvent) {
        self.0.emit("nd:ai-heartbeat-event", &event);
    }
}

/// 設定ファイルの変更通知。HEARTBEAT の timer は ai.json5 の変更で組み直す
pub struct ConfigSink {
    pub events: Events,
    pub on_change: Arc<dyn Fn(&SettingsChange) + Send + Sync>,
}
impl SettingsSink for ConfigSink {
    fn settings_changed(&self, change: SettingsChange) {
        (self.on_change)(&change);
        self.events.emit("nd:settings-file-changed", &change);
    }
}
