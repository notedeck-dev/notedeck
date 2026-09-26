//! ウィジェット系 capability (`widgets.*`)。本体は `crate::sidecar::widgets`。
//! `widgets.create` / `widgets.update` は AiScript の構文検証 (preflight) が
//! デバイスにしか無いのでデバイスに残る。表示中の再実行はデバイスが変更通知で行う。

use serde_json::{json, Value};

use super::misstore::{
    ensure_approved_hash, fetch_verified_source, registry_entry, update_confirm_message,
};
use super::{staged, ExecContext};
use crate::context::Core;
use crate::edit_history::{Attribution, HistoryEntry};
use crate::error::Result;
use crate::sidecar::widgets::{self, WidgetView};
use crate::sidecar::Item;
use notecli::error::NoteDeckError;
use notecli::models::AccountPublic;

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
    widgets::get(core, id)?
        .ok_or_else(|| invalid(format!("{capability}: widget \"{id}\" not found")))
}

fn history_of(core: &Core, item: &Item) -> Result<Vec<HistoryEntry>> {
    Ok(widgets::history(&crate::sidecar::base_dir(core)?, item))
}

async fn accounts(core: &Core) -> Result<Vec<AccountPublic>> {
    core.blocking(crate::account_service::list_public).await
}

fn scope_key(a: &AccountPublic) -> String {
    format!("{}:{}", a.host, a.user_id)
}

// --- 読取 ---

pub async fn list(core: &Core) -> Result<Value> {
    let items = widgets::list(core)?;
    let accounts = if items.iter().any(|w| w.account_key().is_some()) {
        accounts(core).await?
    } else {
        Vec::new()
    };
    Ok(Value::Array(
        items
            .iter()
            .map(|w| {
                let account_id = w
                    .account_key()
                    .and_then(|k| accounts.iter().find(|a| scope_key(a) == k))
                    .map(|a| a.id.clone());
                json!({
                    "installId": w.id,
                    "name": w.name(),
                    "autoRun": w.auto_run(),
                    "storeId": w.store_id(),
                    "accountId": account_id,
                    "updatedAt": w.updated_at(),
                })
            })
            .collect(),
    ))
}

pub fn read(core: &Core, p: &Value) -> Result<Value> {
    let w = require(core, "widgets.read", p)?;
    Ok(json!({ "installId": w.id, "name": w.name(), "src": w.src, "autoRun": w.auto_run() }))
}

pub fn history(core: &Core, p: &Value) -> Result<Value> {
    let w = require(core, "widgets.history", p)?;
    Ok(serde_json::to_value(history_of(core, &w)?)?)
}

// --- 書込 ---

pub fn set_auto_run(core: &Core, p: &Value) -> Result<Value> {
    let mut w = require(core, "widgets.setAutoRun", p)?;
    let auto_run = p.get("autoRun").and_then(Value::as_bool) == Some(true);
    w.ensure_writable("widgets.setAutoRun")?;
    widgets::set_auto_run(core, &mut w, auto_run)?;
    Ok(json!({ "installId": w.id, "autoRun": auto_run }))
}

pub fn delete(core: &Core, p: &Value) -> Result<Value> {
    let id = s(p, "installId");
    if id.is_empty() {
        return Err(invalid("widgets.delete: installId is required".into()));
    }
    let existed = widgets::get(core, id)?;
    if let Some(w) = &existed {
        widgets::remove(core, w)?;
    }
    Ok(json!({ "installId": id, "removed": existed.is_some() }))
}

pub fn revert(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = s(p, "installId");
    let index = index_of(p);
    if id.is_empty() {
        return Err(invalid("widgets.revert: installId is required".into()));
    }
    if index < 0 {
        return Err(invalid("widgets.revert: index must be >= 0".into()));
    }
    let mut w = require(core, "widgets.revert", p)?;
    let entries = history_of(core, &w)?;
    let Some(entry) = entries.get(index as usize) else {
        return Err(invalid(format!(
            "widgets.revert: no snapshot at index {index}"
        )));
    };
    w.ensure_writable("widgets.revert")?;
    let snap_src = s(&entry.snapshot, "src").to_string();
    let key = staged::key("widgets.revert", ctx, p);
    let next = staged::take_or("widgets.revert", &key, &w.src, || snap_src)?;
    widgets::update_src(core, &mut w, &next, Some(&attribution(ctx, p)))?;
    Ok(json!({ "installId": w.id, "reverted": true, "at": entry.at }))
}

/// installId 指定はその 1 件、storeId 指定は実行アカウント別の全個体 (#1061)。
fn targets(core: &Core, p: &Value) -> Result<Vec<Item>> {
    let install_id = s(p, "installId");
    let store_id = s(p, "storeId");
    let all = widgets::list(core)?;
    Ok(if !install_id.is_empty() {
        all.into_iter().filter(|w| w.id == install_id).collect()
    } else {
        all.into_iter()
            .filter(|w| w.store_id() == Some(store_id))
            .collect()
    })
}

pub fn uninstall(core: &Core, p: &Value) -> Result<Value> {
    let install_id = s(p, "installId");
    let store_id = s(p, "storeId");
    if install_id.is_empty() && store_id.is_empty() {
        return Err(invalid(
            "widgets.uninstall: installId or storeId is required".into(),
        ));
    }
    let targets = targets(core, p)?;
    let Some(first) = targets.first() else {
        return Err(invalid(format!(
            "widgets.uninstall: widget not found (installId=\"{install_id}\" storeId=\"{store_id}\")"
        )));
    };
    for w in &targets {
        widgets::remove(core, w)?;
    }
    Ok(json!({
        "installId": first.id,
        "installIds": targets.iter().map(|w| w.id.clone()).collect::<Vec<_>>(),
        "removed": true,
    }))
}

// --- MisStore ---

/// `pickAccountId` + 安定キーへの解決。存在しない指定は取得前に弾く。
async fn account_key_of(core: &Core, capability: &str, p: &Value) -> Result<Option<String>> {
    let account_id = s(p, "accountId").trim();
    if account_id.is_empty() {
        return Ok(None);
    }
    let account = accounts(core)
        .await?
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| invalid(format!("{capability}: account \"{account_id}\" not found")))?;
    Ok(Some(scope_key(&account)))
}

fn installed(w: &Item) -> Value {
    json!({ "installId": w.id, "name": w.name(), "autoRun": w.auto_run(), "installed": true })
}

/// `installWidget(entry, accountKey)`: 同じ storeId × 実行アカウントの既存があれば
/// ソースが変わったときだけ更新、無ければ新規。
pub async fn install(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid("widgets.install: id is required".into()));
    }
    let account_key = account_key_of(core, "widgets.install", p).await?;
    let Some(entry) = registry_entry(core, "widgets", id).await? else {
        return Err(invalid(format!(
            "widgets.install: widget \"{id}\" not found in MisStore (try misstore.search first)"
        )));
    };
    let (source, hash) = fetch_verified_source(core, &entry).await?;
    let icon = Some(s(&entry, "iconUrl")).filter(|u| !u.is_empty());
    let all = widgets::list(core)?;
    if let Some(existing) = widgets::find_instance(&all, id, account_key.as_deref()) {
        let mut existing = existing.clone();
        if existing.src != source {
            let key = staged::key("widgets.install", ctx, p);
            ensure_approved_hash("widgets.install", &key, &existing.src, &hash)?;
            widgets::apply_store_update(
                core,
                &mut existing,
                &source,
                icon,
                &hash,
                s(&entry, "version"),
            )?;
        }
        return Ok(installed(&existing));
    }
    let w = widgets::install_new(
        core,
        id,
        s(&entry, "name"),
        s(&entry, "version"),
        entry
            .get("autoRun")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        icon,
        account_key.as_deref(),
        &source,
        &hash,
    )?;
    Ok(installed(&w))
}

// --- 確認内容 ---

fn install_preview(name: &str) -> Value {
    json!({ "kind": "widget", "name": name })
}

pub async fn preview(core: &Core, id: &str, p: &Value, ctx: &ExecContext) -> Result<Option<Value>> {
    Ok(match id {
        "widgets.delete" | "widgets.uninstall" => {
            let targets = if id == "widgets.delete" {
                widgets::get(core, s(p, "installId"))?
                    .into_iter()
                    .collect::<Vec<_>>()
            } else {
                targets(core, p)?
            };
            let Some(cur) = targets.first() else {
                return Ok(None);
            };
            let others = if targets.len() > 1 {
                format!(" ほか {} 件", targets.len() - 1)
            } else {
                String::new()
            };
            Some(json!({
                "title": "ウィジェットを削除",
                "message": format!("{}{others} を削除します。AiScript ソース・メタ・Mk:save 領域がすべて消えます (= 不可逆)。", cur.name()),
                "installPreview": install_preview(&cur.name()),
                "okLabel": "削除",
                "cancelLabel": "やめる",
                "type": "danger",
            }))
        }
        "widgets.revert" => {
            let index = index_of(p);
            let Some(cur) = widgets::get(core, s(p, "installId"))? else {
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
            let name = entry
                .snapshot
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| cur.name());
            Some(json!({
                "title": "ウィジェットを過去の状態に戻す",
                "message": format!(
                    "{} を編集履歴 #{index} ({}) の状態に戻します。現在の AiScript ソースは上書きされます。",
                    cur.name(),
                    super::time::iso_from_unix_ms(entry.at as i64)
                ),
                "installPreview": install_preview(&name),
                "diff": { "old": cur.src, "new": next, "language": "aiscript" },
                "okLabel": "この状態に戻す",
                "cancelLabel": "やめる",
                "type": "warning",
            }))
        }
        "widgets.install" => {
            let wid = s(p, "id");
            if wid.is_empty() {
                return Ok(None);
            }
            let Some(entry) = registry_entry(core, "widgets", wid).await? else {
                return Ok(None);
            };
            let auto_run = entry
                .get("autoRun")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut out = json!({
                "title": "MisStore からウィジェットを入れる",
                "message": format!(
                    "{} (v{} / by {}) を MisStore から取得します。{}",
                    s(&entry, "name"), s(&entry, "version"), s(&entry, "author"),
                    if auto_run { " カラム表示時に自動実行されます。" } else { " 自動実行は無効です (= 手動で起動)。" }
                ),
                "installPreview": {
                    "kind": "widget",
                    "name": s(&entry, "name"),
                    "version": s(&entry, "version"),
                    "author": s(&entry, "author"),
                    "description": s(&entry, "description"),
                },
                "code": s(&entry, "description"),
                "codeLanguage": "plaintext",
                "okLabel": "インストール",
                "cancelLabel": "やめる",
                "type": "normal",
            });
            // 既存 (同じ storeId × 実行アカウント) の更新: 本文の diff を 1 枚目に載せる
            let account_key = account_key_of(core, "widgets.install", p)
                .await
                .ok()
                .flatten();
            let all = widgets::list(core)?;
            if let Some(cur) = widgets::find_instance(&all, wid, account_key.as_deref()) {
                if let Ok((source, hash)) = fetch_verified_source(core, &entry).await {
                    if source != cur.src {
                        out["title"] = json!("ウィジェットを更新");
                        out["message"] = json!(update_confirm_message(&cur.name(), &entry));
                        out["okLabel"] = json!("更新");
                        out["diff"] =
                            json!({ "old": cur.src, "new": source, "language": "aiscript" });
                        staged::stage(staged::key(id, ctx, p), &cur.src, hash);
                    } else {
                        out["message"] = json!(format!(
                            "{} は既にインストール済みで内容も最新です。",
                            cur.name()
                        ));
                    }
                }
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
        std::fs::write(base.join("widgets").join(name), body).unwrap();
    }

    #[tokio::test]
    async fn read_write_uninstall_and_revert() {
        let (_d, core, base) = temp_core();
        put(&base, "w.meta.json5", "{ installId: 'w', name: 'W', autoRun: false, storeId: 'clock', createdAt: 1, updatedAt: 1 }");
        put(&base, "w.is", "a");
        put(&base, "w2.meta.json5", "{ installId: 'w2', name: 'W', autoRun: true, storeId: 'clock', accountKey: 'h:u', createdAt: 2, updatedAt: 2 }");
        put(&base, "w2.is", "b");
        let ctx = ExecContext {
            principal: "user".into(),
            ..Default::default()
        };
        // accountKey 付きの個体があるが DB が無いので list は呼ばない (blocking が待つ)
        assert_eq!(
            read(&core, &json!({"installId": "w2"})).unwrap()["autoRun"],
            true
        );
        assert!(read(&core, &json!({"installId": "x"}))
            .unwrap_err()
            .to_string()
            .contains("widget \"x\" not found"));
        assert_eq!(
            set_auto_run(&core, &json!({"installId": "w", "autoRun": true})).unwrap()["autoRun"],
            true
        );
        let pv = preview(
            &core,
            "widgets.uninstall",
            &json!({"storeId": "clock"}),
            &ctx,
        )
        .await
        .unwrap()
        .unwrap();
        assert!(pv["message"]
            .as_str()
            .unwrap()
            .starts_with("W ほか 1 件 を削除します。"));
        // revert
        let mut w = widgets::get(&core, "w").unwrap().unwrap();
        widgets::update_src(&core, &mut w, "c", None).unwrap();
        let pv = preview(
            &core,
            "widgets.revert",
            &json!({"installId": "w", "index": 0}),
            &ctx,
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(pv["diff"]["new"], "a");
        let rv = revert(&core, &json!({"installId": "w", "index": 0}), &ctx).unwrap();
        assert_eq!(rv["reverted"], true);
        assert_eq!(read(&core, &json!({"installId": "w"})).unwrap()["src"], "a");
        let un = uninstall(&core, &json!({"storeId": "clock"})).unwrap();
        assert_eq!(un["installIds"], json!(["w", "w2"]));
        assert!(uninstall(&core, &json!({"installId": "w"}))
            .unwrap_err()
            .to_string()
            .contains("widget not found (installId=\"w\" storeId=\"\")"));
        assert_eq!(
            delete(&core, &json!({"installId": "w"})).unwrap()["removed"],
            false
        );
    }
}
