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

/// 権限キーの語彙。正本はフロントの `PERMISSION_KEYS` (src/permissions/schema.ts)。
/// 一致は golden の `keys` で検査する。
pub const PERMISSION_KEYS: &[&str] = &[
    "notes.read",
    "notes.readArchive",
    "notes.write",
    "notes.react",
    "account.read",
    "account.write",
    "account.actAs",
    "drive.read",
    "drive.write",
    "memos.read",
    "memos.write",
    "clips.read",
    "clips.write",
    "drafts.read",
    "drafts.write",
    "network.external",
    "clipboard",
    "notifications",
    "tasks.run",
    "ai.invoke",
    "ai.persona.write",
    "skills.read",
    "skills.write",
    "theme.write",
    "styles.write",
    "navbar.write",
    "keybinds.write",
    "performance.write",
    "widgets.read",
    "widgets.write",
    "plugins.read",
    "plugins.write",
    "queries.read",
    "queries.write",
    "ai.sessions.read",
    "logs.read",
    "vault.use",
    "files.export",
    "backup.create",
    "deck.read",
    "deck.write",
];

/// `readonly` preset で ON になるキー。
const READONLY_KEYS: &[&str] = &[
    "notes.read",
    "account.read",
    "drive.read",
    "memos.read",
    "clips.read",
    "drafts.read",
    "skills.read",
    "widgets.read",
    "plugins.read",
    "queries.read",
    "ai.sessions.read",
    "logs.read",
    "deck.read",
];

/// `safe` preset で readonly に加えて ON になるキー。
const SAFE_EXTRA_KEYS: &[&str] = &[
    "notes.react",
    "memos.write",
    "clips.write",
    "drafts.write",
    "clipboard",
    "notifications",
    "tasks.run",
    "ai.invoke",
    "skills.write",
    "widgets.write",
    "plugins.write",
    "queries.write",
    "deck.write",
];

/// 第三者 principal (plugin / external) への恒久 deny (#712 §3.7 / §3.8)。
/// 保存値に関わらず OFF — `full` preset でも通らない。
pub const THIRD_PARTY_DENY_KEYS: &[&str] = &[
    "skills.write",
    "ai.persona.write",
    "tasks.run",
    "backup.create",
];

/// external principal の Misskey コンテンツ read 下限 (#712 §5.3)。
/// 「トークンを発行して渡す行為そのものが Misskey コンテンツ read への同意」。
pub const EXTERNAL_READ_FLOOR: &[&str] =
    &["notes.read", "account.read", "drive.read", "clips.read"];

/// NoteDeck ローカル私的データの read キー (#712 §4.4)。external の既定は
/// readonly からこれらを落とした縮小 custom。
const LOCAL_READ_KEYS: &[&str] = &[
    "notes.readArchive",
    "memos.read",
    "drafts.read",
    "skills.read",
    "widgets.read",
    "plugins.read",
    "queries.read",
    "ai.sessions.read",
    "logs.read",
    "deck.read",
];

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
    /// golden vector の principal 名 → id。
    #[cfg(test)]
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

    fn as_str(self) -> &'static str {
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
            "PERMISSION_KEYS が JS 側と一致しません (schema.ts を正本に直す)"
        );
        assert!(!golden.cases.is_empty());
        for case in &golden.cases {
            let id = PrincipalId::parse(&case.principal)
                .unwrap_or_else(|| panic!("unknown principal in golden case `{}`", case.name));
            let got: Vec<String> = resolve(case.file.as_deref(), id)
                .into_iter()
                .map(String::from)
                .collect();
            assert_eq!(got, case.granted, "golden case `{}`", case.name);
        }
    }
}
