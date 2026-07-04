use std::fs;
use std::path::PathBuf;


use super::error::{VaultError, VaultResult};
use super::model::{ConnectionsFile, PrincipalClass, SCHEMA_VERSION};

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
    let app_dir = crate::app_dir::resolve_app_dir(app).map_err(io_err)?;
    Ok(app_dir.join(SETTINGS_DIR).join(CONNECTIONS_FILE))
}

/// `connections.json` を読み込む。ファイルが無ければ空の [`ConnectionsFile`]。
///
/// 旧 `aiVisible` / `aiTrusted` があれば `exposed_to: [Ai]` / `trusted_for: [Ai]`
/// へ一度きり変換し、新形で書き戻す (#712 §6.1)。**External は誰にも自動付与
/// しない** — 外部アプリへの開示は必ず明示 opt-in (これが同意すり替え問題の
/// 修正そのもの)。
pub fn load(app: &tauri::AppHandle) -> VaultResult<ConnectionsFile> {
    let path = connections_path(app)?;
    if !path.exists() {
        return Ok(ConnectionsFile::default());
    }
    let content = fs::read_to_string(&path).map_err(io_err)?;
    let mut parsed: ConnectionsFile =
        serde_json::from_str(&content).map_err(|e| VaultError::StoreIo {
            message: format!("connections.json parse error: {e}"),
        })?;

    if migrate_legacy_exposure(&mut parsed) {
        save(app, &parsed)?;
    }
    Ok(parsed)
}

/// 旧 aiVisible / aiTrusted → exposed_to / trusted_for の一度きり変換 (#712)。
/// 変換が発生したら true (= 書き戻しが必要)。External は自動付与しない。
fn migrate_legacy_exposure(file: &mut ConnectionsFile) -> bool {
    let mut migrated = false;
    for conn in &mut file.connections {
        if conn.legacy_ai_visible == Some(true)
            && !conn.exposed_to.contains(&PrincipalClass::Ai)
        {
            conn.exposed_to.push(PrincipalClass::Ai);
            migrated = true;
        }
        if conn.legacy_ai_trusted == Some(true)
            && !conn.trusted_for.contains(&PrincipalClass::Ai)
        {
            conn.trusted_for.push(PrincipalClass::Ai);
            migrated = true;
        }
        if conn.legacy_ai_visible.is_some() || conn.legacy_ai_trusted.is_some() {
            conn.legacy_ai_visible = None;
            conn.legacy_ai_trusted = None;
            migrated = true;
        }
    }
    migrated
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


#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_file(json: &str) -> ConnectionsFile {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn migrates_ai_visible_to_exposed_ai_without_external() {
        let mut file = legacy_file(
            r#"{
            "schema_version": 1,
            "connections": [{
                "id": "01HZZZZZZZZZZZZZZZZZZZZZZZ",
                "name": "Legacy",
                "baseUrl": "https://example.com",
                "authType": { "kind": "bearer" },
                "aiVisible": true,
                "aiTrusted": true,
                "createdAt": "0",
                "updatedAt": "0"
            }]
        }"#,
        );
        assert!(migrate_legacy_exposure(&mut file));
        let conn = &file.connections[0];
        assert_eq!(conn.exposed_to, vec![PrincipalClass::Ai]);
        assert_eq!(conn.trusted_for, vec![PrincipalClass::Ai]);
        // External は誰にも自動付与しない (#712 §6.1 — 問題 2 の修正そのもの)
        assert!(!conn.exposed_to.contains(&PrincipalClass::External));
        // legacy フィールドはクリアされ再変換されない
        assert_eq!(conn.legacy_ai_visible, None);
        assert!(!migrate_legacy_exposure(&mut file));
    }

    #[test]
    fn new_format_files_are_not_touched() {
        let mut file = legacy_file(
            r#"{
            "schema_version": 1,
            "connections": [{
                "id": "01HZZZZZZZZZZZZZZZZZZZZZZZ",
                "name": "New",
                "baseUrl": "https://example.com",
                "authType": { "kind": "bearer" },
                "exposedTo": ["external"],
                "createdAt": "0",
                "updatedAt": "0"
            }]
        }"#,
        );
        assert!(!migrate_legacy_exposure(&mut file));
        assert_eq!(file.connections[0].exposed_to, vec![PrincipalClass::External]);
    }

    #[test]
    fn ai_visible_false_does_not_expose() {
        let mut file = legacy_file(
            r#"{
            "schema_version": 1,
            "connections": [{
                "id": "01HZZZZZZZZZZZZZZZZZZZZZZZ",
                "name": "Hidden",
                "baseUrl": "https://example.com",
                "authType": { "kind": "bearer" },
                "aiVisible": false,
                "createdAt": "0",
                "updatedAt": "0"
            }]
        }"#,
        );
        // aiVisible:false → 開示なしのまま、legacy フィールドのクリアだけ発生
        assert!(migrate_legacy_exposure(&mut file));
        assert!(file.connections[0].exposed_to.is_empty());
    }
}
