//! 口座の所在 (#1106 案 B)。資格情報の解決 (`credentials`) と口座一覧は、この trait だけを
//! 見る。アプリでは notecli.db (`Database`) がそのまま実装し、別プロセスの notemaid では
//! 接続したアプリから写した一覧 (メモリ + 小さなファイル) が実装する。notemaid が SQLite を
//! 開かずに済むのはこの境界のおかげ。

use std::sync::Arc;

use notecli::db::Database;
use notecli::models::Account;

use crate::error::Result;

pub trait AccountStore: Send + Sync + 'static {
    fn get(&self, id: &str) -> Result<Option<Account>>;
    fn list(&self) -> Result<Vec<Account>>;
    /// トークンを keychain へ移せたので、こちらが持つ写しを消す (持たない実装は no-op)
    fn clear_token(&self, id: &str) -> Result<()>;
}

impl AccountStore for Database {
    fn get(&self, id: &str) -> Result<Option<Account>> {
        self.get_account(id)
    }

    fn list(&self) -> Result<Vec<Account>> {
        self.load_accounts()
    }

    fn clear_token(&self, id: &str) -> Result<()> {
        Database::clear_token(self, id)
    }
}

impl<T: AccountStore + ?Sized> AccountStore for Arc<T> {
    fn get(&self, id: &str) -> Result<Option<Account>> {
        (**self).get(id)
    }

    fn list(&self) -> Result<Vec<Account>> {
        (**self).list()
    }

    fn clear_token(&self, id: &str) -> Result<()> {
        (**self).clear_token(id)
    }
}
