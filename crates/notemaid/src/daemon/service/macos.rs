//! macOS: LaunchAgent。`~/Library/LaunchAgents/io.notedeck.notemaid.plist` を書き、
//! `launchctl bootstrap gui/<uid>` で読み込む (ログインのたびに起動、落ちたら起こす)。

use std::path::{Path, PathBuf};
use std::process::Command;

use super::{print_status, self_exe, ServiceCommand, RUN_ARGS};

pub const LABEL: &str = "io.notedeck.notemaid";

fn plist_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{LABEL}.plist")))
}

fn domain() -> String {
    format!("gui/{}", unsafe { libc::getuid() })
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub fn render_plist(exec_path: &Path) -> String {
    let mut args = vec![exec_path.display().to_string()];
    args.extend(RUN_ARGS.iter().map(|s| s.to_string()));
    let items: String = args
        .iter()
        .map(|a| format!("    <string>{}</string>\n", xml_escape(a)))
        .collect();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
{items}  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
"#
    )
}

fn launchctl(args: &[&str]) -> Result<String, String> {
    let out = Command::new("launchctl")
        .args(args)
        .output()
        .map_err(|e| format!("launchctl {}: {e}", args.join(" ")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(format!(
            "launchctl {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

fn install(exec_path: Option<PathBuf>) -> Result<(), String> {
    let exec = match exec_path {
        Some(p) => p,
        None => self_exe()?,
    };
    let path = plist_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, render_plist(&exec)).map_err(|e| e.to_string())?;
    println!("wrote {}", path.display());
    Ok(())
}

fn bootstrap() -> Result<(), String> {
    let path = plist_path()?;
    if !path.exists() {
        install(None)?;
    }
    // 既に読み込まれていれば bootstrap は失敗するので、一度外してから入れ直す
    let _ = launchctl(&["bootout", &format!("{}/{LABEL}", domain())]);
    launchctl(&["bootstrap", &domain(), &path.display().to_string()]).map(|_| ())
}

fn loaded() -> bool {
    launchctl(&["print", &format!("{}/{LABEL}", domain())]).is_ok()
}

fn running() -> bool {
    launchctl(&["print", &format!("{}/{LABEL}", domain())])
        .map(|out| out.contains("state = running"))
        .unwrap_or(false)
}

pub fn run(cmd: ServiceCommand) -> Result<(), String> {
    match cmd {
        ServiceCommand::Install { exec_path } => install(exec_path),
        ServiceCommand::Render { exec_path } => {
            print!("{}", render_plist(&exec_path));
            Ok(())
        }
        ServiceCommand::Enable | ServiceCommand::Start => {
            bootstrap()?;
            println!("loaded {LABEL}");
            Ok(())
        }
        ServiceCommand::Stop => {
            launchctl(&["bootout", &format!("{}/{LABEL}", domain())]).map(|_| ())
        }
        ServiceCommand::Restart => {
            launchctl(&["kickstart", "-k", &format!("{}/{LABEL}", domain())]).map(|_| ())
        }
        ServiceCommand::Uninstall => {
            let _ = launchctl(&["bootout", &format!("{}/{LABEL}", domain())]);
            let path = plist_path()?;
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| e.to_string())?;
            }
            println!("removed {LABEL}");
            Ok(())
        }
        ServiceCommand::Status => {
            let installed = plist_path().map(|p| p.exists()).unwrap_or(false) || loaded();
            print_status(installed, running(), "launchd agent");
            Ok(())
        }
    }
}
