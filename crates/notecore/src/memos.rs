//! メモ (`memos/<key>.md`、Zettelkasten 形式) の codec と読み書き (#1133 縦切り 4 第 3 弾)。
//!
//! デバイス側 (`src/composables/useMemos.ts`) と同じ規則。状態は持たず毎回
//! ファイルを読む (デバイスの UI が同じファイルを書く)。notecore が書いたときは
//! `settings_events` で通知し、デバイスは写しを読み直す。
//!
//! frontmatter は js-yaml の dump が出す形 (`yaml_lite`)。本文は読むときに先頭の
//! LF を 1 つ除き、書くときは前に LF を、末尾には無ければ LF を足す (デバイスと
//! 同じ規則。往復で末尾の LF は高々 1 つ)。

use std::path::Path;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use specta::Type;
use std::sync::OnceLock;

use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::edit_history::{self, Attribution};
use crate::error::Result;
use crate::settings_events;
use crate::settings_store as store;
use crate::yaml_lite;

pub const SUBDIR: &str = "memos";
pub const EXT: &str = ".md";
const VISIBILITIES: &[&str] = &["public", "home", "followers", "specified"];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MemoAuthor {
    pub id: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MemoData {
    pub text: String,
    pub cw: String,
    pub show_cw: bool,
    pub visibility: String,
    pub local_only: bool,
    pub file_ids: Vec<String>,
    pub poll_choices: Vec<String>,
    pub poll_multiple: bool,
    pub show_poll: bool,
    pub scheduled_at: Option<String>,
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<MemoAuthor>,
    /// tainted なセッションが書いた (#1103)。付いたら外れない
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tainted: Option<bool>,
}

impl MemoData {
    /// `emptyMemoData(text, tags, author)`
    pub fn new(text: String, tags: Vec<String>, author: Option<MemoAuthor>) -> Self {
        Self {
            text,
            cw: String::new(),
            show_cw: false,
            visibility: "public".into(),
            local_only: false,
            file_ids: Vec::new(),
            poll_choices: Vec::new(),
            poll_multiple: false,
            show_poll: false,
            scheduled_at: None,
            tags,
            author,
            tainted: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StoredMemo {
    pub key: String,
    pub updated_at: String,
    pub created_at: String,
    pub data: MemoData,
}

// ---------------------------------------------------------------------------
// codec
// ---------------------------------------------------------------------------

fn fm_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n?(.*)$").expect("fm regex"))
}

fn split_frontmatter(raw: &str) -> (Map<String, Value>, String) {
    match fm_regex().captures(raw) {
        Some(m) => (yaml_lite::parse(&m[1]), m[2].to_string()),
        None => (Map::new(), raw.to_string()),
    }
}

fn str_of(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(str::to_string)
}

fn string_list(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn parse_author(v: Option<&Value>) -> Option<MemoAuthor> {
    let obj = v?.as_object()?;
    let id = obj
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?;
    let display_name = obj
        .get("displayName")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())?;
    Some(MemoAuthor {
        id: id.to_string(),
        display_name: display_name.to_string(),
        avatar_url: obj
            .get("avatarUrl")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    })
}

/// ファイル → メモ (`parseMemoContent`)。`now_iso` は updatedAt が無いときの値。
pub fn parse_memo_file(key: &str, raw: &str, now_iso: &str) -> StoredMemo {
    let (fm, body) = split_frontmatter(raw);
    let updated_at = str_of(fm.get("updatedAt")).unwrap_or_else(|| now_iso.to_string());
    let created_at = str_of(fm.get("createdAt")).unwrap_or_else(|| updated_at.clone());
    let visibility = match str_of(fm.get("visibility")) {
        Some(v) if VISIBILITIES.contains(&v.as_str()) => v,
        _ => "public".into(),
    };
    let is_true = |k: &str| fm.get(k).and_then(Value::as_bool) == Some(true);
    StoredMemo {
        key: key.to_string(),
        updated_at,
        created_at,
        data: MemoData {
            text: body.strip_prefix('\n').unwrap_or(&body).to_string(),
            cw: str_of(fm.get("cw")).unwrap_or_default(),
            show_cw: is_true("showCw"),
            visibility,
            local_only: is_true("localOnly"),
            file_ids: string_list(fm.get("fileIds")),
            poll_choices: string_list(fm.get("pollChoices")),
            poll_multiple: is_true("pollMultiple"),
            show_poll: is_true("showPoll"),
            scheduled_at: str_of(fm.get("scheduledAt")),
            tags: string_list(fm.get("tags")),
            author: parse_author(fm.get("author")),
            tainted: is_true("tainted").then_some(true),
        },
    }
}

/// メモ → ファイル (`toFrontmatterSource` + `buildMemoSource`)。
pub fn serialize_memo(m: &StoredMemo) -> String {
    let d = &m.data;
    let mut pairs: Vec<(String, Value)> = vec![
        ("id".into(), json!(m.key)),
        ("createdAt".into(), json!(m.created_at)),
        ("updatedAt".into(), json!(m.updated_at)),
    ];
    if d.visibility != "public" {
        pairs.push(("visibility".into(), json!(d.visibility)));
    }
    if !d.cw.trim().is_empty() {
        pairs.push(("cw".into(), json!(d.cw)));
        if d.show_cw {
            pairs.push(("showCw".into(), json!(true)));
        }
    }
    if d.local_only {
        pairs.push(("localOnly".into(), json!(true)));
    }
    if !d.file_ids.is_empty() {
        pairs.push(("fileIds".into(), json!(d.file_ids)));
    }
    if d.show_poll {
        pairs.push(("showPoll".into(), json!(true)));
        pairs.push(("pollChoices".into(), json!(d.poll_choices)));
        if d.poll_multiple {
            pairs.push(("pollMultiple".into(), json!(true)));
        }
    }
    if let Some(s) = d.scheduled_at.as_ref().filter(|s| !s.is_empty()) {
        pairs.push(("scheduledAt".into(), json!(s)));
    }
    if !d.tags.is_empty() {
        pairs.push(("tags".into(), json!(d.tags)));
    }
    if d.tainted == Some(true) {
        pairs.push(("tainted".into(), json!(true)));
    }
    if let Some(a) = &d.author {
        let mut author = Map::new();
        author.insert("id".into(), json!(a.id));
        author.insert("displayName".into(), json!(a.display_name));
        if let Some(u) = a.avatar_url.as_ref().filter(|u| !u.is_empty()) {
            author.insert("avatarUrl".into(), json!(u));
        }
        pairs.push(("author".into(), Value::Object(author)));
    }
    // 本文の末尾に LF が無ければ足す (読むときは先頭の LF を 1 つ除くだけなので、
    // 無条件に足すと再保存のたびに末尾の LF が増える。デバイス側も同じ規則)
    let tail = if d.text.ends_with('\n') { "" } else { "\n" };
    format!("---\n{}---\n\n{}{tail}", yaml_lite::emit(&pairs), d.text)
}

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

/// JS の `Date#toISOString()` と同じ形 (`2026-05-10T10:00:00.000Z`)。
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn base_dir(core: &Core) -> Result<std::path::PathBuf> {
    settings_base_dir(core)
}

/// 全件 (ファイルの並び = バイト順。デバイスの `Object.entries` と同じ)。
pub fn load_all(base_dir: &Path) -> Vec<StoredMemo> {
    let now = now_iso();
    store::list_files(base_dir, SUBDIR)
        .unwrap_or_default()
        .into_iter()
        .filter(|n| n.ends_with(EXT) && !n.ends_with(edit_history::HISTORY_SUFFIX))
        .filter_map(|n| {
            let raw = store::read_file(base_dir, SUBDIR, &n).ok()?;
            if raw.is_empty() {
                return None;
            }
            let key = n[..n.len() - EXT.len()].to_string();
            Some(parse_memo_file(&key, &raw, &now))
        })
        .collect()
}

pub fn list(core: &Core) -> Result<Vec<StoredMemo>> {
    Ok(load_all(&base_dir(core)?))
}

pub fn get(core: &Core, key: &str) -> Result<Option<StoredMemo>> {
    let dir = base_dir(core)?;
    let name = format!("{key}{EXT}");
    if store::validate_filename(&name).is_err() {
        return Ok(None);
    }
    match store::read_file(&dir, SUBDIR, &name) {
        Ok(raw) if !raw.is_empty() => Ok(Some(parse_memo_file(key, &raw, &now_iso()))),
        _ => Ok(None),
    }
}

/// ローカル時刻の `YYYYMMDDHHmmss` (`formatZettelkastenId`)。
pub fn local_stamp(t: chrono::DateTime<chrono::Local>) -> String {
    t.format("%Y%m%d%H%M%S").to_string()
}

/// 新しい key (`generateMemoKey`): 占有されていれば 1 秒ずつ先へずらす。
pub fn generate_key(base_dir: &Path) -> String {
    let now = chrono::Local::now();
    let mut attempt: i64 = 0;
    loop {
        let t = now + chrono::Duration::seconds(attempt);
        let key = local_stamp(t);
        let exists = store::resolve_file(base_dir, SUBDIR, &format!("{key}{EXT}"))
            .map(|p| p.exists())
            .unwrap_or(true);
        if !exists {
            return key;
        }
        attempt += 1;
    }
}

/// 保存 (`saveMemo`): 本文が変わっていれば編集前を履歴に積み、書く。
pub fn save(
    core: &Core,
    key: &str,
    data: MemoData,
    attribution: Option<&Attribution>,
) -> Result<StoredMemo> {
    let dir = base_dir(core)?;
    let now = now_iso();
    let prev = get(core, key)?;
    if let Some(prev) = &prev {
        if prev.data.text != data.text {
            edit_history::push_snapshot(
                core,
                &dir,
                SUBDIR,
                key,
                json!({ "body": prev.data.text }),
                attribution,
                crate::ai_sessions::now_ms(),
            )?;
        }
    }
    let stored = StoredMemo {
        key: key.to_string(),
        created_at: prev.map(|p| p.created_at).unwrap_or_else(|| now.clone()),
        updated_at: now,
        data,
    };
    settings_events::write_file(
        core,
        SUBDIR,
        &format!("{key}{EXT}"),
        &serialize_memo(&stored),
    )?;
    Ok(stored)
}

/// 削除 (`deleteMemo`): 本体と履歴を消す。無ければ false。
pub fn delete(core: &Core, key: &str) -> Result<bool> {
    if get(core, key)?.is_none() {
        return Ok(false);
    }
    settings_events::delete_file(core, SUBDIR, &format!("{key}{EXT}"))?;
    settings_events::delete_file(core, SUBDIR, &edit_history::history_file_name(key))?;
    Ok(true)
}

pub fn history(core: &Core, key: &str) -> Result<Vec<edit_history::HistoryEntry>> {
    Ok(edit_history::list(&base_dir(core)?, SUBDIR, key))
}

// ---------------------------------------------------------------------------
// リンク
// ---------------------------------------------------------------------------

/// `](memo:<14 桁>)` の参照先 (初出順、重複なし)。
pub fn extract_memo_refs(text: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\]\(memo:(\d{14})\)").expect("memo ref regex"));
    let mut out: Vec<String> = Vec::new();
    for c in re.captures_iter(text) {
        let id = c[1].to_string();
        if !out.contains(&id) {
            out.push(id);
        }
    }
    out
}

pub fn is_zettelkasten_key(s: &str) -> bool {
    s.len() == 14 && s.bytes().all(|b| b.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_in(dir: &Path) -> Core {
        let core = Core::new();
        core.set_app_dir(dir.to_path_buf());
        core
    }

    #[test]
    fn parse_and_serialize_match_the_device_rules() {
        let raw = "---\nid: \"20260510120000\"\ncreatedAt: \"2026-05-10T10:00:00.000Z\"\nupdatedAt: \"2026-05-11T10:00:00.000Z\"\nvisibility: home\ntags:\n  - idea\ntainted: true\nauthor:\n  id: ai.chat\n  displayName: AI\n---\n\nhello\n";
        let m = parse_memo_file("20260510120000", raw, "now");
        assert_eq!(m.created_at, "2026-05-10T10:00:00.000Z");
        assert_eq!(m.updated_at, "2026-05-11T10:00:00.000Z");
        assert_eq!(m.data.visibility, "home");
        assert_eq!(m.data.tags, vec!["idea"]);
        assert_eq!(m.data.tainted, Some(true));
        assert_eq!(m.data.author.as_ref().unwrap().display_name, "AI");
        // 先頭の LF を 1 つ除く (末尾は残る = デバイスと同じ)
        assert_eq!(m.data.text, "hello\n");
        let out = serialize_memo(&m);
        assert_eq!(out, "---\nid: \"20260510120000\"\ncreatedAt: \"2026-05-10T10:00:00.000Z\"\nupdatedAt: \"2026-05-11T10:00:00.000Z\"\nvisibility: home\ntags:\n  - idea\ntainted: true\nauthor:\n  id: ai.chat\n  displayName: AI\n---\n\nhello\n");
        // 往復で安定する (末尾の LF は増えない)
        assert_eq!(
            serialize_memo(&parse_memo_file("20260510120000", &out, "now")),
            out
        );
        // updatedAt が無ければ読込時刻、無い visibility は public、frontmatter が無ければ全体が本文
        let m2 = parse_memo_file("k", "just text", "2026-01-01T00:00:00.000Z");
        assert_eq!(m2.updated_at, "2026-01-01T00:00:00.000Z");
        assert_eq!(m2.created_at, m2.updated_at);
        assert_eq!(m2.data.visibility, "public");
        assert_eq!(m2.data.text, "just text");
        // 既定値は書かない
        let plain = StoredMemo {
            key: "1".into(),
            updated_at: "u".into(),
            created_at: "c".into(),
            data: MemoData::new("t".into(), vec![], None),
        };
        assert_eq!(
            serialize_memo(&plain),
            "---\nid: \"1\"\ncreatedAt: c\nupdatedAt: u\n---\n\nt\n"
        );
    }

    #[test]
    fn refs_and_keys() {
        assert_eq!(
            extract_memo_refs("see [other](memo:20260510120000) for context"),
            vec!["20260510120000"]
        );
        assert_eq!(
            extract_memo_refs("[x](memo:20260510120000) and again [x](memo:20260510120000)").len(),
            1
        );
        assert!(extract_memo_refs(
            "[short](memo:1234) [long](memo:202605101200000000) [a](memo:abcdefghijklmn) https://x"
        )
        .is_empty());
        assert!(is_zettelkasten_key("20260510120000"));
        assert!(!is_zettelkasten_key("not-a-zk-id"));
        assert!(now_iso().ends_with('Z'));
    }

    #[test]
    fn save_delete_and_history() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let base = base_dir(&core).unwrap();
        let key = generate_key(&base);
        assert!(is_zettelkasten_key(&key));
        let first = save(
            &core,
            &key,
            MemoData::new("v1".into(), vec!["a".into()], None),
            None,
        )
        .unwrap();
        assert_eq!(first.created_at, first.updated_at);
        std::thread::sleep(std::time::Duration::from_millis(2));
        let second = save(&core, &key, MemoData::new("v2".into(), vec![], None), None).unwrap();
        assert_eq!(second.created_at, first.created_at);
        let h = history(&core, &key).unwrap();
        assert_eq!(h.len(), 1);
        // 読み戻した本文は末尾に LF が 1 つ付く (デバイスと同じ)
        assert_eq!(h[0].snapshot["body"], "v1\n");
        assert_eq!(list(&core).unwrap().len(), 1);
        // 別の key が要る (同じ秒なら +1 秒)
        let key2 = generate_key(&base);
        assert_ne!(key2, key);
        assert!(delete(&core, &key).unwrap());
        assert!(!delete(&core, &key).unwrap());
        assert!(get(&core, &key).unwrap().is_none());
        assert!(history(&core, &key).unwrap().is_empty());
    }
}
