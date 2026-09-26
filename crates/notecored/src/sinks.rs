//! notecore が出すものをイベント frame に変えて接続中のセッションに配る。
//! Tauri 側の各 Sink / TauriEmitter / delta flusher に相当する。

use std::collections::HashMap;
use std::sync::Arc;

use notecli::streaming::{FrontendEmitter, StreamEvent};
use notecore::ai_chat_service::{AiChatEvent, AiChatSink};
use notecore::ai_turn::{AiTurnEvent, AiTurnSink};
use notecore::context::HintSink;
use notecore::heartbeat::{HeartbeatEvent, HeartbeatSink};
use notecore::ogp::OgpData;
use notecore::query_runtime::{NoteCaptureBatch, QueryRuntime};
use notecore::rpc::Frame;
use notecore::settings_events::{SettingsChange, SettingsSink};
use serde::Serialize;
use tokio::sync::broadcast;

/// 接続中の全セッションへの配信路
#[derive(Clone)]
pub struct Events(pub broadcast::Sender<Frame>);

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

pub struct Hints(pub Events);
impl HintSink for Hints {
    fn ogp_hints(&self, hints: HashMap<String, OgpData>) {
        self.0.emit("nd:ogp-hints", &hints);
    }
}

/// Misskey ストリームのイベント: QueryRuntime に取り込み、Tauri と同じ専用チャネルと
/// 統合チャネル (`stream-envelope`) で配る。OS 通知はデバイスが出す
pub struct StreamEmitter {
    pub runtime: Arc<QueryRuntime>,
    pub events: Events,
}

impl FrontendEmitter for StreamEmitter {
    fn emit(&self, event: StreamEvent) {
        if self.runtime.ingest_stream_event(&event) {
            self.runtime.flush_notify().notify_one();
        }
        if matches!(event, StreamEvent::NoteCaptureUpdated(_)) {
            return;
        }
        match &event {
            StreamEvent::Status(e) => self.events.emit("stream-status", e),
            StreamEvent::ChatMessageReacted(e) => {
                self.events.emit("stream-chat-message-reacted", e)
            }
            StreamEvent::ChatMessageUnreacted(e) => {
                self.events.emit("stream-chat-message-unreacted", e)
            }
            StreamEvent::EmojiChanged(e) => self.events.emit("stream-emoji-changed", e),
            _ => {}
        }
        self.events.emit("stream-envelope", &event);
    }
}

/// クエリ差分の flusher (Tauri の run_delta_flusher と同じ窓)
pub async fn run_delta_flusher(runtime: Arc<QueryRuntime>, events: Events) {
    let notify = runtime.flush_notify();
    loop {
        notify.notified().await;
        tokio::time::sleep(notecore::query_runtime::DELTA_FLUSH_WINDOW).await;
        for delta in runtime.drain_pending() {
            events.emit("query-delta", &delta);
        }
        let captures = runtime.drain_captures();
        if !captures.is_empty() {
            events.emit("note-capture-batch", &NoteCaptureBatch { captures });
        }
    }
}
