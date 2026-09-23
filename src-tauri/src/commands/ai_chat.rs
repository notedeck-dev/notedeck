//! AI チャット / ターン実行器の Tauri 側: イベントを WebView へ流す sink だけ (#1106)。
//! コマンド本体は notecore のコマンド表 (commands/ai_chat.rs)。

use tauri::Emitter;

use notecore::ai_chat_service::{AiChatEvent, AiChatSink};
use notecore::ai_turn::{AiTurnEvent, AiTurnSink};

const EVENT_NAME: &str = "nd:ai-chat-event";
const TURN_EVENT_NAME: &str = "nd:ai-turn-event";

/// ストリームのイベントを `nd:ai-chat-event` として WebView へ流す。
pub struct TauriSink(pub tauri::AppHandle);

impl AiChatSink for TauriSink {
    fn emit(&self, event: AiChatEvent) {
        let _ = self.0.emit(EVENT_NAME, event);
    }
}

/// ターン実行器 (#1133) のイベントを `nd:ai-turn-event` として WebView へ流す。
pub struct TauriTurnSink(pub tauri::AppHandle);

impl AiTurnSink for TauriTurnSink {
    fn emit(&self, event: AiTurnEvent) {
        let _ = self.0.emit(TURN_EVENT_NAME, event);
    }
}
