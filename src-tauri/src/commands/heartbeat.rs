//! HEARTBEAT (#411) の timer (in-process 構成)。
//!
//! 役はプロセスが持つ (#1131): timer は窓ではなく Rust が組む。実体は notemaid の
//! `HeartbeatTimer` (常駐バイナリと同じもの。ai.json5 を自分で読み、刻み方は
//! `heartbeat_schedule`)。設定ファイルの変更通知で組み直し、オフラインモード中は
//! 止める (#461: 届かない AI 呼び出しが連続失敗として数えられ、自動停止に至るのを防ぐ)。
//! 常駐構成 (sidecar / サービス) では notemaid 自身が timer を持つので、ここは何もしない。
//!
//! 以前は端末 (useHeartbeatDaemon) が窓ごとに `heartbeat_configure` を送っていて、
//! デッキ画面を描く窓の数だけ timer が組み直されていた。
//! tick の本体 (skill 取得 / cheap check / AI 呼び出し / 報告) は notemaid の `heartbeat`。
//! Manual trigger は `heartbeat_trigger_now` (表の行)。

use std::sync::Arc;

use tauri::Manager;

pub use notemaid::heartbeat_timer::HeartbeatTimer;

/// managed state (Arc で health レポートと終了処理からも読む)
pub type HeartbeatTimerState = Arc<HeartbeatTimer>;

/// ai.json5 と settings.json5 の今の断面で timer を組み直す。起動時と、どちらかの
/// ファイルが変わったときに呼ぶ。tokio の runtime 上で呼ぶこと (timer は spawn する)
pub fn sync_heartbeat_timer(app: &tauri::AppHandle) {
    if crate::client_layer::relay().is_some() {
        // 常駐構成では notemaid が timer を持つ (ai.json5 から組む)
        return;
    }
    let Some(timer) = app.try_state::<HeartbeatTimerState>() else {
        return;
    };
    let Some(core) = app.try_state::<super::AppState>() else {
        return;
    };
    let core: super::AppState = core.inner().clone();
    if offline_enabled(&core) {
        timer.stop();
        tracing::info!("[heartbeat] offline mode: timer stopped");
        return;
    }
    timer.reconfigure(core);
}

fn offline_enabled(core: &notecore::context::Core) -> bool {
    let Ok(base) = notecore::commands::settings::settings_base_dir(core) else {
        return false;
    };
    let text = notecore::settings_store::read_settings_json(&base).unwrap_or_default();
    notecore::stream_mode::offline_enabled(&text)
}

/// 設定ファイルの変更が timer に関わるものか (ai.json5 と settings.json5 のどちらか)
pub fn affects_heartbeat_timer(change: &notecore::settings_events::SettingsChange) -> bool {
    change.subdir.is_none()
        && (change.name == notemaid::ai_config::FILE_NAME
            || change.name == notecore::stream_mode::SETTINGS_FILE)
}
