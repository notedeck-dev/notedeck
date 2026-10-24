//! 端末側 (OS 通知・トレイ・Android の通知チャネル) の表示言語 (#135)。
//!
//! 表示言語は端末ごとの値 (`locale.json5`、#1106 の手元側)。Android の通知
//! チャネルは WebView より先に作られ、WebView が止まっていても通知は出るので、
//! 起動時に Rust 自身がファイルと OS の言語から決める。以後はデバイス (TS) が
//! 切り替えたときに [`set_ui_language`] で知らせる。

use std::sync::RwLock;

use notecore::i18n;

static LANG: RwLock<Option<String>> = RwLock::new(None);

/// 今の表示言語。起動前 (init より前) は英語
pub fn current() -> String {
    LANG.read()
        .ok()
        .and_then(|g| g.clone())
        .unwrap_or_else(|| i18n::CANONICAL.to_string())
}

/// テストで表示言語を固定する (OS 通知の文面を ja で照合するため)
#[cfg(test)]
pub fn set_for_tests(lang: &str) {
    set(lang);
}

fn set(lang: &str) {
    if let Ok(mut g) = LANG.write() {
        *g = Some(lang.to_string());
    }
}

/// `locale.json5` の設定 (`auto` か言語コード)。無い / 読めないなら None
fn read_preference(app_dir: &std::path::Path) -> Option<String> {
    let dir = app_dir.join(crate::commands::SETTINGS_DIR);
    let text = notecore::settings_store::read_root_file(&dir, "locale.json5").ok()?;
    let value: serde_json::Value = json5::from_str(&text).ok()?;
    value.get("locale")?.as_str().map(str::to_string)
}

/// アプリデータディレクトリと OS の言語から表示言語を決める。i18n 導入前からの
/// インストール (ファイルが無い) はデバイスが初回に日本語を書くので、ここでも OS の
/// 言語より日本語を優先する
fn init_from_dir(app_dir: &std::path::Path) {
    let preference = read_preference(app_dir).unwrap_or_else(|| "ja-JP".to_string());
    let system: Vec<String> = tauri_plugin_os::locale().into_iter().collect();
    set(&i18n::resolve_language(&preference, &system));
}

/// 起動時に表示言語を決める
pub fn init(app: &tauri::AppHandle) {
    if let Ok(dir) = crate::app_dir::resolve_app_dir(app) {
        init_from_dir(&dir);
    }
    // Android の通知チャネル名を決めた言語で揃える。Kotlin の入口 (NotificationBridge
    // .register) が先か後かに依存しない: 入口が未登録なら何もせず、登録時に作られる
    crate::streaming::refresh_notification_channel(app);
}

/// Activity の無い経路 (Android の通知ワーカー、#330 段階 C) 用。アプリが生きていて
/// 表示言語を決めていればそのまま、ワーカーだけのプロセスならファイルと OS から決める
#[cfg(target_os = "android")]
pub fn init_if_unset(app_dir: &std::path::Path) {
    let unset = LANG.read().map(|g| g.is_none()).unwrap_or(true);
    if unset {
        init_from_dir(app_dir);
    }
}

/// 表示言語で文を組む
pub fn t(key: &str, params: serde_json::Value) -> String {
    i18n::render(&current(), key, &params)
}

/// デバイスが表示言語を切り替えた (解決済みの言語コード)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn set_ui_language(app: tauri::AppHandle, lang: String) {
    set(&lang);
    crate::streaming::refresh_notification_channel(&app);
}
