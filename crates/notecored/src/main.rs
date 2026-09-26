//! notecored — notecore を WebView なしで常駐させるデーモン (#1106 段階 3a)。
//!
//! 同一ホストのアプリは Unix socket の RPC 面 (コマンド表の JSON アダプタ) を叩き、
//! notecore が出すイベントを同じ socket で受け取る。公開 API 面 (HTTP) は既定 off。

mod exit;
mod heartbeat_timer;
mod lock;
mod logging;
mod rpc_server;
mod run;
mod sinks;
mod status;

use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "notecored", version, about = "NoteDeck resident core daemon")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug, Clone)]
enum Command {
    /// 常駐を始める (サブコマンド省略時の既定)
    Run(RunArgs),
    /// 動いている notecored の状態を socket 越しに表示する
    Status(SocketArgs),
}

#[derive(clap::Args, Debug, Clone, Default)]
pub struct SocketArgs {
    /// RPC 面の Unix socket。既定は $XDG_RUNTIME_DIR/notecored/notecored.sock
    #[arg(long)]
    pub socket: Option<PathBuf>,
}

#[derive(clap::Args, Debug, Clone, Default)]
pub struct RunArgs {
    /// データディレクトリ。既定はアプリと同じ場所 (OS のデータディレクトリ / bundle identifier)
    #[arg(long)]
    pub data_dir: Option<PathBuf>,
    #[command(flatten)]
    pub socket: SocketArgs,
    /// secret の鍵ファイル。既定は OS の設定ディレクトリ / notecored / secret.key
    #[arg(long)]
    pub secret_key_file: Option<PathBuf>,
    /// ログの出力先。既定は JOURNAL_STREAM があれば stdout、無ければ file
    #[arg(long, value_enum)]
    pub log: Option<logging::LogTarget>,
    /// 公開 API 面 (HTTP、既定 off) を bind する
    #[arg(long)]
    pub api: bool,
}

fn main() {
    let cli = Cli::parse();
    let code = match cli.command.unwrap_or(Command::Run(RunArgs::default())) {
        Command::Run(args) => run::run(args),
        Command::Status(args) => status::status(args),
    };
    std::process::exit(code);
}
