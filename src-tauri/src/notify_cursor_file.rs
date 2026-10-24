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
const TMP_NAME: &str = "notify_cursor.json.tmp";

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
    // 一時ファイルに書いてから rename で置き換える (同じディレクトリ内なら atomic)。
    // 直接上書きだと、書込の途中で Android がプロセスを殺すと空や途中までの JSON が
    // 残り、全口座の位置が消える。一時ファイル名が固定でよいのは LOCK で直列化して
    // いるから (ワーカーも WorkManager がアプリと同じプロセスで走らせる)
    let tmp = app_dir.join(TMP_NAME);
    let result =
        std::fs::write(&tmp, cursor.to_json()).and_then(|()| std::fs::rename(&tmp, path(app_dir)));
    if let Err(e) = result {
        tracing::warn!("[notification] cursor write failed: {e}");
    }
}
