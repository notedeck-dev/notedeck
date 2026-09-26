//! ナビバー構成 (ルートの `navbar.json5` = NavItem の配列) の読取と既定への
//! 戻し (#1133 第 3 弾)。デバイス側 `src/stores/deck.ts` と同じ規則。既定値は
//! `src/defaults/navbar.json5` を共有する。全置換 (`navbar.set`) はカラム種別の
//! 実行時レジストリで検証するのでデバイスに残る。

use serde_json::{json, Value};
use std::sync::LazyLock;

use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::error::Result;
use crate::json5_out::J5;
use crate::settings_events;
use crate::settings_store as store;

pub const FILE_NAME: &str = "navbar.json5";
const DEFAULTS_SRC: &str = include_str!("../../../src/defaults/navbar.json5");
/// 過去の版で消えたカラム種別 (読込時に黙って落とす、デバイスと同じ)
const DEPRECATED_COLUMN_TYPES: &[&str] = &["workspaceExplorer"];

static DEFAULTS: LazyLock<Vec<Value>> = LazyLock::new(|| {
    let doc: J5 = json5::from_str(DEFAULTS_SRC).expect("navbar.json5 is valid JSON5");
    doc.as_arr()
        .unwrap_or_default()
        .iter()
        .map(J5::to_value)
        .collect()
});

pub fn defaults() -> &'static [Value] {
    &DEFAULTS
}

/// 現在の構成。ファイルが空 / 無い / 壊れている / 空配列なら既定。
pub fn load(core: &Core) -> Result<Vec<Value>> {
    let text = store::read_root_file(&settings_base_dir(core)?, FILE_NAME).unwrap_or_default();
    if text.trim().is_empty() {
        return Ok(DEFAULTS.clone());
    }
    let items = match json5::from_str::<J5>(&text) {
        Ok(J5::Arr(items)) if !items.is_empty() => items,
        _ => return Ok(DEFAULTS.clone()),
    };
    Ok(items
        .iter()
        .map(J5::to_value)
        .filter(|i| {
            !i.get("type")
                .and_then(Value::as_str)
                .map(|t| DEPRECATED_COLUMN_TYPES.contains(&t))
                .unwrap_or(false)
        })
        .collect())
}

/// 既定に戻す = ファイルを空にする (デバイスの `setNavItems(undefined)` と同じ)。
pub fn reset(core: &Core) -> Result<()> {
    settings_events::write_root_file(core, FILE_NAME, "")
}

/// AI に見せる形 `{ type, accountId, label }` (仕切りは `{ type: 'divider' }`)。
pub fn project(item: &Value) -> Value {
    let ty = item.get("type").and_then(Value::as_str).unwrap_or("");
    if ty == "divider" {
        return json!({ "type": "divider" });
    }
    json!({
        "type": ty,
        "accountId": item.get("accountId").and_then(Value::as_str),
        "label": item.get("label").and_then(Value::as_str).filter(|l| !l.is_empty()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_defaults_when_missing_or_empty_and_drops_deprecated_types() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let base = settings_base_dir(&core).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        assert!(!defaults().is_empty());
        assert_eq!(load(&core).unwrap(), defaults());
        std::fs::write(base.join(FILE_NAME), "[]").unwrap();
        assert_eq!(load(&core).unwrap(), defaults());
        std::fs::write(
            base.join(FILE_NAME),
            "[{ type: 'workspaceExplorer', accountId: null }, { type: 'divider' }, { type: 'chat', accountId: 'a', label: 'C' }]",
        )
        .unwrap();
        let items = load(&core).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(project(&items[0]), json!({ "type": "divider" }));
        assert_eq!(
            project(&items[1]),
            json!({ "type": "chat", "accountId": "a", "label": "C" })
        );
        reset(&core).unwrap();
        assert_eq!(std::fs::read_to_string(base.join(FILE_NAME)).unwrap(), "");
        assert_eq!(load(&core).unwrap(), defaults());
    }
}
