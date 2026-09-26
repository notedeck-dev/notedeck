//! キーバインド系 capability (`keybinds.*`)。本体は `crate::keybinds`。
//! デバイスの keybinds store は `keybinds.json5` の変更通知で写しを読み直す。

use serde_json::{json, Value};

use super::preview::confirm;
use super::ExecContext;
use crate::context::Core;
use crate::error::Result;
use crate::i18n::text;
use crate::json5_out::J5;
use crate::keybinds;
use notecli::error::NoteDeckError;

fn s<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or("")
}

fn invalid(msg: String) -> NoteDeckError {
    NoteDeckError::InvalidInput(msg)
}

/// `parseShortcut`: `{ key, scope, ctrl?, shift?, alt? }` (true のときだけ出す)。
fn parse_shortcut(input: &Value, index: usize) -> Result<J5> {
    let Some(obj) = input.as_object() else {
        return Err(invalid(format!(
            "keybinds.set: shortcut #{index} is not an object"
        )));
    };
    let key = match obj.get("key").and_then(Value::as_str) {
        Some(k) if !k.is_empty() => k,
        _ => {
            return Err(invalid(format!(
                "keybinds.set: shortcut #{index} missing string \"key\""
            )))
        }
    };
    let scope = match obj.get("scope").and_then(Value::as_str) {
        Some(sc @ ("global" | "body")) => sc,
        _ => {
            return Err(invalid(format!(
                "keybinds.set: shortcut #{index} scope must be \"global\" or \"body\""
            )))
        }
    };
    let mut out = vec![
        ("key".to_string(), J5::Str(key.into())),
        ("scope".to_string(), J5::Str(scope.into())),
    ];
    for flag in ["ctrl", "shift", "alt"] {
        if obj.get(flag).and_then(Value::as_bool) == Some(true) {
            out.push((flag.to_string(), J5::Bool(true)));
        }
    }
    Ok(J5::Obj(out))
}

fn parse_shortcuts(input: Option<&Value>) -> Result<J5> {
    let Some(arr) = input.and_then(Value::as_array) else {
        return Err(invalid("keybinds.set: shortcuts must be an array".into()));
    };
    Ok(J5::Arr(
        arr.iter()
            .enumerate()
            .map(|(i, v)| parse_shortcut(v, i))
            .collect::<Result<Vec<_>>>()?,
    ))
}

pub fn list(core: &Core) -> Result<Value> {
    let overrides = keybinds::load_overrides(core)?;
    Ok(Value::Array(
        keybinds::default_command_ids()
            .iter()
            .map(|id| {
                let customized = overrides.get(id).is_some();
                let shortcuts = overrides
                    .get(id)
                    .map(J5::to_value)
                    .unwrap_or_else(|| keybinds::default_shortcuts(id));
                json!({
                    "commandId": id,
                    "shortcuts": shortcuts,
                    "default": keybinds::default_shortcuts(id),
                    "customized": customized,
                })
            })
            .collect(),
    ))
}

pub fn set(core: &Core, p: &Value) -> Result<Value> {
    let command_id = s(p, "commandId");
    if command_id.is_empty() {
        return Err(invalid("keybinds.set: commandId is required".into()));
    }
    let shortcuts = parse_shortcuts(p.get("shortcuts"))?;
    let count = shortcuts.as_arr().map(|a| a.len()).unwrap_or(0);
    keybinds::set_shortcuts(core, command_id, shortcuts)?;
    Ok(json!({ "commandId": command_id, "count": count }))
}

pub fn reset(core: &Core, p: &Value) -> Result<Value> {
    let command_id = s(p, "commandId");
    if command_id.is_empty() {
        return Err(invalid("keybinds.reset: commandId is required".into()));
    }
    keybinds::reset(core, command_id)?;
    Ok(json!({ "commandId": command_id, "reset": true }))
}

pub fn reset_all(core: &Core) -> Result<Value> {
    keybinds::reset_all(core)?;
    Ok(json!({ "reset": true }))
}

pub fn preview(id: &str, p: &Value, _ctx: &ExecContext) -> Option<Value> {
    Some(match id {
        "keybinds.set" => {
            let count = p
                .get("shortcuts")
                .and_then(Value::as_array)
                .map(|a| a.len())
                .unwrap_or(0);
            confirm(
                "warning",
                text("_native.preview.keybinds.set.title", json!({})),
                Some(text(
                    "_native.preview.keybinds.set.message_plural",
                    json!({ "commandId": s(p, "commandId"), "count": count }),
                )),
                text("_native.preview.keybinds.set.ok", json!({})),
                json!({
                    "code": serde_json::to_string_pretty(p.get("shortcuts").unwrap_or(&json!([]))).unwrap_or_default(),
                    "codeLanguage": "json",
                }),
            )
        }
        "keybinds.reset" => confirm(
            "normal",
            text("_native.preview.keybinds.reset.title", json!({})),
            Some(text(
                "_native.preview.keybinds.reset.message",
                json!({ "commandId": s(p, "commandId") }),
            )),
            text("_native.preview.common.resetToDefault", json!({})),
            json!({}),
        ),
        "keybinds.resetAll" => confirm(
            "warning",
            text("_native.preview.keybinds.resetAll.title", json!({})),
            Some(text("_native.preview.keybinds.resetAll.message", json!({}))),
            text("_native.preview.common.resetAllToDefault", json!({})),
            json!({}),
        ),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_validates_and_lists_like_ts() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        std::fs::create_dir_all(crate::commands::settings::settings_base_dir(&core).unwrap())
            .unwrap();
        let ctx = ExecContext::default();
        assert!(set(&core, &json!({}))
            .unwrap_err()
            .to_string()
            .contains("commandId is required"));
        assert!(set(&core, &json!({"commandId": "search", "shortcuts": 1}))
            .unwrap_err()
            .to_string()
            .contains("shortcuts must be an array"));
        assert!(
            set(&core, &json!({"commandId": "search", "shortcuts": [1]}))
                .unwrap_err()
                .to_string()
                .contains("shortcut #0 is not an object")
        );
        assert!(set(
            &core,
            &json!({"commandId": "search", "shortcuts": [{"scope": "body"}]})
        )
        .unwrap_err()
        .to_string()
        .contains("missing string \"key\""));
        assert!(set(
            &core,
            &json!({"commandId": "search", "shortcuts": [{"key": "j", "scope": "x"}]})
        )
        .unwrap_err()
        .to_string()
        .contains("scope must be \"global\" or \"body\""));
        let r = set(
            &core,
            &json!({"commandId": "search", "shortcuts": [{"key": "j", "scope": "body", "ctrl": true, "shift": false, "extra": 1}]}),
        )
        .unwrap();
        assert_eq!(r, json!({ "commandId": "search", "count": 1 }));
        let l = list(&core).unwrap();
        let search = l
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["commandId"] == "search")
            .unwrap();
        assert_eq!(search["customized"], true);
        assert_eq!(
            search["shortcuts"],
            json!([{ "key": "j", "scope": "body", "ctrl": true }])
        );
        assert!(!search["default"].as_array().unwrap().is_empty());
        let pv = preview(
            "keybinds.set",
            &json!({"commandId": "search", "shortcuts": [{"key": "j"}]}),
            &ctx,
        )
        .unwrap();
        assert_eq!(pv["title"], "Change keybinding");
        assert_eq!(
            pv["message"],
            "Sets 1 shortcut for `search`. keybinds.reset restores the default."
        );
        assert_eq!(pv["i18n"]["message"]["params"]["count"], 1);
        assert_eq!(
            reset(&core, &json!({"commandId": "search"})).unwrap()["reset"],
            true
        );
        assert_eq!(reset_all(&core).unwrap()["reset"], true);
        let pv = preview("keybinds.resetAll", &json!({}), &ctx).unwrap();
        assert_eq!(pv["okLabel"], "Reset all to default");
    }
}
