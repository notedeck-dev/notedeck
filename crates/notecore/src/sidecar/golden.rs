//! デバイスの codec (`src/services/distributableCodecs/`) と同じファイルを書くことの
//! golden (#1202 段階 0)。期待値の正本は TS 側 (`pnpm gen:golden-distributables`)
//! で、同じ入力から同じ本文が出ることを kind ごとに検査する。skill は notemaid
//! (`crates/notemaid/src/skills.rs`) が同じファイルを読む。

use serde::Deserialize;

use super::{plugins, queries, widgets, Item, Kind, META_SUFFIX};
use crate::json5_out::{self, J5};
use crate::themes;

const VECTORS: &str =
    include_str!("../../../../src/services/distributableCodecs/golden/vectors.json");

#[derive(Deserialize)]
struct SidecarVector {
    name: String,
    filename: String,
    now: f64,
    meta: String,
    src: String,
    expected: String,
}

#[derive(Deserialize)]
struct SingleVector {
    name: String,
    filename: String,
    now: u64,
    text: String,
    expected: String,
}

#[derive(Deserialize)]
struct Vectors {
    plugin: Vec<SidecarVector>,
    widget: Vec<SidecarVector>,
    query: Vec<SidecarVector>,
    theme: Vec<SingleVector>,
}

fn vectors() -> Vectors {
    serde_json::from_str(VECTORS).expect("vectors.json")
}

/// `load_all` と同じ規則で 1 個体を組む (ID 欠損はメタファイルの完全名、fileBase は
/// その basename)。
fn item_of(kind: &Kind, v: &SidecarVector) -> Item {
    let meta: J5 = json5::from_str(&v.meta).expect("meta json5");
    let id = meta
        .get(kind.id_key)
        .and_then(J5::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or(&v.filename)
        .to_string();
    Item {
        id,
        meta,
        src: v.src.clone(),
        file_base: v.filename.trim_end_matches(META_SUFFIX).to_string(),
        read_only: false,
    }
}

fn check(kind: &Kind, list: &[SidecarVector], normalize: fn(&Item, f64) -> J5) {
    assert!(!list.is_empty());
    for v in list {
        let item = item_of(kind, v);
        let out = json5_out::stringify(&normalize(&item, v.now));
        assert_eq!(out, v.expected, "{}: {}", kind.subdir, v.name);
        // 固定 projection: 書いたものを読み直して書いても変わらない
        let again = SidecarVector {
            name: v.name.clone(),
            filename: v.filename.clone(),
            now: 0.0,
            meta: v.expected.clone(),
            src: v.src.clone(),
            expected: v.expected.clone(),
        };
        let out2 = json5_out::stringify(&normalize(&item_of(kind, &again), 0.0));
        assert_eq!(out2, v.expected, "{} (reload): {}", kind.subdir, v.name);
    }
}

#[test]
fn sidecar_codecs_match_device_golden() {
    let v = vectors();
    check(&plugins::KIND, &v.plugin, plugins::normalize_meta_at);
    check(&widgets::KIND, &v.widget, widgets::normalize_meta_at);
    check(&queries::KIND, &v.query, queries::normalize_meta_at);
}

/// テーマは `load_all` の規則 (id 凍結 = `custom-<完全ファイル名>`、名前の fallback)
/// を当ててから、書込経路と同じく時刻を埋めて serialize する。
fn theme_round_trip(text: &str, filename: &str, now: u64) -> String {
    let (mut t, _) = themes::parse_theme_code(text).expect("theme code");
    if t.id.is_empty() {
        t.id = format!("custom-{filename}");
    }
    if t.name.is_empty() {
        t.name = filename.to_string();
    }
    // 読込の埋め草: 無いときだけ今 (updatedAt も読込では進めない)
    let created = t.created_at().unwrap_or(now);
    let updated = t
        .notedeck
        .as_ref()
        .and_then(|m| m.get("updatedAt"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(now);
    themes::touch_timestamps(&mut t, Some(created), updated);
    themes::serialize_theme_file(&t)
}

#[test]
fn theme_codec_matches_device_golden() {
    let v = vectors();
    assert!(!v.theme.is_empty());
    for t in &v.theme {
        assert_eq!(
            theme_round_trip(&t.text, &t.filename, t.now),
            t.expected,
            "theme: {}",
            t.name
        );
        assert_eq!(
            theme_round_trip(&t.expected, &t.filename, 0),
            t.expected,
            "theme (reload): {}",
            t.name
        );
    }
}
