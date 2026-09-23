//! AI チャットのデータ系コマンド (#1106 段階 0b)。本体は [`crate::ai_chat_service`]。
//! イベントの届け先 (AiChatSink) と app dir は Core から引く。

use crate::ai_chat_service::{self, AiChatRequest};
use crate::context::Core;
use crate::error::Result;

/// Start a streaming chat completion request. Returns immediately;
/// the actual request runs in a background task that emits events
/// to the sink keyed by `stream_id`.
pub async fn ai_chat_send(core: &Core, req: AiChatRequest) -> Result<()> {
    ai_chat_service::start_stream(
        core.ai_chat_sink()?,
        core.app_dir()?,
        core.http()?.clone(),
        req,
    )
    .await
}

/// Cancel an in-flight streaming chat. Idempotent — silently no-ops if the
/// stream has already completed or never existed.
pub async fn ai_chat_cancel(_core: &Core, stream_id: String) -> Result<()> {
    ai_chat_service::cancel_stream(&stream_id);
    Ok(())
}
