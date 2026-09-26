//! カラムクエリの編集履歴 capability (`queries.*`、#1117)。本体は
//! `crate::sidecar::queries`。作成・編集は開発者モードのエディタ (デバイス) が担う。

use serde_json::{json, Value};

use super::{staged, ExecContext};
use crate::context::Core;
use crate::edit_history::{Attribution, HistoryEntry};
use crate::error::Result;
use crate::sidecar::queries::{self, QueryView};
use crate::sidecar::Item;
use notecli::error::NoteDeckError;

fn s<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or("")
}

fn invalid(msg: String) -> NoteDeckError {
    NoteDeckError::InvalidInput(msg)
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

fn index_of(p: &Value) -> i64 {
    p.get("index").and_then(Value::as_i64).unwrap_or(-1)
}

fn require(core: &Core, capability: &str, p: &Value) -> Result<Item> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid(format!("{capability}: id is required")));
    }
    queries::get(core, id)?
        .ok_or_else(|| invalid(format!("{capability}: query \"{id}\" not found")))
}

fn history_of(core: &Core, item: &Item) -> Result<Vec<HistoryEntry>> {
    Ok(queries::history(&crate::sidecar::base_dir(core)?, item))
}

pub fn history(core: &Core, p: &Value) -> Result<Value> {
    let q = require(core, "queries.history", p)?;
    Ok(serde_json::to_value(history_of(core, &q)?)?)
}

pub fn revert(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = s(p, "id");
    let index = index_of(p);
    if id.is_empty() {
        return Err(invalid("queries.revert: id is required".into()));
    }
    if index < 0 {
        return Err(invalid("queries.revert: index must be >= 0".into()));
    }
    let mut q = require(core, "queries.revert", p)?;
    let entries = history_of(core, &q)?;
    let Some(entry) = entries.get(index as usize) else {
        return Err(invalid(format!(
            "queries.revert: no snapshot at index {index}"
        )));
    };
    let snap_src = s(&entry.snapshot, "src").to_string();
    let key = staged::key("queries.revert", ctx, p);
    let next = staged::take_or("queries.revert", &key, &q.src, || snap_src)?;
    q.ensure_writable("queries.revert")?;
    queries::update_src(core, &mut q, &next, Some(&attribution(ctx, p)))?;
    Ok(json!({ "id": q.id, "reverted": true, "at": entry.at }))
}

pub fn preview(core: &Core, id: &str, p: &Value, ctx: &ExecContext) -> Result<Option<Value>> {
    if id != "queries.revert" {
        return Ok(None);
    }
    let index = index_of(p);
    let Some(cur) = queries::get(core, s(p, "id"))? else {
        return Ok(None);
    };
    if index < 0 {
        return Ok(None);
    }
    let entries = history_of(core, &cur)?;
    let Some(entry) = entries.get(index as usize) else {
        return Ok(None);
    };
    let next = staged::stage(
        staged::key(id, ctx, p),
        &cur.src,
        s(&entry.snapshot, "src").to_string(),
    );
    Ok(Some(json!({
        "title": "クエリを過去の状態に戻す",
        "message": format!(
            "{} を編集履歴 #{index} ({}) の状態に戻します。現在のソースは上書きされます。",
            cur.name(),
            super::time::iso_from_unix_ms(entry.at as i64)
        ),
        "diff": { "old": cur.src, "new": next, "language": "aiscript" },
        "okLabel": "この状態に戻す",
        "cancelLabel": "やめる",
        "type": "warning",
    })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::tests::temp_core;

    #[test]
    fn revert_restores_src_and_records_history() {
        let (_d, core, base) = temp_core();
        std::fs::write(
            base.join("queries/a.meta.json5"),
            "{ id: 'a', name: 'a', createdAt: 1, updatedAt: 1 }",
        )
        .unwrap();
        std::fs::write(base.join("queries/a.is"), "before").unwrap();
        let ctx = ExecContext {
            principal: "user".into(),
            ..Default::default()
        };
        let mut q = queries::get(&core, "a").unwrap().unwrap();
        queries::update_src(&core, &mut q, "after", None).unwrap();
        assert!(history(&core, &json!({}))
            .unwrap_err()
            .to_string()
            .contains("id is required"));
        assert!(history(&core, &json!({"id": "zz"}))
            .unwrap_err()
            .to_string()
            .contains("query \"zz\" not found"));
        assert_eq!(
            history(&core, &json!({"id": "a"}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let pv = preview(
            &core,
            "queries.revert",
            &json!({"id": "a", "index": 0}),
            &ctx,
        )
        .unwrap()
        .unwrap();
        assert_eq!(pv["diff"]["old"], "after");
        let rv = revert(&core, &json!({"id": "a", "index": 0}), &ctx).unwrap();
        assert_eq!(rv["reverted"], true);
        assert_eq!(rv["id"], "a");
        assert_eq!(
            std::fs::read_to_string(base.join("queries/a.is")).unwrap(),
            "before"
        );
        assert_eq!(
            history(&core, &json!({"id": "a"}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        ); // 本人 (user) の 60 秒以内の連続保存は 1 件にまとまる
           // 読取専用は拒否
        std::fs::write(base.join("queries/o.meta.json5"), "{ id: 'o', name: 'o' }").unwrap();
        std::fs::write(
            base.join("queries/o.history.json5"),
            "{\"entries\":[{\"at\":1,\"snapshot\":{\"src\":\"x\"}}]}",
        )
        .unwrap();
        assert!(revert(&core, &json!({"id": "o", "index": 0}), &ctx)
            .unwrap_err()
            .to_string()
            .contains("queries.revert: ソースファイルが見つからないため変更できません"));
    }
}
