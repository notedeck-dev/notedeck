//! HEARTBEAT (#411) — AI が定期的に自律起動するための global scheduler。
//!
//! Tauri アプリ起動中、グローバルに 1 つだけ走る tokio::time::interval task を
//! spawn し、tick が来るたびにフロントへ `nd:ai-heartbeat-tick` event を emit する。
//!
//! - JS 側 (App-level) で `heartbeat_configure(interval_minutes)` を呼ぶ
//! - 設定が変わったら `heartbeat_configure` を再呼び出し (= replace)
//! - 無効化は `heartbeat_unconfigure()`
//! - Manual trigger は `heartbeat_trigger_now()`
//!
//! AI カラムの有無 / 何個開いているかには依存しない (= OpenClaw HEARTBEAT
//! と同じ daemon モデル)。実際のチェック内容 (skill 取得 / AI 呼び出し /
//! 結果表示) は **すべてフロント側** (`useHeartbeatDaemon`) で行う。
//! Rust はただの time-keeper。

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{async_runtime::JoinHandle, Emitter, State};

use notecli::error::NoteDeckError;

use super::Result;

/// フロント (`useHeartbeatDaemon`) が listen する event 名。
pub const HEARTBEAT_EVENT_NAME: &str = "nd:ai-heartbeat-tick";

/// 上限/下限。`useAiConfig.ts` の HEARTBEAT_INTERVAL_*_MINUTES と揃える。
const MIN_INTERVAL_MINUTES: u32 = 1;
const MAX_INTERVAL_MINUTES: u32 = 24 * 60;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct HeartbeatTickPayload {
    /// Unix epoch ms。フロントの logging やデバッグ用。
    pub triggered_at_ms: i64,
    /// "scheduled" (interval 経由) or "manual" (trigger_now 経由)。
    pub source: String,
}

struct ScheduledTask {
    interval_minutes: u32,
    handle: JoinHandle<()>,
}

#[derive(Default)]
pub struct HeartbeatScheduler {
    inner: Mutex<Option<ScheduledTask>>,
}

impl HeartbeatScheduler {
    pub fn new() -> Self {
        Self::default()
    }

    /// 既に登録済みでも (interval 変更時に) replace できるよう、いったん
    /// abort してから新規 spawn する。
    fn replace(&self, interval_minutes: u32, app: tauri::AppHandle) {
        let mut slot = match self.inner.lock() {
            Ok(g) => g,
            Err(e) => {
                tracing::error!("[heartbeat] scheduler mutex poisoned: {e}");
                return;
            }
        };

        if let Some(prev) = slot.take() {
            prev.handle.abort();
        }

        let app_for_task = app.clone();
        let handle = tauri::async_runtime::spawn(async move {
            let dur = Duration::from_secs(u64::from(interval_minutes) * 60);
            let mut ticker = tokio::time::interval(dur);
            // 初回 tick は drop (起動直後の意図しない発火を避ける)
            ticker.tick().await;
            loop {
                ticker.tick().await;
                emit_tick(&app_for_task, "scheduled");
            }
        });

        *slot = Some(ScheduledTask {
            interval_minutes,
            handle,
        });
    }

    fn unregister(&self) {
        let mut slot = match self.inner.lock() {
            Ok(g) => g,
            Err(e) => {
                tracing::error!("[heartbeat] scheduler mutex poisoned: {e}");
                return;
            }
        };
        if let Some(prev) = slot.take() {
            prev.handle.abort();
        }
    }

    pub(crate) fn current_interval(&self) -> Option<u32> {
        self.inner
            .lock()
            .ok()
            .and_then(|slot| slot.as_ref().map(|t| t.interval_minutes))
    }
}

fn current_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn emit_tick(app: &tauri::AppHandle, source: &str) {
    let payload = HeartbeatTickPayload {
        triggered_at_ms: current_unix_ms(),
        source: source.to_string(),
    };
    if let Err(e) = app.emit(HEARTBEAT_EVENT_NAME, payload) {
        tracing::error!("[heartbeat] failed to emit tick: {e}");
    }
}

fn clamp_interval(minutes: u32) -> Result<u32> {
    if !(MIN_INTERVAL_MINUTES..=MAX_INTERVAL_MINUTES).contains(&minutes) {
        return Err(NoteDeckError::InvalidInput(format!(
            "interval_minutes out of range ({MIN_INTERVAL_MINUTES}〜{MAX_INTERVAL_MINUTES}): {minutes}"
        )));
    }
    Ok(minutes)
}

/// global heartbeat を登録 / 更新する。既存があれば interval を
/// 上書きする。同じ interval が既に動いていたとしても abort + 再 spawn
/// するので、JS 側の reactive watch から idempotent に呼んで OK。
#[tauri::command]
#[specta::specta]
pub async fn heartbeat_configure(
    app: tauri::AppHandle,
    scheduler: State<'_, Arc<HeartbeatScheduler>>,
    interval_minutes: u32,
) -> Result<()> {
    let interval = clamp_interval(interval_minutes)?;
    scheduler.replace(interval, app);
    Ok(())
}

/// global heartbeat を停止する。未登録なら no-op。
#[tauri::command]
#[specta::specta]
pub async fn heartbeat_unconfigure(
    scheduler: State<'_, Arc<HeartbeatScheduler>>,
) -> Result<()> {
    scheduler.unregister();
    Ok(())
}

/// 即座に 1 回だけ tick を emit する。デバッグ用 + AI カラムの
/// 「💓 今すぐ実行」ボタンから呼ばれる。scheduler の interval state は変更しない。
#[tauri::command]
#[specta::specta]
pub async fn heartbeat_trigger_now(app: tauri::AppHandle) -> Result<()> {
    emit_tick(&app, "manual");
    Ok(())
}

/// 現在 scheduler に登録されているかどうかを返す (デバッグ / UI ヘルパ)。
#[tauri::command]
#[specta::specta]
pub async fn heartbeat_status(
    scheduler: State<'_, Arc<HeartbeatScheduler>>,
) -> Result<Option<u32>> {
    Ok(scheduler.current_interval())
}
