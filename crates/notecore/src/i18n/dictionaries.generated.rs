// 生成物 — 編集しない。locales/ から `pnpm gen:i18n` で作る (#135)

/// (言語コード, その言語の `_native` 節と `_capabilities` 節の JSON)
pub const DICTIONARIES: &[(&str, &str)] = &[
    ("ja-JP", include_str!("../../locales/ja-JP.json")),
    ("en-US", include_str!("../../locales/en-US.json")),
];
