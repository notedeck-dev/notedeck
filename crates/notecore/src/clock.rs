//! 壁時計。ミリ秒の UNIX 時刻を返す 1 関数で、ファイルの `createdAt` 等に使う
//! (notemaid のセッション / メモと notecore のテーマ / サイドカーが同じ時計を使う)。

use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
