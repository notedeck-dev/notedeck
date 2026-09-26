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
//! と同じ daemon モデル)。tick の本体 (skill 取得 / cheap check / AI 呼び出し /
//! 報告) は notecore の `heartbeat::run_once` (#1133 縦切り 5)。ここは timer と、
//! notecore の出来事を WebView へ流す口だけ。

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{async_runtime::JoinHandle, Manager, State};

use notecli::error::NoteDeckError;

use super::Result;

/// 上限/下限。`useAiConfig.ts` の HEARTBEAT_INTERVAL_*_MINUTES と揃える。
const MIN_INTERVAL_MINUTES: u32 = 1;
const MAX_INTERVAL_MINUTES: u32 = 24 * 60;

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
                run_tick(&app_for_task, "scheduled").await;
            }
        });

        *slot = Some(ScheduledTask {
            interval_minutes,
            handle,
        });
    }

    /// scheduler を止める。unconfigure と終了処理 (#1098) の両方から呼ばれる。
    pub(crate) fn unregister(&self) {
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

/// tick の本体は notecore。実行中なら notecore 側で捨てる
async fn run_tick(app: &tauri::AppHandle, source: &str) {
    let core = app.state::<notecore::context::Core>();
    notecore::heartbeat::run_once(&core, source).await;
}

fn clamp_interval(minutes: u32) -> Result<u32> {
    if !(MIN_INTERVAL_MINUTES..=MAX_INTERVAL_MINUTES).contains(&minutes) {
        return Err(NoteDeckError::InvalidInput(format!(
            "interval_minutes out of range ({MIN_INTERVAL_MINUTES}-{MAX_INTERVAL_MINUTES}): {minutes}"
        )));
    }
    Ok(minutes)
}

// HEARTBEAT の timer は手元側 (アプリの寿命に紐づく)。本体は notecore。
/// global heartbeat を登録 / 更新する。既存があれば interval を
/// 上書きする。同じ interval が既に動いていたとしても abort + 再 spawn
/// するので、JS 側の reactive watch から idempotent に呼んで OK。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn heartbeat_configure(
    app: tauri::AppHandle,
    scheduler: State<'_, Arc<HeartbeatScheduler>>,
    interval_minutes: u32,
) -> Result<()> {
    let interval = clamp_interval(interval_minutes)?;
    if crate::client_layer::relay().is_some() {
        // 常駐構成では notecored が timer を持つ (ai.json5 から組む)
        tracing::info!("[heartbeat] resident backend: timer is owned by notecored");
        return Ok(());
    }
    scheduler.replace(interval, app);
    Ok(())
}

/// global heartbeat を停止する。未登録なら no-op。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn heartbeat_unconfigure(scheduler: State<'_, Arc<HeartbeatScheduler>>) -> Result<()> {
    scheduler.unregister();
    Ok(())
}

/// 即座に 1 回だけ tick を emit する。デバッグ用 + AI カラムの
/// 「💓 今すぐ実行」ボタンから呼ばれる。scheduler の interval state は変更しない。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn heartbeat_trigger_now(app: tauri::AppHandle) -> Result<()> {
    crate::client_layer::ensure_embedded("heartbeat_trigger_now")?;
    tauri::async_runtime::spawn(async move {
        run_tick(&app, "manual").await;
    });
    Ok(())
}

/// 現在 scheduler に登録されているかどうかを返す (デバッグ / UI ヘルパ)。
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn heartbeat_status(
    scheduler: State<'_, Arc<HeartbeatScheduler>>,
) -> Result<Option<u32>> {
    Ok(scheduler.current_interval())
}
