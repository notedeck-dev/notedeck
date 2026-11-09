//! データディレクトリの再編 (#1334) の起動時の順序。
//!
//! 移行するのはアプリだけ。版印が無ければ、まず常駐の notemaid (旧配置の書き手) を
//! `notemaid.shutdown` で止め (再起動ではない: AppImage / Nix では `restart_resident` が
//! 使えない)、止められたときだけ `.layout.lock` を blocking で取って再編する。止められ
//! なければ移行せず旧配置で続ける。結果は managed state に置き、フロントが起動後に
//! 読んで、操作が要る人にだけ知らせる。

use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use notecore::layout_migration::{self, LayoutMigrationReport, LayoutNotice, Skip};

/// この起動での再編の結果 (フロントが 1 回読む)
pub struct LayoutReport(pub Mutex<LayoutMigrationReport>);

/// 旧配置の書き手が居ないことを確かめてから再編する (デスクトップ)
#[cfg(desktop)]
pub fn prepare(app_dir: &Path) -> LayoutMigrationReport {
    use notemaid::transport;
    if notecore::app_dir::Layout::marker_path(app_dir).is_file() {
        return LayoutMigrationReport::default();
    }
    let mut notices = Vec::new();
    if let Some(endpoint) = transport::default_endpoint() {
        let stopped = tauri::async_runtime::block_on(stop_resident(&endpoint));
        match stopped {
            Probe::NotRunning => {}
            Probe::Stopped => notices.push(LayoutNotice::StandaloneStopped),
            Probe::StillRunning => {
                tracing::warn!("[layout] a resident notemaid is still running; not migrating");
                notices.push(LayoutNotice::ResidentAlive);
                return LayoutMigrationReport {
                    migrated: false,
                    notices,
                };
            }
        }
    }
    finish(app_dir, notices)
}

/// Android / iOS: daemon は無いので probe は要らない。worker も同じ入口を通る
#[cfg(not(desktop))]
pub fn prepare(app_dir: &Path) -> LayoutMigrationReport {
    finish(app_dir, Vec::new())
}

fn finish(app_dir: &Path, mut notices: Vec<LayoutNotice>) -> LayoutMigrationReport {
    match layout_migration::run_locked(app_dir) {
        Ok(mut r) => {
            tracing::info!("[layout] migrated the data directory to config / data / state / cache");
            notices.append(&mut r.notices);
            LayoutMigrationReport {
                migrated: r.migrated,
                notices,
            }
        }
        Err(Skip::AlreadyDone) => LayoutMigrationReport {
            migrated: false,
            notices,
        },
        Err(Skip::SettingsIsSymlink) => {
            tracing::warn!("[layout] notedeck/ is a symlink; not migrating");
            notices.push(LayoutNotice::SymlinkedSettings);
            LayoutMigrationReport {
                migrated: false,
                notices,
            }
        }
        Err(Skip::ResidentAlive) => {
            notices.push(LayoutNotice::ResidentAlive);
            LayoutMigrationReport {
                migrated: false,
                notices,
            }
        }
        Err(Skip::Failed(message)) => {
            tracing::error!("[layout] migration failed and was rolled back: {message}");
            notices.push(LayoutNotice::Failed { message });
            LayoutMigrationReport {
                migrated: false,
                notices,
            }
        }
    }
}

#[cfg(desktop)]
enum Probe {
    NotRunning,
    Stopped,
    StillRunning,
}

/// 動いている常駐に `notemaid.shutdown` を送り、socket が閉じるまで少し待つ
#[cfg(desktop)]
async fn stop_resident(endpoint: &notemaid::transport::Endpoint) -> Probe {
    use notecore::rpc::Frame;
    use notemaid::transport;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let Ok(Ok(stream)) =
        tokio::time::timeout(Duration::from_millis(500), transport::connect(endpoint)).await
    else {
        return Probe::NotRunning;
    };
    let (reader, mut writer) = tokio::io::split(stream);
    let mut lines = BufReader::new(reader).lines();
    let Ok(Ok(Some(first))) = tokio::time::timeout(Duration::from_secs(2), lines.next_line()).await
    else {
        return Probe::StillRunning;
    };
    let Ok(Frame::Hello { secret, .. }) = serde_json::from_str::<Frame>(&first) else {
        return Probe::StillRunning;
    };
    let req = Frame::Request {
        id: 1,
        secret,
        name: "notemaid.shutdown".to_string(),
        params: serde_json::json!({}),
        window: None,
    };
    let Ok(mut line) = serde_json::to_string(&req) else {
        return Probe::StillRunning;
    };
    line.push('\n');
    if writer.write_all(line.as_bytes()).await.is_err() {
        return Probe::StillRunning;
    }
    // 止まるまで待つ (最大 5 秒)
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let alive = matches!(
            tokio::time::timeout(Duration::from_millis(300), transport::connect(endpoint)).await,
            Ok(Ok(_))
        );
        if !alive {
            return Probe::Stopped;
        }
        if tokio::time::Instant::now() >= deadline {
            return Probe::StillRunning;
        }
    }
}

/// この起動での再編の結果 (フロントは起動時に 1 回読んで、操作が要る人にだけ知らせる)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn layout_migration_report(state: tauri::State<'_, LayoutReport>) -> LayoutMigrationReport {
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    // 知らせは 1 回だけ (窓ごとに重ねて出さない)
    LayoutMigrationReport {
        migrated: guard.migrated,
        notices: std::mem::take(&mut guard.notices),
    }
}
