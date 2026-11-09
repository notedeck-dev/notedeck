//! Data migrations for breaking changes.
//!
//! Each migration checks its precondition and is idempotent — safe to re-run.
//! Add new migrations at the bottom of `run_all()`.

use std::fs;
use std::path::Path;

use notecli::db::Database;

/// Run all migrations in order. Called once during app setup.
/// Filesystem migrations run before DB is opened; DB migrations run after.
pub fn run_fs(app_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    rename_db(app_dir)?;
    move_settings_to_subdir(app_dir)?;
    rename_settings_json_to_json5(app_dir)?;
    rename_performance_json_to_json5(app_dir)?;
    rename_ai_json_to_json5(app_dir)?;
    remove_notecored_leftovers(app_dir, dirs::config_dir().as_deref());
    remove_stale_root_files(app_dir);
    move_loopback_consent_to_state(app_dir)?;
    // 編集履歴のサイドカーは状態 (#1334 段階 2): 設定の隣から state/history/ へ移し、
    // 持ち主の無いものを消す
    let layout = crate::app_dir::Layout::from_root(app_dir);
    crate::settings_store::move_history_sidecars(&layout);
    crate::settings_store::sweep_orphan_history(&layout);
    // 再編の退避と移行前のバックアップは保持期限を過ぎたら消す (#1334)
    crate::layout_migration::sweep_old_shelves(app_dir);
    Ok(())
}

/// #1333 §4: loopback 同意 (#1293) は同意 = この機械の状態なので、設定ディレクトリの
/// `loopback/consent.json` から `state/loopback-consent.json` へ移す
fn move_loopback_consent_to_state(app_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let layout = crate::app_dir::Layout::from_root(app_dir);
    let old_dir = layout.config().join(crate::loopback_consent::DIR);
    let old = old_dir.join("consent.json");
    let new = layout.state().join(crate::loopback_consent::FILE);
    if old.is_file() && !new.exists() {
        fs::create_dir_all(layout.state())?;
        fs::rename(&old, &new)?;
    }
    if old_dir.is_dir() {
        let _ = fs::remove_dir(&old_dir);
    }
    Ok(())
}

/// 旧バージョンが app_data_dir 直下に残したゴミを消す (#1333 §1)。
/// `notecore.lock` (旧 notecored のロック) / `notemaid.db*` (notemaid が SQLite を開いていた
/// 頃の DB) / `poll_accounts.json` (旧巡回の口座写し) / `logs/notecored.log.*`。
/// 今の持ち物 (`notemaid.lock` / `notemaid-accounts.json` / `logs/notemaid.log*`) は触らない。
/// 消せなくても warn 止まりで起動は止めない
fn remove_stale_root_files(app_dir: &Path) {
    let mut targets: Vec<std::path::PathBuf> = ["notecore.lock", "poll_accounts.json"]
        .iter()
        .map(|n| app_dir.join(n))
        .collect();
    for (dir, prefix) in [
        (app_dir.to_path_buf(), "notemaid.db"),
        (app_dir.join("logs"), "notecored.log"),
    ] {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name == prefix
                || name.starts_with(&format!("{prefix}."))
                || name.starts_with(&format!("{prefix}-"))
            {
                targets.push(entry.path());
            }
        }
    }
    for path in targets {
        if !path.is_file() {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => {
                tracing::info!(path = %path.display(), "removed a stale file of an old version")
            }
            Err(e) => tracing::warn!(path = %path.display(), %e, "cannot remove a stale file"),
        }
    }
}

/// v1.74 で削除した notecored (データ面の常駐、#1106) が Linux に残した secret の
/// 保管 (`<data-dir>/notecored/secrets.enc` と `<config-dir>/notecored/secret.key`) を消す。
/// 中身は暗号化したトークンの写しで、今の notemaid は `<config-dir>/notemaid/` を使う。
/// 失敗しても起動は止めない。
fn remove_notecored_leftovers(app_dir: &Path, config_dir: Option<&Path>) {
    let mut targets = vec![app_dir.join("notecored")];
    if let Some(c) = config_dir {
        targets.push(c.join("notecored"));
    }
    for dir in targets {
        if !dir.is_dir() {
            continue;
        }
        match fs::remove_dir_all(&dir) {
            Ok(()) => tracing::info!(path = %dir.display(), "removed the notecored leftovers"),
            Err(e) => {
                tracing::warn!(path = %dir.display(), %e, "cannot remove the notecored leftovers")
            }
        }
    }
}

/// Run DB-dependent migrations. Called after DB and keychain are initialized.
pub fn run_db(db: &Database) {
    migrate_tokens_to_keychain(db);
}

/// v0.5 → v0.6: Rename `notedeck.db` → `notecli.db`.
fn rename_db(app_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let old = app_dir.join("notedeck.db");
    let new = app_dir.join("notecli.db");
    if old.exists() && !new.exists() {
        fs::rename(&old, &new)?;
    }
    Ok(())
}

/// v0.6: Migrate plaintext tokens from SQLite to OS keychain.
/// `get_credentials()` does lazy per-account migration, but this pre-migrates
/// all accounts at startup so the DB tokens are cleared as early as possible.
fn migrate_tokens_to_keychain(db: &Database) {
    let accounts = match db.load_accounts() {
        Ok(a) => a,
        Err(_) => return,
    };
    if !accounts.iter().any(|a| !a.token.is_empty()) {
        return;
    }
    for account in &accounts {
        if let Err(e) = crate::credentials::get_credentials(db, &account.id) {
            tracing::warn!(account_id = %account.id, %e, "keychain migration failed");
        }
    }
}

/// v0.8: Rename `settings.json` → `settings.json5` for JSON5 unification.
fn rename_settings_json_to_json5(app_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let settings_dir = app_dir.join("notedeck");
    let old = settings_dir.join("settings.json");
    let new = settings_dir.join("settings.json5");
    if old.exists() && !new.exists() {
        fs::rename(&old, &new)?;
    }
    Ok(())
}

/// v0.8: Rename `performance.json` → `performance.json5` for JSON5 unification.
fn rename_performance_json_to_json5(app_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let settings_dir = app_dir.join("notedeck");
    let old = settings_dir.join("performance.json");
    let new = settings_dir.join("performance.json5");
    if old.exists() && !new.exists() {
        fs::rename(&old, &new)?;
    }
    Ok(())
}

/// v0.8: Rename `ai.json` → `ai.json5` for JSON5 unification.
fn rename_ai_json_to_json5(app_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let settings_dir = app_dir.join("notedeck");
    let old = settings_dir.join("ai.json");
    let new = settings_dir.join("ai.json5");
    if old.exists() && !new.exists() {
        fs::rename(&old, &new)?;
    }
    Ok(())
}

/// v0.7 → v0.8: Move settings files into `notedeck/` subdirectory.
fn move_settings_to_subdir(app_dir: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let settings_dir = app_dir.join("notedeck");
    if settings_dir.exists() {
        return Ok(());
    }
    // Check if there are any legacy files to migrate
    let dirs = ["profiles", "themes", "plugins"];
    let files = ["custom.css", "keybinds.json5"];
    let has_legacy = dirs.iter().any(|d| app_dir.join(d).exists())
        || files.iter().any(|f| app_dir.join(f).exists());
    if !has_legacy {
        return Ok(());
    }

    fs::create_dir_all(&settings_dir)?;
    for name in &dirs {
        let old = app_dir.join(name);
        if old.exists() {
            fs::rename(&old, settings_dir.join(name))?;
        }
    }
    for name in &files {
        let old = app_dir.join(name);
        if old.exists() {
            fs::rename(&old, settings_dir.join(name))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_consent_moves_into_the_state_dir() {
        let t = tempfile::tempdir().unwrap();
        let layout = crate::app_dir::Layout::from_root(t.path());
        let old_dir = layout.config().join("loopback");
        fs::create_dir_all(&old_dir).unwrap();
        fs::write(old_dir.join("consent.json"), "{}").unwrap();
        move_loopback_consent_to_state(t.path()).unwrap();
        assert_eq!(
            fs::read_to_string(layout.state().join("loopback-consent.json")).unwrap(),
            "{}"
        );
        assert!(!old_dir.exists());
        // 冪等
        move_loopback_consent_to_state(t.path()).unwrap();
    }

    #[test]
    fn stale_files_of_old_versions_are_removed_and_current_ones_are_kept() {
        let data = tempfile::tempdir().unwrap();
        let d = data.path();
        fs::create_dir_all(d.join("logs")).unwrap();
        for n in [
            "notecore.lock",
            "notemaid.db",
            "notemaid.db-wal",
            "notemaid.db-shm",
            "poll_accounts.json",
            "logs/notecored.log.2026-01-01",
        ] {
            fs::write(d.join(n), b"x").unwrap();
        }
        for n in [
            "notemaid.lock",
            "notemaid-accounts.json",
            "notecli.db",
            "logs/notemaid.log",
            "logs/notemaid.log.2026-01-01",
        ] {
            fs::write(d.join(n), b"keep").unwrap();
        }
        remove_stale_root_files(d);
        remove_stale_root_files(d); // 冪等
        for n in [
            "notecore.lock",
            "notemaid.db",
            "notemaid.db-wal",
            "notemaid.db-shm",
            "poll_accounts.json",
            "logs/notecored.log.2026-01-01",
        ] {
            assert!(!d.join(n).exists(), "{n} should be removed");
        }
        for n in [
            "notemaid.lock",
            "notemaid-accounts.json",
            "notecli.db",
            "logs/notemaid.log",
            "logs/notemaid.log.2026-01-01",
        ] {
            assert!(d.join(n).exists(), "{n} should be kept");
        }
    }

    #[test]
    fn notecored_leftovers_are_removed_from_both_dirs_and_nothing_else() {
        let data = tempfile::tempdir().unwrap();
        let config = tempfile::tempdir().unwrap();
        fs::create_dir_all(data.path().join("notecored")).unwrap();
        fs::write(data.path().join("notecored/secrets.enc"), b"x").unwrap();
        fs::create_dir_all(config.path().join("notecored")).unwrap();
        fs::write(config.path().join("notecored/secret.key"), b"k").unwrap();
        // 今の持ち物は触らない
        fs::create_dir_all(config.path().join("notemaid")).unwrap();
        fs::write(config.path().join("notemaid/secret.key"), b"k").unwrap();
        fs::write(data.path().join("notemaid.lock"), b"1").unwrap();

        remove_notecored_leftovers(data.path(), Some(config.path()));
        // 2 回目も安全 (冪等)
        remove_notecored_leftovers(data.path(), Some(config.path()));

        assert!(!data.path().join("notecored").exists());
        assert!(!config.path().join("notecored").exists());
        assert!(config.path().join("notemaid/secret.key").exists());
        assert!(data.path().join("notemaid.lock").exists());
    }
}
