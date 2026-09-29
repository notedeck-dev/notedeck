//! notemaid のバイナリ: AI (エージェントループ / HEARTBEAT) を別プロセスで動かす (#1106 案 B)。
//!
//! アプリは socket (Windows は named pipe) の RPC 面に AI 系コマンドを送り、AI の
//! イベントを同じ経路で受け取る。誰が起動するかは 2 通り: アプリが子プロセスとして
//! (既定) / ログイン時のユーザータスク (常駐)。本体は
//! ライブラリ側 (`notemaid::daemon`) にあり、ここは CLI の入口だけ。

// Windows ではログイン時の自動起動やアプリからの呼び出しでコンソール窓を出さない。
// コマンドとして端末から使うときは、起動直後に親のコンソールへ繋ぐ (attach_parent_console)
#![cfg_attr(windows, windows_subsystem = "windows")]

use clap::{Parser, Subcommand};
#[cfg(target_os = "linux")]
use notemaid::daemon::secrets;
use notemaid::daemon::{run, service, status, RunArgs, SocketArgs};

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
    /// ログイン時に起動するユーザー権限のタスク (systemd user unit / LaunchAgent / Run キー) を用意 / 有効化 / 停止する
    #[command(subcommand)]
    Service(service::ServiceCommand),
    /// secret の鍵と本体の面倒を見る (ファイル backend は Linux だけ)
    #[cfg(target_os = "linux")]
    #[command(subcommand)]
    Secrets(secrets::SecretsCommand),
}

/// 端末から起動されたときは親のコンソールに出力する (GUI サブシステムなので既定では出ない)
#[cfg(windows)]
fn attach_parent_console() {
    // リダイレクトされた標準出力 (アプリからの呼び出し) はそのまま使われる
    unsafe {
        windows_sys::Win32::System::Console::AttachConsole(
            windows_sys::Win32::System::Console::ATTACH_PARENT_PROCESS,
        );
    }
}

fn main() {
    #[cfg(windows)]
    attach_parent_console();
    let cli = Cli::parse();
    let code = match cli.command.unwrap_or(Command::Run(RunArgs::default())) {
        Command::Run(args) => run::run(args),
        Command::Status(args) => status::status(args),
        Command::Service(cmd) => service::run(cmd),
        #[cfg(target_os = "linux")]
        Command::Secrets(cmd) => secrets::run(cmd),
    };
    std::process::exit(code);
}
