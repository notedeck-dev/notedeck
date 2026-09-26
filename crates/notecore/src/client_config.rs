//! 手元側の構成ファイル `client.json5` (#1106 段階 3a)。
//!
//! 端末ごとの「望む構成」を持つ: `backend` が `embedded` (アプリに埋め込んだ
//! notecore) か `resident` (常駐の notecored に中継) か、その切替の途中
//! (`pending-resident`: 移行パッケージを書き出してアプリの再起動待ち) か。
//! 手元側のファイルなので設定バックアップに含めず、capability からも書けない
//! (アプリの切替導線だけが書く)。無い / 壊れているときは `embedded`。

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::settings_store as store;

pub const FILE_NAME: &str = "client.json5";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Backend {
    #[default]
    Embedded,
    /// 切替の途中: 移行パッケージを書き出し済み、次の起動で import して常駐に切り替える
    PendingResident,
    Resident,
}

#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ClientConfig {
    #[serde(default)]
    pub backend: Backend,
}

/// 空 (= ファイル未作成) や壊れた内容は既定 (`embedded`)
pub fn parse(raw: &str) -> ClientConfig {
    if raw.trim().is_empty() {
        return ClientConfig::default();
    }
    json5::from_str::<ClientConfig>(raw).unwrap_or_default()
}

pub fn serialize(cfg: &ClientConfig) -> String {
    let backend = match cfg.backend {
        Backend::Embedded => "embedded",
        Backend::PendingResident => "pending-resident",
        Backend::Resident => "resident",
    };
    format!(
        "// この端末の構成 (#1106)。embedded = アプリに埋め込んだ notecore、resident = 常駐の notecored に中継\n{{\n  backend: '{backend}',\n}}\n"
    )
}

/// 設定ディレクトリから読む。無ければ既定
pub fn load(base_dir: &Path) -> ClientConfig {
    match store::read_root_file(base_dir, FILE_NAME) {
        Ok(raw) => parse(&raw),
        Err(_) => ClientConfig::default(),
    }
}

pub fn save(base_dir: &Path, cfg: &ClientConfig) -> Result<()> {
    store::write_root_file(base_dir, FILE_NAME, &serialize(cfg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_missing_broken_and_valid() {
        assert_eq!(parse("").backend, Backend::Embedded);
        assert_eq!(parse("{{{").backend, Backend::Embedded);
        assert_eq!(parse("{ backend: 'nope' }").backend, Backend::Embedded);
        assert_eq!(parse("{ backend: 'resident' }").backend, Backend::Resident);
        assert_eq!(
            parse("{ backend: 'pending-resident' }").backend,
            Backend::PendingResident
        );
        assert_eq!(parse("{}").backend, Backend::Embedded);
    }

    #[test]
    fn round_trips_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()).backend, Backend::Embedded);
        let cfg = ClientConfig {
            backend: Backend::Resident,
        };
        save(dir.path(), &cfg).unwrap();
        let raw = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(raw.contains("backend: 'resident'"));
        assert_eq!(load(dir.path()), cfg);
        assert_eq!(
            parse(&serialize(&ClientConfig::default())).backend,
            Backend::Embedded
        );
    }
}
