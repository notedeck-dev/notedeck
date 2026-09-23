//! AI チャットの Tauri 側: イベントを WebView へ流す sink だけ (#1106)。
//! コマンド本体は notecore のコマンド表 (commands/ai_chat.rs)。

use tauri::Emitter;

use notecore::ai_chat_service::{AiChatEvent, AiChatSink};

const EVENT_NAME: &str = "nd:ai-chat-event";

/// ストリームのイベントを `nd:ai-chat-event` として WebView へ流す。
pub struct TauriSink(pub tauri::AppHandle);

impl AiChatSink for TauriSink {
    fn emit(&self, event: AiChatEvent) {
        let _ = self.0.emit(EVENT_NAME, event);
    }
}
