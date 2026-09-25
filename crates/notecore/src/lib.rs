//! notecore — NoteDeck のドメイン層 (#1106)。
//!
//! 「デバイスが 1 台も繋がっていなくても意味を持つ処理」の置き場。Misskey 通信・DB・
//! ストリーミングは notecli に任せ、その上の NoteDeck 固有ドメイン (Vault / クエリ
//! ランタイム / 画像キャッシュ / OGP / AI SSE クライアント / 設定ファイル store /
//! 認可解決 / 公開 HTTP API) をここに置く。アプリ (src-tauri) に埋め込む構成と、
//! notecored で常駐させる構成の両方で同じクレートを使う。
//!
//! Tauri に依存しない (Cargo.toml に tauri 系を足さない、`#[tauri::command]` を
//! 置かない)。手元側 (WebView / OS 統合) が要る処理は trait (`FrontendBridge` /
//! `AiChatSink` 等) で受け取る。tests/lint/rustCoreBoundary.test.ts が機械検査する。

pub mod account_service;
pub mod ai_chat_service;
pub mod ai_config;
pub mod ai_keys;
pub mod ai_sessions;
pub mod ai_turn;
pub mod api_tokens;
pub mod auth_service;
pub mod backup_service;
pub mod capabilities;
pub mod commands;
pub mod context;
pub mod crash_report;
pub mod credentials;
pub mod edit_history;
pub mod emoji_cache_store;
pub mod error;
pub mod export_service;
pub mod frontend_bridge;
pub mod heartbeat;
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
pub mod settings_events;
pub mod settings_slug;
pub mod settings_store;
pub mod shutdown;
pub mod skills;
pub mod ssrf;
pub mod vault;
