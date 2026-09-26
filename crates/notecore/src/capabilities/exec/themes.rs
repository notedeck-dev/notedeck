//! テーマ系 capability (`theme.*`、`theme.apply` は画面への適用なのでデバイスに残る)。
//! 本体は `crate::themes`。引数の検査・エラー文・確認内容・結果の形は移設前の TS と同じ。

use indexmap::IndexMap;
use serde_json::{json, Value};

use super::misstore::{ensure_approved_hash, fetch_verified_source, registry_entry};
use super::preview::confirm;
use super::{staged, ExecContext};
use crate::context::Core;
use crate::edit_history::Attribution;
use crate::error::Result;
use crate::i18n::{localize_fields, text, Text};
use crate::themes::{self, Theme, ThemePatch};
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

/// `isStringRecord`: 配列でないオブジェクトで、値が全部文字列。
fn string_record(v: Option<&Value>) -> Option<IndexMap<String, String>> {
    let obj = v?.as_object()?;
    let mut out = IndexMap::new();
    for (k, v) in obj {
        out.insert(k.clone(), v.as_str()?.to_string());
    }
    Some(out)
}

fn base_param(p: &Value) -> Option<String> {
    match s(p, "base") {
        "dark" => Some("dark".into()),
        "light" => Some("light".into()),
        _ => None,
    }
}

// --- 読取 ---

pub fn list(core: &Core) -> Result<Value> {
    Ok(Value::Array(
        themes::list(core)?
            .iter()
            .map(|t| json!({ "id": t.id, "name": t.name, "base": t.base, "author": Value::Null }))
            .collect(),
    ))
}

pub fn read(core: &Core, p: &Value) -> Result<Value> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid("theme.read: id is required".into()));
    }
    let t = themes::get(core, id)?
        .ok_or_else(|| invalid(format!("theme.read: theme \"{id}\" is not installed")))?;
    Ok(json!({ "id": t.id, "name": t.name, "base": t.base, "props": t.props }))
}

pub fn history(core: &Core, p: &Value) -> Result<Value> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid("theme.history: id is required".into()));
    }
    Ok(serde_json::to_value(themes::history(core, id)?)?)
}

// --- 書込 ---

pub async fn create(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let name = s(p, "name");
    if name.is_empty() {
        return Err(invalid("theme.create: name is required".into()));
    }
    let base = base_param(p)
        .ok_or_else(|| invalid("theme.create: base must be \"dark\" or \"light\"".into()))?;
    let props = string_record(p.get("props"))
        .ok_or_else(|| invalid("theme.create: props must be an object of string values".into()))?;
    let explicit = s(p, "id");
    let id = if explicit.is_empty() {
        format!("custom-{}", crate::ai_sessions::now_ms())
    } else {
        explicit.to_string()
    };
    let theme = Theme {
        id,
        name: name.to_string(),
        base,
        props,
        notedeck: None,
        file_base: None,
    };
    // 全アカウントに紐づける (安定キー `host:userId`)
    let keys = themes::account_scope_keys(core).await?;
    let installed = themes::install_theme(
        core,
        &themes::serialize_theme_display(&theme),
        &keys,
        Some(&attribution(ctx, p)),
    )?;
    Ok(
        json!({ "id": installed.id, "name": installed.name, "base": installed.base, "installed": true }),
    )
}

fn theme_update_patch(p: &Value, cur: &Theme) -> ThemePatch {
    ThemePatch {
        name: Some(s(p, "name").to_string()).filter(|n| !n.is_empty()),
        base: base_param(p).or_else(|| Some(cur.base.clone())),
        props: string_record(p.get("props")),
    }
}

pub fn update(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid("theme.update: id is required".into()));
    }
    let cur = themes::get(core, id)?
        .ok_or_else(|| invalid(format!("theme.update: theme \"{id}\" is not installed")))?;
    let patch = theme_update_patch(p, &cur);
    let baseline =
        themes::serialize_theme_display(&themes::merge_theme_update(&cur, &ThemePatch::default()));
    let key = staged::key("theme.update", ctx, p);
    let text = staged::take_or("theme.update", &key, &baseline, || {
        themes::serialize_theme_display(&themes::merge_theme_update(&cur, &patch))
    })?;
    themes::install_theme(core, &text, &[], Some(&attribution(ctx, p)))?;
    Ok(json!({ "id": id, "updated": true }))
}

fn index_of(p: &Value) -> i64 {
    p.get("index").and_then(Value::as_i64).unwrap_or(-1)
}

pub fn revert(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid("theme.revert: id is required".into()));
    }
    let index = index_of(p);
    if index < 0 {
        return Err(invalid("theme.revert: index must be >= 0".into()));
    }
    let entries = themes::history(core, id)?;
    let Some(entry) = entries.get(index as usize) else {
        return Err(invalid(format!(
            "theme.revert: no snapshot at index {index}"
        )));
    };
    let snap = themes::theme_from_snapshot(&entry.snapshot);
    let cur = themes::get(core, id)?;
    let baseline = cur
        .as_ref()
        .map(|c| {
            themes::serialize_theme_display(&themes::merge_theme_update(c, &ThemePatch::default()))
        })
        .unwrap_or_default();
    let key = staged::key("theme.revert", ctx, p);
    let text = staged::take_or("theme.revert", &key, &baseline, || {
        themes::serialize_theme_display(&snap)
    })?;
    themes::install_theme(core, &text, &[], Some(&attribution(ctx, p)))?;
    Ok(json!({ "id": id, "reverted": true, "at": entry.at }))
}

pub fn uninstall(core: &Core, p: &Value) -> Result<Value> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid("theme.uninstall: id is required".into()));
    }
    if !themes::remove(core, id)? {
        return Err(invalid(format!(
            "theme.uninstall: theme \"{id}\" is not installed"
        )));
    }
    Ok(json!({ "id": id, "removed": true }))
}

/// `buildThemeWithMeta`: 配布ファイルに storeId / storeSha512 / storeVersion と installedFor を足す。
fn theme_with_meta(
    mut parsed: Theme,
    existing: Option<&Theme>,
    entry: &Value,
    hash: &str,
    keys: &[String],
) -> Theme {
    if let Some(ex) = existing {
        parsed.id = ex.id.clone();
        parsed.name = ex.name.clone();
    }
    let mut meta = parsed.notedeck.take().unwrap_or_default();
    meta.insert("storeId".into(), json!(s(entry, "id")));
    meta.insert("storeSha512".into(), json!(hash));
    meta.insert("storeVersion".into(), json!(s(entry, "version")));
    let mut installed_for = existing.map(|e| e.installed_for()).unwrap_or_default();
    for k in keys {
        if !installed_for.contains(k) {
            installed_for.push(k.clone());
        }
    }
    if !installed_for.is_empty() {
        meta.insert("installedFor".into(), json!(installed_for));
    }
    parsed.notedeck = Some(meta);
    parsed
}

pub async fn install(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = s(p, "id");
    if id.is_empty() {
        return Err(invalid("theme.install: id is required".into()));
    }
    let Some(entry) = registry_entry(core, "themes", id).await? else {
        return Err(invalid(format!(
            "theme.install: theme \"{id}\" not found in MisStore (try misstore.search first)"
        )));
    };
    let (source, hash) = fetch_verified_source(core, &entry).await?;
    let Some((parsed, _)) = themes::parse_theme_code(&source) else {
        return Err(invalid("theme.install: failed to install the theme".into()));
    };
    let existing = themes::list(core)?
        .into_iter()
        .find(|t| t.store_id() == Some(id));
    if let Some(cur) = &existing {
        let key = staged::key("theme.install", ctx, p);
        ensure_approved_hash(
            "theme.install",
            &key,
            &themes::serialize_theme_display(cur),
            &hash,
        )?;
    }
    let keys = themes::account_scope_keys(core).await?;
    let with_meta = theme_with_meta(parsed, existing.as_ref(), &entry, &hash, &keys);
    themes::install_theme(
        core,
        &themes::serialize_theme_display(&with_meta),
        &[],
        None,
    )?;
    Ok(
        json!({ "id": s(&entry, "id"), "name": s(&entry, "name"), "base": s(&entry, "base"), "installed": true }),
    )
}

// --- 確認内容 ---

/// `description` は表示言語で描き直す欄 (入れ子の `i18n` 欄に手がかりを置く)
fn install_preview(name: &str, version: &str, description: Text) -> Value {
    let mut v = json!({ "kind": "theme", "name": name, "version": version });
    localize_fields(&mut v, vec![("description", description)]);
    v
}

fn summary(base: &str, props: usize) -> Text {
    text(
        "_native.preview.themes.summary_plural",
        json!({ "base": base, "count": props }),
    )
}

pub async fn preview(core: &Core, id: &str, p: &Value, ctx: &ExecContext) -> Result<Option<Value>> {
    Ok(match id {
        "theme.create" => {
            let base = if s(p, "base") == "light" {
                "light"
            } else {
                "dark"
            };
            let props = p.get("props").filter(|v| v.is_object());
            let name = s(p, "name");
            let explicit = s(p, "id");
            let mut pv = json!({ "kind": "theme", "name": name });
            if !explicit.is_empty() {
                pv["version"] = json!(explicit);
            }
            if let Some(pr) = props {
                localize_fields(
                    &mut pv,
                    vec![(
                        "description",
                        text(
                            "_native.preview.themes.create.description_plural",
                            json!({
                                "base": base,
                                "count": pr.as_object().map(|o| o.len()).unwrap_or(0),
                            }),
                        ),
                    )],
                );
            }
            let message = if base == "light" {
                "_native.preview.themes.create.messageLight"
            } else {
                "_native.preview.themes.create.messageDark"
            };
            Some(confirm(
                "normal",
                text("_native.preview.themes.create.title", json!({})),
                Some(text(message, json!({}))),
                text("_native.preview.themes.create.ok", json!({})),
                json!({
                    "installPreview": pv,
                    "code": props.map(|v| serde_json::to_string_pretty(v).unwrap_or_default()).unwrap_or_default(),
                    "codeLanguage": "json",
                }),
            ))
        }
        "theme.update" => {
            let Some(cur) = themes::get(core, s(p, "id"))? else {
                return Ok(None);
            };
            let patch = theme_update_patch(p, &cur);
            let baseline = themes::serialize_theme_display(&themes::merge_theme_update(
                &cur,
                &ThemePatch::default(),
            ));
            let next = staged::stage(
                staged::key(id, ctx, p),
                &baseline,
                themes::serialize_theme_display(&themes::merge_theme_update(&cur, &patch)),
            );
            let message = match &patch.props {
                Some(pr) => text(
                    "_native.preview.themes.update.messageProps_plural",
                    json!({ "name": cur.name, "count": pr.len() }),
                ),
                None => text(
                    "_native.preview.themes.update.messageMeta",
                    json!({ "name": cur.name }),
                ),
            };
            Some(confirm(
                "warning",
                text("_native.preview.themes.update.title", json!({})),
                Some(message),
                text("_native.preview.themes.update.ok", json!({})),
                json!({
                    "installPreview": install_preview(
                        patch.name.as_deref().unwrap_or(&cur.name),
                        &cur.id,
                        text(
                            "_native.preview.themes.update.description",
                            json!({ "base": patch.base.as_deref().unwrap_or(&cur.base) }),
                        ),
                    ),
                    "diff": { "old": baseline, "new": next, "language": "json5" },
                }),
            ))
        }
        "theme.revert" => {
            let tid = s(p, "id");
            let index = index_of(p);
            if tid.is_empty() || index < 0 {
                return Ok(None);
            }
            let entries = themes::history(core, tid)?;
            let Some(entry) = entries.get(index as usize) else {
                return Ok(None);
            };
            let snap = themes::theme_from_snapshot(&entry.snapshot);
            let baseline = themes::get(core, tid)?
                .map(|c| {
                    themes::serialize_theme_display(&themes::merge_theme_update(
                        &c,
                        &ThemePatch::default(),
                    ))
                })
                .unwrap_or_default();
            let next = staged::stage(
                staged::key(id, ctx, p),
                &baseline,
                themes::serialize_theme_display(&snap),
            );
            Some(confirm(
                "warning",
                text("_native.preview.themes.revert.title", json!({})),
                Some(text(
                    "_native.preview.themes.revert.message",
                    json!({
                        "name": snap.name,
                        "index": index,
                        "at": super::time::iso_from_unix_ms(entry.at as i64),
                    }),
                )),
                text("_native.preview.themes.revert.ok", json!({})),
                json!({
                    "installPreview": install_preview(&snap.name, &snap.id, summary(&snap.base, snap.props.len())),
                    "diff": { "old": baseline, "new": next, "language": "json5" },
                }),
            ))
        }
        "theme.install" => {
            let tid = s(p, "id");
            if tid.is_empty() {
                return Ok(None);
            }
            let Some(entry) = registry_entry(core, "themes", tid).await? else {
                return Ok(None);
            };
            let existing = themes::list(core)?
                .into_iter()
                .find(|t| t.store_id() == Some(tid));
            let (title, ok) = if existing.is_some() {
                (
                    "_native.preview.themes.install.titleUpdate",
                    "_native.preview.themes.install.okUpdate",
                )
            } else {
                (
                    "_native.preview.themes.install.titleNew",
                    "_native.preview.themes.install.okNew",
                )
            };
            let mut out = confirm(
                "normal",
                text(title, json!({})),
                Some(text(
                    "_native.preview.themes.install.message",
                    json!({
                        "name": s(&entry, "name"),
                        "base": s(&entry, "base"),
                        "author": s(&entry, "author"),
                    }),
                )),
                text(ok, json!({})),
                json!({
                    "installPreview": {
                        "kind": "theme",
                        "name": s(&entry, "name"),
                        "version": s(&entry, "version"),
                        "author": s(&entry, "author"),
                        "description": s(&entry, "description"),
                    },
                    "code": serde_json::to_string_pretty(entry.get("themeProps").unwrap_or(&json!({}))).unwrap_or_default(),
                    "codeLanguage": "json",
                }),
            );
            if let Some(cur) = existing {
                // 既存の更新: 本文の diff を 1 枚目に載せる (移設前は 2 枚目の確認)
                if let Ok((source, hash)) = fetch_verified_source(core, &entry).await {
                    if let Some((parsed, _)) = themes::parse_theme_code(&source) {
                        let with_meta = theme_with_meta(parsed, Some(&cur), &entry, &hash, &[]);
                        out["diff"] = json!({
                            "old": themes::serialize_theme_display(&cur),
                            "new": themes::serialize_theme_display(&with_meta),
                            "language": "json5",
                        });
                        staged::stage(
                            staged::key(id, ctx, p),
                            &themes::serialize_theme_display(&cur),
                            hash,
                        );
                    }
                }
            }
            Some(out)
        }
        "theme.uninstall" => {
            let Some(cur) = themes::get(core, s(p, "id"))? else {
                return Ok(None);
            };
            Some(confirm(
                "danger",
                text("_native.preview.themes.uninstall.title", json!({})),
                Some(text(
                    "_native.preview.themes.uninstall.message",
                    json!({ "name": cur.name, "base": cur.base }),
                )),
                text("_native.preview.themes.uninstall.ok", json!({})),
                json!({
                    "installPreview": install_preview(&cur.name, &cur.id, summary(&cur.base, cur.props.len())),
                    "code": serde_json::to_string_pretty(&cur.props).unwrap_or_default(),
                    "codeLanguage": "json",
                }),
            ))
        }
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_in(dir: &std::path::Path) -> Core {
        let core = Core::new();
        core.set_app_dir(dir.to_path_buf());
        std::fs::create_dir_all(crate::commands::settings::settings_base_dir(&core).unwrap())
            .unwrap();
        core
    }

    #[tokio::test]
    async fn create_validates_and_update_revert_use_staged_text() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let ctx = ExecContext {
            principal: "ai.chat".into(),
            ..Default::default()
        };
        let err = |p: Value| {
            let core = &core;
            let ctx = &ctx;
            async move { create(core, &p, ctx).await.unwrap_err().to_string() }
        };
        assert!(err(json!({})).await.contains("name is required"));
        assert!(err(json!({"name": "x"})).await.contains("base must be"));
        assert!(err(json!({"name": "x", "base": "dark", "props": {"a": 1}}))
            .await
            .contains("props must be"));
        // 成功経路はアカウント (DB) が要るので、本体の install_theme で用意する
        themes::install_theme(
            &core,
            "{ id: 'neo', name: 'Neo', base: 'dark', props: { accent: '#f00' } }",
            &[],
            None,
        )
        .unwrap();
        assert_eq!(
            read(&core, &json!({"id": "neo"})).unwrap()["props"]["accent"],
            "#f00"
        );
        assert_eq!(list(&core).unwrap()[0]["author"], Value::Null);
        // update: preview の diff と execute の staged が一致し、props はマージ
        let p = json!({"id": "neo", "props": {"panel": "#111", "accent": "#0f0"}, "reason": "r"});
        let pv = preview(&core, "theme.update", &p, &ctx)
            .await
            .unwrap()
            .unwrap();
        assert!(pv["diff"]["old"]
            .as_str()
            .unwrap()
            .contains("\"accent\": \"#f00\""));
        assert!(pv["diff"]["new"]
            .as_str()
            .unwrap()
            .contains("\"panel\": \"#111\""));
        assert_eq!(pv["message"], "Updates 2 CSS variables of Neo.");
        let hint = &pv["i18n"]["message"];
        assert_eq!(
            crate::i18n::render("ja-JP", hint["key"].as_str().unwrap(), &hint["params"]),
            "Neo の 2 個の CSS 変数を更新します。"
        );
        let desc = &pv["installPreview"]["i18n"]["description"];
        assert_eq!(pv["installPreview"]["description"], "dark theme");
        assert_eq!(
            crate::i18n::render("ja-JP", desc["key"].as_str().unwrap(), &desc["params"]),
            "dark テーマ"
        );
        assert_eq!(update(&core, &p, &ctx).unwrap()["updated"], true);
        let t = themes::get(&core, "neo").unwrap().unwrap();
        assert_eq!(t.props.keys().collect::<Vec<_>>(), vec!["accent", "panel"]);
        assert_eq!(t.props["accent"], "#0f0");
        let h = history(&core, &json!({"id": "neo"})).unwrap();
        assert_eq!(h[0]["snapshot"]["props"]["accent"], "#f00");
        assert_eq!(h[0]["reason"], "r");
        // revert
        assert!(revert(&core, &json!({"id": "neo", "index": 5}), &ctx)
            .unwrap_err()
            .to_string()
            .contains("no snapshot"));
        let rv = revert(&core, &json!({"id": "neo", "index": 0}), &ctx).unwrap();
        assert_eq!(rv["reverted"], true);
        assert_eq!(
            themes::get(&core, "neo").unwrap().unwrap().props["accent"],
            "#f00"
        );
        // uninstall の確認と実行
        let pv = preview(&core, "theme.uninstall", &json!({"id": "neo"}), &ctx)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pv["type"], "danger");
        assert_eq!(
            uninstall(&core, &json!({"id": "neo"})).unwrap()["removed"],
            true
        );
        assert!(uninstall(&core, &json!({"id": "neo"}))
            .unwrap_err()
            .to_string()
            .contains("is not installed"));
    }

    #[test]
    fn theme_with_meta_keeps_identity_and_unions_accounts() {
        let (parsed, _) =
            themes::parse_theme_code("{ id: 'dist', name: 'Dist', props: { a: '1' } }").unwrap();
        let (existing, _) = themes::parse_theme_code("{ id: 'mine', name: 'Mine', props: {}, $notedeck: { storeId: 's', installedFor: ['h:u'] } }").unwrap();
        let entry = json!({"id": "s", "version": "2.0.0"});
        let out = theme_with_meta(parsed, Some(&existing), &entry, "abc", &["h:v".into()]);
        assert_eq!(out.id, "mine");
        assert_eq!(out.name, "Mine");
        assert_eq!(out.installed_for(), vec!["h:u", "h:v"]);
        assert_eq!(out.notedeck.as_ref().unwrap()["storeVersion"], "2.0.0");
        assert_eq!(out.notedeck.as_ref().unwrap()["storeSha512"], "abc");
    }
}
