//! アプリの更新確認 (#1131)。
//!
//! 役はプロセスが持つ: 確認・ダウンロード・インストールは Rust が 1 回だけ行い、
//! 状態 (`UpdateState`) を全窓へ流す。窓はその写しを描くだけ (ナビバーのドット /
//! About の操作)。以前は窓ごとに `check()` を呼び、`Update` も確認した窓にしか無く、
//! 後から開いた窓にはドットが出なかった。
//!
//! 起動後に少し待って 1 回確認する。オフラインモード中は確認しない (#461)。
//! モバイルと `desktop` feature 無しのビルドでは何もしない。
//!
//! updater プラグインはデスクトップでしか登録しない (`lib.rs`、`cfg(not(mobile))`)。Android の
//! ビルドも Cargo の default feature `desktop` は付くので、feature だけで分けると
//! `app.updater()` が未登録の state を引いて panic する (v1.99.0 の Android smoke test)。
//! 分岐は `all(desktop, feature = "desktop")` で見る

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;
use tauri_specta::Event;

use super::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub enum UpdatePhase {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available,
    Installing,
    /// 差し替えが済み、再起動を待っている (Windows は installer が起動してここに来ない)
    Ready,
    Failed,
}

/// 更新の状態。変わるたびに全窓へ流す
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub phase: UpdatePhase,
    /// 見つかった新しい版
    pub version: Option<String>,
    /// ダウンロードの進捗 (0-100)。全長が分からないときは None
    pub progress: Option<u8>,
    /// 失敗の内容 (表示の文言は端末が i18n で組む)
    pub error: Option<String>,
}

// モバイルでは updater が無いので、確認・ダウンロードの口は読まれない
#[cfg_attr(not(desktop), allow(dead_code))]
pub struct UpdaterState {
    state: Mutex<UpdateState>,
    /// 一度確認したか (強制でなければ 2 回目は確認しない)
    checked: std::sync::atomic::AtomicBool,
    #[cfg(all(desktop, feature = "desktop"))]
    pending: Mutex<Option<tauri_plugin_updater::Update>>,
}

impl Default for UpdaterState {
    fn default() -> Self {
        Self {
            state: Mutex::new(UpdateState::default()),
            checked: std::sync::atomic::AtomicBool::new(false),
            #[cfg(all(desktop, feature = "desktop"))]
            pending: Mutex::new(None),
        }
    }
}

#[cfg_attr(not(desktop), allow(dead_code))]
impl UpdaterState {
    pub fn snapshot(&self) -> UpdateState {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    fn set(&self, app: &tauri::AppHandle, f: impl FnOnce(&mut UpdateState)) {
        let next = {
            let mut guard = self.state.lock().unwrap_or_else(|p| p.into_inner());
            f(&mut guard);
            guard.clone()
        };
        if let Err(e) = next.emit(app) {
            tracing::warn!("[updater] emit failed: {e}");
        }
    }
}

#[cfg_attr(not(desktop), allow(dead_code))]
fn offline_enabled(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    let Some(core) = app.try_state::<super::AppState>() else {
        return false;
    };
    let Ok(base) = notecore::commands::settings::settings_base_dir(&core) else {
        return false;
    };
    let text = notecore::settings_store::read_settings_json(&base).unwrap_or_default();
    notecore::stream_mode::offline_enabled(&text)
}

/// 更新を確認する。`force` でなければプロセスで 1 回だけ。オフライン中は確認せず
/// (次の機会に回す)、今の状態を返す
pub async fn check(app: &tauri::AppHandle, force: bool) -> UpdateState {
    use tauri::Manager;
    let state = app.state::<UpdaterState>();
    #[cfg(all(desktop, feature = "desktop"))]
    {
        use std::sync::atomic::Ordering;
        if offline_enabled(app) {
            return state.snapshot();
        }
        if !force && state.checked.swap(true, Ordering::SeqCst) {
            return state.snapshot();
        }
        state.checked.store(true, Ordering::SeqCst);
        state.set(app, |s| {
            s.phase = UpdatePhase::Checking;
            s.error = None;
        });
        use tauri_plugin_updater::UpdaterExt;
        let result = match app.updater() {
            Ok(updater) => updater.check().await,
            Err(e) => Err(e),
        };
        match result {
            Ok(Some(update)) => {
                let version = update.version.clone();
                *state.pending.lock().unwrap_or_else(|p| p.into_inner()) = Some(update);
                state.set(app, |s| {
                    s.phase = UpdatePhase::Available;
                    s.version = Some(version);
                });
            }
            Ok(None) => state.set(app, |s| s.phase = UpdatePhase::UpToDate),
            Err(e) => {
                tracing::warn!("[updater] check failed: {e}");
                state.set(app, |s| {
                    s.phase = UpdatePhase::Failed;
                    s.error = Some(e.to_string());
                });
            }
        }
    }
    #[cfg(not(all(desktop, feature = "desktop")))]
    {
        let _ = (force, offline_enabled(app));
    }
    state.snapshot()
}

/// 見つかっている更新をダウンロードして差し替える。進捗は状態で流す
pub async fn install(app: &tauri::AppHandle) -> Result<()> {
    use tauri::Manager;
    let state = app.state::<UpdaterState>();
    #[cfg(all(desktop, feature = "desktop"))]
    {
        let Some(update) = state
            .pending
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
        else {
            return Err(notecli::error::NoteDeckError::InvalidInput(
                "no update is pending".into(),
            ));
        };
        if state.snapshot().phase == UpdatePhase::Installing {
            return Ok(());
        }
        state.set(app, |s| {
            s.phase = UpdatePhase::Installing;
            s.progress = None;
            s.error = None;
        });
        let mut received: u64 = 0;
        let mut last_percent: Option<u8> = None;
        let app_for_progress = app.clone();
        let state_for_progress = app.state::<UpdaterState>();
        let outcome = update
            .download_and_install(
                |chunk, total| {
                    received += chunk as u64;
                    let Some(total) = total.filter(|t| *t > 0) else {
                        return;
                    };
                    let percent = ((received.saturating_mul(100)) / total).min(100) as u8;
                    if last_percent != Some(percent) {
                        last_percent = Some(percent);
                        state_for_progress.set(&app_for_progress, |s| s.progress = Some(percent));
                    }
                },
                || {},
            )
            .await;
        match outcome {
            Ok(()) => state.set(app, |s| {
                s.phase = UpdatePhase::Ready;
                s.progress = Some(100);
            }),
            Err(e) => {
                tracing::error!("[updater] install failed: {e}");
                state.set(app, |s| {
                    s.phase = UpdatePhase::Failed;
                    s.progress = None;
                    s.error = Some(e.to_string());
                });
            }
        }
        Ok(())
    }
    #[cfg(not(all(desktop, feature = "desktop")))]
    {
        let _ = state;
        Err(notecli::error::NoteDeckError::InvalidInput(
            "updater is not available on this platform".into(),
        ))
    }
}

/// 今の状態 (後から開いた窓が最初に読む)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn update_state_get(state: State<'_, UpdaterState>) -> Result<UpdateState> {
    Ok(state.snapshot())
}

/// 更新を確認する (About の「確認」は force)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn update_check(app: tauri::AppHandle, force: bool) -> Result<UpdateState> {
    Ok(check(&app, force).await)
}

/// 見つかっている更新をダウンロードして差し替える
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn update_install(app: tauri::AppHandle) -> Result<()> {
    install(&app).await
}

/// 差し替え後の再起動 (利用者がボタンを押したとき)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn update_restart(app: tauri::AppHandle) -> Result<()> {
    app.restart()
}
