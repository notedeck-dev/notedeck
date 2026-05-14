use std::fs;
use std::path::PathBuf;

use tauri::Manager;

use super::error::{VaultError, VaultResult};
use super::model::{ConnectionsFile, SCHEMA_VERSION};

/// 設定ディレクトリ名 (`commands::settings` と同じ `notedeck` サブディレクトリ)。
const SETTINGS_DIR: &str = "notedeck";

/// メタデータファイル名。`settings.json5` (フロントが JSON5 パース) とは別系統で、
/// Rust が source of truth として読み書きするため厳密 JSON とする。
const CONNECTIONS_FILE: &str = "connections.json";

fn io_err(e: impl std::fmt::Display) -> VaultError {
    VaultError::StoreIo {
        message: e.to_string(),
    }
}

/// `connections.json` の絶対パスを解決する。
fn connections_path(app: &tauri::AppHandle) -> VaultResult<PathBuf> {
    let app_dir = app.path().app_data_dir().map_err(io_err)?;
    Ok(app_dir.join(SETTINGS_DIR).join(CONNECTIONS_FILE))
}

/// `connections.json` を読み込む。ファイルが無ければ空の [`ConnectionsFile`]。
pub fn load(app: &tauri::AppHandle) -> VaultResult<ConnectionsFile> {
    let path = connections_path(app)?;
    if !path.exists() {
        return Ok(ConnectionsFile::default());
    }
    let content = fs::read_to_string(&path).map_err(io_err)?;
    let parsed: ConnectionsFile =
        serde_json::from_str(&content).map_err(|e| VaultError::StoreIo {
            message: format!("connections.json parse error: {e}"),
        })?;
    Ok(parsed)
}

/// `connections.json` を atomic に書き込む。
///
/// 同一ディレクトリ内の一時ファイルに書いてから `rename` で置換することで、
/// 書き込み途中の電源喪失でもファイルが壊れない (EXDEV も起きない)。
pub fn save(app: &tauri::AppHandle, file: &ConnectionsFile) -> VaultResult<()> {
    let path = connections_path(app)?;
    let dir = path
        .parent()
        .ok_or_else(|| io_err("connections.json has no parent directory"))?;
    fs::create_dir_all(dir).map_err(io_err)?;

    let json = serde_json::to_string_pretty(file).map_err(io_err)?;

    let tmp = dir.join(format!(
        "{CONNECTIONS_FILE}.tmp-{}",
        ulid::Ulid::new().to_string()
    ));
    fs::write(&tmp, json).map_err(io_err)?;
    fs::rename(&tmp, &path).map_err(|e| {
        // rename 失敗時は一時ファイルを掃除する。
        let _ = fs::remove_file(&tmp);
        io_err(e)
    })?;
    Ok(())
}

/// schemaVersion を検証する。未知バージョンは将来の migration registry で扱う想定。
pub fn check_schema_version(file: &ConnectionsFile) -> VaultResult<()> {
    if file.schema_version > SCHEMA_VERSION {
        return Err(VaultError::StoreIo {
            message: format!(
                "connections.json schemaVersion {} is newer than supported {}",
                file.schema_version, SCHEMA_VERSION
            ),
        });
    }
    Ok(())
}
