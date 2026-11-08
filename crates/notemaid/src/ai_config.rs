//! `ai.json5` の読取 (notecore が要る断面だけ) と HEARTBEAT の有効フラグの書換。
//!
//! 正本のスキーマと正規化はデバイスの `useAiConfig.ts` (既定値は
//! `src/defaults/ai.json5`)。ここは HEARTBEAT daemon が要る値だけを同じ規則で読む。

use serde_json::Value;

use notecore::commands::settings::settings_base_dir;
use notecore::context::Core;
use notecore::error::Result;
use notecore::settings_events;
use notecore::settings_store as store;

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
    /// 巡回に使う Vault 接続の id (#1321)。空 = チャットの接続 (`activeConnectionId`) に
    /// 動的に追従する (複製ではない)
    pub connection_id: String,
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
    /// 利用者が足した手元の CLI (`harnesses: [{ id, name, command, args }]`、#1104)
    pub harnesses: Vec<crate::acp::harness::CustomHarness>,
    /// 「あなたのことを覚える」(USER.md の注入と書込、#1162)。既定 true
    pub user_memory: bool,
    /// 手元の CLI (ACP、#1104) にも USER.md を渡す。既定 true (CLI は利用者が AI として
    /// 選んだ本人なので API 接続と同じ扱い。CLI の提供元へ送られ CLI 自身の記憶に写り得る
    /// ことは AI 設定「メモリー」のトグルの注記で示し、切れるようにする)
    pub harness_user_memory: bool,
}

impl AiConfigLite {
    /// 接続の日次 token 予算。None = 無制限
    pub fn daily_budget_for(&self, connection_id: &str) -> Option<u64> {
        self.budgets.get(connection_id).copied().filter(|n| *n > 0)
    }

    /// チャットの接続のモデル (`meta.config` 用)。接続 id が空 / 手元の CLI / モデル
    /// 未設定なら None。HEARTBEAT はこれを使わず [`Self::heartbeat_provider`] を通す (#1321)
    pub fn model_for_active(&self) -> Option<String> {
        if self.active_connection_id.is_empty() {
            return None;
        }
        if crate::acp::harness_id(&self.active_connection_id).is_some() {
            return None;
        }
        self.models
            .get(&self.active_connection_id)
            .filter(|m| !m.is_empty())
            .cloned()
    }

    /// 巡回 (HEARTBEAT) が使う接続の id: `heartbeat.connectionId` が空でなければそれ、
    /// 空ならチャットの接続 (#1321)
    pub fn heartbeat_connection_id(&self) -> &str {
        if self.heartbeat.connection_id.is_empty() {
            &self.active_connection_id
        } else {
            &self.heartbeat.connection_id
        }
    }

    /// 巡回の provider を 1 関数で決める (#1321)。`heartbeat.rs` が接続を使う箇所
    /// (推論 / 報告先セッションの snapshot / タイトル生成 / 予算) はすべてこれを通す。
    /// 鍵は開かない (ai.json5 と接続一覧の属性だけで決まる)。判定順はテストで固定:
    /// 空 → 手元の CLI (models があっても無し) → 接続が無い → AI プロバイダーでない →
    /// モデル未設定
    pub fn heartbeat_provider(
        &self,
        connections: &[notecore::vault::Connection],
    ) -> std::result::Result<HeartbeatProvider, NoHeartbeatProvider> {
        let id = self.heartbeat_connection_id();
        if id.is_empty() {
            return Err(NoHeartbeatProvider::NotSelected);
        }
        // 手元の CLI (#1104) は無人実行 (HEARTBEAT) の provider にしない
        if crate::acp::harness_id(id).is_some() {
            return Err(NoHeartbeatProvider::Harness);
        }
        let connection = connections
            .iter()
            .find(|c| c.id == id)
            .ok_or(NoHeartbeatProvider::ConnectionMissing)?;
        let protocol = connection
            .protocol
            .ok_or(NoHeartbeatProvider::NotAiProvider)?;
        let model = self
            .models
            .get(id)
            .filter(|m| !m.is_empty())
            .cloned()
            .ok_or(NoHeartbeatProvider::NoModel)?;
        Ok(HeartbeatProvider {
            connection_id: id.to_string(),
            model,
            name: connection.name.clone(),
            local: connection.local,
            protocol,
        })
    }
}

/// 巡回の provider (#1321)。`connection_id` は AI にも HTTP にも出さない
#[derive(Clone, Debug, PartialEq)]
pub struct HeartbeatProvider {
    pub connection_id: String,
    pub model: String,
    /// 接続の表示名
    pub name: String,
    /// この端末の中で動くサービス (#880)
    pub local: bool,
    pub protocol: notecore::vault::ConnectionProtocol,
}

impl HeartbeatProvider {
    /// 表示用の断面 (`HeartbeatStatus.provider` / `meta.heartbeat`)。接続 id は含めない
    pub fn view(&self) -> crate::heartbeat::HeartbeatProviderView {
        crate::heartbeat::HeartbeatProviderView {
            name: self.name.clone(),
            model: self.model.clone(),
            local: self.local,
            protocol: self.protocol,
        }
    }
}

/// 巡回の provider が無い理由 (#1321)。どれも tick の結果は `skip:no-provider` で、
/// 失敗には数えない
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoHeartbeatProvider {
    /// 接続が選ばれていない
    NotSelected,
    /// 手元の CLI (無人実行の provider にしない)
    Harness,
    /// 選んだ接続が消えている
    ConnectionMissing,
    /// `protocol` の無い接続 (AI プロバイダーでない)
    NotAiProvider,
    /// `models[接続 id]` が空
    NoModel,
}

impl NoHeartbeatProvider {
    /// 状態行 / toast の文言の手がかり (`_native.heartbeat.*`)
    pub fn i18n_key(self) -> &'static str {
        match self {
            Self::NotSelected | Self::NoModel => "_native.heartbeat.waitingNotConfigured",
            Self::Harness => "_native.heartbeat.waitingHarness",
            Self::ConnectionMissing => "_native.heartbeat.waitingConnectionMissing",
            Self::NotAiProvider => "_native.heartbeat.waitingNotAiProvider",
        }
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
        user_memory: doc
            .get("userMemory")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        harness_user_memory: doc
            .get("harnessUserMemory")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        harnesses: doc
            .get("harnesses")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| serde_json::from_value(v.clone()).ok())
                    .collect()
            })
            .unwrap_or_default(),
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
            // 文字列でなければ空 (チャットに追従) として読む (#1321)
            connection_id: hb("connectionId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
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
    let base = app_dir.join(notecore::commands::settings::SETTINGS_DIR);
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

/// 「あなたのことを覚える」(USER.md の注入と書込、#1162)
pub fn set_user_memory(core: &Core, enabled: bool) -> Result<()> {
    let mut doc = read_document(core)?;
    if !doc.is_object() {
        doc = Value::Object(Default::default());
    }
    doc.as_object_mut()
        .expect("object")
        .insert("userMemory".into(), Value::Bool(enabled));
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
        // 記憶は既定で覚え、手元の CLI にも既定で渡す (切るのは AI 設定「メモリー」)
        assert!(c.user_memory && c.harness_user_memory);
        assert!(!from_document(&json!({ "harnessUserMemory": false })).harness_user_memory);
        assert!(c.data_sources.current_account && c.data_sources.current_column);
        assert!(!c.data_sources.visible_notes);
        let c2 = from_document(
            &json!({ "personaSkillId": "p", "dataSources": { "custom": { "currentColumn": false } } }),
        );
        assert_eq!(c2.persona_skill_id, "p");
        assert!(!c2.data_sources.current_column);
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
        assert_eq!(c.heartbeat.connection_id, "");
        assert_eq!(c.heartbeat_connection_id(), "c1");
        assert_eq!(c.daily_budget_for("c1"), Some(5000));
        assert_eq!(c.daily_budget_for("c2"), None);
        assert_eq!(c.daily_budget_for("c3"), None);
        // 手元の CLI (#1104) はモデル名があっても無人実行の provider にならない
        let h = from_document(&json!({
            "activeConnectionId": "harness:codex", "models": {"harness:codex": "x"},
            "harnesses": [{"id": "mine", "command": "my-agent", "args": ["acp"]}, {"id": ""}]
        }));
        assert_eq!(h.model_for_active(), None);
        assert_eq!(h.heartbeat_provider(&[]), Err(NoHeartbeatProvider::Harness));
        assert_eq!(h.harnesses.len(), 1);
        assert_eq!(h.harnesses[0].id, "mine");
        assert_eq!(c.heartbeat.interval_minutes, 1440);
        assert_eq!(c.heartbeat.target, "auto");
        assert_eq!(c.heartbeat.on_daily_limit, "disable");
        assert!(!c.heartbeat.cheap_check.enabled);
    }

    fn conn(
        id: &str,
        protocol: Option<notecore::vault::ConnectionProtocol>,
        local: bool,
    ) -> notecore::vault::Connection {
        notecore::vault::Connection {
            id: id.into(),
            name: format!("name-{id}"),
            base_url: "https://api.example.com".into(),
            kind: Default::default(),
            auth_type: Default::default(),
            allowed_hosts: Vec::new(),
            account_scope: None,
            origin: Default::default(),
            external_source: None,
            template_id: None,
            protocol,
            local,
            exposed_to: Vec::new(),
            trusted_for: Vec::new(),
            trusted_plugins: Vec::new(),
            legacy_ai_visible: None,
            legacy_ai_trusted: None,
            slots: Vec::new(),
            last_used_at: None,
            last_secret_updated_at: None,
            display_name: None,
            icon: None,
            notes: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    /// 巡回の接続の解決規則 (#1321): 空 = チャットに追従、判定順は
    /// 空 → 手元の CLI → 接続が無い → AI プロバイダーでない → モデル未設定
    #[test]
    fn heartbeat_provider_follows_chat_unless_set_and_rejects_in_fixed_order() {
        use notecore::vault::ConnectionProtocol as P;
        let conns = [
            conn("chat", Some(P::Anthropic), false),
            conn("local", Some(P::OpenaiCompat), true),
            conn("plain", None, false),
        ];
        let base = json!({
            "activeConnectionId": "chat",
            "models": { "chat": "claude", "local": "qwen", "harness:codex": "x" },
        });
        // 空 = チャットの接続に追従する
        let c = from_document(&base);
        let p = c.heartbeat_provider(&conns).unwrap();
        assert_eq!(
            (p.connection_id.as_str(), p.model.as_str(), p.local),
            ("chat", "claude", false)
        );
        assert_eq!(p.name, "name-chat");
        assert_eq!(p.protocol, P::Anthropic);
        // 明示した接続はそれを使い、チャットを変えても動かない
        let mut doc = base.clone();
        doc["heartbeat"] = json!({ "connectionId": "local" });
        doc["activeConnectionId"] = json!("harness:codex");
        let c = from_document(&doc);
        let p = c.heartbeat_provider(&conns).unwrap();
        assert_eq!(
            (p.connection_id.as_str(), p.model.as_str(), p.local),
            ("local", "qwen", true)
        );
        // 文字列でなければ空として読む
        doc["heartbeat"] = json!({ "connectionId": 5 });
        assert_eq!(from_document(&doc).heartbeat.connection_id, "");
        // 無し: 空
        assert_eq!(
            from_document(&json!({})).heartbeat_provider(&conns),
            Err(NoHeartbeatProvider::NotSelected)
        );
        // 無し: 手元の CLI は models があっても無し (追従でも明示でも)
        assert_eq!(
            from_document(&json!({ "activeConnectionId": "harness:codex", "models": { "harness:codex": "x" } }))
                .heartbeat_provider(&conns),
            Err(NoHeartbeatProvider::Harness)
        );
        assert_eq!(
            from_document(&json!({ "activeConnectionId": "chat", "heartbeat": { "connectionId": "harness:codex" } }))
                .heartbeat_provider(&conns),
            Err(NoHeartbeatProvider::Harness)
        );
        // 無し: 選んだ接続が消えた (models があっても)
        assert_eq!(
            from_document(&json!({ "activeConnectionId": "gone", "models": { "gone": "m" } }))
                .heartbeat_provider(&conns),
            Err(NoHeartbeatProvider::ConnectionMissing)
        );
        // 無し: AI プロバイダーでない
        assert_eq!(
            from_document(&json!({ "activeConnectionId": "plain", "models": { "plain": "m" } }))
                .heartbeat_provider(&conns),
            Err(NoHeartbeatProvider::NotAiProvider)
        );
        // 無し: モデル未設定
        assert_eq!(
            from_document(&json!({ "activeConnectionId": "local" })).heartbeat_provider(&conns),
            Err(NoHeartbeatProvider::NoModel)
        );
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
