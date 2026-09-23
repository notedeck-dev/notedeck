//! 永続 API トークン (#709)。
//!
//! 外部アプリ (MCP / Raycast / 外部 AI エージェント等) が再起動を跨いで
//! HTTP API (port 19820) を使うための名前付きトークン。起動毎に再生成される
//! ephemeral トークン (`api-token` ファイル) と併存する。
//!
//! セキュリティ設計: トークン本体はどこにも保存しない。`api-tokens.json` に
//! は SHA-256 ハッシュとメタデータのみを置き、raw トークンは発行時に一度だけ
//! 返す (GitHub PAT と同じモデル)。OS キーチェーンを使わないのは、Linux
//! バックエンド (kernel keyutils) がセッション単位で再起動時に消えるため。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

const TOKENS_FILE: &str = "api-tokens.json";
/// raw トークンの接頭辞。ログ等で見かけたとき種別を識別できるようにする。
const TOKEN_PREFIX: &str = "ndp_";

/// 保存されるエントリ (ハッシュ込み)。ファイル内部表現。
#[derive(Clone, Serialize, Deserialize)]
struct ApiTokenEntry {
    id: String,
    name: String,
    /// SHA-256(raw token) の hex
    token_hash: String,
    created_at_ms: i64,
}

/// フロントに見せるメタデータ (ハッシュは含めない)。
#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiTokenMeta {
    pub id: String,
    pub name: String,
    pub created_at_ms: i64,
}

pub struct ApiTokenStore {
    path: PathBuf,
    entries: Mutex<Vec<ApiTokenEntry>>,
}

impl ApiTokenStore {
    /// `app_dir/api-tokens.json` を読み込む。無ければ空で開始。
    /// 壊れたファイルは warn を出して空扱い (発行し直せば上書きで復旧)。
    pub fn load(app_dir: &Path) -> Self {
        let path = app_dir.join(TOKENS_FILE);
        let entries = match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                tracing::warn!(%e, "api-tokens.json is corrupt; starting empty");
                Vec::new()
            }),
            Err(_) => Vec::new(),
        };
        Self {
            path,
            entries: Mutex::new(entries),
        }
    }

    pub fn list(&self) -> Vec<ApiTokenMeta> {
        self.entries
            .lock()
            .unwrap()
            .iter()
            .map(|e| ApiTokenMeta {
                id: e.id.clone(),
                name: e.name.clone(),
                created_at_ms: e.created_at_ms,
            })
            .collect()
    }

    /// 新規トークンを発行し、(メタデータ, raw トークン) を返す。
    /// raw はこの戻り値でしか得られない。
    pub fn create(&self, name: &str) -> std::io::Result<(ApiTokenMeta, String)> {
        let raw: String = rand::random::<[u8; 32]>()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let raw = format!("{TOKEN_PREFIX}{raw}");
        let entry = ApiTokenEntry {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.trim().to_string(),
            token_hash: hash_hex(&raw),
            created_at_ms: now_ms(),
        };
        let meta = ApiTokenMeta {
            id: entry.id.clone(),
            name: entry.name.clone(),
            created_at_ms: entry.created_at_ms,
        };
        let mut entries = self.entries.lock().unwrap();
        entries.push(entry);
        self.save(&entries)?;
        Ok((meta, raw))
    }

    /// トークンを失効させる。存在したら true。
    pub fn revoke(&self, id: &str) -> std::io::Result<bool> {
        let mut entries = self.entries.lock().unwrap();
        let before = entries.len();
        entries.retain(|e| e.id != id);
        let removed = entries.len() != before;
        if removed {
            self.save(&entries)?;
        }
        Ok(removed)
    }

    /// 提示されたトークンが有効か。ハッシュ化してから定数時間比較する。
    pub fn verify(&self, presented: &str) -> bool {
        if !presented.starts_with(TOKEN_PREFIX) {
            return false;
        }
        let presented_hash = hash_hex(presented);
        self.entries
            .lock()
            .unwrap()
            .iter()
            .any(|e| bool::from(presented_hash.as_bytes().ct_eq(e.token_hash.as_bytes())))
    }

    fn save(&self, entries: &[ApiTokenEntry]) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(entries).expect("serialize api tokens");
        std::fs::write(&self.path, json)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(())
    }
}

fn hash_hex(raw: &str) -> String {
    let digest = Sha256::digest(raw.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_verify_revoke_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let store = ApiTokenStore::load(dir.path());

        let (meta, raw) = store.create("Raycast").unwrap();
        assert!(raw.starts_with(TOKEN_PREFIX));
        assert!(store.verify(&raw));
        assert!(!store.verify("ndp_wrong"));
        assert!(!store.verify("totally-different"));

        // 再ロードしても有効 (ファイル永続)
        let reloaded = ApiTokenStore::load(dir.path());
        assert!(reloaded.verify(&raw));
        assert_eq!(reloaded.list().len(), 1);
        assert_eq!(reloaded.list()[0].name, "Raycast");

        // 失効後は無効
        assert!(store.revoke(&meta.id).unwrap());
        assert!(!store.verify(&raw));
        assert!(!store.revoke(&meta.id).unwrap());
    }

    #[test]
    fn corrupt_file_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(TOKENS_FILE), "not json").unwrap();
        let store = ApiTokenStore::load(dir.path());
        assert!(store.list().is_empty());
    }
}
