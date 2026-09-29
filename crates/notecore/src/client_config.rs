//! 手元側の構成ファイル `client.json5` (#1106 案 B)。
//!
//! 端末ごとの「AI (notemaid) をどこで動かすか」を持つ: `auto` (既定。常駐の notemaid が
//! 居れば繋ぎ、居なければ同梱の sidecar を子プロセスで起動、どちらも無ければ in-process) /
//! `embedded` (常に in-process、開発と切り分け用) / `resident` (常駐の notemaid にだけ繋ぐ、
//! 子プロセスは起動しない)。データ面は構成に関わらず常にアプリの中。手元側のファイル
//! なので設定バックアップに含めず、capability からも書けない。無い / 壊れているときは `auto`。

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::settings_store as store;

pub const FILE_NAME: &str = "client.json5";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Backend {
    #[default]
    Auto,
    Embedded,
    Resident,
}

#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ClientConfig {
    #[serde(default)]
    pub backend: Backend,
}

/// 空 (= ファイル未作成) や壊れた内容は既定 (`auto`)
pub fn parse(raw: &str) -> ClientConfig {
    if raw.trim().is_empty() {
        return ClientConfig::default();
    }
    json5::from_str::<ClientConfig>(raw).unwrap_or_default()
}

pub fn serialize_backend(backend: Backend) -> &'static str {
    match backend {
        Backend::Auto => "auto",
        Backend::Embedded => "embedded",
        Backend::Resident => "resident",
    }
}

pub fn serialize(cfg: &ClientConfig) -> String {
    let backend = serialize_backend(cfg.backend);
    format!(
        "// この端末の AI (notemaid) の動かし方 (#1106)。auto = 常駐が居れば繋ぎ、無ければ子プロセス / embedded = 常に in-process / resident = 常駐にだけ繋ぐ\n{{\n  backend: '{backend}',\n}}\n"
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
        assert_eq!(parse("").backend, Backend::Auto);
        assert_eq!(parse("{{{").backend, Backend::Auto);
        assert_eq!(parse("{ backend: 'nope' }").backend, Backend::Auto);
        assert_eq!(parse("{ backend: 'embedded' }").backend, Backend::Embedded);
        assert_eq!(parse("{ backend: 'resident' }").backend, Backend::Resident);
        assert_eq!(parse("{}").backend, Backend::Auto);
    }

    #[test]
    fn round_trips_through_the_file() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()).backend, Backend::Auto);
        let cfg = ClientConfig {
            backend: Backend::Resident,
        };
        save(dir.path(), &cfg).unwrap();
        let raw = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(raw.contains("backend: 'resident'"));
        assert_eq!(load(dir.path()), cfg);
        assert_eq!(
            parse(&serialize(&ClientConfig::default())).backend,
            Backend::Auto
        );
    }
}
