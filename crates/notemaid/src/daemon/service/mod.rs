//! `notemaid service ...`: ログイン時に notemaid を起動するユーザー権限のタスクを OS に登録する
//! (「アプリを閉じても AI を動かす」の実体、#1106 案 B)。管理者権限も system service も使わない。
//!
//! - Linux: systemd の user unit (`linux.rs`)
//! - macOS: LaunchAgent (`~/Library/LaunchAgents`、`macos.rs`)
//! - Windows: ユーザーごとの Run キー (`windows.rs`)。Task Scheduler の ONLOGON は一般ユーザーでは作れない (管理者が要る) ので使わない
//!
//! `status` はどの OS でも同じ JSON (`installed` / `active` / `detail`) を出し、アプリの
//! トグルはそれを読む。常駐は OS キーチェーンを使う (`run --secrets keychain`)。

use std::path::PathBuf;

use clap::Subcommand;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
use linux as imp;
#[cfg(target_os = "macos")]
use macos as imp;
#[cfg(windows)]
use windows as imp;

#[cfg(target_os = "linux")]
pub use linux::{render_unit, MARKER, UNIT_NAME};

#[derive(Subcommand, Debug, Clone)]
pub enum ServiceCommand {
    /// user unit を用意する (enable / start はしない)
    Install {
        /// unit の ExecStart に書くバイナリ。既定は自分自身
        #[arg(long)]
        exec_path: Option<PathBuf>,
    },
    /// disable --now → 自分が書いた unit の削除 → daemon-reload → reset-failed
    Uninstall,
    /// enable + start (secret の import が済んでから)
    Enable,
    Start,
    Stop,
    Restart,
    /// systemctl --user status
    Status,
    /// パッケージ同梱用に、ExecStart を埋めた unit を標準出力へ書く
    Render {
        /// unit の ExecStart に書くバイナリ (パッケージなら /usr/bin/notemaid)
        #[arg(long, default_value = "/usr/bin/notemaid")]
        exec_path: PathBuf,
    },
}

/// 常駐が実行する引数 (全 OS 共通)。鍵は OS キーチェーン、ログはファイル
pub const RUN_ARGS: &[&str] = &["run", "--secrets", "keychain", "--log", "file"];

pub fn print_status(installed: bool, active: bool, detail: &str) {
    println!(
        "{}",
        serde_json::json!({ "installed": installed, "active": active, "detail": detail })
    );
}

/// 自分自身のパス (install の既定)
pub fn self_exe() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("current_exe: {e}"))
}

pub fn run(cmd: ServiceCommand) -> i32 {
    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    let result = imp::run(cmd);
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    let result: Result<(), String> = {
        let _ = cmd;
        Err("resident notemaid is not supported on this platform".into())
    };
    match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            crate::daemon::exit::FAILURE
        }
    }
}
