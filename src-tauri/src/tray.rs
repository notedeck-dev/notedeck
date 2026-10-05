//! システムトレイのメニュー (#1174)。
//!
//! 文言とチェック状態の正本はフロント側 (表示言語 / settings.json5 / ai.json5 /
//! 常駐の状態) にあるので、フロントが `tray_sync` で押し込み、ここは項目の
//! ハンドルを持って反映するだけ。項目のクリックはイベントでフロントに渡し、
//! 切り替え自体はフロントの store が行う (オフライン / リアルタイムと同じ経路)。

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::{AppHandle, Emitter, Runtime};

/// フロントから届くメニューの表示状態
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuState {
    pub show_label: String,
    pub offline_label: String,
    pub offline: bool,
    pub realtime_label: String,
    pub realtime: bool,
    pub heartbeat_label: String,
    pub heartbeat: bool,
    pub resident_label: String,
    pub resident: bool,
    /// 常駐の切り替えが今できるか (HEARTBEAT 有効 + 別プロセスの notemaid + この OS で可能)
    pub resident_enabled: bool,
    pub quit_label: String,
}

/// 作った項目のハンドル。`app.manage` で持ち、`apply` で表示を更新する
pub struct TrayMenu<R: Runtime> {
    show: MenuItem<R>,
    offline: CheckMenuItem<R>,
    realtime: CheckMenuItem<R>,
    heartbeat: CheckMenuItem<R>,
    resident: CheckMenuItem<R>,
    quit: MenuItem<R>,
}

impl<R: Runtime> TrayMenu<R> {
    /// 初期文言は英語。フロントが起動後すぐ `tray_sync` で表示言語に差し替える
    pub fn build(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, Self)> {
        let show = MenuItem::with_id(app, "show", "Show NoteDeck", true, None::<&str>)?;
        let offline =
            CheckMenuItem::with_id(app, "offline", "Offline Mode", true, false, None::<&str>)?;
        let realtime =
            CheckMenuItem::with_id(app, "realtime", "Realtime Mode", true, true, None::<&str>)?;
        let heartbeat =
            CheckMenuItem::with_id(app, "heartbeat", "HEARTBEAT", true, false, None::<&str>)?;
        let resident = CheckMenuItem::with_id(
            app,
            "resident",
            "Keep AI running after the app exits",
            false,
            false,
            None::<&str>,
        )?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(
            app,
            &[&show, &offline, &realtime, &heartbeat, &resident, &quit],
        )?;
        Ok((
            menu,
            Self {
                show,
                offline,
                realtime,
                heartbeat,
                resident,
                quit,
            },
        ))
    }

    pub fn apply(&self, state: &TrayMenuState) -> tauri::Result<()> {
        self.show.set_text(&state.show_label)?;
        self.offline.set_text(&state.offline_label)?;
        self.offline.set_checked(state.offline)?;
        self.realtime.set_text(&state.realtime_label)?;
        self.realtime.set_checked(state.realtime)?;
        self.heartbeat.set_text(&state.heartbeat_label)?;
        self.heartbeat.set_checked(state.heartbeat)?;
        self.resident.set_text(&state.resident_label)?;
        self.resident.set_checked(state.resident)?;
        self.resident.set_enabled(state.resident_enabled)?;
        self.quit.set_text(&state.quit_label)?;
        Ok(())
    }

    /// メニュー項目のクリック。切り替えはフロントに任せる
    pub fn on_menu_event(app: &AppHandle<R>, id: &str) {
        match id {
            "show" => {
                if let Some(w) = tauri::Manager::get_webview_window(app, "main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "offline" => {
                let _ = app.emit("nd:toggle-offline-mode", ());
            }
            "realtime" => {
                let _ = app.emit("nd:toggle-realtime-mode", ());
            }
            "heartbeat" => {
                let _ = app.emit("nd:toggle-heartbeat", ());
            }
            "resident" => {
                let _ = app.emit("nd:toggle-ai-resident", ());
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        }
    }
}
