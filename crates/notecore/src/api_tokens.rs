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
//! 外部アプリ用のトークンはトークン単位の scope と名前を持つ (#1292、GitHub の
//! PAT 式)。scope は PermissionsConfig と同じ形で、実効権限は external の権限との
//! 交差 (`permissions_profile::resolve_scoped`)。名前は確認ダイアログ / Spotlight /
//! メモの著者の帰属に出す。失効は即時で、張りっぱなしの応答 (SSE) も
//! [`ApiTokenStore::until_revoked`] で切る。
//!
//! セキュリティ設計: トークン本体はどこにも保存しない。`api-tokens.json` に
//! は SHA-256 ハッシュとメタデータのみを置き、raw トークンは発行時に一度だけ
//! 返す (GitHub PAT と同じモデル)。OS キーチェーンを使わないのは、Linux
//! バックエンド (kernel keyutils) がセッション単位で再起動時に消えるため。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

const TOKENS_FILE: &str = "api-tokens.json";
/// raw トークンの接頭辞。ログ等で見かけたとき種別を識別できるようにする。
const TOKEN_PREFIX: &str = "ndp_";

/// 最終使用時刻を書き戻す最短間隔。verify のたびに書くとリクエストごとの
/// ファイル書込になるので、この間隔より新しい記録があれば触らない
const LAST_USED_WRITE_INTERVAL_MS: i64 = 60_000;

/// トークンの種別 = 提示されたとき誰として扱うか。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
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
    /// トークン単位の scope (#1292)。PermissionsConfig と同じ形 (正規化は
    /// permissions_profile)。無い (scope 導入前に発行された / harness) は
    /// 絞らない = 種別の principal の権限のまま
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scope: Option<Value>,
    /// 最後に提示された時刻 (UNIX ms)。粒度は LAST_USED_WRITE_INTERVAL_MS
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_used_at_ms: Option<i64>,
}

/// フロントに見せるメタデータ (ハッシュは含めない)。
#[derive(Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ApiTokenMeta {
    pub id: String,
    pub name: String,
    pub created_at_ms: i64,
    pub kind: ApiTokenKind,
    pub scope: Option<Value>,
    pub last_used_at_ms: Option<i64>,
}

impl ApiTokenMeta {
    fn of(e: &ApiTokenEntry) -> Self {
        Self {
            id: e.id.clone(),
            name: e.name.clone(),
            created_at_ms: e.created_at_ms,
            kind: e.kind,
            scope: e.scope.clone(),
            last_used_at_ms: e.last_used_at_ms,
        }
    }
}

/// 提示されたトークンが有効だったときの正体。HTTP 側はこれを request extension
/// (`PersistentTokenMarker`) に載せて下流 (gate / dispatcher / 帰属表示) へ運ぶ
#[derive(Clone, Debug, PartialEq)]
pub struct VerifiedToken {
    pub id: String,
    pub name: String,
    pub kind: ApiTokenKind,
    pub scope: Option<Value>,
}

pub struct ApiTokenStore {
    path: PathBuf,
    entries: Mutex<Vec<ApiTokenEntry>>,
    /// 失効のたびに進む世代。`until_revoked` が購読する
    revoked: tokio::sync::watch::Sender<u64>,
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
            revoked: tokio::sync::watch::Sender::new(0),
        }
    }

    pub fn list(&self) -> Vec<ApiTokenMeta> {
        self.entries
            .lock()
            .unwrap()
            .iter()
            .map(ApiTokenMeta::of)
            .collect()
    }

    /// 新規トークンを発行し、(メタデータ, raw トークン) を返す。
    /// raw はこの戻り値でしか得られない。`scope` は外部アプリ用の
    /// トークン単位の権限 (#1292)。None は絞らない (harness 用など)
    pub fn create(
        &self,
        name: &str,
        kind: ApiTokenKind,
        scope: Option<Value>,
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
            scope,
            last_used_at_ms: None,
        };
        let meta = ApiTokenMeta::of(&entry);
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
            // 通知は保存の成否に関わらず出す: メモリからは消えているので、開いている
            // ストリームも同時に切れないと「verify は拒むのに流れ続ける」になる
            self.revoked.send_modify(|gen| *gen += 1);
            self.save(&entries)?;
        }
        Ok(removed)
    }

    /// 提示されたトークンが有効ならその正体。ハッシュ化してから定数時間比較する。
    /// 最終使用時刻も記録する (間隔を空けて書き戻す)
    pub fn verify(&self, presented: &str) -> Option<VerifiedToken> {
        if !presented.starts_with(TOKEN_PREFIX) {
            return None;
        }
        let presented_hash = hash_hex(presented);
        let mut entries = self.entries.lock().unwrap();
        let entry = entries
            .iter_mut()
            .find(|e| bool::from(presented_hash.as_bytes().ct_eq(e.token_hash.as_bytes())))?;
        let verified = VerifiedToken {
            id: entry.id.clone(),
            name: entry.name.clone(),
            kind: entry.kind,
            scope: entry.scope.clone(),
        };
        let now = now_ms();
        let stale = entry
            .last_used_at_ms
            .is_none_or(|last| now - last >= LAST_USED_WRITE_INTERVAL_MS || now < last);
        if stale {
            entry.last_used_at_ms = Some(now);
            if let Err(e) = self.save(&entries) {
                tracing::warn!(%e, "failed to record api token last use");
            }
        }
        Some(verified)
    }

    /// トークン `id` が失効するまで待つ future (#1292)。張りっぱなしの応答 (SSE)
    /// を失効と同時に切るのに使う。store が落ちたら (サーバー終了) 解決する
    pub async fn until_revoked(&self, id: &str) {
        let mut rx = self.revoked.subscribe();
        loop {
            if !self.entries.lock().unwrap().iter().any(|e| e.id == id) {
                return;
            }
            if rx.changed().await.is_err() {
                return;
            }
        }
    }

    /// 一時ファイル + rename の原子的な書込 (settings_store と同じ)。最終使用の記録で
    /// 書く回数が増えたので、途中で落ちて空のトークン一覧から始まることが無いように
    fn save(&self, entries: &[ApiTokenEntry]) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(entries).expect("serialize api tokens");
        crate::settings_store::atomic_write(&self.path, &json, Some(0o600))
            .map_err(|e| std::io::Error::other(e.to_string()))
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

        let (meta, raw) = store
            .create("Raycast", ApiTokenKind::External, None)
            .unwrap();
        assert!(raw.starts_with(TOKEN_PREFIX));
        let verified = store.verify(&raw).unwrap();
        assert_eq!(verified.kind, ApiTokenKind::External);
        assert_eq!(verified.id, meta.id);
        assert_eq!(verified.name, "Raycast");
        assert_eq!(store.verify("ndp_wrong"), None);
        assert_eq!(store.verify("totally-different"), None);

        // 再ロードしても有効 (ファイル永続)
        let reloaded = ApiTokenStore::load(dir.path());
        assert_eq!(reloaded.verify(&raw).unwrap().kind, ApiTokenKind::External);
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
            .create("AI harness: Claude Agent", ApiTokenKind::Harness, None)
            .unwrap();
        assert_eq!(store.verify(&raw).unwrap().kind, ApiTokenKind::Harness);
        let reloaded = ApiTokenStore::load(dir.path());
        assert_eq!(reloaded.verify(&raw).unwrap().kind, ApiTokenKind::Harness);
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
        let verified = store.verify(&raw).unwrap();
        assert_eq!(verified.kind, ApiTokenKind::External);
        // scope 導入前のトークンは scope 無し (= 外部アプリの権限のまま)
        assert_eq!(verified.scope, None);
        assert_eq!(verified.id, "old");
    }

    /// トークン単位の scope (#1292) は保存され、verify で正体ごと返る。
    /// 最終使用時刻は verify で記録され、再ロード後も残る
    #[test]
    fn scope_and_last_use_are_persisted() {
        let dir = tempfile::tempdir().unwrap();
        let store = ApiTokenStore::load(dir.path());
        let scope = serde_json::json!({ "preset": "custom", "custom": { "notes.write": true } });
        let (meta, raw) = store
            .create("post bot", ApiTokenKind::External, Some(scope.clone()))
            .unwrap();
        assert_eq!(meta.scope, Some(scope.clone()));
        assert_eq!(meta.last_used_at_ms, None);
        assert_eq!(store.verify(&raw).unwrap().scope, Some(scope.clone()));
        let reloaded = ApiTokenStore::load(dir.path());
        let listed = &reloaded.list()[0];
        assert_eq!(listed.scope, Some(scope));
        assert!(
            listed.last_used_at_ms.is_some(),
            "verify が最終使用を書き戻す"
        );
    }

    /// 失効を待つ future は失効で解決し、無関係なトークンの失効では解決しない
    #[tokio::test]
    async fn until_revoked_resolves_on_revocation() {
        let dir = tempfile::tempdir().unwrap();
        let store = std::sync::Arc::new(ApiTokenStore::load(dir.path()));
        let (a, _) = store.create("a", ApiTokenKind::External, None).unwrap();
        let (b, _) = store.create("b", ApiTokenKind::External, None).unwrap();
        let waiter = {
            let store = store.clone();
            let id = a.id.clone();
            tokio::spawn(async move { store.until_revoked(&id).await })
        };
        while store.revoked.receiver_count() == 0 {
            tokio::task::yield_now().await;
        }
        store.revoke(&b.id).unwrap();
        tokio::task::yield_now().await;
        assert!(!waiter.is_finished(), "他のトークンの失効では切れない");
        store.revoke(&a.id).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), waiter)
            .await
            .expect("resolves after revocation")
            .unwrap();
        // 既に無いトークンは即時に解決する
        store.until_revoked("missing").await;
    }

    /// 保存に失敗しても (メモリからは消えているので) 失効の通知は出す
    #[tokio::test]
    async fn revocation_is_notified_even_if_saving_fails() {
        let dir = tempfile::tempdir().unwrap();
        let store = std::sync::Arc::new(ApiTokenStore::load(dir.path()));
        let (a, raw) = store.create("a", ApiTokenKind::External, None).unwrap();
        let waiter = {
            let store = store.clone();
            let id = a.id.clone();
            tokio::spawn(async move { store.until_revoked(&id).await })
        };
        // until_revoked が購読するまで待つ (yield 1 回では実行順序が保証されない)
        while store.revoked.receiver_count() == 0 {
            tokio::task::yield_now().await;
        }
        // 保存先をディレクトリにして書けなくする
        std::fs::remove_file(dir.path().join(TOKENS_FILE)).unwrap();
        std::fs::create_dir(dir.path().join(TOKENS_FILE)).unwrap();
        assert!(store.revoke(&a.id).is_err());
        assert_eq!(store.verify(&raw), None);
        tokio::time::timeout(std::time::Duration::from_secs(2), waiter)
            .await
            .expect("stream waiter wakes up")
            .unwrap();
    }

    #[test]
    fn corrupt_file_starts_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(TOKENS_FILE), "not json").unwrap();
        let store = ApiTokenStore::load(dir.path());
        assert!(store.list().is_empty());
    }
}
