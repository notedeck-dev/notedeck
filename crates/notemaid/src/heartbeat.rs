//! HEARTBEAT (#411) の daemon 本体 (#1133 縦切り 5)。
//!
//! tick の周期は手元側の timer (Tauri は `commands/heartbeat.rs`、別プロセスの notemaid は
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
//! 状態 (日次カウンタ / cheap check の前回値 / 連続失敗 / 最後の巡回) は `ai-turns/heartbeat.json`。
//! デバイスに要るもの (メモ等の文脈、ローカル時刻の刻印) は橋で聞き、無ければ
//! 無しで進む (端末が繋がっていない notemaid)。
//!
//! 巡回の接続 (#1321) は `ai.json5` の `heartbeat.connectionId` (空ならチャットの接続に
//! 追従) で、解決は [`AiConfigLite::heartbeat_provider`] の 1 関数。tick の結果は 4 種:
//!
//! | 種類 | outcome | 連続失敗 | 日次 | cheap check の前回値 |
//! |---|---|---|---|---|
//! | provider 無し (未選択 / 手元の CLI / モデル未設定 / 鍵無し / 宛先の検査) | `skip:no-provider` | 数えない | 消費しない | 更新しない |
//! | 到達不能 (何も受け取る前の接続の失敗) | `skip:unreachable` | 数えない | 消費しない | 更新しない |
//! | 推論の失敗 (HTTP / 時間切れ / 受信途中の切断 / 予算超過) | `error` | 数える | 消費する | 更新しない |
//! | 応答あり | `reported` / `suppressed` / `queued` | 0 に戻す | 消費する | 更新する |
//!
//! 1 と 2 は失敗の記録に入れず、状態の `waiting` に置く (About / DevDashboard が「失敗」と
//! して見せないため)。知らせは signature の初回だけ toast。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

use crate::ai_chat_service::{self, AiChatMessage, AiChatRequest, AiChatRole, AiChatSink};
use crate::ai_config::{self, AiConfigLite, HeartbeatProvider};
use crate::ai_sessions::{self, AiSessionCreate, SessionMessage};
use crate::ai_turn::{self, AiTurnEvent, AiTurnRequest, AiTurnSink};
use crate::exec::ExecContext;
use crate::sinks::CoreMaidExt;
use crate::skills::{self, SkillMeta};
use notecli::error::NoteDeckError;
use notecore::capabilities;
use notecore::commands::settings::settings_base_dir;
use notecore::context::Core;
use notecore::error::Result;
use notecore::i18n;
use notecore::permissions_gate;
use notecore::permissions_profile::PrincipalId;
use notecore::vault::ConnectionProtocol;

pub const REPORT_CAPABILITY: &str = "heartbeat.report";
pub const OK_TOKEN: &str = "HEARTBEAT_OK";
/// legacy の ack: これ以下の長さで token を含まない応答は「報告なし」
pub const ACK_MAX_CHARS: usize = 300;
pub const MAX_CONSECUTIVE_FAILURES: u32 = 3;
const STATE_FILE: &str = "heartbeat.json";
const TURN_HARD_LIMIT: Duration = Duration::from_secs(30 * 60);
/// 試走 (#1321) の待ちの上限は応答待ちの時間 × これ (tick の `max_tool_rounds` 由来の上限は使わない)
const PROBE_TIMEOUT_FACTOR: u64 = 3;
/// 試走で AI に出す固定の指示 (英語。応答契約の tool を必ず呼ばせる)
pub const PROBE_INSTRUCTION: &str = "This is a probe run to verify that this model can complete a HEARTBEAT round. Regardless of the steps above, you MUST call the heartbeat_report tool exactly once with body \"probe\" and notify false. Do not call any other tool.";
/// 切り詰めの注記 (#1321): 最初のラウンドの入力 token が送った量の推定のこの割合を下回ったら
/// 「切り詰められた可能性」。推定は文字数ベースで言語により揺れるので保守的に取る
pub const TRUNCATION_RATIO: f64 = 0.5;

pub const INSTRUCTION: &str = "You are being called as HEARTBEAT (a periodic check).
Follow HEARTBEAT.md and the other heartbeat instructions given in the user message, when provided.
Do not infer or repeat old tasks from past conversations or previous ticks.
If there is something to report, call the heartbeat_report tool with a concise report in body (200 characters or fewer recommended), and set notify to true if a notification should be shown. Never put what you remember about the person into a notification.
If there is nothing to report, do not call any tool and return only the single line \"HEARTBEAT_OK\".";

// ---------------------------------------------------------------------------
// デバイスへの口
// ---------------------------------------------------------------------------

/// デバイスへ流す出来事 (flat。Tauri は `nd:ai-heartbeat-event`)。
/// kind: `started` (source) / `finished` (outcome) / `report` (session_id, created, pending) /
/// `titled` (session_id, title) / `notify` (session_id, title, body, desktop) / `toast` (level, text)
///
/// `notify` は AI が「通知して」とした報告ごとに流す (アプリの通知の受信トレイに残す, #1165)。
/// 報告先が「なし」なら session_id は無く、`report` も流さない (#1227)。
/// AI 設定の「デスクトップ通知」は `desktop` に載せ、OS 通知を出すかだけをデバイスが決める
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
    /// `report`: この報告で新しく積まれた確認待ちの操作の数 (0 なら無し)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending: Option<u32>,
    /// `notify`: OS のデスクトップ通知も出すか (AI 設定の「デスクトップ通知」)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desktop: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// `text` を表示言語で描き直す手がかり (#135)
    #[serde(rename = "i18n", skip_serializing_if = "Option::is_none")]
    pub i18n: Option<Value>,
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
            pending: None,
            desktop: None,
            level: None,
            text: None,
            i18n: None,
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
    /// AI が「通知して」とした報告の記録 (古い順、上限あり)。閉じている間の件数を
    /// 開いている間と同じ基準で数えるため。報告先が「なし」の報告も残す (#1227)
    #[serde(default)]
    pub notices: Vec<HeartbeatNotice>,
    /// 最後の巡回 (再起動後も「最後の巡回」が出るように、#1321)
    #[serde(default)]
    pub last_tick: Option<HeartbeatLastTick>,
    /// 待機中 (provider 無し / 到達不能)。応答が返ったら消える (#1321)
    #[serde(default)]
    pub waiting: Option<HeartbeatWaiting>,
}

/// 直近の tick で使った provider の表示用の断面 (#1321)。接続 id は含めない
/// (`vault.fetch` の引数になる id は AI にも HTTP にも出さない)
#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatProviderView {
    pub name: String,
    pub model: String,
    /// この端末の中で動くサービス (#880)
    pub local: bool,
    pub protocol: ConnectionProtocol,
}

/// 直近の tick の最初のラウンドの usage (provider の実測があるときだけ) と送った量の推定 (#1321)。
/// ローカル接続で入力が推定を大きく下回れば、context の切り詰めの可能性
#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatTickUsage {
    pub input_tokens: u64,
    pub estimated_input_tokens: u64,
}

impl HeartbeatTickUsage {
    /// 入力が送った量の推定を大きく下回る (切り詰めの可能性)。確定ではない
    pub fn looks_truncated(&self) -> bool {
        self.estimated_input_tokens > 0
            && (self.input_tokens as f64) < (self.estimated_input_tokens as f64) * TRUNCATION_RATIO
    }
}

/// 最後の巡回 (#1321)。試走は書かない
#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatLastTick {
    pub at: u64,
    pub source: String,
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<HeartbeatProviderView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<HeartbeatTickUsage>,
    /// `error` のときの送信時の失敗の種別 (`timeout` なら状態行に一文添える)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
}

/// 待機中 (#1321)。`kind` は `no-provider` | `unreachable`。`message` は英語の正本文、
/// `i18n` は `{ message: { key, params } }` (デバイスは `localizeNative` で描き直す)
#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatWaiting {
    pub kind: String,
    pub since: u64,
    pub message: String,
    #[serde(rename = "i18n")]
    pub i18n: Value,
}

impl HeartbeatWaiting {
    fn new(kind: &str, since: u64, text: i18n::Text) -> Self {
        Self {
            kind: kind.into(),
            since,
            message: text.text,
            i18n: json!({ "message": text.i18n }),
        }
    }
}

/// 知らせた報告の記録。本文は報告先のセッションが正本なので持たない
#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatNotice {
    pub at: u64,
    /// 報告先のセッション。報告先が「なし」なら None
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FailureRecord {
    pub at: u64,
    pub source: String,
    pub signature: String,
    pub message: String,
}

const FAILURES_LIMIT: usize = 20;
/// 通知済み signature の保持上限。溢れたら古いものから忘れる (再発すれば再通知)
const NOTIFIED_LIMIT: usize = 100;
/// 知らせた報告の記録の保持上限。溢れたら古いものから捨てる
const NOTICES_LIMIT: usize = 100;

/// 「通知して」の報告を記録する
pub fn record_notice(state: &mut PersistedState, at: u64, session_id: Option<String>) {
    state.notices.push(HeartbeatNotice { at, session_id });
    let overflow = state.notices.len().saturating_sub(NOTICES_LIMIT);
    state.notices.drain(..overflow);
}

/// `since` (ms) より後に知らせた報告
pub fn notices_since(state: &PersistedState, since: u64) -> Vec<HeartbeatNotice> {
    state
        .notices
        .iter()
        .filter(|n| n.at > since)
        .cloned()
        .collect()
}

/// 失敗の signature: 可変値と空白の揺れを潰した先頭 (同じ原因を同じ鍵に)。
/// 3 桁以下の数字 (HTTP ステータス等) は原因を表すので残し、4 桁以上の連続
/// (request id / 時刻 / 件数) は `#` に潰す。
pub fn failure_signature(message: &str) -> String {
    let mut out = String::new();
    let mut digits = String::new();
    let flush = |out: &mut String, digits: &mut String| {
        if digits.len() > 3 {
            out.push('#');
        } else {
            out.push_str(digits);
        }
        digits.clear();
    };
    for c in message.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
            continue;
        }
        flush(&mut out, &mut digits);
        if c.is_whitespace() {
            if !out.ends_with(' ') {
                out.push(' ');
            }
            continue;
        }
        out.push(c.to_ascii_lowercase());
    }
    flush(&mut out, &mut digits);
    out.trim().chars().take(80).collect()
}

/// 失敗を記録し、初めて見る signature なら通知する (`true`)。
pub fn record_failure(state: &mut PersistedState, source: &str, message: &str, now: u64) -> bool {
    // signature も状態ファイルに残るので、秘匿化してから作る (#1164)
    let message = crate::redact::text(message);
    let signature = failure_signature(&message);
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
    note_signature(state, signature, now)
}

/// 待機 (provider 無し / 到達不能、#1321) に入る。失敗の記録には入れず `waiting` に置き、
/// 初めて見る signature なら通知する (`true`)。既に同じ理由で待機中なら `since` は保つ
pub fn enter_waiting(state: &mut PersistedState, kind: &str, text: i18n::Text, now: u64) -> bool {
    let signature = failure_signature(&format!("waiting {kind} {}", text.text));
    let since = match &state.waiting {
        Some(w) if w.kind == kind && w.message == text.text => w.since,
        _ => now,
    };
    state.waiting = Some(HeartbeatWaiting::new(kind, since, text));
    note_signature(state, signature, now)
}

/// signature を「通知済み」に記録し、初めてなら `true`
fn note_signature(state: &mut PersistedState, signature: String, now: u64) -> bool {
    let first = !state.notified_signatures.contains_key(&signature);
    state.notified_signatures.insert(signature, now);
    while state.notified_signatures.len() > NOTIFIED_LIMIT {
        let Some(oldest) = state
            .notified_signatures
            .iter()
            .min_by_key(|(_, at)| **at)
            .map(|(k, _)| k.clone())
        else {
            break;
        };
        state.notified_signatures.remove(&oldest);
    }
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

/// 観測用の値 (AI 設定の「最後の巡回」/ About / DevDashboard / `/api/heartbeat/status`)。
/// WebView は `heartbeat_status` command で、HTTP は `status_json` で、同じ型を読む (#1321)
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct HeartbeatStatus {
    /// 常に true (HTTP の `/api/heartbeat/status` が「回しているプロセスが居る」の印に使う)
    pub mounted: bool,
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
    /// 直近の tick で使った provider の表示用の断面 (#1321)
    pub provider: Option<HeartbeatProviderView>,
    /// 直近の tick の最初のラウンドの usage と送った量の推定 (#1321)
    pub usage: Option<HeartbeatTickUsage>,
    /// 直近の `error` の送信時の失敗の種別 (#1321)
    pub last_error_kind: Option<String>,
    /// 待機中 (provider 無し / 到達不能、#1321)
    pub waiting: Option<HeartbeatWaiting>,
    /// 次の定期の巡回の予定時刻 (timer が組まれているときだけ、#1321)
    pub next_tick_at: Option<u64>,
}

impl Default for HeartbeatStatus {
    fn default() -> Self {
        Self {
            mounted: true,
            running: false,
            last_tick_at: None,
            last_tick_source: None,
            last_outcome: None,
            consecutive_failures: 0,
            daily_count: 0,
            config: None,
            recent_failures: Vec::new(),
            provider: None,
            usage: None,
            last_error_kind: None,
            waiting: None,
            next_tick_at: None,
        }
    }
}

fn status_slot() -> &'static Mutex<HeartbeatStatus> {
    static S: OnceLock<Mutex<HeartbeatStatus>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HeartbeatStatus::default()))
}

/// 起動時に状態ファイルから観測値を戻す (再起動直後も直近の失敗と最後の巡回が見える)。
pub fn restore_status(app_dir: &Path) {
    let st = load_state(app_dir);
    with_status(|s| s.absorb(&st));
}

impl HeartbeatStatus {
    /// 状態ファイルの写しを観測値に反映する
    fn absorb(&mut self, st: &PersistedState) {
        self.consecutive_failures = st.consecutive_failures;
        self.daily_count = st.daily_count;
        self.recent_failures = st.failures.clone();
        self.waiting = st.waiting.clone();
        if let Some(t) = &st.last_tick {
            self.last_tick_at = Some(t.at);
            self.last_tick_source = Some(t.source.clone());
            self.last_outcome = Some(t.outcome.clone());
            self.provider = t.provider.clone();
            self.usage = t.usage;
            self.last_error_kind = t.error_kind.clone();
        }
    }
}

fn with_status(f: impl FnOnce(&mut HeartbeatStatus)) {
    if let Ok(mut s) = status_slot().lock() {
        f(&mut s);
    }
}

/// timer が次の定期の巡回の予定時刻を知らせる (止めたら None)
pub fn set_next_tick_at(at: Option<u64>) {
    with_status(|s| s.next_tick_at = at);
}

/// 観測値の snapshot (`heartbeat_status` command)
pub fn status() -> HeartbeatStatus {
    status_slot().lock().map(|s| s.clone()).unwrap_or_default()
}

/// DevDashboard / `/api/heartbeat/status` 向けの snapshot (同じ型を JSON にしたもの)。設定は
/// 直近の実行で読んだ断面 (HTTP 面は Core を持たないので、ここに写しを置く)
pub fn status_json() -> Value {
    serde_json::to_value(status()).unwrap_or(Value::Null)
}

fn config_snapshot(c: &AiConfigLite) -> Value {
    json!({
        "enabled": c.heartbeat.enabled,
        "intervalMinutes": c.heartbeat.interval_minutes,
        "target": c.heartbeat.target,
        "dailyMaxAiRuns": c.heartbeat.daily_max_ai_runs,
        // 巡回の接続がチャットと別か (id は出さない、#1321)
        "separateConnection": !c.heartbeat.connection_id.is_empty(),
    })
}

/// 巡回の接続の候補 (Vault の接続一覧)。読めなければ空 (= 接続が無い)
fn load_connections(app_dir: &Path) -> Vec<notecore::vault::Connection> {
    match notecore::vault::connections_store::load(app_dir) {
        Ok(file) => file.connections,
        Err(e) => {
            tracing::warn!("heartbeat: connections.json unreadable: {e}");
            Vec::new()
        }
    }
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

/// 日次上限の判定 (#1321)。推論の前に「次で超えるか」を見るだけで、加算はしない
/// (加算は結果が出てから: 推論の失敗と応答ありのときだけ。provider 無し / 到達不能は消費しない)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DailyGate {
    Proceed,
    /// 上限に達した最初の 1 回だけ警告し、続ける (`onDailyLimit: warn`)
    WarnThenProceed,
    /// 上限で自動停止する (`onDailyLimit: disable`)
    Stop,
}

/// 日付が変われば数え直し、上限との関係を返す。手動は上限の外 (数えもしない)
pub fn daily_gate(
    state: &mut PersistedState,
    now: u64,
    limit: u32,
    stop_at_limit: bool,
    manual: bool,
) -> DailyGate {
    let today = epoch_days(now);
    if state.daily_date != today {
        state.daily_date = today;
        state.daily_count = 0;
    }
    if manual || state.daily_count < limit {
        return DailyGate::Proceed;
    }
    if stop_at_limit {
        return DailyGate::Stop;
    }
    if state.daily_count == limit {
        DailyGate::WarnThenProceed
    } else {
        DailyGate::Proceed
    }
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
    const LEADING: &[char] = &['「', '『', '"', '\'', '“', '”']; // i18n-ignore: data
    const TRAILING: &[char] = &['」', '』', '"', '\'', '“', '”', '。', '．', '、']; // i18n-ignore: data
    let is_lead = |c: char| c.is_whitespace() || LEADING.contains(&c);
    let is_trail = |c: char| c.is_whitespace() || TRAILING.contains(&c);
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
        return Ok(json!({ "recorded": false, "reason": "HEARTBEAT is not running" }));
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

/// 実行中の印。timer の tick / 手動 / 試走が共有し、同時に 2 本走らせない (ローカル推論は
/// 直列なので、重なると本番の tick が時間切れで失敗に数えられる)。drop で下ろす
pub struct RunGuard(());

impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(mut r) = running_flag().lock() {
            *r = false;
        }
        with_status(|s| s.running = false);
    }
}

/// 実行中の印を取る。既に走っていれば None
pub fn try_begin() -> Option<RunGuard> {
    let mut r = running_flag().lock().ok()?;
    if *r {
        return None;
    }
    *r = true;
    drop(r);
    with_status(|s| s.running = true);
    Some(RunGuard(()))
}

/// tick を 1 回処理する。実行中なら捨てる (後で実行し直さない)。
pub async fn run_once(core: &Core, source: &str) {
    run_once_with_gap(core, source, None).await
}

/// 復帰後の巡回 (`heartbeat_schedule::Due::Resumed`): 前回からの経過を AI に渡す
pub async fn run_due(core: &Core, due: crate::heartbeat_schedule::Due) {
    run_once_with_gap(core, due.source(), due.gap()).await
}

async fn run_once_with_gap(core: &Core, source: &str, gap: Option<Duration>) {
    let Some(guard) = try_begin() else {
        tracing::debug!(source, "heartbeat skip (already running)");
        with_status(|s| s.last_outcome = Some("skip:already-running".into()));
        return;
    };
    run_guarded(core, source, gap, guard).await;
}

/// 「今すぐ巡回する」(#1321): 無効でも走り、cheap check を飛ばし、連続失敗と日次に数えない。
/// それ以外 (報告先への書込 / 通知 / 受信箱カード / 予算) は通常の tick と同じ。
/// 実行中の印は呼び出し側が先に取る (command が同期的に取って即返すため)
pub async fn run_manual(core: &Core, guard: RunGuard) {
    run_guarded(core, "manual", None, guard).await;
}

/// 1 回の実行の結果 (観測値に写す分)
struct TickResult {
    outcome: String,
    provider: Option<HeartbeatProviderView>,
    usage: Option<HeartbeatTickUsage>,
    error_kind: Option<String>,
}

impl TickResult {
    fn skip(outcome: &str) -> Self {
        Self {
            outcome: outcome.into(),
            provider: None,
            usage: None,
            error_kind: None,
        }
    }
}

async fn run_guarded(core: &Core, source: &str, gap: Option<Duration>, guard: RunGuard) {
    let now = ai_sessions::now_ms();
    with_status(|s| {
        s.last_tick_at = Some(now);
        s.last_tick_source = Some(source.to_string());
    });
    let mut ev = HeartbeatEvent::new("started");
    ev.source = Some(source.to_string());
    emit(core, ev);
    let result = match run_body(core, source, now, gap).await {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("heartbeat daemon error: {e}");
            TickResult::skip("error")
        }
    };
    // 最後の巡回を状態ファイルに残す (再起動後も出す)
    if let Ok(dir) = core.app_dir() {
        let mut st = load_state(dir);
        st.last_tick = Some(HeartbeatLastTick {
            at: now,
            source: source.to_string(),
            outcome: result.outcome.clone(),
            provider: result.provider.clone(),
            usage: result.usage,
            error_kind: result.error_kind.clone(),
        });
        save_state(dir, &st);
        with_status(|s| s.absorb(&st));
    } else {
        with_status(|s| {
            s.last_outcome = Some(result.outcome.clone());
            s.provider = result.provider.clone();
            s.usage = result.usage;
            s.last_error_kind = result.error_kind.clone();
        });
    }
    drop(guard);
    let mut ev = HeartbeatEvent::new("finished");
    ev.outcome = Some(result.outcome);
    emit(core, ev);
}

fn toast(core: &Core, level: &str, message: i18n::Text) {
    let mut ev = HeartbeatEvent::new("toast");
    ev.level = Some(level.into());
    ev.text = Some(message.text);
    ev.i18n = Some(json!({ "text": message.i18n }));
    emit(core, ev);
}

async fn run_body(
    core: &Core,
    source: &str,
    now: u64,
    gap: Option<Duration>,
) -> Result<TickResult> {
    let manual = source == "manual";
    let app_dir = core.app_dir()?.to_path_buf();
    let cfg = ai_config::load(core)?;
    let snapshot = config_snapshot(&cfg);
    with_status(|s| s.config = Some(snapshot));
    if !cfg.heartbeat.enabled && !manual {
        return Ok(TickResult::skip("skip:disabled"));
    }
    let accounts = notecore::account_service::list_public_from(&*core.accounts()?)?;
    if !accounts.iter().any(|a| a.has_token) {
        tracing::debug!("heartbeat: no active account, skip");
        return Ok(TickResult::skip("skip:no-account"));
    }
    let heartbeat_skills: Vec<SkillMeta> = skills::list(core)?
        .into_iter()
        .filter(|s| s.mode == "heartbeat")
        .collect();
    if heartbeat_skills.is_empty() {
        return Ok(TickResult::skip("skip:no-skills"));
    }
    // 実質空 (コメントと見出しだけ) の手順は無いのと同じ。全部空なら巡回しない
    // (OpenClaw の empty-heartbeat-file。無人の予算のため NoteDeck は走らせない)
    let skill_bodies: Vec<String> = heartbeat_skills
        .iter()
        .filter(|s| !crate::workspace::is_effectively_empty(&s.body))
        .map(|s| format!("# Skill: {}\n\n{}", s.name, s.body.trim()))
        .collect();
    if skill_bodies.is_empty() {
        return Ok(TickResult::skip("skip:no-skills"));
    }

    // 巡回の provider (#1321)。鍵を開かずに決め、無ければ cheap check より前に待機へ
    let mut state = load_state(&app_dir);
    let provider = match cfg.heartbeat_provider(&load_connections(&app_dir)) {
        Ok(p) => p,
        Err(reason) => {
            tracing::debug!(?reason, "heartbeat: no provider, waiting");
            wait(
                core,
                &mut state,
                &app_dir,
                "no-provider",
                i18n::text(reason.i18n_key(), json!({})),
                now,
            );
            return Ok(TickResult::skip("skip:no-provider"));
        }
    };

    // cheap check (手動は飛ばす)
    let new_hashes = if manual {
        HashMap::new()
    } else {
        collect_cheap_results(core, &heartbeat_skills).await
    };
    if !manual {
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
            return Ok(TickResult::skip(&format!("skip:cheap-check:{reason}")));
        }
    }

    // 日次上限: 「次で超えるか」を推論の前に判定し、加算は結果が出てから (推論の失敗と
    // 応答ありのときだけ。provider 無し / 到達不能は消費しない)。手動は上限の外
    let limit = cfg.heartbeat.daily_max_ai_runs;
    match daily_gate(
        &mut state,
        now,
        limit,
        cfg.heartbeat.on_daily_limit == "disable",
        manual,
    ) {
        DailyGate::Proceed => {}
        DailyGate::Stop => {
            save_state(&app_dir, &state);
            ai_config::set_heartbeat_enabled(core, false)?;
            toast(
                core,
                "warning",
                i18n::text(
                    "_native.heartbeat.stoppedDailyLimit",
                    json!({ "limit": limit }),
                ),
            );
            return Ok(TickResult::skip("skip:daily-limit-disable"));
        }
        DailyGate::WarnThenProceed => {
            toast(
                core,
                "warning",
                i18n::text(
                    "_native.heartbeat.overDailyLimit",
                    json!({ "limit": limit }),
                ),
            );
        }
    }

    // AI
    let inference = run_inference(
        core,
        &cfg,
        &provider,
        &heartbeat_skills,
        &skill_bodies,
        now,
        gap,
    )
    .await;
    let view = Some(provider.view());
    let report = match inference {
        Ok(r) => {
            state.waiting = None;
            state.consecutive_failures = 0;
            if !manual {
                state.daily_count += 1;
            }
            for id in new_hashes.keys() {
                state.last_ai_run_at.insert(id.clone(), now);
            }
            state.last_results_hash.extend(new_hashes);
            save_state(&app_dir, &state);
            r
        }
        Err(TickFailure::NoProvider(text)) => {
            wait(core, &mut state, &app_dir, "no-provider", text, now);
            return Ok(TickResult::skip("skip:no-provider"));
        }
        Err(TickFailure::Unreachable(detail)) => {
            wait(
                core,
                &mut state,
                &app_dir,
                "unreachable",
                i18n::text(
                    "_native.heartbeat.waitingUnreachable",
                    json!({ "detail": detail }),
                ),
                now,
            );
            return Ok(TickResult::skip("skip:unreachable"));
        }
        Err(TickFailure::Failed { message, kind }) => {
            // 何かは受け取った (HTTP の応答 / 時間切れ / 切断) ので待機ではない
            state.waiting = None;
            if !manual {
                state.daily_count += 1;
            }
            // 復帰直後はネットワークが戻っていないことがあるので、連続失敗 (自動停止) には
            // 数えない。手動も数えない (#1321)
            if source != "resumed" && !manual {
                state.consecutive_failures += 1;
            }
            let n = state.consecutive_failures;
            tracing::warn!(
                "heartbeat inference failed ({n}/{MAX_CONSECUTIVE_FAILURES}): {message}"
            );
            // 理由を永続化し、同じ signature は初回だけ通知する
            if record_failure(&mut state, source, &message, now) {
                let short: String = message.chars().take(120).collect();
                toast(
                    core,
                    "warning",
                    i18n::text("_native.heartbeat.failed", json!({ "error": short })),
                );
            }
            append_error(core, &cfg, source, &message, now).await;
            if n >= MAX_CONSECUTIVE_FAILURES {
                state.consecutive_failures = 0;
                save_state(&app_dir, &state);
                ai_config::set_heartbeat_enabled(core, false)?;
                toast(
                    core,
                    "warning",
                    i18n::text(
                        "_native.heartbeat.stoppedFailures",
                        json!({ "count": MAX_CONSECUTIVE_FAILURES }),
                    ),
                );
            } else {
                save_state(&app_dir, &state);
            }
            return Ok(TickResult {
                outcome: "error".into(),
                provider: view,
                usage: None,
                error_kind: kind,
            });
        }
    };
    let usage = report.usage;
    let outcome = if report.body.is_none() && report.intents.is_empty() {
        "suppressed"
    } else {
        let reported = report.body.is_some();
        deliver(core, &cfg, &provider, report, now).await?;
        if reported {
            "reported"
        } else {
            "queued"
        }
    };
    Ok(TickResult {
        outcome: outcome.into(),
        provider: view,
        usage,
        error_kind: None,
    })
}

/// 待機 (provider 無し / 到達不能) に入り、初めての理由なら toast で知らせる
fn wait(
    core: &Core,
    state: &mut PersistedState,
    app_dir: &Path,
    kind: &str,
    text: i18n::Text,
    now: u64,
) {
    let first = enter_waiting(state, kind, text.clone(), now);
    save_state(app_dir, state);
    if first {
        toast(core, "warning", text);
    }
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
                    "cheap check only takes cheap capabilities notecore can run on its own; ignoring"
                );
                continue;
            }
            if !decl.permissions.iter().all(|p| granted.contains(p)) {
                continue;
            }
            let value = match crate::exec::execute(core, cap_id, json!({}), &ctx).await {
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
    /// 最初のラウンドの usage (実測があるときだけ) と送った量の推定 (#1321)
    usage: Option<HeartbeatTickUsage>,
}

/// 推論の失敗の種類 (#1321)。`run_body` が数え方を変える
enum TickFailure {
    /// provider 無し (推論の入口で分かったもの: 接続が消えた / AI プロバイダーでない /
    /// 鍵が無い / 宛先の検査で拒まれた)
    NoProvider(i18n::Text),
    /// 到達不能 (何も受け取る前の接続の失敗)
    Unreachable(String),
    /// 推論の失敗 (数える)。`kind` は送信時の失敗の種別 (`timeout` 等)
    Failed {
        message: String,
        kind: Option<String>,
    },
}

/// 推論の入口 (`resolve_connection`) の Err のうち「provider 無し」に落とすもの。文字列では
/// なく手がかりのキーで見分ける
const NO_PROVIDER_KEYS: &[&str] = &[
    "_native.ai.connectionNotFound",
    "_native.ai.notAiProvider",
    "_native.ai.apiKeyMissing",
    "_native.ai.endpointDenied",
    "_native.ai.hostNotAllowed",
];

fn classify_start_error(e: NoteDeckError) -> TickFailure {
    let key = e
        .i18n()
        .and_then(|v| v.get("key"))
        .and_then(Value::as_str)
        .map(str::to_string);
    match (key, e.i18n().cloned()) {
        (Some(k), Some(hint)) if NO_PROVIDER_KEYS.contains(&k.as_str()) => {
            TickFailure::NoProvider(i18n::Text {
                text: e.to_string(),
                i18n: hint,
            })
        }
        _ => TickFailure::Failed {
            message: e.to_string(),
            kind: None,
        },
    }
}

/// ターンの `error` イベントを失敗の種類に落とす。到達不能は `transport` だけ (応答待ちの
/// 時間切れと受信途中の切断は数える)。resolver の拒否 (`blocked`) は設定の誤りなので provider 無し
fn classify_turn_error(e: &AiTurnEvent) -> TickFailure {
    let message = e.error.clone().unwrap_or_else(|| "turn failed".into());
    match e.error_kind.as_deref() {
        Some("transport") => TickFailure::Unreachable(message),
        Some("blocked") => TickFailure::NoProvider(i18n::text(
            "_native.heartbeat.waitingBlocked",
            json!({ "detail": message }),
        )),
        kind => TickFailure::Failed {
            message,
            kind: kind.map(str::to_string),
        },
    }
}

/// 送った量の推定 (token)。system は turn の開始時に notemaid が組んだもの
fn estimated_input_tokens(turn_id: &str, user_message: &str) -> u64 {
    let system_chars = ai_turn::recent_system(turn_id)
        .map(|s| s.chars().count())
        .unwrap_or(0);
    crate::ai_budget::estimate_tokens(system_chars + user_message.chars().count())
}

/// 最初のラウンドの実測 (無ければ None)
fn first_round_usage(events: &[AiTurnEvent], estimated: u64) -> Option<HeartbeatTickUsage> {
    events
        .iter()
        .find(|e| e.kind == "usage")
        .and_then(|e| e.usage)
        .map(|u| HeartbeatTickUsage {
            input_tokens: u.input_tokens,
            estimated_input_tokens: estimated,
        })
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

/// 巡回の user メッセージ。復帰後は前回からの経過を添え、寝ている間のまとめを書けるようにする
/// heartbeat の user メッセージ: tick の知らせ + 巡回の手順 (HEARTBEAT.md と heartbeat skill)
fn heartbeat_user_message(now: u64, gap: Option<Duration>, skill_bodies: &[String]) -> String {
    format!(
        "{}\n\n<heartbeat-skills>\n{}\n</heartbeat-skills>",
        tick_message(now, gap),
        skill_bodies.join("\n\n---\n\n")
    )
}

/// デバイスの `formatLocalTimestamp` と同じ `YYYYMMDDhhmmss` (ローカル時刻)
fn local_stamp(ms: u64) -> String {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(ms as i64)
        .single()
        .map(|d| d.format("%Y%m%d%H%M%S").to_string())
        .unwrap_or_else(|| utc_stamp(ms))
}

/// デバイスの `timestampTitle(now, "")` と同じ `YYYY-MM-DD hh:mm` (ローカル時刻)
fn local_title_time(ms: u64) -> String {
    use chrono::TimeZone;
    chrono::Local
        .timestamp_millis_opt(ms as i64)
        .single()
        .map(|d| d.format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|| utc_title_time(ms))
}

fn tick_message(now: u64, gap: Option<Duration>) -> String {
    let at = crate::exec::iso_from_unix_ms(now as i64);
    match gap {
        None => format!("Heartbeat tick at {at}"),
        Some(g) => {
            let minutes = g.as_secs() / 60;
            let (h, m) = (minutes / 60, minutes % 60);
            format!(
                "Heartbeat tick at {at}. The device was asleep; the previous round was {h}h {m}m ago. Cover what happened since then."
            )
        }
    }
}

/// 巡回のターン要求を組む (tick と試走で同じ組み立て。試走は `dry_run` と固定の指示を足す)
fn turn_request(
    cfg: &AiConfigLite,
    provider: &HeartbeatProvider,
    hb_skills: &[SkillMeta],
    user_message: String,
    turn_id: String,
    dry_run: bool,
) -> AiTurnRequest {
    // system (SOUL / キャラクター / USER / MEMORY / AGENTS / always skill) は notemaid が
    // 組む (#1162)。HEARTBEAT.md と heartbeat skill の本文は OpenClaw の scratch と同じく
    // user 側のメッセージに付け、固定の INSTRUCTION を system の末尾に置く。
    // デバイスへの問い合わせ (橋 heartbeat/context) は無い
    let context_untrusted = hb_skills.iter().any(|s| s.tainted == Some(true));
    AiTurnRequest {
        turn_id,
        session_id: None,
        principal: "ai.heartbeat".into(),
        account_id: None,
        connection_id: provider.connection_id.clone(),
        model: provider.model.clone(),
        device_context: Some(INSTRUCTION.to_string()),
        trigger_skill_ids: Vec::new(),
        messages: vec![AiChatMessage {
            role: AiChatRole::User,
            content: user_message,
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: None,
        }],
        max_tokens: Some(cfg.generation.max_tokens),
        read_timeout_ms: Some(u64::from(cfg.generation.read_timeout_seconds) * 1000),
        max_tool_rounds: Some(if dry_run {
            1
        } else {
            cfg.generation.max_tool_rounds
        }),
        continuation: false,
        generate_title: false,
        title_max_tokens: None,
        tool_param_enums: None,
        device_tools: Vec::new(),
        context_untrusted,
        dry_run,
    }
}

/// ターンを走らせて done / error まで待ち、集めたイベントを返す
async fn run_turn_collect(
    core: &Core,
    req: AiTurnRequest,
    wait_limit: Duration,
) -> std::result::Result<Vec<AiTurnEvent>, TickFailure> {
    let turn_id = req.turn_id.clone();
    let sink = Arc::new(CollectSink {
        events: Mutex::new(Vec::new()),
        done: tokio::sync::Notify::new(),
    });
    ai_turn::start_turn_with_sink(core, req, sink.clone())
        .await
        .map_err(classify_start_error)?;
    if tokio::time::timeout(wait_limit, sink.done.notified())
        .await
        .is_err()
    {
        ai_turn::cancel_turn(&turn_id);
        return Err(TickFailure::Failed {
            message: "heartbeat turn timed out".into(),
            kind: Some("timeout".into()),
        });
    }
    let events = sink.events.lock().map(|v| v.clone()).unwrap_or_default();
    if let Some(e) = events.iter().find(|e| e.kind == "error") {
        return Err(classify_turn_error(e));
    }
    Ok(events)
}

/// 応答契約の tool の最後の入力
fn report_tool_input(events: &[AiTurnEvent]) -> Option<Value> {
    let report_tool_name = capabilities::tool_name(REPORT_CAPABILITY);
    events
        .iter()
        .filter(|e| e.kind == "tool_use" && e.tool_use_name.as_deref() == Some(&report_tool_name))
        .filter_map(|e| e.tool_use_input.clone())
        .next_back()
}

async fn run_inference(
    core: &Core,
    cfg: &AiConfigLite,
    provider: &HeartbeatProvider,
    hb_skills: &[SkillMeta],
    skill_bodies: &[String],
    now: u64,
    gap: Option<Duration>,
) -> std::result::Result<Report, TickFailure> {
    let turn_id = format!("hb-{now}-{}", &utc_stamp(now)[8..]);
    let user_message = heartbeat_user_message(now, gap, skill_bodies);
    let req = turn_request(
        cfg,
        provider,
        hb_skills,
        user_message.clone(),
        turn_id.clone(),
        false,
    );
    let budget = Duration::from_secs(
        u64::from(cfg.generation.read_timeout_seconds)
            * u64::from(cfg.generation.max_tool_rounds + 2),
    )
    .min(TURN_HARD_LIMIT);
    let events = run_turn_collect(core, req, budget).await?;
    let usage = first_round_usage(&events, estimated_input_tokens(&turn_id, &user_message));
    let tool_report = report_tool_input(&events);
    let intents: Vec<Intent> = events
        .iter()
        .filter(|e| e.kind == "intent")
        .filter_map(|e| {
            Some(Intent {
                capability_id: e.tool_use_name.clone()?,
                params: e.tool_use_input.clone().unwrap_or(json!({})),
                untrusted: e.reason.as_deref() == Some("untrusted"),
            })
        })
        .collect();
    // セッション id とタイトル用のローカル時刻 (デバイスと同じ書式。notemaid は同じ
    // 端末で動くので OS のタイムゾーンでよい)
    let local_stamp = Some(local_stamp(now));
    let local_title_time = Some(local_title_time(now));
    let final_text = events
        .iter()
        .find(|e| e.kind == "done")
        .and_then(|e| e.text.clone());
    let (body, notify) = report_contract(tool_report.as_ref(), final_text.as_deref());
    Ok(Report {
        body,
        notify,
        intents,
        local_stamp,
        local_title_time,
        usage,
    })
}

// ---------------------------------------------------------------------------
// 試走 (#1321)
// ---------------------------------------------------------------------------

/// 「この接続を試す」の結果。`outcome` は `ok` (report tool を呼べた) / `no_tool` (呼ばなかった) /
/// `unreachable` / `no_provider` / `error`。`message` は英語の正本文、`i18n` は手がかり
/// (`{ message: { key, params } }`、無ければ生のエラー文)
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatProbeResult {
    pub outcome: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, rename = "i18n", skip_serializing_if = "Option::is_none")]
    pub i18n: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<HeartbeatTickUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<HeartbeatProviderView>,
    /// `error` のときの送信時の失敗の種別 (`timeout` なら一文添える)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<String>,
}

impl HeartbeatProbeResult {
    fn outcome(outcome: &str) -> Self {
        Self {
            outcome: outcome.into(),
            message: None,
            i18n: None,
            usage: None,
            provider: None,
            error_kind: None,
        }
    }
    fn with_text(mut self, t: i18n::Text) -> Self {
        self.message = Some(t.text);
        self.i18n = Some(json!({ "message": t.i18n }));
        self
    }
}

/// 試走: 通常の tick と同じ組み立ての prompt に固定の指示を足して 1 巡だけ回す。report tool
/// 以外は執行せず (`dry_run`)、報告先への書込 / 通知 / 受信箱カードは起きず、`HeartbeatStatus` の
/// 最後の巡回も書かない。予算は消費する。実行中の印は timer の tick と共有する
pub async fn probe(core: &Core) -> Result<HeartbeatProbeResult> {
    let Some(_guard) = try_begin() else {
        return Err(NoteDeckError::InvalidInput(
            "HEARTBEAT is already running".into(),
        ));
    };
    let app_dir = core.app_dir()?.to_path_buf();
    let cfg = ai_config::load(core)?;
    let provider = match cfg.heartbeat_provider(&load_connections(&app_dir)) {
        Ok(p) => p,
        Err(reason) => {
            return Ok(HeartbeatProbeResult::outcome("no_provider")
                .with_text(i18n::text(reason.i18n_key(), json!({}))));
        }
    };
    let hb_skills: Vec<SkillMeta> = skills::list(core)?
        .into_iter()
        .filter(|s| s.mode == "heartbeat")
        .collect();
    let skill_bodies: Vec<String> = hb_skills
        .iter()
        .filter(|s| !crate::workspace::is_effectively_empty(&s.body))
        .map(|s| format!("# Skill: {}\n\n{}", s.name, s.body.trim()))
        .collect();
    let now = ai_sessions::now_ms();
    let turn_id = format!("hb-probe-{now}");
    let user_message = format!(
        "{}\n\n{PROBE_INSTRUCTION}",
        heartbeat_user_message(now, None, &skill_bodies)
    );
    let req = turn_request(
        &cfg,
        &provider,
        &hb_skills,
        user_message.clone(),
        turn_id.clone(),
        true,
    );
    let wait_limit =
        Duration::from_secs(u64::from(cfg.generation.read_timeout_seconds) * PROBE_TIMEOUT_FACTOR);
    let view = Some(provider.view());
    let mut out = match run_turn_collect(core, req, wait_limit).await {
        Ok(events) => {
            let usage = first_round_usage(&events, estimated_input_tokens(&turn_id, &user_message));
            let mut r = HeartbeatProbeResult::outcome(if report_tool_input(&events).is_some() {
                "ok"
            } else {
                "no_tool"
            });
            r.usage = usage;
            r
        }
        Err(TickFailure::NoProvider(text)) => {
            HeartbeatProbeResult::outcome("no_provider").with_text(text)
        }
        Err(TickFailure::Unreachable(detail)) => HeartbeatProbeResult::outcome("unreachable")
            .with_text(i18n::text(
                "_native.heartbeat.waitingUnreachable",
                json!({ "detail": detail }),
            )),
        Err(TickFailure::Failed { message, kind }) => {
            let mut r = HeartbeatProbeResult::outcome("error");
            r.message = Some(message);
            r.error_kind = kind;
            r
        }
    };
    out.provider = view;
    Ok(out)
}

/// 応答契約: (報告の本文, 知らせるか)。`heartbeat.report` tool の入力があればそれに従う。
/// tool を呼ばない応答は legacy の ack として抑制し、残った本文は報告として残すが
/// 知らせない (#1227): 知らせるかは AI が tool で明示したときだけ決まる。INSTRUCTION は
/// 報告を tool に限っているので、tool を呼ばない本文は契約の外 (「通知に記憶を
/// 載せない」の指示も tool の notify にしか掛かっていない)
fn report_contract(tool_input: Option<&Value>, final_text: Option<&str>) -> (Option<String>, bool) {
    if let Some(input) = tool_input {
        let body = input
            .get("body")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        return (
            (!body.is_empty()).then(|| body.to_string()),
            input.get("notify").and_then(Value::as_bool) == Some(true),
        );
    }
    (apply_suppression(final_text, ACK_MAX_CHARS), false)
}

/// 報告先セッション。`auto` は kind=heartbeat の専用セッション (無ければ作る)。
/// 戻り値 (id, 作ったか)。None = 書かない (target=none / 指定 id が無い)。
async fn resolve_target(
    core: &Core,
    cfg: &AiConfigLite,
    provider: Option<&HeartbeatProvider>,
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
            let title = i18n::text(
                "_native.heartbeat.sessionTitle",
                json!({ "time": local_title_time.unwrap_or_else(|| utc_title_time(now)) }),
            );
            let created = ai_sessions::create(
                &base,
                AiSessionCreate {
                    id,
                    kind: "heartbeat".into(),
                    title: title.text,
                    // 報告先セッションの snapshot は巡回の接続 (#1321)
                    model: provider.map(|p| p.model.clone()).unwrap_or_default(),
                    connection_id: provider
                        .map(|p| p.connection_id.clone())
                        .unwrap_or_default(),
                    persona_skill_id: None,
                    i18n: Some(json!({ "title": title.i18n })),
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
        i18n: None,
    }
}

/// 定型の本文 (英語の正本文 + 表示言語で描き直す手がかり) の HEARTBEAT メッセージ
fn hb_text_message(id: String, content: i18n::Text, ts: u64) -> SessionMessage {
    let mut msg = hb_message(id, content.text, ts);
    msg.i18n = Some(json!({ "content": content.i18n }));
    msg
}

/// 書込意図 → 受信箱カード (投稿系は下書きも作る)。
async fn intent_message(core: &Core, intent: &Intent, now: u64, index: usize) -> SessionMessage {
    // 英語の正本文用の表示名。デバイスは capability の id で表示言語の表示名に引き直す
    let label = i18n::render(
        i18n::CANONICAL,
        &format!("_capabilities.{}", intent.capability_id),
        &json!({}),
    );
    let mut status = "pending";
    let mut draft_id: Option<String> = None;
    let mut error: Option<String> = None;
    let mut error_i18n: Option<Value> = None;
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
                match notecore::commands::drafts::api_create_draft(
                    core,
                    account_id.to_string(),
                    body,
                )
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
            _ => {
                let t = i18n::text("_native.heartbeat.draftNeedsAccount", json!({}));
                error = Some(t.text);
                error_i18n = Some(t.i18n);
            }
        }
    }
    let mut msg = hb_text_message(
        format!("msg-{now}-hb-intent-{index}"),
        i18n::text(
            "_native.heartbeat.intentProposed",
            json!({ "label": label, "capability": intent.capability_id }),
        ),
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
    if let (Some(intent_json), Some(hint)) = (msg.intent.as_mut(), error_i18n) {
        intent_json["i18n"] = json!({ "error": hint });
    }
    msg
}

async fn deliver(
    core: &Core,
    cfg: &AiConfigLite,
    provider: &HeartbeatProvider,
    report: Report,
    now: u64,
) -> Result<()> {
    let target = resolve_target(
        core,
        cfg,
        Some(provider),
        report.local_stamp,
        report.local_title_time,
        now,
    )
    .await?;
    let base = settings_base_dir(core)?;
    match &target {
        Some((session_id, _)) => {
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
            ai_sessions::append(&base, session_id, messages)?;
        }
        None => tracing::debug!(
            target = %cfg.heartbeat.target,
            "heartbeat target resolved to null, log only: {}",
            report.body.as_deref().unwrap_or("").chars().take(80).collect::<String>()
        ),
    }
    // 「通知して」の報告は報告先の有無に関わらず記録し (閉じている間の件数)、知らせる
    if report.notify && report.body.is_some() {
        let app_dir = core.app_dir()?;
        let mut state = load_state(app_dir);
        record_notice(&mut state, now, target.as_ref().map(|(id, _)| id.clone()));
        save_state(app_dir, &state);
    }
    for ev in delivered_events(
        target.as_ref().map(|(id, _)| id.as_str()),
        target.as_ref().is_some_and(|(_, created)| *created),
        report.body.as_deref(),
        report.notify,
        report.intents.len(),
        cfg.heartbeat.desktop_notification,
    ) {
        emit(core, ev);
    }
    let (Some(visible), Some((session_id, created))) = (report.body.as_deref(), target) else {
        return Ok(());
    };
    if created {
        if let Some(title) = generate_title(core, cfg, provider, visible).await {
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

/// 報告先に書いた後にデバイスへ流す出来事。`report` は報告先に書いたときだけ、`notify` は
/// AI が「通知して」とした報告のときだけ (報告先が「なし」でも、デスクトップ通知の設定に
/// 関わらず。設定は `desktop` に載せる)
fn delivered_events(
    session_id: Option<&str>,
    created: bool,
    body: Option<&str>,
    notify: bool,
    intents: usize,
    desktop: bool,
) -> Vec<HeartbeatEvent> {
    let mut out = Vec::new();
    if let Some(session_id) = session_id {
        let mut ev = HeartbeatEvent::new("report");
        ev.session_id = Some(session_id.to_string());
        ev.created = Some(created);
        if intents > 0 {
            ev.pending = Some(u32::try_from(intents).unwrap_or(u32::MAX));
        }
        out.push(ev);
    }
    if let (Some(visible), true) = (body, notify) {
        let mut text: String = visible.chars().take(200).collect();
        if visible.chars().count() > 200 {
            text.push('…');
        }
        let mut ev = HeartbeatEvent::new("notify");
        ev.session_id = session_id.map(str::to_string);
        ev.title = Some("HEARTBEAT".into());
        ev.body = Some(text);
        ev.desktop = Some(desktop);
        out.push(ev);
    }
    out
}

async fn append_error(core: &Core, cfg: &AiConfigLite, source: &str, err: &str, now: u64) {
    if cfg.heartbeat.target == "none" {
        return;
    }
    let Ok(Some((session_id, created))) = resolve_target(core, cfg, None, None, None, now).await
    else {
        return;
    };
    let Ok(base) = settings_base_dir(core) else {
        return;
    };
    let msg = hb_text_message(
        format!("msg-{now}-hb-err"),
        i18n::text(
            "_native.heartbeat.failedMessage",
            json!({ "source": source, "error": err }),
        ),
        now,
    );
    if ai_sessions::append(&base, &session_id, vec![msg]).is_ok() {
        let mut ev = HeartbeatEvent::new("report");
        ev.session_id = Some(session_id);
        ev.created = Some(created);
        emit(core, ev);
    }
}

const TITLE_SYSTEM: &str = "You write titles for HEARTBEAT notifications. Output one short line that sums up the notification, in the same language as the notification. Keep it around 20 characters (at most 40). No quotes, preamble, line breaks, emoji, or trailing period. Return only the title.";

struct TextSink(
    Mutex<String>,
    Mutex<Option<String>>,
    Mutex<Option<crate::ai_budget::TokenUsage>>,
);

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
            "usage" => {
                if let (Some(u), Ok(mut slot)) = (event.usage, self.2.lock()) {
                    match slot.as_mut() {
                        Some(cur) => cur.merge(u),
                        None => *slot = Some(u),
                    }
                }
            }
            _ => {}
        }
    }
}

async fn generate_title(
    core: &Core,
    cfg: &AiConfigLite,
    provider: &HeartbeatProvider,
    report: &str,
) -> Option<String> {
    let app_dir = core.app_dir().ok()?;
    // タイトル生成も巡回の接続 (#1321)
    let conn = ai_chat_service::resolve_connection(app_dir, &provider.connection_id).ok()?;
    let req = AiChatRequest {
        stream_id: "heartbeat-title".into(),
        connection_id: provider.connection_id.clone(),
        model: provider.model.clone(),
        messages: vec![AiChatMessage {
            role: AiChatRole::User,
            content: format!(
                "Give the following HEARTBEAT notification a short title that states its subject. Output only the title on one line.\n\n{report}"
            ),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: None,
        }],
        system: Some(TITLE_SYSTEM.into()),
        session_id: None,
        max_tokens: Some(cfg.generation.title_max_tokens),
        read_timeout_ms: Some(u64::from(cfg.generation.read_timeout_seconds) * 1000),
        tools: None,
        affinity: Some(crate::ai_affinity::ConversationKey::Heartbeat),
    };
    // タイトル生成も接続の token 予算に数える (超過なら呼ばない)
    let budget = cfg.daily_budget_for(&provider.connection_id);
    let store_dir = ai_turn::checkpoint::dir(app_dir);
    let chars = TITLE_SYSTEM.chars().count() + req.messages[0].content.chars().count();
    if let Some(daily) = budget {
        if let Err(exceeded) = crate::ai_budget::check(
            &store_dir,
            &provider.connection_id,
            daily,
            crate::ai_budget::estimate_tokens(chars),
            crate::ai_sessions::now_ms(),
        ) {
            tracing::info!("heartbeat title generation skipped: {exceeded}");
            return None;
        }
    }
    let sink = TextSink(
        Mutex::new(String::new()),
        Mutex::new(None),
        Mutex::new(None),
    );
    let result = ai_chat_service::run_round(&req, &conn, &sink).await;
    let text = sink.0.lock().ok()?.clone();
    if budget.is_some() {
        let usage = sink
            .2
            .lock()
            .ok()
            .and_then(|u| *u)
            .unwrap_or(crate::ai_budget::TokenUsage {
                input_tokens: crate::ai_budget::estimate_tokens(chars),
                output_tokens: crate::ai_budget::estimate_tokens(text.chars().count()),
                estimated: true,
            });
        crate::ai_budget::settle(
            &store_dir,
            &provider.connection_id,
            usage,
            crate::ai_sessions::now_ms(),
        );
    }
    if let Err(e) = result {
        tracing::warn!("heartbeat title generation failed: {e}");
        return None;
    }
    let title = clean_report_title(&text);
    (!title.is_empty()).then_some(title)
}

#[cfg(test)]
mod tick_message_tests {
    use super::*;

    #[test]
    fn resumed_rounds_mention_the_gap() {
        let plain = tick_message(0, None);
        assert!(plain.starts_with("Heartbeat tick at "));
        assert!(!plain.contains("asleep"));
        let resumed = tick_message(0, Some(Duration::from_secs(9 * 3600 + 5 * 60)));
        assert!(resumed.contains("9h 5m ago"), "{resumed}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delivered_events_reach_the_inbox_regardless_of_desktop_setting() {
        // 報告 + 「通知して」 + 確認待ち 2 件、デスクトップ通知は off
        let evs = delivered_events(Some("s1"), false, Some("見てほしい"), true, 2, false);
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].kind, "report");
        assert_eq!(evs[0].session_id.as_deref(), Some("s1"));
        assert_eq!(evs[0].pending, Some(2));
        assert_eq!(evs[1].kind, "notify");
        assert_eq!(evs[1].session_id.as_deref(), Some("s1"));
        assert_eq!(evs[1].body.as_deref(), Some("見てほしい"));
        assert_eq!(evs[1].desktop, Some(false));

        // デスクトップ通知 on なら OS 通知の印が付く
        let evs = delivered_events(Some("s1"), true, Some("x"), true, 0, true);
        assert_eq!(evs[0].pending, None);
        assert_eq!(evs[0].created, Some(true));
        assert_eq!(evs[1].desktop, Some(true));

        // 「通知して」でない報告 / 確認待ちだけ: notify は出さない
        assert_eq!(
            delivered_events(Some("s1"), false, Some("x"), false, 0, true).len(),
            1
        );
        let evs = delivered_events(Some("s1"), false, None, false, 1, true);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].pending, Some(1));
    }

    #[test]
    fn delivered_events_notify_even_without_a_target_session() {
        // 報告先が「なし」でも「通知して」の報告は知らせる (#1227)。開く先は無い
        let evs = delivered_events(None, false, Some("見てほしい"), true, 0, true);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, "notify");
        assert_eq!(evs[0].session_id, None);
        assert_eq!(evs[0].body.as_deref(), Some("見てほしい"));
        assert_eq!(evs[0].desktop, Some(true));
        // 「通知して」でなければ何も流さない (報告先が無いので写しの読み直しも無い)
        assert!(delivered_events(None, false, Some("x"), false, 0, true).is_empty());
    }

    #[test]
    fn report_contract_notifies_only_when_the_tool_says_so() {
        // tool 経由: notify の真偽に従う
        let r = report_contract(Some(&json!({"body": " 新着 ", "notify": true})), None);
        assert_eq!(r, (Some("新着".to_string()), true));
        let r = report_contract(Some(&json!({"body": "新着"})), None);
        assert_eq!(r, (Some("新着".to_string()), false));
        // legacy (tool を呼ばない応答): ack は捨て、残った本文は報告にするが知らせない (#1227)
        assert_eq!(report_contract(None, Some("HEARTBEAT_OK")), (None, false));
        assert_eq!(
            report_contract(None, Some("途中に HEARTBEAT_OK がある短文")),
            (Some("途中に HEARTBEAT_OK がある短文".to_string()), false)
        );
    }

    #[test]
    fn notices_are_recorded_with_a_cap_and_read_since() {
        let mut st = PersistedState::default();
        record_notice(&mut st, 10, Some("s1".into()));
        record_notice(&mut st, 20, None);
        assert_eq!(
            notices_since(&st, 10),
            vec![HeartbeatNotice {
                at: 20,
                session_id: None
            }]
        );
        assert_eq!(notices_since(&st, 0).len(), 2);
        for i in 0..(NOTICES_LIMIT as u64 + 10) {
            record_notice(&mut st, 100 + i, None);
        }
        assert_eq!(st.notices.len(), NOTICES_LIMIT);
        // 溢れたら古いものから捨てる
        assert!(st.notices.iter().all(|n| n.at >= 100));
    }

    #[test]
    fn notify_body_is_truncated() {
        let long = "あ".repeat(250);
        let evs = delivered_events(Some("s1"), false, Some(&long), true, 0, true);
        let body = evs[1].body.as_deref().unwrap();
        assert_eq!(body.chars().count(), 201);
        assert!(body.ends_with('…'));
    }

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
    fn heartbeat_user_message_carries_the_tick_and_the_steps() {
        let m = heartbeat_user_message(0, None, &["# Skill: A\n\ncheck drafts".into()]);
        assert!(m.starts_with("Heartbeat tick at "));
        assert!(m.contains("<heartbeat-skills>\n# Skill: A\n\ncheck drafts\n</heartbeat-skills>"));
        // ローカル時刻の刻印はデバイスと同じ書式
        assert_eq!(local_stamp(0).len(), 14);
        assert!(local_stamp(0).chars().all(|c| c.is_ascii_digit()));
        let title = local_title_time(0);
        assert_eq!(title.len(), 16);
        assert_eq!(&title[4..5], "-");
        assert_eq!(&title[10..11], " ");
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
    fn failure_record_keeps_no_secret_in_message_or_signature() {
        // 秘密は message にも signature にも残らない (#1164)
        let key = "heartbeat-test-vault-key-0123456789";
        crate::redact::register(crate::redact::Kind::Vault, key);
        let mut st = PersistedState::default();
        assert!(record_failure(
            &mut st,
            "scheduled",
            &format!("bad key {key}"),
            1
        ));
        let dump = serde_json::to_string(&st).unwrap();
        assert!(!dump.contains(key), "{dump}");
        assert!(dump.contains("[redacted:vault]"), "{dump}");
    }

    #[test]
    fn failure_signature_and_first_notification() {
        // ステータスコード (3 桁以下) は原因なので残し、長い数字 (id 等) は潰す
        assert_eq!(failure_signature("HTTP 503  from api"), "http 503 from api");
        assert_eq!(failure_signature("HTTP 502 from api"), "http 502 from api");
        assert_eq!(
            failure_signature("timeout req 12345678 after 30s"),
            "timeout req # after 30s"
        );
        let mut st = PersistedState::default();
        assert!(record_failure(&mut st, "scheduled", "HTTP 503 from api", 1));
        assert!(record_failure(&mut st, "scheduled", "HTTP 502 from api", 2));
        assert!(!record_failure(
            &mut st,
            "scheduled",
            "HTTP 502 from api",
            3
        ));
        assert!(record_failure(&mut st, "manual", "network error", 4));
        assert_eq!(st.failures.len(), 4);
        assert_eq!(st.failures[0].message, "network error");
        for i in 0..30 {
            record_failure(&mut st, "s", &format!("x{i}"), 10 + i);
        }
        assert_eq!(st.failures.len(), FAILURES_LIMIT);
        // 通知済み signature は上限まで。溢れたら古いものを忘れて再通知できる
        for i in 0..(NOTIFIED_LIMIT as u64 + 10) {
            record_failure(
                &mut st,
                "s",
                &format!("kind-{}", "z".repeat(i as usize % 70 + 1)),
                100 + i,
            );
        }
        assert!(st.notified_signatures.len() <= NOTIFIED_LIMIT);
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

    // --- 巡回の接続と tick の結果の種類 (#1321) ---

    fn turn_error(kind: Option<&str>) -> AiTurnEvent {
        let mut e = AiTurnEvent::new("t", "error");
        e.error = Some("boom".into());
        e.error_kind = kind.map(str::to_string);
        e
    }

    #[test]
    fn turn_errors_are_classified_by_kind_not_by_text() {
        // 到達不能は transport だけ。時間切れ / 受信途中の切断 / HTTP は数える失敗
        assert!(matches!(
            classify_turn_error(&turn_error(Some("transport"))),
            TickFailure::Unreachable(m) if m == "boom"
        ));
        assert!(matches!(
            classify_turn_error(&turn_error(Some("timeout"))),
            TickFailure::Failed { kind: Some(k), .. } if k == "timeout"
        ));
        assert!(matches!(
            classify_turn_error(&turn_error(None)),
            TickFailure::Failed { kind: None, .. }
        ));
        // resolver の拒否 (名前解決の結果が内部) は設定の誤り = provider 無し
        match classify_turn_error(&turn_error(Some("blocked"))) {
            TickFailure::NoProvider(t) => {
                assert_eq!(t.i18n["key"], "_native.heartbeat.waitingBlocked");
                assert!(t.text.contains("boom"), "{}", t.text);
            }
            _ => panic!("blocked must be no-provider"),
        }
    }

    #[test]
    fn start_errors_fall_to_no_provider_only_for_connection_keys() {
        let e = i18n::error("INVALID_INPUT", "_native.ai.connectionNotFound", json!({}));
        assert!(matches!(
            classify_start_error(e),
            TickFailure::NoProvider(_)
        ));
        let e = i18n::error(
            "AUTH_CREDENTIAL_MISSING",
            "_native.ai.apiKeyMissing",
            json!({ "name": "x" }),
        );
        assert!(matches!(
            classify_start_error(e),
            TickFailure::NoProvider(_)
        ));
        let e = i18n::error(
            "INVALID_INPUT",
            "_native.ai.endpointDenied",
            json!({ "host": "h", "reason": "r" }),
        );
        assert!(matches!(
            classify_start_error(e),
            TickFailure::NoProvider(_)
        ));
        // 要求の検証エラー (サイズ超過) や未知の harness は数える失敗
        let e = i18n::error(
            "INVALID_INPUT",
            "_native.ai.requestTooLarge",
            json!({ "size": 1, "max": 1 }),
        );
        assert!(matches!(
            classify_start_error(e),
            TickFailure::Failed { .. }
        ));
        let e = NoteDeckError::InvalidInput("unknown CLI harness: x".into());
        assert!(matches!(
            classify_start_error(e),
            TickFailure::Failed { .. }
        ));
    }

    #[test]
    fn truncation_is_only_suspected_when_input_is_far_below_the_estimate() {
        let u = |input, est| HeartbeatTickUsage {
            input_tokens: input,
            estimated_input_tokens: est,
        };
        assert!(u(1_000, 4_000).looks_truncated());
        assert!(!u(3_000, 4_000).looks_truncated());
        assert!(!u(5_000, 4_000).looks_truncated());
        // 推定が無ければ判断しない
        assert!(!u(10, 0).looks_truncated());
    }

    #[test]
    fn waiting_notifies_once_per_reason_and_keeps_since() {
        let mut st = PersistedState::default();
        let t = || {
            i18n::text(
                "_native.heartbeat.waitingUnreachable",
                json!({ "detail": "refused" }),
            )
        };
        assert!(enter_waiting(&mut st, "unreachable", t(), 10));
        assert_eq!(st.waiting.as_ref().unwrap().since, 10);
        // 同じ理由で待機し続けても通知しない。since は最初のまま
        assert!(!enter_waiting(&mut st, "unreachable", t(), 20));
        assert_eq!(st.waiting.as_ref().unwrap().since, 10);
        // 別の理由 (provider 無し) に変われば通知し、since も進む
        let np = i18n::text("_native.heartbeat.waitingNotConfigured", json!({}));
        assert!(enter_waiting(&mut st, "no-provider", np, 30));
        let w = st.waiting.as_ref().unwrap();
        assert_eq!((w.kind.as_str(), w.since), ("no-provider", 30));
        assert_eq!(
            w.i18n["message"]["key"],
            "_native.heartbeat.waitingNotConfigured"
        );
        // 待機は失敗の記録には入らない
        assert!(st.failures.is_empty());
    }

    #[test]
    fn last_tick_and_waiting_survive_a_restart() {
        let dir = tempfile::tempdir().unwrap();
        let view = HeartbeatProviderView {
            name: "Ollama".into(),
            model: "qwen".into(),
            local: true,
            protocol: ConnectionProtocol::OpenaiCompat,
        };
        let st = PersistedState {
            last_tick: Some(HeartbeatLastTick {
                at: 5,
                source: "scheduled".into(),
                outcome: "suppressed".into(),
                provider: Some(view.clone()),
                usage: Some(HeartbeatTickUsage {
                    input_tokens: 100,
                    estimated_input_tokens: 400,
                }),
                error_kind: None,
            }),
            waiting: Some(HeartbeatWaiting::new(
                "unreachable",
                3,
                i18n::text(
                    "_native.heartbeat.waitingUnreachable",
                    json!({ "detail": "x" }),
                ),
            )),
            ..Default::default()
        };
        save_state(dir.path(), &st);
        assert_eq!(load_state(dir.path()), st);
        let mut status = HeartbeatStatus::default();
        status.absorb(&load_state(dir.path()));
        assert_eq!(status.last_tick_at, Some(5));
        assert_eq!(status.last_outcome.as_deref(), Some("suppressed"));
        assert_eq!(status.provider, Some(view));
        assert!(status.usage.unwrap().looks_truncated());
        assert_eq!(status.waiting.as_ref().unwrap().kind, "unreachable");
        assert!(status.mounted);
        // HTTP 面の JSON も同じ型 (接続 id は出ない)
        let json = serde_json::to_value(&status).unwrap();
        assert_eq!(json["mounted"], true);
        assert_eq!(json["provider"]["model"], "qwen");
        assert!(json["provider"].get("connectionId").is_none());
    }

    #[test]
    fn daily_gate_checks_before_and_never_counts() {
        // 「次で超えるか」の判定だけで、加算は結果が出てから (推論の前に加算しない)
        let mut st = PersistedState::default();
        let day = 86_400_000 * 10;
        assert_eq!(
            daily_gate(&mut st, day, 2, false, false),
            DailyGate::Proceed
        );
        assert_eq!(st.daily_count, 0);
        st.daily_count = 1;
        assert_eq!(
            daily_gate(&mut st, day, 2, false, false),
            DailyGate::Proceed
        );
        // 上限に達した最初の 1 回だけ警告 (warn)、以後は黙って続ける
        st.daily_count = 2;
        assert_eq!(
            daily_gate(&mut st, day, 2, false, false),
            DailyGate::WarnThenProceed
        );
        st.daily_count = 3;
        assert_eq!(
            daily_gate(&mut st, day, 2, false, false),
            DailyGate::Proceed
        );
        // disable なら上限で止める
        st.daily_count = 2;
        assert_eq!(daily_gate(&mut st, day, 2, true, false), DailyGate::Stop);
        // 手動は上限の外
        assert_eq!(daily_gate(&mut st, day, 2, true, true), DailyGate::Proceed);
        assert_eq!(st.daily_count, 2);
        // 日付が変われば数え直す
        assert_eq!(
            daily_gate(&mut st, day + 86_400_000, 2, true, false),
            DailyGate::Proceed
        );
        assert_eq!((st.daily_date, st.daily_count), (11, 0));
    }

    #[test]
    fn run_guard_is_exclusive_and_released_on_drop() {
        let g = try_begin().expect("free");
        assert!(try_begin().is_none());
        drop(g);
        assert!(try_begin().is_some());
    }
}
