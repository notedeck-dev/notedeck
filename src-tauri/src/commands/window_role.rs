//! 窓の名簿と役 (代表窓 / 見ている窓) の口 (#1131)。本体は `window_registry.rs`。
//!
//! デッキ画面を描く窓は起動時に `deck_window_announce` で名乗り、現在の役を受け取る。
//! 役が変わったら Rust が `WindowRolesChanged` を全窓へ流す。種別は JS の自称ではなく
//! 窓の label と URL から Rust が決める。

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{Manager, State};
use tauri_specta::Event;

use super::Result;
use crate::window_registry::{kind_from_url, Roles, WindowKind, WindowRegistry};

/// 名簿の managed state
#[derive(Default)]
pub struct WindowRoleState(pub Mutex<WindowRegistry>);

impl WindowRoleState {
    fn with<R>(&self, f: impl FnOnce(&mut WindowRegistry) -> R) -> R {
        let mut guard = self.0.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut guard)
    }

    pub fn roles(&self) -> Roles {
        self.with(|r| r.roles())
    }

    // #1131 の後続 (宛先付きイベント / 親子と上限) で使う。使った段で外す
    #[allow(dead_code)]
    pub fn representative(&self) -> Option<String> {
        self.with(|r| r.representative())
    }

    // #1131 の後続 (宛先付きイベント / 親子と上限) で使う。使った段で外す
    #[allow(dead_code)]
    pub fn viewing(&self) -> Option<String> {
        self.with(|r| r.viewing())
    }

    // #1131 の後続 (宛先付きイベント / 親子と上限) で使う。使った段で外す
    #[allow(dead_code)]
    pub fn front_target(&self, is_visible: impl Fn(&str) -> bool) -> Option<String> {
        self.with(|r| r.front_target(is_visible))
    }

    pub fn kind(&self, label: &str) -> Option<WindowKind> {
        self.with(|r| r.kind(label))
    }

    /// 窓が名乗った。役が変わっていれば全窓へ知らせる
    pub fn announce(&self, app: &tauri::AppHandle, label: &str, kind: WindowKind) -> Roles {
        let (roles, changed) = self.with(|r| r.announce(label, kind));
        if let Some(changed) = changed {
            emit_changed(app, changed);
        }
        roles
    }

    pub fn on_focused(&self, app: &tauri::AppHandle, label: &str) {
        if let Some(changed) = self.with(|r| r.focused(label)) {
            emit_changed(app, changed);
        }
    }

    pub fn on_destroyed(&self, app: &tauri::AppHandle, label: &str) {
        if let Some(changed) = self.with(|r| r.remove(label)) {
            emit_changed(app, changed);
        }
    }
}

fn emit_changed(app: &tauri::AppHandle, roles: Roles) {
    if let Err(e) = WindowRolesChanged::from(roles).emit(app) {
        tracing::warn!("[window-roles] emit failed: {e}");
    }
}

/// 役が変わった。全窓へ流す (宛先付きではない)。受けた窓は自分の label と比べる
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct WindowRolesChanged {
    pub representative: Option<String>,
    pub viewing: Option<String>,
}

impl From<Roles> for WindowRolesChanged {
    fn from(r: Roles) -> Self {
        Self {
            representative: r.representative,
            viewing: r.viewing,
        }
    }
}

/// 名乗りの返事。自分の label と、現在の役
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowRolesView {
    pub label: String,
    pub kind: WindowKind,
    pub representative: Option<String>,
    pub viewing: Option<String>,
}

/// 窓が名乗る。同じ窓からの再呼び出しは冪等 (リロードしても順位は変わらない)。
/// 種別は URL から Rust が決める
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn deck_window_announce(
    webview: tauri::WebviewWindow,
    state: State<'_, WindowRoleState>,
) -> Result<WindowRolesView> {
    let label = webview.label().to_string();
    let kind = match webview.url() {
        Ok(url) => kind_from_url(&label, url.path(), url.query()),
        Err(e) => {
            tracing::warn!(
                label,
                "[window-roles] url unavailable, treating as mirror: {e}"
            );
            kind_from_url(&label, "/", None)
        }
    };
    let roles = state.announce(webview.app_handle(), &label, kind);
    Ok(WindowRolesView {
        label,
        kind,
        representative: roles.representative,
        viewing: roles.viewing,
    })
}

/// 現在の役を問う (名乗らない)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn window_roles_current(
    window: tauri::Window,
    state: State<'_, WindowRoleState>,
) -> Result<WindowRolesView> {
    let label = window.label().to_string();
    let kind = state.kind(&label).unwrap_or(WindowKind::Mirror);
    let roles = state.roles();
    Ok(WindowRolesView {
        label,
        kind,
        representative: roles.representative,
        viewing: roles.viewing,
    })
}
