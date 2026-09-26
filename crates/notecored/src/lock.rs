//! データディレクトリのロック (`<data-dir>/notecore.lock`、flock)。意味は
//! 「その data-dir で notecore を起動する権利」(ストリーム / HEARTBEAT / notecore 側
//! ファイルの書き手)。SQLite の排他ではない。クラッシュで自動解放。NFS 非対応。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;

pub const LOCK_FILE: &str = "notecore.lock";

pub struct Lock {
    _file: File,
}

pub enum LockError {
    Held,
    Io(std::io::Error),
}

pub fn acquire(data_dir: &Path) -> Result<Lock, LockError> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(data_dir.join(LOCK_FILE))
        .map_err(LockError::Io)?;
    match file.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => return Err(LockError::Held),
        Err(std::fs::TryLockError::Error(e)) => return Err(LockError::Io(e)),
    }
    let _ = file.set_len(0);
    let _ = writeln!(file, "{}", std::process::id());
    Ok(Lock { _file: file })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_holder_is_refused_until_released() {
        let dir = tempfile::tempdir().unwrap();
        let first = acquire(dir.path());
        assert!(first.is_ok());
        assert!(matches!(acquire(dir.path()), Err(LockError::Held)));
        drop(first);
        assert!(acquire(dir.path()).is_ok());
    }
}
