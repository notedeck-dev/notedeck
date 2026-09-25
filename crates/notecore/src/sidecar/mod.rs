//! 「src (`.is`) + meta (`.meta.json5`) の 2 ファイルで 1 個体」のコレクション
//! (プラグイン / ウィジェット / カラムクエリ) の読み書き (#1133 縦切り 4 第 3 弾)。
//! デバイス側 `src/services/sidecarFileCollection.ts` と同じ規則。状態は持たず
//! 毎回ファイルを読む。AiScript の実行 (起動 / 停止 / 再実行) はデバイスに残る。
//!
//! - ファイル名は表示名の slug (ストア由来は storeId)。参照はファイル内 ID
//! - ID 凍結: ID 欠損のメタを読んだら **メタファイルの完全名** を書き戻す
//! - ソースが無い個体は readOnly (空ソースを書き戻してコードを失わない)
//! - 書込順は src → meta、削除順は meta → src → history

pub mod plugin_meta;
pub mod plugins;
pub mod queries;
pub mod widgets;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::edit_history::{self, Attribution, HISTORY_SUFFIX};
use crate::error::Result;
use crate::json5_out::{self, J5};
use crate::settings_events;
use crate::settings_slug::{casefold, is_slug_conforming, resolve_available, slugify_name};
use crate::settings_store as store;
use notecli::error::NoteDeckError;

pub const META_SUFFIX: &str = ".meta.json5";
pub const SRC_SUFFIX: &str = ".is";
const ID_MAX_LENGTH: usize = 256;

/// 読取専用 (メタあり・ソース無し) の個体に対する変更を拒否するときの理由 (#1111)。
pub const READ_ONLY_REASON: &str = "ソースファイルが見つからないため変更できません";

#[derive(Clone, Copy, Debug)]
pub struct Kind {
    pub subdir: &'static str,
    pub id_key: &'static str,
    /// slug が空になったときの種別 fallback
    pub fallback: &'static str,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    /// メタファイルの内容 (キー順を保つ)
    pub meta: J5,
    pub src: String,
    pub file_base: String,
    pub read_only: bool,
}

impl Item {
    pub fn meta_file(&self) -> String {
        format!("{}{META_SUFFIX}", self.file_base)
    }

    pub fn str(&self, key: &str) -> Option<&str> {
        self.meta
            .get(key)
            .and_then(J5::as_str)
            .filter(|s| !s.is_empty())
    }

    pub fn bool(&self, key: &str) -> Option<bool> {
        self.meta.get(key).and_then(J5::as_bool)
    }

    pub fn num(&self, key: &str) -> Option<f64> {
        self.meta.get(key).and_then(J5::as_f64)
    }

    pub fn list(&self, key: &str) -> Vec<String> {
        self.meta.get(key).map(J5::string_list).unwrap_or_default()
    }

    /// 変更を拒否する読取専用個体ならエラー。
    pub fn ensure_writable(&self, capability: &str) -> Result<()> {
        if self.read_only {
            return Err(NoteDeckError::InvalidInput(format!(
                "{capability}: {READ_ONLY_REASON}"
            )));
        }
        Ok(())
    }
}

pub fn base_dir(core: &Core) -> Result<PathBuf> {
    settings_base_dir(core)
}

fn is_valid_id(v: Option<&J5>) -> bool {
    matches!(v, Some(J5::Str(s)) if !s.is_empty() && s.chars().count() <= ID_MAX_LENGTH)
}

fn strip_known_ext(name: &str) -> Option<&str> {
    name.strip_suffix(META_SUFFIX)
        .or_else(|| name.strip_suffix(HISTORY_SUFFIX))
        .or_else(|| name.strip_suffix(SRC_SUFFIX))
}

/// 全件 (メタファイル名のバイト順)。ID 凍結・重複 ID の読み飛ばし・readOnly 判定。
pub fn load_all(dir: &Path, kind: &Kind) -> Vec<Item> {
    let files = store::list_files(dir, kind.subdir).unwrap_or_default();
    let file_set: HashSet<&str> = files.iter().map(String::as_str).collect();
    let mut out = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for meta_file in files.iter().filter(|f| f.ends_with(META_SUFFIX)) {
        let base = &meta_file[..meta_file.len() - META_SUFFIX.len()];
        let Ok(mut raw) = store::read_file(dir, kind.subdir, meta_file) else {
            continue;
        };
        let mut meta: J5 = match json5::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(subdir = kind.subdir, meta_file, "failed to parse: {e}");
                continue;
            }
        };
        if !matches!(meta, J5::Obj(_)) {
            tracing::warn!(subdir = kind.subdir, meta_file, "not an object — skipped");
            continue;
        }
        if !is_valid_id(meta.get(kind.id_key)) {
            // ID 凍結 (常設規則): 実効値 = メタファイルの完全名
            match json5_out::inject_json5_id(&raw, kind.id_key, meta_file) {
                Ok(frozen) => {
                    if let Err(e) = store::write_file(dir, kind.subdir, meta_file, &frozen) {
                        tracing::warn!(meta_file, "failed to freeze id: {e}");
                    }
                    raw = frozen;
                    if let Ok(v) = json5::from_str::<J5>(&raw) {
                        meta = v;
                    }
                }
                Err(e) => tracing::warn!(meta_file, "failed to freeze id: {e}"),
            }
            meta.set(kind.id_key, J5::Str(meta_file.clone()));
        }
        let id = meta
            .get(kind.id_key)
            .and_then(J5::as_str)
            .unwrap_or_default()
            .to_string();
        if !seen.insert(id.clone()) {
            tracing::warn!(
                subdir = kind.subdir,
                id,
                meta_file,
                "duplicate id — skipped (file kept)"
            );
            continue;
        }
        let src_file = format!("{base}{SRC_SUFFIX}");
        let (src, read_only) = if file_set.contains(src_file.as_str()) {
            (
                store::read_file(dir, kind.subdir, &src_file).unwrap_or_default(),
                false,
            )
        } else {
            tracing::warn!(
                subdir = kind.subdir,
                src_file,
                "source is missing — read-only"
            );
            (String::new(), true)
        };
        out.push(Item {
            id,
            meta,
            src,
            file_base: base.to_string(),
            read_only,
        });
    }
    out
}

/// 新規個体のファイル名を決める。占有集合 = 種別ディレクトリの規定拡張子ファイル
/// ∪ 他の個体の fileBase ∪ 他の個体の ID (casefold)。候補は storeId (規約に合えば)、
/// 無ければ表示名の slug。
pub fn allocate_base(
    dir: &Path,
    kind: &Kind,
    name: &str,
    preferred: Option<&str>,
    others: &[Item],
) -> String {
    let mut taken: HashSet<String> = store::list_files(dir, kind.subdir)
        .unwrap_or_default()
        .iter()
        .filter_map(|f| strip_known_ext(f))
        .map(casefold)
        .collect();
    for o in others {
        taken.insert(casefold(&o.file_base));
        taken.insert(casefold(&o.id));
    }
    let base = match preferred {
        Some(p) if is_slug_conforming(p) => p.to_string(),
        _ => slugify_name(name, kind.fallback),
    };
    resolve_available(&base, |c| taken.contains(&casefold(c)))
}

/// src → meta の順に書く (メタを存在の印にする)。
pub fn write_item(core: &Core, kind: &Kind, base: &str, src: &str, meta: &J5) -> Result<()> {
    settings_events::write_file(core, kind.subdir, &format!("{base}{SRC_SUFFIX}"), src)?;
    settings_events::write_file(
        core,
        kind.subdir,
        &format!("{base}{META_SUFFIX}"),
        &json5_out::stringify(meta),
    )
}

/// meta → src → history の順に消す (無いものは no-op)。
pub fn remove_item(core: &Core, kind: &Kind, base: &str) -> Result<()> {
    settings_events::delete_file(core, kind.subdir, &format!("{base}{META_SUFFIX}"))?;
    settings_events::delete_file(core, kind.subdir, &format!("{base}{SRC_SUFFIX}"))?;
    settings_events::delete_file(core, kind.subdir, &edit_history::history_file_name(base))
}

pub fn history(dir: &Path, kind: &Kind, base: &str) -> Vec<edit_history::HistoryEntry> {
    edit_history::list(dir, kind.subdir, base)
}

pub fn push_snapshot(
    core: &Core,
    dir: &Path,
    kind: &Kind,
    base: &str,
    snapshot: serde_json::Value,
    attribution: Option<&Attribution>,
) -> Result<()> {
    edit_history::push_snapshot(
        core,
        dir,
        kind.subdir,
        base,
        snapshot,
        attribution,
        crate::ai_sessions::now_ms(),
    )
}

/// 新規作成時の ID `<prefix>-<ms>-<rand6>` (`Math.random().toString(36).slice(2, 8)`)。
pub fn generate_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut x = (now as u64)
        ^ (std::process::id() as u64).rotate_left(32)
        ^ SEQ
            .fetch_add(1, Ordering::Relaxed)
            .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        | 1;
    let chars = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut rand = String::new();
    for _ in 0..6 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        rand.push(chars[(x % 36) as usize] as char);
    }
    format!("{prefix}-{now}-{rand}")
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn temp_core() -> (tempfile::TempDir, Core, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let base = base_dir(&core).unwrap();
        std::fs::create_dir_all(base.join("plugins")).unwrap();
        std::fs::create_dir_all(base.join("widgets")).unwrap();
        std::fs::create_dir_all(base.join("queries")).unwrap();
        (dir, core, base)
    }

    const WIDGETS: Kind = Kind {
        subdir: "widgets",
        id_key: "installId",
        fallback: "widget",
    };

    fn put(base: &Path, name: &str, body: &str) {
        std::fs::write(base.join("widgets").join(name), body).unwrap();
    }

    #[test]
    fn freezes_missing_id_to_full_meta_filename_and_keeps_comments() {
        let (_d, _core, base) = temp_core();
        put(
            &base,
            "My Widget.meta.json5",
            "{\n  // handwritten\n  name: \"My Widget\",\n}",
        );
        put(&base, "My Widget.is", "<: 1");
        let items = load_all(&base, &WIDGETS);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "My Widget.meta.json5");
        assert_eq!(items[0].file_base, "My Widget");
        assert!(!items[0].read_only);
        let raw = std::fs::read_to_string(base.join("widgets/My Widget.meta.json5")).unwrap();
        assert!(raw.contains("// handwritten"));
        assert!(raw.contains("installId: 'My Widget.meta.json5'"));
        // 2 回目は変わらない
        load_all(&base, &WIDGETS);
        assert_eq!(
            std::fs::read_to_string(base.join("widgets/My Widget.meta.json5")).unwrap(),
            raw
        );
        // 空 / 数値 / 257 文字も凍結、制御文字入りは凍結しない
        put(&base, "e.meta.json5", "{ installId: \"\" }");
        put(&base, "n.meta.json5", "{ installId: 42 }");
        put(
            &base,
            "l.meta.json5",
            &format!("{{ installId: \"{}\" }}", "x".repeat(257)),
        );
        put(&base, "t.meta.json5", "{ installId: \"we\\tird\" }");
        let ids: Vec<String> = load_all(&base, &WIDGETS)
            .into_iter()
            .map(|i| i.id)
            .collect();
        assert_eq!(
            ids,
            vec![
                "My Widget.meta.json5",
                "e.meta.json5",
                "l.meta.json5",
                "n.meta.json5",
                "we\tird"
            ]
        );
    }

    #[test]
    fn order_duplicates_and_missing_source() {
        let (_d, _core, base) = temp_core();
        put(&base, "z.meta.json5", "{ installId: 'z' }");
        put(&base, "z.is", "");
        put(&base, "A.meta.json5", "{ installId: 'A' }");
        put(&base, "A.is", "");
        put(&base, "a.meta.json5", "{ installId: 'dup' }");
        put(&base, "a.is", "1");
        put(&base, "b.meta.json5", "{ installId: 'dup' }");
        put(&base, "b.is", "2");
        put(
            &base,
            "orphan.meta.json5",
            "{ installId: 'orphan', name: 'O' }",
        );
        put(&base, "broken.meta.json5", "{{{ not json5");
        put(&base, "nometa.is", "<: 1");
        let items = load_all(&base, &WIDGETS);
        let ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["A", "dup", "orphan", "z"]);
        let orphan = items.iter().find(|i| i.id == "orphan").unwrap();
        assert!(orphan.read_only);
        assert_eq!(orphan.src, "");
        assert!(!base.join("widgets/orphan.is").exists());
        assert!(orphan
            .ensure_writable("x")
            .unwrap_err()
            .to_string()
            .contains(READ_ONLY_REASON));
    }

    #[test]
    fn allocates_names_like_ts() {
        let (_d, _core, base) = temp_core();
        assert_eq!(
            allocate_base(&base, &WIDGETS, "My Widget!", None, &[]),
            "my-widget"
        );
        assert_eq!(
            allocate_base(&base, &WIDGETS, "ウィジェット", None, &[]),
            "widget"
        );
        put(&base, "Alpha.meta.json5", "{}");
        assert_eq!(
            allocate_base(&base, &WIDGETS, "alpha", None, &[]),
            "alpha-2"
        );
        let other = Item {
            id: "alpha-2".into(),
            meta: J5::Obj(vec![]),
            src: String::new(),
            file_base: "alpha".into(),
            read_only: false,
        };
        assert_eq!(
            allocate_base(&base, &WIDGETS, "alpha", None, &[other]),
            "alpha-3"
        );
        put(&base, "beta.history.json5", "{}");
        assert_eq!(allocate_base(&base, &WIDGETS, "beta", None, &[]), "beta-2");
        assert_eq!(
            allocate_base(&base, &WIDGETS, "x", Some("store-item"), &[]),
            "store-item"
        );
        put(&base, "store-item.is", "");
        assert_eq!(
            allocate_base(&base, &WIDGETS, "x", Some("store-item"), &[]),
            "store-item-2"
        );
        assert_eq!(
            allocate_base(&base, &WIDGETS, "Nice Name", Some("日本語ID"), &[]),
            "nice-name"
        );
    }

    #[test]
    fn write_and_remove_follow_file_order() {
        let (_d, core, base) = temp_core();
        let meta = J5::Obj(vec![
            ("installId".into(), J5::Str("w".into())),
            ("name".into(), J5::Str("W".into())),
            ("autoRun".into(), J5::Bool(false)),
        ]);
        write_item(&core, &WIDGETS, "w", "<: 1", &meta).unwrap();
        assert_eq!(
            std::fs::read_to_string(base.join("widgets/w.meta.json5")).unwrap(),
            "{\n  installId: 'w',\n  name: 'W',\n  autoRun: false,\n}"
        );
        assert_eq!(
            std::fs::read_to_string(base.join("widgets/w.is")).unwrap(),
            "<: 1"
        );
        remove_item(&core, &WIDGETS, "w").unwrap();
        assert!(!base.join("widgets/w.meta.json5").exists());
        assert!(!base.join("widgets/w.is").exists());
        // 履歴が無くても成功する
        remove_item(&core, &WIDGETS, "w").unwrap();
    }

    #[test]
    fn generates_prefixed_ids() {
        let a = generate_id("wgt");
        let b = generate_id("wgt");
        assert!(a.starts_with("wgt-"));
        assert_eq!(a.rsplit('-').next().unwrap().len(), 6);
        assert_ne!(a, b);
    }
}
