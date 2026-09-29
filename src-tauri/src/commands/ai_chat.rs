//! AI の Tauri 側: イベントを WebView へ流す sink と、`exec: core` な capability の実行口 (#1106)。
//! コマンド本体は notemaid のコマンド表 (commands/ai_chat.rs)。

use tauri::{Emitter, Manager};

use notemaid::ai_turn::{BoxFuture, CoreExecutor};
use notemaid::exec::ExecContext;
use notemaid::sinks::AiEventSink;

/// AI のイベント (チャット / ターン / HEARTBEAT) を同じ名前で WebView へ流す
pub struct TauriAiEvents(pub tauri::AppHandle);

impl AiEventSink for TauriAiEvents {
    fn emit(&self, name: &'static str, payload: serde_json::Value) {
        let _ = self.0.emit(name, payload);
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
    ) -> BoxFuture<'a, Result<notemaid::exec::ExecOutcome, String>> {
        Box::pin(async move {
            let core = self.0.state::<notecore::context::Core>();
            notemaid::exec::execute(&core, id, params, &ctx)
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
            notemaid::exec::preview(&core, id, params, &ctx)
                .await
                .map_err(|e| e.to_string())
        })
    }
}
