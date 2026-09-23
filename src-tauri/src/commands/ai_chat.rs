//! AI チャットコマンド。実体は [`notecore::ai_chat_service`] (#782 R5)。
//! ここに残るのは app dir の解決と、イベントを Tauri へ流す sink だけ (#1106)。

use std::sync::Arc;

use notecli::error::NoteDeckError;
use tauri::{Emitter, State};

use notecore::ai_chat_service::{self, AiChatEvent, AiChatRequest, AiChatSink};

use super::Result;

const EVENT_NAME: &str = "nd:ai-chat-event";

/// ストリームのイベントを `nd:ai-chat-event` として WebView へ流す。
struct TauriSink(tauri::AppHandle);

impl AiChatSink for TauriSink {
    fn emit(&self, event: AiChatEvent) {
        let _ = self.0.emit(EVENT_NAME, event);
    }
}

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
    let app_dir = crate::app_dir::resolve_app_dir(&app)
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    ai_chat_service::start_stream(
        Arc::new(TauriSink(app)),
        &app_dir,
        http.inner().clone(),
        req,
    )
    .await
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
