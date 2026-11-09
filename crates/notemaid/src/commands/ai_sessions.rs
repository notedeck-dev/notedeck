//! AI セッションの構造化された操作 (#1133 縦切り 3)。本体は [`crate::ai_sessions`]。
//! notecore が単一の書き手で、デバイスはここを通してだけ書く。

use crate::ai_sessions::{self, AiSession, AiSessionCreate, SessionMessage};
use notecore::context::Core;
use notecore::error::Result;

pub async fn ai_sessions_load_all(core: &Core) -> Result<Vec<AiSession>> {
    ai_sessions::load_all(core.layout()?)
}

pub async fn ai_session_get(core: &Core, id: String) -> Result<AiSession> {
    ai_sessions::get(core.layout()?, &id)
}

pub async fn ai_session_create(core: &Core, req: AiSessionCreate) -> Result<AiSession> {
    ai_sessions::create(core.layout()?, req)
}

pub async fn ai_session_append(
    core: &Core,
    id: String,
    messages: Vec<SessionMessage>,
) -> Result<AiSession> {
    ai_sessions::append(core.layout()?, &id, messages)
}

pub async fn ai_session_remove_messages(
    core: &Core,
    id: String,
    message_ids: Vec<String>,
) -> Result<AiSession> {
    ai_sessions::remove_messages(core.layout()?, &id, &message_ids)
}

pub async fn ai_session_rename(core: &Core, id: String, title: String) -> Result<AiSession> {
    ai_sessions::rename(core.layout()?, &id, &title)
}

pub async fn ai_session_add_triggered_skills(
    core: &Core,
    id: String,
    skill_ids: Vec<String>,
) -> Result<AiSession> {
    ai_sessions::add_triggered_skills(core.layout()?, &id, &skill_ids)
}

pub async fn ai_session_delete(core: &Core, id: String) -> Result<()> {
    ai_sessions::delete(core.layout()?, &id)?;
    crate::ai_turn::taint::forget(core.app_dir()?, &id);
    Ok(())
}
