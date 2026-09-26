//! 移行パッケージの取り込み / 書き出し (#1106 段階 3a 順序 7、配布設計 §7 / §9)。
//! どちらも停止中限定で、data-dir のロックを取って notecored 自身の secret store を開く
//! (常駐中は import が拒否される)。`status` はアプリの切替導線が読む JSON。

use std::path::PathBuf;

use clap::{Args, Subcommand};

use crate::exit;

#[derive(Subcommand, Debug, Clone)]
pub enum MigrateCommand {
    /// パッケージを notecored の secret store に取り込む (停止中限定。成功・失敗どちらでもパッケージは消す)
    Import(MigrateArgs),
    /// notecored の secret をパッケージに書き出す (停止中限定。アプリが取り込んで埋め込みに戻す)
    Export(MigrateArgs),
    /// secret の有無とパッケージの有無を JSON で出す
    Status(MigrateArgs),
}

#[derive(Args, Debug, Clone, Default)]
pub struct MigrateArgs {
    /// データディレクトリ。既定はアプリと同じ場所
    #[arg(long)]
    pub data_dir: Option<PathBuf>,
    /// secret の鍵ファイル。既定は OS の設定ディレクトリ / notecored / secret.key
    #[arg(long)]
    pub secret_key_file: Option<PathBuf>,
    /// パッケージの置き場。既定は $XDG_RUNTIME_DIR/notecored
    #[arg(long)]
    pub package_dir: Option<PathBuf>,
}

pub fn run(cmd: MigrateCommand) -> i32 {
    let (args, what) = match &cmd {
        MigrateCommand::Import(a) => (a, "import"),
        MigrateCommand::Export(a) => (a, "export"),
        MigrateCommand::Status(a) => (a, "status"),
    };
    let Some(data_dir) = args
        .data_dir
        .clone()
        .or_else(notecore::app_dir::default_app_dir)
    else {
        eprintln!("no data directory: set --data-dir");
        return exit::FAILURE;
    };
    let Some(package_dir) = args
        .package_dir
        .clone()
        .or_else(notecore::migration::default_package_dir)
    else {
        eprintln!("XDG_RUNTIME_DIR is not set; pass --package-dir");
        return exit::RUNTIME_DIR_MISSING;
    };
    let secrets_path = crate::secrets::secrets_path(&data_dir);
    if what == "status" {
        let present = std::fs::metadata(&secrets_path)
            .map(|m| m.len() > 0)
            .unwrap_or(false);
        let status = serde_json::json!({
            "secretsPresent": present,
            "secretsPath": secrets_path.display().to_string(),
            "packagePresent": notecore::migration::package_exists(&package_dir),
            "packageDir": package_dir.display().to_string(),
        });
        println!("{status}");
        return 0;
    }
    // 停止中限定: ロックが取れなければ常駐中 (かアプリの埋め込み)
    let _lock = match crate::lock::acquire(&data_dir) {
        Ok(l) => l,
        Err(crate::lock::LockError::Held) => {
            eprintln!(
                "notecore is running on this data directory; stop notecored (or the app) first"
            );
            return exit::LOCK_HELD;
        }
        Err(crate::lock::LockError::Io(e)) => {
            eprintln!("lock failed: {e}");
            return exit::FAILURE;
        }
    };
    let key_path = args
        .secret_key_file
        .clone()
        .or_else(|| dirs::config_dir().map(|d| d.join("notecored").join("secret.key")));
    let Some(key_path) = key_path else {
        eprintln!("no config directory for the secret key; pass --secret-key-file");
        return exit::SECRET_KEY;
    };
    if let Err(e) = notecli::keychain::init_file_store(&key_path, &secrets_path) {
        eprintln!("secret store unavailable: {e}");
        return exit::SECRET_KEY;
    }
    let result = match cmd {
        MigrateCommand::Import(_) => notecore::migration::import(&package_dir),
        MigrateCommand::Export(_) => notecli::db::Database::open(&data_dir.join("notecli.db"))
            .and_then(|db| notecore::migration::entries_for(&db, &data_dir))
            .and_then(|entries| notecore::migration::export(&package_dir, &entries)),
        MigrateCommand::Status(_) => unreachable!(),
    };
    match result {
        Ok(summary) => {
            println!("{}", serde_json::to_string(&summary).unwrap_or_default());
            0
        }
        Err(e) => {
            eprintln!("{what} failed: {}", e.safe_message());
            exit::FAILURE
        }
    }
}
