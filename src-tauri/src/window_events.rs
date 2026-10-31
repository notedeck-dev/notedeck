//! 窓のイベントの dispatcher (#1131 段 4)。`on_window_event` はここに 1 本だけ。
//!
//! - CloseRequested: `main` はトレイがあれば隠すだけ。子窓は「閉じた理由 = user」の印
//! - Destroyed: 名簿から外し、親 (か代表窓) に `ChildClosed`、デッキ窓が 0 なら残る子を
//!   destroy、見えていた通知カラムの口座を外す
//! - Focused: 見ている窓の更新
//! - Moved / Resized: ポップアウトの位置と大きさを記録し、debounce して親に `ChildGeometry`
//!
//! 名簿の計算は `window_registry.rs` (純 struct)、emit は `commands/window_role.rs`。
//! ここは Tauri のイベントを受けてそれらを呼ぶだけ。

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
#[cfg(not(mobile))]
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::Manager;
use tauri_specta::Event;

use crate::commands::{ChildGeometry, WindowGeometry, WindowRoleState};
use crate::window_registry::WindowKind;

/// ジオメトリの debounce。連続する Moved / Resized の最後だけ親に届ける
const GEOMETRY_DEBOUNCE: Duration = Duration::from_millis(500);

/// 子窓の起動フューズ。mount に失敗して不可視のまま残った窓を上限に数え続けない
const SHOW_FUSE_POLL: Duration = Duration::from_millis(500);
const SHOW_FUSE_POLLS: u32 = 20;

/// 窓ごとの最新のジオメトリと、debounce の世代
#[derive(Default)]
pub struct GeometryTracker {
    inner: Mutex<HashMap<String, (WindowGeometry, u64)>>,
}

impl GeometryTracker {
    fn record(&self, label: &str, g: WindowGeometry) -> u64 {
        let mut map = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let slot = map.entry(label.to_string()).or_insert((g.clone(), 0));
        slot.0 = g;
        slot.1 += 1;
        slot.1
    }

    fn current(&self, label: &str) -> Option<(WindowGeometry, u64)> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .get(label)
            .cloned()
    }

    fn take(&self, label: &str) -> Option<WindowGeometry> {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .remove(label)
            .map(|(g, _)| g)
    }
}

fn read_geometry(window: &tauri::Window) -> Option<WindowGeometry> {
    let pos = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let factor = window.scale_factor().ok()?;
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());
    // 生成オプション (x/y/width/height) は論理 px なので物理 px から戻す (#721)
    Some(WindowGeometry {
        x: (pos.x as f64 / factor).round() as i32,
        y: (pos.y as f64 / factor).round() as i32,
        width: (size.width as f64 / factor).round() as u32,
        height: (size.height as f64 / factor).round() as u32,
        monitor,
    })
}

/// `on_window_event` に渡すハンドラを組む
pub fn handler(
    has_tray: Arc<AtomicBool>,
) -> impl Fn(&tauri::Window, &tauri::WindowEvent) + Send + Sync + 'static {
    move |window, event| {
        let app = window.app_handle();
        let label = window.label();
        let Some(roles) = app.try_state::<WindowRoleState>() else {
            return;
        };
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                // トレイに隠すのは main だけ。以前はラベルを見ずに全窓を隠していたため、
                // ポップアウト / PiP の × が破棄にならず WebView が残っていた
                if label == "main" {
                    #[cfg(not(mobile))]
                    if has_tray.load(Ordering::Relaxed) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    #[cfg(mobile)]
                    let _ = (&has_tray, api);
                } else {
                    roles.on_close_requested(label);
                }
            }
            tauri::WindowEvent::Destroyed => {
                if let Some(scopes) = app.try_state::<crate::os_notify::VisibleNotificationScopes>()
                {
                    scopes.remove_window(label);
                }
                let geometry = app
                    .try_state::<GeometryTracker>()
                    .and_then(|t| t.take(label));
                let orphans = roles.on_destroyed(app, label, geometry);
                if !orphans.is_empty() {
                    // イベントハンドラの中から別の窓を destroy しない (Windows で deadlock)
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        for l in orphans {
                            tracing::info!(
                                label = l,
                                "[window-events] no deck window left, closing child"
                            );
                            if let Some(w) = app.get_webview_window(&l) {
                                let _ = w.destroy();
                            }
                        }
                    });
                }
            }
            tauri::WindowEvent::Focused(true) => roles.on_focused(app, label),
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                if roles.kind(label) != Some(WindowKind::Popout) {
                    return;
                }
                let Some(tracker) = app.try_state::<GeometryTracker>() else {
                    return;
                };
                let Some(g) = read_geometry(window) else {
                    return;
                };
                let gen = tracker.record(label, g);
                let app = app.clone();
                let label = label.to_string();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(GEOMETRY_DEBOUNCE).await;
                    let Some(tracker) = app.try_state::<GeometryTracker>() else {
                        return;
                    };
                    let Some((geometry, latest)) = tracker.current(&label) else {
                        return;
                    };
                    if latest != gen {
                        return;
                    }
                    let Some(roles) = app.try_state::<WindowRoleState>() else {
                        return;
                    };
                    let Some(to) = roles.delivery_target_for(&label) else {
                        return;
                    };
                    let ev = ChildGeometry {
                        to,
                        label,
                        geometry,
                    };
                    if let Err(e) = ev.emit(&app) {
                        tracing::warn!("[window-events] geometry emit failed: {e}");
                    }
                });
            }
            _ => {}
        }
    }
}

/// 子窓の起動フューズ。`visible: false` で作った窓が期限まで一度も可視にならなければ
/// show する (起動時の窓と同じ保険。mount の失敗で不可視の窓が上限を食い続けないため)
pub fn arm_show_fuse(app: &tauri::AppHandle, label: &str) {
    #[cfg(desktop)]
    {
        let app = app.clone();
        let label = label.to_string();
        std::thread::spawn(move || {
            for _ in 0..SHOW_FUSE_POLLS {
                std::thread::sleep(SHOW_FUSE_POLL);
                let Some(w) = app.get_webview_window(&label) else {
                    return;
                };
                if w.is_visible().unwrap_or(true) {
                    return;
                }
            }
            if let Some(w) = app.get_webview_window(&label) {
                tracing::warn!(
                    label,
                    "[window-events] child window never became visible; forcing show"
                );
                let _ = w.show();
            }
        });
    }
    #[cfg(not(desktop))]
    let _ = (app, label);
}
