//! ログ。systemd 配下 (JOURNAL_STREAM) では stdout に出して journal に任せ、単体
//! 起動では data-dir の logs/ に日次ローテート (世代上限つき)。

use std::path::Path;

use tracing_subscriber::prelude::*;

#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LogTarget {
    Stdout,
    File,
}

const LOG_FILE_GENERATIONS: usize = 14;

/// 書き手を `redact::Writer` で包む (保存前の秘匿化、#1164)
struct Redacting<M>(M);

impl<'a, M: tracing_subscriber::fmt::MakeWriter<'a>> tracing_subscriber::fmt::MakeWriter<'a>
    for Redacting<M>
{
    type Writer = crate::redact::Writer<M::Writer>;
    fn make_writer(&'a self) -> Self::Writer {
        crate::redact::Writer(self.0.make_writer())
    }
}

pub fn resolve(target: Option<LogTarget>) -> LogTarget {
    target.unwrap_or_else(|| {
        if std::env::var_os("JOURNAL_STREAM").is_some() {
            LogTarget::Stdout
        } else {
            LogTarget::File
        }
    })
}

pub fn init(target: LogTarget, data_dir: &Path) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        "notemaid=info,notecore=info,notecli=info,warn"
            .parse()
            .expect("default tracing filter must parse")
    });
    let file_layer = match target {
        LogTarget::Stdout => None,
        LogTarget::File => {
            let dir = data_dir.join("logs");
            std::fs::create_dir_all(&dir)
                .ok()
                .and_then(|_| {
                    tracing_appender::rolling::RollingFileAppender::builder()
                        .rotation(tracing_appender::rolling::Rotation::DAILY)
                        .filename_prefix("notemaid.log")
                        .max_log_files(LOG_FILE_GENERATIONS)
                        .build(&dir)
                        .ok()
                })
                .map(|appender| {
                    let (non_blocking, guard) = tracing_appender::non_blocking(appender);
                    Box::leak(Box::new(guard));
                    tracing_subscriber::fmt::layer()
                        .with_ansi(false)
                        .with_writer(Redacting(non_blocking))
                })
        }
    };
    let stdout_layer = match target {
        LogTarget::Stdout => Some(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(Redacting(std::io::stdout)),
        ),
        LogTarget::File => None,
    };
    tracing_subscriber::registry()
        .with(filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();
    if std::env::var("RUST_LOG")
        .map(|v| v.contains("debug") || v.contains("trace"))
        .unwrap_or(false)
    {
        tracing::warn!(
            "RUST_LOG allows debug output: API responses and tokens may appear in the log"
        );
    }
}
