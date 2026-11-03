//! principal 別権限プロファイルの解決 (#1099)。
//!
//! `permissions.json5` の本文から principal の実効 granted 集合を導く純関数。
//! フロントの `resolveProfiledIn` (src/permissions/store.ts) と同じ意味論を
//! Rust で独立に持つ — HTTP API の external gate が WebView の状態 (JS から
//! push された認可表) に依存しないようにするため。XSS や依存の汚染で WebView
//! 内に入った JS は自分を `user` と名乗れるので、JS から受け取った認可表を
//! Rust が信じる構造は「認可境界が攻撃面と同じ側にある」状態だった (#1098)。
//!
//! 二重実装のずれは `src/permissions/golden/vectors.json` で機械検査する
//! (JS 側 `goldenVectors.test.ts` と同じファイルを読む)。preset / floor /
//! clamp の語彙を変えたら両側を直し、`pnpm gen:golden-permissions` で期待値を
//! 採取し直す。

use std::collections::BTreeSet;

use serde_json::Value;

// 語彙と preset / floor / deny の集合は生成物 (正本は crates/notecore/capabilities.json5 の
// permissions 節、`pnpm gen:capabilities`)。JS 側と同じ宣言から生成され、解決結果の一致は
// golden vector で検査する。
include!("permissions_keys.generated.rs");

/// プロファイルを持つ principal。`user` はプロファイル無し (常時許可) なので
/// ここには無い。
///
/// HTTP gate が使うのは `External` だけだが、解決の意味論は principal 別の
/// backfill / clamp を含むので、golden で全 principal を検査できるよう
/// 揃えている (本番コードで未使用の variant は意図的)。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub enum PrincipalId {
    AiChat,
    AiHeartbeat,
    Plugin,
    External,
    Scratchpad,
}

impl PrincipalId {
    /// principal 名 (JS 側の `Principal.kind`) → id。golden vector と
    /// AI ループの要求 (#1133) が使う。
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "ai.chat" => Some(Self::AiChat),
            "ai.heartbeat" => Some(Self::AiHeartbeat),
            "plugin" => Some(Self::Plugin),
            "external" => Some(Self::External),
            "scratchpad" => Some(Self::Scratchpad),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::AiChat => "ai.chat",
            Self::AiHeartbeat => "ai.heartbeat",
            Self::Plugin => "plugin",
            Self::External => "external",
            Self::Scratchpad => "scratchpad",
        }
    }

    fn is_third_party(self) -> bool {
        matches!(self, Self::Plugin | Self::External)
    }
}

/// 実効 granted 集合 (true になるキー)。
pub type Granted = BTreeSet<&'static str>;

fn preset(name: &str) -> Option<Granted> {
    match name {
        "readonly" => Some(READONLY_KEYS.iter().copied().collect()),
        "safe" => Some(
            READONLY_KEYS
                .iter()
                .chain(SAFE_EXTRA_KEYS)
                .copied()
                .collect(),
        ),
        "full" => Some(PERMISSION_KEYS.iter().copied().collect()),
        _ => None,
    }
}

/// custom map の欠損キー backfill 値 (schema.ts `backfillValue` と同じ)。
fn backfill(key: &str, id: PrincipalId) -> bool {
    match key {
        "deck.read" => id != PrincipalId::External,
        "deck.write" => matches!(id, PrincipalId::AiChat | PrincipalId::Plugin),
        _ => false,
    }
}

/// 新規インストール時の既定プロファイル (store.ts `defaultPermissionsFile`)。
fn default_profile(id: PrincipalId) -> Granted {
    match id {
        PrincipalId::AiChat => preset("safe").expect("safe preset"),
        PrincipalId::AiHeartbeat | PrincipalId::Scratchpad => {
            preset("readonly").expect("readonly preset")
        }
        PrincipalId::Plugin => {
            let mut g = preset("safe").expect("safe preset");
            g.insert("network.external");
            g
        }
        PrincipalId::External => {
            let mut g = preset("readonly").expect("readonly preset");
            for k in LOCAL_READ_KEYS {
                g.remove(k);
            }
            g
        }
    }
}

/// 保存されたプロファイル 1 つの正規化 (schema.ts `normalizeProfile`)。
/// object でない / preset が語彙外なら readonly。custom は保存済み bool だけ
/// 採用し、欠損・非 bool は backfill 値で埋める。
fn normalize_profile(profile: &Value, id: PrincipalId) -> Granted {
    let preset_name = profile
        .get("preset")
        .and_then(Value::as_str)
        .unwrap_or("readonly");
    if preset_name != "custom" {
        return preset(preset_name).unwrap_or_else(|| preset("readonly").expect("readonly preset"));
    }
    let custom = profile.get("custom");
    PERMISSION_KEYS
        .iter()
        .copied()
        .filter(
            |key| match custom.and_then(|c| c.get(key)).and_then(Value::as_bool) {
                Some(saved) => saved,
                None => backfill(key, id),
            },
        )
        .collect()
}

/// principal 別の floor / ceiling clamp (store.ts `clampForPrincipal`)。
fn clamp(mut granted: Granted, id: PrincipalId) -> Granted {
    if id.is_third_party() {
        for k in THIRD_PARTY_DENY_KEYS {
            granted.remove(k);
        }
    }
    if id == PrincipalId::External {
        granted.extend(EXTERNAL_READ_FLOOR.iter().copied());
    }
    granted
}

/// パース済みドキュメント → principal の実効 granted。`None` = ファイル無し
/// (既定プロファイル)。principals が object でない、または principal が無い
/// ときも既定。principal はあるが object でない / preset 不明は readonly。
fn resolve_document(doc: Option<&Value>, id: PrincipalId) -> Granted {
    let profile = doc
        .and_then(|d| d.get("principals"))
        .and_then(Value::as_object)
        .and_then(|p| p.get(id.as_str()));
    let granted = match profile {
        Some(p) => normalize_profile(p, id),
        None => default_profile(id),
    };
    clamp(granted, id)
}

/// permissions.json5 の本文 → principal の実効 granted。
///
/// - `None` (ファイル無し) → 既定プロファイル
/// - パース失敗 (破損) → [`resolve_fallback`] (readonly)
pub fn resolve(content: Option<&str>, id: PrincipalId) -> Granted {
    match content {
        None => resolve_document(None, id),
        Some(text) => match json5::from_str::<Value>(text) {
            Ok(doc) => resolve_document(Some(&doc), id),
            Err(_) => resolve_fallback(id),
        },
    }
}

/// [`resolve`] に外部トークンの scope (#1292) を重ねる: 実効 granted =
/// principal の実効権限 ∩ scope。上限は principal 側のままで、clamp も principal
/// 側だけに掛ける — read 下限は scope で外せる (post-only のトークンを発行できる)
/// が、恒久 deny は principal 側で既に落ちているので scope で開くことはない。
/// scope は PermissionsConfig と同じ形で、外部アプリと同じ規則で正規化する
/// (欠損キーは false)。`None` は scope 無し (= [`resolve`] と同じ)。
/// JS 側 `resolveProfiledIn(file, id, tokenScope)` と golden で一致検査する
pub fn resolve_scoped(content: Option<&str>, id: PrincipalId, scope: Option<&Value>) -> Granted {
    let mut granted = resolve(content, id);
    if let Some(scope) = scope {
        let scope = normalize_profile(scope, PrincipalId::External);
        granted.retain(|k| scope.contains(k));
    }
    granted
}

/// principal の preset 名 (store.ts `normalizeProfile` と同じ規則: 不明 / 欠損は
/// readonly、ファイル無しは既定プロファイルの名前、破損は readonly)。
/// `meta.permissions` が返す表示用の値で、実効 granted は [`resolve`] が決める。
pub fn preset_of(content: Option<&str>, id: PrincipalId) -> &'static str {
    const VALID: &[&str] = &["readonly", "safe", "full", "custom"];
    let Some(text) = content else {
        return match id {
            PrincipalId::AiChat => "safe",
            PrincipalId::AiHeartbeat | PrincipalId::Scratchpad => "readonly",
            PrincipalId::Plugin | PrincipalId::External => "custom",
        };
    };
    let Ok(doc) = json5::from_str::<Value>(text) else {
        return "readonly";
    };
    match doc
        .get("principals")
        .and_then(|p| p.get(id.as_str()))
        .and_then(|p| p.get("preset"))
        .and_then(Value::as_str)
    {
        Some(name) => VALID
            .iter()
            .copied()
            .find(|v| *v == name)
            .unwrap_or("readonly"),
        None => "readonly",
    }
}

/// トークンの scope (#1292) として保存してよい形か: object で preset が語彙内
/// (custom なら custom は object か省略)。値の正規化は [`resolve_scoped`] が行う
pub fn is_profile_shaped(value: &Value) -> bool {
    const VALID: &[&str] = &["readonly", "safe", "full", "custom"];
    let Some(obj) = value.as_object() else {
        return false;
    };
    let Some(preset) = obj.get("preset").and_then(Value::as_str) else {
        return false;
    };
    if !VALID.contains(&preset) {
        return false;
    }
    match obj.get("custom") {
        None | Some(Value::Null) => preset != "custom",
        Some(Value::Object(_)) => true,
        Some(_) => false,
    }
}

/// permissions.json5 の `confirmSkips[scope]` に capability があるか (#714)。
/// 形は `{ confirmSkips: { 'ai.chat': ['notes.create', ...] } }`。パース失敗は false。
pub fn confirm_skipped(content: &str, scope: &str, capability_id: &str) -> bool {
    let Ok(doc) = json5::from_str::<Value>(content) else {
        return false;
    };
    doc.get("confirmSkips")
        .and_then(|s| s.get(scope))
        .and_then(Value::as_array)
        .map(|list| list.iter().any(|v| v.as_str() == Some(capability_id)))
        .unwrap_or(false)
}

/// ファイルが読めない / 壊れているときの最小権限 (store.ts `safeFallbackFile`
/// #719)。既定プロファイルへ倒すと、権限を絞っていたユーザーが破損だけで
/// 無言のうちに広がる。
pub fn resolve_fallback(id: PrincipalId) -> Granted {
    clamp(preset("readonly").expect("readonly preset"), id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preset_of_follows_store_normalization() {
        assert_eq!(preset_of(None, PrincipalId::AiChat), "safe");
        assert_eq!(preset_of(None, PrincipalId::Plugin), "custom");
        assert_eq!(preset_of(Some("{ broken"), PrincipalId::AiChat), "readonly");
        assert_eq!(
            preset_of(
                Some("{ principals: { 'ai.chat': { preset: 'full' } } }"),
                PrincipalId::AiChat
            ),
            "full"
        );
        assert_eq!(
            preset_of(
                Some("{ principals: { 'ai.chat': { preset: 'weird' } } }"),
                PrincipalId::AiChat
            ),
            "readonly"
        );
        assert_eq!(preset_of(Some("{}"), PrincipalId::External), "readonly");
    }

    #[test]
    fn confirm_skipped_reads_scope_list() {
        let content = "{ confirmSkips: { 'ai.chat': ['notes.create'], 'plugin:x': ['a.b'] } }";
        assert!(confirm_skipped(content, "ai.chat", "notes.create"));
        assert!(!confirm_skipped(content, "ai.chat", "a.b"));
        assert!(!confirm_skipped(content, "ai.heartbeat", "notes.create"));
        assert!(!confirm_skipped("{ broken", "ai.chat", "notes.create"));
        assert!(!confirm_skipped("{}", "ai.chat", "notes.create"));
    }

    #[test]
    fn missing_file_external_is_misskey_read_floor_only() {
        let g = resolve(None, PrincipalId::External);
        assert_eq!(g, EXTERNAL_READ_FLOOR.iter().copied().collect::<Granted>());
    }

    #[test]
    fn full_preset_is_clamped_for_third_parties_but_not_ai_chat() {
        let text =
            "{ principals: { external: { preset: 'full' }, 'ai.chat': { preset: 'full' } } }";
        let ext = resolve(Some(text), PrincipalId::External);
        for k in THIRD_PARTY_DENY_KEYS {
            assert!(!ext.contains(k), "{k} must be denied for external");
        }
        let chat = resolve(Some(text), PrincipalId::AiChat);
        assert_eq!(chat.len(), PERMISSION_KEYS.len());
    }

    #[test]
    fn custom_all_false_keeps_external_read_floor() {
        let text =
            "{ principals: { external: { preset: 'custom', custom: { 'notes.read': false } } } }";
        let g = resolve(Some(text), PrincipalId::External);
        assert!(g.contains("notes.read"));
        assert!(!g.contains("notes.write"));
    }

    /// 外部トークンの scope (#1292) は external の実効権限との交差。read 下限は
    /// scope で外せ、恒久 deny は scope で開かない
    #[test]
    fn token_scope_intersects_with_external_profile() {
        let file = "{ principals: { external: { preset: 'full' } } }";
        let scope = json5::from_str::<Value>(
            "{ preset: 'custom', custom: { 'notes.write': true, 'skills.write': true } }",
        )
        .unwrap();
        let g = resolve_scoped(Some(file), PrincipalId::External, Some(&scope));
        assert!(g.contains("notes.write"));
        assert!(
            !g.contains("notes.read"),
            "read 下限は scope に持ち込まない"
        );
        assert!(!g.contains("skills.write"), "恒久 deny は scope で開かない");
        // scope 無しは resolve と同じ
        assert_eq!(
            resolve_scoped(Some(file), PrincipalId::External, None),
            resolve(Some(file), PrincipalId::External)
        );
        // 外部アプリ側で許していないものは scope で開けない
        let narrow = "{ principals: { external: { preset: 'readonly' } } }";
        let full = json5::from_str::<Value>("{ preset: 'full' }").unwrap();
        assert!(
            !resolve_scoped(Some(narrow), PrincipalId::External, Some(&full))
                .contains("notes.write")
        );
    }

    #[test]
    fn is_profile_shaped_accepts_preset_and_optional_custom_map() {
        let ok = |t: &str| is_profile_shaped(&json5::from_str::<Value>(t).unwrap());
        assert!(ok("{ preset: 'readonly' }"));
        assert!(ok("{ preset: 'custom', custom: { 'notes.write': true } }"));
        assert!(!ok("{ preset: 'custom' }"), "custom には map が要る");
        assert!(!ok("{ preset: 'admin' }"));
        assert!(!ok("{ preset: 'full', custom: [] }"));
        assert!(!ok("'full'"));
    }

    #[test]
    fn corrupted_file_falls_back_to_readonly() {
        let g = resolve(Some("{ principals: {"), PrincipalId::Plugin);
        assert_eq!(g, preset("readonly").unwrap());
    }

    /// 共有 golden vector (#1099)。JS 側 `goldenVectors.test.ts` と同じ
    /// ファイルを読み、同じ granted 集合になることを検証する。
    #[test]
    fn rust_resolve_matches_golden_vectors() {
        #[derive(serde::Deserialize)]
        struct GoldenCase {
            name: String,
            principal: String,
            file: Option<String>,
            #[serde(default, rename = "tokenScope")]
            token_scope: Option<String>,
            granted: Vec<String>,
        }
        #[derive(serde::Deserialize)]
        struct GoldenFile {
            keys: Vec<String>,
            cases: Vec<GoldenCase>,
        }
        let golden: GoldenFile =
            serde_json::from_str(include_str!("../../../src/permissions/golden/vectors.json"))
                .expect("parse vectors.json");
        assert_eq!(
            golden.keys,
            PERMISSION_KEYS
                .iter()
                .map(|k| k.to_string())
                .collect::<Vec<_>>(),
            "PERMISSION_KEYS が JS 側と一致しません (capabilities.json5 の permissions 節から再生成する)"
        );
        assert!(!golden.cases.is_empty());
        for case in &golden.cases {
            let id = PrincipalId::parse(&case.principal)
                .unwrap_or_else(|| panic!("unknown principal in golden case `{}`", case.name));
            let scope = case.token_scope.as_deref().map(|text| {
                json5::from_str::<Value>(text).unwrap_or_else(|e| {
                    panic!("bad tokenScope in golden case `{}`: {e}", case.name)
                })
            });
            let got: Vec<String> = resolve_scoped(case.file.as_deref(), id, scope.as_ref())
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(got, case.granted, "golden case `{}`", case.name);
        }
    }
}
