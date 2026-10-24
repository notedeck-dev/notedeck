//! push の状態ファイル (#330)。本体 (遷移) は `notecore::push_state`、ここは読み書きと
//! 直列化だけ。
//!
//! 置き場はアプリデータディレクトリ直下 (`notify_cursor.json` と同じ)。端末ごとの状態で
//! 秘密は置かない (三つ組は keychain)。端末外バックアップからは外す (backup_rules.xml /
//! data_extraction_rules.xml)。アプリのコマンド・push の受信・ワーカーは同じプロセスで
//! 同時に進めうるので、読み → 変更 → 書き を 1 つのロックで直列化する。
// 使うのは Android だけ (ほかの OS では手順のテストからだけ呼ぶ)
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notecore::push_state::PushStore;

const FILE_NAME: &str = "push_state.json";
const TMP_NAME: &str = "push_state.json.tmp";

static LOCK: Mutex<()> = Mutex::new(());

fn path(app_dir: &Path) -> PathBuf {
    app_dir.join(FILE_NAME)
}

fn read(app_dir: &Path) -> PushStore {
    std::fs::read_to_string(path(app_dir))
        .map(|text| PushStore::from_json(&text))
        .unwrap_or_default()
}

/// 今の状態 (無ければ空)
pub fn load(app_dir: &Path) -> PushStore {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read(app_dir)
}

/// 状態を変える。変わったときだけ書く (一時ファイルに書いてから rename で置き換える。
/// 書込の途中でプロセスが殺されても、途中までの JSON で全口座の状態を失わない)
pub fn update<R>(app_dir: &Path, change: impl FnOnce(&mut PushStore) -> R) -> R {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut store = read(app_dir);
    let before = store.clone();
    let result = change(&mut store);
    if store != before {
        let tmp = app_dir.join(TMP_NAME);
        let written = std::fs::write(&tmp, store.to_json())
            .and_then(|()| std::fs::rename(&tmp, path(app_dir)));
        if let Err(e) = written {
            tracing::warn!("[push] state write failed: {e}");
        }
    }
    result
}
