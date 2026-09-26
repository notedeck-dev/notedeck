//! `ai.json5` の読取 (notecore が要る断面だけ) と HEARTBEAT の有効フラグの書換。
//!
//! 正本のスキーマと正規化はデバイスの `useAiConfig.ts` (既定値は
//! `src/defaults/ai.json5`)。ここは HEARTBEAT daemon が要る値だけを同じ規則で読む。

use serde_json::Value;

use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::error::Result;
use crate::settings_events;
use crate::settings_store as store;

pub const FILE_NAME: &str = "ai.json5";

#[derive(Clone, Debug, PartialEq)]
pub struct CheapCheckConfig {
    pub enabled: bool,
    pub max_skip_hours: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct HeartbeatConfig {
    pub enabled: bool,
    pub interval_minutes: u32,
    /// `auto` / `none` / セッション id
    pub target: String,
    pub cheap_check: CheapCheckConfig,
    pub daily_max_ai_runs: u32,
    /// `warn` / `disable`
    pub on_daily_limit: String,
    pub desktop_notification: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GenerationConfig {
    pub max_tokens: u32,
    pub max_tool_rounds: u32,
    pub title_max_tokens: u32,
    pub read_timeout_seconds: u32,
}

/// system prompt に含める情報の選択 (`dataSources.custom`)
#[derive(Clone, Debug, PartialEq)]
pub struct DataSources {
    pub current_account: bool,
    pub current_column: bool,
    pub visible_notes: bool,
    pub recent_conversation: bool,
    pub memos: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiConfigLite {
    pub active_connection_id: String,
    /// persona として立てる skill の id (空 = persona なし)
    pub persona_skill_id: String,
    pub data_sources: DataSources,
    /// 接続 id → モデル名
    pub models: std::collections::HashMap<String, String>,
    pub heartbeat: HeartbeatConfig,
    pub generation: GenerationConfig,
    /// 接続 id → 日次 token 予算 (0 / 無し = 無制限、#1133 縦切り 6)
    pub budgets: std::collections::HashMap<String, u64>,
}

impl AiConfigLite {
    /// 接続の日次 token 予算。None = 無制限
    pub fn daily_budget_for(&self, connection_id: &str) -> Option<u64> {
        self.budgets.get(connection_id).copied().filter(|n| *n > 0)
    }

    pub fn model_for_active(&self) -> Option<String> {
        if self.active_connection_id.is_empty() {
            return None;
        }
        self.models
            .get(&self.active_connection_id)
            .filter(|m| !m.is_empty())
            .cloned()
    }
}

fn clamp_int(v: Option<&Value>, default: u32, min: u32, max: u32) -> u32 {
    match v.and_then(Value::as_f64) {
        Some(n) if n.is_finite() => (n.floor().max(0.0) as u32).clamp(min, max),
        _ => default,
    }
}

fn get<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = v;
    for p in path {
        cur = cur.get(p)?;
    }
    Some(cur)
}

/// パース済み文書 → 断面。欠損 / 型違いは既定値 (`normalizeHeartbeatConfig` /
/// `normalizeGenerationConfig` と同じ)。
pub fn from_document(doc: &Value) -> AiConfigLite {
    let hb = |k: &str| get(doc, &["heartbeat", k]);
    let target = match hb("target").and_then(Value::as_str) {
        Some(t) if !t.is_empty() => t.to_string(),
        _ => "auto".to_string(),
    };
    let ds = |k: &str, default: bool| {
        get(doc, &["dataSources", "custom", k])
            .and_then(Value::as_bool)
            .unwrap_or(default)
    };
    AiConfigLite {
        active_connection_id: doc
            .get("activeConnectionId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        persona_skill_id: doc
            .get("personaSkillId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        data_sources: DataSources {
            current_account: ds("currentAccount", true),
            current_column: ds("currentColumn", true),
            visible_notes: ds("visibleNotes", false),
            recent_conversation: ds("recentConversation", false),
            memos: ds("memos", true),
        },
        models: doc
            .get("models")
            .and_then(Value::as_object)
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default(),
        heartbeat: HeartbeatConfig {
            enabled: hb("enabled").and_then(Value::as_bool) == Some(true),
            interval_minutes: clamp_int(hb("intervalMinutes"), 30, 1, 1440),
            target,
            cheap_check: CheapCheckConfig {
                enabled: get(doc, &["heartbeat", "cheapCheck", "enabled"]).and_then(Value::as_bool)
                    != Some(false),
                max_skip_hours: clamp_int(
                    get(doc, &["heartbeat", "cheapCheck", "maxSkipHours"]),
                    24,
                    1,
                    168,
                ),
            },
            daily_max_ai_runs: clamp_int(hb("dailyMaxAiRuns"), 48, 1, 1000),
            on_daily_limit: if hb("onDailyLimit").and_then(Value::as_str) == Some("disable") {
                "disable".into()
            } else {
                "warn".into()
            },
            desktop_notification: hb("desktopNotification").and_then(Value::as_bool) != Some(false),
        },
        budgets: doc
            .get("budgets")
            .and_then(Value::as_object)
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| {
                        v.as_f64()
                            .filter(|n| n.is_finite() && *n >= 0.0)
                            .map(|n| (k.clone(), n.floor() as u64))
                    })
                    .collect()
            })
            .unwrap_or_default(),
        generation: GenerationConfig {
            max_tokens: clamp_int(get(doc, &["generation", "maxTokens"]), 4096, 1, 1_000_000),
            max_tool_rounds: clamp_int(get(doc, &["generation", "maxToolRounds"]), 10, 1, 100),
            title_max_tokens: clamp_int(
                get(doc, &["generation", "titleMaxTokens"]),
                512,
                1,
                100_000,
            ),
            read_timeout_seconds: clamp_int(
                get(doc, &["generation", "readTimeoutSeconds"]),
                120,
                1,
                3600,
            ),
        },
    }
}

fn read_document(core: &Core) -> Result<Value> {
    read_document_in(&settings_base_dir(core)?)
}

/// 設定ディレクトリ (`<app dir>/notedeck`) から読む (Core を持たない呼び出し元用)。
pub fn load_from_app_dir(app_dir: &std::path::Path) -> AiConfigLite {
    let base = app_dir.join(crate::commands::settings::SETTINGS_DIR);
    from_document(&read_document_in(&base).unwrap_or(Value::Object(Default::default())))
}

fn read_document_in(base: &std::path::Path) -> Result<Value> {
    match store::read_root_file(base, FILE_NAME) {
        Ok(text) if !text.trim().is_empty() => {
            Ok(json5::from_str::<Value>(&text).unwrap_or_else(|e| {
                tracing::warn!("ai.json5 parse failed, using defaults: {e}");
                Value::Object(Default::default())
            }))
        }
        _ => Ok(Value::Object(Default::default())),
    }
}

pub fn load(core: &Core) -> Result<AiConfigLite> {
    Ok(from_document(&read_document(core)?))
}

/// `heartbeat.enabled` だけを書き換える (他のキーは保つ)。書けたら変更通知。
/// persona の切替 (`ai.setPersona`)。空文字 = persona なし。
pub fn set_persona_skill_id(core: &Core, skill_id: &str) -> Result<()> {
    let mut doc = read_document(core)?;
    if !doc.is_object() {
        doc = Value::Object(Default::default());
    }
    doc.as_object_mut()
        .expect("object")
        .insert("personaSkillId".into(), Value::String(skill_id.to_string()));
    let text = serde_json::to_string_pretty(&doc)? + "\n";
    settings_events::write_root_file(core, FILE_NAME, &text)
}

pub fn set_heartbeat_enabled(core: &Core, enabled: bool) -> Result<()> {
    let mut doc = read_document(core)?;
    if !doc.is_object() {
        doc = Value::Object(Default::default());
    }
    let obj = doc.as_object_mut().expect("object");
    let hb = obj
        .entry("heartbeat")
        .or_insert_with(|| Value::Object(Default::default()));
    if !hb.is_object() {
        *hb = Value::Object(Default::default());
    }
    hb.as_object_mut()
        .expect("object")
        .insert("enabled".into(), Value::Bool(enabled));
    let text = serde_json::to_string_pretty(&doc)? + "\n";
    settings_events::write_root_file(core, FILE_NAME, &text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn defaults_and_clamps_match_use_ai_config() {
        let c = from_document(&json!({}));
        assert_eq!(c.persona_skill_id, "");
        assert!(c.data_sources.current_account && c.data_sources.memos);
        assert!(!c.data_sources.visible_notes);
        let c2 = from_document(
            &json!({ "personaSkillId": "p", "dataSources": { "custom": { "memos": false } } }),
        );
        assert_eq!(c2.persona_skill_id, "p");
        assert!(!c2.data_sources.memos);
        assert!(!c.heartbeat.enabled);
        assert_eq!(c.heartbeat.interval_minutes, 30);
        assert_eq!(c.heartbeat.target, "auto");
        assert!(c.heartbeat.cheap_check.enabled);
        assert_eq!(c.heartbeat.cheap_check.max_skip_hours, 24);
        assert_eq!(c.heartbeat.daily_max_ai_runs, 48);
        assert_eq!(c.heartbeat.on_daily_limit, "warn");
        assert!(c.heartbeat.desktop_notification);
        assert_eq!(c.generation.max_tool_rounds, 10);
        assert!(c.budgets.is_empty());
        let c = from_document(&json!({
            "activeConnectionId": "c1", "models": {"c1": "m"}, "budgets": {"c1": 5000.7, "c2": 0, "c3": "x"},
            "heartbeat": {"enabled": true, "intervalMinutes": 99999, "target": "", "onDailyLimit": "disable", "cheapCheck": {"enabled": false}}
        }));
        assert_eq!(c.model_for_active().as_deref(), Some("m"));
        assert_eq!(c.daily_budget_for("c1"), Some(5000));
        assert_eq!(c.daily_budget_for("c2"), None);
        assert_eq!(c.daily_budget_for("c3"), None);
        assert_eq!(c.heartbeat.interval_minutes, 1440);
        assert_eq!(c.heartbeat.target, "auto");
        assert_eq!(c.heartbeat.on_daily_limit, "disable");
        assert!(!c.heartbeat.cheap_check.enabled);
    }

    #[test]
    fn set_enabled_keeps_other_keys() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let base = settings_base_dir(&core).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        store::write_root_file(
            &base,
            FILE_NAME,
            "{ activeConnectionId: 'c', heartbeat: { enabled: true, intervalMinutes: 5 } }",
        )
        .unwrap();
        set_heartbeat_enabled(&core, false).unwrap();
        let c = load(&core).unwrap();
        assert!(!c.heartbeat.enabled);
        assert_eq!(c.heartbeat.interval_minutes, 5);
        assert_eq!(c.active_connection_id, "c");
    }
}
