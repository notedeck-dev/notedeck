//! 設定ファイルの domain service (#782)。
//!
//! commands/settings.rs から検証・atomic 書込・export/import バンドル収集を
//! 吸い上げ、コマンドハンドラを「パス解決 + service 呼び出し」の薄い層にする。
//! `base_dir` を引数に取り AppHandle に依存しないため、temp dir で直接
//! ユニットテストできる (従来はテスト側が export/import ロジックを再実装していた)。

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use notecli::error::NoteDeckError;

type Result<T> = std::result::Result<T, NoteDeckError>;

/// Allowed subdirectory names for settings files. Also the set included in settings backup.
pub const ALLOWED_SUBDIRS: &[&str] = &[
    "profiles", "themes", "plugins", "snippets", "memos", "widgets", "skills", "sessions",
    // カラムクエリ (#783 Phase 1.5)。settingsFs の QUERIES_DIR に対応
    "queries",
];

/// Allowed root-level filenames (no subdirectory).
/// このリストは設定バックアップ (export/import) の対象も兼ねる。
pub const ALLOWED_ROOT_FILES: &[&str] = &[
    "custom.css",
    "keybinds.json5",
    "ai.json5",
    "AI.md",
    "performance.json5",
    "navbar.json5",
    "postform.json5",
    "settings.json5",
    "tasks.json5",
    // チュートリアルの達成記録 + NoteDeck 独自実績 (#1029)。プロファイル・
    // アカウントから独立 (アプリ操作の習熟はアカウントに紐づかない)
    "tutorial.json5",
    // principal 別権限 + 確認スキップ (#712 / #714)。capability 層に write を
    // 公開しない制約はここではなく capability registry 側で担保している
    // (settingsFs の固定名ラッパーのみが本コマンドに到達する)
    "permissions.json5",
];

/// Validate a subdirectory name against the whitelist.
pub fn validate_subdir(subdir: &str) -> Result<()> {
    if !ALLOWED_SUBDIRS.contains(&subdir) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid subdirectory: {subdir}. Allowed: {}",
            ALLOWED_SUBDIRS.join(", ")
        )));
    }
    Ok(())
}

/// Validate a filename to prevent path traversal.
pub fn validate_filename(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "Filename must not be empty".to_string(),
        ));
    }
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid filename: {name}"
        )));
    }
    // Reject Windows reserved characters
    if name.chars().any(|c| "<>:\"|?*".contains(c)) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Filename contains reserved characters: {name}"
        )));
    }
    if name.len() > 128 {
        return Err(NoteDeckError::InvalidInput(
            "Filename too long (max 128 chars)".to_string(),
        ));
    }
    Ok(())
}

/// Resolve the full path for a settings file under `base_dir`.
pub fn resolve_file(base_dir: &Path, subdir: &str, name: &str) -> Result<PathBuf> {
    validate_subdir(subdir)?;
    validate_filename(name)?;
    Ok(base_dir.join(subdir).join(name))
}

/// Resolve the full path for a root-level settings file under `base_dir`.
pub fn resolve_root_file(base_dir: &Path, name: &str) -> Result<PathBuf> {
    if !ALLOWED_ROOT_FILES.contains(&name) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid root file: {name}. Allowed: {}",
            ALLOWED_ROOT_FILES.join(", ")
        )));
    }
    validate_filename(name)?;
    Ok(base_dir.join(name))
}

/// 設定ファイルを原子的に書き込む (#719)。同ディレクトリの一時ファイルへ
/// 書いて fsync してから rename する。直接 `fs::write` (truncate → write) だと
/// 書き込み途中のクラッシュ・電源断で途中切れの壊れたファイルが残りうる —
/// 特に permissions.json5 が壊れると権限記憶が失われる。rename は同一 FS 内で
/// atomic なので、読み手は常に旧内容か新内容のいずれか完全な方を見る。
///
/// `mode` 指定時は rename 前に一時ファイルへ適用する (機密ファイルが一瞬でも
/// 緩い権限で見えないように)。
pub fn atomic_write(path: &Path, content: &str, mode: Option<u32>) -> Result<()> {
    let parent = path.parent().ok_or_else(|| {
        NoteDeckError::InvalidInput(format!("path has no parent: {}", path.display()))
    })?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| NoteDeckError::InvalidInput(format!("invalid path: {}", path.display())))?;
    // 一時名は同ディレクトリ内 (cross-device rename を避ける) + pid で衝突回避。
    let tmp = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));

    let write_result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        #[cfg(unix)]
        if let Some(m) = mode {
            use std::os::unix::fs::PermissionsExt;
            f.set_permissions(fs::Permissions::from_mode(m))?;
        }
        // fsync — rename が耐久性を持つのは中身がディスクに届いてから。
        f.sync_all()?;
        Ok(())
    })();
    #[cfg(not(unix))]
    let _ = mode;
    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(NoteDeckError::InvalidInput(format!(
            "Failed to write {}: {e}",
            path.display()
        )));
    }

    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        NoteDeckError::InvalidInput(format!("Failed to write {}: {e}", path.display()))
    })
}

/// List files in a settings subdirectory (sorted).
pub fn list_files(base_dir: &Path, subdir: &str) -> Result<Vec<String>> {
    validate_subdir(subdir)?;
    let dir = base_dir.join(subdir);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut names = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
        if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

/// Read a settings file as a UTF-8 string.
pub fn read_file(base_dir: &Path, subdir: &str, name: &str) -> Result<String> {
    let path = resolve_file(base_dir, subdir, name)?;
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write a settings file (creates parent directories if needed).
/// `sessions/` は AI 会話内容 (prompt に誤入力された秘密を含みうる) のため 0o600。
pub fn write_file(base_dir: &Path, subdir: &str, name: &str, content: &str) -> Result<()> {
    let path = resolve_file(base_dir, subdir, name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            NoteDeckError::InvalidInput(format!(
                "Failed to create directory {}: {e}",
                parent.display()
            ))
        })?;
    }
    let mode = if subdir == "sessions" {
        Some(0o600)
    } else {
        None
    };
    atomic_write(&path, content, mode)
}

/// Delete a settings file (missing file is a no-op).
pub fn delete_file(base_dir: &Path, subdir: &str, name: &str) -> Result<()> {
    let path = resolve_file(base_dir, subdir, name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| {
            NoteDeckError::InvalidInput(format!("Failed to delete {}: {e}", path.display()))
        })?;
    }
    Ok(())
}

/// Rename a settings file within the same subdirectory.
pub fn rename_file(base_dir: &Path, subdir: &str, old_name: &str, new_name: &str) -> Result<()> {
    let old_path = resolve_file(base_dir, subdir, old_name)?;
    let new_path = resolve_file(base_dir, subdir, new_name)?;
    if !old_path.exists() {
        return Err(NoteDeckError::InvalidInput(format!(
            "File not found: {}",
            old_path.display()
        )));
    }
    if new_path.exists() {
        return Err(NoteDeckError::InvalidInput(format!(
            "File already exists: {}",
            new_path.display()
        )));
    }
    fs::rename(&old_path, &new_path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to rename: {e}")))
}

/// Read a root-level settings file (missing file returns empty string).
pub fn read_root_file(base_dir: &Path, name: &str) -> Result<String> {
    let path = resolve_root_file(base_dir, name)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write a root-level settings file (atomic).
pub fn write_root_file(base_dir: &Path, name: &str, content: &str) -> Result<()> {
    let path = resolve_root_file(base_dir, name)?;
    atomic_write(&path, content, None)
}

/// Read `settings.json5` (missing file returns empty string — first run).
pub fn read_settings_json(base_dir: &Path) -> Result<String> {
    let path = base_dir.join("settings.json5");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write `settings.json5`. Creates the settings directory if missing.
/// 他の設定ファイルと同じく atomic write (#719 — 従来ここだけ非 atomic だった)。
pub fn write_settings_json(base_dir: &Path, content: &str) -> Result<()> {
    let path = base_dir.join("settings.json5");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            NoteDeckError::InvalidInput(format!(
                "Failed to create directory {}: {e}",
                parent.display()
            ))
        })?;
    }
    atomic_write(&path, content, None)
}

/// 全設定ファイルをバックアップバンドル (相対パス → 内容) に収集する。
pub fn export_bundle(base_dir: &Path) -> Result<BTreeMap<String, String>> {
    let mut bundle: BTreeMap<String, String> = BTreeMap::new();

    for subdir in ALLOWED_SUBDIRS {
        let dir = base_dir.join(subdir);
        if !dir.exists() {
            continue;
        }
        let entries = fs::read_dir(&dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
        for entry in entries {
            let entry = entry.map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name();
            let key = format!("{subdir}/{}", name.to_string_lossy());
            let content = fs::read_to_string(entry.path())
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(key, content);
        }
    }

    for root_file in ALLOWED_ROOT_FILES {
        let path = base_dir.join(root_file);
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(root_file.to_string(), content);
        }
    }

    Ok(bundle)
}

/// バックアップバンドルを検証しながら書き戻す。
/// path traversal と allowlist 外のエントリは warn してスキップする。
pub fn import_bundle(base_dir: &Path, bundle: &BTreeMap<String, String>) -> Result<()> {
    for (key, content) in bundle {
        // Path traversal prevention
        if key.contains("..") || key.starts_with('/') || key.starts_with('\\') {
            tracing::warn!("Skipping suspicious entry: {key}");
            continue;
        }

        // Validate: must be in allowed subdirs or allowed root files
        let allowed = ALLOWED_SUBDIRS
            .iter()
            .any(|d| key.starts_with(&format!("{d}/")))
            || ALLOWED_ROOT_FILES.contains(&key.as_str());
        if !allowed {
            tracing::warn!("Skipping unknown entry: {key}");
            continue;
        }

        let dest_path = base_dir.join(key);

        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
        }

        fs::write(&dest_path, content)
            .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to write {key}: {e}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_creates_and_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("permissions.json5");

        atomic_write(&path, "{ v: 1 }", None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ v: 1 }");

        // 上書きも旧内容を完全に置き換える
        atomic_write(&path, "{ v: 2 }", None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ v: 2 }");
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json5");
        atomic_write(&path, "{}", None).unwrap();

        // 成功後、同ディレクトリに一時ファイル (.<name>.<pid>.tmp) が残らない
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files remained: {leftovers:?}");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_applies_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.json5");
        atomic_write(&path, "{}", Some(0o600)).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn write_file_applies_sessions_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "sessions", "20260722.json5", "{}").unwrap();
        let mode = fs::metadata(dir.path().join("sessions/20260722.json5"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn validate_subdir_allowed() {
        assert!(validate_subdir("profiles").is_ok());
        assert!(validate_subdir("themes").is_ok());
        assert!(validate_subdir("plugins").is_ok());
        assert!(validate_subdir("snippets").is_ok());
        assert!(validate_subdir("widgets").is_ok());
        assert!(validate_subdir("skills").is_ok());
        assert!(validate_subdir("sessions").is_ok());
        // カラムクエリ (#783 Phase 1.5)。settingsFs 側が使うので許可が必要
        assert!(validate_subdir("queries").is_ok());
        // memos は settingsFs にラッパーがあるので漏れを防ぐ
        assert!(validate_subdir("memos").is_ok());
    }

    #[test]
    fn validate_subdir_rejected() {
        assert!(validate_subdir("").is_err());
        assert!(validate_subdir("secrets").is_err());
        assert!(validate_subdir("../etc").is_err());
    }

    #[test]
    fn permissions_json5_is_allowed_root_file() {
        // #714: 権限プロファイル + 確認スキップの保存先。allowlist から漏れると
        // 読み書きもバックアップも黙って失敗する (#712〜v1.5.0 で実際に発生)
        assert!(ALLOWED_ROOT_FILES.contains(&"permissions.json5"));
    }

    #[test]
    fn tutorial_json5_is_allowed_root_file() {
        // #1029: チュートリアルの達成記録と実績の保存先。allowlist から漏れると
        // 読み書きもバックアップも黙って失敗する
        assert!(ALLOWED_ROOT_FILES.contains(&"tutorial.json5"));
    }

    #[test]
    fn tutorial_json5_is_backed_up() {
        // #1029: 達成記録はユーザーの習熟の記録なので、設定のバックアップに含める
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_root_file(base, "tutorial.json5", r#"{ version: 1 }"#).unwrap();

        let bundle = export_bundle(base).unwrap();
        assert_eq!(
            bundle.get("tutorial.json5").map(String::as_str),
            Some(r#"{ version: 1 }"#)
        );

        fs::remove_file(base.join("tutorial.json5")).unwrap();
        import_bundle(base, &bundle).unwrap();
        assert_eq!(
            read_root_file(base, "tutorial.json5").unwrap(),
            r#"{ version: 1 }"#
        );
    }

    #[test]
    fn validate_filename_ok() {
        assert!(validate_filename("test.json5").is_ok());
        assert!(validate_filename("my-theme.ndtheme.json5").is_ok());
        assert!(validate_filename("plugin.is").is_ok());
    }

    #[test]
    fn validate_filename_path_traversal() {
        assert!(validate_filename("..").is_err());
        assert!(validate_filename("../secret").is_err());
        assert!(validate_filename("foo/bar").is_err());
        assert!(validate_filename("foo\\bar").is_err());
    }

    #[test]
    fn validate_filename_reserved_chars() {
        assert!(validate_filename("file<name").is_err());
        assert!(validate_filename("file>name").is_err());
        assert!(validate_filename("file:name").is_err());
        assert!(validate_filename("file\"name").is_err());
        assert!(validate_filename("file|name").is_err());
        assert!(validate_filename("file?name").is_err());
        assert!(validate_filename("file*name").is_err());
    }

    #[test]
    fn validate_filename_empty() {
        assert!(validate_filename("").is_err());
    }

    #[test]
    fn validate_filename_too_long() {
        let long = "a".repeat(129);
        assert!(validate_filename(&long).is_err());
        let ok = "a".repeat(128);
        assert!(validate_filename(&ok).is_ok());
    }

    #[test]
    fn write_settings_json_is_atomic_and_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        write_settings_json(dir.path(), "{ a: 1 }").unwrap();
        assert_eq!(read_settings_json(dir.path()).unwrap(), "{ a: 1 }");
        // 存在しない場合は空文字 (first run)
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(read_settings_json(empty.path()).unwrap(), "");
    }

    // export_bundle / import_bundle を「実物の service 関数で」round-trip 検証する。
    // 従来はコマンド内ロジックのコピーがテストに埋め込まれていた (#782 で解消)。
    #[test]
    fn bundle_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        write_file(
            base,
            "profiles",
            "test.ndprofile.json5",
            r#"{ name: "test" }"#,
        )
        .unwrap();
        write_file(base, "themes", "dark.ndtheme.json5", r#"{ name: "dark" }"#).unwrap();
        write_root_file(base, "custom.css", "body { color: red; }").unwrap();
        write_root_file(base, "keybinds.json5", r#"{ "search": [] }"#).unwrap();

        let bundle = export_bundle(base).unwrap();
        assert_eq!(bundle.len(), 4);

        // 元ファイルを消してから import で復元
        fs::remove_dir_all(base.join("profiles")).unwrap();
        fs::remove_dir_all(base.join("themes")).unwrap();
        fs::remove_file(base.join("custom.css")).unwrap();
        fs::remove_file(base.join("keybinds.json5")).unwrap();

        import_bundle(base, &bundle).unwrap();

        assert_eq!(
            read_file(base, "profiles", "test.ndprofile.json5").unwrap(),
            r#"{ name: "test" }"#
        );
        assert_eq!(
            read_file(base, "themes", "dark.ndtheme.json5").unwrap(),
            r#"{ name: "dark" }"#
        );
        assert_eq!(
            read_root_file(base, "custom.css").unwrap(),
            "body { color: red; }"
        );
        assert_eq!(
            read_root_file(base, "keybinds.json5").unwrap(),
            r#"{ "search": [] }"#
        );
    }

    #[test]
    fn import_bundle_rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("app");
        fs::create_dir_all(&base).unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("../../../etc/passwd".to_string(), "evil".to_string());
        bundle.insert("profiles/good.json5".to_string(), "ok".to_string());

        import_bundle(&base, &bundle).unwrap();

        assert!(!dir.path().join("etc/passwd").exists());
        assert_eq!(
            fs::read_to_string(base.join("profiles/good.json5")).unwrap(),
            "ok"
        );
    }

    #[test]
    fn import_bundle_rejects_unknown_entries() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("app");
        fs::create_dir_all(&base).unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("custom.css".to_string(), "body{}".to_string());
        bundle.insert("secret.txt".to_string(), "secret".to_string());
        bundle.insert("config/bad.json".to_string(), "bad".to_string());

        import_bundle(&base, &bundle).unwrap();

        assert!(base.join("custom.css").exists());
        assert!(!base.join("secret.txt").exists());
        assert!(!base.join("config/bad.json").exists());
    }
}
