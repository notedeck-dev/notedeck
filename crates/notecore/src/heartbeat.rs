//! HEARTBEAT (#411) の daemon 本体 (#1133 縦切り 5)。
//!
//! tick の周期は手元側の timer (Tauri は `commands/heartbeat.rs`、notecored は
//! 自前の timer) が持ち、tick ごとに [`run_once`] を呼ぶ。1 回の実行は
//!
//! 1. 設定 (ai.json5) と skill (`mode: heartbeat`) を読む
//! 2. cheap check (notecore 単独で実行できる cheap な capability) で変化が無ければ AI を呼ばない
//! 3. 日次の AI 起動上限を数える
//! 4. ターン実行器に `ai.heartbeat` principal で 1 ターン投げる (session 無し)
//! 5. 応答契約: `heartbeat.report` tool の呼び出し (通知の有無 + 本文) を報告とし、
//!    tool を呼ばない応答は legacy の ack (`HEARTBEAT_OK`) として抑制する
//! 6. 報告を target session に書き、デバイスへ通知 (OS 通知 / 表示の追従)
//!
//! 状態 (日次カウンタ / cheap check の前回値 / 連続失敗) は `ai-turns/heartbeat.json`。
//! デバイスに要るもの (メモ等の文脈、ローカル時刻の刻印) は橋で聞き、無ければ
//! 無しで進む (notecored)。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

use crate::ai_chat_service::{self, AiChatMessage, AiChatRequest, AiChatRole, AiChatSink};
use crate::ai_config::{self, AiConfigLite};
use crate::ai_sessions::{self, AiSessionCreate, SessionMessage};
use crate::ai_turn::{self, AiTurnEvent, AiTurnRequest, AiTurnSink};
use crate::capabilities::{self, exec::ExecContext};
use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::error::Result;
use crate::permissions_gate;
use crate::permissions_profile::PrincipalId;
use crate::skills::{self, SkillMeta};
use notecli::error::NoteDeckError;

pub const REPORT_CAPABILITY: &str = "heartbeat.report";
pub const OK_TOKEN: &str = "HEARTBEAT_OK";
/// legacy の ack: これ以下の長さで token を含まない応答は「報告なし」
pub const ACK_MAX_CHARS: usize = 300;
pub const MAX_CONSECUTIVE_FAILURES: u32 = 3;
const STATE_FILE: &str = "heartbeat.json";
const CONTEXT_QUERY_TYPE: &str = "heartbeat/context";
const CONTEXT_TIMEOUT: Duration = Duration::from_secs(20);
const TURN_HARD_LIMIT: Duration = Duration::from_secs(30 * 60);

pub const INSTRUCTION: &str = "あなたは HEARTBEAT (定期チェック) として呼ばれています。
上に記載された HEARTBEAT skill の指示に厳密に従ってください。
過去の会話や前回の tick は参照しないでください。
報告すべきことがある場合は heartbeat_report tool を呼び、body に簡潔な報告 (200 字以内推奨) を入れ、通知を出すべきなら notify を true にしてください。
何も報告すべきことが無い場合は tool を呼ばず \"HEARTBEAT_OK\" の 1 行だけを返してください。";

// ---------------------------------------------------------------------------
// デバイスへの口
// ---------------------------------------------------------------------------

/// デバイスへ流す出来事 (flat。Tauri は `nd:ai-heartbeat-event`)。
/// kind: `started` (source) / `finished` (outcome) / `report` (session_id, created) /
/// `titled` (session_id, title) / `notify` (title, body) / `toast` (level, text)
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatEvent {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

impl HeartbeatEvent {
    fn new(kind: &str) -> Self {
        Self {
            kind: kind.into(),
            source: None,
            outcome: None,
            session_id: None,
            created: None,
            title: None,
            body: None,
            level: None,
            text: None,
        }
    }
}

pub trait HeartbeatSink: Send + Sync + 'static {
    fn emit(&self, event: HeartbeatEvent);
}

fn emit(core: &Core, event: HeartbeatEvent) {
    if let Some(sink) = core.heartbeat_sink() {
        sink.emit(event);
    }
}

// ---------------------------------------------------------------------------
// 状態
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    /// UTC の日 (epoch days) と、その日の AI 起動回数
    pub daily_date: u64,
    pub daily_count: u32,
    /// skill id → 前回の cheap check 結果 (JSON 文字列)
    pub last_results_hash: HashMap<String, String>,
    /// skill id → 前回 AI を起動した時刻 (ms)
    pub last_ai_run_at: HashMap<String, u64>,
    pub consecutive_failures: u32,
    /// 直近の失敗 (理由の永続化、#1133 縦切り 6)。新しい順、上限あり
    #[serde(default)]
    pub failures: Vec<FailureRecord>,
    /// 通知済みの失敗 signature → 最後に見た時刻 (同じ signature は初回だけ toast)
    #[serde(default)]
    pub notified_signatures: HashMap<String, u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FailureRecord {
    pub at: u64,
    pub source: String,
    pub signature: String,
    pub message: String,
}

const FAILURES_LIMIT: usize = 20;

/// 失敗の signature: 数字と空白の揺れを潰した先頭 (同じ原因を同じ鍵に)。
pub fn failure_signature(message: &str) -> String {
    let mut out = String::new();
    let mut prev_digit = false;
    for c in message.chars() {
        if c.is_ascii_digit() {
            if !prev_digit {
                out.push('#');
            }
            prev_digit = true;
            continue;
        }
        prev_digit = false;
        if c.is_whitespace() {
            if !out.ends_with(' ') {
                out.push(' ');
            }
            continue;
        }
        out.push(c.to_ascii_lowercase());
    }
    out.trim().chars().take(80).collect()
}

/// 失敗を記録し、初めて見る signature なら通知する (`true`)。
pub fn record_failure(state: &mut PersistedState, source: &str, message: &str, now: u64) -> bool {
    let signature = failure_signature(message);
    state.failures.insert(
        0,
        FailureRecord {
            at: now,
            source: source.to_string(),
            signature: signature.clone(),
            message: message.chars().take(500).collect(),
        },
    );
    state.failures.truncate(FAILURES_LIMIT);
    let first = !state.notified_signatures.contains_key(&signature);
    state.notified_signatures.insert(signature, now);
    first
}

fn state_path(app_dir: &Path) -> PathBuf {
    ai_turn::checkpoint::dir(app_dir).join(STATE_FILE)
}

pub fn load_state(app_dir: &Path) -> PersistedState {
    std::fs::read_to_string(state_path(app_dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_state(app_dir: &Path, st: &PersistedState) {
    let path = state_path(app_dir);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(st) {
        Ok(text) => {
            if let Err(e) = std::fs::write(&path, text) {
                tracing::warn!("heartbeat state write failed: {e}");
            }
        }
        Err(e) => tracing::warn!("heartbeat state serialize failed: {e}"),
    }
}

/// 観測用の値 (DevDashboard / HTTP API)。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub last_tick_at: Option<u64>,
    pub last_tick_source: Option<String>,
    pub last_outcome: Option<String>,
    pub consecutive_failures: u32,
    pub daily_count: u32,
    /// 直近の実行で読んだ設定の断面 (未実行なら None)
    pub config: Option<Value>,
    /// 直近の失敗 (状態ファイルの写し)
    pub recent_failures: Vec<FailureRecord>,
}

fn status_slot() -> &'static Mutex<Status> {
    static S: OnceLock<Mutex<Status>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(Status::default()))
}

fn with_status(f: impl FnOnce(&mut Status)) {
    if let Ok(mut s) = status_slot().lock() {
        f(&mut s);
    }
}

/// DevDashboard / `/api/heartbeat/status` 向けの snapshot。設定は直近の実行で
/// 読んだ断面 (HTTP 面は Core を持たないので、ここに写しを置く)。
pub fn status_json() -> Value {
    let st = status_slot().lock().map(|s| s.clone()).unwrap_or_default();
    json!({
        "mounted": true,
        "running": st.running,
        "lastTickAt": st.last_tick_at,
        "lastTickSource": st.last_tick_source,
        "lastOutcome": st.last_outcome,
        "consecutiveFailures": st.consecutive_failures,
        "dailyCount": st.daily_count,
        "config": st.config.unwrap_or(Value::Null),
        "recentFailures": st.recent_failures,
    })
}

fn config_snapshot(c: &AiConfigLite) -> Value {
    json!({
        "enabled": c.heartbeat.enabled,
        "intervalMinutes": c.heartbeat.interval_minutes,
        "target": c.heartbeat.target,
        "dailyMaxAiRuns": c.heartbeat.daily_max_ai_runs,
    })
}

// ---------------------------------------------------------------------------
// 純ロジック (テスト対象)
// ---------------------------------------------------------------------------

/// legacy の ack 抑制 (`applyHeartbeatSuppression`)。None = 報告なし。
pub fn apply_suppression(text: Option<&str>, ack_max_chars: usize) -> Option<String> {
    let mut body = text?.trim().to_string();
    if body.is_empty() {
        return None;
    }
    if let Some(rest) = body.strip_prefix(OK_TOKEN) {
        body = rest.trim_start().to_string();
    }
    if let Some(rest) = body.strip_suffix(OK_TOKEN) {
        body = rest.trim_end().to_string();
    }
    if body.is_empty() {
        return None;
    }
    if body.chars().count() <= ack_max_chars && !body.contains(OK_TOKEN) {
        return None;
    }
    Some(body)
}

/// cheap check の判定 (`decideCheapCheck`)。戻り値は (AI を呼ぶか, 理由)。
pub fn decide_cheap_check(
    new_hashes: &HashMap<String, String>,
    prev: &PersistedState,
    enabled: bool,
    max_skip_hours: u32,
    now: u64,
) -> (bool, String) {
    if !enabled {
        return (true, "cheap-check-disabled".into());
    }
    if new_hashes.is_empty() {
        return (true, "no-cheap-check-declared".into());
    }
    for (id, h) in new_hashes {
        if prev.last_results_hash.get(id) != Some(h) {
            return (true, format!("changed:{id}"));
        }
    }
    let oldest = new_hashes
        .keys()
        .map(|id| prev.last_ai_run_at.get(id).copied().unwrap_or(0))
        .min()
        .unwrap_or(0);
    if oldest == 0 || now.saturating_sub(oldest) >= u64::from(max_skip_hours) * 3_600_000 {
        return (true, "max-skip-hours-elapsed".into());
    }
    (false, "no-change-within-skip-window".into())
}

pub fn epoch_days(ms: u64) -> u64 {
    ms / 86_400_000
}

/// UTC の `YYYYMMDDhhmmss` (デバイスがローカル時刻の刻印を返さないときの代替)。
pub fn utc_stamp(ms: u64) -> String {
    let (y, mo, d, h, mi, s) = civil_from_ms(ms);
    format!("{y:04}{mo:02}{d:02}{h:02}{mi:02}{s:02}")
}

fn utc_title_time(ms: u64) -> String {
    let (y, mo, d, h, mi, _) = civil_from_ms(ms);
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}")
}

fn civil_from_ms(ms: u64) -> (i64, u32, u32, u32, u32, u32) {
    let secs = (ms / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400) as u32;
    // Howard Hinnant の civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, rem / 3600, (rem % 3600) / 60, rem % 60)
}

/// 生成したタイトルの整形 (`generateHeartbeatTitleAsync` と同じ)。
pub fn clean_report_title(raw: &str) -> String {
    let joined: String = raw
        .chars()
        .map(|c| if c == '\r' || c == '\n' { ' ' } else { c })
        .collect();
    let is_lead = |c: char| c.is_whitespace() || matches!(c, '「' | '『' | '"' | '\'' | '“' | '”');
    let is_trail = |c: char| {
        c.is_whitespace() || matches!(c, '」' | '』' | '"' | '\'' | '“' | '”' | '。' | '．' | '、')
    };
    joined
        .trim_start_matches(is_lead)
        .trim_end_matches(is_trail)
        .trim()
        .chars()
        .take(40)
        .collect()
}

/// `heartbeat.report` tool の本体。HEARTBEAT の実行中でなければ記録しない。
pub fn report_tool(params: &Value, ctx: &ExecContext) -> Result<Value> {
    if params
        .get("body")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        return Err(NoteDeckError::InvalidInput(
            "heartbeat.report: body is required".into(),
        ));
    }
    if ctx.principal != "ai.heartbeat" {
        return Ok(json!({ "recorded": false, "reason": "HEARTBEAT の実行中ではありません" }));
    }
    Ok(json!({ "recorded": true }))
}

// ---------------------------------------------------------------------------
// 1 回の実行
// ---------------------------------------------------------------------------

fn running_flag() -> &'static Mutex<bool> {
    static R: OnceLock<Mutex<bool>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(false))
}

/// tick を 1 回処理する。実行中なら捨てる (後で実行し直さない)。
pub async fn run_once(core: &Core, source: &str) {
    let now = ai_sessions::now_ms();
    with_status(|s| {
        s.last_tick_at = Some(now);
        s.last_tick_source = Some(source.to_string());
    });
    {
        let Ok(mut r) = running_flag().lock() else {
            return;
        };
        if *r {
            tracing::debug!(source, "heartbeat skip (already running)");
            with_status(|s| s.last_outcome = Some("skip:already-running".into()));
            return;
        }
        *r = true;
    }
    with_status(|s| s.running = true);
    let mut ev = HeartbeatEvent::new("started");
    ev.source = Some(source.to_string());
    emit(core, ev);
    let outcome = match run_body(core, source, now).await {
        Ok(o) => o,
        Err(e) => {
            tracing::warn!("heartbeat daemon error: {e}");
            "error".to_string()
        }
    };
    with_status(|s| {
        s.running = false;
        s.last_outcome = Some(outcome.clone());
        if let Ok(dir) = core.app_dir() {
            let st = load_state(dir);
            s.consecutive_failures = st.consecutive_failures;
            s.daily_count = st.daily_count;
            s.recent_failures = st.failures;
        }
    });
    if let Ok(mut r) = running_flag().lock() {
        *r = false;
    }
    let mut ev = HeartbeatEvent::new("finished");
    ev.outcome = Some(outcome);
    emit(core, ev);
}

fn toast(core: &Core, level: &str, text: String) {
    let mut ev = HeartbeatEvent::new("toast");
    ev.level = Some(level.into());
    ev.text = Some(text);
    emit(core, ev);
}

async fn run_body(core: &Core, source: &str, now: u64) -> Result<String> {
    let app_dir = core.app_dir()?.to_path_buf();
    let cfg = ai_config::load(core)?;
    let snapshot = config_snapshot(&cfg);
    with_status(|s| s.config = Some(snapshot));
    if !cfg.heartbeat.enabled {
        return Ok("skip:disabled".into());
    }
    let accounts = core.blocking(crate::account_service::list_public).await?;
    if !accounts.iter().any(|a| a.has_token) {
        tracing::debug!("heartbeat: no active account, skip");
        return Ok("skip:no-account".into());
    }
    let heartbeat_skills: Vec<SkillMeta> = skills::list(core)?
        .into_iter()
        .filter(|s| s.mode == "heartbeat")
        .collect();
    if heartbeat_skills.is_empty() {
        return Ok("skip:no-skills".into());
    }
    let skill_bodies: Vec<String> = heartbeat_skills
        .iter()
        .filter(|s| !s.body.trim().is_empty())
        .map(|s| format!("# Skill: {}\n\n{}", s.name, s.body.trim()))
        .collect();
    if skill_bodies.is_empty() {
        return Ok("skip:no-skills".into());
    }

    // cheap check
    let mut state = load_state(&app_dir);
    let new_hashes = collect_cheap_results(core, &heartbeat_skills).await;
    let (run_ai, reason) = decide_cheap_check(
        &new_hashes,
        &state,
        cfg.heartbeat.cheap_check.enabled,
        cfg.heartbeat.cheap_check.max_skip_hours,
        now,
    );
    if !run_ai {
        state.last_results_hash.extend(new_hashes);
        save_state(&app_dir, &state);
        return Ok(format!("skip:cheap-check:{reason}"));
    }

    // 日次上限
    let today = epoch_days(now);
    if state.daily_date != today {
        state.daily_date = today;
        state.daily_count = 0;
    }
    state.daily_count += 1;
    save_state(&app_dir, &state);
    let limit = cfg.heartbeat.daily_max_ai_runs;
    if state.daily_count > limit {
        if cfg.heartbeat.on_daily_limit == "disable" {
            ai_config::set_heartbeat_enabled(core, false)?;
            toast(
                core,
                "warning",
                format!("HEARTBEAT を停止しました (本日 {limit} 回の AI 起動上限に到達)"),
            );
            return Ok("skip:daily-limit-disable".into());
        }
        if state.daily_count == limit + 1 {
            toast(
                core,
                "warning",
                format!("HEARTBEAT: 本日の AI 起動上限 ({limit} 回) を超えました (継続中)"),
            );
        }
    }

    // AI
    let inference =
        run_inference(core, &app_dir, &cfg, &heartbeat_skills, &skill_bodies, now).await;
    let report = match inference {
        Ok(r) => {
            state.consecutive_failures = 0;
            for id in new_hashes.keys() {
                state.last_ai_run_at.insert(id.clone(), now);
            }
            state.last_results_hash.extend(new_hashes);
            save_state(&app_dir, &state);
            r
        }
        Err(e) => {
            state.consecutive_failures += 1;
            let n = state.consecutive_failures;
            tracing::warn!("heartbeat inference failed ({n}/{MAX_CONSECUTIVE_FAILURES}): {e}");
            // 理由を永続化し、同じ signature は初回だけ通知する
            if record_failure(&mut state, source, &e.to_string(), now) {
                let short: String = e.to_string().chars().take(120).collect();
                toast(core, "warning", format!("HEARTBEAT 失敗: {short}"));
            }
            append_error(core, &cfg, source, &e.to_string(), now).await;
            if n >= MAX_CONSECUTIVE_FAILURES {
                state.consecutive_failures = 0;
                save_state(&app_dir, &state);
                ai_config::set_heartbeat_enabled(core, false)?;
                toast(
                    core,
                    "warning",
                    format!("HEARTBEAT を停止しました ({MAX_CONSECUTIVE_FAILURES} 回連続失敗)"),
                );
            } else {
                save_state(&app_dir, &state);
            }
            return Ok("error".into());
        }
    };
    let Some(report) = report else {
        return Ok("skip:no-response".into());
    };
    if report.body.is_none() && report.intents.is_empty() {
        return Ok("suppressed".into());
    }
    let reported = report.body.is_some();
    deliver(core, &cfg, report, now).await?;
    Ok(if reported { "reported" } else { "queued" }.into())
}

/// cheap check: notecore 単独で実行できる cheap な capability だけ。
async fn collect_cheap_results(core: &Core, hb_skills: &[SkillMeta]) -> HashMap<String, String> {
    let granted = permissions_gate::granted_for(PrincipalId::AiHeartbeat).await;
    let ctx = ExecContext {
        principal: "ai.heartbeat".into(),
        ..Default::default()
    };
    let mut out = HashMap::new();
    for skill in hb_skills {
        let mut results = serde_json::Map::new();
        let mut valid = false;
        for cap_id in &skill.cheap_check_capabilities {
            let Some(decl) = capabilities::find(cap_id) else {
                continue;
            };
            if !decl.cheap || decl.exec != capabilities::Exec::Core {
                tracing::warn!(
                    capability = %cap_id,
                    skill = %skill.id,
                    "cheap check は notecore 単独で実行できる cheap な capability だけ。無視する"
                );
                continue;
            }
            if !decl.permissions.iter().all(|p| granted.contains(p)) {
                continue;
            }
            let value = match capabilities::exec::execute(core, cap_id, json!({}), &ctx).await {
                Ok(o) => o.value,
                Err(e) => json!({ "error": e.to_string() }),
            };
            results.insert(cap_id.clone(), value);
            valid = true;
        }
        if valid {
            out.insert(
                skill.id.clone(),
                serde_json::to_string(&Value::Object(results)).unwrap_or_default(),
            );
        }
    }
    out
}

/// 無人実行で確認が要った操作 (走らせずに残す)。
struct Intent {
    capability_id: String,
    params: Value,
    /// 他人の内容を読んだ文脈で作られた
    untrusted: bool,
}

struct Report {
    /// None = 報告なし (抑制)
    body: Option<String>,
    notify: bool,
    intents: Vec<Intent>,
    local_stamp: Option<String>,
    local_title_time: Option<String>,
}

/// ターンのイベントを集め、done / error で起こす sink。
struct CollectSink {
    events: Mutex<Vec<AiTurnEvent>>,
    done: tokio::sync::Notify,
}

impl AiTurnSink for CollectSink {
    fn emit(&self, event: AiTurnEvent) {
        let finished = event.kind == "done" || event.kind == "error";
        if let Ok(mut v) = self.events.lock() {
            v.push(event);
        }
        if finished {
            self.done.notify_one();
        }
    }
}

async fn run_inference(
    core: &Core,
    app_dir: &Path,
    cfg: &AiConfigLite,
    hb_skills: &[SkillMeta],
    skill_bodies: &[String],
    now: u64,
) -> Result<Option<Report>> {
    let Some(model) = cfg.model_for_active() else {
        tracing::debug!("heartbeat: AI provider not configured, skip");
        return Ok(None);
    };
    // デバイスに要るもの (メモ等の文脈、ローカル時刻の刻印)。無ければ無しで進む
    let device = match core.frontend_bridge() {
        Ok(bridge) => bridge
            .query(
                CONTEXT_QUERY_TYPE,
                json!({ "triggeredAtMs": now }),
                CONTEXT_TIMEOUT,
            )
            .await
            .unwrap_or_else(|e| {
                tracing::debug!("heartbeat: device context unavailable: {e}");
                Value::Null
            }),
        Err(_) => Value::Null,
    };
    let notedeck_context = device
        .get("system")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let context_untrusted = device.get("untrusted").and_then(Value::as_bool) == Some(true)
        || hb_skills.iter().any(|s| s.tainted == Some(true));
    let heartbeat_context = format!(
        "<heartbeat-skills>\n{}\n</heartbeat-skills>",
        skill_bodies.join("\n\n---\n\n")
    );
    let system = [
        notedeck_context.as_str(),
        heartbeat_context.as_str(),
        INSTRUCTION,
    ]
    .iter()
    .filter(|s| !s.is_empty())
    .copied()
    .collect::<Vec<_>>()
    .join("\n\n");
    let turn_id = format!("hb-{now}-{}", &utc_stamp(now)[8..]);
    let req = AiTurnRequest {
        turn_id: turn_id.clone(),
        session_id: None,
        principal: "ai.heartbeat".into(),
        account_id: None,
        connection_id: cfg.active_connection_id.clone(),
        model,
        system: Some(system),
        messages: vec![AiChatMessage {
            role: AiChatRole::User,
            content: format!(
                "Heartbeat tick at {}",
                capabilities::exec::iso_from_unix_ms(now as i64)
            ),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: None,
        }],
        max_tokens: Some(cfg.generation.max_tokens),
        read_timeout_ms: Some(u64::from(cfg.generation.read_timeout_seconds) * 1000),
        max_tool_rounds: Some(cfg.generation.max_tool_rounds),
        continuation: false,
        generate_title: false,
        title_max_tokens: None,
        tool_param_enums: None,
        device_tools: Vec::new(),
        context_untrusted,
    };
    let sink = Arc::new(CollectSink {
        events: Mutex::new(Vec::new()),
        done: tokio::sync::Notify::new(),
    });
    ai_turn::start_turn_with_sink(
        req,
        app_dir,
        core.frontend_bridge()?,
        sink.clone(),
        core.core_executor()?,
    )
    .await?;
    let budget = Duration::from_secs(
        u64::from(cfg.generation.read_timeout_seconds)
            * u64::from(cfg.generation.max_tool_rounds + 2),
    )
    .min(TURN_HARD_LIMIT);
    if tokio::time::timeout(budget, sink.done.notified())
        .await
        .is_err()
    {
        ai_turn::cancel_turn(&turn_id);
        return Err(NoteDeckError::Internal("heartbeat turn timed out".into()));
    }
    let events = sink.events.lock().map(|v| v.clone()).unwrap_or_default();
    if let Some(e) = events.iter().find(|e| e.kind == "error") {
        return Err(NoteDeckError::Internal(
            e.error.clone().unwrap_or_else(|| "turn failed".into()),
        ));
    }
    let report_tool_name = capabilities::tool_name(REPORT_CAPABILITY);
    let tool_report = events
        .iter()
        .filter(|e| e.kind == "tool_use" && e.tool_use_name.as_deref() == Some(&report_tool_name))
        .filter_map(|e| e.tool_use_input.clone())
        .next_back();
    let intents: Vec<Intent> = events
        .iter()
        .filter(|e| e.kind == "intent")
        .filter_map(|e| {
            Some(Intent {
                capability_id: e.tool_use_name.clone()?,
                params: e.tool_use_input.clone().unwrap_or(json!({})),
                untrusted: e.reason.as_deref() == Some("context_untrusted"),
            })
        })
        .collect();
    let local_stamp = device
        .get("localStamp")
        .and_then(Value::as_str)
        .map(str::to_string);
    let local_title_time = device
        .get("localTitleTime")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(input) = tool_report {
        let body = input
            .get("body")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        return Ok(Some(Report {
            body: (!body.is_empty()).then(|| body.to_string()),
            notify: input.get("notify").and_then(Value::as_bool) == Some(true),
            intents,
            local_stamp,
            local_title_time,
        }));
    }
    // legacy: tool を呼ばない応答は ack として抑制する
    let final_text = events
        .iter()
        .find(|e| e.kind == "done")
        .and_then(|e| e.text.clone());
    Ok(Some(Report {
        body: apply_suppression(final_text.as_deref(), ACK_MAX_CHARS),
        notify: true,
        intents,
        local_stamp,
        local_title_time,
    }))
}

/// 報告先セッション。`auto` は kind=heartbeat の専用セッション (無ければ作る)。
/// 戻り値 (id, 作ったか)。None = 書かない (target=none / 指定 id が無い)。
async fn resolve_target(
    core: &Core,
    cfg: &AiConfigLite,
    local_stamp: Option<String>,
    local_title_time: Option<String>,
    now: u64,
) -> Result<Option<(String, bool)>> {
    let base = settings_base_dir(core)?;
    match cfg.heartbeat.target.as_str() {
        "none" => Ok(None),
        "auto" => {
            let all = ai_sessions::load_all(&base)?;
            if let Some(s) = all
                .iter()
                .filter(|s| s.kind == "heartbeat")
                .max_by_key(|s| s.updated_at)
            {
                return Ok(Some((s.id.clone(), false)));
            }
            let stamp = local_stamp.unwrap_or_else(|| utc_stamp(now));
            let mut id = stamp.clone();
            let mut suffix = b'a';
            while ai_sessions::exists(&base, &id) && suffix <= b'z' {
                id = format!("{stamp}{}", suffix as char);
                suffix += 1;
            }
            let created = ai_sessions::create(
                &base,
                AiSessionCreate {
                    id,
                    kind: "heartbeat".into(),
                    title: format!(
                        "{} のHEARTBEAT",
                        local_title_time.unwrap_or_else(|| utc_title_time(now))
                    ),
                    model: cfg.model_for_active().unwrap_or_default(),
                    connection_id: cfg.active_connection_id.clone(),
                    persona_skill_id: None,
                },
            )?;
            Ok(Some((created.id, true)))
        }
        id => {
            if ai_sessions::exists(&base, id) {
                Ok(Some((id.to_string(), false)))
            } else {
                Ok(None)
            }
        }
    }
}

fn hb_message(id: String, content: String, ts: u64) -> SessionMessage {
    SessionMessage {
        id,
        role: "assistant".into(),
        content,
        timestamp: ts,
        tool_use_id: None,
        tool_use_name: None,
        tool_use_input: None,
        tool_result_for: None,
        heartbeat: Some(true),
        intent: None,
    }
}

/// 書込意図 → 受信箱カード (投稿系は下書きも作る)。
async fn intent_message(core: &Core, intent: &Intent, now: u64, index: usize) -> SessionMessage {
    let label = capabilities::find(&intent.capability_id)
        .map(|d| d.label.to_string())
        .unwrap_or_else(|| intent.capability_id.clone());
    let mut status = "pending";
    let mut draft_id: Option<String> = None;
    let mut error: Option<String> = None;
    if intent.capability_id == "notes.create" {
        // 投稿系は下書きに落とす (#1106 §4.8)。アカウントは引数から
        match intent.params.get("accountId").and_then(Value::as_str) {
            Some(account_id) if !account_id.is_empty() => {
                let p = &intent.params;
                let body = json!({
                    "text": p.get("text").cloned().unwrap_or(Value::Null),
                    "cw": p.get("cw").cloned().unwrap_or(Value::Null),
                    "visibility": p.get("visibility").cloned().unwrap_or(json!("public")),
                    "replyId": p.get("replyId").cloned().unwrap_or(Value::Null),
                    "renoteId": p.get("renoteId").cloned().unwrap_or(Value::Null),
                    "channelId": p.get("channelId").cloned().unwrap_or(Value::Null),
                });
                match crate::commands::drafts::api_create_draft(core, account_id.to_string(), body)
                    .await
                {
                    Ok(d) => {
                        status = "drafted";
                        draft_id = Some(d.id);
                    }
                    Err(e) => {
                        tracing::warn!("heartbeat: draft creation failed: {e}");
                        error = Some(e.to_string());
                    }
                }
            }
            _ => error = Some("accountId が無いので下書きにできません".into()),
        }
    }
    let mut msg = hb_message(
        format!("msg-{now}-hb-intent-{index}"),
        format!("{label} の実行を提案しました"),
        now,
    );
    msg.intent = Some(json!({
        "capabilityId": intent.capability_id,
        "params": intent.params,
        "untrusted": intent.untrusted,
        "status": status,
        "draftId": draft_id,
        "error": error,
        "source": "heartbeat",
        "createdAt": now,
    }));
    msg
}

async fn deliver(core: &Core, cfg: &AiConfigLite, report: Report, now: u64) -> Result<()> {
    let Some((session_id, created)) =
        resolve_target(core, cfg, report.local_stamp, report.local_title_time, now).await?
    else {
        tracing::debug!(
            target = %cfg.heartbeat.target,
            "heartbeat target resolved to null, log only: {}",
            report.body.as_deref().unwrap_or("").chars().take(80).collect::<String>()
        );
        return Ok(());
    };
    let base = settings_base_dir(core)?;
    let mut messages = Vec::new();
    for (i, intent) in report.intents.iter().enumerate() {
        messages.push(intent_message(core, intent, now, i).await);
    }
    if let Some(visible) = report.body.as_deref() {
        messages.push(hb_message(
            format!("msg-{now}-hb"),
            visible.to_string(),
            now,
        ));
    }
    ai_sessions::append(&base, &session_id, messages)?;
    let mut ev = HeartbeatEvent::new("report");
    ev.session_id = Some(session_id.clone());
    ev.created = Some(created);
    emit(core, ev);
    let Some(visible) = report.body.as_deref() else {
        return Ok(());
    };
    if report.notify && cfg.heartbeat.desktop_notification {
        let mut body: String = visible.chars().take(200).collect();
        if visible.chars().count() > 200 {
            body.push('…');
        }
        let mut ev = HeartbeatEvent::new("notify");
        ev.title = Some("HEARTBEAT".into());
        ev.body = Some(body);
        emit(core, ev);
    }
    if created {
        if let Some(title) = generate_title(core, cfg, visible).await {
            if ai_sessions::rename(&base, &session_id, &title).is_ok() {
                let mut ev = HeartbeatEvent::new("titled");
                ev.session_id = Some(session_id);
                ev.title = Some(title);
                emit(core, ev);
            }
        }
    }
    Ok(())
}

async fn append_error(core: &Core, cfg: &AiConfigLite, source: &str, err: &str, now: u64) {
    if cfg.heartbeat.target == "none" {
        return;
    }
    let Ok(Some((session_id, created))) = resolve_target(core, cfg, None, None, now).await else {
        return;
    };
    let Ok(base) = settings_base_dir(core) else {
        return;
    };
    let msg = hb_message(
        format!("msg-{now}-hb-err"),
        format!("⚠ HEARTBEAT 失敗 (source={source}): {err}"),
        now,
    );
    if ai_sessions::append(&base, &session_id, vec![msg]).is_ok() {
        let mut ev = HeartbeatEvent::new("report");
        ev.session_id = Some(session_id);
        ev.created = Some(created);
        emit(core, ev);
    }
}

const TITLE_SYSTEM: &str = "あなたは HEARTBEAT 通知の要約タイトル生成アシスタントです。与えられた通知内容を端的に表す短い日本語のタイトルを 1 行で出力してください。20 文字程度 (最大 40 文字) に収めること。引用符、前置き、改行、絵文字、文末句点は付けないでください。タイトルのみを返してください。";

struct TextSink(Mutex<String>, Mutex<Option<String>>);

impl AiChatSink for TextSink {
    fn emit(&self, event: crate::ai_chat_service::AiChatEvent) {
        match event.kind.as_str() {
            "delta" => {
                if let (Some(t), Ok(mut s)) = (event.text, self.0.lock()) {
                    s.push_str(&t);
                }
            }
            "error" => {
                if let Ok(mut e) = self.1.lock() {
                    *e = event.error;
                }
            }
            _ => {}
        }
    }
}

async fn generate_title(core: &Core, cfg: &AiConfigLite, report: &str) -> Option<String> {
    let app_dir = core.app_dir().ok()?;
    let conn = ai_chat_service::resolve_connection(app_dir, &cfg.active_connection_id).ok()?;
    let req = AiChatRequest {
        stream_id: "heartbeat-title".into(),
        connection_id: cfg.active_connection_id.clone(),
        model: cfg.model_for_active()?,
        messages: vec![AiChatMessage {
            role: AiChatRole::User,
            content: format!(
                "次の HEARTBEAT 通知の主題を端的に表す短いタイトルを付けてください。タイトルだけを 1 行で出力。\n\n{report}"
            ),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: None,
        }],
        system: Some(TITLE_SYSTEM.into()),
        max_tokens: Some(cfg.generation.title_max_tokens),
        read_timeout_ms: Some(u64::from(cfg.generation.read_timeout_seconds) * 1000),
        tools: None,
    };
    let sink = TextSink(Mutex::new(String::new()), Mutex::new(None));
    if let Err(e) = ai_chat_service::run_round(&req, &conn, &sink).await {
        tracing::warn!("heartbeat title generation failed: {e}");
        return None;
    }
    let text = sink.0.lock().ok()?.clone();
    let title = clean_report_title(&text);
    (!title.is_empty()).then_some(title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suppression_matches_ts_rules() {
        let s = |t: &str| apply_suppression(Some(t), ACK_MAX_CHARS);
        assert_eq!(s("HEARTBEAT_OK"), None);
        assert_eq!(s("  HEARTBEAT_OK \n"), None);
        assert_eq!(s(""), None);
        assert_eq!(apply_suppression(None, 300), None);
        assert_eq!(s("HEARTBEAT_OK 問題なし"), None);
        assert_eq!(s("問題なし HEARTBEAT_OK"), None);
        let long = "あ".repeat(301);
        assert_eq!(
            s(&format!("HEARTBEAT_OK {long} HEARTBEAT_OK")).as_deref(),
            Some(long.as_str())
        );
        assert_eq!(
            s("途中に HEARTBEAT_OK がある短文").as_deref(),
            Some("途中に HEARTBEAT_OK がある短文")
        );
        assert_eq!(s(&"あ".repeat(300)), None);
        assert_eq!(s(&"あ".repeat(301)).map(|x| x.chars().count()), Some(301));
        assert_eq!(apply_suppression(Some("短い"), 1).as_deref(), Some("短い"));
    }

    #[test]
    fn cheap_check_decision_matches_ts() {
        let mut prev = PersistedState::default();
        let mut hashes = HashMap::new();
        assert_eq!(
            decide_cheap_check(&hashes, &prev, false, 24, 0).1,
            "cheap-check-disabled"
        );
        assert_eq!(
            decide_cheap_check(&hashes, &prev, true, 24, 0).1,
            "no-cheap-check-declared"
        );
        hashes.insert("a".into(), "x".into());
        assert_eq!(
            decide_cheap_check(&hashes, &prev, true, 24, 0).1,
            "changed:a"
        );
        prev.last_results_hash.insert("a".into(), "x".into());
        // lastAiRunAt が無い (初回) → 強制起動
        assert_eq!(
            decide_cheap_check(&hashes, &prev, true, 24, 1_000).1,
            "max-skip-hours-elapsed"
        );
        prev.last_ai_run_at.insert("a".into(), 1_000);
        let now = 1_000 + 3_600_000;
        assert_eq!(
            decide_cheap_check(&hashes, &prev, true, 24, now),
            (false, "no-change-within-skip-window".into())
        );
        let later = 1_000 + 24 * 3_600_000;
        assert!(decide_cheap_check(&hashes, &prev, true, 24, later).0);
    }

    #[test]
    fn utc_stamp_and_title_cleaning() {
        // 2026-09-25T12:34:56Z
        let ms = 1_790_339_696_000u64;
        assert_eq!(utc_stamp(ms), "20260925123456");
        assert_eq!(utc_title_time(ms), "2026-09-25 12:34");
        assert_eq!(epoch_days(ms), 20721);
        assert_eq!(clean_report_title("  「新着が 3 件」。\n"), "新着が 3 件");
        assert_eq!(clean_report_title(&"あ".repeat(50)).chars().count(), 40);
    }

    #[test]
    fn report_tool_only_records_during_heartbeat() {
        let hb = ExecContext {
            principal: "ai.heartbeat".into(),
            ..Default::default()
        };
        assert_eq!(
            report_tool(&json!({"body": "x"}), &hb).unwrap()["recorded"],
            true
        );
        let chat = ExecContext {
            principal: "ai.chat".into(),
            ..Default::default()
        };
        assert_eq!(
            report_tool(&json!({"body": "x"}), &chat).unwrap()["recorded"],
            false
        );
        assert!(report_tool(&json!({"body": " "}), &hb).is_err());
    }

    #[test]
    fn failure_signature_and_first_notification() {
        assert_eq!(failure_signature("HTTP 503  from api"), "http # from api");
        assert_eq!(failure_signature("HTTP 502 from api"), "http # from api");
        let mut st = PersistedState::default();
        assert!(record_failure(&mut st, "scheduled", "HTTP 503 from api", 1));
        assert!(!record_failure(
            &mut st,
            "scheduled",
            "HTTP 502 from api",
            2
        ));
        assert!(record_failure(&mut st, "manual", "network error", 3));
        assert_eq!(st.failures.len(), 3);
        assert_eq!(st.failures[0].message, "network error");
        for i in 0..30 {
            record_failure(&mut st, "s", &format!("x{i}"), 10 + i);
        }
        assert_eq!(st.failures.len(), FAILURES_LIMIT);
    }

    #[test]
    fn state_round_trips_through_file() {
        let dir = tempfile::tempdir().unwrap();
        let st = PersistedState {
            daily_date: 5,
            daily_count: 2,
            consecutive_failures: 1,
            ..Default::default()
        };
        save_state(dir.path(), &st);
        assert_eq!(load_state(dir.path()), st);
        assert_eq!(
            load_state(std::path::Path::new("/nonexistent")),
            PersistedState::default()
        );
    }
}
