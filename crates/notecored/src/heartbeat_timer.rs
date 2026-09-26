//! HEARTBEAT の timer (Tauri の HeartbeatScheduler に相当)。設定は ai.json5 から読み、
//! 変更通知で組み直す。tick ごとに notecore の run_once を呼ぶ。

use std::sync::{Arc, Mutex};
use std::time::Duration;

use notecore::context::Core;
use tokio::task::JoinHandle;

#[derive(Default)]
pub struct HeartbeatTimer {
    inner: Mutex<Option<(u32, JoinHandle<()>)>>,
}

impl HeartbeatTimer {
    /// ai.json5 の断面から組み直す (enabled でなければ止める)
    pub fn reconfigure(&self, core: Arc<Core>) {
        let cfg = notecore::ai_config::load(&core).ok();
        let (enabled, interval) = cfg
            .map(|c| (c.heartbeat.enabled, c.heartbeat.interval_minutes))
            .unwrap_or((false, 0));
        let mut slot = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if !enabled {
            if let Some((_, h)) = slot.take() {
                h.abort();
                tracing::info!("[heartbeat] timer stopped");
            }
            return;
        }
        if slot.as_ref().map(|(m, _)| *m) == Some(interval) {
            return;
        }
        if let Some((_, h)) = slot.take() {
            h.abort();
        }
        let handle = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(u64::from(interval) * 60));
            ticker.tick().await;
            loop {
                ticker.tick().await;
                notecore::heartbeat::run_once(&core, "scheduled").await;
            }
        });
        tracing::info!(interval_minutes = interval, "[heartbeat] timer configured");
        *slot = Some((interval, handle));
    }

    pub fn stop(&self) {
        if let Some((_, h)) = self.inner.lock().unwrap_or_else(|e| e.into_inner()).take() {
            h.abort();
        }
    }

    pub fn interval_minutes(&self) -> Option<u32> {
        self.inner
            .lock()
            .ok()
            .and_then(|s| s.as_ref().map(|(m, _)| *m))
    }
}
