//! `notecored secrets <keygen|purge>`: ファイル backend の鍵と本体の面倒を見る
//! (#1106 段階 3a の補遺 §7)。移行パッケージの import / export は順序 7。

use std::path::{Path, PathBuf};

use clap::Subcommand;

use crate::exit;

#[derive(Subcommand, Debug, Clone)]
pub enum SecretsCommand {
    /// 鍵を生成する (system unit の credential 用。既に有れば拒否)
    Keygen {
        #[arg(long)]
        out: PathBuf,
    },
    /// notecored の secret (本体と鍵) を消す。アプリ側の劣化先 (notecli/) は触らない
    Purge {
        /// データディレクトリ。既定はアプリと同じ場所
        #[arg(long)]
        data_dir: Option<PathBuf>,
        #[arg(long)]
        secret_key_file: Option<PathBuf>,
        /// 確認なしで実行する
        #[arg(long)]
        yes: bool,
    },
}

pub fn default_key_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("notecored").join("secret.key"))
}

pub fn secrets_path(data_dir: &Path) -> PathBuf {
    data_dir.join("notecored").join("secrets.enc")
}

pub fn keygen(out: &Path) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(out)
        .map_err(|e| format!("{}: {e}", out.display()))?;
    let key: [u8; 32] = rand::random();
    f.write_all(&key).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn run(cmd: SecretsCommand) -> i32 {
    let result = match cmd {
        SecretsCommand::Keygen { out } => keygen(&out).map(|_| println!("wrote {}", out.display())),
        SecretsCommand::Purge {
            data_dir,
            secret_key_file,
            yes,
        } => {
            let Some(data_dir) = data_dir.or_else(notecore::app_dir::default_app_dir) else {
                return exit::FAILURE;
            };
            let key = secret_key_file.or_else(default_key_path);
            let targets: Vec<PathBuf> = std::iter::once(secrets_path(&data_dir))
                .chain(key)
                .filter(|p| p.exists())
                .collect();
            if targets.is_empty() {
                println!("nothing to purge");
                return 0;
            }
            if !yes {
                eprintln!("would remove:");
                for t in &targets {
                    eprintln!("  {}", t.display());
                }
                eprintln!("re-run with --yes to remove them");
                return exit::FAILURE;
            }
            targets
                .iter()
                .try_for_each(|t| {
                    std::fs::remove_file(t).map_err(|e| format!("{}: {e}", t.display()))
                })
                .map(|_| println!("removed {} file(s)", targets.len()))
        }
    };
    match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            exit::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keygen_writes_a_private_key_once() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("k").join("secret.key");
        keygen(&out).unwrap();
        let meta = std::fs::metadata(&out).unwrap();
        assert_eq!(meta.len(), 32);
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
        assert!(keygen(&out).is_err());
    }
}
