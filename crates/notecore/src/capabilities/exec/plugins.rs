//! プラグイン系 capability (`plugins.*`)。本体は `crate::sidecar::plugins`。
//! `plugins.create` / `plugins.update` は AiScript の構文検証 (preflight) が
//! デバイスにしか無いのでデバイスに残る。起動 / 停止はデバイスが変更通知で行う。

use serde_json::{json, Value};

use super::misstore::{
    ensure_approved_hash, fetch_verified_source, registry_entry, update_confirm_message,
};
use super::preview::confirm;
use super::{staged, ExecContext};
use crate::context::Core;
use crate::edit_history::{Attribution, HistoryEntry};
use crate::error::Result;
use crate::i18n::{localize_fields, text};
use crate::sidecar::plugin_meta::parse_plugin_meta;
use crate::sidecar::plugins::{self, PluginView};
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
    let id = s(p, "installId");
    if id.is_empty() {
        return Err(invalid(format!("{capability}: installId is required")));
    }
    plugins::get(core, id)?
        .ok_or_else(|| invalid(format!("{capability}: plugin \"{id}\" not found")))
}

fn history_of(core: &Core, item: &Item) -> Result<Vec<HistoryEntry>> {
    Ok(plugins::history(&crate::sidecar::base_dir(core)?, item))
}

fn install_preview(item: &Item) -> Value {
    let mut v = json!({
        "kind": "plugin",
        "name": item.name(),
        "version": item.version(),
        "permissions": item.permissions(),
    });
    if let Some(a) = item.author() {
        v["author"] = json!(a);
    }
    if let Some(d) = item.description() {
        v["description"] = json!(d);
    }
    v
}

// --- 読取 ---

pub fn list(core: &Core) -> Result<Value> {
    Ok(Value::Array(
        plugins::list(core)?
            .iter()
            .map(|p| {
                json!({
                    "installId": p.id,
                    "name": p.name(),
                    "version": p.version(),
                    "author": p.author(),
                    "description": p.description(),
                    "active": p.active(),
                    "permissions": p.permissions(),
                    "storeId": p.store_id(),
                })
            })
            .collect(),
    ))
}

pub fn read(core: &Core, p: &Value) -> Result<Value> {
    let item = require(core, "plugins.read", p)?;
    Ok(json!({
        "installId": item.id,
        "name": item.name(),
        "version": item.version(),
        "src": item.src,
        "active": item.active(),
        "permissions": item.permissions(),
        "configData": item.config_data(),
    }))
}

pub fn history(core: &Core, p: &Value) -> Result<Value> {
    let item = require(core, "plugins.history", p)?;
    Ok(serde_json::to_value(history_of(core, &item)?)?)
}

// --- 書込 ---

pub fn set_active(core: &Core, p: &Value) -> Result<Value> {
    let mut item = require(core, "plugins.setActive", p)?;
    let active = p.get("active").and_then(Value::as_bool) == Some(true);
    item.ensure_writable("plugins.setActive")?;
    plugins::set_active(core, &mut item, active)?;
    Ok(json!({ "installId": item.id, "active": active }))
}

pub fn delete(core: &Core, p: &Value) -> Result<Value> {
    let id = s(p, "installId");
    if id.is_empty() {
        return Err(invalid("plugins.delete: installId is required".into()));
    }
    let existed = plugins::get(core, id)?;
    if let Some(item) = &existed {
        plugins::remove(core, item)?;
    }
    Ok(json!({ "installId": id, "removed": existed.is_some() }))
}

pub fn revert(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = s(p, "installId");
    let index = index_of(p);
    if id.is_empty() {
        return Err(invalid("plugins.revert: installId is required".into()));
    }
    if index < 0 {
        return Err(invalid("plugins.revert: index must be >= 0".into()));
    }
    let mut item = require(core, "plugins.revert", p)?;
    let entries = history_of(core, &item)?;
    let Some(entry) = entries.get(index as usize) else {
        return Err(invalid(format!(
            "plugins.revert: no snapshot at index {index}"
        )));
    };
    item.ensure_writable("plugins.revert")?;
    let snap_src = s(&entry.snapshot, "src").to_string();
    let key = staged::key("plugins.revert", ctx, p);
    let next = staged::take_or("plugins.revert", &key, &item.src, || snap_src)?;
    plugins::update_src(core, &mut item, &next, Some(&attribution(ctx, p)))?;
    Ok(json!({ "installId": item.id, "reverted": true, "at": entry.at }))
}

fn find_target(core: &Core, p: &Value) -> Result<Option<Item>> {
    let install_id = s(p, "installId");
    let store_id = s(p, "storeId");
    if !install_id.is_empty() {
        plugins::get(core, install_id)
    } else {
        plugins::find_by_store_id(core, store_id)
    }
}

pub fn uninstall(core: &Core, p: &Value) -> Result<Value> {
    let install_id = s(p, "installId");
    let store_id = s(p, "storeId");
    if install_id.is_empty() && store_id.is_empty() {
        return Err(invalid(
            "plugins.uninstall: installId or storeId is required".into(),
        ));
    }
    let Some(item) = find_target(core, p)? else {
        return Err(invalid(format!(
            "plugins.uninstall: plugin not found (installId=\"{install_id}\" storeId=\"{store_id}\")"
        )));
    };
    plugins::remove(core, &item)?;
    Ok(json!({ "installId": item.id, "removed": true }))
}

// --- MisStore ---

/// `installPlugin(entry, {kind: 'global'})`: 既存 (同じ storeId) があればソースが
/// 変わったときだけ本体を更新し、全体スコープに入れる。無ければ新規 (active=true)。
pub async fn install(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid("plugins.install: id is required".into()));
    }
    let Some(entry) = registry_entry(core, "plugins", id).await? else {
        return Err(invalid(format!(
            "plugins.install: plugin \"{id}\" not found in MisStore (try misstore.search first)"
        )));
    };
    let (source, hash) = fetch_verified_source(core, &entry).await?;
    let Some(meta) = parse_plugin_meta(&source) else {
        return Err(invalid("failed to parse the plugin metadata".into()));
    };
    let icon = Some(s(&entry, "iconUrl")).filter(|u| !u.is_empty());
    if let Some(mut existing) = plugins::find_by_store_id(core, id)? {
        if existing.store_sha512() != Some(hash.as_str()) {
            let key = staged::key("plugins.install", ctx, p);
            ensure_approved_hash("plugins.install", &key, &existing.src, &hash)?;
            plugins::apply_store_update(
                core,
                &mut existing,
                &source,
                &meta,
                icon,
                &hash,
                s(&entry, "version"),
            )?;
        }
        if !existing.read_only {
            plugins::link_global(core, &mut existing)?;
        }
    } else {
        plugins::install_new(core, id, s(&entry, "version"), icon, &source, &meta, &hash)?;
    }
    Ok(json!({ "id": s(&entry, "id"), "name": s(&entry, "name"), "installed": true }))
}

// --- 確認内容 ---

pub async fn preview(core: &Core, id: &str, p: &Value, ctx: &ExecContext) -> Result<Option<Value>> {
    Ok(match id {
        "plugins.setActive" => {
            if p.get("active").and_then(Value::as_bool) != Some(true) {
                return Ok(None);
            }
            let Some(cur) = plugins::get(core, s(p, "installId"))? else {
                return Ok(None);
            };
            Some(confirm(
                "warning",
                text("_native.preview.plugins.setActive.title", json!({})),
                Some(text(
                    "_native.preview.plugins.setActive.message",
                    json!({ "name": cur.name() }),
                )),
                text("_native.preview.plugins.setActive.ok", json!({})),
                json!({ "installPreview": install_preview(&cur) }),
            ))
        }
        "plugins.delete" | "plugins.uninstall" => {
            let cur = if id == "plugins.delete" {
                plugins::get(core, s(p, "installId"))?
            } else {
                find_target(core, p)?
            };
            let Some(cur) = cur else {
                return Ok(None);
            };
            Some(confirm(
                "danger",
                text("_native.preview.plugins.delete.title", json!({})),
                Some(text(
                    "_native.preview.plugins.delete.message",
                    json!({ "name": cur.name() }),
                )),
                text("_native.preview.plugins.delete.ok", json!({})),
                json!({ "installPreview": install_preview(&cur) }),
            ))
        }
        "plugins.revert" => {
            let index = index_of(p);
            let Some(cur) = plugins::get(core, s(p, "installId"))? else {
                return Ok(None);
            };
            if index < 0 {
                return Ok(None);
            }
            let entries = history_of(core, &cur)?;
            let Some(entry) = entries.get(index as usize) else {
                return Ok(None);
            };
            let snap = &entry.snapshot;
            let next = staged::stage(
                staged::key(id, ctx, p),
                &cur.src,
                s(snap, "src").to_string(),
            );
            let mut pv = install_preview(&cur);
            if let Some(n) = snap.get("name").and_then(Value::as_str) {
                pv["name"] = json!(n);
            }
            if let Some(v) = snap.get("version").and_then(Value::as_str) {
                pv["version"] = json!(v);
            }
            if let Some(perms) = snap.get("permissions") {
                pv["permissions"] = perms.clone();
            }
            Some(confirm(
                "warning",
                text("_native.preview.plugins.revert.title", json!({})),
                Some(text(
                    "_native.preview.plugins.revert.message",
                    json!({
                        "name": cur.name(),
                        "index": index,
                        "at": super::time::iso_from_unix_ms(entry.at as i64),
                    }),
                )),
                text("_native.preview.plugins.revert.ok", json!({})),
                json!({
                    "installPreview": pv,
                    "diff": { "old": cur.src, "new": next, "language": "aiscript" },
                }),
            ))
        }
        "plugins.install" => {
            let pid = s(p, "id");
            if pid.is_empty() {
                return Ok(None);
            }
            let Some(entry) = registry_entry(core, "plugins", pid).await? else {
                return Ok(None);
            };
            let existing = plugins::find_by_store_id(core, pid)?;
            let (title, ok) = if existing.is_some() {
                (
                    "_native.preview.plugins.install.titleUpdate",
                    "_native.preview.plugins.install.okUpdate",
                )
            } else {
                (
                    "_native.preview.plugins.install.titleNew",
                    "_native.preview.plugins.install.okNew",
                )
            };
            let mut out = confirm(
                "normal",
                text(title, json!({})),
                Some(text(
                    "_native.preview.plugins.install.message",
                    json!({
                        "name": s(&entry, "name"),
                        "version": s(&entry, "version"),
                        "author": s(&entry, "author"),
                    }),
                )),
                text(ok, json!({})),
                json!({
                    "installPreview": {
                        "kind": "plugin",
                        "name": s(&entry, "name"),
                        "version": s(&entry, "version"),
                        "author": s(&entry, "author"),
                        "description": s(&entry, "description"),
                    },
                    "code": s(&entry, "description"),
                    "codeLanguage": "plaintext",
                }),
            );
            if let Some(cur) = existing {
                // 既存の更新: 本文の diff と新しい権限を 1 枚目に載せる (移設前は 2 枚目の確認)
                let mut message = update_confirm_message(&cur.name(), &entry, &[]);
                if let Ok((source, hash)) = fetch_verified_source(core, &entry).await {
                    if cur.store_sha512() == Some(hash.as_str()) {
                        message = text(
                            "_native.preview.plugins.install.upToDate",
                            json!({ "name": cur.name() }),
                        );
                    } else {
                        if let Some(meta) = parse_plugin_meta(&source) {
                            let before = cur.permissions();
                            let added: Vec<&str> = meta
                                .permissions
                                .iter()
                                .flatten()
                                .filter(|x| !before.contains(x))
                                .map(String::as_str)
                                .collect();
                            if !added.is_empty() {
                                message = update_confirm_message(&cur.name(), &entry, &added);
                                out["type"] = json!("warning");
                            }
                        }
                        out["diff"] =
                            json!({ "old": cur.src, "new": source, "language": "aiscript" });
                        staged::stage(staged::key(id, ctx, p), &cur.src, hash);
                    }
                }
                localize_fields(&mut out, vec![("message", message)]);
            }
            Some(out)
        }
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::tests::temp_core;

    fn put(base: &std::path::Path, name: &str, body: &str) {
        std::fs::write(base.join("plugins").join(name), body).unwrap();
    }

    #[tokio::test]
    async fn read_write_and_revert_match_ts_rules() {
        let (_d, core, base) = temp_core();
        put(
            &base,
            "p.meta.json5",
            "{ installId: 'p', name: 'P', version: '1', permissions: ['a'], configData: { k: 1 } }",
        );
        put(&base, "p.is", "let x = 1");
        let ctx = ExecContext {
            principal: "ai.chat".into(),
            ..Default::default()
        };
        assert!(read(&core, &json!({}))
            .unwrap_err()
            .to_string()
            .contains("installId is required"));
        assert!(read(&core, &json!({"installId": "nope"}))
            .unwrap_err()
            .to_string()
            .contains("plugin \"nope\" not found"));
        let r = read(&core, &json!({"installId": "p"})).unwrap();
        assert_eq!(r["src"], "let x = 1");
        assert_eq!(r["active"], false);
        assert_eq!(r["configData"], json!({ "k": 1 }));
        let l = list(&core).unwrap();
        assert_eq!(l[0]["author"], Value::Null);
        assert_eq!(l[0]["storeId"], Value::Null);
        assert_eq!(l[0]["permissions"], json!(["a"]));
        // setActive: 無効化は確認なし、有効化は確認あり
        assert!(preview(
            &core,
            "plugins.setActive",
            &json!({"installId": "p", "active": false}),
            &ctx
        )
        .await
        .unwrap()
        .is_none());
        let pv = preview(
            &core,
            "plugins.setActive",
            &json!({"installId": "p", "active": true}),
            &ctx,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(pv["installPreview"]["permissions"], json!(["a"]));
        assert!(pv["installPreview"].get("author").is_none());
        assert_eq!(
            set_active(&core, &json!({"installId": "p", "active": true})).unwrap()["active"],
            true
        );
        assert!(read(&core, &json!({"installId": "p"})).unwrap()["active"]
            .as_bool()
            .unwrap());
        // 履歴と revert (確認後に変わっていれば中止)
        let mut item = plugins::get(&core, "p").unwrap().unwrap();
        plugins::update_src(&core, &mut item, "let y = 2", None).unwrap();
        assert_eq!(
            history(&core, &json!({"installId": "p"}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let pv = preview(
            &core,
            "plugins.revert",
            &json!({"installId": "p", "index": 0}),
            &ctx,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            pv["diff"],
            json!({ "old": "let y = 2", "new": "let x = 1", "language": "aiscript" })
        );
        let mut item = plugins::get(&core, "p").unwrap().unwrap();
        plugins::update_src(&core, &mut item, "let z = 3", None).unwrap();
        assert!(revert(&core, &json!({"installId": "p", "index": 0}), &ctx)
            .unwrap_err()
            .to_string()
            .contains("changed after confirmation"));
        assert!(revert(&core, &json!({"installId": "p", "index": -1}), &ctx)
            .unwrap_err()
            .to_string()
            .contains("must be >= 0"));
        assert!(revert(&core, &json!({"installId": "p", "index": 99}), &ctx)
            .unwrap_err()
            .to_string()
            .contains("no snapshot at index 99"));
        let rv = revert(&core, &json!({"installId": "p", "index": 0}), &ctx).unwrap();
        assert_eq!(rv["reverted"], true);
        assert_eq!(
            read(&core, &json!({"installId": "p"})).unwrap()["src"],
            "let x = 1"
        );
        // delete / uninstall
        assert_eq!(
            delete(&core, &json!({"installId": "p"})).unwrap()["removed"],
            true
        );
        assert_eq!(
            delete(&core, &json!({"installId": "p"})).unwrap()["removed"],
            false
        );
        assert!(uninstall(&core, &json!({}))
            .unwrap_err()
            .to_string()
            .contains("installId or storeId is required"));
        put(
            &base,
            "s.meta.json5",
            "{ installId: 's', name: 'S', version: '1', storeId: 'store-s' }",
        );
        put(&base, "s.is", "");
        assert!(preview(
            &core,
            "plugins.uninstall",
            &json!({"storeId": "store-s"}),
            &ctx
        )
        .await
        .unwrap()
        .is_some());
        assert_eq!(
            uninstall(&core, &json!({"storeId": "store-s"})).unwrap()["installId"],
            "s"
        );
        assert!(uninstall(&core, &json!({"storeId": "store-s"}))
            .unwrap_err()
            .to_string()
            .contains("plugin not found (installId=\"\" storeId=\"store-s\")"));
    }

    #[test]
    fn read_only_items_reject_writes() {
        let (_d, core, base) = temp_core();
        put(
            &base,
            "o.meta.json5",
            "{ installId: 'o', name: 'O', version: '1' }",
        );
        assert!(
            set_active(&core, &json!({"installId": "o", "active": true}))
                .unwrap_err()
                .to_string()
                .contains(crate::sidecar::READ_ONLY_REASON)
        );
        assert!(!base.join("plugins/o.is").exists());
    }
}
