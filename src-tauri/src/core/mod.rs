//! notecore 側のモジュール (#1106 段階 0a)。
//!
//! 「デバイスが 1 台も繋がっていなくても意味を持つ処理」の置き場。ここにあるものは
//! Tauri に依存しない (型も async_runtime も `#[tauri::command]` も持ち込まない) し、
//! `crate::` で参照してよいのは `crate::core` 自身と `crate::error` だけ。
//! tests/lint/rustCoreBoundary.test.ts が機械検査する。
//!
//! 段階 0b でこのディレクトリをそのまま `crates/notecore` に切り出す。Tauri の型を
//! 引数に取るモジュール (Vault の一部 / AI SSE クライアント / クエリランタイム /
//! HTTP サーバー) は結合点を外してからここへ移す。

pub mod account_service;
pub mod ai_chat_service;
pub mod ai_keys;
pub mod api_tokens;
pub mod auth_service;
pub mod crash_report;
pub mod credentials;
pub mod emoji_cache_store;
pub mod frontend_bridge;
pub mod http_server;
pub mod image_cache;
pub mod media_proxy;
pub mod media_warm;
pub mod migrations;
pub mod notify_media;
pub mod ogp;
pub mod perf_config;
pub mod permissions_gate;
pub mod permissions_profile;
pub mod pet_store;
pub mod query_runtime;
pub mod rate_limit;
pub mod settings_store;
pub mod shutdown;
pub mod ssrf;
pub mod vault;
