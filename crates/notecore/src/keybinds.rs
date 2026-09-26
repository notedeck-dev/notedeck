//! キーバインド (ルートの `keybinds.json5` = `{ commandId: Shortcut[] }` の上書き
//! マップ) の読み書き (#1133 第 3 弾)。デバイス側 `src/stores/keybinds.ts` と同じ
//! 規則。既定値は `src/defaults/keybindings.json5` を共有する。

use serde_json::{json, Value};
use std::sync::LazyLock;

use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::error::Result;
use crate::json5_out::{self, J5};
use crate::settings_events;
use crate::settings_store as store;

pub const FILE_NAME: &str = "keybinds.json5";
const DEFAULTS_SRC: &str = include_str!("../../../src/defaults/keybindings.json5");

/// 既定のキーバインド (宣言順)
static DEFAULTS: LazyLock<Vec<(String, Value)>> = LazyLock::new(|| {
    let doc: J5 = json5::from_str(DEFAULTS_SRC).expect("keybindings.json5 is valid JSON5");
    doc.as_arr()
        .unwrap_or_default()
        .iter()
        .filter_map(|e| {
            let id = e.get("commandId")?.as_str()?.to_string();
            let shortcuts = e.get("shortcuts").map(J5::to_value).unwrap_or(json!([]));
            Some((id, shortcuts))
        })
        .collect()
});

pub fn default_command_ids() -> Vec<String> {
    DEFAULTS.iter().map(|(id, _)| id.clone()).collect()
}

pub fn default_shortcuts(command_id: &str) -> Value {
    DEFAULTS
        .iter()
        .find(|(id, _)| id == command_id)
        .map(|(_, s)| s.clone())
        .unwrap_or(json!([]))
}

/// 上書きマップ (ファイル順)。無い / 壊れているときは空。
pub fn load_overrides(core: &Core) -> Result<J5> {
    let text = store::read_root_file(&settings_base_dir(core)?, FILE_NAME).unwrap_or_default();
    Ok(match json5::from_str::<J5>(&text) {
        Ok(v @ J5::Obj(_)) => v,
        _ => J5::Obj(vec![]),
    })
}

fn write_overrides(core: &Core, overrides: &J5) -> Result<()> {
    let text = json5_out::stringify(overrides) + "\n";
    settings_events::write_root_file(core, FILE_NAME, &text)
}

pub fn set_shortcuts(core: &Core, command_id: &str, shortcuts: J5) -> Result<()> {
    let mut overrides = load_overrides(core)?;
    overrides.set(command_id, shortcuts);
    write_overrides(core, &overrides)
}

pub fn reset(core: &Core, command_id: &str) -> Result<()> {
    let mut overrides = load_overrides(core)?;
    overrides.remove(command_id);
    write_overrides(core, &overrides)
}

pub fn reset_all(core: &Core) -> Result<()> {
    write_overrides(core, &J5::Obj(vec![]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_loaded_from_the_shared_file() {
        assert!(default_command_ids()
            .iter()
            .any(|id| id == "command-palette"));
        assert!(!default_shortcuts("command-palette")
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(default_shortcuts("no-such"), json!([]));
    }

    #[test]
    fn overrides_round_trip_like_the_device() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let base = settings_base_dir(&core).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        assert_eq!(load_overrides(&core).unwrap(), J5::Obj(vec![]));
        let sc = J5::Arr(vec![J5::Obj(vec![
            ("key".into(), J5::Str("j".into())),
            ("scope".into(), J5::Str("body".into())),
        ])]);
        set_shortcuts(&core, "search", sc).unwrap();
        assert_eq!(
            std::fs::read_to_string(base.join(FILE_NAME)).unwrap(),
            "{\n  search: [\n    {\n      key: 'j',\n      scope: 'body',\n    },\n  ],\n}\n"
        );
        set_shortcuts(&core, "notifications", J5::Arr(vec![])).unwrap();
        reset(&core, "search").unwrap();
        let ov = load_overrides(&core).unwrap();
        assert!(ov.get("search").is_none());
        assert!(ov.get("notifications").is_some());
        reset_all(&core).unwrap();
        assert_eq!(
            std::fs::read_to_string(base.join(FILE_NAME)).unwrap(),
            "{}\n"
        );
    }
}
