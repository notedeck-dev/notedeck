use std::fs;
use std::path::PathBuf;

use notecli::error::NoteDeckError;
use tauri::Manager;

use super::Result;

/// Settings subdirectory name under app_data_dir.
const SETTINGS_DIR: &str = "notedeck";

/// Allowed subdirectory names for settings files. Also the set included in settings backup.
const ALLOWED_SUBDIRS: &[&str] = &[
    "profiles",
    "themes",
    "plugins",
    "snippets",
    "memos",
    "widgets",
    "skills",
    "sessions",
];

/// Validate a subdirectory name against the whitelist.
fn validate_subdir(subdir: &str) -> Result<()> {
    if !ALLOWED_SUBDIRS.contains(&subdir) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid subdirectory: {subdir}. Allowed: {}",
            ALLOWED_SUBDIRS.join(", ")
        )));
    }
    Ok(())
}

/// Validate a filename to prevent path traversal.
fn validate_filename(name: &str) -> Result<()> {
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

/// Resolve the settings base directory: `app_data_dir/notedeck/`.
fn settings_base_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    Ok(app_dir.join(SETTINGS_DIR))
}

/// Resolve the full path for a settings file.
fn resolve_path(app: &tauri::AppHandle, subdir: &str, name: &str) -> Result<PathBuf> {
    validate_subdir(subdir)?;
    validate_filename(name)?;
    Ok(settings_base_dir(app)?.join(subdir).join(name))
}

/// List files in a settings subdirectory.
#[tauri::command]
#[specta::specta]
pub fn list_settings_files(app: tauri::AppHandle, subdir: &str) -> Result<Vec<String>> {
    validate_subdir(subdir)?;
    let dir = settings_base_dir(&app)?.join(subdir);
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
#[tauri::command]
#[specta::specta]
pub fn read_settings_file(app: tauri::AppHandle, subdir: &str, name: &str) -> Result<String> {
    let path = resolve_path(&app, subdir, name)?;
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write a settings file (creates parent directories if needed).
#[tauri::command]
#[specta::specta]
pub fn write_settings_file(
    app: tauri::AppHandle,
    subdir: &str,
    name: &str,
    content: &str,
) -> Result<()> {
    let path = resolve_path(&app, subdir, name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            NoteDeckError::InvalidInput(format!(
                "Failed to create directory {}: {e}",
                parent.display()
            ))
        })?;
    }
    fs::write(&path, content).map_err(|e| {
        NoteDeckError::InvalidInput(format!("Failed to write {}: {e}", path.display()))
    })?;

    // Tighten permissions for sensitive subdirectories — AI session content
    // may contain user secrets accidentally typed into prompts.
    #[cfg(unix)]
    if subdir == "sessions" {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

/// Delete a settings file.
#[tauri::command]
#[specta::specta]
pub fn delete_settings_file(app: tauri::AppHandle, subdir: &str, name: &str) -> Result<()> {
    let path = resolve_path(&app, subdir, name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| {
            NoteDeckError::InvalidInput(format!("Failed to delete {}: {e}", path.display()))
        })?;
    }
    Ok(())
}

/// Rename a settings file within the same subdirectory.
#[tauri::command]
#[specta::specta]
pub fn rename_settings_file(
    app: tauri::AppHandle,
    subdir: &str,
    old_name: &str,
    new_name: &str,
) -> Result<()> {
    let old_path = resolve_path(&app, subdir, old_name)?;
    let new_path = resolve_path(&app, subdir, new_name)?;
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

/// Allowed root-level filenames (no subdirectory).
const ALLOWED_ROOT_FILES: &[&str] = &[
    "custom.css",
    "keybinds.json5",
    "ai.json5",
    "AI.md",
    "performance.json5",
    "navbar.json5",
    "postform.json5",
    "settings.json5",
    "tasks.json5",
];

/// Resolve the full path for a root-level settings file (under notedeck/).
fn resolve_root_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf> {
    if !ALLOWED_ROOT_FILES.contains(&name) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid root file: {name}. Allowed: {}",
            ALLOWED_ROOT_FILES.join(", ")
        )));
    }
    validate_filename(name)?;
    Ok(settings_base_dir(app)?.join(name))
}

/// Read a root-level settings file as a UTF-8 string.
#[tauri::command]
#[specta::specta]
pub fn read_root_settings_file(app: tauri::AppHandle, name: &str) -> Result<String> {
    let path = resolve_root_path(&app, name)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write a root-level settings file.
#[tauri::command]
#[specta::specta]
pub fn write_root_settings_file(app: tauri::AppHandle, name: &str, content: &str) -> Result<()> {
    let path = resolve_root_path(&app, name)?;
    fs::write(&path, content).map_err(|e| {
        NoteDeckError::InvalidInput(format!("Failed to write {}: {e}", path.display()))
    })
}

/// Get the settings directory path (so users can open it in file manager).
#[tauri::command]
#[specta::specta]
pub fn get_settings_dir(app: tauri::AppHandle) -> Result<String> {
    Ok(settings_base_dir(&app)?.to_string_lossy().to_string())
}

/// Get the log directory path (`app_log_dir`, holds `notedeck.log` — #644).
/// Separate from the settings dir, so the "ファイル → ログフォルダを開く" menu
/// item can reveal it. Created if missing so it opens even when empty.
#[tauri::command]
#[specta::specta]
pub fn get_log_dir(app: tauri::AppHandle) -> Result<String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir.to_string_lossy().to_string())
}

/// Open a settings file in the OS default editor. WSL2 では xdg-open が GUI
/// エディタへルーティングできないため、wslpath で Windows パスへ変換し
/// cmd.exe start 経由で Windows 側の既定アプリに委譲する。
#[tauri::command]
#[specta::specta]
pub fn open_settings_file_in_editor(
    app: tauri::AppHandle,
    subdir: Option<String>,
    name: String,
) -> Result<()> {
    let path = match subdir.as_deref() {
        Some(s) => resolve_path(&app, s, &name)?,
        None => resolve_root_path(&app, &name)?,
    };
    if !path.exists() {
        return Err(NoteDeckError::InvalidInput(format!(
            "File does not exist: {}",
            path.display()
        )));
    }

    #[cfg(target_os = "linux")]
    if is_wsl() {
        return open_in_windows_host(&path);
    }

    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to open {}: {e}", path.display())))
}

#[cfg(target_os = "linux")]
fn is_wsl() -> bool {
    if std::env::var_os("WSL_DISTRO_NAME").is_some() {
        return true;
    }
    fs::read_to_string("/proc/version")
        .map(|v| {
            let lower = v.to_lowercase();
            lower.contains("microsoft") || lower.contains("wsl")
        })
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn open_in_windows_host(path: &std::path::Path) -> Result<()> {
    use std::process::Command;
    let output = Command::new("wslpath")
        .arg("-w")
        .arg(path)
        .output()
        .map_err(|e| NoteDeckError::InvalidInput(format!("wslpath exec failed: {e}")))?;
    if !output.status.success() {
        return Err(NoteDeckError::InvalidInput(format!(
            "wslpath failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    let winpath = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // `start` は最初の引用符付き引数をウィンドウタイトルとして扱うので、
    // 空文字列のタイトルを先に渡してからパスを渡す。
    Command::new("cmd.exe")
        .args(["/c", "start", "", &winpath])
        .spawn()
        .map_err(|e| NoteDeckError::InvalidInput(format!("cmd.exe exec failed: {e}")))?;
    Ok(())
}

/// Read `settings.json5` (VSCode `settings.json` equivalent — single source of truth
/// for scalar preferences). Returns empty string if the file does not exist (first run).
///
/// Note: The Tauri command name stays `read_notedeck_json` for backwards-compatible
/// bindings. The file on disk is `settings.json5` to avoid collision with the export
/// bundle filename `notedeck.json`.
#[tauri::command]
#[specta::specta]
pub fn read_notedeck_json(app: tauri::AppHandle) -> Result<String> {
    let path = settings_base_dir(&app)?.join("settings.json5");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| {
        NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display()))
    })
}

/// Write `settings.json5`. Creates the settings directory if missing.
#[tauri::command]
#[specta::specta]
pub fn write_notedeck_json(app: tauri::AppHandle, content: &str) -> Result<()> {
    let path = settings_base_dir(&app)?.join("settings.json5");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            NoteDeckError::InvalidInput(format!(
                "Failed to create directory {}: {e}",
                parent.display()
            ))
        })?;
    }
    fs::write(&path, content).map_err(|e| {
        NoteDeckError::InvalidInput(format!("Failed to write {}: {e}", path.display()))
    })
}

/// Export all settings files to a JSON bundle via save dialog.
#[tauri::command]
#[specta::specta]
pub async fn export_settings_json(app: tauri::AppHandle) -> Result<bool> {
    use std::collections::BTreeMap;
    use tauri_plugin_dialog::DialogExt;

    let base_dir = settings_base_dir(&app)?;

    let dest = app
        .dialog()
        .file()
        .set_file_name("notedeck.json")
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    let Some(dest) = dest else {
        return Ok(false); // user cancelled
    };

    let dest_path = dest
        .as_path()
        .ok_or_else(|| NoteDeckError::InvalidInput("Invalid destination path".to_string()))?;

    let mut bundle: BTreeMap<String, String> = BTreeMap::new();

    // Add subdirectory files (profiles/, themes/, plugins/, snippets/, memos/, widgets/, skills/)
    for subdir in ALLOWED_SUBDIRS {
        let dir = base_dir.join(subdir);
        if !dir.exists() {
            continue;
        }
        let entries = fs::read_dir(&dir)
            .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
        for entry in entries {
            let entry = entry.map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            let key = format!("{subdir}/{name_str}");
            let content = fs::read_to_string(entry.path())
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(key, content);
        }
    }

    // Add root-level settings files
    for root_file in ALLOWED_ROOT_FILES {
        let path = base_dir.join(root_file);
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(root_file.to_string(), content);
        }
    }

    let json = serde_json::to_string_pretty(&bundle)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to serialize: {e}")))?;
    fs::write(dest_path, json)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to write: {e}")))?;

    Ok(true)
}

/// Import settings from a JSON bundle via open dialog.
#[tauri::command]
#[specta::specta]
pub async fn import_settings_json(app: tauri::AppHandle) -> Result<bool> {
    use std::collections::BTreeMap;
    use tauri_plugin_dialog::DialogExt;

    let base_dir = settings_base_dir(&app)?;

    let src = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    let Some(src) = src else {
        return Ok(false); // user cancelled
    };

    let src_path = src
        .as_path()
        .ok_or_else(|| NoteDeckError::InvalidInput("Invalid source path".to_string()))?;

    let raw = fs::read_to_string(src_path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read file: {e}")))?;
    let bundle: BTreeMap<String, String> = serde_json::from_str(&raw)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Invalid JSON: {e}")))?;

    for (key, content) in &bundle {
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

        // Ensure parent directory exists
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
        }

        fs::write(&dest_path, content)
            .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to write {key}: {e}")))?;
    }

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn validate_subdir_allowed() {
        assert!(validate_subdir("profiles").is_ok());
        assert!(validate_subdir("themes").is_ok());
        assert!(validate_subdir("plugins").is_ok());
        assert!(validate_subdir("snippets").is_ok());
        assert!(validate_subdir("widgets").is_ok());
        assert!(validate_subdir("skills").is_ok());
        assert!(validate_subdir("sessions").is_ok());
    }

    #[test]
    fn validate_subdir_rejected() {
        assert!(validate_subdir("").is_err());
        assert!(validate_subdir("secrets").is_err());
        assert!(validate_subdir("../etc").is_err());
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
    fn json_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        // Create test settings structure
        let profiles_dir = base.join("profiles");
        fs::create_dir_all(&profiles_dir).unwrap();
        fs::write(
            profiles_dir.join("test.ndprofile.json5"),
            r#"{ name: "test" }"#,
        )
        .unwrap();

        let themes_dir = base.join("themes");
        fs::create_dir_all(&themes_dir).unwrap();
        fs::write(
            themes_dir.join("dark.ndtheme.json5"),
            r#"{ name: "dark" }"#,
        )
        .unwrap();

        let snippets_dir = base.join("snippets");
        fs::create_dir_all(&snippets_dir).unwrap();
        fs::write(
            snippets_dir.join("aiscript.json5"),
            r#"{ hello: { prefix: "hi", body: ["<: \"hi\""] } }"#,
        )
        .unwrap();

        fs::write(base.join("custom.css"), "body { color: red; }").unwrap();
        fs::write(base.join("keybinds.json5"), r#"{ "search": [] }"#).unwrap();

        // Export to JSON bundle (same logic as export_settings_json)
        let json_path = base.join("backup.json");
        {
            let mut bundle: BTreeMap<String, String> = BTreeMap::new();
            for subdir in ALLOWED_SUBDIRS {
                let d = base.join(subdir);
                if !d.exists() {
                    continue;
                }
                for entry in fs::read_dir(&d).unwrap() {
                    let entry = entry.unwrap();
                    if entry.file_type().unwrap().is_file() {
                        let name = entry.file_name();
                        let key = format!("{subdir}/{}", name.to_string_lossy());
                        let content = fs::read_to_string(entry.path()).unwrap();
                        bundle.insert(key, content);
                    }
                }
            }
            for root_file in ALLOWED_ROOT_FILES {
                let p = base.join(root_file);
                if p.exists() {
                    let content = fs::read_to_string(&p).unwrap();
                    bundle.insert(root_file.to_string(), content);
                }
            }
            let json = serde_json::to_string_pretty(&bundle).unwrap();
            fs::write(&json_path, json).unwrap();
        }

        // Clear original files
        fs::remove_dir_all(&profiles_dir).unwrap();
        fs::remove_dir_all(&themes_dir).unwrap();
        fs::remove_dir_all(&snippets_dir).unwrap();
        fs::remove_file(base.join("custom.css")).unwrap();
        fs::remove_file(base.join("keybinds.json5")).unwrap();

        // Import from JSON bundle (same logic as import_settings_json)
        {
            let raw = fs::read_to_string(&json_path).unwrap();
            let bundle: BTreeMap<String, String> = serde_json::from_str(&raw).unwrap();
            for (key, content) in &bundle {
                if key.contains("..") || key.starts_with('/') || key.starts_with('\\') {
                    continue;
                }
                let allowed = ALLOWED_SUBDIRS
                    .iter()
                    .any(|d| key.starts_with(&format!("{d}/")))
                    || ALLOWED_ROOT_FILES.contains(&key.as_str());
                if !allowed {
                    continue;
                }
                let dest = base.join(key);
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).unwrap();
                }
                fs::write(&dest, content).unwrap();
            }
        }

        // Verify restored files
        assert_eq!(
            fs::read_to_string(profiles_dir.join("test.ndprofile.json5")).unwrap(),
            r#"{ name: "test" }"#
        );
        assert_eq!(
            fs::read_to_string(themes_dir.join("dark.ndtheme.json5")).unwrap(),
            r#"{ name: "dark" }"#
        );
        assert_eq!(
            fs::read_to_string(snippets_dir.join("aiscript.json5")).unwrap(),
            r#"{ hello: { prefix: "hi", body: ["<: \"hi\""] } }"#
        );
        assert_eq!(
            fs::read_to_string(base.join("custom.css")).unwrap(),
            "body { color: red; }"
        );
        assert_eq!(
            fs::read_to_string(base.join("keybinds.json5")).unwrap(),
            r#"{ "search": [] }"#
        );
    }

    #[test]
    fn json_import_rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("app");
        fs::create_dir_all(&base).unwrap();

        let mut bundle: BTreeMap<String, String> = BTreeMap::new();
        bundle.insert("../../../etc/passwd".to_string(), "evil".to_string());
        bundle.insert("profiles/good.json5".to_string(), "ok".to_string());

        let json_path = dir.path().join("evil.json");
        fs::write(&json_path, serde_json::to_string(&bundle).unwrap()).unwrap();

        // Import with validation
        let raw = fs::read_to_string(&json_path).unwrap();
        let imported: BTreeMap<String, String> = serde_json::from_str(&raw).unwrap();
        for (key, content) in &imported {
            if key.contains("..") || key.starts_with('/') || key.starts_with('\\') {
                continue;
            }
            let allowed = ALLOWED_SUBDIRS
                .iter()
                .any(|d| key.starts_with(&format!("{d}/")))
                || ALLOWED_ROOT_FILES.contains(&key.as_str());
            if !allowed {
                continue;
            }
            let dest = base.join(key);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&dest, content).unwrap();
        }

        assert!(!dir.path().join("etc/passwd").exists());
        assert_eq!(
            fs::read_to_string(base.join("profiles/good.json5")).unwrap(),
            "ok"
        );
    }

    #[test]
    fn json_import_rejects_unknown_entries() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("app");
        fs::create_dir_all(&base).unwrap();

        let mut bundle: BTreeMap<String, String> = BTreeMap::new();
        bundle.insert("custom.css".to_string(), "body{}".to_string());
        bundle.insert("secret.txt".to_string(), "secret".to_string());
        bundle.insert("config/bad.json".to_string(), "bad".to_string());

        let json_path = dir.path().join("mixed.json");
        fs::write(&json_path, serde_json::to_string(&bundle).unwrap()).unwrap();

        let raw = fs::read_to_string(&json_path).unwrap();
        let imported: BTreeMap<String, String> = serde_json::from_str(&raw).unwrap();
        for (key, content) in &imported {
            if key.contains("..") || key.starts_with('/') || key.starts_with('\\') {
                continue;
            }
            let allowed = ALLOWED_SUBDIRS
                .iter()
                .any(|d| key.starts_with(&format!("{d}/")))
                || ALLOWED_ROOT_FILES.contains(&key.as_str());
            if !allowed {
                continue;
            }
            let dest = base.join(key);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&dest, content).unwrap();
        }

        assert!(base.join("custom.css").exists());
        assert!(!base.join("secret.txt").exists());
        assert!(!base.join("config/bad.json").exists());
    }
}
