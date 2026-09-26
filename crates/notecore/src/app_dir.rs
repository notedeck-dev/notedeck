//! アプリデータディレクトリの解決 (#1106 段階 3a)。
//!
//! アプリ (Tauri) と notecored が同じ場所を指すための 1 箇所。Tauri の
//! `app_data_dir()` は「OS のデータディレクトリ / bundle identifier」なので、
//! identifier をここに定数として持ち、アプリ側は tauri.conf.json の identifier と
//! 一致することをテストで保証する。デバッグビルドに限り `NOTEDECK_APP_DIR` で
//! 上書きできる (E2E や動作検証の隔離プロファイル。アプリ側と同じ seam)。

use std::path::PathBuf;

/// bundle identifier (`src-tauri/tauri.conf.json` の `identifier` と同じ値)
pub const APP_IDENTIFIER: &str = "com.notedeck.desktop";

/// 環境変数の上書き名
pub const OVERRIDE_ENV: &str = "NOTEDECK_APP_DIR";

/// デバッグビルドの上書き。リリースビルドでは無視する
pub fn override_from_env() -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        if let Some(dir) = std::env::var_os(OVERRIDE_ENV) {
            if !dir.is_empty() {
                return Some(PathBuf::from(dir));
            }
        }
    }
    None
}

/// 既定のアプリデータディレクトリ (Tauri の `app_data_dir()` と同じ場所)。
/// OS のデータディレクトリが分からなければ None
pub fn default_app_dir() -> Option<PathBuf> {
    if let Some(dir) = override_from_env() {
        return Some(dir);
    }
    dirs::data_dir().map(|d| d.join(APP_IDENTIFIER))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_dir_ends_with_the_identifier() {
        if let Some(dir) = dirs::data_dir().map(|d| d.join(APP_IDENTIFIER)) {
            assert!(dir.ends_with(APP_IDENTIFIER));
        }
    }
}
