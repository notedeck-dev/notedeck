//! AI の persona と自己参照の読取 (`ai.listPersonas` / `ai.setPersona` /
//! `meta.persona` / `meta.activeSkills` / `meta.config` / `meta.heartbeat`)。
//! 正本は skill ファイルと `ai.json5` (persona の切替は notecore が書き、デバイスの
//! `useAiConfig` は変更通知で読み直す)。

use serde_json::{json, Value};

use super::preview::confirm;
use super::ExecContext;
use crate::ai_config;
use crate::context::Core;
use crate::error::Result;
use crate::i18n::text;
use crate::permissions_gate;
use crate::permissions_profile::PrincipalId;
use crate::skills;
use notecli::error::NoteDeckError;

fn s<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or("")
}

fn invalid(msg: String) -> NoteDeckError {
    NoteDeckError::InvalidInput(msg)
}

pub fn list_personas(core: &Core) -> Result<Value> {
    let current = ai_config::load(core)?.persona_skill_id;
    Ok(Value::Array(
        skills::list(core)?
            .iter()
            .filter(|sk| sk.is_persona)
            .map(|sk| {
                json!({
                    "id": sk.id,
                    "name": sk.name,
                    "description": sk.description,
                    "mode": sk.mode,
                    "active": sk.id == current,
                })
            })
            .collect(),
    ))
}

pub fn set_persona(core: &Core, p: &Value) -> Result<Value> {
    let skill_id = s(p, "skillId");
    if skill_id.is_empty() {
        ai_config::set_persona_skill_id(core, "")?;
        return Ok(json!({ "personaSkillId": "", "persona": Value::Null }));
    }
    let Some(skill) = skills::get(core, skill_id)? else {
        return Err(invalid(format!(
            "ai.setPersona: skill \"{skill_id}\" not found"
        )));
    };
    if !skill.is_persona {
        return Err(invalid(format!(
            "ai.setPersona: skill \"{skill_id}\" ({}) is not flagged as persona",
            skill.name
        )));
    }
    ai_config::set_persona_skill_id(core, skill_id)?;
    Ok(json!({
        "personaSkillId": skill_id,
        "persona": { "id": skill.id, "name": skill.name },
    }))
}

/// `meta.persona`: 現在の persona `{ id, name }`、無ければ null
pub fn meta_persona(core: &Core) -> Result<Value> {
    let id = ai_config::load(core)?.persona_skill_id;
    if id.is_empty() {
        return Ok(Value::Null);
    }
    Ok(match skills::get(core, &id)? {
        Some(sk) => json!({ "id": sk.id, "name": sk.name }),
        None => Value::Null,
    })
}

/// `meta.activeSkills`: mode=always か明示的に有効な skill
pub fn meta_active_skills(core: &Core) -> Result<Value> {
    Ok(Value::Array(
        skills::list(core)?
            .iter()
            .filter(|sk| sk.mode == "always" || sk.active == Some(true))
            .map(|sk| {
                json!({ "id": sk.id, "name": sk.name, "mode": sk.mode, "isPersona": sk.is_persona })
            })
            .collect(),
    ))
}

/// `meta.config`: 接続のプロトコルとモデル、dataSources の有効フラグ (機密は出さない)
pub fn meta_config(core: &Core) -> Result<Value> {
    let cfg = ai_config::load(core)?;
    let protocol = if cfg.active_connection_id.is_empty() {
        String::new()
    } else {
        core.app_dir()
            .ok()
            .and_then(|dir| {
                crate::ai_chat_service::resolve_connection(dir, &cfg.active_connection_id).ok()
            })
            .and_then(|c| serde_json::to_value(c.protocol).ok())
            .and_then(|v| v.as_str().map(str::to_string))
            .unwrap_or_default()
    };
    let ds = &cfg.data_sources;
    Ok(json!({
        "protocol": protocol,
        "model": cfg.model_for_active().unwrap_or_default(),
        "dataSourcesEnabled": {
            "currentAccount": ds.current_account,
            "currentColumn": ds.current_column,
            "visibleNotes": ds.visible_notes,
            "recentConversation": ds.recent_conversation,
            "memos": ds.memos,
        },
    }))
}

/// `meta.heartbeat`: HEARTBEAT の設定の断面 (編集は塞ぐ)。権限は preset 名だけ
pub async fn meta_heartbeat(core: &Core) -> Result<Value> {
    let hb = ai_config::load(core)?.heartbeat;
    let (preset, _) = permissions_gate::profile_for(PrincipalId::AiHeartbeat).await;
    Ok(json!({
        "enabled": hb.enabled,
        "intervalMinutes": hb.interval_minutes,
        "target": hb.target,
        "dailyMaxAiRuns": hb.daily_max_ai_runs,
        "onDailyLimit": hb.on_daily_limit,
        "desktopNotification": hb.desktop_notification,
        "cheapCheck": { "enabled": hb.cheap_check.enabled, "maxSkipHours": hb.cheap_check.max_skip_hours },
        "permissionsPreset": preset,
    }))
}

pub fn preview(core: &Core, id: &str, p: &Value, _ctx: &ExecContext) -> Result<Option<Value>> {
    if id != "ai.setPersona" {
        return Ok(None);
    }
    let skill_id = s(p, "skillId");
    let message = if skill_id.is_empty() {
        text("_native.preview.persona.set.clearMessage", json!({}))
    } else {
        match skills::get(core, skill_id)? {
            Some(sk) => text(
                "_native.preview.persona.set.switchMessage",
                json!({ "name": sk.name }),
            ),
            None => text(
                "_native.preview.persona.set.unknownMessage",
                json!({ "id": skill_id }),
            ),
        }
    };
    Ok(Some(confirm(
        "warning",
        text("_native.preview.persona.set.title", json!({})),
        Some(message),
        text("_native.preview.common.switch", json!({})),
        json!({}),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put_skill(base: &std::path::Path, name: &str, body: &str) {
        std::fs::create_dir_all(base.join("skills")).unwrap();
        std::fs::write(base.join("skills").join(name), body).unwrap();
    }

    #[test]
    fn persona_switch_and_meta_reads() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let base = crate::commands::settings::settings_base_dir(&core).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        put_skill(&base, "p.md", "---\nid: p\nname: Persona P\nversion: '1'\nmode: manual\nisPersona: true\n---\nhello\n");
        put_skill(
            &base,
            "a.md",
            "---\nid: a\nname: Always A\nversion: '1'\nmode: always\n---\nbody\n",
        );
        let ctx = ExecContext::default();
        assert_eq!(meta_persona(&core).unwrap(), Value::Null);
        let l = list_personas(&core).unwrap();
        assert_eq!(l.as_array().unwrap().len(), 1);
        assert_eq!(l[0]["active"], false);
        assert!(set_persona(&core, &json!({"skillId": "zz"}))
            .unwrap_err()
            .to_string()
            .contains("skill \"zz\" not found"));
        assert!(set_persona(&core, &json!({"skillId": "a"}))
            .unwrap_err()
            .to_string()
            .contains("(Always A) is not flagged as persona"));
        let r = set_persona(&core, &json!({"skillId": "p"})).unwrap();
        assert_eq!(r["persona"]["name"], "Persona P");
        assert_eq!(
            meta_persona(&core).unwrap(),
            json!({ "id": "p", "name": "Persona P" })
        );
        assert_eq!(list_personas(&core).unwrap()[0]["active"], true);
        let active = meta_active_skills(&core).unwrap();
        assert_eq!(active.as_array().unwrap().len(), 1);
        assert_eq!(active[0]["id"], "a");
        let pv = preview(&core, "ai.setPersona", &json!({"skillId": "p"}), &ctx)
            .unwrap()
            .unwrap();
        assert_eq!(pv["message"], "Switches the AI persona to \"Persona P\". This applies to every chat / heartbeat / command / task session.");
        let pv = preview(&core, "ai.setPersona", &json!({"skillId": "zz"}), &ctx)
            .unwrap()
            .unwrap();
        assert!(pv["message"]
            .as_str()
            .unwrap()
            .contains("unknown skill id \"zz\""));
        let pv = preview(&core, "ai.setPersona", &json!({}), &ctx)
            .unwrap()
            .unwrap();
        assert_eq!(pv["okLabel"], "Switch");
        assert_eq!(
            set_persona(&core, &json!({})).unwrap(),
            json!({ "personaSkillId": "", "persona": null })
        );
        let cfg = meta_config(&core).unwrap();
        assert_eq!(cfg["protocol"], "");
        assert_eq!(cfg["dataSourcesEnabled"]["memos"], true);
    }
}
