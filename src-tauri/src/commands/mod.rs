mod admin;
mod ai_chat;
mod api_tokens;
mod auth;
mod backup;
mod export;
mod health;
mod heartbeat;
mod query;
mod settings;
pub(crate) use settings::SETTINGS_DIR;
mod system_state;
mod table;
mod timeline;
mod utility;
mod vault;

// Re-export all commands so lib.rs `commands::xxx` paths remain unchanged
pub use admin::*;
pub use ai_chat::*;
pub use api_tokens::*;
pub use auth::*;
pub use backup::*;
pub use export::*;
pub use health::*;
pub use heartbeat::*;
pub use query::*;
pub use settings::*;
pub use system_state::*;
pub use table::*;
pub use timeline::*;
pub use utility::*;
pub use vault::*;

use notecli::db::Database;

pub(crate) use crate::error::Result;

pub use notecore::commands::export_account_list;
/// notecore の実行文脈。旧 `AppState` (二段階初期化) はそのまま notecore へ移った。
pub use notecore::context::Core as AppState;

/// タイムライン取得時の OGP 先読み結果を WebView へ `nd:ogp-hints` で流す。
pub struct TauriHintSink(pub tauri::AppHandle);

impl notecore::context::HintSink for TauriHintSink {
    fn ogp_hints(&self, hints: std::collections::HashMap<String, notecore::ogp::OgpData>) {
        use tauri::Emitter;
        let _ = self.0.emit("nd:ogp-hints", &hints);
    }
}

pub use notecore::credentials::cleanup_expired_credentials;

/// Emit account list to frontend via Tauri event before AppState is initialized.
/// This lets the accounts store populate early, bypassing the AppState readiness gate.
/// Uses the same AccountPublic format as the load_accounts command.
pub fn emit_accounts_early(app: &tauri::AppHandle, db: &Database) {
    use tauri::Emitter;
    let Ok(accounts) = db.load_accounts() else {
        return;
    };
    let list: Vec<notecli::models::AccountPublic> = accounts
        .iter()
        .map(notecore::account_service::to_public)
        .collect();
    let _ = app.emit("nd:accounts-early", &list);
}
