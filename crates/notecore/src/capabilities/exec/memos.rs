//! メモ系 capability (`memos.*`)。本体は `crate::memos`。引数の検査・エラー文・
//! 結果の形は移設前の TS (`builtins/memos.ts` / `memos-read.ts`) と同じ。

use serde_json::{json, Value};

use super::preview::confirm;
use super::{staged, ExecContext};
use crate::account_service;
use crate::context::Core;
use crate::edit_history::Attribution;
use crate::error::Result;
use crate::i18n::text;
use crate::memos::{self, MemoAuthor, MemoData, StoredMemo};
use crate::skills;
use notecli::error::NoteDeckError;

fn pick_string(p: &Value, k: &str) -> Option<String> {
    p.get(k)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn pick_string_array(p: &Value, k: &str) -> Option<Vec<String>> {
    p.get(k).and_then(Value::as_array).map(|a| {
        a.iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    })
}

fn clamp_limit(p: &Value) -> usize {
    match p.get("limit").and_then(Value::as_f64) {
        Some(n) if n.is_finite() => (n.floor() as i64).clamp(1, 50) as usize,
        _ => 10,
    }
}

fn pick_positive_number(p: &Value, k: &str) -> Option<f64> {
    p.get(k)
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && *n > 0.0)
}

fn invalid(msg: String) -> NoteDeckError {
    NoteDeckError::InvalidInput(msg)
}

// --- author ---

/// `authorFromPrincipal`: user は author なし、plugin は `plugin:<id>`、他は kind。
fn author_from_principal(ctx: &ExecContext) -> Option<MemoAuthor> {
    let kind = ctx.principal.as_str();
    match kind {
        "user" | "" => None,
        "plugin" => {
            let raw = ctx.plugin_id.clone().unwrap_or_default();
            let (noun, bare) = if let Some(r) = raw.strip_prefix("widget:") {
                ("ウィジェット", r)
            } else if let Some(r) = raw.strip_prefix("play:") {
                ("Play", r)
            } else if let Some(r) = raw.strip_prefix("page:") {
                ("ページ", r)
            } else {
                ("プラグイン", raw.as_str())
            };
            Some(MemoAuthor {
                id: format!("plugin:{raw}"),
                display_name: format!("{noun}「{bare}」"),
                avatar_url: None,
            })
        }
        other => {
            let label = match other {
                "ai.chat" => "AI",
                "ai.heartbeat" => "HEARTBEAT",
                "external" => "外部アプリ",
                "scratchpad" => "スクラッチパッド",
                _ => other,
            };
            Some(MemoAuthor {
                id: other.to_string(),
                display_name: label.to_string(),
                avatar_url: None,
            })
        }
    }
}

/// `buildAuthorBlock(authorId)`: `skill:<id>` は persona な skill、それ以外はアカウント。
async fn build_author_block(core: &Core, author_id: &str) -> Result<MemoAuthor> {
    let unresolvable = || {
        invalid(format!(
            "memos: authorId \"{author_id}\" is not resolvable (skill not installed / not isPersona / account not found)"
        ))
    };
    if let Some(skill_id) = author_id.strip_prefix("skill:") {
        let sk = skills::get(core, skill_id)?
            .filter(|s| s.is_persona)
            .ok_or_else(unresolvable)?;
        return Ok(MemoAuthor {
            id: format!("skill:{}", sk.id),
            display_name: sk.name,
            avatar_url: sk.icon_url,
        });
    }
    let accounts = core.blocking(account_service::list_public).await?;
    let acc = accounts
        .into_iter()
        .find(|a| a.id == author_id)
        .ok_or_else(unresolvable)?;
    Ok(MemoAuthor {
        id: acc.id,
        display_name: acc
            .display_name
            .filter(|d| !d.is_empty())
            .unwrap_or(acc.username),
        avatar_url: acc.avatar_url,
    })
}

// --- 投影 ---

fn project_result(m: &StoredMemo) -> Value {
    let mut v = json!({ "id": m.key, "text": m.data.text, "updatedAt": m.updated_at });
    if !m.data.tags.is_empty() {
        v["tags"] = json!(m.data.tags);
    }
    if let Some(a) = &m.data.author {
        v["author"] = json!(a);
    }
    v
}

fn project_row(m: &StoredMemo) -> Value {
    let mut v = project_result(m);
    if m.data.tainted == Some(true) {
        v["tainted"] = json!(true);
    }
    v
}

fn sort_desc(rows: &mut [StoredMemo]) {
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
}

fn author_filter(m: &StoredMemo, author_id: Option<&str>) -> bool {
    match author_id {
        None => true,
        Some("self") => m.data.author.is_none(),
        Some(id) => m.data.author.as_ref().map(|a| a.id == id).unwrap_or(false),
    }
}

/// 戻り値の bool は「ラベル付き (tainted) の行を返した」。
fn rows(mut items: Vec<StoredMemo>, limit: Option<usize>) -> (Value, bool) {
    sort_desc(&mut items);
    if let Some(n) = limit {
        items.truncate(n);
    }
    let tainted = items.iter().any(|m| m.data.tainted == Some(true));
    (
        Value::Array(items.iter().map(project_row).collect()),
        tainted,
    )
}

// --- 読取 ---

pub fn list(core: &Core, p: &Value) -> Result<(Value, bool)> {
    let tag = pick_string(p, "tag");
    let author_id = pick_string(p, "authorId");
    let older_than_days = pick_positive_number(p, "olderThanDays");
    let query = pick_string(p, "query").map(|q| q.to_lowercase());
    let limit = clamp_limit(p);
    let cutoff = older_than_days.map(|d| {
        let ms = chrono::Utc::now() - chrono::Duration::milliseconds((d * 86_400_000.0) as i64);
        ms.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    });
    let items: Vec<StoredMemo> = memos::list(core)?
        .into_iter()
        .filter(|m| {
            tag.as_ref()
                .map(|t| m.data.tags.contains(t))
                .unwrap_or(true)
        })
        .filter(|m| author_filter(m, author_id.as_deref()))
        .filter(|m| cutoff.as_ref().map(|c| m.updated_at <= *c).unwrap_or(true))
        .filter(|m| {
            query
                .as_ref()
                .map(|q| m.data.text.to_lowercase().contains(q.as_str()))
                .unwrap_or(true)
        })
        .collect();
    Ok(rows(items, Some(limit)))
}

pub fn search(core: &Core, p: &Value) -> Result<(Value, bool)> {
    let query = pick_string(p, "query")
        .ok_or_else(|| invalid("memos.search: query is required".into()))?
        .to_lowercase();
    let author_id = pick_string(p, "authorId");
    let limit = clamp_limit(p);
    let items: Vec<StoredMemo> = memos::list(core)?
        .into_iter()
        .filter(|m| m.data.text.to_lowercase().contains(query.as_str()))
        .filter(|m| author_filter(m, author_id.as_deref()))
        .collect();
    Ok(rows(items, Some(limit)))
}

pub fn backlinks(core: &Core, p: &Value) -> Result<(Value, bool)> {
    let id =
        pick_string(p, "id").ok_or_else(|| invalid("memos.backlinks: id is required".into()))?;
    if !memos::is_zettelkasten_key(&id) {
        return Err(invalid(
            "memos.backlinks: id must be a Zettelkasten key (14-digit number)".into(),
        ));
    }
    let items: Vec<StoredMemo> = memos::list(core)?
        .into_iter()
        .filter(|m| m.key != id && memos::extract_memo_refs(&m.data.text).contains(&id))
        .collect();
    Ok(rows(items, None))
}

// --- 書込 ---

pub async fn create(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let text =
        pick_string(p, "text").ok_or_else(|| invalid("memos.create: text is required".into()))?;
    let tags = pick_string_array(p, "tags").unwrap_or_default();
    let author = match pick_string(p, "authorId") {
        Some(id) => Some(build_author_block(core, &id).await?),
        None => author_from_principal(ctx),
    };
    let mut data = MemoData::new(text, tags, author);
    if ctx.tainted {
        data.tainted = Some(true);
    }
    let base = crate::commands::settings::settings_base_dir(core)?;
    let key = memos::generate_key(&base);
    let stored = memos::save(core, &key, data, None)?;
    Ok(project_result(&stored))
}

pub async fn update(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = pick_string(p, "id").ok_or_else(|| invalid("memos.update: id is required".into()))?;
    let text = pick_string(p, "text");
    let tags = pick_string_array(p, "tags");
    // authorId: 空白だけなら author を消す / 文字列なら解決 / 文字列以外は無視
    let author_patch: Option<Option<MemoAuthor>> = match p.get("authorId") {
        Some(Value::String(raw)) if raw.trim().is_empty() => Some(None),
        Some(Value::String(raw)) => Some(Some(build_author_block(core, raw.trim()).await?)),
        _ => None,
    };
    if text.is_none() && tags.is_none() && author_patch.is_none() {
        return Err(invalid(
            "memos.update: at least one of text / tags / authorId is required".into(),
        ));
    }
    let existing = memos::get(core, &id)?
        .ok_or_else(|| invalid(format!("memos.update: memo \"{id}\" not found")))?;
    let mut data = existing.data.clone();
    if let Some(t) = text {
        data.text = t;
    }
    if let Some(t) = tags {
        data.tags = t;
    }
    if let Some(a) = author_patch {
        data.author = a;
    }
    if ctx.tainted || existing.data.tainted == Some(true) {
        data.tainted = Some(true);
    }
    let stored = memos::save(core, &id, data, None)?;
    Ok(project_result(&stored))
}

pub fn delete(core: &Core, p: &Value) -> Result<Value> {
    let id = pick_string(p, "id").ok_or_else(|| invalid("memos.delete: id is required".into()))?;
    if !memos::delete(core, &id)? {
        return Err(invalid(format!("memos.delete: memo \"{id}\" not found")));
    }
    Ok(json!({ "ok": true, "id": id }))
}

fn index_of(p: &Value) -> i64 {
    p.get("index").and_then(Value::as_i64).unwrap_or(-1)
}

pub fn revert(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = pick_string(p, "id").ok_or_else(|| invalid("memos.revert: id is required".into()))?;
    let index = index_of(p);
    if index < 0 {
        return Err(invalid("memos.revert: index must be >= 0".into()));
    }
    let cur = memos::get(core, &id)?
        .ok_or_else(|| invalid(format!("memos.revert: memo \"{id}\" not found")))?;
    let entries = memos::history(core, &id)?;
    let Some(entry) = entries.get(index as usize) else {
        return Err(invalid(format!(
            "memos.revert: no snapshot at index {index}"
        )));
    };
    let body = entry
        .snapshot
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let key = staged::key("memos.revert", ctx, p);
    let next = staged::take_or("memos.revert", &key, &cur.data.text, || body.clone())?;
    let mut data = cur.data.clone();
    data.text = next;
    let mut by = json!({ "kind": ctx.principal });
    if let Some(pid) = ctx.plugin_id.as_deref().filter(|s| !s.is_empty()) {
        by["pluginId"] = Value::String(pid.to_string());
    }
    let attribution = Attribution {
        by: Some(by),
        reason: pick_string(p, "reason"),
    };
    memos::save(core, &id, data, Some(&attribution))?;
    Ok(json!({ "id": id, "reverted": true, "at": entry.at }))
}

/// 確認内容。create / update / delete は汎用 (呼び出し側が組む)。
pub fn preview(core: &Core, id: &str, p: &Value, ctx: &ExecContext) -> Result<Option<Value>> {
    if id != "memos.revert" {
        return Ok(None);
    }
    let Some(key) = pick_string(p, "id") else {
        return Ok(None);
    };
    let index = index_of(p);
    if index < 0 {
        return Ok(None);
    }
    let Some(cur) = memos::get(core, &key)? else {
        return Ok(None);
    };
    let entries = memos::history(core, &key)?;
    let Some(entry) = entries.get(index as usize) else {
        return Ok(None);
    };
    let body = entry
        .snapshot
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let next = staged::stage(staged::key(id, ctx, p), &cur.data.text, body);
    Ok(Some(confirm(
        "warning",
        text("_native.preview.memos.revert.title", json!({})),
        Some(text(
            "_native.preview.memos.revert.message",
            json!({
                "key": key,
                "index": index,
                "at": super::time::iso_from_unix_ms(entry.at as i64),
            }),
        )),
        text("_native.preview.memos.revert.ok", json!({})),
        json!({ "diff": { "old": cur.data.text, "new": next, "language": "markdown" } }),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_in(dir: &std::path::Path) -> Core {
        let core = Core::new();
        core.set_app_dir(dir.to_path_buf());
        core
    }

    #[test]
    fn authors_and_limits_follow_ts() {
        let hb = ExecContext {
            principal: "ai.heartbeat".into(),
            ..Default::default()
        };
        assert_eq!(
            author_from_principal(&hb).unwrap().display_name,
            "HEARTBEAT"
        );
        assert!(author_from_principal(&ExecContext {
            principal: "user".into(),
            ..Default::default()
        })
        .is_none());
        let pl = ExecContext {
            principal: "plugin".into(),
            plugin_id: Some("widget:clock".into()),
            ..Default::default()
        };
        let a = author_from_principal(&pl).unwrap();
        assert_eq!(a.id, "plugin:widget:clock");
        assert_eq!(a.display_name, "ウィジェット「clock」");
        assert_eq!(clamp_limit(&json!({})), 10);
        assert_eq!(clamp_limit(&json!({"limit": 500})), 50);
        assert_eq!(clamp_limit(&json!({"limit": 0})), 1);
        assert_eq!(
            pick_string_array(&json!({"tags": [" a ", "", 3]}), "tags").unwrap(),
            vec!["a"]
        );
    }

    #[tokio::test]
    async fn create_update_list_search_backlinks_delete() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let ctx = ExecContext {
            principal: "ai.chat".into(),
            tainted: true,
            ..Default::default()
        };
        assert!(create(&core, &json!({}), &ctx)
            .await
            .unwrap_err()
            .to_string()
            .contains("text is required"));
        let created = create(
            &core,
            &json!({"text": "clean note", "tags": ["idea"]}),
            &ctx,
        )
        .await
        .unwrap();
        let id = created["id"].as_str().unwrap().to_string();
        assert_eq!(created["author"]["displayName"], "AI");
        assert_eq!(created["tags"], json!(["idea"]));
        // list は tainted を申告
        let (v, tainted) = list(&core, &json!({})).unwrap();
        assert_eq!(v.as_array().unwrap().len(), 1);
        assert!(tainted);
        assert_eq!(v[0]["tainted"], true);
        // search で当たらなければ申告しない
        let (v, tainted) = search(&core, &json!({"query": "zzz"})).unwrap();
        assert!(v.as_array().unwrap().is_empty());
        assert!(!tainted);
        assert!(search(&core, &json!({"query": "   "}))
            .unwrap_err()
            .to_string()
            .contains("query is required"));
        // update: 少なくとも 1 つ
        let err = update(&core, &json!({"id": id}), &ctx)
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("at least one of"));
        let updated = update(&core, &json!({"id": id, "text": format!("see [x](memo:{id}) self and other"), "authorId": " "}), &ctx).await.unwrap();
        assert!(updated.get("author").is_none());
        // backlinks: 自己参照は含まない
        let (bl, _) = backlinks(&core, &json!({"id": id})).unwrap();
        assert!(bl.as_array().unwrap().is_empty());
        assert!(backlinks(&core, &json!({"id": "nope"}))
            .unwrap_err()
            .to_string()
            .contains("Zettelkasten"));
        // 履歴に編集前が残り、revert で戻る
        let h = memos::history(&core, &id).unwrap();
        assert_eq!(h[0].snapshot["body"], "clean note\n");
        let pv = preview(&core, "memos.revert", &json!({"id": id, "index": 0}), &ctx)
            .unwrap()
            .unwrap();
        assert_eq!(pv["diff"]["new"], "clean note\n");
        let rv = revert(&core, &json!({"id": id, "index": 0}), &ctx).unwrap();
        assert_eq!(rv["reverted"], true);
        assert_eq!(
            memos::get(&core, &id).unwrap().unwrap().data.text,
            "clean note\n"
        );
        assert_eq!(delete(&core, &json!({"id": id})).unwrap()["ok"], true);
        assert!(delete(&core, &json!({"id": id}))
            .unwrap_err()
            .to_string()
            .contains("not found"));
    }
}
