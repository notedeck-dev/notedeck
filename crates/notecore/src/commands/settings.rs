//! settings のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

//! 設定ファイル系コマンドのデータ面。実体は `crate::settings_store` (#782)。
//! dialog / OS 統合 / 認可境界 (ルート設定ファイルの書込) は src-tauri 側に残る。

use std::path::PathBuf;

use crate::perf_config::PerformanceConfig;
use crate::settings_store as store;

use crate::context::Core;
use crate::error::Result;
use notecli::error::NoteDeckError;

/// Settings subdirectory name under app_data_dir.
pub const SETTINGS_DIR: &str = "notedeck";

/// Resolve the settings base directory: `app_data_dir/notedeck/`.
pub fn settings_base_dir(core: &Core) -> Result<PathBuf> {
    Ok(core.app_dir()?.join(SETTINGS_DIR))
}

/// AI セッションは notecore が単一の書き手 (#1133)。汎用のファイル操作では
/// 触らせず、`ai_session_*` の構造化された操作に限る。
fn reject_sessions(subdir: &str) -> Result<()> {
    if subdir == crate::ai_sessions::SUBDIR {
        return Err(NoteDeckError::InvalidInput(
            "sessions are written by notecore (use ai_session_*)".into(),
        ));
    }
    Ok(())
}

pub async fn list_settings_files(core: &Core, subdir: String) -> Result<Vec<String>> {
    reject_sessions(&subdir)?;
    store::list_files(&settings_base_dir(core)?, &subdir)
}

/// Read a settings file as a UTF-8 string.
pub async fn read_settings_file(core: &Core, subdir: String, name: String) -> Result<String> {
    reject_sessions(&subdir)?;
    store::read_file(&settings_base_dir(core)?, &subdir, &name)
}

/// Write a settings file (creates parent directories if needed).
/// `expected` (読んだときの版) があれば条件付き。戻り値は書いた後の版 (#1106)
pub async fn write_settings_file(
    core: &Core,
    subdir: String,
    name: String,
    content: String,
    expected: Option<String>,
) -> Result<String> {
    reject_sessions(&subdir)?;
    store::write_file_if(
        &settings_base_dir(core)?,
        &subdir,
        &name,
        &content,
        expected.as_deref(),
    )
}

/// Delete a settings file.
pub async fn delete_settings_file(core: &Core, subdir: String, name: String) -> Result<()> {
    reject_sessions(&subdir)?;
    store::delete_file(&settings_base_dir(core)?, &subdir, &name)
}

/// Rename a settings file within the same subdirectory.
pub async fn rename_settings_file(
    core: &Core,
    subdir: String,
    old_name: String,
    new_name: String,
) -> Result<()> {
    reject_sessions(&subdir)?;
    store::rename_file(&settings_base_dir(core)?, &subdir, &old_name, &new_name)
}

/// Read a root-level settings file as a UTF-8 string.
pub async fn read_root_settings_file(core: &Core, name: String) -> Result<String> {
    store::read_root_file(&settings_base_dir(core)?, &name)
}

/// ルート直下のファイルを版つきで読む (丸ごと書き戻す store 向け)
pub async fn read_root_settings_file_versioned(
    core: &Core,
    name: String,
) -> Result<store::VersionedText> {
    store::read_root_file_versioned(&settings_base_dir(core)?, &name)
}

/// ルート直下のファイルを書く。`expected` があれば条件付き。戻り値は書いた後の版
pub async fn write_root_settings_file(
    core: &Core,
    name: String,
    content: String,
    expected: Option<String>,
) -> Result<String> {
    store::write_root_file_if(
        &settings_base_dir(core)?,
        &name,
        &content,
        expected.as_deref(),
    )
}

pub async fn read_notedeck_json_versioned(core: &Core) -> Result<store::VersionedText> {
    store::read_settings_json_versioned(&settings_base_dir(core)?)
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
pub async fn write_notedeck_json(
    core: &Core,
    content: String,
    expected: Option<String>,
) -> Result<String> {
    let version =
        store::write_settings_json_if(&settings_base_dir(core)?, &content, expected.as_deref())?;
    // デバイスは自分の写しを自分で更新しているので受け手が無いが、notecored は
    // これで接続モード (modes.realtime) を適用し直す (#1106)
    core.notify_settings_change(crate::settings_events::SettingsChange {
        subdir: None,
        name: crate::stream_mode::SETTINGS_FILE.to_string(),
        op: crate::settings_events::SettingsChangeOp::Write,
    });
    Ok(version)
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
