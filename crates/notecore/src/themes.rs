//! テーマ (`themes/<slug>.ndtheme.json5`) とカスタム CSS (ルートの `custom.css`) の
//! 読み書き (#1133 縦切り 4 第 3 弾)。デバイス側 (`src/stores/theme.ts` /
//! `themeFileSync.ts` / `selfEditApply.ts`) と同じ規則。状態は持たず毎回ファイルを読む。
//! 画面への適用 (CSS 変数 / adoptedStyleSheets / OS の明暗) はデバイスに残る。

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::edit_history::{self, Attribution, HISTORY_SUFFIX};
use crate::error::Result;
use crate::json5_out::{self, J5};
use crate::settings_events;
use crate::settings_slug::{casefold, resolve_available, slugify_name};
use crate::settings_store as store;
use notecli::error::NoteDeckError;

pub const SUBDIR: &str = "themes";
pub const EXT: &str = ".ndtheme.json5";
pub const CSS_FILE: &str = "custom.css";
const KIND_FALLBACK: &str = "theme";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub id: String,
    pub name: String,
    /// `dark` | `light`
    pub base: String,
    #[specta(type = std::collections::HashMap<String, String>)]
    pub props: IndexMap<String, String>,
    /// NoteDeck 独自メタ (storeId / storeSha512 / storeVersion / installedFor …)。順序を保つ
    #[serde(rename = "$notedeck", default, skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<std::collections::HashMap<String, serde_json::Value>>)]
    pub notedeck: Option<IndexMap<String, Value>>,
    /// ファイル名 (拡張子なし)。実行時に決まり、ファイルには書かない
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_base: Option<String>,
}

impl Theme {
    pub fn installed_for(&self) -> Vec<String> {
        self.notedeck
            .as_ref()
            .and_then(|m| m.get("installedFor"))
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn store_id(&self) -> Option<&str> {
        self.notedeck.as_ref()?.get("storeId")?.as_str()
    }
}

// ---------------------------------------------------------------------------
// codec
// ---------------------------------------------------------------------------

fn base_of(v: Option<&Value>) -> String {
    if v.and_then(Value::as_str) == Some("light") {
        "light".into()
    } else {
        "dark".into()
    }
}

fn props_of(m: IndexMap<String, Value>) -> IndexMap<String, String> {
    m.into_iter()
        .map(|(k, v)| {
            let s = match v {
                Value::String(s) => s,
                other => other.to_string(),
            };
            (k, s)
        })
        .collect()
}

/// テーマ本体の JSON5 (`installTheme` に渡す code、ファイルも同じ) を読む。
/// props が無ければ None。
pub fn parse_theme_code(code: &str) -> Option<(Theme, Option<Value>)> {
    // J5 経由で読む: 同じキーが重なっても後の値を採る (JSON5.parse と同じ)。
    // id の凍結は既存の不正な id の後ろに追記するので、構造体へ直接読むと
    // 次の読込で重複キーのエラーになる
    let raw: J5 = json5::from_str(code).ok()?;
    let J5::Obj(_) = &raw else {
        return None;
    };
    let props = match raw.get("props")? {
        J5::Obj(pairs) => {
            let mut m: IndexMap<String, Value> = IndexMap::new();
            for (k, v) in pairs {
                m.insert(k.clone(), v.to_value());
            }
            m
        }
        _ => return None,
    };
    let notedeck = match raw.get("$notedeck") {
        Some(J5::Obj(pairs)) => {
            let mut m: IndexMap<String, Value> = IndexMap::new();
            for (k, v) in pairs {
                m.insert(k.clone(), v.to_value());
            }
            Some(m)
        }
        _ => None,
    };
    let id = raw.get("id").map(J5::to_value);
    let theme = Theme {
        id: raw.get("id").and_then(J5::as_str).unwrap_or("").to_string(),
        name: raw
            .get("name")
            .and_then(J5::as_str)
            .unwrap_or("")
            .to_string(),
        base: base_of(raw.get("base").map(J5::to_value).as_ref()),
        props: props_of(props),
        notedeck,
        file_base: None,
    };
    Some((theme, id))
}

fn theme_to_j5(t: &Theme, include_notedeck: bool) -> J5 {
    let mut pairs = vec![
        ("id".to_string(), J5::Str(t.id.clone())),
        ("name".to_string(), J5::Str(t.name.clone())),
        ("base".to_string(), J5::Str(t.base.clone())),
        (
            "props".to_string(),
            J5::Obj(
                t.props
                    .iter()
                    .map(|(k, v)| (k.clone(), J5::Str(v.clone())))
                    .collect(),
            ),
        ),
    ];
    if include_notedeck {
        if let Some(m) = &t.notedeck {
            pairs.push((
                "$notedeck".to_string(),
                J5::Obj(
                    m.iter()
                        .map(|(k, v)| (k.clone(), J5::from_value(v)))
                        .collect(),
                ),
            ));
        }
    }
    J5::Obj(pairs)
}

/// ファイル用 (`themeFileSync.serializeTheme`): JSON5、末尾改行なし。
pub fn serialize_theme_file(t: &Theme) -> String {
    json5_out::stringify(&theme_to_j5(t, true))
}

/// 表示 / diff / 履歴用 (`selfEditApply.serializeTheme`): `JSON.stringify(theme, null, 2)`。
pub fn serialize_theme_display(t: &Theme) -> String {
    #[derive(Serialize)]
    struct Display<'a> {
        id: &'a str,
        name: &'a str,
        base: &'a str,
        props: &'a IndexMap<String, String>,
        #[serde(rename = "$notedeck", skip_serializing_if = "Option::is_none")]
        notedeck: &'a Option<IndexMap<String, Value>>,
    }
    serde_json::to_string_pretty(&Display {
        id: &t.id,
        name: &t.name,
        base: &t.base,
        props: &t.props,
        notedeck: &t.notedeck,
    })
    .unwrap_or_default()
}

/// `mergeThemeUpdate(current, patch)`
#[derive(Clone, Debug, Default)]
pub struct ThemePatch {
    pub name: Option<String>,
    pub base: Option<String>,
    pub props: Option<IndexMap<String, String>>,
}

pub fn merge_theme_update(current: &Theme, patch: &ThemePatch) -> Theme {
    let mut props = current.props.clone();
    if let Some(p) = &patch.props {
        for (k, v) in p {
            props.insert(k.clone(), v.clone());
        }
    }
    Theme {
        id: current.id.clone(),
        name: patch
            .name
            .clone()
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| current.name.clone()),
        base: patch.base.clone().unwrap_or_else(|| current.base.clone()),
        props,
        notedeck: current.notedeck.clone(),
        file_base: current.file_base.clone(),
    }
}

/// 履歴の snapshot (`{ id, name, base, props }`) → テーマ (`themeFromSnapshot`)。
pub fn theme_from_snapshot(snap: &Value) -> Theme {
    let props = snap
        .get("props")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        v.as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| v.to_string()),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    Theme {
        id: snap.get("id").and_then(Value::as_str).unwrap_or("").into(),
        name: snap
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        base: base_of(snap.get("base")),
        props,
        notedeck: None,
        file_base: None,
    }
}

fn snapshot_of(t: &Theme) -> Value {
    json!({ "id": t.id, "name": t.name, "base": t.base, "props": t.props })
}

// ---------------------------------------------------------------------------
// collection
// ---------------------------------------------------------------------------

fn base_dir(core: &Core) -> Result<PathBuf> {
    settings_base_dir(core)
}

fn is_valid_id(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::String(s)) if !s.is_empty() && s.len() <= 256)
}

fn all_bases(dir: &Path) -> Vec<String> {
    store::list_files(dir, SUBDIR)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|n| {
            n.strip_suffix(HISTORY_SUFFIX)
                .or_else(|| n.strip_suffix(EXT))
                .map(str::to_string)
        })
        .collect()
}

/// 全件 (バイト順)。id が無ければ `custom-<ファイル名>` を凍結して書き戻し、
/// props が無いものと重複 id は読み飛ばす。
pub fn load_all(dir: &Path) -> Vec<Theme> {
    let mut out: Vec<Theme> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for name in store::list_files(dir, SUBDIR).unwrap_or_default() {
        if !name.ends_with(EXT) || name.ends_with(HISTORY_SUFFIX) {
            continue;
        }
        let Ok(mut raw) = store::read_file(dir, SUBDIR, &name) else {
            continue;
        };
        let Some((mut theme, raw_id)) = parse_theme_code(&raw) else {
            tracing::warn!(name, "[theme] not a valid item — skipped (file kept)");
            continue;
        };
        if !is_valid_id(raw_id.as_ref()) {
            let effective = format!("custom-{name}");
            match json5_out::inject_json5_id(&raw, "id", &effective) {
                Ok(frozen) => {
                    if let Err(e) = store::write_file(dir, SUBDIR, &name, &frozen) {
                        tracing::warn!(name, "failed to freeze theme id: {e}");
                    }
                    raw = frozen;
                    if let Some((t, _)) = parse_theme_code(&raw) {
                        theme = t;
                    }
                }
                Err(e) => tracing::warn!(name, "failed to freeze theme id: {e}"),
            }
            theme.id = effective;
        }
        if theme.name.is_empty() {
            theme.name = name.clone();
        }
        if !seen.insert(theme.id.clone()) {
            tracing::warn!(id = %theme.id, name, "duplicate theme id, skipped (file kept)");
            continue;
        }
        theme.file_base = Some(name[..name.len() - EXT.len()].to_string());
        out.push(theme);
    }
    out
}

pub fn list(core: &Core) -> Result<Vec<Theme>> {
    Ok(load_all(&base_dir(core)?))
}

pub fn get(core: &Core, id: &str) -> Result<Option<Theme>> {
    Ok(list(core)?.into_iter().find(|t| t.id == id))
}

fn allocate_base(dir: &Path, item: &Theme, others: &[Theme]) -> String {
    let mut taken: HashSet<String> = all_bases(dir).iter().map(|b| casefold(b)).collect();
    for o in others {
        if let Some(b) = &o.file_base {
            taken.insert(casefold(b));
        }
        taken.insert(casefold(&o.id));
    }
    resolve_available(&slugify_name(&item.name, KIND_FALLBACK), |c| {
        taken.contains(&casefold(c))
    })
}

fn write_theme(core: &Core, t: &Theme) -> Result<()> {
    let base = t.file_base.as_deref().expect("file_base allocated");
    settings_events::write_file(
        core,
        SUBDIR,
        &format!("{base}{EXT}"),
        &serialize_theme_file(t),
    )
}

/// `installTheme(code, forAccountKeys, attribution)`: 同じ id は更新 (`$notedeck` と
/// ファイル名を引き継ぎ、編集前を履歴に積む)、無ければ追加。戻り値は書いたテーマ。
pub fn install_theme(
    core: &Core,
    code: &str,
    for_account_keys: &[String],
    attribution: Option<&Attribution>,
) -> Result<Theme> {
    let dir = base_dir(core)?;
    let Some((mut theme, _)) = parse_theme_code(code) else {
        return Err(NoteDeckError::InvalidInput(
            "theme: code must be a JSON5 object with props".into(),
        ));
    };
    if theme.id.is_empty() {
        theme.id = format!("custom-{}", crate::ai_sessions::now_ms());
    }
    if theme.name.is_empty() {
        theme.name = "Untitled".into();
    }
    let all = load_all(&dir);
    let existing = all.iter().find(|t| t.id == theme.id).cloned();
    if let Some(ex) = &existing {
        if theme.notedeck.is_none() {
            theme.notedeck = ex.notedeck.clone();
        }
        theme.file_base = ex.file_base.clone();
    }
    if !for_account_keys.is_empty() {
        let mut keys = theme.installed_for();
        for k in for_account_keys {
            if !keys.contains(k) {
                keys.push(k.clone());
            }
        }
        theme
            .notedeck
            .get_or_insert_with(IndexMap::new)
            .insert("installedFor".into(), json!(keys));
    }
    if let Some(ex) = &existing {
        if let Some(base) = ex.file_base.as_deref() {
            edit_history::push_snapshot(
                core,
                &dir,
                SUBDIR,
                base,
                snapshot_of(ex),
                attribution,
                crate::ai_sessions::now_ms(),
            )?;
        }
    }
    if theme.file_base.is_none() {
        let others: Vec<Theme> = all.iter().filter(|t| t.id != theme.id).cloned().collect();
        theme.file_base = Some(allocate_base(&dir, &theme, &others));
    }
    write_theme(core, &theme)?;
    Ok(theme)
}

/// `removeTheme(id)`: 本体と履歴を消す。無ければ false。
pub fn remove(core: &Core, id: &str) -> Result<bool> {
    let Some(t) = get(core, id)? else {
        return Ok(false);
    };
    if let Some(base) = t.file_base {
        settings_events::delete_file(core, SUBDIR, &format!("{base}{EXT}"))?;
        settings_events::delete_file(core, SUBDIR, &edit_history::history_file_name(&base))?;
    }
    Ok(true)
}

/// `themeHistoryBase(id)` = fileBase があればそれ、無ければ id。
pub fn history(core: &Core, id: &str) -> Result<Vec<edit_history::HistoryEntry>> {
    let base = get(core, id)?
        .and_then(|t| t.file_base)
        .unwrap_or_else(|| id.to_string());
    Ok(edit_history::list(&base_dir(core)?, SUBDIR, &base))
}

/// アカウントの安定キー (`accountScopeKey` = `host:userId`)。
pub async fn account_scope_keys(core: &Core) -> Result<Vec<String>> {
    Ok(core
        .blocking(crate::account_service::list_public)
        .await?
        .iter()
        .map(|a| format!("{}:{}", a.host, a.user_id))
        .collect())
}

// ---------------------------------------------------------------------------
// custom.css
// ---------------------------------------------------------------------------

pub fn read_css(core: &Core) -> Result<String> {
    Ok(store::read_root_file(&base_dir(core)?, CSS_FILE).unwrap_or_default())
}

/// `setCustomCss(css, attribution)`: 変わっていれば編集前を履歴に積み、書く。
pub fn write_css(core: &Core, css: &str, attribution: Option<&Attribution>) -> Result<()> {
    let dir = base_dir(core)?;
    let prev = read_css(core)?;
    if prev != css {
        edit_history::push_snapshot_root(
            core,
            &dir,
            CSS_FILE,
            json!({ "body": prev }),
            attribution,
            crate::ai_sessions::now_ms(),
        )?;
    }
    settings_events::write_root_file(core, CSS_FILE, css)
}

pub fn css_history(core: &Core) -> Result<Vec<edit_history::HistoryEntry>> {
    Ok(edit_history::list_root(&base_dir(core)?, CSS_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_keys_take_the_last_value() {
        // id 凍結は不正な id の後ろに有効な id を追記する
        let (t, raw_id) =
            parse_theme_code("{ id: '', name: 'X', props: { a: '#fff', b: 1 }, id: 'custom-x' }")
                .unwrap();
        assert_eq!(t.id, "custom-x");
        assert_eq!(raw_id, Some(json!("custom-x")));
        assert_eq!(t.props.keys().collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(t.props["b"], "1");
    }

    fn core_in(dir: &Path) -> Core {
        let core = Core::new();
        core.set_app_dir(dir.to_path_buf());
        let base = settings_base_dir(&core).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        core
    }

    #[test]
    fn codec_matches_device_rules() {
        let (t, raw_id) = parse_theme_code("{ id: 'x', name: 'N', base: 'light', props: { b: '#000', a: '#fff' }, $notedeck: { storeId: 's', installedFor: ['h:u'] } }").unwrap();
        assert_eq!(raw_id, Some(json!("x")));
        assert_eq!(t.props.keys().collect::<Vec<_>>(), vec!["b", "a"]);
        assert_eq!(t.installed_for(), vec!["h:u"]);
        assert_eq!(t.store_id(), Some("s"));
        assert_eq!(
            serialize_theme_file(&t),
            "{\n  id: 'x',\n  name: 'N',\n  base: 'light',\n  props: {\n    b: '#000',\n    a: '#fff',\n  },\n  $notedeck: {\n    storeId: 's',\n    installedFor: [\n      'h:u',\n    ],\n  },\n}"
        );
        assert!(serialize_theme_display(&t).starts_with("{\n  \"id\": \"x\",\n  \"name\": \"N\",\n  \"base\": \"light\",\n  \"props\": {\n    \"b\": \"#000\",\n    \"a\": \"#fff\"\n  },"));
        assert!(parse_theme_code("{ name: 'not a theme' }").is_none());
        assert!(parse_theme_code("{ broken").is_none());
        let (no_base, _) = parse_theme_code("{ props: {} }").unwrap();
        assert_eq!(no_base.base, "dark");
        let merged = merge_theme_update(
            &t,
            &ThemePatch {
                name: Some(String::new()),
                base: None,
                props: Some(IndexMap::from([
                    ("a".to_string(), "#111".to_string()),
                    ("c".to_string(), "#222".to_string()),
                ])),
            },
        );
        assert_eq!(merged.name, "N");
        assert_eq!(merged.props.keys().collect::<Vec<_>>(), vec!["b", "a", "c"]);
        assert_eq!(merged.props["a"], "#111");
        assert_eq!(merged.notedeck, t.notedeck);
        let snap = theme_from_snapshot(&json!({"id": "s", "props": {"x": "1"}}));
        assert_eq!(
            (snap.id.as_str(), snap.name.as_str(), snap.base.as_str()),
            ("s", "", "dark")
        );
    }

    #[test]
    fn load_freezes_ids_and_install_updates_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        let base = base_dir(&core).unwrap();
        store::write_file(
            &base,
            SUBDIR,
            "My Theme.ndtheme.json5",
            "{\n  name: 'My Theme',\n  props: { bg: '#000' },\n}",
        )
        .unwrap();
        store::write_file(
            &base,
            SUBDIR,
            "bad.ndtheme.json5",
            "{ name: 'not a theme' }",
        )
        .unwrap();
        let all = load_all(&base);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].id, "custom-My Theme.ndtheme.json5");
        assert_eq!(all[0].file_base.as_deref(), Some("My Theme"));
        let frozen = store::read_file(&base, SUBDIR, "My Theme.ndtheme.json5").unwrap();
        assert!(frozen.contains("id: 'custom-My Theme.ndtheme.json5'"));
        load_all(&base);
        assert_eq!(
            store::read_file(&base, SUBDIR, "My Theme.ndtheme.json5").unwrap(),
            frozen
        );
        // 新規は表示名の slug、既存 (同じ id) は更新で $notedeck と file_base を引き継ぐ
        let t = install_theme(&core, "{ id: 'red', name: 'Red!', props: { accent: '#f00' }, $notedeck: { storeId: 'red-store' } }", &["h:u".into()], None).unwrap();
        assert_eq!(t.file_base.as_deref(), Some("red"));
        assert_eq!(t.installed_for(), vec!["h:u"]);
        let t2 = install_theme(
            &core,
            "{ id: 'red', name: 'Red!', props: { accent: '#0f0' } }",
            &["h:u".into(), "h:v".into()],
            None,
        )
        .unwrap();
        assert_eq!(t2.store_id(), Some("red-store"));
        assert_eq!(t2.installed_for(), vec!["h:u", "h:v"]);
        assert_eq!(t2.file_base.as_deref(), Some("red"));
        let h = history(&core, "red").unwrap();
        assert_eq!(h.len(), 1);
        assert_eq!(h[0].snapshot["props"]["accent"], "#f00");
        assert!(h[0].snapshot.get("$notedeck").is_none());
        // 名前が衝突すれば連番
        let t3 = install_theme(&core, "{ name: 'Red', props: {} }", &[], None).unwrap();
        assert_eq!(t3.file_base.as_deref(), Some("red-2"));
        assert!(t3.id.starts_with("custom-"));
        assert!(remove(&core, "red").unwrap());
        assert!(!remove(&core, "red").unwrap());
        assert!(history(&core, "red").unwrap().is_empty());
    }

    #[test]
    fn css_round_trip_with_root_history() {
        let dir = tempfile::tempdir().unwrap();
        let core = core_in(dir.path());
        assert_eq!(read_css(&core).unwrap(), "");
        write_css(&core, "body { margin: 0; }", None).unwrap();
        write_css(&core, "body { margin: 0; }", None).unwrap();
        // 本人の連続保存は畳まれるので、別の書き手で 2 件目を積む
        let ai = Attribution {
            by: Some(json!({"kind": "ai.chat"})),
            reason: None,
        };
        write_css(&core, "a {}", Some(&ai)).unwrap();
        assert_eq!(read_css(&core).unwrap(), "a {}");
        let h = css_history(&core).unwrap();
        assert_eq!(h.len(), 2);
        assert_eq!(h[0].snapshot["body"], "body { margin: 0; }");
        assert_eq!(h[1].snapshot["body"], "");
    }
}
