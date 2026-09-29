//! notemaid — NoteDeck の AI (メイド) (#1106 案 C / B)。
//!
//! AI が所有するものを置く: エージェントループ (ターン実行器 / 確認 / 汚染 /
//! チェックポイント)、HEARTBEAT、capability の実行 (`exec`)、セッション、予算、
//! skill、メモ、AI 設定。notecore から借りるのは共有基盤 (Vault / 認可 / 設定
//! ディレクトリと設定ファイルの store / アカウント情報 / i18n) だけで、データ面
//! (notes DB / ストリーミング / クエリランタイム) には依存しない。
//!
//! クレートの依存は notecli ← notecore ← notemaid ← アプリの一方向。notecore は
//! AI を知らない。capability の宣言表 (語彙) は認可と公開 HTTP API も参照するので
//! notecore (`notecore::capabilities`) に残り、実行だけがここにある。
//!
//! ライブラリ + バイナリの 1 クレート (notecli と同形)。バイナリ (`daemon` feature、
//! `src/main.rs` と `daemon/`) が別プロセスとして走り、アプリは AI 系コマンドを
//! socket 越しに送る。ライブラリはアプリ側の型 / コマンド表と、別プロセスを
//! 持てない環境 (iOS) や sidecar が見つからないとき (開発時) の in-process 実行が使う。
//!
//! Tauri に依存しない (tests/lint/rustCoreBoundary.test.ts が notecore と同じ検査をする)。
//! 手元側が要る処理は trait (`AiChatSink` / `AiTurnSink` / `HeartbeatSink` /
//! ...) で受け取る。イベントの届け先は notecore の `EventSink` 1 つ (`sinks::CoreMaidExt` が
//! AI 側の 3 つの sink の形に変換する)。

pub mod acp;
pub mod ai_budget;
pub mod ai_chat_service;
pub mod ai_config;
pub mod ai_sessions;
pub mod ai_turn;
pub mod commands;
#[cfg(feature = "daemon")]
pub mod daemon;
pub mod exec;
pub mod heartbeat;
pub mod heartbeat_schedule;
pub mod memos;
pub mod sinks;
pub mod skills;
pub mod transport;

pub use sinks::CoreMaidExt;
