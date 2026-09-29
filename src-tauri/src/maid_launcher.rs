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

/// 構成に従って繋ぐ先を決める。None = in-process で回す
pub async fn launch(app_dir: &Path, backend: Backend) -> Option<Launched> {
    match backend {
        Backend::Embedded => None,
        Backend::Resident => transport::default_endpoint().map(|endpoint| Launched {
            endpoint,
            child: None,
        }),
        Backend::Auto => {
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
