//! notemaid のバイナリ: AI (エージェントループ / HEARTBEAT) を別プロセスで動かす (#1106 案 B)。
//!
//! アプリは socket (Windows は named pipe) の RPC 面に AI 系コマンドを送り、AI の
//! イベントを同じ経路で受け取る。誰が起動するかは 3 通り: アプリが子プロセスとして
//! (既定) / ログイン時のユーザータスク (常駐) / 自分のサーバー (リモート)。本体は
//! ライブラリ側 (`notemaid::daemon`) にあり、ここは CLI の入口だけ。

use clap::{Parser, Subcommand};
#[cfg(target_os = "linux")]
use notemaid::daemon::service;
use notemaid::daemon::{run, secrets, status, RunArgs, SocketArgs};

#[derive(Parser, Debug)]
#[command(name = "notemaid", version, about = "NoteDeck resident core daemon")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand, Debug, Clone)]
enum Command {
    /// 常駐を始める (サブコマンド省略時の既定)
    Run(RunArgs),
    /// 動いている notemaid の状態を socket 越しに表示する
    Status(SocketArgs),
    /// ログイン時に起動するユーザー権限のタスク (systemd user unit / LaunchAgent / Task Scheduler) を用意 / 有効化 / 停止する
    #[command(subcommand)]
    Service(service::ServiceCommand),
    /// secret の鍵と本体の面倒を見る
    #[command(subcommand)]
    Secrets(secrets::SecretsCommand),
}

fn main() {
    let cli = Cli::parse();
    let code = match cli.command.unwrap_or(Command::Run(RunArgs::default())) {
        Command::Run(args) => run::run(args),
        Command::Status(args) => status::status(args),
        Command::Service(cmd) => service::run(cmd),
        Command::Secrets(cmd) => secrets::run(cmd),
    };
    std::process::exit(code);
}
