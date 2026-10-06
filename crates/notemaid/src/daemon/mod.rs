//! 別プロセスとして動く notemaid の本体 (`daemon` feature)。CLI の入口は src/main.rs。
//!
//! - `run`: 常駐の本体 (Core の組み立て、HEARTBEAT timer、RPC 面)
//! - `rpc_server` / `sinks`: socket 越しの要求とイベント
//! - `service` / `status` / `secrets` / `lock` / `logging` / `exit`: 常駐の運用

use std::path::PathBuf;

#[derive(clap::ValueEnum, Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SecretsBackend {
    #[default]
    File,
    Keychain,
}

pub mod accounts;
pub mod exit;
pub mod heartbeat_timer;
pub mod lock;
pub mod logging;
pub mod mcp_stdio;
pub mod rpc_server;
pub mod run;
// secret のファイル backend は notecli の file store が Linux 専用なので Linux だけ
#[cfg(target_os = "linux")]
pub mod secrets;
pub mod service;
pub mod sinks;
pub mod status;

#[derive(clap::Args, Debug, Clone, Default)]
pub struct SocketArgs {
    /// RPC 面の場所。Unix は socket のパス (既定 $XDG_RUNTIME_DIR/notemaid/notemaid.sock)、
    /// Windows は named pipe (`\\.\pipe\...`、既定 \\.\pipe\notemaid-<ユーザー名>)
    #[arg(long)]
    pub socket: Option<String>,
}

#[derive(clap::Args, Debug, Clone, Default)]
pub struct RunArgs {
    /// データディレクトリ。既定はアプリと同じ場所 (OS のデータディレクトリ / bundle identifier)
    #[arg(long)]
    pub data_dir: Option<PathBuf>,
    #[command(flatten)]
    pub socket: SocketArgs,
    /// secret の鍵ファイル。既定は OS の設定ディレクトリ / notemaid / secret.key
    #[arg(long)]
    pub secret_key_file: Option<PathBuf>,
    /// ログの出力先。既定は JOURNAL_STREAM があれば stdout、無ければ file
    #[arg(long, value_enum)]
    pub log: Option<logging::LogTarget>,
    /// secret の置き場。file = 暗号化ファイル (常駐 / サーバー向け、鍵は --secret-key-file)、
    /// keychain = OS のキーチェーン (アプリが子プロセスとして起動するときはこちら)
    #[arg(long, value_enum, default_value_t = SecretsBackend::File)]
    pub secrets: SecretsBackend,
    /// 標準入力が閉じたら終了する。アプリが子プロセスとして起動し、親が死んだら
    /// 一緒に終わるための口 (親は stdin の書き口を持ったまま生きる)
    #[arg(long)]
    pub exit_on_stdin_close: bool,
}
