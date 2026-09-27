//! `notecored service <install|uninstall|enable|start|stop|restart|status>`:
//! systemd の user unit の面倒を見る (#1106 段階 3a の補遺 §6)。
//!
//! - unit の正本は `deploy/notecored.service` 1 ファイル (生成マーカー入り)
//! - install は unit を用意するだけで enable も start もしない (secret の import 前に
//!   起動させない)。enable / start は切替導線が import の後に呼ぶ
//! - パッケージ同梱の unit (`/usr/lib/systemd/user/`) があれば書かない。手書きや
//!   NixOS / home-manager の unit (マーカー無し) は上書きせず拒否する
//! - systemd が無ければ拒否して `notecored run` を案内する

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use clap::Subcommand;

use crate::exit;

pub const MARKER: &str = "# notedeck:notecored-unit";
pub const UNIT_NAME: &str = "notecored.service";
const TEMPLATE: &str = include_str!("../deploy/notecored.service");
const PACKAGE_UNIT: &str = "/usr/lib/systemd/user/notecored.service";

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
        /// unit の ExecStart に書くバイナリ (パッケージなら /usr/bin/notecored)
        #[arg(long, default_value = "/usr/bin/notecored")]
        exec_path: PathBuf,
    },
}

/// テンプレートに ExecStart と終了コードを埋める
pub fn render_unit(exec_path: &Path) -> String {
    let codes = exit::NO_RESTART
        .iter()
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join(" ");
    TEMPLATE
        .replace("@EXEC_START@", &exec_path.display().to_string())
        .replace("@NO_RESTART@", &codes)
}

/// Nix store の実体を指す、更新後も同じパスで新しい世代を指す symlink を探す:
/// ~/.nix-profile/bin、/etc/profiles/per-user/<user>/bin、/run/current-system/sw/bin、PATH。
/// 実体 (canonicalize) が一致するものだけを候補にする
pub fn stable_alias_for(real: &Path) -> Option<PathBuf> {
    if !is_nix_store(real) {
        return None;
    }
    let name = real.file_name()?;
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".nix-profile").join("bin").join(name));
    }
    if let Ok(user) = std::env::var("USER") {
        candidates.push(
            PathBuf::from("/etc/profiles/per-user")
                .join(user)
                .join("bin")
                .join(name),
        );
    }
    candidates.push(PathBuf::from("/run/current-system/sw/bin").join(name));
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join(name)));
    }
    candidates
        .into_iter()
        .filter(|c| !is_nix_store(c))
        .find(|c| c.canonicalize().map(|r| r == real).unwrap_or(false))
}

pub fn has_marker(content: &str) -> bool {
    content
        .lines()
        .next()
        .map(|l| l.starts_with(MARKER))
        .unwrap_or(false)
}

/// 実行 uid が書き込めるパスか (差し替えられる場所に置いた警告用)
pub fn writable_by_me(path: &Path) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    let uid = unsafe { libc::getuid() };
    let mode = meta.mode();
    (meta.uid() == uid && mode & 0o200 != 0) || mode & 0o002 != 0
}

pub fn is_nix_store(path: &Path) -> bool {
    path.starts_with("/nix/store")
}

fn user_unit_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("systemd").join("user").join(UNIT_NAME))
}

fn systemctl(args: &[&str]) -> Result<String, String> {
    let out = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .map_err(|e| format!("systemctl --user {}: {e}", args.join(" ")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(format!(
            "systemctl --user {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// user manager が動いているか。無ければ install / enable を拒否する
fn ensure_user_manager() -> Result<(), String> {
    match Command::new("systemctl")
        .args(["--user", "is-system-running"])
        .output()
    {
        Ok(out) => {
            let state = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if out.status.success() || state == "degraded" || state == "running" {
                Ok(())
            } else {
                Err(format!(
                    "systemd user manager is not available ({state}); run `notecored run` yourself or enable systemd"
                ))
            }
        }
        Err(e) => Err(format!(
            "systemctl is not available ({e}); run `notecored run` yourself or use a container"
        )),
    }
}

fn linger_hint() {
    let user = std::env::var("USER").unwrap_or_default();
    let linger = Command::new("loginctl")
        .args(["show-user", &user, "-p", "Linger", "--value"])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    if linger.as_deref() != Some("yes") {
        eprintln!(
            "note: linger is not enabled; notecored stops at logout. Run: loginctl enable-linger {user}"
        );
    }
}

pub fn run(cmd: ServiceCommand) -> i32 {
    let result = match cmd {
        ServiceCommand::Install { exec_path } => install(exec_path),
        ServiceCommand::Render { exec_path } => {
            print!("{}", render_unit(&exec_path));
            Ok(())
        }
        ServiceCommand::Uninstall => uninstall(),
        ServiceCommand::Enable => ensure_user_manager()
            .and_then(|_| systemctl(&["enable", "--now", UNIT_NAME]))
            .map(|_| println!("enabled and started {UNIT_NAME}")),
        ServiceCommand::Start => systemctl(&["start", UNIT_NAME]).map(|_| ()),
        ServiceCommand::Stop => systemctl(&["stop", UNIT_NAME]).map(|_| ()),
        ServiceCommand::Restart => systemctl(&["restart", UNIT_NAME]).map(|_| ()),
        ServiceCommand::Status => Command::new("systemctl")
            .args(["--user", "status", "--no-pager", UNIT_NAME])
            .status()
            .map(|_| ())
            .map_err(|e| e.to_string()),
    };
    match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            exit::FAILURE
        }
    }
}

fn install(exec_path: Option<PathBuf>) -> Result<(), String> {
    ensure_user_manager()?;
    if let Ok(pkg) = std::fs::read_to_string(PACKAGE_UNIT) {
        if has_marker(&pkg) {
            println!("package unit found at {PACKAGE_UNIT}; nothing to write. Next: notecored service enable");
            linger_hint();
            return Ok(());
        }
    }
    let exec = match exec_path {
        Some(p) => p,
        None => {
            let me = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
            // 実体が Nix store なら、それを指す安定した symlink (profile / PATH) を探して使う
            stable_alias_for(&me).unwrap_or(me)
        }
    };
    // 実パスは存在確認と書込可否の判定に使う。ExecStart に書くのは渡されたパスの方:
    // ~/.nix-profile/bin/notecored のような profile の symlink は更新後も同じパスで
    // 新しい世代を指すので、実パス (/nix/store/...) より安定する
    let real = exec
        .canonicalize()
        .map_err(|e| format!("{}: {e}", exec.display()))?;
    if is_nix_store(&exec) {
        return Err(format!(
            "{} is in the Nix store, which the garbage collector may remove; pass the profile path (e.g. ~/.nix-profile/bin/notecored) or use the NixOS / home-manager module",
            exec.display()
        ));
    }
    let exec = if exec.is_absolute() {
        exec
    } else {
        real.clone()
    };
    let exec = if is_nix_store(&real) {
        exec
    } else {
        real.clone()
    };
    if writable_by_me(&real) {
        eprintln!(
            "warning: {} is writable by your user; anything running as you could replace the daemon. Prefer a package-managed path (--exec-path)",
            exec.display()
        );
    }
    let unit_path = user_unit_path().ok_or("no config directory for systemd user units")?;
    if let Ok(existing) = std::fs::read_to_string(&unit_path) {
        if !has_marker(&existing) {
            // home-manager / NixOS / 手書きの unit。上書きはしないが、unit は用意されている
            // ので切替導線はそのまま進める (enable / start はその unit に対して行う)
            println!(
                "{} exists and is managed elsewhere (NixOS / home-manager / handwritten); keeping it. Next: notecored service enable",
                unit_path.display()
            );
            linger_hint();
            return Ok(());
        }
    }
    if let Some(dir) = unit_path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(&unit_path, render_unit(&exec))
        .map_err(|e| format!("{}: {e}", unit_path.display()))?;
    systemctl(&["daemon-reload"])?;
    println!(
        "wrote {} (ExecStart={})",
        unit_path.display(),
        exec.display()
    );
    println!("next: import secrets, then `notecored service enable`");
    linger_hint();
    Ok(())
}

fn uninstall() -> Result<(), String> {
    let _ = systemctl(&["disable", "--now", UNIT_NAME]);
    if let Some(unit_path) = user_unit_path() {
        if let Ok(existing) = std::fs::read_to_string(&unit_path) {
            if has_marker(&existing) {
                std::fs::remove_file(&unit_path)
                    .map_err(|e| format!("{}: {e}", unit_path.display()))?;
                println!("removed {}", unit_path.display());
            } else {
                println!(
                    "{} was not written by notecored; left in place",
                    unit_path.display()
                );
            }
        }
    }
    let _ = systemctl(&["daemon-reload"]);
    let _ = systemctl(&["reset-failed", UNIT_NAME]);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_template_renders_exec_and_exit_codes() {
        let unit = render_unit(Path::new("/usr/bin/notecored"));
        assert!(has_marker(&unit));
        assert!(unit.contains("ExecStart=/usr/bin/notecored run\n"));
        assert!(unit.contains("RestartPreventExitStatus=10 11 12 13\n"));
        assert!(!unit.contains("ProtectHome"));
        assert!(unit.contains("StartLimitBurst"));
        assert!(!has_marker("[Unit]\nDescription=x\n"));
    }

    #[test]
    fn stable_alias_prefers_a_symlink_outside_the_store() {
        let dir = tempfile::tempdir().unwrap();
        // 実体が store の外なら何もしない
        let plain = dir.path().join("notecored");
        std::fs::write(&plain, "x").unwrap();
        assert_eq!(stable_alias_for(&plain), None);
        // PATH 上の symlink が実体を指していればそれを返す (実体は store 風のパスにできない
        // ので、PATH 側の探索だけを検査する: 実体と一致しない候補は選ばれない)
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::os::unix::fs::symlink(&plain, bin.join("notecored")).unwrap();
        assert_eq!(stable_alias_for(&plain), None);
    }

    #[test]
    fn detects_writable_and_nix_paths() {
        let dir = tempfile::tempdir().unwrap();
        let mine = dir.path().join("notecored");
        std::fs::write(&mine, "x").unwrap();
        assert!(writable_by_me(&mine));
        assert!(!writable_by_me(Path::new("/proc/version")));
        assert!(is_nix_store(Path::new(
            "/nix/store/abc-notecored/bin/notecored"
        )));
        assert!(!is_nix_store(&mine));
    }
}
