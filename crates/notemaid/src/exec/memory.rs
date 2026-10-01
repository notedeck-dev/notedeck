//! AI 自身の記憶と人格の更新 (`memory.update` / `soul.propose`、#1162)。
//! 本体は `crate::workspace`。ここは引数の解釈、USER OFF の拒否、無人の拒否、
//! 書込後の後始末 (hash の記録 / BOOTSTRAP の削除) と確認内容の組み立て。

use serde_json::{json, Value};

use super::preview::confirm;
use super::ExecContext;
use crate::ai_config;
use crate::workspace::{self, Action, Kind, UpdateError};
use notecli::error::NoteDeckError;
use notecore::context::Core;
use notecore::error::Result;
use notecore::i18n::text;

fn s<'a>(p: &'a Value, k: &str) -> Option<&'a str> {
    p.get(k).and_then(Value::as_str)
}

fn invalid(msg: impl Into<String>) -> NoteDeckError {
    NoteDeckError::InvalidInput(msg.into())
}

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

struct Target {
    kind: Kind,
    action: Action,
}

fn parse_target(p: &Value) -> Result<Target> {
    let action = Action::parse(s(p, "action").unwrap_or(""))
        .ok_or_else(|| invalid("memory.update: action must be add / replace / remove"))?;
    let kind = match s(p, "target").unwrap_or("") {
        "user" => Kind::User,
        "memory" => Kind::Memory,
        _ => return Err(invalid("memory.update: target must be user / memory")),
    };
    Ok(Target { kind, action })
}

fn usage_json(u: workspace::Usage) -> Value {
    json!({ "chars": u.chars, "limit": u.limit })
}

/// 無人実行 (HEARTBEAT) からは書かない。ターン実行器も宣言 (`unattendedDeny`) で
/// 止めるが、本体側でも守る
fn deny_unattended(ctx: &ExecContext, id: &str) -> Result<()> {
    if ctx.principal == "ai.heartbeat" {
        return Err(invalid(format!(
            "{id}: not available to unattended runs (HEARTBEAT). Leave a memo instead"
        )));
    }
    Ok(())
}

/// 書いたあとの後始末: 内容 hash を記録し、BOOTSTRAP の役目が済んでいれば消す
fn after_write(app_dir: &std::path::Path, kind: Kind, body: &str, user_memory: bool) {
    workspace::record_hash(app_dir, kind, body);
    if workspace::bootstrap_done(app_dir, user_memory) {
        workspace::remove_bootstrap(app_dir);
    }
}

/// `memory.update`: 1 項目の add / replace / remove。上限超過などは Err ではなく
/// `{ success: false, error, current_entries, usage }` で返し、AI 自身に整理させる (Hermes と同形)
pub fn update(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    deny_unattended(ctx, "memory.update")?;
    let t = parse_target(p)?;
    let app_dir = core.app_dir()?;
    let cfg = ai_config::load(core)?;
    if t.kind == Kind::User && !cfg.user_memory {
        return Err(invalid(
            "memory.update: memory about the person is off. Do not record facts about them",
        ));
    }
    workspace::seed(app_dir, &workspace::language(app_dir))?;
    let body = workspace::read(app_dir, t.kind)?.unwrap_or_default();
    match workspace::update(
        t.kind,
        &body,
        t.action,
        s(p, "content"),
        s(p, "old_text"),
        &today(),
    ) {
        Ok(updated) => {
            if updated.changed {
                workspace::write(app_dir, t.kind, &updated.body)?;
                after_write(app_dir, t.kind, &updated.body, cfg.user_memory);
            }
            Ok(json!({
                "success": true,
                "changed": updated.changed,
                "current_entries": updated.entries,
                "usage": usage_json(updated.usage),
            }))
        }
        Err(e) => {
            let (entries, usage) = match &e {
                UpdateError::Overflow { entries, usage } => (entries.clone(), *usage),
                _ => (
                    workspace::entries(t.kind, &body),
                    workspace::usage(t.kind, &body),
                ),
            };
            Ok(json!({
                "success": false,
                "error": e.message(),
                "current_entries": entries,
                "usage": usage_json(usage),
            }))
        }
    }
}

/// `soul.propose`: 人が承認した全文で SOUL.md を置き換える (確認はターン実行器が
/// 毎回出す。ここに来た時点で承認済み)
pub fn propose_soul(core: &Core, p: &Value, ctx: &ExecContext) -> Result<Value> {
    deny_unattended(ctx, "soul.propose")?;
    let body = s(p, "body")
        .map(str::trim)
        .filter(|b| !b.is_empty())
        .ok_or_else(|| invalid("soul.propose: body is required"))?;
    if workspace::has_invisible_unicode(body) {
        return Err(invalid(UpdateError::InvisibleUnicode.message()));
    }
    let u = workspace::usage(Kind::Soul, body);
    if u.over() {
        return Err(invalid(format!(
            "soul.propose: SOUL.md would be {} chars, the limit is {}",
            u.chars, u.limit
        )));
    }
    let app_dir = core.app_dir()?;
    let cfg = ai_config::load(core)?;
    let text = format!("{body}\n");
    workspace::write(app_dir, Kind::Soul, &text)?;
    after_write(app_dir, Kind::Soul, &text, cfg.user_memory);
    Ok(json!({ "success": true, "usage": usage_json(u) }))
}

/// 人間語の差分 1 行 (確認カードと tool カードに使う)。例: 「あなたについて: + Always …」
pub fn human_line(p: &Value) -> Option<String> {
    let t = parse_target(p).ok()?;
    let target = match t.kind {
        Kind::User => "user",
        _ => "memory",
    };
    let content = s(p, "content").unwrap_or("").trim();
    let old = s(p, "old_text").unwrap_or("").trim();
    Some(match t.action {
        Action::Add => format!("{target}: + {content}"),
        Action::Replace => format!("{target}: {old} → {content}"),
        Action::Remove => format!("{target}: − {old}"),
    })
}

/// 確認内容。`memory.update` は項目の差分 1 行 + ファイル全文の diff、
/// `soul.propose` は理由 + 全文の diff
pub fn preview(core: &Core, id: &str, p: &Value, _ctx: &ExecContext) -> Result<Option<Value>> {
    let app_dir = core.app_dir()?;
    match id {
        "memory.update" => {
            let t = parse_target(p)?;
            let before = workspace::read(app_dir, t.kind)?.unwrap_or_default();
            let after = match workspace::update(
                t.kind,
                &before,
                t.action,
                s(p, "content"),
                s(p, "old_text"),
                &today(),
            ) {
                Ok(u) if !u.changed => return Ok(None),
                Ok(u) => u.body,
                // 失敗する書込は確認を出さず、実行で error を返して AI に直させる
                Err(_) => return Ok(None),
            };
            let target_key = if t.kind == Kind::User {
                "user"
            } else {
                "memory"
            };
            let action_key = match t.action {
                Action::Add => "add",
                Action::Replace => "replace",
                Action::Remove => "remove",
            };
            Ok(Some(confirm(
                "warning",
                text(
                    &format!("_native.preview.memory.update.title.{target_key}"),
                    json!({}),
                ),
                Some(text(
                    &format!("_native.preview.memory.update.{action_key}"),
                    json!({
                        "content": s(p, "content").unwrap_or(""),
                        "old": s(p, "old_text").unwrap_or(""),
                    }),
                )),
                text("_native.preview.memory.update.ok", json!({})),
                json!({
                    "diff": { "old": before, "new": after, "language": "markdown" },
                }),
            )))
        }
        "soul.propose" => {
            let before = workspace::read(app_dir, Kind::Soul)?.unwrap_or_default();
            let after = format!("{}\n", s(p, "body").unwrap_or("").trim());
            let reason = s(p, "reason").unwrap_or("").trim().to_string();
            let message = if reason.is_empty() {
                text("_native.preview.soul.propose.message", json!({}))
            } else {
                text(
                    "_native.preview.soul.propose.messageWithReason",
                    json!({ "reason": reason }),
                )
            };
            Ok(Some(confirm(
                "warning",
                text("_native.preview.soul.propose.title", json!({})),
                Some(message),
                text("_native.preview.soul.propose.ok", json!({})),
                json!({
                    "diff": { "old": before, "new": after, "language": "markdown" },
                }),
            )))
        }
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notecore::context::Core;

    fn core_in(dir: &std::path::Path) -> Core {
        let core = Core::new();
        core.set_app_dir(dir.to_path_buf());
        core
    }

    fn ctx(principal: &str) -> ExecContext {
        ExecContext {
            principal: principal.into(),
            account_id: None,
            tainted: false,
            plugin_id: None,
        }
    }

    #[test]
    fn update_writes_user_entries_and_reports_entries_and_usage() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let v = update(
            &core,
            &json!({"action": "add", "target": "user", "content": "Always call them Taka"}),
            &ctx("ai.chat"),
        )
        .unwrap();
        assert_eq!(v["success"], true);
        assert_eq!(v["current_entries"], json!(["Always call them Taka"]));
        assert!(v["usage"]["chars"].as_u64().unwrap() > 0);
        let on_disk = workspace::read(dir.path(), Kind::User).unwrap().unwrap();
        assert!(on_disk.contains("- Always call them Taka"));
        // 相手の情報が書かれたので BOOTSTRAP は役目を終える
        assert!(!workspace::path(dir.path(), Kind::Bootstrap).exists());
        // 失敗は Err ではなく success: false (AI に直させる)
        let v = update(
            &core,
            &json!({"action": "remove", "target": "user", "old_text": "nothing like this"}),
            &ctx("ai.chat"),
        )
        .unwrap();
        assert_eq!(v["success"], false);
        assert!(v["error"].as_str().unwrap().contains("no entry"));
    }

    #[test]
    fn unattended_runs_and_user_memory_off_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let p = json!({"action": "add", "target": "memory", "content": "x"});
        assert!(update(&core, &p, &ctx("ai.heartbeat")).is_err());
        assert!(propose_soul(&core, &json!({"body": "# SOUL"}), &ctx("ai.heartbeat")).is_err());
        std::fs::create_dir_all(dir.path().join("notedeck")).unwrap();
        std::fs::write(
            dir.path().join("notedeck/ai.json5"),
            "{ userMemory: false }",
        )
        .unwrap();
        let p = json!({"action": "add", "target": "user", "content": "x"});
        let e = update(&core, &p, &ctx("ai.chat")).unwrap_err();
        assert!(e.to_string().contains("off"));
        // memory 側は書ける
        let v = update(
            &core,
            &json!({"action": "add", "target": "memory", "content": "Uses misskey.io"}),
            &ctx("ai.chat"),
        )
        .unwrap();
        assert_eq!(v["success"], true);
    }

    #[test]
    fn soul_propose_replaces_the_file_and_previews_a_diff() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        workspace::seed(dir.path(), "en").unwrap();
        let pv = preview(
            &core,
            "soul.propose",
            &json!({"body": "# SOUL.md\n\nI am Mei.", "reason": "decided a name"}),
            &ctx("ai.chat"),
        )
        .unwrap()
        .unwrap();
        assert_eq!(pv["diff"]["language"], "markdown");
        assert!(pv["diff"]["old"].as_str().unwrap().contains("Core Truths"));
        assert_eq!(pv["diff"]["new"], "# SOUL.md\n\nI am Mei.\n");
        let v = propose_soul(
            &core,
            &json!({"body": "# SOUL.md\n\nI am Mei."}),
            &ctx("ai.chat"),
        )
        .unwrap();
        assert_eq!(v["success"], true);
        assert_eq!(
            workspace::read(dir.path(), Kind::Soul).unwrap().unwrap(),
            "# SOUL.md\n\nI am Mei.\n"
        );
        assert!(!workspace::path(dir.path(), Kind::Bootstrap).exists());
        // 変わらない書込 (重複 add) は確認を出さない
        let pv = preview(
            &core,
            "memory.update",
            &json!({"action": "add", "target": "memory", "content": "a"}),
            &ctx("ai.chat"),
        )
        .unwrap();
        assert!(pv.is_some());
        update(
            &core,
            &json!({"action": "add", "target": "memory", "content": "a"}),
            &ctx("ai.chat"),
        )
        .unwrap();
        let pv = preview(
            &core,
            "memory.update",
            &json!({"action": "add", "target": "memory", "content": "a"}),
            &ctx("ai.chat"),
        )
        .unwrap();
        assert!(pv.is_none());
        assert_eq!(
            human_line(&json!({"action": "replace", "target": "user", "old_text": "Taka", "content": "たか"}))
                .as_deref(),
            Some("user: Taka → たか")
        );
    }
}
