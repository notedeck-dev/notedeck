//! ファイル backend の credential store (notedeck#1106 §9)。
//!
//! Linux で secret-service (gnome-keyring / KWallet) が使えない環境 (headless サーバー /
//! WSL2 / コンテナ) 向け。以前はカーネル keyutils に劣化していたが、keyutils は再起動で
//! 消える (`UntilReboot`) ため DB の平文トークンが実質の正本になっていた (notedeck#785)。
//! この store は再起動をまたいで永続する (`UntilDelete`) ので、DB 側の平文は消せる。
//!
//! - 鍵: `{config_dir}/notecli/secret.key` (32 byte、0600)
//! - 本体: `{data_dir}/notecli/secrets.enc` (XChaCha20-Poly1305、鍵とは別ディレクトリ)
//!
//! 鍵と本体を別ディレクトリに置くのは、データディレクトリだけのバックアップやコピーに
//! 鍵が混ざらないようにするため。同一マシンの同一ユーザーに対しては平文相当で、
//! OS キーチェーン相当の保護 (他プロセスからの隔離) は無い。
//!
//! 本体は read-modify-write なので、notedeck と notecli CLI が同時に書く可能性に備えて
//! ロックファイルで排他する。

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use keyring_core::api::{CredentialApi, CredentialPersistence, CredentialStoreApi};
use keyring_core::{Credential, Entry, Error, Result};

/// ファイル先頭のフォーマット識別子。形式を変えるときはここを上げる。
const MAGIC: &[u8; 4] = b"NDK1";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;

/// service → user → secret
type Secrets = BTreeMap<String, BTreeMap<String, Vec<u8>>>;

struct Inner {
    key_path: PathBuf,
    data_path: PathBuf,
    /// プロセス内の排他。プロセス間はロックファイル (`data_path` + ".lock") で行う
    lock: Mutex<()>,
}

pub struct Store {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileStore")
            .field("key_path", &self.inner.key_path)
            .field("data_path", &self.inner.data_path)
            .finish()
    }
}

impl Store {
    /// 既定の置き場 (`{config_dir}/notecli/secret.key` と `{data_dir}/notecli/secrets.enc`)
    /// で開く。鍵が無ければ生成する。鍵を用意できなければ Err。
    pub fn new() -> Result<Arc<Self>> {
        let config_dir =
            dirs::config_dir().ok_or_else(|| Error::NoStorageAccess("no config dir".into()))?;
        let data_dir =
            dirs::data_dir().ok_or_else(|| Error::NoStorageAccess("no data dir".into()))?;
        Self::with_paths(
            &config_dir.join("notecli").join("secret.key"),
            &data_dir.join("notecli").join("secrets.enc"),
        )
    }

    /// 置き場を指定して開く (テスト用 / 将来の設定用)。鍵が無ければ生成する。
    pub fn with_paths(key_path: &Path, data_path: &Path) -> Result<Arc<Self>> {
        let inner = Inner {
            key_path: key_path.to_path_buf(),
            data_path: data_path.to_path_buf(),
            lock: Mutex::new(()),
        };
        // 鍵の生成 (または読み取り) を済ませてから返す = 書けない環境はここで Err
        inner.load_or_create_key()?;
        Ok(Arc::new(Self {
            inner: Arc::new(inner),
        }))
    }
}

impl CredentialStoreApi for Store {
    fn vendor(&self) -> String {
        "notecli file store (XChaCha20-Poly1305)".to_string()
    }

    fn id(&self) -> String {
        self.inner.data_path.display().to_string()
    }

    fn build(
        &self,
        service: &str,
        user: &str,
        _modifiers: Option<&std::collections::HashMap<&str, &str>>,
    ) -> Result<Entry> {
        Ok(Entry::new_with_credential(Arc::new(Cred {
            inner: self.inner.clone(),
            service: service.to_string(),
            user: user.to_string(),
        })))
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn persistence(&self) -> CredentialPersistence {
        CredentialPersistence::UntilDelete
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

struct Cred {
    inner: Arc<Inner>,
    service: String,
    user: String,
}

impl std::fmt::Debug for Cred {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FileCred")
            .field("service", &self.service)
            .field("user", &self.user)
            .finish()
    }
}

impl CredentialApi for Cred {
    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        if secret.is_empty() {
            return Err(Error::Invalid(
                "secret".to_string(),
                "cannot be empty".to_string(),
            ));
        }
        self.inner.update(|secrets| {
            secrets
                .entry(self.service.clone())
                .or_default()
                .insert(self.user.clone(), secret.to_vec());
            Ok(())
        })
    }

    fn get_secret(&self) -> Result<Vec<u8>> {
        let _guard = self.inner.lock_all()?;
        let secrets = self.inner.load()?;
        secrets
            .get(&self.service)
            .and_then(|users| users.get(&self.user))
            .cloned()
            .ok_or(Error::NoEntry)
    }

    fn delete_credential(&self) -> Result<()> {
        self.inner.update(|secrets| {
            let removed = secrets
                .get_mut(&self.service)
                .and_then(|users| users.remove(&self.user))
                .is_some();
            if let Some(users) = secrets.get(&self.service) {
                if users.is_empty() {
                    secrets.remove(&self.service);
                }
            }
            if removed {
                Ok(())
            } else {
                Err(Error::NoEntry)
            }
        })
    }

    fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
        self.get_secret()?;
        Ok(None)
    }

    fn get_specifiers(&self) -> Option<(String, String)> {
        Some((self.service.clone(), self.user.clone()))
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

/// プロセス内 Mutex + プロセス間ロックファイルの両方を保持する guard
struct AllLocks<'a> {
    _process: std::sync::MutexGuard<'a, ()>,
    _file: File,
}

impl Inner {
    fn lock_all(&self) -> Result<AllLocks<'_>> {
        let process = self
            .lock
            .lock()
            .map_err(|_| Error::PlatformFailure("file store mutex poisoned".into()))?;
        ensure_private_dir(parent(&self.data_path)?)?;
        let lock_path = self.data_path.with_extension("enc.lock");
        let file = open_private(&lock_path, false)?;
        file.lock().map_err(io_err)?;
        Ok(AllLocks {
            _process: process,
            _file: file,
        })
    }

    /// 排他の中で load → 変更 → save する
    fn update(&self, f: impl FnOnce(&mut Secrets) -> Result<()>) -> Result<()> {
        let _guard = self.lock_all()?;
        let mut secrets = self.load()?;
        f(&mut secrets)?;
        self.save(&secrets)
    }

    fn load_or_create_key(&self) -> Result<[u8; KEY_LEN]> {
        let dir = parent(&self.key_path)?;
        ensure_private_dir(dir)?;
        match fs::read(&self.key_path) {
            Ok(bytes) => bytes.as_slice().try_into().map_err(|_| {
                Error::BadStoreFormat(format!(
                    "{}: expected {KEY_LEN}-byte key, got {} bytes",
                    self.key_path.display(),
                    bytes.len()
                ))
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let key: [u8; KEY_LEN] = rand::random();
                // create_new で同時生成の競合を検出し、負けた側は相手の鍵を読む
                match open_private(&self.key_path, true) {
                    Ok(mut f) => {
                        f.write_all(&key).map_err(io_err)?;
                        f.sync_all().map_err(io_err)?;
                        Ok(key)
                    }
                    Err(Error::NoStorageAccess(e))
                        if e.downcast_ref::<std::io::Error>()
                            .is_some_and(|e| e.kind() == std::io::ErrorKind::AlreadyExists) =>
                    {
                        self.load_or_create_key()
                    }
                    Err(e) => Err(e),
                }
            }
            Err(e) => Err(io_err(e)),
        }
    }

    fn load(&self) -> Result<Secrets> {
        let raw = match fs::read(&self.data_path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Secrets::new()),
            Err(e) => return Err(io_err(e)),
        };
        let bad = |why: &str| Error::BadStoreFormat(format!("{}: {why}", self.data_path.display()));
        if raw.len() < MAGIC.len() + NONCE_LEN || &raw[..MAGIC.len()] != MAGIC {
            return Err(bad("not a notecli secrets file"));
        }
        let (nonce, ciphertext) = raw[MAGIC.len()..].split_at(NONCE_LEN);
        let key = self.load_or_create_key()?;
        let plaintext = XChaCha20Poly1305::new((&key).into())
            .decrypt(XNonce::from_slice(nonce), ciphertext)
            .map_err(|_| bad("decryption failed (wrong key or tampered file)"))?;
        serde_json::from_slice(&plaintext).map_err(|e| bad(&format!("bad payload: {e}")))
    }

    fn save(&self, secrets: &Secrets) -> Result<()> {
        let key = self.load_or_create_key()?;
        let plaintext =
            serde_json::to_vec(secrets).map_err(|e| Error::PlatformFailure(Box::new(e)))?;
        let nonce: [u8; NONCE_LEN] = rand::random();
        let ciphertext = XChaCha20Poly1305::new((&key).into())
            .encrypt(XNonce::from_slice(&nonce), plaintext.as_slice())
            .map_err(|_| Error::PlatformFailure("encryption failed".into()))?;

        // 一時ファイルに書いて rename: 途中で落ちても旧内容が残る
        let tmp_path = self.data_path.with_extension("enc.tmp");
        let mut f = open_private(&tmp_path, false)?;
        f.set_len(0).map_err(io_err)?;
        f.write_all(MAGIC).map_err(io_err)?;
        f.write_all(&nonce).map_err(io_err)?;
        f.write_all(&ciphertext).map_err(io_err)?;
        f.sync_all().map_err(io_err)?;
        drop(f);
        fs::rename(&tmp_path, &self.data_path).map_err(io_err)
    }
}

fn parent(path: &Path) -> Result<&Path> {
    path.parent()
        .ok_or_else(|| Error::NoStorageAccess(format!("{}: no parent dir", path.display()).into()))
}

fn ensure_private_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).map_err(io_err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(io_err)?;
    }
    Ok(())
}

/// 0600 で開く (無ければ作る)。`create_new` なら既存ファイルがあると AlreadyExists。
fn open_private(path: &Path, create_new: bool) -> Result<File> {
    let mut opts = OpenOptions::new();
    opts.read(true).write(true);
    if create_new {
        opts.create_new(true);
    } else {
        opts.create(true).truncate(false);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let file = opts.open(path).map_err(io_err)?;
    #[cfg(unix)]
    {
        // 既存ファイルの mode は open では変わらないので明示的に締める
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(io_err)?;
    }
    Ok(file)
}

fn io_err(e: std::io::Error) -> Error {
    Error::NoStorageAccess(Box::new(e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (tempfile::TempDir, Arc<Store>) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::with_paths(
            &dir.path().join("config").join("secret.key"),
            &dir.path().join("data").join("secrets.enc"),
        )
        .unwrap();
        (dir, store)
    }

    fn entry(store: &Store, user: &str) -> Entry {
        store.build("notedeck", user, None).unwrap()
    }

    #[test]
    fn roundtrip_set_get_delete() {
        let (_dir, store) = temp_store();
        let e = entry(&store, "acc-1");
        assert!(matches!(e.get_password(), Err(Error::NoEntry)));
        e.set_password("s3cret").unwrap();
        assert_eq!(e.get_password().unwrap(), "s3cret");
        e.set_password("rotated").unwrap();
        assert_eq!(e.get_password().unwrap(), "rotated");
        e.delete_credential().unwrap();
        assert!(matches!(e.get_password(), Err(Error::NoEntry)));
        assert!(matches!(e.delete_credential(), Err(Error::NoEntry)));
    }

    #[test]
    fn entries_are_isolated_by_service_and_user() {
        let (_dir, store) = temp_store();
        entry(&store, "a").set_password("A").unwrap();
        entry(&store, "b").set_password("B").unwrap();
        store
            .build("other", "a", None)
            .unwrap()
            .set_password("O")
            .unwrap();
        assert_eq!(entry(&store, "a").get_password().unwrap(), "A");
        assert_eq!(entry(&store, "b").get_password().unwrap(), "B");
        assert_eq!(
            store
                .build("other", "a", None)
                .unwrap()
                .get_password()
                .unwrap(),
            "O"
        );
    }

    #[test]
    fn persists_across_store_instances() {
        let dir = tempfile::tempdir().unwrap();
        let key = dir.path().join("config").join("secret.key");
        let data = dir.path().join("data").join("secrets.enc");
        Store::with_paths(&key, &data)
            .unwrap()
            .build("notedeck", "acc", None)
            .unwrap()
            .set_password("keep")
            .unwrap();
        let reopened = Store::with_paths(&key, &data).unwrap();
        assert_eq!(entry(&reopened, "acc").get_password().unwrap(), "keep");
        assert!(matches!(
            reopened.persistence(),
            CredentialPersistence::UntilDelete
        ));
    }

    #[test]
    fn rejects_empty_secret() {
        let (_dir, store) = temp_store();
        assert!(matches!(
            entry(&store, "acc").set_password(""),
            Err(Error::Invalid(..))
        ));
    }

    #[test]
    fn data_is_unreadable_with_a_different_key() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data").join("secrets.enc");
        Store::with_paths(&dir.path().join("k1").join("secret.key"), &data)
            .unwrap()
            .build("notedeck", "acc", None)
            .unwrap()
            .set_password("hidden")
            .unwrap();
        let raw = fs::read(&data).unwrap();
        assert!(
            !raw.windows(6).any(|w| w == b"hidden"),
            "secret must not be stored in plaintext"
        );
        let other = Store::with_paths(&dir.path().join("k2").join("secret.key"), &data).unwrap();
        assert!(matches!(
            entry(&other, "acc").get_password(),
            Err(Error::BadStoreFormat(_))
        ));
    }

    #[test]
    fn tampered_file_is_rejected() {
        let (dir, store) = temp_store();
        entry(&store, "acc").set_password("x").unwrap();
        let data = dir.path().join("data").join("secrets.enc");
        let mut raw = fs::read(&data).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0xff;
        fs::write(&data, raw).unwrap();
        assert!(matches!(
            entry(&store, "acc").get_password(),
            Err(Error::BadStoreFormat(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn key_and_data_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, store) = temp_store();
        entry(&store, "acc").set_password("x").unwrap();
        for (path, expected) in [
            (dir.path().join("config").join("secret.key"), 0o600),
            (dir.path().join("data").join("secrets.enc"), 0o600),
            (dir.path().join("config"), 0o700),
            (dir.path().join("data"), 0o700),
        ] {
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, expected, "{}", path.display());
        }
    }
}
