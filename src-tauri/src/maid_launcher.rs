//! notemaid (AI の別プロセス) の起動役 (#1106 案 B)。
//!
//! 誰が notemaid を起動するかは 3 通りで、アプリから見た差は繋ぐ先だけ:
//! 1. 常駐 (ログイン時のユーザータスク / 手で `notemaid run`) が既定の場所で待っていれば繋ぐ
//! 2. 居なければ、同梱の sidecar を子プロセスとして起動して繋ぐ (既定。アプリと一緒に終わる)
//! 3. sidecar が無ければ (開発時 / 未同梱のビルド) in-process で回す
//!
//! 子は親の stdin の書き口が閉じたら終わる (全 OS)。Linux ではさらに PDEATHSIG で
//! 親の死を即座に伝える。子の socket は親の pid 入りで、常駐と衝突しない。

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use notecore::client_config::Backend;
use notemaid::transport::{self, Endpoint};

pub struct Launched {
    pub endpoint: Endpoint,
    pub child: Option<Child>,
}

static CHILD: Mutex<Option<Child>> = Mutex::new(None);

/// 同梱の sidecar。Tauri の externalBin は実行ファイルの隣に `notemaid` として置かれる。
/// `NOTEDECK_NOTEMAID` で差し替えられる (開発時に target/ のビルドを指す)
pub fn sidecar_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("NOTEDECK_NOTEMAID") {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let name = format!("{}{}", transport::NAME, std::env::consts::EXE_SUFFIX);
    let p = dir.join(name);
    p.is_file().then_some(p)
}

async fn answering(endpoint: &Endpoint) -> bool {
    matches!(
        tokio::time::timeout(Duration::from_millis(300), transport::connect(endpoint)).await,
        Ok(Ok(_))
    )
}

/// この端末の構成 (`client.json5`) を書く。常駐トグルの結果を次回起動に残す
fn write_backend(app_dir: &Path, backend: Backend) {
    let base = app_dir.join(notecore::commands::settings::SETTINGS_DIR);
    let cfg = notecore::client_config::ClientConfig { backend };
    if let Err(e) = notecore::client_config::save(&base, &cfg) {
        tracing::warn!("[notemaid] could not write client.json5: {e}");
    }
}

/// 構成に従って繋ぐ先を決める。None = in-process で回す
pub async fn launch(app_dir: &Path, backend: Backend) -> Option<Launched> {
    match backend {
        Backend::Embedded => None,
        Backend::Resident => {
            // 常駐にだけ繋ぐ構成。ログイン時タスクが無い (外した / 古い構成ファイルが残った) なら
            // 繋ぐ先が永遠に現れないので、auto に戻して子プロセスで動かす
            let status = tokio::task::spawn_blocking(resident_status)
                .await
                .unwrap_or_default();
            if status.available && !status.installed {
                tracing::warn!("[notemaid] client.json5 says resident but no login task is installed; falling back to auto");
                write_backend(app_dir, Backend::Auto);
                return launch_auto(app_dir).await;
            }
            transport::default_endpoint().map(|endpoint| Launched {
                endpoint,
                child: None,
            })
        }
        Backend::Auto => launch_auto(app_dir).await,
    }
}

/// 既定: 常駐が答えれば繋ぎ、居なければ同梱の sidecar を子プロセスで起動する
async fn launch_auto(app_dir: &Path) -> Option<Launched> {
    {
        {
            if let Some(endpoint) = transport::default_endpoint() {
                if answering(&endpoint).await {
                    tracing::info!(%endpoint, "[notemaid] resident notemaid is answering");
                    return Some(Launched {
                        endpoint,
                        child: None,
                    });
                }
            }
            let Some(bin) = sidecar_path() else {
                tracing::info!("[notemaid] no sidecar next to the app; running the AI in-process");
                return None;
            };
            let endpoint = transport::child_endpoint(std::process::id());
            match spawn(&bin, app_dir, &endpoint) {
                Ok(child) => {
                    // bind を待たずに返す (デッキ描画を待たせない)。繋がるまでは呼び出し側が
                    // `wait_ready` を裏で回し、死んでいたら中継を無効化して in-process に落とす
                    tracing::info!(%endpoint, bin = %bin.display(), pid = child.id(), "[notemaid] started sidecar");
                    Some(Launched {
                        endpoint,
                        child: Some(child),
                    })
                }
                Err(e) => {
                    tracing::warn!(bin = %bin.display(), "[notemaid] sidecar failed to start ({e}); running the AI in-process");
                    None
                }
            }
        }
    }
}

fn spawn(bin: &Path, app_dir: &Path, endpoint: &Endpoint) -> std::io::Result<Child> {
    let mut cmd = Command::new(bin);
    cmd.arg("run")
        .arg("--socket")
        .arg(endpoint.to_string())
        .arg("--data-dir")
        .arg(app_dir)
        .arg("--secrets")
        .arg("keychain")
        .arg("--log")
        .arg("file")
        .arg("--exit-on-stdin-close")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        // 親が死んだら SIGTERM (stdin の EOF より早い)
        unsafe {
            cmd.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
}

/// 子プロセスが答えるまで待つ。先に死んだ / 期限までに答えなければ false (呼び出し側が退避する)
pub async fn wait_ready(endpoint: &Endpoint, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        let exited = CHILD
            .lock()
            .ok()
            .and_then(|mut c| c.as_mut().and_then(|ch| ch.try_wait().ok().flatten()));
        if let Some(status) = exited {
            tracing::warn!(%status, "[notemaid] sidecar exited before answering");
            return false;
        }
        if answering(endpoint).await {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            tracing::warn!(%endpoint, "[notemaid] sidecar did not answer in time");
            return false;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// 子プロセスの handle を持ち続ける (stdin の書き口を開いたままにするため)
pub fn keep(child: Option<Child>) {
    if let Some(child) = child {
        *CHILD.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
    }
}

/// 終了時: stdin を閉じて子に終わらせ、待ち切れなければ kill
pub fn stop() {
    let Some(mut child) = CHILD.lock().unwrap_or_else(|e| e.into_inner()).take() else {
        return;
    };
    drop(child.stdin.take());
    for _ in 0..20 {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// 常駐 (ログイン時のユーザータスク) の状態。`notemaid service status` の JSON をそのまま
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResidentStatus {
    /// トグルが使えるか (sidecar があり、そのパスがログイン後も同じか)
    pub available: bool,
    /// 使えないときの理由 (英語のまま。開発者向け)
    pub reason: Option<String>,
    pub sidecar: Option<String>,
    pub installed: bool,
    pub active: bool,
    pub detail: Option<String>,
}

/// 常駐の ExecStart に書いてよいパスか。AppImage のマウント先や Nix store はログインごと /
/// 更新ごとに変わるので拒む (standalone のバイナリを入れてもらう)
fn stable_sidecar() -> Result<PathBuf, String> {
    let p = sidecar_path().ok_or("no notemaid sidecar next to the app")?;
    let text = p.display().to_string();
    if text.contains("/.mount_") || text.starts_with("/tmp/") {
        return Err(format!(
            "{text} is a temporary mount (AppImage); install the standalone notemaid"
        ));
    }
    if text.starts_with("/nix/store/") {
        return Err(format!(
            "{text} is in the Nix store; use the flake's home-manager module"
        ));
    }
    Ok(p)
}

fn service(bin: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.arg("service").args(args);
    // AI 設定を開くたびに状態を聞くので、Windows でコンソール窓がちらつかないように
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("notemaid service {}: {e}", args.join(" ")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(format!(
            "notemaid service {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

pub fn resident_status() -> ResidentStatus {
    let bin = match stable_sidecar() {
        Ok(b) => b,
        Err(reason) => {
            return ResidentStatus {
                available: false,
                reason: Some(reason),
                sidecar: sidecar_path().map(|p| p.display().to_string()),
                ..Default::default()
            }
        }
    };
    let mut st = ResidentStatus {
        available: true,
        sidecar: Some(bin.display().to_string()),
        ..Default::default()
    };
    match service(&bin, &["status"]) {
        Ok(out) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(out.trim()) {
                st.installed = v["installed"].as_bool().unwrap_or(false);
                st.active = v["active"].as_bool().unwrap_or(false);
                st.detail = v["detail"].as_str().map(str::to_string);
            }
        }
        Err(e) => {
            st.available = false;
            st.reason = Some(e);
        }
    }
    st
}

/// 「アプリを閉じても AI を動かす」の実体。on: 子プロセスを止め、ログイン時タスクを登録して
/// 起動し、中継を常駐の場所に付け替える。off: タスクを外し、子プロセスを起動し直して付け替える
pub async fn set_resident(app_dir: &Path, enabled: bool) -> Result<(), String> {
    let bin = stable_sidecar()?;
    let relay =
        crate::client_layer::relay().ok_or("the AI is running in-process; nothing to switch")?;
    if enabled {
        let target = transport::default_endpoint()
            .ok_or("no place for the resident socket (XDG_RUNTIME_DIR)")?;
        // 登録が先。失敗しても子プロセスは動いたまま (繋ぎ先を失わない)
        service(
            &bin,
            &["install", "--exec-path", &bin.display().to_string()],
        )?;
        // 子を止めてから常駐を起こす (同じデータディレクトリのロック)。失敗したら子に戻す
        stop();
        if let Err(e) = service(&bin, &["enable"]) {
            let _ = service(&bin, &["uninstall"]);
            back_to_child(app_dir, relay).await?;
            return Err(e);
        }
        relay.switch_to(target.clone());
        if !relay.wait_connected(Duration::from_secs(8)).await {
            let _ = service(&bin, &["uninstall"]);
            back_to_child(app_dir, relay).await?;
            return Err(format!(
                "the login task was registered but nothing answered at {target}; see the service log"
            ));
        }
        write_backend(app_dir, Backend::Resident);
    } else {
        let _ = service(&bin, &["stop"]);
        service(&bin, &["uninstall"])?;
        back_to_child(app_dir, relay).await?;
    }
    Ok(())
}

/// 子プロセスを起こし直して中継を付け替える (常駐をやめたとき / 常駐への切替に失敗したとき)
async fn back_to_child(
    app_dir: &Path,
    relay: &crate::client_layer::RelayClient,
) -> Result<(), String> {
    // 常駐が socket を片付けるまで少し待ってから子を起こす (同じデータディレクトリのロック)
    for _ in 0..30 {
        if let Some(ep) = transport::default_endpoint() {
            if !answering(&ep).await {
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let launched = launch(app_dir, Backend::Auto)
        .await
        .ok_or("could not start the notemaid child process")?;
    let endpoint = launched.endpoint.clone();
    keep(launched.child);
    if !wait_ready(&endpoint, Duration::from_secs(8)).await {
        stop();
        return Err("the notemaid child process did not start".into());
    }
    write_backend(app_dir, Backend::Auto);
    relay.switch_to(endpoint.clone());
    if !relay.wait_connected(Duration::from_secs(8)).await {
        return Err(format!(
            "the notemaid child process did not answer at {endpoint}"
        ));
    }
    Ok(())
}

/// 自己診断 (About) 向けの、この端末の notemaid の様子。判断はせず事実だけ返す
#[derive(Debug, Clone, Default, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LauncherDiagnostics {
    /// 同梱の sidecar のパス (無ければ None = in-process しかない)
    pub sidecar: Option<String>,
    /// アプリが起動した子プロセスの pid (居なければ None)
    pub child_pid: Option<u32>,
    /// 子プロセスが既に終わっていればその終了コード (シグナルなら None のまま exited=true)
    pub child_exited: bool,
    pub child_exit_code: Option<i32>,
    /// 常駐 (ログイン時タスク) の登録状態
    pub resident: ResidentStatus,
}

pub fn diagnostics() -> LauncherDiagnostics {
    let (child_pid, child_exited, child_exit_code) = {
        let mut guard = CHILD.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => (Some(child.id()), true, status.code()),
                _ => (Some(child.id()), false, None),
            },
            None => (None, false, None),
        }
    };
    LauncherDiagnostics {
        sidecar: sidecar_path().map(|p| p.display().to_string()),
        child_pid,
        child_exited,
        child_exit_code,
        resident: resident_status(),
    }
}

/// 常駐の版がこのアプリと違うとき (アプリ更新の直後) に、常駐を今のバイナリで起動し直す。
/// 常駐の ExecStart は同梱の sidecar を指しているので、再起動で新しい版になる
pub fn restart_resident() -> Result<(), String> {
    let bin = stable_sidecar()?;
    service(&bin, &["restart"]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 子プロセス経路の通し: sidecar を起動 → 繋がる → 親が止めると終わる。
    /// notemaid の debug バイナリ (cargo build -p notemaid) が無ければ何もせず通す
    #[tokio::test]
    async fn spawns_connects_and_stops_the_sidecar() {
        let bin = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../target/debug")
            .join(format!("notemaid{}", std::env::consts::EXE_SUFFIX));
        if !bin.is_file() {
            eprintln!("skip: {} is not built", bin.display());
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let app_dir = dir.path().join("data");
        std::fs::create_dir_all(&app_dir).unwrap();
        let endpoint = transport::child_endpoint(std::process::id());
        let mut child = spawn(&bin, &app_dir, &endpoint).expect("spawn");
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            assert!(
                !matches!(child.try_wait(), Ok(Some(_))),
                "sidecar exited early"
            );
            if answering(&endpoint).await {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "sidecar did not answer"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        keep(Some(child));
        stop();
        assert!(!answering(&endpoint).await);
        assert!(
            !app_dir.join("notecli.db").exists(),
            "the sidecar must not open the app database"
        );
        assert!(
            !app_dir.join("notemaid.db").exists(),
            "notemaid must not open any SQLite database"
        );
    }
}
