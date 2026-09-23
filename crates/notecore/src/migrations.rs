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
    Ok(())
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
