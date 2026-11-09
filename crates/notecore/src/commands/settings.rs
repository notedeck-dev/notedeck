//! settings のデータ系コマンド本体 (#1106 段階 0b)。各関数は `&Core` と引数を取り、
//! コマンド表 (commands/table.rs) から呼ばれる。

//! 設定ファイル系コマンドのデータ面。実体は `crate::settings_store` (#782)。
//! dialog / OS 統合 / 認可境界 (ルート設定ファイルの書込) は src-tauri 側に残る。

use crate::perf_config::PerformanceConfig;
use crate::settings_store as store;

use crate::context::Core;
use crate::error::Result;

/// AI セッションの論理 subdir。書き手は notemaid だけで (#1133)、汎用のファイル操作
/// からは `Subdir::ipc = false` で外れている (#1333 §1)
pub const AI_SESSIONS_SUBDIR: &str = "sessions";

/// 汎用の IPC で触れる subdir か (`ipc: false` の sessions などを拒む)
fn ipc_subdir(subdir: &str) -> Result<()> {
    store::validate_ipc_subdir(subdir).map(|_| ())
}

/// 汎用の IPC で触れるルート直下のファイルか (`ipc: false` の connections.json を拒む)
fn ipc_root_file(name: &str) -> Result<()> {
    store::validate_ipc_root_file(name).map(|_| ())
}

pub async fn list_settings_files(core: &Core, subdir: String) -> Result<Vec<String>> {
    ipc_subdir(&subdir)?;
    store::list_files(core.layout()?, &subdir)
}

/// Read a settings file as a UTF-8 string.
pub async fn read_settings_file(core: &Core, subdir: String, name: String) -> Result<String> {
    ipc_subdir(&subdir)?;
    store::read_file(core.layout()?, &subdir, &name)
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
    ipc_subdir(&subdir)?;
    store::write_file_if(
        core.layout()?,
        &subdir,
        &name,
        &content,
        expected.as_deref(),
    )
}

/// Delete a settings file.
pub async fn delete_settings_file(core: &Core, subdir: String, name: String) -> Result<()> {
    ipc_subdir(&subdir)?;
    store::delete_file(core.layout()?, &subdir, &name)
}

/// Rename a settings file within the same subdirectory.
pub async fn rename_settings_file(
    core: &Core,
    subdir: String,
    old_name: String,
    new_name: String,
) -> Result<()> {
    ipc_subdir(&subdir)?;
    store::rename_file(core.layout()?, &subdir, &old_name, &new_name)
}

/// Read a root-level settings file as a UTF-8 string.
pub async fn read_root_settings_file(core: &Core, name: String) -> Result<String> {
    ipc_root_file(&name)?;
    store::read_root_file(core.layout()?, &name)
}

/// ルート直下のファイルを版つきで読む (丸ごと書き戻す store 向け)
pub async fn read_root_settings_file_versioned(
    core: &Core,
    name: String,
) -> Result<store::VersionedText> {
    ipc_root_file(&name)?;
    store::read_root_file_versioned(core.layout()?, &name)
}

/// ルート直下のファイルを書く。`expected` があれば条件付き。戻り値は書いた後の版
pub async fn write_root_settings_file(
    core: &Core,
    name: String,
    content: String,
    expected: Option<String>,
) -> Result<String> {
    ipc_root_file(&name)?;
    store::write_root_file_if(core.layout()?, &name, &content, expected.as_deref())
}

pub async fn read_notedeck_json_versioned(core: &Core) -> Result<store::VersionedText> {
    store::read_settings_json_versioned(core.layout()?)
}

/// Read `settings.json5` (VSCode `settings.json` equivalent — single source of truth
/// for scalar preferences). Returns empty string if the file does not exist (first run).
///
/// Note: The Tauri command name stays `read_notedeck_json` for backwards-compatible
/// bindings. The file on disk is `settings.json5` to avoid collision with the export
/// bundle filename `notedeck.json`.
pub async fn read_notedeck_json(core: &Core) -> Result<String> {
    store::read_settings_json(core.layout()?)
}

/// Write `settings.json5`. Creates the settings directory if missing.
pub async fn write_notedeck_json(
    core: &Core,
    content: String,
    expected: Option<String>,
) -> Result<String> {
    let version = store::write_settings_json_if(core.layout()?, &content, expected.as_deref())?;
    // デバイスは自分の写しを自分で更新しているので受け手が無いが、notemaid は
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

// --- 編集履歴のサイドカー (#1334 段階 2)。`subdir` が None ならルート直下 (custom.css) ---

pub async fn read_history_sidecar(
    core: &Core,
    subdir: Option<String>,
    base: String,
) -> Result<String> {
    if let Some(s) = &subdir {
        ipc_subdir(s)?;
    }
    store::read_history(core.layout()?, subdir.as_deref(), &base)
}

pub async fn write_history_sidecar(
    core: &Core,
    subdir: Option<String>,
    base: String,
    content: String,
) -> Result<()> {
    if let Some(s) = &subdir {
        ipc_subdir(s)?;
    }
    store::write_history(core.layout()?, subdir.as_deref(), &base, &content)
}

pub async fn delete_history_sidecar(
    core: &Core,
    subdir: Option<String>,
    base: String,
) -> Result<()> {
    if let Some(s) = &subdir {
        ipc_subdir(s)?;
    }
    store::delete_history(core.layout()?, subdir.as_deref(), &base)
}
