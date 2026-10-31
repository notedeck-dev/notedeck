//! notes キャッシュの掃き出し (eviction) の設定を settings.json5 から解く (#1131)。
//!
//! 以前は端末 (TS) がプリセット表を持ち、起動のたびに全窓が Rust へ送っていた。
//! 入力は settings.json5 だけで適用先は Rust の DB なので、ここで解いて起動時に
//! コアが自分で適用する。設定画面からの変更も同じ解決器を通る (表は 1 つ)。
//!
//! 設計判断: notedeck の差別化要素は「過去ノートを一瞬でローカル全文検索」なので、
//! 既定は notecli の `EvictionConfig::default()` (バランス) を尊重する。
//! 「ストレージ優先」を選ぶヘビーユーザーだけが明示的に下げる。

use notecli::db::EvictionConfig;

/// settings.json5 のキー (端末の `src/settings/schema.ts` と同じ平坦なキー)
pub const PRESET_KEY: &str = "cache.evictionPreset";
pub const PER_ACCOUNT_LIMIT_KEY: &str = "cache.perAccountLimit";
pub const TTL_DAYS_KEY: &str = "cache.ttlDays";

/// 「検索優先」: 完全永続。掃き出しなし
pub fn search_priority() -> EvictionConfig {
    EvictionConfig {
        per_account_limit: None,
        ttl_days: None,
        per_timeline_limit: None,
    }
}

/// 「バランス」: notecli の既定 (暴走防止だけ)
pub fn balanced() -> EvictionConfig {
    EvictionConfig::default()
}

/// 「ストレージ優先」: 旧既定と同等の重い掃除
pub fn storage_priority() -> EvictionConfig {
    EvictionConfig {
        per_account_limit: Some(50_000),
        ttl_days: Some(90),
        per_timeline_limit: None,
    }
}

/// settings.json5 の本文から掃き出しの設定を解く。無い / 壊れているときはバランス。
/// `custom` のときは `cache.perAccountLimit` / `cache.ttlDays` をそのまま使う
/// (無ければ制限なし)
pub fn resolve(text: &str) -> EvictionConfig {
    let Ok(v) = json5::from_str::<serde_json::Value>(text) else {
        return balanced();
    };
    match v.get(PRESET_KEY).and_then(|p| p.as_str()) {
        Some("search-priority") => search_priority(),
        Some("storage-priority") => storage_priority(),
        Some("custom") => EvictionConfig {
            per_account_limit: v.get(PER_ACCOUNT_LIMIT_KEY).and_then(|n| n.as_i64()),
            ttl_days: v.get(TTL_DAYS_KEY).and_then(|n| n.as_i64()),
            // バケット毎の所属上限 (notecli#30 v5 §5)。UI 未公開・既定 null
            per_timeline_limit: None,
        },
        _ => balanced(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `EvictionConfig` は PartialEq を持たないので中身で比べる
    fn fields(c: &EvictionConfig) -> (Option<i64>, Option<i64>, Option<i64>) {
        (c.per_account_limit, c.ttl_days, c.per_timeline_limit)
    }

    #[test]
    fn default_and_broken_input_fall_back_to_balanced() {
        let b = fields(&balanced());
        assert_eq!(fields(&resolve("")), b);
        assert_eq!(fields(&resolve("not json")), b);
        assert_eq!(fields(&resolve("{ theme: 'dark' }")), b);
        assert_eq!(
            fields(&resolve("{ 'cache.evictionPreset': 'balanced' }")),
            b
        );
        assert_eq!(fields(&resolve("{ 'cache.evictionPreset': 'unknown' }")), b);
    }

    #[test]
    fn named_presets_resolve_to_their_tables() {
        assert_eq!(
            fields(&resolve("{ 'cache.evictionPreset': 'search-priority' }")),
            (None, None, None)
        );
        assert_eq!(
            fields(&resolve("{ 'cache.evictionPreset': 'storage-priority' }")),
            (Some(50_000), Some(90), None)
        );
    }

    #[test]
    fn custom_reads_the_flat_keys_and_treats_missing_as_unlimited() {
        let c = resolve(
            "{ 'cache.evictionPreset': 'custom', 'cache.perAccountLimit': 1234, 'cache.ttlDays': 7 }",
        );
        assert_eq!(fields(&c), (Some(1234), Some(7), None));
        let unlimited = resolve("{ 'cache.evictionPreset': 'custom', 'cache.ttlDays': null }");
        assert_eq!(fields(&unlimited), (None, None, None));
    }
}
