//! データディレクトリのロック (`notemaid.lock`、flock)。意味は
//! 「その data-dir で notecore を起動する権利」(ストリーム / HEARTBEAT / notecore 側
//! ファイルの書き手)。SQLite の排他ではない。クラッシュで自動解放。NFS 非対応。
//!
//! 置き場は旧配置では root 直下、再編後 (#1334) は `state/notemaid.lock`。移行で
//! ロックファイルは動かさない (動かすと旧 daemon の flock が inode に付いて行く) ので、
//! 再編後の daemon は root 直下の旧ロックも non-blocking で取りに行き、取れなければ
//! 旧 daemon が生きているとみなして退く (新パスだけ取ると 2 つ立つ)。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;

use notecore::app_dir::Layout;

pub const LOCK_FILE: &str = "notemaid.lock";

pub struct Lock {
    _file: File,
    /// 再編後に併せて押さえる旧ロック
    _legacy: Option<File>,
}

pub enum LockError {
    Held,
    Io(std::io::Error),
}

fn try_lock_file(path: &Path) -> Result<File, LockError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(LockError::Io)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(LockError::Io)?;
    match file.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => return Err(LockError::Held),
        Err(std::fs::TryLockError::Error(e)) => return Err(LockError::Io(e)),
    }
    let _ = file.set_len(0);
    let _ = writeln!(file, "{}", std::process::id());
    Ok(file)
}

pub fn acquire(layout: &Layout) -> Result<Lock, LockError> {
    if layout.is_legacy() {
        return Ok(Lock {
            _file: try_lock_file(&layout.root().join(LOCK_FILE))?,
            _legacy: None,
        });
    }
    let legacy = try_lock_file(&layout.root().join(LOCK_FILE))?;
    let file = try_lock_file(&layout.state().join(LOCK_FILE))?;
    Ok(Lock {
        _file: file,
        _legacy: Some(legacy),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_holder_is_refused_until_released() {
        let dir = tempfile::tempdir().unwrap();
        let layout = Layout::legacy(dir.path());
        let first = acquire(&layout);
        assert!(first.is_ok());
        assert!(matches!(acquire(&layout), Err(LockError::Held)));
        drop(first);
        assert!(acquire(&layout).is_ok());
    }

    /// 再編後の daemon は旧ロックも押さえる: 旧配置の daemon が生きていれば退く
    #[test]
    fn reorganized_daemon_yields_to_a_legacy_holder() {
        let dir = tempfile::tempdir().unwrap();
        let old = acquire(&Layout::legacy(dir.path())).ok();
        assert!(matches!(
            acquire(&Layout::v1(dir.path())),
            Err(LockError::Held)
        ));
        drop(old);
        let new = acquire(&Layout::v1(dir.path()));
        assert!(new.is_ok());
        assert!(dir.path().join("state/notemaid.lock").exists());
        // 新しい daemon が居る間は旧配置の daemon も立てない
        assert!(matches!(
            acquire(&Layout::legacy(dir.path())),
            Err(LockError::Held)
        ));
    }
}
