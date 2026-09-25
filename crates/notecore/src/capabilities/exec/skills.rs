//! skill 系 capability (`skills.*`)。本体は `crate::skills`、確認内容もここで組む。
//! 引数の扱い・エラー文・結果の形は移設前の TS と同じ。

use serde_json::{json, Value};
use sha2::{Digest, Sha512};

use super::{staged, ExecContext};
use crate::commands::http::{self, HttpFetchRequest};
use crate::context::Core;
use crate::edit_history::Attribution;
use crate::error::Result;
use crate::settings_slug::{casefold, resolve_available};
use crate::skills::{self, SkillMeta, SkillPatch, DEFAULT_VERSION};
use notecli::error::NoteDeckError;

const REGISTRY_URL: &str = "https://store.notedeck.io/registry/skills.json";

fn s<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or("")
}

fn require(p: &Value, k: &str, capability: &str) -> Result<String> {
    let v = s(p, k);
    if v.is_empty() {
        return Err(NoteDeckError::InvalidInput(format!(
            "{capability}: {k} is required"
        )));
    }
    Ok(v.to_string())
}

fn string_list(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .map(|x| match x {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn attribution(ctx: &ExecContext, p: &Value) -> Attribution {
    let mut by = json!({ "kind": ctx.principal });
    if let Some(id) = ctx.plugin_id.as_deref().filter(|s| !s.is_empty()) {
        by["pluginId"] = Value::String(id.to_string());
    }
    Attribution {
        by: Some(by),
        reason: Some(s(p, "reason").trim().to_string()).filter(|r| !r.is_empty()),
    }
}

fn install_preview(sk: &SkillMeta) -> Value {
    json!({
        "kind": "skill",
        "name": sk.name,
        "version": sk.version,
        "description": format!("{} mode", sk.mode),
    })
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

// --- 読取 ---

pub fn list(core: &Core) -> Result<Value> {
    Ok(Value::Array(
        skills::list(core)?
            .iter()
            .map(|sk| {
                json!({
                    "id": sk.id,
                    "name": sk.name,
                    "mode": sk.mode,
                    "isPersona": sk.is_persona,
                    "builtIn": sk.built_in,
                    "author": sk.author,
                    "description": sk.description,
                    "version": sk.version,
                })
            })
            .collect(),
    ))
}

/// 戻り値の bool は「ラベル付き (tainted) の内容を返した」。
pub fn read(core: &Core, p: &Value) -> Result<(Value, bool)> {
    let id = require(p, "id", "skills.read")?;
    let sk = skills::require(core, "skills.read", &id)?;
    Ok((
        json!({ "id": sk.id, "name": sk.name, "body": sk.body, "mode": sk.mode }),
        sk.tainted == Some(true),
    ))
}

pub fn history(core: &Core, p: &Value) -> Result<Value> {
    let id = require(p, "id", "skills.history")?;
    let sk = skills::require(core, "skills.history", &id)?;
    Ok(serde_json::to_value(skills::history(core, &sk)?)?)
}

// --- 書込 ---

fn create_input(p: &Value, ctx: &ExecContext) -> Result<SkillMeta> {
    let name = s(p, "name").trim().to_string();
    if name.is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "skills.create: name is required".into(),
        ));
    }
    let body = s(p, "body");
    if body.trim().is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "skills.create: body is required".into(),
        ));
    }
    if body.starts_with("---\n") || body.starts_with("---\r\n") {
        return Err(NoteDeckError::InvalidInput(
            "skills.create: body must not start with a frontmatter block (---). mode / triggers / description はパラメータで渡すこと".into(),
        ));
    }
    let mode = skills::normalize_mode(p.get("mode").and_then(Value::as_str));
    let triggers = string_list(p.get("triggers"));
    if mode == "trigger" && triggers.is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "skills.create: mode=\"trigger\" requires non-empty triggers (= 永久に発火しないスキルになる)".into(),
        ));
    }
    Ok(SkillMeta {
        id: String::new(),
        name,
        version: DEFAULT_VERSION.into(),
        description: Some(s(p, "description").to_string()).filter(|d| !d.is_empty()),
        mode,
        triggers,
        body: body.to_string(),
        cheap_check_capabilities: string_list(p.get("cheapCheckCapabilities")),
        tainted: ctx.tainted.then_some(true),
        ..Default::default()
    })
}

/// TS `generateSkillId`: 名前の slug + `-` + 乱数 4 文字 (base36)。
fn generate_skill_id(name: &str) -> String {
    let lower = name.to_lowercase();
    let mut out = String::new();
    for c in lower.chars() {
        out.push(
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' {
                c
            } else {
                '-'
            },
        );
    }
    let mut collapsed = String::new();
    for c in out.chars() {
        if c == '-' && collapsed.ends_with('-') {
            continue;
        }
        collapsed.push(c);
    }
    let mut base = collapsed.trim_matches('-').to_string();
    if base.is_empty() {
        base = "skill".into();
    }
    let rnd: String = {
        let mut h = Sha512::new();
        h.update(crate::skills::now_ms().to_le_bytes());
        h.update(name.as_bytes());
        let digest = h.finalize();
        digest
            .iter()
            .take(4)
            .map(|b| {
                let v = (b % 36) as u32;
                char::from_digit(v, 36).unwrap_or('0')
            })
            .collect()
    };
    format!("{base}-{rnd}")
}

pub fn create(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let mut input = create_input(p, ctx)?;
    let existing: Vec<String> = skills::list(core)?.into_iter().map(|s| s.id).collect();
    let mut id = generate_skill_id(&input.name);
    let mut n = 0;
    while existing.contains(&id) {
        n += 1;
        id = format!("{}-{n}", generate_skill_id(&input.name));
    }
    input.id = id;
    let created = skills::create(core, input)?;
    Ok(json!({ "id": created.id, "name": created.name, "mode": created.mode }))
}

pub fn append(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = require(p, "id", "skills.append")?;
    let content = require(p, "content", "skills.append")?;
    let sk = skills::require(core, "skills.append", &id)?;
    let key = staged::key("skills.append", ctx, p);
    let new_body = staged::take_or("skills.append", &key, &sk.body, || {
        skills::append_block(&sk.body, &content)
    })?;
    let length = char_len(&new_body);
    skills::update(
        core,
        &id,
        SkillPatch {
            body: Some(new_body),
            tainted: ctx.tainted.then_some(true),
            ..Default::default()
        },
        Some(&attribution(ctx, p)),
    )?;
    Ok(json!({ "id": id, "length": length }))
}

pub fn replace_section(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = require(p, "id", "skills.replaceSection")?;
    let heading = require(p, "heading", "skills.replaceSection")?;
    let content = s(p, "content").to_string();
    let sk = skills::require(core, "skills.replaceSection", &id)?;
    let key = staged::key("skills.replaceSection", ctx, p);
    // replaced は実行時に計算し直した値 (移設前と同じ)
    let (_, replaced) = skills::replace_markdown_section(&sk.body, &heading, &content);
    let new_body = staged::take_or("skills.replaceSection", &key, &sk.body, || {
        skills::replace_markdown_section(&sk.body, &heading, &content).0
    })?;
    let length = char_len(&new_body);
    skills::update(
        core,
        &id,
        SkillPatch {
            body: Some(new_body),
            tainted: ctx.tainted.then_some(true),
            ..Default::default()
        },
        Some(&attribution(ctx, p)),
    )?;
    Ok(json!({ "id": id, "replaced": replaced, "length": length }))
}

pub fn toggle(core: &Core, p: &Value) -> Result<Value> {
    let id = require(p, "id", "skills.toggle")?;
    let active = p.get("active").and_then(Value::as_bool) == Some(true);
    skills::set_active(core, &id, active)?;
    Ok(json!({ "id": id, "active": active }))
}

fn index_of(p: &Value) -> i64 {
    p.get("index").and_then(Value::as_i64).unwrap_or(-1)
}

pub fn revert(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    let id = require(p, "id", "skills.revert")?;
    let index = index_of(p);
    if index < 0 {
        return Err(NoteDeckError::InvalidInput(
            "skills.revert: index must be >= 0".into(),
        ));
    }
    let sk = skills::require(core, "skills.revert", &id)?;
    let entries = skills::history(core, &sk)?;
    let Some(entry) = entries.get(index as usize) else {
        return Err(NoteDeckError::InvalidInput(format!(
            "skills.revert: no snapshot at index {index}"
        )));
    };
    let snapshot_body = entry
        .snapshot
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let key = staged::key("skills.revert", ctx, p);
    let new_body = staged::take_or("skills.revert", &key, &sk.body, || snapshot_body.clone())?;
    skills::update(
        core,
        &id,
        SkillPatch {
            body: Some(new_body),
            ..Default::default()
        },
        Some(&attribution(ctx, p)),
    )?;
    Ok(json!({ "id": id, "reverted": true, "at": entry.at }))
}

pub fn uninstall(core: &Core, p: &Value) -> Result<Value> {
    let id = require(p, "id", "skills.uninstall")?;
    if skills::get(core, &id)?.is_none() {
        return Err(NoteDeckError::InvalidInput(format!(
            "skills.uninstall: skill \"{id}\" is not installed"
        )));
    }
    skills::remove(core, &id)?;
    Ok(json!({ "id": id, "removed": true }))
}

// --- MisStore ---

async fn fetch_text(core: &Core, url: &str) -> Result<String> {
    let res = http::http_fetch(
        core,
        HttpFetchRequest {
            url: url.to_string(),
            method: Some("GET".into()),
            headers: None,
            body: None,
            timeout_ms: Some(15_000),
        },
    )
    .await?;
    if !(200..300).contains(&res.status) {
        return Err(NoteDeckError::InvalidInput(format!("HTTP {}", res.status)));
    }
    Ok(res.body)
}

async fn registry_entry(core: &Core, id: &str) -> Result<Option<Value>> {
    let text = fetch_text(core, REGISTRY_URL).await?;
    let doc: Value = serde_json::from_str(&text)
        .map_err(|e| NoteDeckError::InvalidInput(format!("MisStore registry parse failed: {e}")))?;
    Ok(doc
        .get("skills")
        .and_then(Value::as_array)
        .and_then(|a| {
            a.iter()
                .find(|e| e.get("id").and_then(Value::as_str) == Some(id))
        })
        .cloned())
}

fn sha512_hex(text: &str) -> String {
    format!("{:x}", Sha512::digest(text.as_bytes()))
}

/// ソースを取り、CRLF を LF に揃えて sha512 を検証する (1 回だけやり直す)。
async fn fetch_verified_source(core: &Core, entry: &Value) -> Result<(String, String)> {
    let url = s(entry, "sourceUrl");
    let expected = casefold(s(entry, "sha512"));
    for attempt in 0..2 {
        let text = fetch_text(core, url).await?.replace("\r\n", "\n");
        let hash = sha512_hex(&text);
        if hash == expected {
            return Ok((text, hash));
        }
        if attempt == 0 {
            tracing::warn!(url, "MisStore source hash mismatch, retrying once");
        }
    }
    Err(NoteDeckError::InvalidInput(
        "ハッシュ不一致: ソースが改ざんされている可能性があります".into(),
    ))
}

fn fm_str_or(fm: &skills::Frontmatter, key: &str, fallback: Option<&str>) -> Option<String> {
    match skills::fm_get(fm, key) {
        Some(skills::FmValue::Str(v)) if !v.is_empty() => Some(v.clone()),
        _ => fallback.filter(|f| !f.is_empty()).map(str::to_string),
    }
}

fn fm_list(fm: &skills::Frontmatter, key: &str) -> Vec<String> {
    match skills::fm_get(fm, key) {
        Some(skills::FmValue::List(v)) => v.clone(),
        _ => Vec::new(),
    }
}

fn fm_true(fm: &skills::Frontmatter, key: &str) -> bool {
    matches!(skills::fm_get(fm, key), Some(skills::FmValue::Bool(true)))
}

pub async fn install(core: &Core, p: &Value) -> Result<Value> {
    let id = require(p, "id", "skills.install")?;
    let Some(entry) = registry_entry(core, &id).await? else {
        return Err(NoteDeckError::InvalidInput(format!(
            "skills.install: skill \"{id}\" not found in MisStore (try misstore.search first)"
        )));
    };
    let (source, hash) = fetch_verified_source(core, &entry).await?;
    let (fm, body) = skills::parse_skill_file(&source);
    let entry_str = |k: &str| Some(s(&entry, k)).filter(|v| !v.is_empty());
    let existing = skills::list(core)?;
    let mode = entry_str("mode").unwrap_or("manual").to_string();
    if let Some(cur) = existing
        .iter()
        .find(|sk| sk.store_id.as_deref() == Some(id.as_str()))
    {
        skills::update(
            core,
            &cur.id,
            SkillPatch {
                version: fm_str_or(&fm, "version", entry_str("version")),
                description: Some(fm_str_or(&fm, "description", entry_str("description"))),
                author: Some(fm_str_or(&fm, "author", entry_str("author"))),
                icon_url: Some(fm_str_or(&fm, "iconUrl", entry_str("iconUrl"))),
                triggers: Some(fm_list(&fm, "triggers")),
                cheap_check_capabilities: Some(fm_list(&fm, "cheapCheckCapabilities")),
                body: Some(body),
                is_persona: Some(fm_true(&fm, "isPersona")),
                store_id: Some(id.clone()),
                store_sha512: Some(hash),
                store_version: entry_str("version").map(str::to_string),
                ..Default::default()
            },
            None,
        )?;
    } else {
        let taken: Vec<String> = existing.iter().map(|sk| casefold(&sk.id)).collect();
        let new_id = resolve_available(&id, |c| taken.contains(&casefold(c)));
        skills::create(
            core,
            SkillMeta {
                id: new_id,
                name: fm_str_or(&fm, "name", entry_str("name")).unwrap_or_else(|| id.clone()),
                version: fm_str_or(&fm, "version", entry_str("version"))
                    .unwrap_or_else(|| DEFAULT_VERSION.into()),
                description: fm_str_or(&fm, "description", entry_str("description")),
                author: fm_str_or(&fm, "author", entry_str("author")),
                icon_url: fm_str_or(&fm, "iconUrl", entry_str("iconUrl")),
                mode: skills::normalize_mode(
                    skills::fm_get(&fm, "mode")
                        .and_then(|v| match v {
                            skills::FmValue::Str(m) => Some(m.as_str()),
                            _ => None,
                        })
                        .or(entry_str("mode")),
                ),
                triggers: fm_list(&fm, "triggers"),
                cheap_check_capabilities: fm_list(&fm, "cheapCheckCapabilities"),
                body,
                store_id: Some(id.clone()),
                store_sha512: Some(hash),
                store_version: entry_str("version").map(str::to_string),
                built_in: false,
                is_persona: fm_true(&fm, "isPersona"),
                ..Default::default()
            },
        )?;
    }
    Ok(json!({
        "id": s(&entry, "id"),
        "name": s(&entry, "name"),
        "mode": mode,
        "installed": true,
    }))
}

// --- 確認内容 ---

pub async fn preview(core: &Core, id: &str, p: &Value, ctx: &ExecContext) -> Result<Option<Value>> {
    Ok(match id {
        "skills.create" => {
            let name = s(p, "name").trim();
            let body = s(p, "body");
            if name.is_empty() || body.trim().is_empty() {
                return Ok(None);
            }
            let mode = skills::normalize_mode(p.get("mode").and_then(Value::as_str));
            let triggers = string_list(p.get("triggers"));
            let mode_note = match mode.as_str() {
                "always" => " mode=always: 保存後は常に system prompt に注入されます。".to_string(),
                "heartbeat" => {
                    " mode=heartbeat: HEARTBEAT 有効中、tick ごとに自動実行されます。".to_string()
                }
                "trigger" => format!(" (mode=trigger: 「{}」で自動ロード)", triggers.join("」「")),
                _ => " (mode=manual: 有効化するまで使われません)".to_string(),
            };
            Some(json!({
                "title": "スキルを作成",
                "message": format!("AI が生成したスキル「{name}」を新規保存します。{mode_note}"),
                "installPreview": { "kind": "skill", "name": name, "version": DEFAULT_VERSION, "description": format!("{mode} mode") },
                "code": body,
                "codeLanguage": "markdown",
                "okLabel": "作成",
                "cancelLabel": "やめる",
                "type": if mode == "always" || mode == "heartbeat" { "warning" } else { "normal" },
            }))
        }
        "skills.append" | "skills.replaceSection" => {
            let Some(cur) = skills::get(core, s(p, "id"))? else {
                return Ok(None);
            };
            let content = s(p, "content");
            let (next, title, message, ok, kind) = if id == "skills.append" {
                (
                    skills::append_block(&cur.body, content),
                    "スキル本文に追記",
                    format!(
                        "{} の本文に {} 文字を追記します。 frontmatter は触れません。",
                        cur.name,
                        char_len(content)
                    ),
                    "追記",
                    "normal",
                )
            } else {
                let heading = s(p, "heading");
                (
                    skills::replace_markdown_section(&cur.body, heading, content).0,
                    "スキルのセクションを置換",
                    format!(
                        "{} の `## {heading}` セクションを {} 文字に置換します。 該当 heading が無ければ末尾に新規追加します (idempotent)。",
                        cur.name,
                        char_len(content)
                    ),
                    "置換",
                    "warning",
                )
            };
            let next = staged::stage(staged::key(id, ctx, p), &cur.body, next);
            Some(json!({
                "title": title,
                "message": message,
                "installPreview": install_preview(&cur),
                "diff": { "old": cur.body, "new": next, "language": "markdown" },
                "okLabel": ok,
                "cancelLabel": "やめる",
                "type": kind,
            }))
        }
        "skills.revert" => {
            let Some(cur) = skills::get(core, s(p, "id"))? else {
                return Ok(None);
            };
            let index = index_of(p);
            if index < 0 {
                return Ok(None);
            }
            let entries = skills::history(core, &cur)?;
            let Some(entry) = entries.get(index as usize) else {
                return Ok(None);
            };
            let snapshot_body = entry
                .snapshot
                .get("body")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let next = staged::stage(staged::key(id, ctx, p), &cur.body, snapshot_body);
            Some(json!({
                "title": "スキルを過去の状態に戻す",
                "message": format!(
                    "{} を編集履歴 #{index} ({}) の本文に戻します。 現在の body は上書きされます。",
                    cur.name,
                    super::time::iso_from_unix_ms(entry.at as i64)
                ),
                "installPreview": install_preview(&cur),
                "diff": { "old": cur.body, "new": next, "language": "markdown" },
                "okLabel": "この状態に戻す",
                "cancelLabel": "やめる",
                "type": "warning",
            }))
        }
        "skills.install" => {
            let Some(entry) = registry_entry(core, s(p, "id")).await? else {
                return Ok(None);
            };
            let mode = s(&entry, "mode");
            let mode_note = if mode == "always" {
                " (mode=always: 常に system prompt に注入されます)".to_string()
            } else {
                format!(" (mode={})", if mode.is_empty() { "manual" } else { mode })
            };
            // 既存 (同じ storeId) の更新なら、本文の diff を 1 枚目に載せる
            let store_id = s(&entry, "id");
            let existing = skills::list(core)?
                .into_iter()
                .find(|sk| sk.store_id.as_deref() == Some(store_id));
            let mut out = json!({
                "title": if existing.is_some() { "MisStore からスキルを更新" } else { "MisStore からスキルを入れる" },
                "message": format!(
                    "{} (v{} / by {}) を MisStore から取得します。{mode_note}",
                    s(&entry, "name"), s(&entry, "version"), s(&entry, "author")
                ),
                "installPreview": {
                    "kind": "skill",
                    "name": s(&entry, "name"),
                    "version": s(&entry, "version"),
                    "author": s(&entry, "author"),
                    "description": s(&entry, "description"),
                },
                "code": s(&entry, "description"),
                "codeLanguage": "plaintext",
                "okLabel": if existing.is_some() { "更新" } else { "インストール" },
                "cancelLabel": "やめる",
                "type": "normal",
            });
            if let Some(cur) = existing {
                match fetch_verified_source(core, &entry).await {
                    Ok((source, _)) => {
                        let (_, body) = skills::parse_skill_file(&source);
                        out["message"] = Value::String(format!(
                            "{} 既存の「{}」を更新します。",
                            out["message"].as_str().unwrap_or(""),
                            cur.name
                        ));
                        out["diff"] =
                            json!({ "old": cur.body, "new": body, "language": "markdown" });
                    }
                    Err(e) => {
                        tracing::warn!(store_id, "MisStore source unavailable for preview: {e}")
                    }
                }
            }
            return Ok(Some(out));
        }
        "skills.uninstall" => {
            let Some(cur) = skills::get(core, s(p, "id"))? else {
                return Ok(None);
            };
            Some(json!({
                "title": "スキルを削除",
                "message": format!(
                    "{} (v{} / {} mode) を完全に削除します。 frontmatter・本文・編集履歴ファイルは残りません (= 不可逆)。",
                    cur.name, cur.version, cur.mode
                ),
                "installPreview": install_preview(&cur),
                "okLabel": "削除",
                "cancelLabel": "やめる",
                "type": "danger",
            }))
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
        core
    }

    #[test]
    fn create_validates_like_ts() {
        let ctx = ExecContext::default();
        let err = |p: Value| create_input(&p, &ctx).unwrap_err().to_string();
        assert!(err(json!({})).contains("skills.create: name is required"));
        assert!(err(json!({"name": "x"})).contains("skills.create: body is required"));
        assert!(
            err(json!({"name": "x", "body": "---\nid: y\n---\nb"})).contains("frontmatter block")
        );
        assert!(err(json!({"name": "x", "body": "b", "mode": "trigger"}))
            .contains("requires non-empty triggers"));
        let ok = create_input(
            &json!({"name": " N ", "body": "b", "mode": "weird", "description": ""}),
            &ctx,
        )
        .unwrap();
        assert_eq!(ok.name, "N");
        assert_eq!(ok.mode, "manual");
        assert_eq!(ok.description, None);
        let id = generate_skill_id("My Skill!");
        assert!(id.starts_with("my-skill-") && id.len() == "my-skill-".len() + 4);
    }

    #[tokio::test]
    async fn append_uses_staged_text_and_marks_taint() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let ctx = ExecContext {
            principal: "ai.chat".into(),
            tainted: true,
            ..Default::default()
        };
        create(
            &core,
            &json!({"name": "A", "body": "# 見出し\n\n既存の本文"}),
            &ctx,
        )
        .unwrap();
        let id = skills::list(&core).unwrap()[0].id.clone();
        let p = json!({"id": id, "content": "追記した行", "reason": " why "});
        let pv = preview(&core, "skills.append", &p, &ctx)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(pv["diff"]["new"], "# 見出し\n\n既存の本文\n追記した行");
        let out = append(&core, &p, &ctx).unwrap();
        assert_eq!(
            out["length"],
            char_len("# 見出し\n\n既存の本文\n追記した行")
        );
        let sk = skills::get(&core, &id).unwrap().unwrap();
        assert_eq!(sk.tainted, Some(true));
        let (read_v, tainted) = read(&core, &json!({"id": id})).unwrap();
        assert!(tainted);
        assert_eq!(read_v["body"], "# 見出し\n\n既存の本文\n追記した行");
        let h = history(&core, &json!({"id": id})).unwrap();
        assert_eq!(h[0]["reason"], "why");
        assert_eq!(h[0]["by"]["kind"], "ai.chat");
        // 確認後に対象が変われば中止
        let p2 = json!({"id": id, "content": "x"});
        preview(&core, "skills.append", &p2, &ctx).await.unwrap();
        skills::update(
            &core,
            &id,
            SkillPatch {
                body: Some("changed".into()),
                ..Default::default()
            },
            None,
        )
        .unwrap();
        let err = append(&core, &p2, &ctx).unwrap_err().to_string();
        assert!(err.contains("確認後に対象が変更された"));
        // revert は index 0 (直前) に戻す
        let rv = revert(&core, &json!({"id": id, "index": 0}), &ctx).unwrap();
        assert_eq!(rv["reverted"], true);
        let rp = replace_section(
            &core,
            &json!({"id": id, "heading": "New", "content": "c"}),
            &ctx,
        )
        .unwrap();
        assert_eq!(rp["replaced"], false);
        assert_eq!(
            toggle(&core, &json!({"id": id, "active": true})).unwrap()["active"],
            true
        );
        assert_eq!(
            uninstall(&core, &json!({"id": id})).unwrap()["removed"],
            true
        );
        assert!(uninstall(&core, &json!({"id": id}))
            .unwrap_err()
            .to_string()
            .contains("is not installed"));
    }

    #[test]
    fn sha512_is_lowercase_hex() {
        assert_eq!(sha512_hex("").len(), 128);
        assert_eq!(sha512_hex("a")[..8].to_string(), "1f40fc92");
    }
}
