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
