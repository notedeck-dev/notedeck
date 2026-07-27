//! バックアップ作成 (#816)
//!
//! DB と設定ファイル一式を `~/Downloads/notedeck/backup/<stamp>/` に書き出す。
//! UI からも capability (HEARTBEAT の定期実行を含む) からも同じ経路を通る。
//!
//! - DB は notecli の `backup_to` (VACUUM INTO) で整合したスナップショットを取る。
//!   認証情報は常に除去する — 別マシンではどのみち再ログインが要るため
//! - 設定は既存のバックアップバンドル (相対パス → 内容) を JSON 1 枚に書く
//! - デッキ構成・プラグイン登録・テーマ選択は localStorage にあり対象外。
//!   これは既知の割り切りで、完全復元にはならない
//! - 世代は新しい順に `keep` 件だけ残す

use std::path::{Path, PathBuf};

use notecli::error::NoteDeckError;
use serde::Serialize;
use specta::Type;
use tauri::Manager;

use super::Result;
use crate::settings_store as store;

const BACKUP_SUBDIR: &str = "backup";
const SETTINGS_FILE: &str = "settings.json";
const DB_FILE: &str = "notecli.db";
const DEFAULT_KEEP: usize = 10;
const MAX_KEEP: usize = 100;

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    /// 書き出したディレクトリの絶対パス
    pub dir: String,
    /// DB を含めなかった場合は None
    pub db_bytes: Option<u64>,
    /// 設定を含めなかった場合は None
    pub settings_files: Option<usize>,
    /// 世代上限を超えて削除した数
    pub rotated_removed: usize,
}

fn backup_root(app: &tauri::AppHandle) -> Result<PathBuf> {
    let dl = app
        .path()
        .download_dir()
        .map_err(|e| NoteDeckError::InvalidInput(format!("download dir unavailable: {e}")))?;
    Ok(dl.join("notedeck").join(BACKUP_SUBDIR))
}

/// バックアップ保存先を (無ければ作って) 返す。UI の「フォルダを開く」用
#[tauri::command]
#[specta::specta]
pub async fn get_backup_dir(app: tauri::AppHandle) -> Result<String> {
    let root = backup_root(&app)?;
    std::fs::create_dir_all(&root)
        .map_err(|e| NoteDeckError::InvalidInput(format!("failed to create backup dir: {e}")))?;
    Ok(root.to_string_lossy().into_owned())
}

/// 世代ディレクトリ名として受け付けるのは 14 桁の日時 + 任意の小英字 suffix
/// (AI セッション ID と同じ Zettelkasten 形式)。パス表現は一切通さない
fn validate_stamp(stamp: &str) -> Result<()> {
    let valid = stamp.len() >= 14
        && stamp.len() <= 20
        && stamp[..14].chars().all(|c| c.is_ascii_digit())
        && stamp[14..].chars().all(|c| c.is_ascii_lowercase());
    if valid {
        Ok(())
    } else {
        Err(NoteDeckError::InvalidInput(format!(
            "invalid backup stamp: {stamp}"
        )))
    }
}

/// 新しい順に `keep` 件だけ残し、あふれた世代を消す。戻り値は削除数
fn rotate(root: &Path, keep: usize) -> usize {
    let Ok(entries) = std::fs::read_dir(root) else {
        return 0;
    };
    // ディレクトリ名が Zettelkasten 形式なので辞書順 = 時系列順
    let mut dirs: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|name| validate_stamp(name).is_ok())
        .collect();
    if dirs.len() <= keep {
        return 0;
    }
    dirs.sort();
    let remove_count = dirs.len() - keep;
    let mut removed = 0;
    for name in dirs.iter().take(remove_count) {
        if std::fs::remove_dir_all(root.join(name)).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// バックアップを 1 世代作成する。
///
/// DB と設定は独立して選べる (手動バックアップが別ボタンなのに合わせる)。
/// 既定は両方。どちらも false なら書くものが無いのでエラーにする。
///
/// `stamp` は呼び出し側 (フロント) が生成した Zettelkasten 形式の日時文字列。
/// Rust 側で時刻を持たないのは、AI セッションの命名と規則を揃えるため。
#[tauri::command]
#[specta::specta]
pub async fn backup_create(
    app: tauri::AppHandle,
    app_state: tauri::State<'_, super::AppState>,
    stamp: String,
    keep: Option<u32>,
    include_db: Option<bool>,
    include_settings: Option<bool>,
) -> Result<BackupResult> {
    validate_stamp(&stamp)?;
    let include_db = include_db.unwrap_or(true);
    let include_settings = include_settings.unwrap_or(true);
    if !include_db && !include_settings {
        return Err(NoteDeckError::InvalidInput(
            "nothing to back up: enable includeDb or includeSettings".to_string(),
        ));
    }
    let keep = (keep.unwrap_or(DEFAULT_KEEP as u32) as usize).clamp(1, MAX_KEEP);

    let root = backup_root(&app)?;
    let dir = root.join(&stamp);
    std::fs::create_dir_all(&dir)
        .map_err(|e| NoteDeckError::InvalidInput(format!("failed to create backup dir: {e}")))?;

    // 設定バンドル (テキストのみ。localStorage は対象外)
    let settings_files = if include_settings {
        let settings_base = crate::app_dir::resolve_app_dir(&app)
            .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?
            .join("notedeck");
        let bundle = store::export_bundle(&settings_base)?;
        let json = serde_json::to_string_pretty(&bundle)
            .map_err(|e| NoteDeckError::InvalidInput(format!("failed to serialize: {e}")))?;
        std::fs::write(dir.join(SETTINGS_FILE), json)
            .map_err(|e| NoteDeckError::InvalidInput(format!("failed to write settings: {e}")))?;
        Some(bundle.len())
    } else {
        None
    };

    // DB スナップショット (トークンは常に除去)
    let db_bytes = if include_db {
        let db_path = dir.join(DB_FILE);
        let db = app_state.db().await;
        {
            let db_path = db_path.clone();
            tokio::task::spawn_blocking(move || db.backup_to(&db_path, true))
                .await
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))??;
        }
        Some(std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0))
    } else {
        None
    };

    let rotated_removed = rotate(&root, keep);

    Ok(BackupResult {
        dir: dir.to_string_lossy().into_owned(),
        db_bytes,
        settings_files,
        rotated_removed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_stamp_accepts_zettelkasten_form() {
        assert!(validate_stamp("20260727093000").is_ok());
        assert!(validate_stamp("20260727093000a").is_ok());
        assert!(validate_stamp("20260727093000ab").is_ok());
    }

    #[test]
    fn validate_stamp_rejects_path_expressions_and_junk() {
        assert!(validate_stamp("..").is_err());
        assert!(validate_stamp("2026/07/27").is_err());
        assert!(validate_stamp("../../etc").is_err());
        assert!(validate_stamp("2026072709300").is_err()); // 13 桁
        assert!(validate_stamp("20260727093000A").is_err()); // 大文字 suffix
        assert!(validate_stamp("").is_err());
    }

    fn make_gen(root: &Path, name: &str) {
        std::fs::create_dir_all(root.join(name)).unwrap();
        std::fs::write(root.join(name).join("notecli.db"), b"x").unwrap();
    }

    #[test]
    fn rotate_keeps_the_newest_generations() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        make_gen(root, "20260727090000");
        make_gen(root, "20260727100000");
        make_gen(root, "20260727110000");

        let removed = rotate(root, 2);

        assert_eq!(removed, 1);
        assert!(!root.join("20260727090000").exists());
        assert!(root.join("20260727100000").exists());
        assert!(root.join("20260727110000").exists());
    }

    #[test]
    fn rotate_is_noop_within_the_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        make_gen(root, "20260727090000");
        assert_eq!(rotate(root, 10), 0);
        assert!(root.join("20260727090000").exists());
    }

    #[test]
    fn rotate_ignores_unrelated_directories() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        std::fs::create_dir_all(root.join("notes")).unwrap();
        make_gen(root, "20260727090000");
        make_gen(root, "20260727100000");

        assert_eq!(rotate(root, 1), 1);
        // 世代形式でないディレクトリは対象外
        assert!(root.join("notes").exists());
    }
}
