//! プラグイン単位で同意した手元のポートへの `http.fetch` (#1293)。
//!
//! 宣言 (プラグインのヘッダー `loopback: [port, …]`) ∩ 同意 (このファイル) − 常に
//! 拒否するポート、が実際に通る集合。同意は本文の hash に結び、本文が変われば
//! (ストアの更新 / `plugins.update` / 利用者自身の編集 / revert) 失効する。
//!
//! 置き場は `notedeck/loopback/consent.json`。端末固有で、設定バックアップ
//! (`settings_store::export_bundle`) には含めず、汎用のルート書込コマンドからも
//! 触れない (`notemaid/turns/` と同じ扱い)。読みは要求ごとで、キャッシュしない
//! (失効が即時に効く根拠)。
//!
//! hash は `settings_store::content_version` と同じ算法で **Rust だけが計算する**。
//! デバイス (TS) は起動時に本文を渡して hash を受け取り、以後の要求に添える
//! (`body_hash`)。判定は「動かしている hash = ディスクの hash = 同意の hash」の
//! ときだけ通す。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use specta::Type;

use notecli::error::NoteDeckError;

use crate::context::Core;
use crate::error::Result;
use crate::settings_store::content_version;
use crate::sidecar::plugin_meta::parse_plugin_meta;
use crate::sidecar::plugins::{self, PluginView};
use crate::ssrf::{is_always_denied_loopback_port, loopback_port};

/// `notedeck/` 直下のディレクトリ名。`settings_store::ALLOWED_SUBDIRS` に入れない
pub const DIR: &str = "loopback";
const FILE: &str = "consent.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
struct Entry {
    /// 同意したときの本文の hash
    hash: String,
    ports: Vec<u16>,
}

type File = BTreeMap<String, Entry>;

fn path(core: &Core) -> Result<PathBuf> {
    Ok(core.layout()?.config().join(DIR).join(FILE))
}

/// 壊れていれば空 (同意なし) として読む
fn load(core: &Core) -> Result<File> {
    let p = path(core)?;
    let Ok(text) = fs::read_to_string(&p) else {
        return Ok(File::new());
    };
    Ok(parse(&text))
}

fn parse(text: &str) -> File {
    serde_json::from_str::<File>(text).unwrap_or_default()
}

fn save(core: &Core, file: &File) -> Result<()> {
    let p = path(core)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(file)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    fs::rename(&tmp, &p).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    Ok(())
}

/// 本文の hash (TS は計算しない)
pub fn body_hash(content: &str) -> String {
    content_version(content)
}

/// プラグイン 1 個体の宣言と同意の状態 (プラグイン詳細 / 権限ウィンドウ用)
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackConsentStatus {
    /// 今のソースの宣言 (正規化済み)。個体が無ければ空
    pub declared: Vec<u16>,
    /// ディスク上の本文の hash (grant の `expected_hash` に渡す)
    pub hash: String,
    /// 同意済みのポート (宣言にあるものだけ)。stale のときは同意した当時のもの
    pub granted: Vec<u16>,
    /// 同意はあるが本文が変わっていて、次の使用時に再同意になる
    pub stale: bool,
}

/// 権限ウィンドウの一覧の 1 行 (実在する個体だけ)
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackConsentRow {
    pub plugin_id: String,
    pub name: String,
    #[serde(flatten)]
    pub status: LoopbackConsentStatus,
}

/// `http.fetch` の URL の分類 (WebView の dispatcher が確認の要否を決める材料)
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LoopbackClassification {
    /// URL の host が loopback の 3 表記か。false なら他の欄は意味を持たない
    pub loopback: bool,
    pub port: Option<u16>,
    /// 常に拒否するポート (自アプリ / ブラウザが繋がない / 危険なローカルサービス)
    pub always_denied: bool,
    /// 今のソースの宣言にそのポートがある
    pub declared: bool,
    /// 同意済み (ディスクの hash と同意の hash が一致し、ポートが同意にある)
    pub granted: bool,
    /// 動かしている本文がディスクの本文と違う (再起動が要る)
    pub stale: bool,
}

struct Resolved {
    declared: Vec<u16>,
    hash: String,
    entry: Option<Entry>,
}

/// 個体の本文を読み、宣言と同意を引く。個体が無ければ None
fn resolve(core: &Core, plugin_id: &str) -> Result<Option<Resolved>> {
    let Some(item) = plugins::get(core, plugin_id)? else {
        return Ok(None);
    };
    let declared = parse_plugin_meta(&item.src)
        .and_then(|m| m.loopback)
        .unwrap_or_default();
    let hash = body_hash(&item.src);
    let entry = load(core)?.remove(plugin_id);
    Ok(Some(Resolved {
        declared,
        hash,
        entry,
    }))
}

fn status_of(r: &Resolved) -> LoopbackConsentStatus {
    let (granted, stale) = match &r.entry {
        Some(e) => (
            e.ports
                .iter()
                .copied()
                .filter(|p| r.declared.contains(p))
                .collect(),
            e.hash != r.hash,
        ),
        None => (Vec::new(), false),
    };
    LoopbackConsentStatus {
        declared: r.declared.clone(),
        hash: r.hash.clone(),
        granted,
        stale,
    }
}

pub fn status(core: &Core, plugin_id: &str) -> Result<LoopbackConsentStatus> {
    Ok(resolve(core, plugin_id)?
        .map(|r| status_of(&r))
        .unwrap_or_default())
}

/// 同意のある実在の個体を並べる (宣言から消えたポートと、消えた個体は出さない)
pub fn list(core: &Core) -> Result<Vec<LoopbackConsentRow>> {
    let file = load(core)?;
    let mut rows = Vec::new();
    for item in plugins::list(core)? {
        let Some(entry) = file.get(&item.id) else {
            continue;
        };
        let declared = parse_plugin_meta(&item.src)
            .and_then(|m| m.loopback)
            .unwrap_or_default();
        let r = Resolved {
            declared,
            hash: body_hash(&item.src),
            entry: Some(entry.clone()),
        };
        let status = status_of(&r);
        if status.granted.is_empty() {
            continue;
        }
        rows.push(LoopbackConsentRow {
            plugin_id: item.id.clone(),
            name: item.name(),
            status,
        });
    }
    Ok(rows)
}

/// 実際に通る集合: 動かしている本文がディスクと同じで、同意の hash も同じときだけ
/// 宣言 ∩ 同意 − 常に拒否するポート。それ以外は空
pub fn effective_ports(core: &Core, plugin_id: &str, running_hash: &str) -> Result<BTreeSet<u16>> {
    let Some(r) = resolve(core, plugin_id)? else {
        return Ok(BTreeSet::new());
    };
    if r.hash != running_hash {
        return Ok(BTreeSet::new());
    }
    let Some(entry) = r.entry.filter(|e| e.hash == r.hash) else {
        return Ok(BTreeSet::new());
    };
    Ok(entry
        .ports
        .into_iter()
        .filter(|p| r.declared.contains(p) && !is_always_denied_loopback_port(*p))
        .collect())
}

/// URL を分類する。loopback でなければ `loopback: false` だけ
pub fn classify(
    core: &Core,
    url: &str,
    plugin_id: &str,
    running_hash: &str,
) -> Result<LoopbackClassification> {
    let Some(port) = reqwest::Url::parse(url)
        .ok()
        .and_then(|u| loopback_port(&u))
    else {
        return Ok(LoopbackClassification::default());
    };
    let mut out = LoopbackClassification {
        loopback: true,
        port: Some(port),
        always_denied: is_always_denied_loopback_port(port),
        ..Default::default()
    };
    if out.always_denied {
        return Ok(out);
    }
    let Some(r) = resolve(core, plugin_id)? else {
        return Ok(out);
    };
    out.declared = r.declared.contains(&port);
    out.stale = r.hash != running_hash;
    out.granted = r
        .entry
        .as_ref()
        .map(|e| e.hash == r.hash && e.ports.contains(&port))
        .unwrap_or(false);
    Ok(out)
}

/// 同意を記録する。引数は信用しない: 個体が存在する / そのポートが今のソースの
/// 宣言にある / 常に拒否するポートでない / ディスク上の hash が `expected_hash` と
/// 一致する、をすべて確かめ、違えば拒む (確認を見せている間に本文が差し替わる
/// 経路を塞ぐ)。hash が変わる grant では ports をそのポート 1 つに置き直す
pub fn grant(core: &Core, plugin_id: &str, port: u16, expected_hash: &str) -> Result<()> {
    let Some(r) = resolve(core, plugin_id)? else {
        return Err(NoteDeckError::InvalidInput(format!(
            "loopback consent: plugin {plugin_id} does not exist"
        )));
    };
    if is_always_denied_loopback_port(port) || !r.declared.contains(&port) {
        return Err(NoteDeckError::InvalidInput(format!(
            "loopback consent: port {port} is not declared by plugin {plugin_id}"
        )));
    }
    if r.hash != expected_hash {
        return Err(NoteDeckError::InvalidInput(
            "loopback consent: the plugin body changed since the dialog was shown".into(),
        ));
    }
    let mut file = load(core)?;
    let entry = file.entry(plugin_id.to_string()).or_default();
    if entry.hash != r.hash {
        entry.hash = r.hash.clone();
        entry.ports.clear();
    }
    if !entry.ports.contains(&port) {
        entry.ports.push(port);
    }
    save(core, &file)
}

/// 同意を取り消す。個体が消えていても記録は消せる
pub fn revoke(core: &Core, plugin_id: &str, port: u16) -> Result<()> {
    let mut file = load(core)?;
    let Some(entry) = file.get_mut(plugin_id) else {
        return Ok(());
    };
    entry.ports.retain(|p| *p != port);
    if entry.ports.is_empty() {
        file.remove(plugin_id);
    }
    save(core, &file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json5_out::J5;
    use crate::sidecar::test_support::temp_core;
    use crate::sidecar::{write_item, Item};

    fn src(ports: &str, body: &str) -> String {
        format!("/// @ 1.2.1\n### {{\n  name: \"A\"\n  version: \"1\"\n  loopback: {ports}\n}}\n{body}\n")
    }

    fn put(core: &Core, id: &str, src: &str) {
        let meta = J5::Obj(vec![
            ("installId".into(), J5::Str(id.into())),
            ("name".into(), J5::Str("Alpha".into())),
            ("version".into(), J5::Str("1".into())),
            ("active".into(), J5::Bool(true)),
        ]);
        write_item(core, &plugins::KIND, id, src, &meta).unwrap();
        let _: Option<Item> = plugins::get(core, id).unwrap();
    }

    #[test]
    fn grant_requires_declaration_and_the_current_hash() {
        let (_dir, core, _base) = temp_core();
        put(&core, "p1", &src("[8080, 3000]", "<: 1"));
        let st = status(&core, "p1").unwrap();
        assert_eq!(st.declared, vec![8080, 3000]);
        assert!(st.granted.is_empty());
        // 宣言に無いポート / 常に拒否するポート / 古い hash は拒む
        assert!(grant(&core, "p1", 9000, &st.hash).is_err());
        assert!(grant(&core, "p1", 19820, &st.hash).is_err());
        assert!(grant(&core, "p1", 8080, "stale").is_err());
        assert!(grant(&core, "missing", 8080, &st.hash).is_err());
        grant(&core, "p1", 8080, &st.hash).unwrap();
        assert_eq!(status(&core, "p1").unwrap().granted, vec![8080]);
        assert_eq!(
            effective_ports(&core, "p1", &st.hash).unwrap(),
            BTreeSet::from([8080])
        );
        // 動かしている本文が違えば空
        assert!(effective_ports(&core, "p1", "other").unwrap().is_empty());
    }

    #[test]
    fn consent_expires_when_the_body_changes_and_a_new_grant_replaces_ports() {
        let (_dir, core, _base) = temp_core();
        put(&core, "p1", &src("[8080, 3000]", "<: 1"));
        let h1 = status(&core, "p1").unwrap().hash;
        grant(&core, "p1", 8080, &h1).unwrap();
        grant(&core, "p1", 3000, &h1).unwrap();
        // 本文が変わる (宣言は同じ)
        put(&core, "p1", &src("[8080, 3000]", "<: 2"));
        let st = status(&core, "p1").unwrap();
        assert!(st.stale);
        assert_ne!(st.hash, h1);
        assert_eq!(st.granted, vec![8080, 3000]);
        assert!(effective_ports(&core, "p1", &st.hash).unwrap().is_empty());
        let c = classify(&core, "http://localhost:8080/x", "p1", &st.hash).unwrap();
        assert!(c.loopback && c.declared && !c.granted && !c.stale);
        // 新しい本文で 1 つだけ同意し直すと、古い同意は引き継がれない
        grant(&core, "p1", 3000, &st.hash).unwrap();
        let st = status(&core, "p1").unwrap();
        assert!(!st.stale);
        assert_eq!(st.granted, vec![3000]);
    }

    #[test]
    fn classify_distinguishes_every_reason() {
        let (_dir, core, _base) = temp_core();
        put(&core, "p1", &src("[8080]", "<: 1"));
        let h = status(&core, "p1").unwrap().hash;
        assert!(
            !classify(&core, "https://example.com/", "p1", &h)
                .unwrap()
                .loopback
        );
        let self_port = classify(&core, "http://127.0.0.1:19820/api", "p1", &h).unwrap();
        assert!(self_port.loopback && self_port.always_denied && !self_port.declared);
        let undeclared = classify(&core, "http://127.0.0.1:9000/", "p1", &h).unwrap();
        assert!(undeclared.loopback && !undeclared.declared);
        let stale = classify(&core, "http://[::1]:8080/", "p1", "running-old").unwrap();
        assert!(stale.declared && stale.stale && !stale.granted);
        grant(&core, "p1", 8080, &h).unwrap();
        let ok = classify(&core, "http://localhost:8080/", "p1", &h).unwrap();
        assert!(ok.declared && ok.granted && !ok.stale);
        assert_eq!(ok.port, Some(8080));
        // 個体が無ければ宣言なし
        let none = classify(&core, "http://localhost:8080/", "nope", &h).unwrap();
        assert!(none.loopback && !none.declared && !none.granted);
    }

    #[test]
    fn list_shows_only_existing_plugins_and_declared_ports_and_revoke_removes() {
        let (_dir, core, _base) = temp_core();
        put(&core, "p1", &src("[8080, 3000]", "<: 1"));
        let h = status(&core, "p1").unwrap().hash;
        grant(&core, "p1", 8080, &h).unwrap();
        grant(&core, "p1", 3000, &h).unwrap();
        // 別の個体の残骸 (個体が無い) は出ない
        let mut file = load(&core).unwrap();
        file.insert(
            "ghost".into(),
            Entry {
                hash: "x".into(),
                ports: vec![1234],
            },
        );
        save(&core, &file).unwrap();
        // 宣言から 3000 が消えると一覧からも判定からも消える
        put(&core, "p1", &src("[8080]", "<: 1"));
        let rows = list(&core).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].plugin_id, "p1");
        assert_eq!(rows[0].name, "Alpha");
        assert_eq!(rows[0].status.granted, vec![8080]);
        let h2 = rows[0].status.hash.clone();
        assert!(rows[0].status.stale);
        assert!(effective_ports(&core, "p1", &h2).unwrap().is_empty());
        revoke(&core, "p1", 8080).unwrap();
        assert!(list(&core).unwrap().is_empty());
        assert!(status(&core, "p1").unwrap().granted.is_empty());
        // 壊れたファイルは空として読む
        fs::write(path(&core).unwrap(), "{not json").unwrap();
        assert!(load(&core).unwrap().is_empty());
    }
}
