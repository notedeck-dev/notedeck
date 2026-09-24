//! AI セッションの構造化された操作 (#1133 縦切り 3)。本体は [`crate::ai_sessions`]。
//! notecore が単一の書き手で、デバイスはここを通してだけ書く。

use crate::ai_sessions::{self, AiSession, AiSessionCreate, SessionMessage};
use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::error::Result;

pub async fn ai_sessions_load_all(core: &Core) -> Result<Vec<AiSession>> {
    ai_sessions::load_all(&settings_base_dir(core)?)
}

pub async fn ai_session_get(core: &Core, id: String) -> Result<AiSession> {
    ai_sessions::get(&settings_base_dir(core)?, &id)
}

pub async fn ai_session_create(core: &Core, req: AiSessionCreate) -> Result<AiSession> {
    ai_sessions::create(&settings_base_dir(core)?, req)
}

pub async fn ai_session_append(
    core: &Core,
    id: String,
    messages: Vec<SessionMessage>,
) -> Result<AiSession> {
    ai_sessions::append(&settings_base_dir(core)?, &id, messages)
}

pub async fn ai_session_remove_messages(
    core: &Core,
    id: String,
    message_ids: Vec<String>,
) -> Result<AiSession> {
    ai_sessions::remove_messages(&settings_base_dir(core)?, &id, &message_ids)
}

pub async fn ai_session_rename(core: &Core, id: String, title: String) -> Result<AiSession> {
    ai_sessions::rename(&settings_base_dir(core)?, &id, &title)
}

pub async fn ai_session_add_triggered_skills(
    core: &Core,
    id: String,
    skill_ids: Vec<String>,
) -> Result<AiSession> {
    ai_sessions::add_triggered_skills(&settings_base_dir(core)?, &id, &skill_ids)
}

pub async fn ai_session_delete(core: &Core, id: String) -> Result<()> {
    ai_sessions::delete(&settings_base_dir(core)?, &id)?;
    crate::ai_turn::taint::forget(core.app_dir()?, &id);
    Ok(())
}
