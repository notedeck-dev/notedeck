//! ACP (Agent Client Protocol) で手元の CLI (Claude Code / Codex / OpenCode / Gemini CLI /
//! Hermes Agent) を AI の provider として使う (#1104)。
//!
//! - `harness`: 一覧と検出。接続 id は `harness:<id>`
//! - `client`: 子プロセスと stdio の JSON-RPC
//! - `provider`: ターン実行器の `ProviderRound` 実装 (1 ラウンド = CLI の 1 ターン)
//!
//! NoteDeck の capability は MCP サーバー (#555) として CLI に渡す。CLI の資格情報には触れない。
//! HEARTBEAT はこの経路では回らない (無人実行の契約は notemaid のループに結びついている)。

pub mod client;
pub mod harness;
pub mod provider;

use std::sync::{Arc, OnceLock};

pub use harness::{harness_id, HarnessInfo};
pub use provider::{AcpProvider, Registry};

/// このプロセスで起動したエージェントの一覧 (プロセスの寿命と同じ)
pub fn registry() -> Arc<Registry> {
    static R: OnceLock<Arc<Registry>> = OnceLock::new();
    R.get_or_init(|| Arc::new(Registry::default())).clone()
}

/// 全エージェントを止め、MCP 用に発行した永続トークンを橋で失効させる (終了時)
pub async fn shutdown_all(bridge: Option<Arc<dyn notecore::frontend_bridge::FrontendBridge>>) {
    let tokens = registry().shutdown_all();
    if let Some(bridge) = bridge {
        for id in tokens {
            if let Err(e) = bridge.revoke_external_token(id.clone()).await {
                tracing::warn!(token = %id, "cannot revoke the MCP token: {e}");
            }
        }
    }
}

/// 作業ディレクトリ (設定フォルダの中。CLI はここを project root として見る)
pub fn workspace(app_dir: &std::path::Path) -> std::path::PathBuf {
    app_dir
        .join(notecore::commands::settings::SETTINGS_DIR)
        .join("ai-workspace")
}
