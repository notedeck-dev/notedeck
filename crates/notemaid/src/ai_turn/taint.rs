//! セッションの汚染 (taint) の記録 (#1103 Phase 1 / #1133 縦切り 3)。
//!
//! 他人の内容 (投稿 / プロフィール / 通知 / fetch 結果) を読んだセッションは
//! 以後 tainted で、ターンで消えない。tainted なセッションの書き込みは
//! 「次から確認しない」を無視して必ず確認する。記録は notecore 専有の置き場
//! (`<app dir>/notedeck/ai-turns/taint.json`) で、生ファイル書込の対象外。
//!
//! 何が汚染源かは capability 宣言の `untrusted` (宣言表) と、デバイスが
//! ターン開始時に申告する文脈 (可視ノートなど) で決まる。宛先の出所の 3 値と
//! メモ / skill のラベルは後続。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::BoxFuture;

const FILE_NAME: &str = "taint.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaintRecord {
    pub since_ms: u64,
    /// 汚染源 (capability id や `context`)。初出順、重複なし
    pub sources: Vec<String>,
}

pub trait TaintStore: Send + Sync + 'static {
    fn is_tainted<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, bool>;
    fn mark<'a>(&'a self, session_id: &'a str, source: &'a str) -> BoxFuture<'a, ()>;
}

/// ファイルに記録する本番実装。読み書きは短いのでプロセス内ロックで直列化する。
pub struct FileTaint {
    path: PathBuf,
    lock: Mutex<()>,
}

pub fn path(app_dir: &Path) -> PathBuf {
    super::checkpoint::dir(app_dir).join(FILE_NAME)
}

fn read_map(path: &Path) -> BTreeMap<String, TaintRecord> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_map(path: &Path, map: &BTreeMap<String, TaintRecord>) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(map) {
        Ok(body) => {
            if let Err(e) = std::fs::write(path, body) {
                tracing::warn!("cannot write ai taint record: {e}");
            }
        }
        Err(e) => tracing::warn!("cannot encode ai taint record: {e}"),
    }
}

impl FileTaint {
    pub fn new(app_dir: &Path) -> Self {
        Self {
            path: path(app_dir),
            lock: Mutex::new(()),
        }
    }
}

impl TaintStore for FileTaint {
    fn is_tainted<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, bool> {
        let _g = self.lock.lock();
        let hit = read_map(&self.path).contains_key(session_id);
        Box::pin(std::future::ready(hit))
    }
    fn mark<'a>(&'a self, session_id: &'a str, source: &'a str) -> BoxFuture<'a, ()> {
        let _g = self.lock.lock();
        let mut map = read_map(&self.path);
        let rec = map
            .entry(session_id.to_string())
            .or_insert_with(|| TaintRecord {
                since_ms: crate::ai_sessions::now_ms(),
                sources: Vec::new(),
            });
        if !rec.sources.iter().any(|s| s == source) {
            rec.sources.push(source.to_string());
        }
        write_map(&self.path, &map);
        Box::pin(std::future::ready(()))
    }
}

/// セッション削除で記録も消す。
pub fn forget(app_dir: &Path, session_id: &str) {
    let p = path(app_dir);
    let mut map = read_map(&p);
    if map.remove(session_id).is_some() {
        write_map(&p, &map);
    }
}

/// テスト用のメモリ実装。
#[derive(Default)]
pub struct MemoryTaint(pub Mutex<BTreeMap<String, Vec<String>>>);

impl TaintStore for MemoryTaint {
    fn is_tainted<'a>(&'a self, session_id: &'a str) -> BoxFuture<'a, bool> {
        let hit = self
            .0
            .lock()
            .map(|m| m.contains_key(session_id))
            .unwrap_or(false);
        Box::pin(std::future::ready(hit))
    }
    fn mark<'a>(&'a self, session_id: &'a str, source: &'a str) -> BoxFuture<'a, ()> {
        if let Ok(mut m) = self.0.lock() {
            let v = m.entry(session_id.to_string()).or_default();
            if !v.iter().any(|s| s == source) {
                v.push(source.to_string());
            }
        }
        Box::pin(std::future::ready(()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn file_taint_marks_once_per_source_and_forgets_on_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let t = FileTaint::new(tmp.path());
        assert!(!t.is_tainted("s1").await);
        t.mark("s1", "notes.show").await;
        t.mark("s1", "notes.show").await;
        t.mark("s1", "context").await;
        assert!(t.is_tainted("s1").await);
        let map = read_map(&path(tmp.path()));
        assert_eq!(map["s1"].sources, vec!["notes.show", "context"]);
        forget(tmp.path(), "s1");
        assert!(!t.is_tainted("s1").await);
    }
}
