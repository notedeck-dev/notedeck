//! ウィジェット (`widgets/<slug>.is` + `.meta.json5`) の射影と操作。
//! デバイス側 `src/stores/widgets.ts` と同じ規則。表示中の再実行はデバイスが
//! 変更通知を受けて行う。

use serde_json::{json, Value};
use std::path::Path;

use super::{Item, Kind};
use crate::context::Core;
use crate::edit_history::{Attribution, HistoryEntry};
use crate::error::Result;
use crate::json5_out::J5;
use crate::settings_slug::casefold;

pub const KIND: Kind = Kind {
    subdir: "widgets",
    id_key: "installId",
    fallback: "widget",
};

const KEY_ORDER: &[&str] = &[
    "installId",
    "name",
    "autoRun",
    "storeId",
    "storeSha512",
    "storeVersion",
    "iconUrl",
    "accountKey",
    "createdAt",
    "updatedAt",
];

pub trait WidgetView {
    fn name(&self) -> String;
    fn auto_run(&self) -> bool;
    fn store_id(&self) -> Option<&str>;
    fn account_key(&self) -> Option<&str>;
    fn created_at(&self) -> f64;
    fn updated_at(&self) -> f64;
    fn snapshot(&self) -> Value;
}

impl WidgetView for Item {
    fn name(&self) -> String {
        self.str("name")
            .map(str::to_string)
            .unwrap_or_else(|| self.meta_file())
    }
    fn auto_run(&self) -> bool {
        self.bool("autoRun").unwrap_or(false)
    }
    fn store_id(&self) -> Option<&str> {
        self.str("storeId")
    }
    fn account_key(&self) -> Option<&str> {
        self.str("accountKey")
    }
    fn created_at(&self) -> f64 {
        self.num("createdAt").unwrap_or_else(|| now() as f64)
    }
    fn updated_at(&self) -> f64 {
        self.num("updatedAt").unwrap_or_else(|| now() as f64)
    }
    /// 編集履歴の snapshot `{src, name, autoRun}`。
    fn snapshot(&self) -> Value {
        json!({ "src": self.src, "name": self.name(), "autoRun": self.auto_run() })
    }
}

fn now() -> u64 {
    crate::ai_sessions::now_ms()
}

/// `toFileMeta`: 規定のキー順。旧 `accountId` は accountKey があれば書き戻さない。
pub fn normalize_meta(item: &Item) -> J5 {
    let J5::Obj(pairs) = &item.meta else {
        return J5::Obj(vec![]);
    };
    let mut out: Vec<(String, J5)> = vec![
        ("installId".into(), J5::Str(item.id.clone())),
        ("name".into(), J5::Str(item.name())),
        ("autoRun".into(), J5::Bool(item.auto_run())),
    ];
    for key in [
        "storeId",
        "storeSha512",
        "storeVersion",
        "iconUrl",
        "accountKey",
    ] {
        if let Some(v) = item.str(key) {
            out.push((key.into(), J5::Str(v.into())));
        }
    }
    out.push(("createdAt".into(), J5::Num(item.created_at())));
    out.push(("updatedAt".into(), J5::Num(item.updated_at())));
    for (k, v) in pairs {
        if KEY_ORDER.contains(&k.as_str()) {
            continue;
        }
        if k == "accountId" && item.account_key().is_some() {
            continue;
        }
        out.push((k.clone(), v.clone()));
    }
    J5::Obj(out)
}

/// 全件 (createdAt 昇順の安定ソート)。
pub fn list(core: &Core) -> Result<Vec<Item>> {
    let mut items = super::load_all(&super::base_dir(core)?, &KIND);
    items.sort_by(|a, b| a.created_at().total_cmp(&b.created_at()));
    Ok(items)
}

pub fn get(core: &Core, id: &str) -> Result<Option<Item>> {
    Ok(list(core)?.into_iter().find(|w| w.id == id))
}

/// `findWidgetInstance`: storeId × 実行アカウントの組で 1 つ (#1061)。
pub fn find_instance<'a>(
    items: &'a [Item],
    store_id: &str,
    account_key: Option<&str>,
) -> Option<&'a Item> {
    items
        .iter()
        .find(|w| w.store_id() == Some(store_id) && w.account_key() == account_key)
}

/// `listWidgetInstances`: 同じ storeId の全個体。
pub fn instances_of<'a>(items: &'a [Item], store_id: &str) -> Vec<&'a Item> {
    items
        .iter()
        .filter(|w| w.store_id() == Some(store_id))
        .collect()
}

fn write(core: &Core, item: &mut Item) -> Result<()> {
    item.meta.set("updatedAt", J5::Num(now() as f64));
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

pub fn set_auto_run(core: &Core, item: &mut Item, auto_run: bool) -> Result<()> {
    item.meta.set("autoRun", J5::Bool(auto_run));
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

/// `applyStoreUpdate`: 本体とストア由来メタを上書きする (name / autoRun は維持)。
pub fn apply_store_update(
    core: &Core,
    item: &mut Item,
    src: &str,
    icon_url: Option<&str>,
    hash: &str,
    store_version: &str,
) -> Result<()> {
    if !item.read_only {
        let dir = super::base_dir(core)?;
        super::push_snapshot(core, &dir, &KIND, &item.file_base, item.snapshot(), None)?;
    }
    item.src = src.to_string();
    match icon_url.filter(|u| !u.is_empty()) {
        Some(u) => item.meta.set("iconUrl", J5::Str(u.into())),
        None => item.meta.remove("iconUrl"),
    }
    item.meta.set("storeSha512", J5::Str(hash.into()));
    item.meta.set("storeVersion", J5::Str(store_version.into()));
    item.read_only = false;
    write(core, item)
}

/// MisStore からの新規インストール (`installWidget` の新規分岐)。
#[allow(clippy::too_many_arguments)]
pub fn install_new(
    core: &Core,
    entry_id: &str,
    name: &str,
    version: &str,
    auto_run: bool,
    icon_url: Option<&str>,
    account_key: Option<&str>,
    src: &str,
    hash: &str,
) -> Result<Item> {
    let dir = super::base_dir(core)?;
    let all = list(core)?;
    let install_id = crate::settings_slug::resolve_available(entry_id, |c| {
        all.iter().any(|w| casefold(&w.id) == casefold(c))
    });
    let t = now() as f64;
    let mut pairs: Vec<(String, J5)> = vec![
        ("installId".into(), J5::Str(install_id.clone())),
        ("name".into(), J5::Str(name.into())),
        ("autoRun".into(), J5::Bool(auto_run)),
        ("storeId".into(), J5::Str(entry_id.into())),
        ("storeSha512".into(), J5::Str(hash.into())),
        ("storeVersion".into(), J5::Str(version.into())),
    ];
    if let Some(u) = icon_url.filter(|u| !u.is_empty()) {
        pairs.push(("iconUrl".into(), J5::Str(u.into())));
    }
    if let Some(k) = account_key.filter(|k| !k.is_empty()) {
        pairs.push(("accountKey".into(), J5::Str(k.into())));
    }
    pairs.push(("createdAt".into(), J5::Num(t)));
    pairs.push(("updatedAt".into(), J5::Num(t)));
    let mut item = Item {
        id: install_id,
        meta: J5::Obj(pairs),
        src: src.to_string(),
        file_base: String::new(),
        read_only: false,
    };
    item.file_base = super::allocate_base(&dir, &KIND, name, Some(entry_id), &all);
    super::write_item(
        core,
        &KIND,
        &item.file_base,
        &item.src,
        &normalize_meta(&item),
    )?;
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::tests::temp_core;

    fn put(base: &Path, name: &str, body: &str) {
        std::fs::write(base.join("widgets").join(name), body).unwrap();
    }

    #[test]
    fn sorts_by_created_at_and_drops_legacy_account_id() {
        let (_d, core, base) = temp_core();
        put(&base, "a.meta.json5", "{ installId: 'a', name: 'A', autoRun: true, createdAt: 20, updatedAt: 20, accountId: 'uuid', accountKey: 'h:u' }");
        put(&base, "a.is", "");
        put(
            &base,
            "b.meta.json5",
            "{ installId: 'b', name: 'B', createdAt: 10, updatedAt: 10, accountId: 'uuid' }",
        );
        put(&base, "b.is", "");
        let ids: Vec<String> = list(&core).unwrap().into_iter().map(|w| w.id).collect();
        assert_eq!(ids, vec!["b", "a"]);
        let mut a = get(&core, "a").unwrap().unwrap();
        set_auto_run(&core, &mut a, false).unwrap();
        let raw = std::fs::read_to_string(base.join("widgets/a.meta.json5")).unwrap();
        assert!(raw.starts_with("{\n  installId: 'a',\n  name: 'A',\n  autoRun: false,\n  accountKey: 'h:u',\n  createdAt: 20,\n  updatedAt: "));
        assert!(!raw.contains("accountId"));
        // accountKey が無い旧個体は accountId を残す (デバイスの移行が読む)
        let mut b = get(&core, "b").unwrap().unwrap();
        update_src(&core, &mut b, "x", None).unwrap();
        let raw = std::fs::read_to_string(base.join("widgets/b.meta.json5")).unwrap();
        assert!(raw.contains("accountId: 'uuid'"));
        assert_eq!(
            history(&base, &b)[0].snapshot,
            json!({ "src": "", "name": "B", "autoRun": false })
        );
    }

    #[test]
    fn instances_by_store_and_account() {
        let (_d, core, base) = temp_core();
        put(&base, "w.meta.json5", "{ installId: 'w', name: 'W', autoRun: false, storeId: 'clock', createdAt: 1, updatedAt: 1 }");
        put(&base, "w.is", "");
        put(&base, "w2.meta.json5", "{ installId: 'w2', name: 'W', autoRun: false, storeId: 'clock', accountKey: 'h:u', createdAt: 2, updatedAt: 2 }");
        put(&base, "w2.is", "");
        let all = list(&core).unwrap();
        assert_eq!(find_instance(&all, "clock", None).unwrap().id, "w");
        assert_eq!(find_instance(&all, "clock", Some("h:u")).unwrap().id, "w2");
        assert!(find_instance(&all, "clock", Some("h:v")).is_none());
        assert_eq!(instances_of(&all, "clock").len(), 2);
        let item = install_new(
            &core,
            "clock",
            "Clock",
            "1.0",
            true,
            None,
            Some("h:v"),
            "src",
            "hash",
        )
        .unwrap();
        assert_eq!(item.id, "clock");
        assert_eq!(item.file_base, "clock");
        assert_eq!(item.account_key(), Some("h:v"));
        assert!(item.auto_run());
    }
}
