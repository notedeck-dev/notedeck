//! Windows: Task Scheduler の ONLOGON タスク (非昇格、`/RL LIMITED`)。Windows Service は
//! 管理者権限が要り寿命がマシン起動に紐づくので使わない (Hermes / OpenClaw と同じ判断)。

use std::path::PathBuf;
use std::process::Command;

use super::{print_status, self_exe, ServiceCommand, RUN_ARGS};

pub const TASK_NAME: &str = "NoteDeck notemaid";

fn schtasks(args: &[&str]) -> Result<String, String> {
    let out = Command::new("schtasks")
        .args(args)
        .output()
        .map_err(|e| format!("schtasks {}: {e}", args.join(" ")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(format!(
            "schtasks {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

fn task_command(exec: &std::path::Path) -> String {
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
    schtasks(&[
        "/Create",
        "/F",
        "/SC",
        "ONLOGON",
        "/RL",
        "LIMITED",
        "/TN",
        TASK_NAME,
        "/TR",
        &task_command(&exec),
    ])?;
    println!("registered task \"{TASK_NAME}\"");
    Ok(())
}

fn exists() -> bool {
    schtasks(&["/Query", "/TN", TASK_NAME]).is_ok()
}

fn running() -> bool {
    schtasks(&["/Query", "/TN", TASK_NAME, "/FO", "LIST", "/V"])
        .map(|out| {
            out.lines()
                .any(|l| l.trim_start().starts_with("Status:") && l.contains("Running"))
        })
        .unwrap_or(false)
}

pub fn run(cmd: ServiceCommand) -> Result<(), String> {
    match cmd {
        ServiceCommand::Install { exec_path } => install(exec_path),
        ServiceCommand::Render { exec_path } => {
            println!("{}", task_command(&exec_path));
            Ok(())
        }
        ServiceCommand::Enable => {
            if !exists() {
                install(None)?;
            }
            schtasks(&["/Run", "/TN", TASK_NAME]).map(|_| println!("started \"{TASK_NAME}\""))
        }
        ServiceCommand::Start => schtasks(&["/Run", "/TN", TASK_NAME]).map(|_| ()),
        ServiceCommand::Stop => schtasks(&["/End", "/TN", TASK_NAME]).map(|_| ()),
        ServiceCommand::Restart => {
            let _ = schtasks(&["/End", "/TN", TASK_NAME]);
            schtasks(&["/Run", "/TN", TASK_NAME]).map(|_| ())
        }
        ServiceCommand::Uninstall => {
            let _ = schtasks(&["/End", "/TN", TASK_NAME]);
            schtasks(&["/Delete", "/F", "/TN", TASK_NAME])
                .map(|_| println!("removed \"{TASK_NAME}\""))
        }
        ServiceCommand::Status => {
            print_status(exists(), running(), "Task Scheduler (ONLOGON)");
            Ok(())
        }
    }
}
