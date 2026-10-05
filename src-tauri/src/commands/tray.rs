//! システムトレイのメニュー表示をフロントから押し込む (#1174)。OS 統合なので手元側。

#[cfg(desktop)]
pub use crate::tray::TrayMenuState;

#[cfg(not(desktop))]
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
    pub resident_enabled: bool,
    pub quit_label: String,
}

/// トレイメニューの文言とチェック状態を反映する。トレイが無い環境では何もしない
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn tray_sync(app: tauri::AppHandle, state: TrayMenuState) -> Result<(), String> {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        if let Some(menu) = app.try_state::<crate::tray::TrayMenu<tauri::Wry>>() {
            menu.apply(&state).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, state);
        Ok(())
    }
}
