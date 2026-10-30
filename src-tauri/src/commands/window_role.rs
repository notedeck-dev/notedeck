//! 窓の名簿と役 (代表窓 / 見ている窓) の口 (#1131)。本体は `window_registry.rs`。
//!
//! デッキ画面を描く窓は起動時に `deck_window_announce` で名乗り、現在の役を受け取る。
//! 役が変わったら Rust が `WindowRolesChanged` を全窓へ流す。種別は JS の自称ではなく
//! 窓の label と URL から Rust が決める。
//!
//! 「1 窓だけが処理する」イベント (deep link / 通知クリック / トレイの切替 / 外部からの
//! 問い合わせ) は宛先の label を `to` に持たせて全窓へ流し、受けた窓が自分宛てでなければ
//! 捨てる (`src/utils/addressedEvents.ts`)。デッキ窓がまだ 1 つも名乗っていないとき
//! (冷えた起動) の遷移は箱に預け、最初の名乗りで流す。

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{Manager, State};
use tauri_specta::Event;

use super::Result;
use crate::os_notify::NotificationClicked;
use crate::pending_inbox::PendingInbox;
use crate::window_registry::{kind_from_url, Roles, WindowKind, WindowRegistry};

/// 冷えた起動のあいだに預かる遷移。遷移系だけ (トレイの切替や問い合わせは預けない)
#[derive(Debug, Clone)]
pub enum PendingNavigation {
    DeepLink(String),
    NotificationClick(NotificationClicked),
}

const INBOX_CAP: usize = 8;
const INBOX_TTL: Duration = Duration::from_secs(120);

/// 名簿と預かり箱の managed state
pub struct WindowRoleState {
    registry: Mutex<WindowRegistry>,
    inbox: Mutex<PendingInbox<PendingNavigation>>,
}

impl Default for WindowRoleState {
    fn default() -> Self {
        Self {
            registry: Mutex::new(WindowRegistry::default()),
            inbox: Mutex::new(PendingInbox::new(INBOX_CAP, INBOX_TTL)),
        }
    }
}

impl WindowRoleState {
    fn with<R>(&self, f: impl FnOnce(&mut WindowRegistry) -> R) -> R {
        let mut guard = self.registry.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut guard)
    }

    pub fn roles(&self) -> Roles {
        self.with(|r| r.roles())
    }

    pub fn representative(&self) -> Option<String> {
        self.with(|r| r.representative())
    }

    pub fn viewing(&self) -> Option<String> {
        self.with(|r| r.viewing())
    }

    pub fn kind(&self, label: &str) -> Option<WindowKind> {
        self.with(|r| r.kind(label))
    }

    pub fn query_target(&self, query_type: &str) -> Option<String> {
        self.with(|r| r.query_target(query_type))
    }

    /// 窓が名乗った。役が変わっていれば全窓へ知らせ、デッキ窓なら預かっていた遷移を流す
    pub fn announce<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        label: &str,
        kind: WindowKind,
    ) -> Roles {
        let (roles, changed) = self.with(|r| r.announce(label, kind));
        if let Some(changed) = changed {
            emit_changed(app, changed);
        }
        if kind.is_deck() {
            self.flush_inbox(app, label);
        }
        roles
    }

    pub fn on_focused<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, label: &str) {
        if let Some(changed) = self.with(|r| r.focused(label)) {
            emit_changed(app, changed);
        }
    }

    pub fn on_destroyed<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, label: &str) {
        if let Some(changed) = self.with(|r| r.remove(label)) {
            emit_changed(app, changed);
        }
    }

    /// 利用者が見ている窓を前に出す。見ている窓が隠れていれば可視のデッキ窓、
    /// どれも無ければ代表窓を show する
    pub fn bring_to_front<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>) {
        let target = self.with(|r| {
            r.front_target(|label| {
                app.get_webview_window(label)
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false)
            })
        });
        let Some(label) = target else {
            return;
        };
        // show / unminimize / set_focus はデスクトップの WebviewWindow にしか無い
        // (モバイルは窓が 1 つで、OS が前面化する)
        #[cfg(desktop)]
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
        #[cfg(not(desktop))]
        let _ = label;
    }

    /// deep link を見ている窓へ。デッキ窓が無ければ預ける
    pub fn deliver_deep_link<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, url: String) {
        match self.viewing() {
            Some(to) => emit_event(app, AddressedDeepLink { to, url }),
            None => self.stash(PendingNavigation::DeepLink(url)),
        }
    }

    /// 通知クリックを見ている窓へ。デッキ窓が無ければ預ける
    pub fn deliver_notification_click<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        click: NotificationClicked,
    ) {
        match self.viewing() {
            Some(to) => emit_event(app, NotificationClickAddressed { to, click }),
            None => self.stash(PendingNavigation::NotificationClick(click)),
        }
    }

    /// トレイの切替を代表窓へ。代表が無ければ捨てる (切替は溜めない)
    pub fn deliver_tray_toggle<R: tauri::Runtime>(
        &self,
        app: &tauri::AppHandle<R>,
        which: TrayToggleKind,
    ) {
        if let Some(to) = self.representative() {
            emit_event(app, TrayToggle { to, which });
        } else {
            tracing::info!(?which, "[tray] no deck window, toggle dropped");
        }
    }

    fn stash(&self, item: PendingNavigation) {
        tracing::info!("[window-roles] no deck window yet, holding navigation");
        self.inbox
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .push(item);
    }

    fn flush_inbox<R: tauri::Runtime>(&self, app: &tauri::AppHandle<R>, to: &str) {
        let items = self
            .inbox
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .drain_fresh();
        for item in items {
            match item {
                PendingNavigation::DeepLink(url) => emit_event(
                    app,
                    AddressedDeepLink {
                        to: to.to_string(),
                        url,
                    },
                ),
                PendingNavigation::NotificationClick(click) => emit_event(
                    app,
                    NotificationClickAddressed {
                        to: to.to_string(),
                        click,
                    },
                ),
            }
        }
    }
}

fn emit_changed<R: tauri::Runtime>(app: &tauri::AppHandle<R>, roles: Roles) {
    emit_event(app, WindowRolesChanged::from(roles));
}

fn emit_event<R: tauri::Runtime, E: Event + Serialize + Clone + std::fmt::Debug>(
    app: &tauri::AppHandle<R>,
    event: E,
) {
    if let Err(e) = event.emit(app) {
        tracing::warn!("[window-roles] emit failed: {e} ({event:?})");
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

/// `notedeck://` の deep link。宛先は見ている窓
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct AddressedDeepLink {
    pub to: String,
    pub url: String,
}

/// OS 通知のクリック。宛先は見ている窓
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct NotificationClickAddressed {
    pub to: String,
    pub click: NotificationClicked,
}

/// トレイのメニューで切り替えるもの
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TrayToggleKind {
    Offline,
    Realtime,
    Heartbeat,
    AiResident,
}

/// トレイの切替。宛先は代表窓 (切替の実行はプロセスに 1 回)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct TrayToggle {
    pub to: String,
    pub which: TrayToggleKind,
}

/// HTTP API / notemaid からの WebView への問い合わせ。宛先は問いの名前で決まる
/// (窓ごとに値が違う問いと確認を出し得る問いは見ている窓、他は代表窓)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub to: String,
    pub id: String,
    pub query_type: String,
    pub params: serde_json::Value,
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
