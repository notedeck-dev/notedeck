//! カラムクエリ (`queries/<slug>.is` + `.meta.json5`) の射影と操作。
//! デバイス側 `src/stores/columnQueries.ts` と同じ規則。評価と暴走サスペンドの
//! 解除はデバイスが変更通知を受けて行う。

use serde_json::{json, Value};
use std::path::Path;

use super::{Item, Kind};
use crate::context::Core;
use crate::edit_history::{Attribution, HistoryEntry};
use crate::error::Result;
use crate::json5_out::J5;

pub const KIND: Kind = Kind {
    subdir: "queries",
    id_key: "id",
    fallback: "query",
};

const KEY_ORDER: &[&str] = &[
    "id",
    "name",
    "description",
    "storeId",
    "storeSha512",
    "storeVersion",
    "iconUrl",
    "global",
    "installedFor",
    "scoped",
    "disabled",
    "createdAt",
    "updatedAt",
];

pub trait QueryView {
    fn name(&self) -> String;
    fn description(&self) -> Option<&str>;
    fn snapshot(&self) -> Value;
}

impl QueryView for Item {
    fn name(&self) -> String {
        self.str("name")
            .map(str::to_string)
            .unwrap_or_else(|| self.meta_file())
    }
    fn description(&self) -> Option<&str> {
        self.str("description")
    }
    /// 編集履歴の snapshot `{src, name, description?}`。
    fn snapshot(&self) -> Value {
        let mut s = json!({ "src": self.src, "name": self.name() });
        if let Some(d) = self.description() {
            s["description"] = json!(d);
        }
        s
    }
}

fn now() -> f64 {
    crate::ai_sessions::now_ms() as f64
}

/// `toFileMeta`: 規定のキー順。真偽の印 (global / scoped / disabled) は true のときだけ。
pub fn normalize_meta(item: &Item) -> J5 {
    let J5::Obj(pairs) = &item.meta else {
        return J5::Obj(vec![]);
    };
    let mut out: Vec<(String, J5)> = vec![
        ("id".into(), J5::Str(item.id.clone())),
        ("name".into(), J5::Str(item.name())),
    ];
    for key in [
        "description",
        "storeId",
        "storeSha512",
        "storeVersion",
        "iconUrl",
    ] {
        if let Some(v) = item.str(key) {
            out.push((key.into(), J5::Str(v.into())));
        }
    }
    if item.meta.get("global").map(J5::is_truthy).unwrap_or(false) {
        out.push(("global".into(), J5::Bool(true)));
    }
    if let Some(p) = item
        .meta
        .get("installedFor")
        .filter(|p| !p.as_arr().unwrap_or_default().is_empty())
    {
        out.push(("installedFor".into(), p.clone()));
    }
    for key in ["scoped", "disabled"] {
        if item.meta.get(key).map(J5::is_truthy).unwrap_or(false) {
            out.push((key.into(), J5::Bool(true)));
        }
    }
    out.push((
        "createdAt".into(),
        J5::Num(item.num("createdAt").unwrap_or_else(now)),
    ));
    out.push((
        "updatedAt".into(),
        J5::Num(item.num("updatedAt").unwrap_or_else(now)),
    ));
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
    Ok(list(core)?.into_iter().find(|q| q.id == id))
}

pub fn history(dir: &Path, item: &Item) -> Vec<HistoryEntry> {
    super::history(dir, &KIND, &item.file_base)
}

/// `updateQuery({src})`: src が変わるときだけ編集前を履歴に積み、書く。
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
    item.meta.set("updatedAt", J5::Num(now()));
    super::write_item(
        core,
        &KIND,
        &item.file_base,
        &item.src,
        &normalize_meta(item),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::tests::temp_core;

    #[test]
    fn update_src_keeps_flags_and_pushes_history() {
        let (_d, core, base) = temp_core();
        std::fs::write(base.join("queries/a.meta.json5"), "{ id: 'a', name: 'a', description: 'd', scoped: true, global: true, disabled: false, createdAt: 1, updatedAt: 1 }").unwrap();
        std::fs::write(base.join("queries/a.is"), "old").unwrap();
        let mut q = get(&core, "a").unwrap().unwrap();
        update_src(&core, &mut q, "new", None).unwrap();
        let h = history(&base, &q);
        assert_eq!(
            h[0].snapshot,
            json!({ "src": "old", "name": "a", "description": "d" })
        );
        let raw = std::fs::read_to_string(base.join("queries/a.meta.json5")).unwrap();
        assert!(raw.starts_with("{\n  id: 'a',\n  name: 'a',\n  description: 'd',\n  global: true,\n  scoped: true,\n  createdAt: 1,\n  updatedAt: "));
        assert!(!raw.contains("disabled"));
    }
}
