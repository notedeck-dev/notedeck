//! settings のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

//! 設定ファイル系コマンドのデータ面。実体は `crate::settings_store` (#782)。
//! dialog / OS 統合 / 認可境界 (ルート設定ファイルの書込) は src-tauri 側に残る。

use std::path::PathBuf;

use crate::perf_config::PerformanceConfig;
use crate::settings_store as store;

use crate::context::Core;
use crate::error::Result;

/// Settings subdirectory name under app_data_dir.
pub const SETTINGS_DIR: &str = "notedeck";

/// Resolve the settings base directory: `app_data_dir/notedeck/`.
pub fn settings_base_dir(core: &Core) -> Result<PathBuf> {
    Ok(core.app_dir()?.join(SETTINGS_DIR))
}

pub async fn list_settings_files(core: &Core, subdir: String) -> Result<Vec<String>> {
    store::list_files(&settings_base_dir(core)?, &subdir)
}

/// Read a settings file as a UTF-8 string.
pub async fn read_settings_file(core: &Core, subdir: String, name: String) -> Result<String> {
    store::read_file(&settings_base_dir(core)?, &subdir, &name)
}

/// Write a settings file (creates parent directories if needed).
pub async fn write_settings_file(
    core: &Core,
    subdir: String,
    name: String,
    content: String,
) -> Result<()> {
    store::write_file(&settings_base_dir(core)?, &subdir, &name, &content)
}

/// Delete a settings file.
pub async fn delete_settings_file(core: &Core, subdir: String, name: String) -> Result<()> {
    store::delete_file(&settings_base_dir(core)?, &subdir, &name)
}

/// Rename a settings file within the same subdirectory.
pub async fn rename_settings_file(
    core: &Core,
    subdir: String,
    old_name: String,
    new_name: String,
) -> Result<()> {
    store::rename_file(&settings_base_dir(core)?, &subdir, &old_name, &new_name)
}

/// Read a root-level settings file as a UTF-8 string.
pub async fn read_root_settings_file(core: &Core, name: String) -> Result<String> {
    store::read_root_file(&settings_base_dir(core)?, &name)
}

/// Read `settings.json5` (VSCode `settings.json` equivalent — single source of truth
/// for scalar preferences). Returns empty string if the file does not exist (first run).
///
/// Note: The Tauri command name stays `read_notedeck_json` for backwards-compatible
/// bindings. The file on disk is `settings.json5` to avoid collision with the export
/// bundle filename `notedeck.json`.
pub async fn read_notedeck_json(core: &Core) -> Result<String> {
    store::read_settings_json(&settings_base_dir(core)?)
}

/// Write `settings.json5`. Creates the settings directory if missing.
pub async fn write_notedeck_json(core: &Core, content: String) -> Result<()> {
    store::write_settings_json(&settings_base_dir(core)?, &content)
}

/// Tauri command: update performance config at runtime.
pub async fn update_performance_config(core: &Core, config: PerformanceConfig) -> Result<()> {
    let mut current = core.perf()?.write().await;
    *current = config;
    Ok(())
}

/// Tauri command: get current performance config.
pub async fn get_performance_config(core: &Core) -> Result<PerformanceConfig> {
    Ok(core.perf()?.read().await.clone())
}
