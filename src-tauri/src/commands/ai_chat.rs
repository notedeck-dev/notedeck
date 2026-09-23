//! AI チャットコマンド。実体は [`crate::ai_chat_service`] (#782 R5)。

use tauri::State;

use crate::ai_chat_service::{self, AiChatRequest};

use super::Result;

/// Start a streaming chat completion request. Returns immediately;
/// the actual request runs in a background task that emits events
/// to `nd:ai-chat-event` keyed by `stream_id`.
// nd-command: data
#[tauri::command]
#[specta::specta]
pub async fn ai_chat_send(
    app: tauri::AppHandle,
    http: State<'_, reqwest::Client>,
    req: AiChatRequest,
) -> Result<()> {
    ai_chat_service::start_stream(app, http.inner().clone(), req).await
}

/// Cancel an in-flight streaming chat. Idempotent — silently no-ops if the
/// stream has already completed or never existed.
// nd-command: data
#[tauri::command]
#[specta::specta]
pub async fn ai_chat_cancel(stream_id: String) -> Result<()> {
    ai_chat_service::cancel_stream(&stream_id);
    Ok(())
}
