//! 「コア」の状態面と常駐トグル (#1106 案 B)。OS 統合 (ログイン時のタスク登録 / 子プロセス) なので
//! 手元側のコマンド。モバイルでは常駐の仕組みが無いので「使えない」を返す。

#[cfg(desktop)]
use tauri::Manager;

#[cfg(desktop)]
pub use crate::maid_launcher::ResidentStatus;

#[cfg(not(desktop))]
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResidentStatus {
    pub available: bool,
    pub reason: Option<String>,
    pub sidecar: Option<String>,
    pub installed: bool,
    pub active: bool,
    pub detail: Option<String>,
}

// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn core_resident_status() -> ResidentStatus {
    #[cfg(desktop)]
    {
        tokio::task::spawn_blocking(crate::maid_launcher::resident_status)
            .await
            .unwrap_or_default()
    }
    #[cfg(not(desktop))]
    {
        ResidentStatus {
            available: false,
            reason: Some("resident notemaid is not available on this platform".into()),
            ..Default::default()
        }
    }
}

/// 「アプリを閉じても AI を動かす」を切り替え、新しい中継の状態を返す
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn core_set_resident(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<crate::client_layer::ClientLayerState, String> {
    #[cfg(desktop)]
    {
        let state = app.state::<crate::commands::AppState>();
        let app_dir = state.app_dir().map_err(|e| e.to_string())?;
        crate::maid_launcher::set_resident(app_dir, enabled).await?;
        Ok(crate::client_layer::state())
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, enabled);
        Err("resident notemaid is not available on this platform".into())
    }
}

/// 口座が変わったとき、別プロセスの notemaid に一覧を写し直す。このプロセスでも
/// トークンを秘匿化の既知の値に覚える (in-process で AI を回す経路、#1164)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn core_sync_accounts(
    app_state: tauri::State<'_, super::AppState>,
) -> Result<(), String> {
    if let Ok(list) = app_state.blocking(|db| db.load_accounts()).await {
        notemaid::redact::register_misskey_tokens(&list);
    }
    if let Some(relay) = crate::client_layer::relay() {
        relay.resync();
    }
    Ok(())
}
