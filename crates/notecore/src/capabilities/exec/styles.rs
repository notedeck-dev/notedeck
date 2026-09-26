//! カスタム CSS 系 capability (`styles.*`)。本体は `crate::themes` の css 関数。
//! 画面への注入はデバイスに残る (変更通知で追従)。

use serde_json::{json, Value};

use super::{staged, ExecContext};
use crate::context::Core;
use crate::edit_history::Attribution;
use crate::error::Result;
use crate::skills::append_block;
use crate::themes;
use notecli::error::NoteDeckError;

fn s<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or("")
}

fn attribution(ctx: &ExecContext, p: &Value) -> Attribution {
    let mut by = json!({ "kind": ctx.principal });
    if let Some(pid) = ctx.plugin_id.as_deref().filter(|s| !s.is_empty()) {
        by["pluginId"] = Value::String(pid.to_string());
    }
    Attribution {
        by: Some(by),
        reason: Some(s(p, "reason").trim().to_string()).filter(|r| !r.is_empty()),
    }
}

fn len_of(text: &str) -> usize {
    text.chars().count()
}

pub fn read(core: &Core) -> Result<Value> {
    let body = themes::read_css(core)?;
    Ok(json!({ "body": body, "length": len_of(&body) }))
}

pub fn history(core: &Core) -> Result<Value> {
    Ok(serde_json::to_value(themes::css_history(core)?)?)
}

pub fn write(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let body = s(p, "body").to_string();
    let cur = themes::read_css(core)?;
    let key = staged::key("styles.write", ctx, p);
    let next = staged::take_or("styles.write", &key, &cur, || body.clone())?;
    themes::write_css(core, &next, Some(&attribution(ctx, p)))?;
    Ok(json!({ "length": len_of(&next) }))
}

pub fn append(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let content = s(p, "content");
    if content.is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "styles.append: content is required".into(),
        ));
    }
    let cur = themes::read_css(core)?;
    let key = staged::key("styles.append", ctx, p);
    let next = staged::take_or("styles.append", &key, &cur, || append_block(&cur, content))?;
    themes::write_css(core, &next, Some(&attribution(ctx, p)))?;
    Ok(json!({ "length": len_of(&next) }))
}

fn index_of(p: &Value) -> i64 {
    p.get("index").and_then(Value::as_i64).unwrap_or(-1)
}

pub fn revert(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let index = index_of(p);
    if index < 0 {
        return Err(NoteDeckError::InvalidInput(
            "styles.revert: index must be >= 0".into(),
        ));
    }
    let entries = themes::css_history(core)?;
    let Some(entry) = entries.get(index as usize) else {
        return Err(NoteDeckError::InvalidInput(format!(
            "styles.revert: no snapshot at index {index}"
        )));
    };
    let body = entry
        .snapshot
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let cur = themes::read_css(core)?;
    let key = staged::key("styles.revert", ctx, p);
    let next = staged::take_or("styles.revert", &key, &cur, || body.clone())?;
    themes::write_css(core, &next, Some(&attribution(ctx, p)))?;
    Ok(json!({ "reverted": true, "at": entry.at }))
}

pub fn preview(core: &Core, id: &str, p: &Value, ctx: &ExecContext) -> Result<Option<Value>> {
    let cur = themes::read_css(core)?;
    Ok(match id {
        "styles.write" => {
            let body = s(p, "body").to_string();
            let next = staged::stage(staged::key(id, ctx, p), &cur, body.clone());
            Some(json!({
                "title": "カスタム CSS を全置換",
                "message": format!("custom.css の内容を {} 文字に全置換します。 現在の CSS は履歴に保存され、styles.revert で戻せます。", len_of(&body)),
                "diff": { "old": cur, "new": next, "language": "css" },
                "okLabel": "上書き",
                "cancelLabel": "やめる",
                "type": "warning",
            }))
        }
        "styles.append" => {
            let content = s(p, "content");
            let next = staged::stage(staged::key(id, ctx, p), &cur, append_block(&cur, content));
            Some(json!({
                "title": "カスタム CSS に追記",
                "message": format!("custom.css の末尾に {} 文字を追記します。 既存ルールは保持されます。", len_of(content)),
                "diff": { "old": cur, "new": next, "language": "css" },
                "okLabel": "追記",
                "cancelLabel": "やめる",
                "type": "normal",
            }))
        }
        "styles.revert" => {
            let index = index_of(p);
            if index < 0 {
                return Ok(None);
            }
            let entries = themes::css_history(core)?;
            let Some(entry) = entries.get(index as usize) else {
                return Ok(None);
            };
            let body = entry
                .snapshot
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let next = staged::stage(staged::key(id, ctx, p), &cur, body);
            Some(json!({
                "title": "カスタム CSS を過去の状態に戻す",
                "message": format!(
                    "custom.css を編集履歴 #{index} ({}) の状態に戻します。 現在の CSS は上書きされます (戻す操作自体も履歴に残ります)。",
                    super::time::iso_from_unix_ms(entry.at as i64)
                ),
                "diff": { "old": cur, "new": next, "language": "css" },
                "okLabel": "この状態に戻す",
                "cancelLabel": "やめる",
                "type": "warning",
            }))
        }
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_append_revert_follow_ts_rules() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        std::fs::create_dir_all(crate::commands::settings::settings_base_dir(&core).unwrap())
            .unwrap();
        let ctx = ExecContext {
            principal: "ai.chat".into(),
            ..Default::default()
        };
        assert_eq!(read(&core).unwrap()["length"], 0);
        // write は body が空でも通る (全消去)
        assert_eq!(
            write(&core, &json!({"body": ".old { color: blue; }"}), &ctx).unwrap()["length"],
            21
        );
        let pv = preview(
            &core,
            "styles.append",
            &json!({"content": "body { margin: 0; }"}),
            &ctx,
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            pv["diff"]["new"],
            ".old { color: blue; }\nbody { margin: 0; }"
        );
        assert_eq!(pv["type"], "normal");
        assert!(append(&core, &json!({}), &ctx)
            .unwrap_err()
            .to_string()
            .contains("content is required"));
        append(&core, &json!({"content": "body { margin: 0; }"}), &ctx).unwrap();
        // 確認後に内容が変わっていれば中止
        let p = json!({"content": "x"});
        preview(&core, "styles.append", &p, &ctx).unwrap();
        themes::write_css(&core, "changed", None).unwrap();
        assert!(append(&core, &p, &ctx)
            .unwrap_err()
            .to_string()
            .contains("確認後に対象が変更された"));
        // revert
        assert!(preview(&core, "styles.revert", &json!({}), &ctx)
            .unwrap()
            .is_none());
        assert!(revert(&core, &json!({"index": -1}), &ctx)
            .unwrap_err()
            .to_string()
            .contains("must be >= 0"));
        let h = history(&core).unwrap();
        assert!(h.as_array().unwrap().len() >= 2);
        let rv = revert(&core, &json!({"index": 0}), &ctx).unwrap();
        assert_eq!(rv["reverted"], true);
        assert_eq!(
            read(&core).unwrap()["body"],
            ".old { color: blue; }\nbody { margin: 0; }"
        );
    }
}
