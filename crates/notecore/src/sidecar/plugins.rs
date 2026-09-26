//! プラグイン (`plugins/<slug>.is` + `.meta.json5`) の射影と操作。
//! デバイス側 `src/stores/plugins.ts` と同じ規則。起動 / 停止はデバイスが
//! 変更通知を受けて行う。

use serde_json::{json, Value};
use std::path::Path;

use super::{Item, Kind};
use crate::context::Core;
use crate::edit_history::{Attribution, HistoryEntry};
use crate::error::Result;
use crate::json5_out::J5;
use crate::settings_slug::casefold;
use crate::sidecar::plugin_meta::ParsedPluginMeta;

pub const KIND: Kind = Kind {
    subdir: "plugins",
    id_key: "installId",
    fallback: "plugin",
};

const KEY_ORDER: &[&str] = &[
    "installId",
    "name",
    "version",
    "author",
    "description",
    "permissions",
    "config",
    "configData",
    "active",
    "global",
    "installedFor",
    "storeId",
    "storeSha512",
    "storeVersion",
    "iconUrl",
];

/// `fromFile` の既定値つきの読み出し。
pub trait PluginView {
    fn name(&self) -> String;
    fn version(&self) -> String;
    fn author(&self) -> Option<&str>;
    fn description(&self) -> Option<&str>;
    fn permissions(&self) -> Vec<String>;
    fn active(&self) -> bool;
    fn global(&self) -> bool;
    fn installed_for(&self) -> Vec<String>;
    fn store_id(&self) -> Option<&str>;
    fn store_sha512(&self) -> Option<&str>;
    fn config_data(&self) -> Value;
    fn snapshot(&self) -> Value;
}

impl PluginView for Item {
    fn name(&self) -> String {
        self.str("name")
            .map(str::to_string)
            .unwrap_or_else(|| self.meta_file())
    }
    fn version(&self) -> String {
        self.str("version").unwrap_or("0.0.0").to_string()
    }
    fn author(&self) -> Option<&str> {
        self.str("author")
    }
    fn description(&self) -> Option<&str> {
        self.str("description")
    }
    fn permissions(&self) -> Vec<String> {
        self.list("permissions")
    }
    fn active(&self) -> bool {
        self.bool("active").unwrap_or(false)
    }
    fn global(&self) -> bool {
        self.meta.get("global").map(J5::is_truthy).unwrap_or(false)
    }
    fn installed_for(&self) -> Vec<String> {
        self.list("installedFor")
    }
    fn store_id(&self) -> Option<&str> {
        self.str("storeId")
    }
    fn store_sha512(&self) -> Option<&str> {
        self.str("storeSha512")
    }
    fn config_data(&self) -> Value {
        match self.meta.get("configData") {
            Some(v @ J5::Obj(_)) => v.to_value(),
            _ => json!({}),
        }
    }
    /// 編集履歴の snapshot `{src, name, version, permissions?, active}`。
    fn snapshot(&self) -> Value {
        let mut s = json!({ "src": self.src, "name": self.name(), "version": self.version() });
        if let Some(p) = self.meta.get("permissions") {
            s["permissions"] = p.to_value();
        }
        s["active"] = json!(self.active());
        s
    }
}

/// `toFileMeta`: 規定のキー順に並べ、空の任意項目は出さない。未知のキーは末尾に残す。
pub fn normalize_meta(item: &Item) -> J5 {
    let J5::Obj(pairs) = &item.meta else {
        return J5::Obj(vec![]);
    };
    let mut out: Vec<(String, J5)> = Vec::new();
    out.push(("installId".into(), J5::Str(item.id.clone())));
    out.push(("name".into(), J5::Str(item.name())));
    out.push(("version".into(), J5::Str(item.version())));
    for key in ["author", "description"] {
        if let Some(v) = item.str(key) {
            out.push((key.into(), J5::Str(v.into())));
        }
    }
    if let Some(p) = item
        .meta
        .get("permissions")
        .filter(|p| !p.as_arr().unwrap_or_default().is_empty())
    {
        out.push(("permissions".into(), p.clone()));
    }
    if let Some(c) = item.meta.get("config").filter(|c| c.is_truthy()) {
        out.push(("config".into(), c.clone()));
    }
    out.push((
        "configData".into(),
        match item.meta.get("configData") {
            Some(v @ J5::Obj(_)) => v.clone(),
            _ => J5::Obj(vec![]),
        },
    ));
    out.push(("active".into(), J5::Bool(item.active())));
    if item.global() {
        out.push(("global".into(), J5::Bool(true)));
    }
    if let Some(p) = item
        .meta
        .get("installedFor")
        .filter(|p| !p.as_arr().unwrap_or_default().is_empty())
    {
        out.push(("installedFor".into(), p.clone()));
    }
    for key in ["storeId", "storeSha512", "storeVersion", "iconUrl"] {
        if let Some(v) = item.str(key) {
            out.push((key.into(), J5::Str(v.into())));
        }
    }
    for (k, v) in pairs {
        if !KEY_ORDER.contains(&k.as_str()) {
            out.push((k.clone(), v.clone()));
        }
    }
    J5::Obj(out)
}

pub fn list(core: &Core) -> Result<Vec<Item>> {
    Ok(super::load_all(&super::base_dir(core)?, &KIND))
}

pub fn get(core: &Core, id: &str) -> Result<Option<Item>> {
    Ok(list(core)?.into_iter().find(|p| p.id == id))
}

pub fn find_by_store_id(core: &Core, store_id: &str) -> Result<Option<Item>> {
    Ok(list(core)?
        .into_iter()
        .find(|p| p.store_id() == Some(store_id)))
}

fn write(core: &Core, item: &Item) -> Result<()> {
    super::write_item(
        core,
        &KIND,
        &item.file_base,
        &item.src,
        &normalize_meta(item),
    )
}

pub fn history(dir: &Path, item: &Item) -> Vec<HistoryEntry> {
    super::history(dir, &KIND, &item.file_base)
}

/// `setActive`: フラグだけ書く。起動と停止はデバイスが変更通知で行う。
pub fn set_active(core: &Core, item: &mut Item, active: bool) -> Result<()> {
    item.meta.set("active", J5::Bool(active));
    write(core, item)
}

/// `updateSrc`: src が変わるときだけ編集前を履歴に積み、書く。
pub fn update_src(
    core: &Core,
    item: &mut Item,
    src: &str,
    attribution: Option<&Attribution>,
) -> Result<()> {
    if item.src != src {
        let dir = super::base_dir(core)?;
        super::push_snapshot(
            core,
            &dir,
            &KIND,
            &item.file_base,
            item.snapshot(),
            attribution,
        )?;
    }
    item.src = src.to_string();
    write(core, item)
}

pub fn remove(core: &Core, item: &Item) -> Result<()> {
    super::remove_item(core, &KIND, &item.file_base)
}

/// `applyStoreUpdate`: 本体とストア由来メタを上書きし、新しい config キーだけ
/// configData に default を補う。ローカル値 (name / active / スコープ / configData) は維持。
/// readOnly の個体は配布ソースで復旧する。
pub fn apply_store_update(
    core: &Core,
    item: &mut Item,
    src: &str,
    meta: &ParsedPluginMeta,
    icon_url: Option<&str>,
    hash: &str,
    store_version: &str,
) -> Result<()> {
    if !item.read_only {
        let dir = super::base_dir(core)?;
        super::push_snapshot(core, &dir, &KIND, &item.file_base, item.snapshot(), None)?;
    }
    item.src = src.to_string();
    item.meta.set("version", J5::Str(meta.version.clone()));
    set_opt(&mut item.meta, "author", meta.author.as_deref());
    set_opt(&mut item.meta, "description", meta.description.as_deref());
    match &meta.permissions {
        Some(p) => item.meta.set(
            "permissions",
            J5::Arr(p.iter().map(|s| J5::Str(s.clone())).collect()),
        ),
        None => item.meta.remove("permissions"),
    }
    match &meta.config {
        Some(c) => {
            item.meta
                .set("config", J5::from_value(&Value::Object(c.clone())));
            let mut data = match item.meta.get("configData") {
                Some(v @ J5::Obj(_)) => v.clone(),
                _ => J5::Obj(vec![]),
            };
            for (k, def) in c {
                if data.get(k).is_none() {
                    data.set(
                        k,
                        J5::from_value(def.get("default").unwrap_or(&Value::Null)),
                    );
                }
            }
            item.meta.set("configData", data);
        }
        None => item.meta.remove("config"),
    }
    set_opt(&mut item.meta, "iconUrl", icon_url);
    item.meta.set("storeSha512", J5::Str(hash.into()));
    item.meta.set("storeVersion", J5::Str(store_version.into()));
    item.read_only = false;
    write(core, item)
}

fn set_opt(meta: &mut J5, key: &str, v: Option<&str>) {
    match v {
        Some(s) if !s.is_empty() => meta.set(key, J5::Str(s.into())),
        _ => meta.remove(key),
    }
}

/// `linkGlobalScope`: 全体スコープに入れる (既に入っていれば何もしない)。
pub fn link_global(core: &Core, item: &mut Item) -> Result<()> {
    if item.global() {
        return Ok(());
    }
    item.meta.set("global", J5::Bool(true));
    write(core, item)
}

/// MisStore からの新規インストール (`installPlugin` の新規分岐)。ローカル ID = storeId
/// (占有時は連番)。configData は config の default で埋め、active=true、全体スコープ。
pub fn install_new(
    core: &Core,
    entry_id: &str,
    entry_version: &str,
    icon_url: Option<&str>,
    src: &str,
    meta: &ParsedPluginMeta,
    hash: &str,
) -> Result<Item> {
    let dir = super::base_dir(core)?;
    let all = list(core)?;
    let install_id = crate::settings_slug::resolve_available(entry_id, |c| {
        all.iter().any(|p| casefold(&p.id) == casefold(c))
    });
    let mut config_data: Vec<(String, J5)> = Vec::new();
    if let Some(c) = &meta.config {
        for (k, def) in c {
            config_data.push((
                k.clone(),
                J5::from_value(def.get("default").unwrap_or(&Value::Null)),
            ));
        }
    }
    let mut pairs: Vec<(String, J5)> = vec![
        ("installId".into(), J5::Str(install_id.clone())),
        ("name".into(), J5::Str(meta.name.clone())),
        ("version".into(), J5::Str(meta.version.clone())),
    ];
    if let Some(a) = &meta.author {
        pairs.push(("author".into(), J5::Str(a.clone())));
    }
    if let Some(d) = &meta.description {
        pairs.push(("description".into(), J5::Str(d.clone())));
    }
    if let Some(p) = &meta.permissions {
        pairs.push((
            "permissions".into(),
            J5::Arr(p.iter().map(|s| J5::Str(s.clone())).collect()),
        ));
    }
    if let Some(c) = &meta.config {
        pairs.push(("config".into(), J5::from_value(&Value::Object(c.clone()))));
    }
    pairs.push(("configData".into(), J5::Obj(config_data)));
    pairs.push(("active".into(), J5::Bool(true)));
    pairs.push(("global".into(), J5::Bool(true)));
    pairs.push(("storeId".into(), J5::Str(entry_id.into())));
    pairs.push(("storeSha512".into(), J5::Str(hash.into())));
    pairs.push(("storeVersion".into(), J5::Str(entry_version.into())));
    if let Some(u) = icon_url.filter(|u| !u.is_empty()) {
        pairs.push(("iconUrl".into(), J5::Str(u.into())));
    }
    let mut item = Item {
        id: install_id,
        meta: J5::Obj(pairs),
        src: src.to_string(),
        file_base: String::new(),
        read_only: false,
    };
    item.file_base = super::allocate_base(&dir, &KIND, &meta.name, Some(entry_id), &all);
    write(core, &item)?;
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::tests::temp_core;

    fn put(base: &Path, name: &str, body: &str) {
        std::fs::write(base.join("plugins").join(name), body).unwrap();
    }

    #[test]
    fn projection_defaults_and_key_order() {
        let (_d, core, base) = temp_core();
        put(&base, "p.meta.json5", "{ installId: 'p', configData: { greet: 'hi' }, config: { greet: { type: 'string', label: 'G', default: 'hi' } }, extra: 1, name: 'P', version: '1', global: true, permissions: [] }");
        put(&base, "p.is", "/// @ 0.19.0\n<: 1");
        let mut p = get(&core, "p").unwrap().unwrap();
        assert_eq!(p.name(), "P");
        assert_eq!(p.version(), "1");
        assert!(!p.active());
        assert!(p.global());
        assert_eq!(p.config_data(), json!({ "greet": "hi" }));
        set_active(&core, &mut p, true).unwrap();
        let raw = std::fs::read_to_string(base.join("plugins/p.meta.json5")).unwrap();
        assert_eq!(
            raw,
            "{\n  installId: 'p',\n  name: 'P',\n  version: '1',\n  config: {\n    greet: {\n      type: 'string',\n      label: 'G',\n      default: 'hi',\n    },\n  },\n  configData: {\n    greet: 'hi',\n  },\n  active: true,\n  global: true,\n  extra: 1,\n}"
        );
        // 名前が無ければメタファイル名、version は 0.0.0
        put(&base, "q.meta.json5", "{ installId: 'q' }");
        put(&base, "q.is", "");
        let q = get(&core, "q").unwrap().unwrap();
        assert_eq!(q.name(), "q.meta.json5");
        assert_eq!(q.version(), "0.0.0");
    }

    #[test]
    fn update_src_pushes_history_only_on_change() {
        let (_d, core, base) = temp_core();
        put(
            &base,
            "p.meta.json5",
            "{ installId: 'p', name: 'P', version: '1', active: true, permissions: ['a'] }",
        );
        put(&base, "p.is", "old");
        let mut p = get(&core, "p").unwrap().unwrap();
        update_src(&core, &mut p, "old", None).unwrap();
        assert!(history(&base, &p).is_empty());
        update_src(&core, &mut p, "new", None).unwrap();
        let h = history(&base, &p);
        assert_eq!(h.len(), 1);
        assert_eq!(
            h[0].snapshot,
            json!({ "src": "old", "name": "P", "version": "1", "permissions": ["a"], "active": true })
        );
        assert_eq!(
            std::fs::read_to_string(base.join("plugins/p.is")).unwrap(),
            "new"
        );
        remove(&core, &p).unwrap();
        assert!(get(&core, "p").unwrap().is_none());
        assert!(!base.join("plugins/p.history.json5").exists());
    }

    #[test]
    fn store_update_fills_new_config_defaults_and_keeps_local_values() {
        let (_d, core, base) = temp_core();
        put(&base, "s.meta.json5", "{ installId: 's', name: 'Renamed', version: '1', configData: { greet: 'こんにちは' }, active: true, global: true, storeId: 's', storeSha512: 'x' }");
        put(&base, "s.is", "old");
        let mut s = get(&core, "s").unwrap().unwrap();
        let mut config = serde_json::Map::new();
        config.insert("greet".into(), json!({ "type": "string", "default": "hi" }));
        config.insert(
            "extra".into(),
            json!({ "type": "string", "default": "def" }),
        );
        let meta = ParsedPluginMeta {
            name: "Store Name".into(),
            version: "2".into(),
            permissions: Some(vec!["read:account".into()]),
            config: Some(config),
            ..Default::default()
        };
        apply_store_update(&core, &mut s, "new", &meta, None, "h2", "2").unwrap();
        let s = get(&core, "s").unwrap().unwrap();
        assert_eq!(s.name(), "Renamed");
        assert!(s.active());
        assert!(s.global());
        assert_eq!(s.version(), "2");
        assert_eq!(
            s.config_data(),
            json!({ "greet": "こんにちは", "extra": "def" })
        );
        assert_eq!(s.permissions(), vec!["read:account"]);
        assert_eq!(s.store_sha512(), Some("h2"));
        assert_eq!(history(&base, &s).len(), 1);
    }

    #[test]
    fn install_new_uses_store_id_and_defaults() {
        let (_d, core, base) = temp_core();
        put(
            &base,
            "Hello.meta.json5",
            "{ installId: 'hello', name: 'H', version: '1' }",
        );
        put(&base, "Hello.is", "");
        let mut config = serde_json::Map::new();
        config.insert("msg".into(), json!({ "type": "string", "default": "hi" }));
        let meta = ParsedPluginMeta {
            name: "Hello".into(),
            version: "1.0.0".into(),
            author: Some("alice".into()),
            config: Some(config),
            ..Default::default()
        };
        let item = install_new(
            &core,
            "hello",
            "1.0.0",
            Some("https://i"),
            "src",
            &meta,
            "hash",
        )
        .unwrap();
        assert_eq!(item.id, "hello-2");
        assert_eq!(item.file_base, "hello-2");
        assert!(item.active() && item.global());
        assert_eq!(item.config_data(), json!({ "msg": "hi" }));
        let raw = std::fs::read_to_string(base.join("plugins/hello-2.meta.json5")).unwrap();
        assert!(raw.starts_with("{\n  installId: 'hello-2',\n  name: 'Hello',\n  version: '1.0.0',\n  author: 'alice',\n  config: {"));
        assert!(raw.ends_with("storeId: 'hello',\n  storeSha512: 'hash',\n  storeVersion: '1.0.0',\n  iconUrl: 'https://i',\n}"));
    }
}
