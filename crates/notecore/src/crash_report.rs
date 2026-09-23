//! Rust panic の記録 (#644 の診断に相乗り)。
//!
//! Android は adb を繋げない環境が普通なので、panic をログディレクトリに
//! 残して About の診断から見せる。デスクトップでも同じ経路で見えるので、
//! プラットフォームを問わず「前回落ちた理由」を UI だけで拾える。
//!
//! panic 以外の異常終了 (SIGSEGV / OOM kill) は捕まえられない。ただし
//! 「落ちたのに panic ログが無い」こと自体が切り分けになる:
//!   - panic ログあり → Rust 側。file:line で特定できる
//!   - panic ログなし → ネイティブクラッシュか OS による kill
//!
//! 「起動時にマーカーを置いて正常終了で消す」方式は採らない。Android は
//! OS がアプリを日常的に kill するため、誤検知だらけになる。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PANIC_FILE: &str = "last_panic.txt";

/// 記録された panic。診断レポートに載せてコピーできる形で渡す。
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PanicReport {
    /// panic した時刻 (epoch ms)。0 は時刻を復元できなかったことを示す
    pub at: u64,
    /// panic メッセージ + backtrace
    pub message: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// panic をファイルに書き出すフックを入れる。既定のフックも呼ぶ
/// (stderr / logcat への出力は残す)。
pub fn install_panic_hook(dir: PathBuf) {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Display は "panicked at <location>: <payload>" を含む
        let backtrace = std::backtrace::Backtrace::force_capture();
        let body = format!("{info}\n\nbacktrace:\n{backtrace}");
        // tracing の writer スレッドが巻き添えで死んでいることがあるので直接書く。
        // 複数スレッドが同時に panic しても唯一の手がかりを壊さないよう atomic に
        // 置き換える (fs::write は truncate 後に書くので混ざりうる)。
        let _ = std::fs::create_dir_all(&dir);
        let _ = crate::settings_store::atomic_write(
            &dir.join(PANIC_FILE),
            &format!("{}\n{body}", now_ms()),
            None,
        );
        tracing::error!("{body}");
        default_hook(info);
    }));
}

/// 記録された panic を読む。**消さない** — 診断は何度開いても同じものが
/// 見えるべきで、次の panic が来たら上書きされる。
pub fn read_last_panic(dir: &Path) -> Option<PanicReport> {
    let content = std::fs::read_to_string(dir.join(PANIC_FILE)).ok()?;
    if content.trim().is_empty() {
        return None;
    }
    // 1 行目が epoch ms、残りが本文。古い形式・壊れた場合は全体を本文として扱う
    match content.split_once('\n') {
        Some((head, body)) if !body.trim().is_empty() => match head.trim().parse::<u64>() {
            Ok(at) => Some(PanicReport {
                at,
                message: body.to_string(),
            }),
            Err(_) => Some(PanicReport {
                at: 0,
                message: content,
            }),
        },
        _ => Some(PanicReport {
            at: 0,
            message: content,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_when_no_panic_recorded() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_last_panic(dir.path()).is_none());
    }

    #[test]
    fn reads_timestamp_and_body() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(PANIC_FILE),
            "1753800000000\npanicked at src/foo.rs:12:3: boom",
        )
        .unwrap();

        let report = read_last_panic(dir.path()).expect("should read");
        assert_eq!(report.at, 1_753_800_000_000);
        assert!(report.message.contains("src/foo.rs:12:3"));
    }

    /// 診断を開くたびに消えると、見返したときに情報が無くなってしまう
    #[test]
    fn keeps_the_report_for_repeated_reads() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PANIC_FILE), "1753800000000\nboom").unwrap();

        assert!(read_last_panic(dir.path()).is_some());
        assert!(read_last_panic(dir.path()).is_some());
    }

    /// 時刻行が無い古い形式でも本文は読めるようにする
    #[test]
    fn falls_back_when_timestamp_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PANIC_FILE), "panicked at src/foo.rs:1:1: x").unwrap();

        let report = read_last_panic(dir.path()).expect("should read");
        assert_eq!(report.at, 0);
        assert!(report.message.contains("src/foo.rs"));
    }

    #[test]
    fn ignores_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(PANIC_FILE), "  \n").unwrap();
        assert!(read_last_panic(dir.path()).is_none());
    }
}
