//! ウィジェット (`widgets/<slug>.is` + `.meta.json5`) の射影と操作。
//! デバイス側 `src/services/distributableCodecs/widgetCodec.ts` と同じ規則
//! (golden で固定)。表示中の再実行はデバイスが変更通知を受けて行う。
//!
//! 本体は紐付け配列 (`global` / `installedFor`) で共有する (#1202 決定 (b))。
//! 旧形式 (`accountKey` = 1 アカウントに固定) は読めて `installedFor` に写す。
//! 実行アカウントはデバイスの配置が持つので、ここには無い。

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
    "global",
    "installedFor",
    "createdAt",
    "updatedAt",
];

pub trait WidgetView {
    fn name(&self) -> String;
    fn auto_run(&self) -> bool;
    fn store_id(&self) -> Option<&str>;
    /// 全体スコープ (どのアカウントのカラムでも選べる)。
    fn global(&self) -> bool;
    /// アカウント別の参加先 (`accountScopeKey` の配列)。
    fn installed_for(&self) -> Vec<String>;
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
    fn global(&self) -> bool {
        // 旧形式: 固定された個体は全体ではない。固定も紐付けも無い旧個体は
        // どのカラムでも使えた = 全体。旧々 (accountId だけ) は移行待ちで参加先なし
        if self.str("accountKey").is_some() {
            return false;
        }
        match self.bool("global") {
            Some(g) => g,
            None => self.str("accountId").is_none(),
        }
    }
    fn installed_for(&self) -> Vec<String> {
        if let Some(k) = self.str("accountKey") {
            return vec![k.to_string()];
        }
        self.list("installedFor")
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
    crate::clock::now_ms()
}

/// `toFileMeta`: 規定のキー順。旧 `accountKey` は `installedFor` に写して書かない。
/// 旧々 `accountId` (内部 UUID) は accountKey が無いときだけ残す (デバイスの移行が読む)。
pub fn normalize_meta(item: &Item) -> J5 {
    normalize_meta_at(item, now() as f64)
}

/// `normalize_meta` の時刻 (createdAt / updatedAt の埋め草) を外から渡す形 (golden テスト用)。
pub fn normalize_meta_at(item: &Item, now: f64) -> J5 {
    let J5::Obj(pairs) = &item.meta else {
        return J5::Obj(vec![]);
    };
    let mut out: Vec<(String, J5)> = vec![
        ("installId".into(), J5::Str(item.id.clone())),
        ("name".into(), J5::Str(item.name())),
        ("autoRun".into(), J5::Bool(item.auto_run())),
    ];
    for key in ["storeId", "storeSha512", "storeVersion", "iconUrl"] {
        if let Some(v) = item.str(key) {
            out.push((key.into(), J5::Str(v.into())));
        }
    }
    out.push(("global".into(), J5::Bool(item.global())));
    let installed_for = item.installed_for();
    if !installed_for.is_empty() {
        out.push((
            "installedFor".into(),
            J5::Arr(installed_for.into_iter().map(J5::Str).collect()),
        ));
    }
    out.push((
        "createdAt".into(),
        J5::Num(item.num("createdAt").unwrap_or(now)),
    ));
    out.push((
        "updatedAt".into(),
        J5::Num(item.num("updatedAt").unwrap_or(now)),
    ));
    let migrated_key = item.str("accountKey").is_some();
    for (k, v) in pairs {
        if KEY_ORDER.contains(&k.as_str()) || k == "accountKey" {
            continue;
        }
        if k == "accountId" && migrated_key {
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

/// 同じ storeId の本体 (1 つ)。照合は storeId のみ (#913)。
pub fn find_by_store<'a>(items: &'a [Item], store_id: &str) -> Option<&'a Item> {
    items.iter().find(|w| w.store_id() == Some(store_id))
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

/// `link`: アカウント別スコープに参加させる (既に入っていれば何もしない)。
pub fn link_account(core: &Core, item: &mut Item, account_key: &str) -> Result<()> {
    let mut keys = item.installed_for();
    if keys.iter().any(|k| k == account_key) {
        return Ok(());
    }
    keys.push(account_key.to_string());
    // 旧形式の印は installedFor に畳む (normalize が accountKey を落とす)
    item.meta.set("global", J5::Bool(item.global()));
    item.meta.remove("accountKey");
    item.meta.set(
        "installedFor",
        J5::Arr(keys.into_iter().map(J5::Str).collect()),
    );
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

/// `applyStoreUpdate`: 本体とストア由来メタを上書きする (name / autoRun / 参加先は維持)。
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

/// MisStore からの新規インストール (`installWidget` の新規分岐)。参加先を渡せば
/// そのアカウント別スコープに、無ければ全体スコープ (どのカラムでも使える)。
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
    match account_key.filter(|k| !k.is_empty()) {
        Some(k) => {
            pairs.push(("global".into(), J5::Bool(false)));
            pairs.push(("installedFor".into(), J5::Arr(vec![J5::Str(k.into())])));
        }
        None => pairs.push(("global".into(), J5::Bool(true))),
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
    use crate::sidecar::test_support::temp_core;

    fn put(base: &Path, name: &str, body: &str) {
        std::fs::write(base.join("widgets").join(name), body).unwrap();
    }

    #[test]
    fn sorts_by_created_at_and_migrates_legacy_account_fields() {
        let (_d, core, base) = temp_core();
        put(&base, "a.meta.json5", "{ installId: 'a', name: 'A', autoRun: true, createdAt: 20, updatedAt: 20, accountId: 'uuid', accountKey: 'h:u' }");
        put(&base, "a.is", "");
        put(
            &base,
            "b.meta.json5",
            "{ installId: 'b', name: 'B', createdAt: 10, updatedAt: 10, accountId: 'uuid' }",
        );
        put(&base, "b.is", "");
        put(
            &base,
            "c.meta.json5",
            "{ installId: 'c', name: 'C', autoRun: false, createdAt: 15, updatedAt: 15 }",
        );
        put(&base, "c.is", "");
        let ids: Vec<String> = list(&core).unwrap().into_iter().map(|w| w.id).collect();
        assert_eq!(ids, vec!["b", "c", "a"]);
        // 旧 accountKey → installedFor。accountId は書かない
        let mut a = get(&core, "a").unwrap().unwrap();
        assert!(!a.global());
        assert_eq!(a.installed_for(), vec!["h:u"]);
        set_auto_run(&core, &mut a, false).unwrap();
        let raw = std::fs::read_to_string(base.join("widgets/a.meta.json5")).unwrap();
        assert!(raw.starts_with("{\n  installId: 'a',\n  name: 'A',\n  autoRun: false,\n  global: false,\n  installedFor: [\n    'h:u',\n  ],\n  createdAt: 20,\n  updatedAt: "));
        assert!(!raw.contains("accountId"));
        assert!(!raw.contains("accountKey"));
        // accountKey が無い旧々個体は accountId を残す (デバイスの移行が読む)
        let mut b = get(&core, "b").unwrap().unwrap();
        assert!(!b.global());
        update_src(&core, &mut b, "x", None).unwrap();
        let raw = std::fs::read_to_string(base.join("widgets/b.meta.json5")).unwrap();
        assert!(raw.contains("global: false"));
        assert!(raw.contains("accountId: 'uuid'"));
        assert_eq!(
            history(&base, &b)[0].snapshot,
            json!({ "src": "", "name": "B", "autoRun": false })
        );
        // 固定も紐付けも無い旧個体は全体スコープ
        let c = get(&core, "c").unwrap().unwrap();
        assert!(c.global());
        assert!(c.installed_for().is_empty());
    }

    #[test]
    fn one_body_per_store_and_link_account() {
        let (_d, core, base) = temp_core();
        put(&base, "w.meta.json5", "{ installId: 'w', name: 'W', autoRun: false, storeId: 'clock', global: true, createdAt: 1, updatedAt: 1 }");
        put(&base, "w.is", "");
        let all = list(&core).unwrap();
        assert_eq!(find_by_store(&all, "clock").unwrap().id, "w");
        assert!(find_by_store(&all, "other").is_none());
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
        // ローカル ID = storeId、占有時は連番
        assert_eq!(item.id, "clock");
        assert_eq!(item.file_base, "clock");
        assert!(!item.global());
        assert_eq!(item.installed_for(), vec!["h:v"]);
        assert!(item.auto_run());
        let mut item = item;
        link_account(&core, &mut item, "h:w").unwrap();
        link_account(&core, &mut item, "h:w").unwrap();
        assert_eq!(item.installed_for(), vec!["h:v", "h:w"]);
        let raw = std::fs::read_to_string(base.join("widgets/clock.meta.json5")).unwrap();
        assert!(raw.contains("installedFor: [\n    'h:v',\n    'h:w',\n  ],"));
    }
}
