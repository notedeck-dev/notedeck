//! OS 通知の処理位置のファイル (Android、#330 段階 C)。本体 (判定) は
//! `notecore::notify_cursor`、ここは読み書きと直列化だけ。
//!
//! 置き場はアプリデータディレクトリ直下 (`notecli.db` の隣)。利用者の設定ではないので
//! 設定フォルダ (バックアップの対象) には入れない。ストリーミング (アプリ) とワーカー
//! (WorkManager のスレッド) は同じプロセスで同時に進めうるので、読み → 進め → 書き を
//! 1 つのロックで直列化する。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notecore::notify_cursor::NotifyCursor;
use notecore::notify_plan::NotifyKind;

const FILE_NAME: &str = "notify_cursor.json";

static LOCK: Mutex<()> = Mutex::new(());

fn path(app_dir: &Path) -> PathBuf {
    app_dir.join(FILE_NAME)
}

fn read(app_dir: &Path) -> NotifyCursor {
    std::fs::read_to_string(path(app_dir))
        .map(|text| NotifyCursor::from_json(&text))
        .unwrap_or_default()
}

/// 今の処理位置 (無ければ空)
pub fn load(app_dir: &Path) -> NotifyCursor {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read(app_dir)
}

/// OS 通知にした ID を記録する。今の位置より新しいときだけファイルを書く
pub fn advance(app_dir: &Path, account_id: &str, kind: NotifyKind, id: &str) {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut cursor = read(app_dir);
    if !cursor.advance(account_id, kind, id) {
        return;
    }
    if let Err(e) = std::fs::write(path(app_dir), cursor.to_json()) {
        tracing::warn!("[notification] cursor write failed: {e}");
    }
}
