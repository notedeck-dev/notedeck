//! AI の Tauri 側: イベントを WebView へ流す sink (#1106)。コマンド本体は notemaid の
//! コマンド表 (commands/ai_chat.rs)、`exec: core` な capability はターン実行器が Core を
//! 直接持って呼ぶ。

use tauri::Emitter;

use notecore::context::EventSink;

/// 名前つきイベント (AI のチャット / ターン / HEARTBEAT) を同じ名前で WebView へ流す
pub struct TauriAiEvents(pub tauri::AppHandle);

impl EventSink for TauriAiEvents {
    fn emit(&self, name: &'static str, payload: serde_json::Value) {
        let _ = self.0.emit(name, payload);
    }
}
