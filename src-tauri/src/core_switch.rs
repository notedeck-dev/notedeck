//! コアの切替導線 (#1106 段階 3a 順序 7、配布設計 §9)。同一ホスト・Linux 限定。
//!
//! 切替はアプリの再起動で完了する (埋め込みのロックを握ったまま notecored を起動しない):
//! 1. 常駐へ: notecored を探す → `service install` (unit を用意するだけ) → 移行パッケージを
//!    書き出す → `client.json5` を `pending-resident` に → 再起動を促す
//! 2. 次の起動 (`resolve_pending`): 動いていれば止める → パッケージがあれば `migrate import`
//!    → `service enable` → `resident` に。パッケージが無く notecored の secret も空なら
//!    常駐は始めず、今回は埋め込みで開いて状態面に理由を出す
//! 3. 戻す: `service stop` → `migrate export` → アプリが自分の backend に取り込む → 差分ゼロ
//!    のときだけ `secrets purge` → `service uninstall` → `embedded` に → 再起動を促す
//!
//! systemd を直接呼ばない (lifecycle の管理者を知る場所は notecored 1 つ)。secret の複製は
//! 必ず移行パッケージを通す (OS キーチェーンからの直接コピーはしない)。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notecli::error::NoteDeckError;
use notecore::client_config::{self, Backend};
use serde::{Deserialize, Serialize};

use crate::error::Result;

/// 状態面 (`core_status` コマンド)。WebView はこれから文言を組む
#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    /// この OS で常駐に切り替えられるか (同一ホストの 3a は Linux だけ)
    pub platform_supported: bool,
    /// `client.json5` の望む構成: `embedded` | `pending-resident` | `resident`
    pub configured: String,
    /// 見つかった notecored のパス (パッケージなら /usr/bin、それ以外は PATH)
    pub notecored_path: Option<String>,
    pub notecored_version: Option<String>,
    /// user unit が動いているか (notecored が見つからなければ None)
    pub service_active: Option<bool>,
    /// notecored 側の secret store に中身があるか
    pub secrets_present: Option<bool>,
    /// 書き出した移行パッケージが残っているか (再起動待ち)
    pub package_present: Option<bool>,
    /// 前回の起動で切替を完了できなかった理由
    pub switch_error: Option<String>,
}

/// 戻した結果。`remaining` が空でなければ notecored 側の secret は消していない
#[derive(Clone, Debug, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SwitchBack {
    pub imported: Vec<String>,
    pub remaining: Vec<String>,
}

/// 書き出した結果 (Linux では notecore の移行パッケージの Summary そのもの)
#[cfg(target_os = "linux")]
pub type SwitchSummary = notecore::migration::MigrationSummary;
#[cfg(not(target_os = "linux"))]
pub type SwitchSummary = SwitchBack;

static SWITCH_ERROR: Mutex<Option<String>> = Mutex::new(None);

pub fn switch_error() -> Option<String> {
    SWITCH_ERROR.lock().ok().and_then(|e| e.clone())
}

fn set_switch_error(e: Option<String>) {
    if let Ok(mut slot) = SWITCH_ERROR.lock() {
        *slot = e;
    }
}

fn settings_dir(app_dir: &Path) -> PathBuf {
    app_dir.join(crate::commands::SETTINGS_DIR)
}

fn invalid(msg: impl Into<String>) -> NoteDeckError {
    NoteDeckError::InvalidInput(msg.into())
}

/// notecored の所在: パッケージ同梱なら /usr/bin、次に Nix の profile
/// (デスクトップから起動したアプリの PATH には無いことがある)、最後に PATH。
/// 返すのは見つけたパスそのもの (profile の symlink は更新後も同じパスで新しい世代を指す)
pub fn find_notecored() -> Option<PathBuf> {
    // 明示の上書き (PATH 外に置いた人向け。テストは偽の notecored をここで差す)
    if let Some(p) = std::env::var_os("NOTEDECK_NOTECORED").filter(|v| !v.is_empty()) {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    let mut candidates = vec![PathBuf::from("/usr/bin/notecored")];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(
            PathBuf::from(home)
                .join(".nix-profile")
                .join("bin")
                .join("notecored"),
        );
    }
    if let Ok(user) = std::env::var("USER") {
        candidates.push(
            PathBuf::from("/etc/profiles/per-user")
                .join(user)
                .join("bin")
                .join("notecored"),
        );
    }
    candidates.push(PathBuf::from("/run/current-system/sw/bin/notecored"));
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|d| d.join("notecored")));
    }
    candidates.into_iter().find(|p| p.is_file())
}

struct Cli(PathBuf);

impl Cli {
    fn find() -> Result<Self> {
        find_notecored().map(Self).ok_or_else(|| {
            invalid("notecored was not found (install the package or put it on PATH)")
        })
    }

    /// 標準出力を返す。失敗は標準エラーの本文で
    fn run(&self, args: &[&str]) -> Result<String> {
        let out = std::process::Command::new(&self.0)
            .args(args)
            .output()
            .map_err(|e| invalid(format!("{}: {e}", self.0.display())))?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).into_owned())
        } else {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(invalid(format!(
                "notecored {}: {}",
                args.join(" "),
                if err.is_empty() {
                    format!("exit {:?}", out.status.code())
                } else {
                    err
                }
            )))
        }
    }

    fn version(&self) -> Option<String> {
        self.run(&["--version"])
            .ok()
            .map(|s| s.trim().trim_start_matches("notecored ").to_string())
    }

    /// `service status` は systemctl の終了コードをそのまま返す (0 = active)
    fn service_active(&self) -> bool {
        std::process::Command::new(&self.0)
            .args(["service", "status"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn migrate_status(&self, app_dir: &Path) -> Result<(bool, bool)> {
        let out = self.run(&[
            "migrate",
            "status",
            "--data-dir",
            &app_dir.to_string_lossy(),
        ])?;
        let v: serde_json::Value = serde_json::from_str(out.trim())?;
        Ok((
            v["secretsPresent"].as_bool().unwrap_or(false),
            v["packagePresent"].as_bool().unwrap_or(false),
        ))
    }
}

pub fn status(app_dir: &Path) -> CoreStatus {
    let cfg = client_config::load(&settings_dir(app_dir));
    let mut st = CoreStatus {
        platform_supported: cfg!(target_os = "linux"),
        configured: client_config::serialize_backend(cfg.backend).to_string(),
        switch_error: switch_error(),
        ..Default::default()
    };
    if let Some(path) = find_notecored() {
        let cli = Cli(path.clone());
        st.notecored_path = Some(path.display().to_string());
        st.notecored_version = cli.version();
        st.service_active = Some(cli.service_active());
        if let Ok((secrets, package)) = cli.migrate_status(app_dir) {
            st.secrets_present = Some(secrets);
            st.package_present = Some(package);
        }
    }
    st
}

/// 常駐へ (埋め込みで動いているときに呼ぶ)。unit を用意し、パッケージを書き出し、
/// 望む構成を `pending-resident` にする。完了は再起動
#[cfg(target_os = "linux")]
pub fn switch_to_resident(app_dir: &Path, db: &notecli::db::Database) -> Result<SwitchSummary> {
    let cli = Cli::find()?;
    let exec = cli.0.to_string_lossy().into_owned();
    cli.run(&["service", "install", "--exec-path", &exec])?;
    let dir = notecore::migration::default_package_dir().ok_or_else(|| {
        invalid("XDG_RUNTIME_DIR is not set; notecored needs a runtime directory")
    })?;
    let entries = notecore::migration::entries_for(db, app_dir)?;
    let summary = notecore::migration::export(&dir, &entries)?;
    let required_missing: Vec<&String> = entries
        .iter()
        .filter(|e| e.required && summary.missing.contains(&e.name))
        .map(|e| &e.name)
        .collect();
    if !required_missing.is_empty() {
        notecore::migration::remove_package(&dir);
        return Err(invalid(format!(
            "some secrets could not be read from this device's secret store: {}",
            required_missing
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    client_config::save(
        &settings_dir(app_dir),
        &client_config::ClientConfig {
            backend: Backend::PendingResident,
        },
    )?;
    set_switch_error(None);
    Ok(summary)
}

#[cfg(not(target_os = "linux"))]
pub fn switch_to_resident(_app_dir: &Path, _db: &notecli::db::Database) -> Result<SwitchSummary> {
    Err(invalid("switching to notecored is only available on Linux"))
}

/// 起動時 (Phase 1): `pending-resident` なら切替を完了させ、確定した構成を返す。
/// 完了できなければ理由を状態面に残し、今回は埋め込みで開く (`client.json5` は触らない)
pub fn resolve_pending(app_dir: &Path) -> Backend {
    let base = settings_dir(app_dir);
    let cfg = client_config::load(&base);
    if cfg.backend != Backend::PendingResident {
        return cfg.backend;
    }
    match complete_pending(app_dir, &base) {
        Ok(()) => {
            set_switch_error(None);
            Backend::Resident
        }
        Err(e) => {
            tracing::warn!("[core-switch] pending switch not completed: {e}");
            set_switch_error(Some(e.safe_message()));
            Backend::Embedded
        }
    }
}

fn complete_pending(app_dir: &Path, base: &Path) -> Result<()> {
    let cli = Cli::find()?;
    if cli.service_active() {
        cli.run(&["service", "stop"])?;
    }
    let data_dir = app_dir.to_string_lossy().into_owned();
    let (secrets_present, package_present) = cli.migrate_status(app_dir)?;
    if package_present {
        let out = cli.run(&["migrate", "import", "--data-dir", &data_dir])?;
        tracing::info!("[core-switch] imported migration package: {}", out.trim());
    } else if !secrets_present {
        return Err(invalid(
            "the migration package is gone and notecored holds no secrets; switch again or go back to embedded",
        ));
    }
    cli.run(&["service", "enable"])?;
    client_config::save(
        base,
        &client_config::ClientConfig {
            backend: Backend::Resident,
        },
    )?;
    Ok(())
}

/// 常駐構成の起動: unit が止まっていれば起こす (待つのは中継の再接続ループ)
pub fn ensure_started() {
    if let Some(path) = find_notecored() {
        let cli = Cli(path);
        if !cli.service_active() {
            if let Err(e) = cli.run(&["service", "start"]) {
                tracing::warn!("[core-switch] service start failed: {e}");
            }
        }
    }
}

/// 埋め込みへ戻す (常駐で動いているときに呼ぶ)。完了は再起動
#[cfg(target_os = "linux")]
pub fn switch_to_embedded(app_dir: &Path) -> Result<SwitchBack> {
    let cli = Cli::find()?;
    let data_dir = app_dir.to_string_lossy().into_owned();
    if cli.service_active() {
        cli.run(&["service", "stop"])?;
    }
    cli.run(&["migrate", "export", "--data-dir", &data_dir])?;
    let dir = notecore::migration::default_package_dir()
        .ok_or_else(|| invalid("XDG_RUNTIME_DIR is not set"))?;
    let summary = notecore::migration::import(&dir)?;
    let remaining = notecore::migration::missing_in_default(&summary.written)?;
    client_config::save(
        &settings_dir(app_dir),
        &client_config::ClientConfig {
            backend: Backend::Embedded,
        },
    )?;
    if let Err(e) = cli.run(&["service", "uninstall"]) {
        tracing::warn!("[core-switch] service uninstall failed: {e}");
    }
    if remaining.is_empty() {
        cli.run(&["secrets", "purge"])?;
    } else {
        tracing::warn!(
            "[core-switch] {} secrets are still only in notecored's store; not purging",
            remaining.len()
        );
    }
    set_switch_error(None);
    Ok(SwitchBack {
        imported: summary.written,
        remaining,
    })
}

#[cfg(not(target_os = "linux"))]
pub fn switch_to_embedded(_app_dir: &Path) -> Result<SwitchBack> {
    Err(invalid("switching cores is only available on Linux"))
}

/// 切替の途中 (`pending-resident`) をやめて埋め込みのまま使う。unit とパッケージを消す
pub fn cancel_pending(app_dir: &Path) -> Result<()> {
    // 移行パッケージは Linux 限定 (Android は target_os が違うのでモジュール自体が無い)
    #[cfg(target_os = "linux")]
    if let Some(dir) = notecore::migration::default_package_dir() {
        notecore::migration::remove_package(&dir);
    }
    if let Some(path) = find_notecored() {
        if let Err(e) = Cli(path).run(&["service", "uninstall"]) {
            tracing::warn!("[core-switch] service uninstall failed: {e}");
        }
    }
    client_config::save(
        &settings_dir(app_dir),
        &client_config::ClientConfig {
            backend: Backend::Embedded,
        },
    )?;
    set_switch_error(None);
    Ok(())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    //! 偽の notecored (引数を記録して決まった答えを返すシェルスクリプト) で切替導線の
    //! 4 経路を回す。systemd も本物の notecored も要らない。環境変数を触るので直列に走らせる

    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct Fake {
        dir: tempfile::TempDir,
        app_dir: PathBuf,
        run_dir: PathBuf,
        log: PathBuf,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl Fake {
        fn new() -> Self {
            let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = tempfile::tempdir().unwrap();
            let app_dir = dir.path().join("app");
            let run_dir = dir.path().join("run");
            let pkg = run_dir.join("notecored");
            let state = dir.path().join("state");
            std::fs::create_dir_all(app_dir.join(crate::commands::SETTINGS_DIR)).unwrap();
            std::fs::create_dir_all(&pkg).unwrap();
            std::fs::create_dir_all(&state).unwrap();
            let log = dir.path().join("calls.log");
            let bin = dir.path().join("notecored");
            let script = format!(
                r#"#!/bin/sh
echo "$*" >> "{log}"
case "$1 $2" in
  "--version ") echo "notecored 1.72.2" ;;
  "service status") [ -e "{state}/active" ] ;;
  "service install") : ;;
  "service enable") touch "{state}/active" ;;
  "service stop") rm -f "{state}/active" ;;
  "service uninstall") rm -f "{state}/active" ;;
  "migrate status")
    if [ -e "{state}/secrets" ]; then S=true; else S=false; fi
    if [ -e "{pkg}/migration.json" ]; then P=true; else P=false; fi
    echo "{{\"secretsPresent\":$S,\"packagePresent\":$P}}" ;;
  "migrate import") rm -f "{pkg}"/migration.*; touch "{state}/secrets"; echo '{{"written":[],"missing":[]}}' ;;
  "migrate export")
    echo '{{"version":1,"entries":[]}}' > "{pkg}/migration.json"
    head -c 32 /dev/urandom > "{pkg}/migration.key"
    echo '{{"written":[],"missing":[]}}' ;;
  "secrets purge") rm -f "{state}/secrets" ;;
  *) echo "unexpected: $*" >&2; exit 1 ;;
esac
"#,
                log = log.display(),
                state = state.display(),
                pkg = pkg.display(),
            );
            std::fs::write(&bin, script).unwrap();
            restrict(&bin, 0o755);
            std::env::set_var("NOTEDECK_NOTECORED", &bin);
            std::env::set_var("XDG_RUNTIME_DIR", &run_dir);
            set_switch_error(None);
            Self {
                dir,
                app_dir,
                run_dir,
                log,
                _guard: guard,
            }
        }

        fn calls(&self) -> Vec<String> {
            std::fs::read_to_string(&self.log)
                .unwrap_or_default()
                .lines()
                .map(str::to_string)
                .collect()
        }

        fn state(&self, name: &str) -> PathBuf {
            self.dir.path().join("state").join(name)
        }

        fn configured(&self) -> Backend {
            client_config::load(&settings_dir(&self.app_dir)).backend
        }

        fn set_configured(&self, backend: Backend) {
            client_config::save(
                &settings_dir(&self.app_dir),
                &client_config::ClientConfig { backend },
            )
            .unwrap();
        }

        fn write_package(&self) {
            let pkg = self.run_dir.join("notecored");
            std::fs::write(pkg.join("migration.json"), r#"{"version":1,"entries":[]}"#).unwrap();
            std::fs::write(pkg.join("migration.key"), [7u8; 32]).unwrap();
        }
    }

    impl Drop for Fake {
        fn drop(&mut self) {
            std::env::remove_var("NOTEDECK_NOTECORED");
            std::env::remove_var("XDG_RUNTIME_DIR");
        }
    }

    #[test]
    fn switching_to_resident_prepares_the_unit_and_package_then_waits_for_restart() {
        let f = Fake::new();
        let db = notecli::db::Database::open(&f.app_dir.join("notecli.db")).unwrap();
        let summary = switch_to_resident(&f.app_dir, &db).unwrap();
        assert!(summary.written.is_empty());
        assert_eq!(f.configured(), Backend::PendingResident);
        assert!(notecore::migration::package_exists(
            &f.run_dir.join("notecored")
        ));
        let calls = f.calls();
        assert!(
            calls[0].starts_with("service install --exec-path "),
            "{calls:?}"
        );
        // unit を用意するだけで enable / start はしない
        assert!(!calls.iter().any(|c| c.starts_with("service enable")));
        assert_eq!(status(&f.app_dir).configured, "pending-resident");
    }

    #[test]
    fn next_start_imports_the_package_enables_the_unit_and_goes_resident() {
        let f = Fake::new();
        f.set_configured(Backend::PendingResident);
        f.write_package();
        assert_eq!(resolve_pending(&f.app_dir), Backend::Resident);
        assert_eq!(f.configured(), Backend::Resident);
        assert!(switch_error().is_none());
        let calls = f.calls();
        let import = calls
            .iter()
            .position(|c| c.starts_with("migrate import"))
            .unwrap();
        let enable = calls.iter().position(|c| c == "service enable").unwrap();
        assert!(import < enable, "{calls:?}");
        assert!(f.state("active").exists());
        assert!(!f.run_dir.join("notecored").join("migration.json").exists());
    }

    #[test]
    fn next_start_stops_a_leftover_daemon_before_importing() {
        let f = Fake::new();
        f.set_configured(Backend::PendingResident);
        f.write_package();
        std::fs::write(f.state("active"), "").unwrap();
        assert_eq!(resolve_pending(&f.app_dir), Backend::Resident);
        let calls = f.calls();
        let stop = calls.iter().position(|c| c == "service stop").unwrap();
        let import = calls
            .iter()
            .position(|c| c.starts_with("migrate import"))
            .unwrap();
        assert!(stop < import, "{calls:?}");
    }

    #[test]
    fn next_start_without_package_or_secrets_stays_embedded_and_reports_why() {
        let f = Fake::new();
        f.set_configured(Backend::PendingResident);
        assert_eq!(resolve_pending(&f.app_dir), Backend::Embedded);
        // 望む構成は触らない (状態面から「やり直す」「やめる」を選ばせる)
        assert_eq!(f.configured(), Backend::PendingResident);
        assert!(switch_error().is_some());
        assert!(!f.calls().iter().any(|c| c == "service enable"));
        assert_eq!(status(&f.app_dir).switch_error, switch_error());
    }

    #[test]
    fn next_start_with_secrets_but_no_package_still_goes_resident() {
        let f = Fake::new();
        f.set_configured(Backend::PendingResident);
        std::fs::write(f.state("secrets"), "").unwrap();
        assert_eq!(resolve_pending(&f.app_dir), Backend::Resident);
        assert!(!f.calls().iter().any(|c| c.starts_with("migrate import")));
    }

    #[test]
    fn going_back_exports_imports_purges_and_uninstalls_in_order() {
        let f = Fake::new();
        f.set_configured(Backend::Resident);
        std::fs::write(f.state("active"), "").unwrap();
        std::fs::write(f.state("secrets"), "").unwrap();
        let back = switch_to_embedded(&f.app_dir).unwrap();
        assert!(back.imported.is_empty());
        assert!(back.remaining.is_empty());
        assert_eq!(f.configured(), Backend::Embedded);
        let calls = f.calls();
        let order: Vec<usize> = [
            "service stop",
            "migrate export",
            "service uninstall",
            "secrets purge",
        ]
        .iter()
        .map(|k| {
            calls
                .iter()
                .position(|c| c.starts_with(k))
                .unwrap_or_else(|| panic!("{k} missing: {calls:?}"))
        })
        .collect();
        assert!(order.windows(2).all(|w| w[0] < w[1]), "{calls:?}");
        assert!(!f.state("secrets").exists());
        assert!(!f.run_dir.join("notecored").join("migration.json").exists());
    }

    #[test]
    fn cancelling_a_pending_switch_removes_the_unit_and_package() {
        let f = Fake::new();
        f.set_configured(Backend::PendingResident);
        f.write_package();
        set_switch_error(Some("stale".into()));
        cancel_pending(&f.app_dir).unwrap();
        assert_eq!(f.configured(), Backend::Embedded);
        assert!(switch_error().is_none());
        assert!(!notecore::migration::package_exists(
            &f.run_dir.join("notecored")
        ));
        assert!(f.calls().iter().any(|c| c == "service uninstall"));
    }

    #[test]
    fn status_reports_the_binary_and_daemon_state() {
        let f = Fake::new();
        std::fs::write(f.state("active"), "").unwrap();
        let st = status(&f.app_dir);
        assert!(st.platform_supported);
        assert_eq!(st.configured, "embedded");
        assert_eq!(st.notecored_version.as_deref(), Some("1.72.2"));
        assert_eq!(st.service_active, Some(true));
        assert_eq!(st.secrets_present, Some(false));
        assert_eq!(st.package_present, Some(false));
    }

    fn restrict(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
    }
}
