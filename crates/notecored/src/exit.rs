//! 終了コード (#1106 段階 3a の補遺 §4)。unit の `RestartPreventExitStatus=` に
//! 載せるものは再起動しても直らない状態で、systemd は再起動ループを作らない。

/// 同じデータディレクトリで別の notecore (アプリの埋め込み / 別の notecored) が動いている
pub const LOCK_HELD: i32 = 10;
/// DB がこのバイナリより新しい (新しい版で migrate 済み)
pub const DB_NEWER: i32 = 11;
/// runtime ディレクトリ ($XDG_RUNTIME_DIR) が無く、socket の置き場も指定されていない
pub const RUNTIME_DIR_MISSING: i32 = 12;
/// secret の鍵が無い、または読めない
pub const SECRET_KEY: i32 = 13;
/// それ以外の起動失敗 (再起動で直りうる)
pub const FAILURE: i32 = 1;

/// `RestartPreventExitStatus=` に書く一覧
pub const NO_RESTART: &[i32] = &[LOCK_HELD, DB_NEWER, RUNTIME_DIR_MISSING, SECRET_KEY];

pub fn name(code: i32) -> &'static str {
    match code {
        LOCK_HELD => "lock_held",
        DB_NEWER => "db_newer",
        RUNTIME_DIR_MISSING => "runtime_dir_missing",
        SECRET_KEY => "secret_key",
        FAILURE => "failure",
        _ => "ok",
    }
}
