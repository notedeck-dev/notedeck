//! notemaid のコマンド表 (#1106 §4.1)。行の形は notecore の commands/mod.rs の説明と同じ。
//!
//! `with_maid_command_table!(callback)` は、この表の全行を `callback!{ ... }` に渡す。
//! notemaid 自身は dispatch / CommandId を、アプリは Tauri ラッパーを、それぞれ
//! 自分のマクロで生成する。AI 系のコマンドはここ、データ系は notecore の表。

#[macro_export]
macro_rules! with_maid_command_table {
    ($cb:ident) => {
        $cb! {
            // --- heartbeat (crates/notemaid/src/commands/heartbeat.rs) ---
        data heartbeat_trigger_now() -> () = $crate::commands::heartbeat::heartbeat_trigger_now;
            // --- ai_chat (crates/notemaid/src/commands/ai_chat.rs) ---
        data ai_chat_send(req: $crate::ai_chat_service::AiChatRequest) -> () = $crate::commands::ai_chat::ai_chat_send;
        data ai_chat_cancel(stream_id: String) -> () = $crate::commands::ai_chat::ai_chat_cancel;
        data ai_turn_run(req: $crate::ai_turn::AiTurnRequest) -> () = $crate::commands::ai_chat::ai_turn_run;
        data ai_turn_cancel(turn_id: String) -> Option<$crate::ai_sessions::SessionMessage> = $crate::commands::ai_chat::ai_turn_cancel;
        data ai_confirm_respond(request_id: String, accepted: bool) -> () = $crate::commands::ai_chat::ai_confirm_respond;
        data ai_confirm_shown(request_id: String) -> () = $crate::commands::ai_chat::ai_confirm_shown;
        data ai_harness_list() -> Vec<$crate::acp::HarnessInfo> = $crate::commands::ai_chat::ai_harness_list;
        data maid_workspace_list() -> Vec<$crate::commands::workspace::WorkspaceFile> = $crate::commands::workspace::maid_workspace_list;
        data maid_workspace_write(kind: $crate::workspace::Kind, body: String) -> $crate::commands::workspace::WorkspaceFile = $crate::commands::workspace::maid_workspace_write;
        data maid_user_memory_set(enabled: bool) -> () = $crate::commands::workspace::maid_user_memory_set;
        data maid_heartbeat_steps_seed() -> $crate::skills::SkillMeta = $crate::commands::workspace::maid_heartbeat_steps_seed;
        data maid_turn_system(turn_id: String) -> Option<serde_json::Value> = $crate::commands::workspace::maid_turn_system;
        data capability_execute(id: String, params: serde_json::Value, principal: String, account_id: Option<String>, tainted: bool, plugin_id: Option<String>) -> $crate::exec::ExecOutcome = $crate::commands::ai_chat::capability_execute;
        data capability_preview(id: String, params: serde_json::Value, principal: String, account_id: Option<String>, tainted: bool, plugin_id: Option<String>) -> Option<serde_json::Value> = $crate::commands::ai_chat::capability_preview;
            // --- ai_sessions (crates/notemaid/src/commands/ai_sessions.rs) ---
        data ai_sessions_load_all() -> Vec<$crate::ai_sessions::AiSession> = $crate::commands::ai_sessions::ai_sessions_load_all;
        data ai_session_get(id: String) -> $crate::ai_sessions::AiSession = $crate::commands::ai_sessions::ai_session_get;
        data ai_session_create(req: $crate::ai_sessions::AiSessionCreate) -> $crate::ai_sessions::AiSession = $crate::commands::ai_sessions::ai_session_create;
        data ai_session_append(id: String, messages: Vec<$crate::ai_sessions::SessionMessage>) -> $crate::ai_sessions::AiSession = $crate::commands::ai_sessions::ai_session_append;
        data ai_session_remove_messages(id: String, message_ids: Vec<String>) -> $crate::ai_sessions::AiSession = $crate::commands::ai_sessions::ai_session_remove_messages;
        data ai_session_rename(id: String, title: String) -> $crate::ai_sessions::AiSession = $crate::commands::ai_sessions::ai_session_rename;
        data ai_session_add_triggered_skills(id: String, skill_ids: Vec<String>) -> $crate::ai_sessions::AiSession = $crate::commands::ai_sessions::ai_session_add_triggered_skills;
        data ai_session_delete(id: String) -> () = $crate::commands::ai_sessions::ai_session_delete;
        }
    };
}
