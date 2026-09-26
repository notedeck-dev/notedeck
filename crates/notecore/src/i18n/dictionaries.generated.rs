// 生成物 — 編集しない。locales/ から `pnpm gen:i18n` で作る (#135)

/// (言語コード, その言語の `_native` / `_capabilities` / `_achievementLabels` / `_performanceData` 節の JSON)
pub const DICTIONARIES: &[(&str, &str)] = &[
    ("ja-JP", include_str!("../../locales/ja-JP.json")),
    ("en-US", include_str!("../../locales/en-US.json")),
];

/// 公開済みの言語 (OS の言語から自動で選んでよい言語)
pub const PUBLISHED: &[&str] = &["ja-JP", "en-US"];
