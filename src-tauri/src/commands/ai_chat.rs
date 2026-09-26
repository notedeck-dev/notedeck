//! AI チャット / ターン実行器の Tauri 側: イベントを WebView へ流す sink だけ (#1106)。
//! コマンド本体は notecore のコマンド表 (commands/ai_chat.rs)。

use tauri::{Emitter, Manager};

use notecore::ai_chat_service::{AiChatEvent, AiChatSink};
use notecore::ai_turn::{AiTurnEvent, AiTurnSink, BoxFuture, CoreExecutor};
use notecore::capabilities::exec::ExecContext;

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

/// `exec: core` な capability を managed state の Core で実行する (#1133 縦切り 4)。
/// ターン実行器は Core を所有しないので、Tauri の managed state を引く実装を渡す。
pub struct TauriCoreExecutor(pub tauri::AppHandle);

impl CoreExecutor for TauriCoreExecutor {
    fn execute<'a>(
        &'a self,
        id: &'a str,
        params: serde_json::Value,
        ctx: ExecContext,
    ) -> BoxFuture<'a, Result<notecore::capabilities::exec::ExecOutcome, String>> {
        Box::pin(async move {
            let core = self.0.state::<notecore::context::Core>();
            notecore::capabilities::exec::execute(&core, id, params, &ctx)
                .await
                .map_err(|e| e.to_string())
        })
    }

    fn preview<'a>(
        &'a self,
        id: &'a str,
        params: serde_json::Value,
        ctx: ExecContext,
    ) -> BoxFuture<'a, Result<Option<serde_json::Value>, String>> {
        Box::pin(async move {
            let core = self.0.state::<notecore::context::Core>();
            notecore::capabilities::exec::preview(&core, id, params, &ctx)
                .await
                .map_err(|e| e.to_string())
        })
    }
}
