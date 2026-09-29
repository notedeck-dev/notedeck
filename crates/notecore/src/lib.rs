//! notecore — NoteDeck のドメイン層 (#1106)。
//!
//! 「デバイスが 1 台も繋がっていなくても意味を持つ処理」の置き場。Misskey 通信・DB・
//! ストリーミングは notecli に任せ、その上の NoteDeck 固有ドメイン (Vault / クエリ
//! ランタイム / 画像キャッシュ / OGP / 設定ファイル store / 認可解決 / 公開 HTTP API)
//! をここに置く。AI が所有するもの (エージェントループ / HEARTBEAT / capability の実行 /
//! セッション / skill / メモ / AI 設定) は上に載る notemaid クレートにあり、notecore は
//! AI を知らない (capability の宣言表だけは認可と HTTP API が参照するのでここ)。
//!
//! Tauri に依存しない (Cargo.toml に tauri 系を足さない、`#[tauri::command]` を
//! 置かない)。手元側 (WebView / OS 統合) が要る処理は trait (`FrontendBridge` /
//! `SettingsSink` 等) で受け取り、上に載るクレートの状態は `Core::ext_or_init` の
//! 拡張スロットに吊るす。tests/lint/rustCoreBoundary.test.ts が機械検査する。

pub mod account_service;
pub mod accounts;
pub mod ai_keys;
pub mod api_tokens;
pub mod app_dir;
pub mod auth_service;
pub mod backup_service;
pub mod capabilities;
pub mod client_config;
pub mod clock;
pub mod commands;
pub mod context;
pub mod crash_report;
pub mod credentials;
pub mod edit_history;
pub mod emoji_cache_store;
pub mod error;
pub mod export_service;
pub mod frontend_bridge;
pub mod http_server;
pub mod i18n;
pub mod image_cache;
pub mod json5_out;
pub mod keybinds;
pub mod mcp;
pub mod media_proxy;
pub mod media_warm;
#[cfg(target_os = "linux")]
pub mod migration;
pub mod migrations;
pub mod navbar;
pub mod notify_media;
pub mod ogp;
pub mod perf_config;
pub mod performance_settings;
pub mod permissions_gate;
pub mod permissions_profile;
pub mod pet_store;
pub mod query_runtime;
pub mod rate_limit;
pub mod rpc;
pub mod settings_events;
pub mod settings_slug;
pub mod settings_store;
pub mod shutdown;
pub mod sidecar;
pub mod ssrf;
pub mod stream_fanout;
pub mod stream_mode;
pub mod themes;
pub mod vault;
pub mod yaml_lite;
