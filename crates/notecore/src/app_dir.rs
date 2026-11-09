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

/// 旧配置の設定ディレクトリの名前 (app_data_dir 直下)。ここ以外で参照しない (#1333 §1、
/// lint `tests/lint/rustSettingsDir.test.ts`)。
const SETTINGS_DIR: &str = "notedeck";
/// この機械の状態 (窓の位置・同意・確認の結果) の置き場。#1333 で新設
const STATE_DIR: &str = "state";
/// 再編後 (#1334) の各領域
const CONFIG_DIR: &str = "config";
const DATA_DIR: &str = "data";
const CACHE_DIR: &str = "cache";
/// notemaid のログ (アプリ本体のログは Tauri の `app_log_dir()`)
const LOGS_DIR: &str = "logs";

/// ファイル配置の版 (#1334)。notemaid の Hello が名乗り、アプリは自分の版と照合して、
/// 違えば古い常駐を起動し直す (manifest が同じでも配置だけ変わる版があるため)。
/// 1 = 最初 / 2 = notemaid の turns が `notemaid/` の下へ (#1162) / 3 = config / data /
/// state / cache の再編 (#1334)
pub const FS_LAYOUT: u32 = 3;

/// 再編済みの版印。root 直下に無ければ旧配置 (`Layout::legacy`)
pub const LAYOUT_MARKER: &str = "layout.json5";

/// 移行の排他 (app が blocking で取る。Android の worker も同じ)
pub const LAYOUT_LOCK: &str = ".layout.lock";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LayoutVersion {
    /// `notedeck/` に設定と記録と状態が同居し、キャッシュは root 直下
    Legacy,
    /// `config/` `data/` `state/` `cache/` (#1334)
    V1,
}

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
    version: LayoutVersion,
    root: PathBuf,
    config: PathBuf,
    data: PathBuf,
    state: PathBuf,
    cache: PathBuf,
}

impl Layout {
    /// アプリデータディレクトリから配置を決める (正本)。版印 (`layout.json5`) があれば
    /// 再編後、無ければ旧配置。移行は app だけが行い (`layout_migration`)、notemaid は
    /// 版印に従って選ぶだけ
    pub fn from_root(root: &Path) -> Self {
        if root.join(LAYOUT_MARKER).is_file() {
            Self::v1(root)
        } else {
            Self::legacy(root)
        }
    }

    /// 旧配置: 設定と記録は `notedeck/`、状態は `state/`、キャッシュは root 直下
    pub fn legacy(root: &Path) -> Self {
        let settings = root.join(SETTINGS_DIR);
        Self {
            version: LayoutVersion::Legacy,
            root: root.to_path_buf(),
            config: settings.clone(),
            data: settings,
            state: root.join(STATE_DIR),
            cache: root.to_path_buf(),
        }
    }

    /// 再編後 (#1334)
    pub fn v1(root: &Path) -> Self {
        Self {
            version: LayoutVersion::V1,
            root: root.to_path_buf(),
            config: root.join(CONFIG_DIR),
            data: root.join(DATA_DIR),
            state: root.join(STATE_DIR),
            cache: root.join(CACHE_DIR),
        }
    }

    pub fn version(&self) -> LayoutVersion {
        self.version
    }

    pub fn is_legacy(&self) -> bool {
        self.version == LayoutVersion::Legacy
    }

    /// 版印のパス
    pub fn marker_path(root: &Path) -> PathBuf {
        root.join(LAYOUT_MARKER)
    }

    // --- 領域の中の決まった置き場 (配置の違いをここで吸収する) ---

    /// 画像キャッシュ (旧 `image_cache/` → `cache/images/`)
    pub fn image_cache(&self) -> PathBuf {
        match self.version {
            LayoutVersion::Legacy => self.cache.join("image_cache"),
            LayoutVersion::V1 => self.cache.join("images"),
        }
    }

    /// 絵文字辞書のキャッシュ (旧 `emoji_cache/` → `cache/emoji/`)
    pub fn emoji_cache(&self) -> PathBuf {
        match self.version {
            LayoutVersion::Legacy => self.cache.join("emoji_cache"),
            LayoutVersion::V1 => self.cache.join("emoji"),
        }
    }

    /// ペットのスプライト (旧 `pet_cache/` → `cache/pets/`)
    pub fn pet_cache(&self) -> PathBuf {
        match self.version {
            LayoutVersion::Legacy => self.cache.join("pet_cache"),
            LayoutVersion::V1 => self.cache.join("pets"),
        }
    }

    /// 秘密 (0700)。旧配置では root 直下に平置き
    pub fn secrets(&self) -> PathBuf {
        match self.version {
            LayoutVersion::Legacy => self.root.clone(),
            LayoutVersion::V1 => self.state.join("secrets"),
        }
    }

    /// 公開 API の永続トークン (ハッシュと scope、0600)
    pub fn api_tokens_file(&self) -> PathBuf {
        self.secrets().join("api-tokens.json")
    }

    /// notemaid が写した口座の一覧 (キーチェーンが無い環境ではトークンが平文)
    pub fn notemaid_accounts_file(&self) -> PathBuf {
        self.secrets().join("notemaid-accounts.json")
    }

    /// Android の OS 通知の処理位置
    pub fn notify_cursor_file(&self) -> PathBuf {
        self.state_root_file("notify_cursor.json")
    }

    /// Android の push 登録の状態
    pub fn push_state_file(&self) -> PathBuf {
        self.state_root_file("push_state.json")
    }

    fn state_root_file(&self, name: &str) -> PathBuf {
        match self.version {
            LayoutVersion::Legacy => self.root.join(name),
            LayoutVersion::V1 => self.state.join(name),
        }
    }

    /// notemaid のこの機械の状態 (turns / workspace)。旧配置では人格と記憶と同じ
    /// `notedeck/notemaid/` の下
    pub fn notemaid_state(&self) -> PathBuf {
        match self.version {
            LayoutVersion::Legacy => self.data.join("notemaid"),
            LayoutVersion::V1 => self.state.join("notemaid"),
        }
    }

    /// 編集履歴のサイドカー (`<scope>/<base>.history.json5`、#1334 段階 2)
    pub fn history(&self) -> PathBuf {
        self.state.join("history")
    }

    /// notemaid のログ
    pub fn logs(&self) -> PathBuf {
        self.root.join(LOGS_DIR)
    }

    /// テスト用: 全領域を 1 つのディレクトリに重ねる (store の単体テストが temp dir を
    /// そのまま設定ディレクトリとして使うため)。製品コードでは使わない
    #[cfg(any(test, feature = "test-support"))]
    pub fn single_dir(dir: &Path) -> Self {
        Self {
            version: LayoutVersion::Legacy,
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

/// 移行の排他 (`lock_layout`)。落とすと解放
pub struct LayoutLock {
    _file: std::fs::File,
    _in_process: std::sync::MutexGuard<'static, ()>,
}

static LAYOUT_LOCK_IN_PROCESS: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 移行の排他を blocking で取る (#1334)。同じ root で同時に移行しない。クラッシュで自動解放。
///
/// プロセス間はファイルロック、プロセス内は Mutex。Android の std は `File::lock` を
/// 実装しておらず `Unsupported` ("lock() not supported") を返すので、そこではファイル
/// ロックを掛けない (アプリ・WorkManager のワーカー・push の受信は同じプロセスなので
/// Mutex だけで足りる)
pub fn lock_layout(root: &Path) -> std::io::Result<LayoutLock> {
    let in_process = LAYOUT_LOCK_IN_PROCESS
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join(LAYOUT_LOCK))?;
    #[cfg(not(target_os = "android"))]
    file.lock()?;
    Ok(LayoutLock {
        _file: file,
        _in_process: in_process,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn layout_lock_can_be_taken_again_after_release() {
        let t = tempfile::tempdir().unwrap();
        let first = lock_layout(t.path()).unwrap();
        assert!(t.path().join(LAYOUT_LOCK).is_file());
        drop(first);
        lock_layout(t.path()).unwrap();
    }

    use super::*;

    #[test]
    fn the_marker_selects_the_reorganized_layout() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert!(Layout::from_root(root).is_legacy());
        std::fs::write(Layout::marker_path(root), "{ version: 3 }\n").unwrap();
        let l = Layout::from_root(root);
        assert_eq!(l.version(), LayoutVersion::V1);
        assert_eq!(l.config(), root.join("config"));
        assert_eq!(l.data(), root.join("data"));
        assert_eq!(l.state(), root.join("state"));
        assert_eq!(l.cache(), root.join("cache"));
        assert_eq!(l.image_cache(), root.join("cache/images"));
        assert_eq!(
            l.api_tokens_file(),
            root.join("state/secrets/api-tokens.json")
        );
        assert_eq!(l.notemaid_state(), root.join("state/notemaid"));
        assert_eq!(
            l.notify_cursor_file(),
            root.join("state/notify_cursor.json")
        );
        // 旧配置では平置き
        let old = Layout::legacy(root);
        assert_eq!(old.image_cache(), root.join("image_cache"));
        assert_eq!(old.api_tokens_file(), root.join("api-tokens.json"));
        assert_eq!(old.notemaid_state(), root.join("notedeck/notemaid"));
        assert_eq!(old.history(), root.join("state/history"));
    }

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
