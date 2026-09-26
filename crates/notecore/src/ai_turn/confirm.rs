//! 確認要求 (#1133 縦切り 2): notecore 発の「この操作を許すか」。
//!
//! - 要求は「今回だけ許可 / 今回だけ拒否」の 2 択。表示内容 (プレビュー) は
//!   capability 側 (この段階ではデバイス) が組み立てて同梱する
//! - 1 ターン (1 ラウンド) の複数のツール呼び出しは 1 枚の要求に束ねる
//! - 要求を出したループは turn をチェックポイントに書いて解放する (スレッドを
//!   握らない)。応答で読み戻して再開する
//! - 表示してからの TTL と生成してからの絶対 TTL の両方を持ち、どちらかの超過で
//!   拒否して理由を記録する
//! - 応答は compare-and-set で 1 つだけが効き、遅れた応答は明示エラー。turn の
//!   中断で pending は cancelled で閉じる (ACP の承認の意味論に倣う)
//! - 「次から確認しない」は現状どおり権限ファイル (`confirmSkips`) への減算で、
//!   書くのはデバイス側。notecore は次の判定でそれを読む
//!
//! 在席デバイスへの配送の絞り込み (複数デバイス) は notecored の段階で足す。
//! ローカル構成ではデバイスは 1 台 (WebView) で、要求は全部そこへ届く。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::Value;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

use super::{checkpoint, spawn_drive, AiTurnEvent, TurnRuntime, TurnState};
use crate::error::Result;
use notecli::error::NoteDeckError;

/// 期限の方針。
#[derive(Debug, Clone, Copy)]
pub struct ConfirmPolicy {
    /// 生成してからの絶対 TTL
    pub absolute_ttl: Duration,
    /// 表示してからの TTL
    pub display_ttl: Duration,
}

impl Default for ConfirmPolicy {
    fn default() -> Self {
        Self {
            absolute_ttl: Duration::from_secs(15 * 60),
            display_ttl: Duration::from_secs(10 * 60),
        }
    }
}

/// 閉じた理由 (イベントの `reason` とチェックポイントの記録に使う)。
pub const REASON_DECIDED: &str = "decided";
pub const REASON_CANCELLED: &str = "cancelled";
pub const REASON_EXPIRED_ABSOLUTE: &str = "expired_absolute";
pub const REASON_EXPIRED_DISPLAY: &str = "expired_display";

struct Record {
    turn_id: String,
    rt: Arc<TurnRuntime>,
    created: Instant,
    shown: Option<Instant>,
    notify: Arc<Notify>,
    watchdog: Option<JoinHandle<()>>,
}

fn requests() -> &'static Mutex<HashMap<String, Record>> {
    static R: OnceLock<Mutex<HashMap<String, Record>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit_closed(rt: &TurnRuntime, turn_id: &str, request_id: &str, reason: &str) {
    let mut e = AiTurnEvent::new(turn_id, "confirm_closed");
    e.confirm_request_id = Some(request_id.to_string());
    e.reason = Some(reason.to_string());
    rt.sink.emit(e);
}

/// 確認要求を出して turn を解放する。呼び出し側はこの後すぐ戻る。
pub(crate) fn suspend(rt: Arc<TurnRuntime>, state: &TurnState, items: Vec<Value>) -> Result<()> {
    checkpoint::write(&rt.store_dir, state)?;
    let turn_id = state.req.turn_id.clone();
    let request_id = format!("{turn_id}:confirm{}", state.rounds);
    let notify = Arc::new(Notify::new());
    let record = Record {
        turn_id: turn_id.clone(),
        rt: rt.clone(),
        created: Instant::now(),
        shown: None,
        notify: notify.clone(),
        watchdog: None,
    };
    if let Ok(mut map) = requests().lock() {
        if let Some(prev) = map.insert(request_id.clone(), record) {
            if let Some(h) = prev.watchdog {
                h.abort();
            }
        }
    }
    let mut e = AiTurnEvent::new(&turn_id, "confirm_request");
    e.confirm_request_id = Some(request_id.clone());
    e.confirm_items = Some(Value::Array(items));
    e.expires_at_ms = Some(now_ms() + rt.policy.absolute_ttl.as_millis() as u64);
    rt.sink.emit(e);

    let handle = tokio::spawn(watchdog(request_id.clone(), notify));
    if let Ok(mut map) = requests().lock() {
        if let Some(r) = map.get_mut(&request_id) {
            r.watchdog = Some(handle);
        }
    }
    Ok(())
}

/// 期限の監視。表示の通知 (`shown`) で起きて期限を引き直す。
async fn watchdog(request_id: String, notify: Arc<Notify>) {
    loop {
        let deadline = {
            let map = match requests().lock() {
                Ok(m) => m,
                Err(_) => return,
            };
            let Some(r) = map.get(&request_id) else {
                return;
            };
            deadline_of(r)
        };
        tokio::select! {
            _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline.0)) => {}
            _ = notify.notified() => continue,
        }
        // 期限到達。まだ開いていれば閉じる (応答と競合しても 1 つだけが効く)
        let record = {
            let mut map = match requests().lock() {
                Ok(m) => m,
                Err(_) => return,
            };
            let Some(r) = map.get(&request_id) else {
                return;
            };
            let (d, _) = deadline_of(r);
            if Instant::now() < d {
                continue;
            }
            map.remove(&request_id)
        };
        if let Some(r) = record {
            let (_, reason) = deadline_of(&r);
            tracing::warn!(turn_id = %r.turn_id, request_id, reason, "ai confirm request expired");
            resume(r, &request_id, false, Some(reason));
        }
        return;
    }
}

/// 次に来る期限とその理由。
fn deadline_of(r: &Record) -> (Instant, &'static str) {
    let absolute = (
        r.created + r.rt.policy.absolute_ttl,
        REASON_EXPIRED_ABSOLUTE,
    );
    match r.shown {
        Some(shown) => {
            let display = (shown + r.rt.policy.display_ttl, REASON_EXPIRED_DISPLAY);
            if display.0 <= absolute.0 {
                display
            } else {
                absolute
            }
        }
        None => absolute,
    }
}

/// デバイスが要求を表示した。表示 TTL の起点になる。
pub fn shown(request_id: &str) -> Result<()> {
    let mut map = requests()
        .lock()
        .map_err(|_| NoteDeckError::Internal("confirm registry poisoned".into()))?;
    let r = map.get_mut(request_id).ok_or_else(|| {
        NoteDeckError::InvalidInput("the confirmation request is already settled".into())
    })?;
    if r.shown.is_none() {
        r.shown = Some(Instant::now());
        r.notify.notify_one();
    }
    Ok(())
}

/// デバイスの応答。最初の 1 つだけが効き、遅れた応答は明示エラー。
pub fn respond(request_id: &str, accepted: bool) -> Result<()> {
    let record = requests()
        .lock()
        .map_err(|_| NoteDeckError::Internal("confirm registry poisoned".into()))?
        .remove(request_id)
        .ok_or_else(|| {
            NoteDeckError::InvalidInput(
                "the confirmation request is already settled (another response, expired, or cancelled)".into(),
            )
        })?;
    if let Some(h) = &record.watchdog {
        h.abort();
    }
    resume(record, request_id, accepted, None);
    Ok(())
}

/// チェックポイントを読み戻し、確認待ちだった tool 呼び出しに決定を入れて
/// turn を再開する。
fn resume(record: Record, request_id: &str, accepted: bool, reason: Option<&'static str>) {
    let Record { turn_id, rt, .. } = record;
    emit_closed(&rt, &turn_id, request_id, reason.unwrap_or(REASON_DECIDED));
    let mut state = match checkpoint::read(&rt.store_dir, &turn_id) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(turn_id, "cannot resume ai turn: {e}");
            let mut ev = AiTurnEvent::new(&turn_id, "error");
            let t = crate::i18n::text(
                "_native.ai.resumeFailed",
                serde_json::json!({ "error": e.to_string() }),
            );
            ev.error = Some(t.text);
            ev.error_i18n = Some(t.i18n);
            ev.phase = Some("after_tool".into());
            rt.sink.emit(ev);
            return;
        }
    };
    for p in &mut state.pending {
        if p.needs_confirm && p.decision.is_none() {
            p.decision = Some(accepted);
        }
    }
    state.reject_reason = if accepted {
        None
    } else {
        reason.map(str::to_string)
    };
    spawn_drive(rt, state);
}

/// turn の中断: その turn の pending を cancelled で閉じる。
pub(crate) fn cancel_for_turn(turn_id: &str) {
    let removed: Vec<(String, Record)> = match requests().lock() {
        Ok(mut map) => {
            let ids: Vec<String> = map
                .iter()
                .filter(|(_, r)| r.turn_id == turn_id)
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| map.remove(&id).map(|r| (id, r)))
                .collect()
        }
        Err(_) => Vec::new(),
    };
    for (id, r) in removed {
        if let Some(h) = &r.watchdog {
            h.abort();
        }
        emit_closed(&r.rt, turn_id, &id, REASON_CANCELLED);
        checkpoint::close(&r.rt.store_dir, turn_id, REASON_CANCELLED);
    }
}

/// 終了処理: 全部の pending を破棄する (チェックポイントは残り、次回起動の
/// 復旧で「再起動」として閉じる)。
pub fn abort_all() {
    let handles: Vec<JoinHandle<()>> = match requests().lock() {
        Ok(mut map) => map.drain().filter_map(|(_, r)| r.watchdog).collect(),
        Err(_) => Vec::new(),
    };
    for h in handles {
        h.abort();
    }
}
