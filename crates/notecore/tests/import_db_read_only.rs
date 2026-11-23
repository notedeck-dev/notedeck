//! DB の取り込み (#1438): 書き込めない場所にあるバックアップも取り込める。
//!
//! 権限を使うので unix だけ。`commands/` には target 依存の cfg を置けないので、
//! ここに分けてある。
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;

use notecore::commands::admin::replace_database_file;

/// アプリを終了して notecli.db だけを写したバックアップを、読み取り専用の媒体から
/// 取り込める。WAL モードの DB は、隣に補助ファイルを作れない場所では読み取り専用でも
/// 開けないので、選ばれたファイルを直接開いて確かめてはいけない。置いた DB は
/// 元が読み取り専用でも、次の起動で書き込める
#[test]
fn accepts_read_only_db_on_read_only_media() {
    let dir = tempfile::tempdir().unwrap();
    let app_dir = dir.path().join("app");
    std::fs::create_dir(&app_dir).unwrap();
    std::fs::write(app_dir.join("notecli.db"), b"current").unwrap();

    // WAL を本体に畳んでから、本体だけを媒体に写す
    let made = dir.path().join("made.db");
    drop(notecli::db::Database::open(&made).unwrap());
    rusqlite::Connection::open(&made)
        .unwrap()
        .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
        .unwrap();
    let media = dir.path().join("media");
    std::fs::create_dir(&media).unwrap();
    let src = media.join("notecli.db");
    std::fs::copy(&made, &src).unwrap();
    std::fs::set_permissions(&src, std::fs::Permissions::from_mode(0o400)).unwrap();
    std::fs::set_permissions(&media, std::fs::Permissions::from_mode(0o555)).unwrap();

    let result = replace_database_file(&app_dir, &src);
    std::fs::set_permissions(&media, std::fs::Permissions::from_mode(0o755)).unwrap();
    result.unwrap();

    notecli::db::Database::open(&app_dir.join("notecli.db")).unwrap();
    assert!(!app_dir.join("notecli.db.import").exists());
}
