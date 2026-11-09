use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::error::{VaultError, VaultResult};
use super::model::{Connection, ConnectionsFile, PrincipalClass, TrustedPlugin, SCHEMA_VERSION};
use crate::app_dir::Layout;

/// メタデータファイル名。`settings.json5` (フロントが JSON5 パース) とは別系統で、
/// Rust が source of truth として読み書きするため厳密 JSON とする。allowlist
/// (`settings_store::ROOT_FILES`) にも同じ名前で載り、バックアップに入る (#1333 §1)
const CONNECTIONS_FILE: &str = crate::settings_store::CONNECTIONS_FILE;

/// この機械の状態 (`state/connections-meta.json`)。同意 / 鍵の有無 / 時刻は設定では
/// ない (#1333 §4): 別の機械に持ち出しても意味を持たず、持ち出すと「鍵があるはず」
/// 「同意済みのはず」の嘘になる。接続の指紋 (`base_url` / `auth_type` /
/// `allowed_hosts` / `protocol`) を添え、設定側で接続が差し替わっていたら同意を捨てる
const META_FILE: &str = "connections-meta.json";

fn io_err(e: impl std::fmt::Display) -> VaultError {
    VaultError::StoreIo {
        message: e.to_string(),
    }
}

/// `connections.json` の絶対パス (設定)。
fn connections_path(app_dir: &Path) -> PathBuf {
    Layout::from_root(app_dir).config().join(CONNECTIONS_FILE)
}

/// `connections-meta.json` の絶対パス (この機械の状態)。
fn meta_path(app_dir: &Path) -> PathBuf {
    Layout::from_root(app_dir).state().join(META_FILE)
}

/// 設定側に書かない (= state 側に出す) キー (camelCase、ファイル上の名前)
const META_KEYS: &[&str] = &[
    "exposedTo",
    "trustedFor",
    "trustedPlugins",
    "local",
    "slots",
    "lastUsedAt",
    "updatedAt",
    "lastSecretUpdatedAt",
];

/// 接続 1 件分の、この機械の状態
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct MetaEntry {
    /// 同意を結んだ時点の接続の指紋。違えば同意は捨てる
    #[serde(default)]
    fingerprint: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    exposed_to: Vec<PrincipalClass>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    trusted_for: Vec<PrincipalClass>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    trusted_plugins: Vec<TrustedPlugin>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    local: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    slots: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_used_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    last_secret_updated_at: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MetaFile {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    connections: BTreeMap<String, MetaEntry>,
}

/// 接続の指紋。設定側で「同じ id の別の接続」に差し替えられたとき同意が効かないように
fn fingerprint(c: &Connection) -> String {
    let auth = serde_json::to_string(&c.auth_type).unwrap_or_default();
    let protocol = serde_json::to_string(&c.protocol).unwrap_or_default();
    format!(
        "{}|{}|{}|{}",
        c.base_url,
        auth,
        c.allowed_hosts.join(","),
        protocol
    )
}

fn meta_of(c: &Connection) -> MetaEntry {
    MetaEntry {
        fingerprint: fingerprint(c),
        exposed_to: c.exposed_to.clone(),
        trusted_for: c.trusted_for.clone(),
        trusted_plugins: c.trusted_plugins.clone(),
        local: c.local,
        slots: c.slots.clone(),
        last_used_at: c.last_used_at.clone(),
        updated_at: Some(c.updated_at.clone()),
        last_secret_updated_at: c.last_secret_updated_at.clone(),
    }
}

/// state 側の値を接続に載せる。指紋が違えば同意 (開示 / 信頼 / loopback) は捨て、
/// 鍵の有無と時刻だけ残す
fn apply_meta(c: &mut Connection, meta: &MetaEntry) {
    let same = meta.fingerprint == fingerprint(c);
    if same {
        c.exposed_to = meta.exposed_to.clone();
        c.trusted_for = meta.trusted_for.clone();
        c.trusted_plugins = meta.trusted_plugins.clone();
        c.local = meta.local;
    } else {
        tracing::warn!(
            id = %c.id,
            "connection changed since the consent was given; dropping its consent"
        );
        c.exposed_to.clear();
        c.trusted_for.clear();
        c.trusted_plugins.clear();
        c.local = false;
    }
    c.slots = meta.slots.clone();
    c.last_used_at = meta.last_used_at.clone();
    c.last_secret_updated_at = meta.last_secret_updated_at.clone();
    if let Some(u) = &meta.updated_at {
        c.updated_at = u.clone();
    }
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path, what: &str) -> VaultResult<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(io_err)?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(|e| VaultError::StoreIo {
            message: format!("{what} parse error: {e}"),
        })
}

/// `connections.json` (設定) と `connections-meta.json` (状態) を読んで 1 つの
/// [`ConnectionsFile`] にする。設定が無ければ空。
///
/// - 旧 `aiVisible` / `aiTrusted` があれば `exposed_to: [Ai]` / `trusted_for: [Ai]` へ
///   一度きり変換する (#712 §6.1)。**External は誰にも自動付与しない**
/// - 旧形 (同意や鍵の有無が connections.json に同居) なら、読んだ値を state 側へ
///   移して両方を書き直す。state 側に同じ id の記録があればそちらが勝つ
/// - clone 先 (設定だけがある) では同意も鍵も無い接続として立つ。使おうとした時に
///   設定画面が鍵を求める
pub fn load(app_dir: &Path) -> VaultResult<ConnectionsFile> {
    let Some(mut raw) =
        read_json::<serde_json::Value>(&connections_path(app_dir), CONNECTIONS_FILE)?
    else {
        return Ok(ConnectionsFile::default());
    };
    let meta: Option<MetaFile> = read_json(&meta_path(app_dir), META_FILE)?;
    // 旧形の判定: 設定側に state のキーが残っているか
    let mut legacy_inline = false;
    if let Some(arr) = raw.get_mut("connections").and_then(|v| v.as_array_mut()) {
        for c in arr.iter_mut() {
            let Some(obj) = c.as_object_mut() else {
                continue;
            };
            if META_KEYS.iter().any(|k| obj.contains_key(*k)) {
                legacy_inline = true;
            }
            // `updatedAt` は設定側に無い (state 側か created_at)。wire 型では必須のまま
            if !obj.contains_key("updatedAt") {
                let created = obj
                    .get("createdAt")
                    .cloned()
                    .unwrap_or(serde_json::Value::String(String::new()));
                obj.insert("updatedAt".into(), created);
            }
        }
    }
    let mut parsed: ConnectionsFile =
        serde_json::from_value(raw).map_err(|e| VaultError::StoreIo {
            message: format!("{CONNECTIONS_FILE} parse error: {e}"),
        })?;
    let mut needs_save = migrate_legacy_exposure(&mut parsed);
    for conn in &mut parsed.connections {
        match meta.as_ref().and_then(|m| m.connections.get(&conn.id)) {
            Some(entry) => apply_meta(conn, entry),
            None if legacy_inline => {
                // 旧形: 設定側に残っていた値をそのまま state へ (次の save で分離)
            }
            None => {
                // 設定だけがある (clone 先、または state を消した): 同意も鍵も無い
                conn.exposed_to.clear();
                conn.trusted_for.clear();
                conn.trusted_plugins.clear();
                conn.local = false;
                conn.slots.clear();
                conn.last_used_at = None;
                conn.last_secret_updated_at = None;
            }
        }
        if conn.updated_at.is_empty() {
            conn.updated_at = conn.created_at.clone();
        }
    }
    if legacy_inline {
        needs_save = true;
    }
    if needs_save {
        save(app_dir, &parsed)?;
    }
    Ok(parsed)
}

/// 旧 aiVisible / aiTrusted → exposed_to / trusted_for の一度きり変換 (#712)。
/// 変換が発生したら true (= 書き戻しが必要)。External は自動付与しない。
fn migrate_legacy_exposure(file: &mut ConnectionsFile) -> bool {
    let mut migrated = false;
    for conn in &mut file.connections {
        if conn.legacy_ai_visible == Some(true) && !conn.exposed_to.contains(&PrincipalClass::Ai) {
            conn.exposed_to.push(PrincipalClass::Ai);
            migrated = true;
        }
        if conn.legacy_ai_trusted == Some(true) && !conn.trusted_for.contains(&PrincipalClass::Ai) {
            conn.trusted_for.push(PrincipalClass::Ai);
            migrated = true;
        }
        if conn.legacy_ai_visible.is_some() || conn.legacy_ai_trusted.is_some() {
            conn.legacy_ai_visible = None;
            conn.legacy_ai_trusted = None;
            migrated = true;
        }
        // v1.9.1 の plugin クラス一括 trust は個体単位 (trusted_plugins) に移行
        // したため除去する。個体の対応関係は復元できないので単に落とす
        // (= 次回利用時に確認が出る安全側)。
        if conn.trusted_for.contains(&PrincipalClass::Plugin) {
            conn.trusted_for.retain(|c| *c != PrincipalClass::Plugin);
            migrated = true;
        }
    }
    migrated
}

/// `connections.json` を atomic に書き込む。
///
/// 設定 (`connections.json`) と状態 (`connections-meta.json`) に分けて書く。
/// どちらも atomic に置換する (書き込み途中の電源喪失でも壊れない)。設定側は
/// 決定的 (同じ内容なら同じバイト列、#1333 §2)。
pub fn save(app_dir: &Path, file: &ConnectionsFile) -> VaultResult<()> {
    let mut config = serde_json::to_value(file).map_err(io_err)?;
    if let Some(arr) = config.get_mut("connections").and_then(|v| v.as_array_mut()) {
        for c in arr.iter_mut() {
            if let Some(obj) = c.as_object_mut() {
                for k in META_KEYS {
                    obj.remove(*k);
                }
            }
        }
    }
    let meta = MetaFile {
        schema_version: SCHEMA_VERSION,
        connections: file
            .connections
            .iter()
            .map(|c| (c.id.clone(), meta_of(c)))
            .collect(),
    };
    write_atomic(
        &connections_path(app_dir),
        &serde_json::to_string_pretty(&config).map_err(io_err)?,
    )?;
    write_atomic(
        &meta_path(app_dir),
        &serde_json::to_string_pretty(&meta).map_err(io_err)?,
    )?;
    Ok(())
}

fn write_atomic(path: &Path, json: &str) -> VaultResult<()> {
    // リンクなら向き先に書く (dotfiles マネージャのリンクを壊さない、#1333)
    let resolved;
    let path = if fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        resolved = fs::canonicalize(path).map_err(io_err)?;
        resolved.as_path()
    } else {
        path
    };
    let dir = path
        .parent()
        .ok_or_else(|| io_err("connections file has no parent directory"))?;
    fs::create_dir_all(dir).map_err(io_err)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("connections");
    let tmp = dir.join(format!(".{name}.tmp-{}", ulid::Ulid::new()));
    fs::write(&tmp, json).map_err(io_err)?;
    fs::rename(&tmp, path).map_err(|e| {
        // rename 失敗時は一時ファイルを掃除する。
        let _ = fs::remove_file(&tmp);
        io_err(e)
    })?;
    Ok(())
}

/// schemaVersion を検証する。未知バージョンは将来の migration registry で扱う想定。
pub fn check_schema_version(file: &ConnectionsFile) -> VaultResult<()> {
    if file.schema_version > SCHEMA_VERSION {
        return Err(VaultError::StoreIo {
            message: format!(
                "connections.json schemaVersion {} is newer than supported {}",
                file.schema_version, SCHEMA_VERSION
            ),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_file(json: &str) -> ConnectionsFile {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn migrates_ai_visible_to_exposed_ai_without_external() {
        let mut file = legacy_file(
            r#"{
            "schema_version": 1,
            "connections": [{
                "id": "01HZZZZZZZZZZZZZZZZZZZZZZZ",
                "name": "Legacy",
                "baseUrl": "https://example.com",
                "authType": { "kind": "bearer" },
                "aiVisible": true,
                "aiTrusted": true,
                "createdAt": "0",
                "updatedAt": "0"
            }]
        }"#,
        );
        assert!(migrate_legacy_exposure(&mut file));
        let conn = &file.connections[0];
        assert_eq!(conn.exposed_to, vec![PrincipalClass::Ai]);
        assert_eq!(conn.trusted_for, vec![PrincipalClass::Ai]);
        // External は誰にも自動付与しない (#712 §6.1 — 問題 2 の修正そのもの)
        assert!(!conn.exposed_to.contains(&PrincipalClass::External));
        // legacy フィールドはクリアされ再変換されない
        assert_eq!(conn.legacy_ai_visible, None);
        assert!(!migrate_legacy_exposure(&mut file));
    }

    #[test]
    fn new_format_files_are_not_touched() {
        let mut file = legacy_file(
            r#"{
            "schema_version": 1,
            "connections": [{
                "id": "01HZZZZZZZZZZZZZZZZZZZZZZZ",
                "name": "New",
                "baseUrl": "https://example.com",
                "authType": { "kind": "bearer" },
                "exposedTo": ["external"],
                "createdAt": "0",
                "updatedAt": "0"
            }]
        }"#,
        );
        assert!(!migrate_legacy_exposure(&mut file));
        assert_eq!(
            file.connections[0].exposed_to,
            vec![PrincipalClass::External]
        );
    }

    #[test]
    fn ai_visible_false_does_not_expose() {
        let mut file = legacy_file(
            r#"{
            "schema_version": 1,
            "connections": [{
                "id": "01HZZZZZZZZZZZZZZZZZZZZZZZ",
                "name": "Hidden",
                "baseUrl": "https://example.com",
                "authType": { "kind": "bearer" },
                "aiVisible": false,
                "createdAt": "0",
                "updatedAt": "0"
            }]
        }"#,
        );
        // aiVisible:false → 開示なしのまま、legacy フィールドのクリアだけ発生
        assert!(migrate_legacy_exposure(&mut file));
        assert!(file.connections[0].exposed_to.is_empty());
    }

    fn conn_json(extra: &str) -> String {
        format!(
            r#"{{
            "schema_version": 1,
            "connections": [{{
                "id": "01HZZZZZZZZZZZZZZZZZZZZZZZ",
                "name": "C",
                "baseUrl": "https://example.com",
                "authType": {{ "kind": "bearer" }},
                "createdAt": "1"{extra}
            }}]
        }}"#
        )
    }

    /// #1333 §4: 同意 / 鍵の有無 / 時刻は state 側に出て、設定側には残らない
    #[test]
    fn save_splits_consent_and_slots_into_the_state_file() {
        let dir = tempfile::tempdir().unwrap();
        let l = Layout::from_root(dir.path());
        let mut file = legacy_file(&conn_json(
            r#", "updatedAt": "2", "exposedTo": ["ai"], "trustedFor": ["ai"], "slots": ["primary"], "lastUsedAt": "3", "local": true"#,
        ));
        file.connections[0].local = false; // local は https には付かないが、形の検査なので値だけ
        save(dir.path(), &file).unwrap();
        let config = fs::read_to_string(l.config().join(CONNECTIONS_FILE)).unwrap();
        for k in META_KEYS {
            assert!(!config.contains(k), "{k} must not be in connections.json");
        }
        assert!(config.contains("\"baseUrl\""));
        let meta = fs::read_to_string(l.state().join(META_FILE)).unwrap();
        assert!(meta.contains("\"slots\"") && meta.contains("\"exposedTo\""));
        // 読み直すと 1 つに戻る
        let loaded = load(dir.path()).unwrap();
        let c = &loaded.connections[0];
        assert_eq!(c.exposed_to, vec![PrincipalClass::Ai]);
        assert_eq!(c.slots, vec!["primary"]);
        assert_eq!(c.last_used_at.as_deref(), Some("3"));
        assert_eq!(c.updated_at, "2");
        // 設定側は決定的: もう一度書いても同じ
        save(dir.path(), &loaded).unwrap();
        assert_eq!(
            fs::read_to_string(l.config().join(CONNECTIONS_FILE)).unwrap(),
            config
        );
    }

    /// 旧形 (同居) のファイルは最初の読込で分離される
    #[test]
    fn legacy_inline_file_is_split_on_first_load() {
        let dir = tempfile::tempdir().unwrap();
        let l = Layout::from_root(dir.path());
        fs::create_dir_all(l.config()).unwrap();
        fs::write(
            l.config().join(CONNECTIONS_FILE),
            conn_json(r#", "updatedAt": "2", "exposedTo": ["external"], "slots": ["primary"]"#),
        )
        .unwrap();
        let loaded = load(dir.path()).unwrap();
        assert_eq!(
            loaded.connections[0].exposed_to,
            vec![PrincipalClass::External]
        );
        assert_eq!(loaded.connections[0].slots, vec!["primary"]);
        assert!(l.state().join(META_FILE).exists());
        assert!(!fs::read_to_string(l.config().join(CONNECTIONS_FILE))
            .unwrap()
            .contains("exposedTo"));
    }

    /// clone 先 (設定だけ) では同意も鍵も無い。設定側で接続が差し替わっていたら同意を捨てる
    #[test]
    fn config_only_has_no_consent_and_a_changed_fingerprint_drops_consent() {
        let dir = tempfile::tempdir().unwrap();
        let l = Layout::from_root(dir.path());
        let file = legacy_file(&conn_json(
            r#", "updatedAt": "2", "exposedTo": ["ai"], "slots": ["primary"]"#,
        ));
        save(dir.path(), &file).unwrap();
        // state を消す = clone 先
        fs::remove_file(l.state().join(META_FILE)).unwrap();
        let cloned = load(dir.path()).unwrap();
        assert!(cloned.connections[0].exposed_to.is_empty());
        assert!(cloned.connections[0].slots.is_empty());
        // 時刻も state 側なので、無ければ created_at に倒れる
        assert_eq!(cloned.connections[0].updated_at, "1");
        // 同意を結び直してから設定側の base_url を差し替える
        save(dir.path(), &file).unwrap();
        let text = fs::read_to_string(l.config().join(CONNECTIONS_FILE)).unwrap();
        fs::write(
            l.config().join(CONNECTIONS_FILE),
            text.replace("https://example.com", "https://evil.example"),
        )
        .unwrap();
        let swapped = load(dir.path()).unwrap();
        assert!(swapped.connections[0].exposed_to.is_empty());
        // 鍵の有無と時刻は残る
        assert_eq!(swapped.connections[0].slots, vec!["primary"]);
    }
}
