//! 別プロセスの notemaid が持つ口座の所在 (#1106 案 B)。接続したアプリが `notemaid.accounts` で
//! 写した一覧をメモリに持ち、アプリが閉じていても使えるよう小さなファイル (0600) にも置く。
//! トークン列はアプリの DB の写しで、キーチェーンが使える環境では空。SQLite は開かない。

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use notecli::models::Account;
use notecore::accounts::AccountStore;
use notecore::error::Result;

pub const FILE_NAME: &str = "notemaid-accounts.json";

pub struct SyncedAccounts {
    path: PathBuf,
    rows: RwLock<Vec<Account>>,
}

impl SyncedAccounts {
    pub fn load(data_dir: &Path) -> Self {
        let path = data_dir.join(FILE_NAME);
        let rows = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<Account>>(&b).ok())
            .unwrap_or_default();
        Self {
            path,
            rows: RwLock::new(rows),
        }
    }

    /// アプリからの写しで置き換える。一覧に無い口座は消える。書けなくてもメモリは更新する
    pub fn replace(&self, accounts: Vec<Account>) -> Result<usize> {
        let n = accounts.len();
        let body = serde_json::to_vec(&accounts)
            .map_err(|e| notecli::error::NoteDeckError::Internal(e.to_string()))?;
        *self.rows.write().unwrap_or_else(|e| e.into_inner()) = accounts;
        if let Err(e) = write_private(&self.path, &body) {
            tracing::warn!(path = %self.path.display(), "account snapshot write failed: {e}");
        }
        Ok(n)
    }

    /// 今の写しにある口座 id。
    pub fn ids(&self) -> Vec<String> {
        self.rows
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .map(|a| a.id.clone())
            .collect()
    }

    pub fn len(&self) -> usize {
        self.rows.read().map(|r| r.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

fn write_private(path: &Path, body: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("json.tmp");
    {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        use std::io::Write;
        let mut f = opts.open(&tmp)?;
        f.write_all(body)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)
}

impl AccountStore for SyncedAccounts {
    fn get(&self, id: &str) -> Result<Option<Account>> {
        Ok(self
            .rows
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .find(|a| a.id == id)
            .cloned())
    }

    fn list(&self) -> Result<Vec<Account>> {
        Ok(self.rows.read().unwrap_or_else(|e| e.into_inner()).clone())
    }

    fn clear_token(&self, _id: &str) -> Result<()> {
        // 写しは次の同期で置き換わる。ここでは消さない (アプリ側の DB が正本)
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acc(id: &str) -> Account {
        Account {
            id: id.into(),
            host: "example.com".into(),
            token: String::new(),
            user_id: "u".into(),
            username: "n".into(),
            display_name: None,
            avatar_url: None,
            software: "misskey".into(),
        }
    }

    #[test]
    fn replace_persists_and_reloads() {
        let dir = tempfile::tempdir().unwrap();
        let store = SyncedAccounts::load(dir.path());
        assert!(store.is_empty());
        store.replace(vec![acc("a"), acc("b")]).unwrap();
        assert_eq!(store.get("a").unwrap().unwrap().host, "example.com");
        let again = SyncedAccounts::load(dir.path());
        assert_eq!(again.len(), 2);
        again.replace(vec![acc("b")]).unwrap();
        assert!(again.get("a").unwrap().is_none());
    }
}
