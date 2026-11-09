//! アプリデータディレクトリの解決 (#1106 段階 3a)。
//!
//! アプリ (Tauri) と notemaid が同じ場所を指すための 1 箇所。Tauri の
//! `app_data_dir()` は「OS のデータディレクトリ / bundle identifier」なので、
//! identifier をここに定数として持ち、アプリ側は tauri.conf.json の identifier と
//! 一致することをテストで保証する。デバッグビルドに限り `NOTEDECK_APP_DIR` で
//! 上書きできる (E2E や動作検証の隔離プロファイル。アプリ側と同じ seam)。

use std::path::{Path, PathBuf};

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

/// 設定ディレクトリの名前 (app_data_dir 直下)。ここ以外で参照しない (#1333 §1、lint
/// `tests/lint/rustSettingsDir.test.ts`)。
const SETTINGS_DIR: &str = "notedeck";
/// この機械の状態 (窓の位置・同意・確認の結果) の置き場。#1333 で新設
const STATE_DIR: &str = "state";

/// アプリデータディレクトリの中の配置 (#1333 §1)。
///
/// 「どこに何があるか」を知る唯一の場所。他のコードは `Layout` の値を受け取るか
/// `Core::layout()` から取り、`app_dir.join("notedeck")` のような導出を自分では
/// しない。領域は #1334 の再編と同じ 4 つ:
///
/// - `config`: 持ち出す単位 (設定)。公開前提ではない
/// - `data`: 人の記録 (メモ / AI セッション / 人格と記憶)
/// - `state`: この機械の状態。同期しない
/// - `cache`: 消してよい
///
/// 今は config と data が同じ `notedeck/` を指し、cache は root 直下 (再編前の配置)。
/// 再編 (#1334) では `from_root` が版印を見て新しい配置を返すようになる。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    root: PathBuf,
    config: PathBuf,
    data: PathBuf,
    state: PathBuf,
    cache: PathBuf,
}

impl Layout {
    /// アプリデータディレクトリから配置を決める (正本)
    pub fn from_root(root: &Path) -> Self {
        let settings = root.join(SETTINGS_DIR);
        Self {
            root: root.to_path_buf(),
            config: settings.clone(),
            data: settings,
            state: root.join(STATE_DIR),
            cache: root.to_path_buf(),
        }
    }

    /// テスト用: 全領域を 1 つのディレクトリに重ねる (store の単体テストが temp dir を
    /// そのまま設定ディレクトリとして使うため)。製品コードでは使わない
    #[cfg(any(test, feature = "test-support"))]
    pub fn single_dir(dir: &Path) -> Self {
        Self {
            root: dir.to_path_buf(),
            config: dir.to_path_buf(),
            data: dir.to_path_buf(),
            state: dir.to_path_buf(),
            cache: dir.to_path_buf(),
        }
    }

    /// アプリデータディレクトリ (notecli.db / 鍵 / ロックの置き場)
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// 設定 (持ち出す単位)
    pub fn config(&self) -> &Path {
        &self.config
    }

    /// 人の記録 (メモ / AI セッション / 人格と記憶)
    pub fn data(&self) -> &Path {
        &self.data
    }

    /// この機械の状態
    pub fn state(&self) -> &Path {
        &self.state
    }

    /// キャッシュの親ディレクトリ
    pub fn cache(&self) -> &Path {
        &self.cache
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_puts_config_and_data_in_the_settings_dir_and_state_beside_it() {
        let root = Path::new("/tmp/nd");
        let l = Layout::from_root(root);
        assert_eq!(l.root(), root);
        assert_eq!(l.config(), root.join("notedeck"));
        assert_eq!(l.data(), root.join("notedeck"));
        assert_eq!(l.state(), root.join("state"));
        assert_eq!(l.cache(), root);
    }

    #[test]
    fn default_dir_ends_with_the_identifier() {
        if let Some(dir) = dirs::data_dir().map(|d| d.join(APP_IDENTIFIER)) {
            assert!(dir.ends_with(APP_IDENTIFIER));
        }
    }
}
