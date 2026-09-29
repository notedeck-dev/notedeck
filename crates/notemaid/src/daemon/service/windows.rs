//! Windows: ログイン時の自動起動をユーザーごとの Run キー
//! (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) で行う。
//!
//! Task Scheduler の ONLOGON タスクは一般ユーザーだと `schtasks /Create` が
//! 「Access is denied」になる (管理者権限が要る) ので使わない。Windows Service も管理者が
//! 要り寿命がマシン起動に紐づくので使わない。Run キーは登録にも起動にも権限が要らない。
//! 止めるときは OS のシグナルが無いので、既定の pipe に `notemaid.shutdown` を送って頼む。
//! 子プロセスは窓を出さない (`CREATE_NO_WINDOW`)。

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use super::{print_status, self_exe, ServiceCommand, RUN_ARGS};

const RUN_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
pub const VALUE_NAME: &str = "NoteDeck notemaid";

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

fn reg(args: &[&str]) -> Result<String, String> {
    let out = Command::new("reg")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("reg {}: {e}", args.join(" ")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(format!(
            "reg {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// Run キーに書くコマンド行 (パスは引用符で囲む)
pub fn run_command(exec: &Path) -> String {
    let mut s = format!("\"{}\"", exec.display());
    for a in RUN_ARGS {
        s.push(' ');
        s.push_str(a);
    }
    s
}

fn install(exec_path: Option<PathBuf>) -> Result<(), String> {
    let exec = match exec_path {
        Some(p) => p,
        None => self_exe()?,
    };
    reg(&[
        "add",
        RUN_KEY,
        "/v",
        VALUE_NAME,
        "/t",
        "REG_SZ",
        "/d",
        &run_command(&exec),
        "/f",
    ])?;
    println!("registered \"{VALUE_NAME}\" to start at login");
    Ok(())
}

fn exists() -> bool {
    reg(&["query", RUN_KEY, "/v", VALUE_NAME]).is_ok()
}

/// 常駐の pipe があるか (開けた / 全インスタンスが使用中 = 居る)
fn running() -> bool {
    let Some(crate::transport::Endpoint::Pipe(name)) = crate::transport::default_endpoint() else {
        return false;
    };
    match std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&name)
    {
        Ok(_) => true,
        // ERROR_PIPE_BUSY
        Err(e) => e.raw_os_error() == Some(231),
    }
}

/// 今すぐ起動する (ログインを待たない)。窓を出さず、呼んだプロセスから切り離す
fn start() -> Result<(), String> {
    if running() {
        return Ok(());
    }
    let exe = self_exe()?;
    Command::new(&exe)
        .args(RUN_ARGS)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| format!("{}: {e}", exe.display()))?;
    Ok(())
}

/// 動いていれば `notemaid.shutdown` で止め、pipe が消えるまで少し待つ
fn stop() -> Result<(), String> {
    if !running() {
        return Ok(());
    }
    let Some(endpoint) = crate::transport::default_endpoint() else {
        return Ok(());
    };
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(crate::daemon::status::request(
        &endpoint,
        "notemaid.shutdown",
    ))?;
    for _ in 0..50 {
        if !running() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("notemaid did not stop within 5 seconds".into())
}

pub fn run(cmd: ServiceCommand) -> Result<(), String> {
    match cmd {
        ServiceCommand::Install { exec_path } => install(exec_path),
        ServiceCommand::Render { exec_path } => {
            println!("{}", run_command(&exec_path));
            Ok(())
        }
        ServiceCommand::Enable => {
            if !exists() {
                install(None)?;
            }
            start().map(|_| println!("started \"{VALUE_NAME}\""))
        }
        ServiceCommand::Start => start(),
        ServiceCommand::Stop => stop(),
        ServiceCommand::Restart => {
            stop()?;
            start()
        }
        ServiceCommand::Uninstall => {
            let _ = stop();
            if exists() {
                reg(&["delete", RUN_KEY, "/v", VALUE_NAME, "/f"])?;
            }
            println!("removed \"{VALUE_NAME}\"");
            Ok(())
        }
        ServiceCommand::Status => {
            print_status(exists(), running(), "Run key (login)");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_command_quotes_the_path() {
        let cmd = run_command(Path::new(
            r"C:\Users\a b\AppData\Local\NoteDeck\notemaid.exe",
        ));
        assert!(cmd.starts_with("\"C:\\Users\\a b\\AppData\\Local\\NoteDeck\\notemaid.exe\" run"));
    }
}
