// 生成物 — 手で編集しない。正本は crates/notecore/capabilities.json5 の permissions 節、
// 生成は `pnpm gen:capabilities` (scripts/gen-capabilities.mjs)。JS 側 (src/permissions/
// keys.generated.ts) と同じ宣言から生成され、解決結果の一致は golden vector で検査する (#1133)。

/// 権限キーの語彙 (順序は golden の keys と同じ)。
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
pub const READONLY_KEYS: &[&str] = &[
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
pub const SAFE_EXTRA_KEYS: &[&str] = &[
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
pub const THIRD_PARTY_DENY_KEYS: &[&str] = &[
    "tasks.run",
    "ai.persona.write",
    "skills.write",
    "backup.create",
];

/// external principal の Misskey コンテンツ read 下限 (#712 §5.3)。
pub const EXTERNAL_READ_FLOOR: &[&str] = &[
    "notes.read",
    "account.read",
    "drive.read",
    "clips.read",
];

/// NoteDeck ローカル私的データの read キー (#712 §4.4)。
pub const LOCAL_READ_KEYS: &[&str] = &[
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
