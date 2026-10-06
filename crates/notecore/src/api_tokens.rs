//! 永続 API トークン (#709)。
//!
//! 外部アプリ (MCP / Raycast / 外部 AI エージェント等) が再起動を跨いで
//! HTTP API (port 19820) を使うための名前付きトークン。起動毎に再生成される
//! ephemeral トークン (`api-token` ファイル) と併存する。
//!
//! トークンには種別 ([`ApiTokenKind`]) があり、HTTP 側はそれで権限の principal を
//! 決める: 権限ウィンドウで発行した外部アプリ用は `external`、NoteDeck 自身が AI
//! として起動した手元の CLI (#1104) に渡す harness 用は `ai.chat` (#1188)。
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

/// トークンの種別 = 提示されたとき誰として扱うか。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ApiTokenKind {
    /// 権限ウィンドウで発行した外部アプリ用。external principal (第三者) で解決する
    #[default]
    External,
    /// NoteDeck が AI として起動した手元の CLI (ACP、#1104) に MCP サーバーを渡すための
    /// もの。CLI は利用者が選んだ AI 本人なので ai.chat principal で解決する (#1188)。
    /// 第三者向けの恒久 deny (記憶 / skill / persona の書込など) を受けない
    Harness,
}

impl ApiTokenKind {
    /// 権限解決に使う principal
    pub fn principal(self) -> crate::permissions_profile::PrincipalId {
        match self {
            Self::External => crate::permissions_profile::PrincipalId::External,
            Self::Harness => crate::permissions_profile::PrincipalId::AiChat,
        }
    }
}

/// 保存されるエントリ (ハッシュ込み)。ファイル内部表現。
#[derive(Clone, Serialize, Deserialize)]
struct ApiTokenEntry {
    id: String,
    name: String,
    /// SHA-256(raw token) の hex
    token_hash: String,
    created_at_ms: i64,
    /// 種別。無い (種別導入前に発行された) エントリは external
    #[serde(default)]
    kind: ApiTokenKind,
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
    pub fn create(
        &self,
        name: &str,
        kind: ApiTokenKind,
    ) -> std::io::Result<(ApiTokenMeta, String)> {
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
            kind,
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

    /// 提示されたトークンが有効ならその種別。ハッシュ化してから定数時間比較する。
    pub fn verify(&self, presented: &str) -> Option<ApiTokenKind> {
        if !presented.starts_with(TOKEN_PREFIX) {
            return None;
        }
        let presented_hash = hash_hex(presented);
        self.entries
            .lock()
            .unwrap()
            .iter()
            .find(|e| bool::from(presented_hash.as_bytes().ct_eq(e.token_hash.as_bytes())))
            .map(|e| e.kind)
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

        let (meta, raw) = store.create("Raycast", ApiTokenKind::External).unwrap();
        assert!(raw.starts_with(TOKEN_PREFIX));
        assert_eq!(store.verify(&raw), Some(ApiTokenKind::External));
        assert_eq!(store.verify("ndp_wrong"), None);
        assert_eq!(store.verify("totally-different"), None);

        // 再ロードしても有効 (ファイル永続)
        let reloaded = ApiTokenStore::load(dir.path());
        assert_eq!(reloaded.verify(&raw), Some(ApiTokenKind::External));
        assert_eq!(reloaded.list().len(), 1);
        assert_eq!(reloaded.list()[0].name, "Raycast");

        // 失効後は無効
        assert!(store.revoke(&meta.id).unwrap());
        assert_eq!(store.verify(&raw), None);
        assert!(!store.revoke(&meta.id).unwrap());
    }

    /// 手元の CLI (#1104) 用のトークンは種別ごと保存され、AI 本人 (ai.chat) として
    /// 解決される (#1188: external 扱いだと記憶 / skill の書込が恒久 deny で袋小路)
    #[test]
    fn harness_tokens_keep_their_kind_and_resolve_as_the_ai() {
        let dir = tempfile::tempdir().unwrap();
        let store = ApiTokenStore::load(dir.path());
        let (_, raw) = store
            .create("AI harness: Claude Agent", ApiTokenKind::Harness)
            .unwrap();
        assert_eq!(store.verify(&raw), Some(ApiTokenKind::Harness));
        let reloaded = ApiTokenStore::load(dir.path());
        assert_eq!(reloaded.verify(&raw), Some(ApiTokenKind::Harness));
        assert_eq!(
            ApiTokenKind::Harness.principal(),
            crate::permissions_profile::PrincipalId::AiChat
        );
        assert_eq!(
            ApiTokenKind::External.principal(),
            crate::permissions_profile::PrincipalId::External
        );
    }

    /// 種別導入前の api-tokens.json (kind 無し) は external として読む
    #[test]
    fn entries_without_kind_are_external() {
        let dir = tempfile::tempdir().unwrap();
        let raw = format!("{TOKEN_PREFIX}legacy");
        let legacy = serde_json::json!([{
            "id": "old",
            "name": "Raycast",
            "token_hash": hash_hex(&raw),
            "created_at_ms": 1,
        }]);
        std::fs::write(dir.path().join(TOKENS_FILE), legacy.to_string()).unwrap();
        let store = ApiTokenStore::load(dir.path());
        assert_eq!(store.verify(&raw), Some(ApiTokenKind::External));
    }

    #[test]
    fn corrupt_file_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(TOKENS_FILE), "not json").unwrap();
        let store = ApiTokenStore::load(dir.path());
        assert!(store.list().is_empty());
    }
}
