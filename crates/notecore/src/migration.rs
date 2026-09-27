//! 同一ホストの移行パッケージ (#1106 段階 3a 順序 7、配布設計 §7 / §9)。
//!
//! アプリの secret backend (OS キーチェーンか劣化先のファイル) と notecored のファイル
//! backend の間で secret を移す。パッケージは一回限りの鍵で暗号化した notecli の file
//! store と、その中にある名前の索引 (名前は secret ではない: アカウント ID / Vault の接続
//! ID と slot / 旧 AI キーの provider)。置き場は `$XDG_RUNTIME_DIR/notecored/` (0700 /
//! 0600) で、取り込みは成功・失敗どちらでもパッケージを消す。同一 uid のプロセスは読める
//! が、それはファイル backend 自体と同じ脅威モデル。
//!
//! OS キーチェーンからファイル backend へ直接コピーする経路は作らない (パッケージと二重
//! 経路になり、確認と監査を迂回する)。

use std::path::{Path, PathBuf};

use notecli::db::Database;
use notecli::error::NoteDeckError;
use notecli::file_keyring::Store;
use serde::{Deserialize, Serialize};

use crate::error::Result;

/// `$XDG_RUNTIME_DIR` 配下のディレクトリ名 (socket と同じ場所)
pub const DIR_NAME: &str = "notecored";
const INDEX_FILE: &str = "migration.json";
const DATA_FILE: &str = "migration.enc";
const KEY_FILE: &str = "migration.key";
const INDEX_VERSION: u32 = 1;
/// 旧 AI キー (Vault へ移行済みなら無い)。無くても失敗にしない
const LEGACY_AI_PROVIDERS: &[&str] = &["anthropic", "openai", "custom"];

/// 既定の置き場 (`$XDG_RUNTIME_DIR/notecored`)。無ければ None
pub fn default_package_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|v| !v.is_empty())
        .map(|dir| PathBuf::from(dir).join(DIR_NAME))
}

#[derive(Serialize, Deserialize)]
struct Index {
    version: u32,
    entries: Vec<String>,
}

/// 移した結果。`missing` は読めなかった名前 (必須なら呼び出し側が失敗にする)
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSummary {
    pub written: Vec<String>,
    pub missing: Vec<String>,
}

/// 移す対象。`fallback` は keychain に無いときの代替 (DB に残った平文トークン)。
/// `required` が false の名前は無くても構わない (旧 AI キー)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub fallback: Option<String>,
    pub required: bool,
}

/// この data-dir で移すべき名前の一覧 (アカウント / Vault の slot / 旧 AI キー)
pub fn entries_for(db: &Database, app_dir: &Path) -> Result<Vec<Entry>> {
    let mut out = Vec::new();
    for a in db.load_accounts()? {
        out.push(Entry {
            name: a.id.clone(),
            fallback: (!a.token.is_empty()).then(|| a.token.clone()),
            required: true,
        });
    }
    let vault = crate::vault::connections_store::load(app_dir)
        .map_err(|e| NoteDeckError::Internal(format!("connections.json: {e}")))?;
    for c in &vault.connections {
        for slot in &c.slots {
            out.push(Entry {
                name: format!("vault/v1/{}/{}", c.id, slot),
                fallback: None,
                required: true,
            });
        }
    }
    for p in LEGACY_AI_PROVIDERS {
        out.push(Entry {
            name: format!("ai.{p}"),
            fallback: None,
            required: false,
        });
    }
    Ok(out)
}

pub fn package_exists(dir: &Path) -> bool {
    dir.join(INDEX_FILE).exists()
}

/// パッケージを消す (無くても何もしない)
pub fn remove_package(dir: &Path) {
    for f in [INDEX_FILE, DATA_FILE, KEY_FILE] {
        let _ = std::fs::remove_file(dir.join(f));
    }
}

fn keychain_err(e: impl std::fmt::Display) -> NoteDeckError {
    NoteDeckError::Keychain(e.to_string())
}

fn restrict(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode));
}

/// `read` で読めた分をパッケージに書く (鍵は一回限りで新しく作る)
pub fn export_with(
    dir: &Path,
    entries: &[Entry],
    read: impl Fn(&str) -> Result<Option<String>>,
) -> Result<MigrationSummary> {
    std::fs::create_dir_all(dir)
        .map_err(|e| NoteDeckError::InvalidInput(format!("{}: {e}", dir.display())))?;
    restrict(dir, 0o700);
    remove_package(dir);
    let store =
        Store::with_paths(&dir.join(KEY_FILE), &dir.join(DATA_FILE)).map_err(keychain_err)?;
    let mut summary = MigrationSummary::default();
    for e in entries {
        // 必須でない名前 (旧 AI キー) は読めなくても失敗にしない
        let read_value = match read(&e.name) {
            Ok(v) => v,
            Err(e2) if !e.required => {
                tracing::debug!(name = e.name, "[migration] optional entry unreadable: {e2}");
                None
            }
            Err(e2) => return Err(e2),
        };
        let value = match read_value {
            Some(v) => Some(v),
            None => e.fallback.clone(),
        };
        match value {
            Some(v) => {
                store.write(&e.name, &v).map_err(keychain_err)?;
                summary.written.push(e.name.clone());
            }
            None => summary.missing.push(e.name.clone()),
        }
    }
    let index = Index {
        version: INDEX_VERSION,
        entries: summary.written.clone(),
    };
    let text = serde_json::to_string_pretty(&index)?;
    std::fs::write(dir.join(INDEX_FILE), text)
        .map_err(|e| NoteDeckError::InvalidInput(format!("{INDEX_FILE}: {e}")))?;
    for f in [INDEX_FILE, DATA_FILE, KEY_FILE] {
        restrict(&dir.join(f), 0o600);
    }
    Ok(summary)
}

/// 今の既定の secret store からパッケージへ
pub fn export(dir: &Path, entries: &[Entry]) -> Result<MigrationSummary> {
    export_with(dir, entries, notecli::keychain::get_token)
}

/// 消し忘れないための番人: 取り込みが途中で失敗してもパッケージを残さない
struct RemoveOnDrop<'a>(&'a Path);
impl Drop for RemoveOnDrop<'_> {
    fn drop(&mut self) {
        remove_package(self.0);
    }
}

/// パッケージの中身を `write` で書き込む。成功・失敗どちらでもパッケージは消える
pub fn import_with(
    dir: &Path,
    write: impl Fn(&str, &str) -> Result<()>,
) -> Result<MigrationSummary> {
    let _guard = RemoveOnDrop(dir);
    let (index_path, key_path, data_path) = (
        dir.join(INDEX_FILE),
        dir.join(KEY_FILE),
        dir.join(DATA_FILE),
    );
    // 中身が 1 件も無いパッケージは data ファイルを持たない (file store は最初の書込で作る)
    if !(index_path.exists() && key_path.exists()) {
        return Err(NoteDeckError::InvalidInput(format!(
            "no migration package in {}",
            dir.display()
        )));
    }
    let index: Index = serde_json::from_str(
        &std::fs::read_to_string(&index_path)
            .map_err(|e| NoteDeckError::InvalidInput(format!("{INDEX_FILE}: {e}")))?,
    )?;
    if index.version != INDEX_VERSION {
        return Err(NoteDeckError::InvalidInput(format!(
            "unsupported migration package version {}",
            index.version
        )));
    }
    let store = Store::with_paths(&key_path, &data_path).map_err(keychain_err)?;
    let mut summary = MigrationSummary::default();
    for name in index.entries {
        match store.read(&name).map_err(keychain_err)? {
            Some(v) => {
                write(&name, &v)?;
                summary.written.push(name);
            }
            None => summary.missing.push(name),
        }
    }
    Ok(summary)
}

/// パッケージから今の既定の secret store へ
pub fn import(dir: &Path) -> Result<MigrationSummary> {
    import_with(dir, notecli::keychain::store_token)
}

/// 今の既定の store に無い名前 (戻す導線の「差分ゼロ」確認に使う)
pub fn missing_in_default(names: &[String]) -> Result<Vec<String>> {
    let mut missing = Vec::new();
    for n in names {
        if notecli::keychain::get_token(n)?.is_none() {
            missing.push(n.clone());
        }
    }
    Ok(missing)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn entry(name: &str, required: bool) -> Entry {
        Entry {
            name: name.into(),
            fallback: None,
            required,
        }
    }

    #[test]
    fn round_trips_through_a_package_and_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        let pkg = dir.path().join("pkg");
        let source: HashMap<String, String> = [
            ("acct-1".to_string(), "token-one".to_string()),
            (
                "vault/v1/01ARZ/primary".to_string(),
                "sk-secret".to_string(),
            ),
        ]
        .into_iter()
        .collect();
        let entries = vec![
            entry("acct-1", true),
            entry("vault/v1/01ARZ/primary", true),
            entry("ai.anthropic", false),
            Entry {
                name: "acct-db".into(),
                fallback: Some("plain-from-db".into()),
                required: true,
            },
        ];
        let summary = export_with(&pkg, &entries, |n| Ok(source.get(n).cloned())).unwrap();
        assert_eq!(
            summary.written,
            vec!["acct-1", "vault/v1/01ARZ/primary", "acct-db"]
        );
        assert_eq!(summary.missing, vec!["ai.anthropic"]);
        assert!(package_exists(&pkg));

        let dest: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
        let imported = import_with(&pkg, |n, v| {
            dest.lock().unwrap().insert(n.into(), v.into());
            Ok(())
        })
        .unwrap();
        assert_eq!(imported.written.len(), 3);
        assert!(imported.missing.is_empty());
        let dest = dest.into_inner().unwrap();
        assert_eq!(dest["acct-1"], "token-one");
        assert_eq!(dest["acct-db"], "plain-from-db");
        assert_eq!(dest["vault/v1/01ARZ/primary"], "sk-secret");
        // 取り込んだら消える
        assert!(!package_exists(&pkg));
        assert!(!pkg.join(KEY_FILE).exists());
    }

    #[test]
    fn import_fails_without_a_package_and_cleans_a_broken_one() {
        let dir = tempfile::tempdir().unwrap();
        let pkg = dir.path().join("pkg");
        assert!(import_with(&pkg, |_, _| Ok(())).is_err());
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(pkg.join(INDEX_FILE), "{}").unwrap();
        std::fs::write(pkg.join(KEY_FILE), "x").unwrap();
        std::fs::write(pkg.join(DATA_FILE), "x").unwrap();
        assert!(import_with(&pkg, |_, _| Ok(())).is_err());
        assert!(!package_exists(&pkg));
    }
}
