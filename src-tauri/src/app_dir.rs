//! アプリデータディレクトリの解決 (#702)。
//!
//! 通常は Tauri の `app_data_dir()`。デバッグビルドに限り環境変数
//! `NOTEDECK_APP_DIR` で上書きできる — E2E テストや動作検証が隔離
//! プロファイルでアプリを起動するための seam (リリースビルドでは無視)。
//!
//! `notecli.db` / `api-token` / `api-tokens.json` / `notedeck/` (settings)
//! など app_data_dir 基点の全ファイルがまとめて隔離される。

use std::path::PathBuf;

use tauri::Manager;

pub fn resolve_app_dir<M: Manager<tauri::Wry>>(app: &M) -> tauri::Result<PathBuf> {
    // 上書きの seam は notecore と共有する (notecored も同じ環境変数を見る、#1106 段階 3a)。
    // 通常経路は Tauri の app_data_dir() = OS のデータディレクトリ / identifier で、
    // identifier が notecore の定数と一致することは tests/app_dir_identifier.rs が保証する
    if let Some(dir) = notecore::app_dir::override_from_env() {
        return Ok(dir);
    }
    app.path().app_data_dir()
}
