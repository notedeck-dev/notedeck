//! AI skill (`skills/<base>.md`) の codec と読み書き (#1133 縦切り 4 第 3 弾)。
//!
//! TS の `src/utils/skillFrontmatter.ts` / `src/stores/skills.ts` /
//! `src/services/singleFileCollection.ts` と同じ規則。状態は持たず、毎回ファイルを
//! 読んで組み立てる (デバイスの store が UI 編集で同じファイルを書くので、
//! ファイルだけが正)。notecore が書いたときは `settings_events` で通知する。

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::json;
use specta::Type;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::edit_history::{self, Attribution, HISTORY_SUFFIX};
use crate::error::Result;
use crate::settings_events;
use crate::settings_slug::{casefold, is_slug_conforming, resolve_available, slugify_name};
use crate::settings_store as store;
use notecli::error::NoteDeckError;

pub const SUBDIR: &str = "skills";
pub const EXT: &str = ".md";
const KIND_FALLBACK: &str = "skill";
pub const DEFAULT_VERSION: &str = "0.1.0";

// ---------------------------------------------------------------------------
// frontmatter codec
// ---------------------------------------------------------------------------

/// frontmatter の値 (独自の小さな YAML サブセット)。
#[derive(Clone, Debug, PartialEq)]
pub enum FmValue {
    Str(String),
    Num(f64),
    Bool(bool),
    List(Vec<String>),
}

pub type Frontmatter = Vec<(String, FmValue)>;

pub fn fm_get<'a>(fm: &'a Frontmatter, key: &str) -> Option<&'a FmValue> {
    // 同じ key は後勝ち
    fm.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn fm_str<'a>(fm: &'a Frontmatter, key: &str) -> Option<&'a str> {
    match fm_get(fm, key) {
        Some(FmValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

fn strip_quotes(s: &str) -> &str {
    let b = s.as_bytes();
    if b.len() >= 2 && (b[0] == b'\'' || b[0] == b'"') && b[b.len() - 1] == b[0] {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

fn number_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^-?\d+(\.\d+)?$").expect("number regex"))
}

fn parse_value(raw: &str) -> FmValue {
    if raw == "true" {
        return FmValue::Bool(true);
    }
    if raw == "false" {
        return FmValue::Bool(false);
    }
    if raw.starts_with('[') && raw.ends_with(']') {
        let inner = raw[1..raw.len() - 1].trim();
        if inner.is_empty() {
            return FmValue::List(Vec::new());
        }
        return FmValue::List(
            inner
                .split(',')
                .map(|s| strip_quotes(s.trim()).to_string())
                .collect(),
        );
    }
    if number_re().is_match(raw) {
        if let Ok(n) = raw.parse::<f64>() {
            return FmValue::Num(n);
        }
    }
    FmValue::Str(strip_quotes(raw).to_string())
}

fn parse_frontmatter(text: &str) -> Frontmatter {
    static ITEM: OnceLock<Regex> = OnceLock::new();
    let item = ITEM.get_or_init(|| Regex::new(r"^\s+-\s*(.*)$").expect("item regex"));
    let lines: Vec<&str> = text
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect();
    let mut out: Frontmatter = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        i += 1;
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(idx) = line.find(':') else {
            continue;
        };
        if idx == 0 {
            continue;
        }
        let key = line[..idx].trim().to_string();
        let value = line[idx + 1..].trim();
        if value.is_empty() {
            let mut items = Vec::new();
            while i < lines.len() {
                let Some(m) = item.captures(lines[i]) else {
                    break;
                };
                items.push(strip_quotes(m[1].trim()).to_string());
                i += 1;
            }
            if items.is_empty() {
                out.push((key, FmValue::Str(String::new())));
            } else {
                out.push((key, FmValue::List(items)));
            }
            continue;
        }
        out.push((key, parse_value(value)));
    }
    out
}

/// `---` で囲まれた frontmatter と本文に分ける。無ければ全体が本文。
pub fn parse_skill_file(raw: &str) -> (Frontmatter, String) {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"(?s)^---\r?\n(.*?)\r?\n---\r?\n*").expect("fm regex"));
    match re.captures(raw) {
        Some(m) => {
            let whole = m.get(0).expect("whole").end();
            (parse_frontmatter(&m[1]), raw[whole..].to_string())
        }
        None => (Vec::new(), raw.to_string()),
    }
}

fn quote_if_needed(s: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"[:#,\[\]]|^\s|\s$|^$|^(true|false|null)$|^-?\d+(\.\d+)?$")
            .expect("quote regex")
    });
    if re.is_match(s) {
        format!("'{}'", s.replace('\'', "''"))
    } else {
        s.to_string()
    }
}

fn format_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

pub fn serialize_skill_file(fm: &Frontmatter, body: &str) -> String {
    let mut lines = vec!["---".to_string()];
    for (k, v) in fm {
        let text = match v {
            FmValue::Str(s) => quote_if_needed(s),
            FmValue::Num(n) => format_number(*n),
            FmValue::Bool(b) => b.to_string(),
            FmValue::List(items) => format!(
                "[{}]",
                items
                    .iter()
                    .map(|s| quote_if_needed(s))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        };
        lines.push(format!("{k}: {text}"));
    }
    lines.push("---".to_string());
    format!("{}\n\n{body}", lines.join("\n"))
}

/// ID 凍結 (`src/services/idFreeze.ts` の `injectFrontmatterId`): frontmatter の
/// 閉じ `---` の直前に `id: '<value>'` を足す (後勝ちで不正な id を上書き)。
pub fn inject_frontmatter_id(raw: &str, value: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re =
        RE.get_or_init(|| Regex::new(r"(?s)^---(\r?\n)(.*?)(\r?\n)---(\r?\n)").expect("id regex"));
    let quoted = format!("'{}'", value.replace('\'', "''"));
    match re.captures(raw) {
        Some(m) => {
            let insert_at = m.get(2).expect("inner").end();
            let nl = &m[3];
            format!("{}{nl}id: {quoted}{}", &raw[..insert_at], &raw[insert_at..])
        }
        None => format!("---\nid: {quoted}\n---\n\n{raw}"),
    }
}

// ---------------------------------------------------------------------------
// meta
// ---------------------------------------------------------------------------

pub const MODES: &[&str] = &["always", "manual", "trigger", "heartbeat"];

pub fn normalize_mode(s: Option<&str>) -> String {
    match s {
        Some(m) if MODES.contains(&m) => m.to_string(),
        _ => "manual".to_string(),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillMeta {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub mode: String,
    pub triggers: Vec<String>,
    /// 有効のときだけ Some(true) (#1116)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_sha512: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store_version: Option<String>,
    pub body: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub built_in: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,
    /// tainted なセッションが書いた (#1103)。付いたら外れない
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tainted: Option<bool>,
    pub cheap_check_capabilities: Vec<String>,
    pub is_persona: bool,
    /// ファイル名 (拡張子なし)。実行時に決まり、frontmatter には書かない
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_base: Option<String>,
}

fn as_list(v: Option<&FmValue>) -> Vec<String> {
    match v {
        Some(FmValue::List(items)) => items.clone(),
        Some(FmValue::Str(s)) if !s.is_empty() => vec![s.clone()],
        _ => Vec::new(),
    }
}

fn as_ms(v: Option<&FmValue>, now: u64) -> u64 {
    match v {
        Some(FmValue::Num(n)) if *n >= 0.0 => *n as u64,
        _ => now,
    }
}

fn is_true(v: Option<&FmValue>) -> bool {
    matches!(v, Some(FmValue::Bool(true)))
}

fn opt_str(fm: &Frontmatter, key: &str) -> Option<String> {
    fm_str(fm, key).map(str::to_string)
}

/// frontmatter + 本文 → meta (`metaFromFrontmatter`)。
pub fn meta_from_frontmatter(
    fm: &Frontmatter,
    body: &str,
    fallback_id: &str,
    now: u64,
) -> SkillMeta {
    let nonempty = |k: &str| fm_str(fm, k).filter(|s| !s.is_empty()).map(str::to_string);
    SkillMeta {
        id: nonempty("id").unwrap_or_else(|| fallback_id.to_string()),
        name: nonempty("name").unwrap_or_else(|| fallback_id.to_string()),
        version: nonempty("version").unwrap_or_else(|| DEFAULT_VERSION.to_string()),
        description: opt_str(fm, "description"),
        author: opt_str(fm, "author"),
        mode: normalize_mode(fm_str(fm, "mode")),
        triggers: as_list(fm_get(fm, "triggers")),
        active: is_true(fm_get(fm, "active")).then_some(true),
        store_id: opt_str(fm, "storeId"),
        store_sha512: opt_str(fm, "storeSha512"),
        store_version: opt_str(fm, "storeVersion"),
        body: body.to_string(),
        created_at: as_ms(fm_get(fm, "createdAt"), now),
        updated_at: as_ms(fm_get(fm, "updatedAt"), now),
        built_in: is_true(fm_get(fm, "builtIn")),
        icon_url: opt_str(fm, "iconUrl"),
        tainted: is_true(fm_get(fm, "tainted")).then_some(true),
        cheap_check_capabilities: as_list(fm_get(fm, "cheapCheckCapabilities")),
        is_persona: is_true(fm_get(fm, "isPersona")),
        file_base: None,
    }
}

fn push_str(fm: &mut Frontmatter, k: &str, v: &Option<String>) {
    if let Some(v) = v.as_ref().filter(|v| !v.is_empty()) {
        fm.push((k.into(), FmValue::Str(v.clone())));
    }
}

/// meta → frontmatter (`frontmatterFromMeta`)。false / 空 / 空配列は書かない。
pub fn frontmatter_from_meta(s: &SkillMeta) -> Frontmatter {
    let mut fm: Frontmatter = vec![
        ("id".into(), FmValue::Str(s.id.clone())),
        ("name".into(), FmValue::Str(s.name.clone())),
        ("version".into(), FmValue::Str(s.version.clone())),
        ("mode".into(), FmValue::Str(s.mode.clone())),
        ("createdAt".into(), FmValue::Num(s.created_at as f64)),
        ("updatedAt".into(), FmValue::Num(s.updated_at as f64)),
    ];
    push_str(&mut fm, "description", &s.description);
    push_str(&mut fm, "author", &s.author);
    if !s.triggers.is_empty() {
        fm.push(("triggers".into(), FmValue::List(s.triggers.clone())));
    }
    if s.active == Some(true) {
        fm.push(("active".into(), FmValue::Bool(true)));
    }
    push_str(&mut fm, "storeId", &s.store_id);
    push_str(&mut fm, "storeSha512", &s.store_sha512);
    push_str(&mut fm, "storeVersion", &s.store_version);
    if s.built_in {
        fm.push(("builtIn".into(), FmValue::Bool(true)));
    }
    push_str(&mut fm, "iconUrl", &s.icon_url);
    if !s.cheap_check_capabilities.is_empty() {
        fm.push((
            "cheapCheckCapabilities".into(),
            FmValue::List(s.cheap_check_capabilities.clone()),
        ));
    }
    if s.is_persona {
        fm.push(("isPersona".into(), FmValue::Bool(true)));
    }
    if s.tainted == Some(true) {
        fm.push(("tainted".into(), FmValue::Bool(true)));
    }
    fm
}

pub fn serialize_skill(s: &SkillMeta) -> String {
    serialize_skill_file(&frontmatter_from_meta(s), &s.body)
}

// ---------------------------------------------------------------------------
// collection
// ---------------------------------------------------------------------------

pub struct Loaded {
    pub items: Vec<SkillMeta>,
    /// 読み飛ばした重複 (id, ファイル名)
    pub duplicates: Vec<(String, String)>,
}

fn is_valid_id(v: Option<&FmValue>) -> bool {
    matches!(v, Some(FmValue::Str(s)) if !s.is_empty() && s.len() <= 256)
}

fn main_files(base_dir: &Path) -> Vec<String> {
    store::list_files(base_dir, SUBDIR)
        .unwrap_or_default()
        .into_iter()
        .filter(|n| n.ends_with(EXT) && !n.ends_with(HISTORY_SUFFIX))
        .collect()
}

fn all_bases(base_dir: &Path) -> Vec<String> {
    store::list_files(base_dir, SUBDIR)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|n| {
            n.strip_suffix(HISTORY_SUFFIX)
                .or_else(|| n.strip_suffix(EXT))
                .map(str::to_string)
        })
        .collect()
}

/// 全件を読む。id が無い / 不正なファイルはファイル名 stem を id として凍結して
/// 書き戻し、重複 id は読み飛ばす。createdAt 昇順 (安定)。
pub fn load_all(base_dir: &Path, now: u64) -> Loaded {
    let mut items: Vec<SkillMeta> = Vec::new();
    let mut duplicates = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for name in main_files(base_dir) {
        let base = name[..name.len() - EXT.len()].to_string();
        let Ok(mut raw) = store::read_file(base_dir, SUBDIR, &name) else {
            tracing::warn!(name, "failed to read skill file, skipped");
            continue;
        };
        let (mut fm, mut body) = parse_skill_file(&raw);
        if !is_valid_id(fm_get(&fm, "id")) {
            raw = inject_frontmatter_id(&raw, &base);
            if let Err(e) = store::write_file(base_dir, SUBDIR, &name, &raw) {
                tracing::warn!(name, "failed to freeze skill id: {e}");
            }
            let parsed = parse_skill_file(&raw);
            fm = parsed.0;
            body = parsed.1;
        }
        let id = fm_str(&fm, "id").unwrap_or(&base).to_string();
        if !seen.insert(id.clone()) {
            tracing::warn!(id, name, "duplicate skill id, skipped (file kept)");
            duplicates.push((id, name));
            continue;
        }
        let mut meta = meta_from_frontmatter(&fm, &body, &base, now);
        meta.id = id;
        meta.file_base = Some(base);
        items.push(meta);
    }
    items.sort_by_key(|s| s.created_at);
    Loaded { items, duplicates }
}

pub fn now_ms() -> u64 {
    crate::ai_sessions::now_ms()
}

fn base_dir(core: &Core) -> Result<PathBuf> {
    settings_base_dir(core)
}

pub fn list(core: &Core) -> Result<Vec<SkillMeta>> {
    Ok(load_all(&base_dir(core)?, now_ms()).items)
}

pub fn get(core: &Core, id: &str) -> Result<Option<SkillMeta>> {
    Ok(list(core)?.into_iter().find(|s| s.id == id))
}

fn not_found(capability: &str, id: &str) -> NoteDeckError {
    NoteDeckError::InvalidInput(format!("{capability}: skill \"{id}\" not found"))
}

pub fn require(core: &Core, capability: &str, id: &str) -> Result<SkillMeta> {
    get(core, id)?.ok_or_else(|| not_found(capability, id))
}

fn write_item(core: &Core, item: &SkillMeta) -> Result<()> {
    let base = item.file_base.as_deref().expect("file_base allocated");
    settings_events::write_file(
        core,
        SUBDIR,
        &format!("{base}{EXT}"),
        &serialize_skill(item),
    )
}

/// 新規のファイル名を割り当てる (`persistItem`)。占有集合はディレクトリの
/// 全 base + 他 item の file_base + 他 item の id (casefold)。候補は storeId →
/// (builtIn なら id) → 表示名の slug。
fn allocate_base(base_dir: &Path, item: &SkillMeta, others: &[SkillMeta]) -> String {
    let mut taken: HashSet<String> = all_bases(base_dir).iter().map(|b| casefold(b)).collect();
    for o in others {
        if let Some(b) = &o.file_base {
            taken.insert(casefold(b));
        }
        taken.insert(casefold(&o.id));
    }
    let preferred = item
        .store_id
        .clone()
        .or_else(|| item.built_in.then(|| item.id.clone()));
    let candidate = match preferred {
        Some(p) if is_slug_conforming(&p) => p,
        _ => slugify_name(&item.name, KIND_FALLBACK),
    };
    resolve_available(&candidate, |c| taken.contains(&casefold(c)))
}

/// `cheapCheckCapabilities` の検査 (#1133 縦切り 5): HEARTBEAT の cheap check は
/// notecore 単独で実行できる cheap な capability だけ。それ以外を含む skill は
/// 登録時 (AI の作成 / 更新 / MisStore からのインストール) に拒む。
pub fn validate_cheap_checks(ids: &[String]) -> Result<()> {
    for id in ids {
        let Some(decl) = crate::capabilities::find(id) else {
            return Err(NoteDeckError::InvalidInput(format!(
                "cheapCheckCapabilities に未知の capability があります: {id}"
            )));
        };
        if !decl.cheap {
            return Err(NoteDeckError::InvalidInput(format!(
                "cheapCheckCapabilities: {id} は cheap ではないので cheap check に使えません"
            )));
        }
        if decl.exec != crate::capabilities::Exec::Core {
            return Err(NoteDeckError::InvalidInput(format!(
                "cheapCheckCapabilities: {id} は手元 (UI) 側の capability なので cheap check に使えません (notecore 単独で実行できるものだけ)"
            )));
        }
    }
    Ok(())
}

/// 追加 (`add`)。createdAt / updatedAt は now。
pub fn create(core: &Core, mut item: SkillMeta) -> Result<SkillMeta> {
    validate_cheap_checks(&item.cheap_check_capabilities)?;
    let dir = base_dir(core)?;
    let now = now_ms();
    item.created_at = now;
    item.updated_at = now;
    let others = load_all(&dir, now).items;
    item.file_base = Some(allocate_base(&dir, &item, &others));
    write_item(core, &item)?;
    Ok(item)
}

/// 更新の差分。None は「変えない」。
#[derive(Clone, Debug, Default)]
pub struct SkillPatch {
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<Option<String>>,
    pub author: Option<Option<String>>,
    pub mode: Option<String>,
    pub triggers: Option<Vec<String>>,
    pub body: Option<String>,
    pub icon_url: Option<Option<String>>,
    pub tainted: Option<bool>,
    pub cheap_check_capabilities: Option<Vec<String>>,
    pub is_persona: Option<bool>,
    pub store_id: Option<String>,
    pub store_sha512: Option<String>,
    pub store_version: Option<String>,
}

fn rename_files(core: &Core, dir: &Path, from: &str, to: &str) -> Result<()> {
    let main_from = format!("{from}{EXT}");
    let main_to = format!("{to}{EXT}");
    if store::resolve_file(dir, SUBDIR, &main_from)?.exists() {
        if store::resolve_file(dir, SUBDIR, &main_to)?.exists() {
            tracing::warn!(from, to, "rename target already exists, skipped");
        } else {
            store::rename_file(dir, SUBDIR, &main_from, &main_to)?;
            core.notify_settings_change(settings_events::SettingsChange {
                subdir: Some(SUBDIR.into()),
                name: main_from,
                op: settings_events::SettingsChangeOp::Delete,
            });
            core.notify_settings_change(settings_events::SettingsChange {
                subdir: Some(SUBDIR.into()),
                name: main_to,
                op: settings_events::SettingsChangeOp::Write,
            });
        }
    }
    let h_from = edit_history::history_file_name(from);
    let h_to = edit_history::history_file_name(to);
    if store::resolve_file(dir, SUBDIR, &h_from)?.exists() {
        if store::resolve_file(dir, SUBDIR, &h_to)?.exists() {
            tracing::warn!(from, to, "history rename target already exists, skipped");
        } else if let Err(e) = store::rename_file(dir, SUBDIR, &h_from, &h_to) {
            tracing::warn!(from, to, "history rename failed: {e}");
        }
    }
    Ok(())
}

/// 表示名の変更にファイル名を追随させる (`renameItemFiles`)。
fn rename_for(core: &Core, dir: &Path, item: &mut SkillMeta, others: &[SkillMeta]) -> Result<()> {
    let Some(old) = item.file_base.clone() else {
        return Ok(());
    };
    let wanted = slugify_name(&item.name, KIND_FALLBACK);
    if wanted == old {
        return Ok(());
    }
    let mut taken: HashSet<String> = all_bases(dir)
        .iter()
        .filter(|b| casefold(b) != casefold(&old))
        .map(|b| casefold(b))
        .collect();
    for o in others {
        if let Some(b) = &o.file_base {
            taken.insert(casefold(b));
        }
    }
    let resolved = resolve_available(&wanted, |c| taken.contains(&casefold(c)));
    if resolved == old {
        return Ok(());
    }
    if casefold(&resolved) == casefold(&old) {
        // 大文字小文字だけの違い: 中間名を経由する
        let mid = resolve_available(
            &slugify_name(&format!("{resolved} mv"), KIND_FALLBACK),
            |c| taken.contains(&casefold(c)),
        );
        rename_files(core, dir, &old, &mid)?;
        rename_files(core, dir, &mid, &resolved)?;
    } else {
        rename_files(core, dir, &old, &resolved)?;
    }
    item.file_base = Some(resolved);
    Ok(())
}

/// 更新 (`update`): 編集前の snapshot を履歴に積み、改名ならファイル名を追随させ、書く。
pub fn update(
    core: &Core,
    id: &str,
    patch: SkillPatch,
    attribution: Option<&Attribution>,
) -> Result<SkillMeta> {
    let dir = base_dir(core)?;
    let now = now_ms();
    let loaded = load_all(&dir, now).items;
    let Some(pos) = loaded.iter().position(|s| s.id == id) else {
        return Err(not_found("skills.update", id));
    };
    let others: Vec<SkillMeta> = loaded
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != pos)
        .map(|(_, s)| s.clone())
        .collect();
    let mut item = loaded[pos].clone();
    let prev = json!({
        "body": item.body,
        "name": item.name,
        "version": item.version,
        "mode": item.mode,
    });
    let renamed = matches!(&patch.name, Some(n) if *n != item.name);
    if let Some(v) = patch.name {
        item.name = v;
    }
    if let Some(v) = patch.version {
        item.version = v;
    }
    if let Some(v) = patch.description {
        item.description = v;
    }
    if let Some(v) = patch.author {
        item.author = v;
    }
    if let Some(v) = patch.mode {
        item.mode = v;
    }
    if let Some(v) = patch.triggers {
        item.triggers = v;
    }
    if let Some(v) = patch.body {
        item.body = v;
    }
    if let Some(v) = patch.icon_url {
        item.icon_url = v;
    }
    if let Some(v) = patch.tainted {
        item.tainted = v.then_some(true);
    }
    if let Some(v) = patch.cheap_check_capabilities {
        validate_cheap_checks(&v)?;
        item.cheap_check_capabilities = v;
    }
    if let Some(v) = patch.is_persona {
        item.is_persona = v;
    }
    if let Some(v) = patch.store_id {
        item.store_id = Some(v);
    }
    if let Some(v) = patch.store_sha512 {
        item.store_sha512 = Some(v);
    }
    if let Some(v) = patch.store_version {
        item.store_version = Some(v);
    }
    item.updated_at = now;
    let changed = prev["body"] != item.body
        || prev["name"] != item.name
        || prev["version"] != item.version
        || prev["mode"] != item.mode;
    if changed {
        if let Some(base) = item.file_base.as_deref() {
            edit_history::push_snapshot(core, &dir, SUBDIR, base, prev, attribution, now)?;
        }
    }
    if renamed {
        rename_for(core, &dir, &mut item, &others)?;
    }
    write_item(core, &item)?;
    Ok(item)
}

/// 有効 / 無効 (`setActive`): 履歴も updatedAt も触らない。
pub fn set_active(core: &Core, id: &str, active: bool) -> Result<SkillMeta> {
    let dir = base_dir(core)?;
    let loaded = load_all(&dir, now_ms()).items;
    let Some(mut item) = loaded.into_iter().find(|s| s.id == id) else {
        return Err(not_found("skills.toggle", id));
    };
    let next = active.then_some(true);
    if item.active != next {
        item.active = next;
        write_item(core, &item)?;
    }
    Ok(item)
}

/// 削除 (`remove`): 本体と履歴を消す。
pub fn remove(core: &Core, id: &str) -> Result<()> {
    let dir = base_dir(core)?;
    let loaded = load_all(&dir, now_ms()).items;
    let Some(item) = loaded.into_iter().find(|s| s.id == id) else {
        return Err(not_found("skills.uninstall", id));
    };
    if let Some(base) = item.file_base {
        settings_events::delete_file(core, SUBDIR, &format!("{base}{EXT}"))?;
        settings_events::delete_file(core, SUBDIR, &edit_history::history_file_name(&base))?;
    }
    Ok(())
}

pub fn history(core: &Core, item: &SkillMeta) -> Result<Vec<edit_history::HistoryEntry>> {
    let base = item.file_base.clone().unwrap_or_else(|| {
        if item.name.is_empty() {
            item.id.clone()
        } else {
            item.name.clone()
        }
    });
    Ok(edit_history::list(&base_dir(core)?, SUBDIR, &base))
}

// ---------------------------------------------------------------------------
// 自己編集の適用 (`src/services/selfEditApply.ts`)
// ---------------------------------------------------------------------------

/// 末尾に追記。base が空か改行終わりなら区切りなし、それ以外は改行 1 つ。
pub fn append_block(base: &str, content: &str) -> String {
    if base.is_empty() || base.ends_with('\n') {
        format!("{base}{content}")
    } else {
        format!("{base}\n{content}")
    }
}

/// `## heading` セクションを置換 (無ければ末尾に追加)。戻り値 (本文, 置換したか)。
pub fn replace_markdown_section(body: &str, heading: &str, new_content: &str) -> (String, bool) {
    let lines: Vec<&str> = body.split('\n').collect();
    let head_re = Regex::new(&format!(r"^##\s+{}\s*$", regex::escape(heading.trim())))
        .expect("heading regex");
    let stop_re = Regex::new(r"^#{1,2}\s").expect("stop regex");
    let Some(start) = lines.iter().position(|l| head_re.is_match(l)) else {
        let prefix = if body.is_empty() || body.ends_with('\n') {
            body.to_string()
        } else {
            format!("{body}\n")
        };
        let sep = if prefix.is_empty() { "" } else { "\n" };
        return (format!("{prefix}{sep}## {heading}\n\n{new_content}"), false);
    };
    let end = lines[start + 1..]
        .iter()
        .position(|l| stop_re.is_match(l))
        .map(|i| start + 1 + i)
        .unwrap_or(lines.len());
    let before = lines[..start].join("\n");
    let after = lines[end..].join("\n");
    let section = format!("## {heading}\n\n{new_content}");
    let parts: Vec<String> = [before, section, after]
        .into_iter()
        .filter(|p| !p.is_empty())
        .collect();
    (parts.join("\n"), true)
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
    fn parse_basic_frontmatter_and_body() {
        let raw = [
            "---",
            "id: translator",
            "name: 翻訳",
            "version: 0.1.0",
            "mode: manual",
            "triggers: [composing-reply, viewing-thread]",
            "builtIn: true",
            "createdAt: 1700000000000",
            "---",
            "body line 1",
            "body line 2",
        ]
        .join("\n");
        let (fm, body) = parse_skill_file(&raw);
        assert_eq!(fm_get(&fm, "version"), Some(&FmValue::Str("0.1.0".into())));
        assert_eq!(
            fm_get(&fm, "createdAt"),
            Some(&FmValue::Num(1700000000000.0))
        );
        assert_eq!(
            fm_get(&fm, "triggers"),
            Some(&FmValue::List(vec![
                "composing-reply".into(),
                "viewing-thread".into()
            ]))
        );
        assert_eq!(fm_get(&fm, "builtIn"), Some(&FmValue::Bool(true)));
        assert_eq!(body, "body line 1\nbody line 2");
    }

    #[test]
    fn parse_quotes_blocks_and_leading_blank_lines() {
        let (fm, _) = parse_skill_file("---\nname: '日本語: コロン入り'\n---\nbody");
        assert_eq!(fm_str(&fm, "name"), Some("日本語: コロン入り"));
        let (fm, _) = parse_skill_file("---\nauthor:\nname: x\n---\n");
        assert_eq!(fm_get(&fm, "author"), Some(&FmValue::Str(String::new())));
        let (fm, _) = parse_skill_file(
            "---\ntriggers:\n  - プラグイン\n  - plugin\n  - 'colon: in value'\n---\n",
        );
        assert_eq!(
            fm_get(&fm, "triggers"),
            Some(&FmValue::List(vec![
                "プラグイン".into(),
                "plugin".into(),
                "colon: in value".into()
            ]))
        );
        for raw in [
            "---\nid: x\n---\n\n# Heading\n",
            "---\nid: x\n---\n\n\n\n# Heading\n",
            "---\nid: x\n---\n# Heading\n",
        ] {
            assert_eq!(parse_skill_file(raw).1, "# Heading\n");
        }
        assert_eq!(parse_skill_file("no frontmatter").1, "no frontmatter");
    }

    #[test]
    fn serialize_round_trips_and_quotes() {
        let meta = SkillMeta {
            id: "aizu".into(),
            name: "三須木藍".into(),
            version: "0.1.0".into(),
            mode: "always".into(),
            triggers: vec!["a".into(), "b".into()],
            built_in: true,
            body: "本文です。\n2 行目。".into(),
            created_at: 1,
            updated_at: 2,
            ..Default::default()
        };
        let text = serialize_skill(&meta);
        assert!(text.starts_with("---\nid: aizu\nname: 三須木藍\nversion: 0.1.0\nmode: always\ncreatedAt: 1\nupdatedAt: 2\ntriggers: [a, b]\nbuiltIn: true\n---\n\n本文です。"));
        let (fm, body) = parse_skill_file(&text);
        let back = meta_from_frontmatter(&fm, &body, "x", 0);
        let mut expect = meta.clone();
        expect.file_base = None;
        assert_eq!(back, expect);
        let fm: Frontmatter = vec![
            ("a".into(), FmValue::Str("has: colon".into())),
            ("b".into(), FmValue::Str("has, comma".into())),
        ];
        let text = serialize_skill_file(&fm, "");
        assert!(text.contains("a: 'has: colon'\nb: 'has, comma'"));
        let (fm2, _) = parse_skill_file(&text);
        assert_eq!(fm_str(&fm2, "a"), Some("has: colon"));
        assert_eq!(fm_str(&fm2, "b"), Some("has, comma"));
    }

    #[test]
    fn meta_omits_false_and_empty_and_defaults_mode() {
        let (fm, body) =
            parse_skill_file("---\nname: x\nmode: weird\nactive: false\ntainted: true\n---\nb");
        let m = meta_from_frontmatter(&fm, &body, "fallback", 7);
        assert_eq!(m.id, "fallback");
        assert_eq!(m.mode, "manual");
        assert_eq!(m.active, None);
        assert_eq!(m.tainted, Some(true));
        assert_eq!(m.created_at, 7);
        let fm = frontmatter_from_meta(&m);
        assert!(fm
            .iter()
            .all(|(k, _)| k != "active" && k != "builtIn" && k != "triggers"));
        assert!(fm
            .iter()
            .any(|(k, v)| k == "tainted" && *v == FmValue::Bool(true)));
    }

    #[test]
    fn inject_id_matches_ts() {
        let out = inject_frontmatter_id("---\nname: 天気\nmode: manual\n---\n\n# body\n", "tenki");
        let (fm, body) = parse_skill_file(&out);
        assert_eq!(fm_str(&fm, "id"), Some("tenki"));
        assert_eq!(body, "# body\n");
        let crlf = inject_frontmatter_id("---\r\nname: x\r\n---\r\nbody", "id1");
        assert!(crlf.contains("\r\nid: 'id1'\r\n---"));
        assert_eq!(
            inject_frontmatter_id("# 本文だけ\n", "a"),
            "---\nid: 'a'\n---\n\n# 本文だけ\n"
        );
        let over = inject_frontmatter_id("---\nid: ''\n---\nb", "z");
        assert_eq!(fm_str(&parse_skill_file(&over).0, "id"), Some("z"));
        assert_eq!(
            inject_frontmatter_id("x", "a"),
            inject_frontmatter_id("x", "a")
        );
    }

    #[test]
    fn load_freezes_ids_skips_duplicates_and_sorts() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let base = base_dir(&core).unwrap();
        store::write_file(
            &base,
            SUBDIR,
            "My Skill.md",
            "---\nname: My Skill\ncreatedAt: 5\n---\nbody text",
        )
        .unwrap();
        store::write_file(
            &base,
            SUBDIR,
            "a.md",
            "---\nid: a\nname: A\ncreatedAt: 1\n---\nx",
        )
        .unwrap();
        store::write_file(
            &base,
            SUBDIR,
            "a-dup.md",
            "---\nid: a\nname: Dup\ncreatedAt: 2\n---\ny",
        )
        .unwrap();
        store::write_file(&base, SUBDIR, "a.history.json5", "{entries: []}").unwrap();
        let loaded = load_all(&base, 0);
        assert_eq!(
            loaded
                .items
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "My Skill"]
        );
        assert_eq!(loaded.items[1].file_base.as_deref(), Some("My Skill"));
        assert_eq!(
            loaded.duplicates,
            vec![("a".to_string(), "a.md".to_string())]
        );
        let frozen = store::read_file(&base, SUBDIR, "My Skill.md").unwrap();
        assert!(frozen.contains("id: 'My Skill'"));
        // 2 回目は変わらない
        load_all(&base, 0);
        assert_eq!(
            store::read_file(&base, SUBDIR, "My Skill.md").unwrap(),
            frozen
        );
    }

    #[test]
    fn create_update_rename_history_and_remove() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let base = base_dir(&core).unwrap();
        let created = create(
            &core,
            SkillMeta {
                id: "x1-abcd".into(),
                name: "My New Skill".into(),
                version: DEFAULT_VERSION.into(),
                mode: "manual".into(),
                body: "old body".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(created.file_base.as_deref(), Some("my-new-skill"));
        assert!(store::resolve_file(&base, SUBDIR, "my-new-skill.md")
            .unwrap()
            .exists());
        // storeId があればそれがファイル名
        let ent = create(
            &core,
            SkillMeta {
                id: "e".into(),
                name: "Whatever".into(),
                store_id: Some("ent-skill".into()),
                mode: "manual".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(ent.file_base.as_deref(), Some("ent-skill"));
        // 本文更新で履歴に old body が残る
        let attr = Attribution {
            by: Some(json!({"kind": "ai.chat"})),
            reason: Some("why".into()),
        };
        let updated = update(
            &core,
            "x1-abcd",
            SkillPatch {
                body: Some("new body".into()),
                ..Default::default()
            },
            Some(&attr),
        )
        .unwrap();
        assert_eq!(updated.body, "new body");
        let h = history(&core, &updated).unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].snapshot["body"], "old body");
        assert_eq!(h[0].reason.as_deref(), Some("why"));
        // 改名でファイルが移り、id は変わらない
        let renamed = update(
            &core,
            "x1-abcd",
            SkillPatch {
                name: Some("Beta".into()),
                ..Default::default()
            },
            None,
        )
        .unwrap();
        assert_eq!(renamed.file_base.as_deref(), Some("beta"));
        assert!(store::resolve_file(&base, SUBDIR, "beta.md")
            .unwrap()
            .exists());
        assert!(store::resolve_file(&base, SUBDIR, "beta.history.json5")
            .unwrap()
            .exists());
        assert!(!store::resolve_file(&base, SUBDIR, "my-new-skill.md")
            .unwrap()
            .exists());
        assert_eq!(get(&core, "x1-abcd").unwrap().unwrap().name, "Beta");
        // active は履歴に乗らない
        let active = set_active(&core, "x1-abcd", true).unwrap();
        assert_eq!(active.active, Some(true));
        assert!(store::read_file(&base, SUBDIR, "beta.md")
            .unwrap()
            .contains("active: true"));
        set_active(&core, "x1-abcd", false).unwrap();
        assert!(!store::read_file(&base, SUBDIR, "beta.md")
            .unwrap()
            .contains("active"));
        assert_eq!(history(&core, &renamed).unwrap().len(), 2);
        remove(&core, "x1-abcd").unwrap();
        assert!(get(&core, "x1-abcd").unwrap().is_none());
        assert!(!store::resolve_file(&base, SUBDIR, "beta.history.json5")
            .unwrap()
            .exists());
    }

    #[test]
    fn cheap_checks_must_be_core_and_cheap() {
        assert!(validate_cheap_checks(&["time.now".into(), "account.list".into()]).is_ok());
        let unknown = validate_cheap_checks(&["nope.x".into()])
            .unwrap_err()
            .to_string();
        assert!(unknown.contains("未知の capability"));
        let device = validate_cheap_checks(&["column.list".into()])
            .unwrap_err()
            .to_string();
        assert!(device.contains("手元 (UI) 側"));
        let heavy = validate_cheap_checks(&["notes.create".into()])
            .unwrap_err()
            .to_string();
        assert!(heavy.contains("cheap ではない"));
        // create も拒む
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let err = create(
            &core,
            SkillMeta {
                id: "x".into(),
                name: "X".into(),
                mode: "heartbeat".into(),
                cheap_check_capabilities: vec!["column.list".into()],
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("cheap check"));
        assert!(list(&core).unwrap().is_empty());
    }

    #[test]
    fn self_edit_apply_matches_ts() {
        assert_eq!(append_block("body", "added"), "body\nadded");
        assert_eq!(append_block("body\n", "added"), "body\nadded");
        assert_eq!(append_block("", "added"), "added");
        assert_eq!(
            replace_markdown_section("## Foo\nold", "Foo", "new"),
            ("## Foo\n\nnew".into(), true)
        );
        assert_eq!(
            replace_markdown_section("just text", "New", "fresh content"),
            ("just text\n\n## New\n\nfresh content".into(), false)
        );
        assert_eq!(
            replace_markdown_section("", "New", "x"),
            ("## New\n\nx".into(), false)
        );
        assert_eq!(
            replace_markdown_section("## A\none\n# Top\nrest", "A", "two"),
            ("## A\n\ntwo\n# Top\nrest".into(), true)
        );
        assert!(!replace_markdown_section("## foo\nold", "Foo", "new").1);
        assert!(replace_markdown_section("## A.B (test)\nold", "A.B (test)", "new").1);
    }
}
