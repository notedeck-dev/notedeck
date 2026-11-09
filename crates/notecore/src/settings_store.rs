//! 設定ファイルの domain service (#782)。
//!
//! commands/settings.rs から検証・atomic 書込・export/import バンドル収集を
//! 吸い上げ、コマンドハンドラを「パス解決 + service 呼び出し」の薄い層にする。
//! `Layout` を引数に取り AppHandle に依存しないため、temp dir で直接
//! ユニットテストできる (従来はテスト側が export/import ロジックを再実装していた)。

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use notecli::error::NoteDeckError;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::app_dir::Layout;
use crate::error::Result;

/// 設定ディレクトリの中の領域 (#1333 §1)。物理的な場所は `Layout` が決める
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Area {
    /// 持ち出す単位 (設定)
    Config,
    /// 人の記録 (メモ / AI セッション / 人格と記憶)
    Data,
    /// この機械の状態。同期しない
    State,
    /// この機械の記録だが、再編前は設定の隣にあったもの (tutorial / theme-dropins /
    /// client)。再編 (#1334) で `state/` へ移る。旧配置のままの機械では設定の隣から読む
    StateFromV1,
}

impl Area {
    pub fn dir(self, layout: &Layout) -> &Path {
        match self {
            Area::Config => layout.config(),
            Area::Data => layout.data(),
            Area::State => layout.state(),
            Area::StateFromV1 => {
                if layout.is_legacy() {
                    layout.config()
                } else {
                    layout.state()
                }
            }
        }
    }
}

/// 論理 subdir (IPC / バックアップのキーに出る名前) → 置き場と属性の写像 (#1333 §1)。
///
/// - `backup`: 設定バックアップ (export / import) に含めるか
/// - `ipc`: 汎用の list / read / write / delete / rename (コマンド) で到達できるか。
///   false のものは専用の構造化操作だけが触る
#[derive(Clone, Copy, Debug)]
pub struct Subdir {
    pub name: &'static str,
    pub area: Area,
    /// 領域の中の物理ディレクトリ名 (論理名と違うときだけ別の値)
    pub dir: &'static str,
    pub backup: bool,
    pub ipc: bool,
}

const fn config_dir(name: &'static str) -> Subdir {
    Subdir {
        name,
        area: Area::Config,
        dir: name,
        backup: true,
        ipc: true,
    }
}

pub const SUBDIRS: &[Subdir] = &[
    config_dir("profiles"),
    config_dir("themes"),
    config_dir("plugins"),
    config_dir("snippets"),
    config_dir("widgets"),
    config_dir("skills"),
    // カラムクエリ (#783 Phase 1.5)。settingsFs の QUERIES_DIR に対応
    config_dir("queries"),
    // メモは人の記録 (AI も書く)
    Subdir {
        name: "memos",
        area: Area::Data,
        dir: "memos",
        backup: true,
        ipc: true,
    },
    // AI セッションは notemaid が単一の書き手 (#1133)。汎用のファイル操作では触らせず、
    // `ai_session_*` の構造化された操作に限る
    Subdir {
        name: "sessions",
        area: Area::Data,
        dir: "sessions",
        backup: true,
        ipc: false,
    },
    // デッキプロファイルの、この機械の状態 (#1333 §3): 窓の配置 (`windows[]`) と
    // カラムの一時入力 (`windowId` / `aiCurrentSessionId` / `query` / `mfmText` /
    // `aiscriptCode` / `aiInitialInput`)。`state/deck/<profile id>.json5`
    Subdir {
        name: "deck-state",
        area: Area::State,
        dir: "deck",
        backup: false,
        ipc: true,
    },
];

/// 論理 subdir の名前だけ (バックアップの列挙やメッセージ用)
pub fn subdir_names() -> impl Iterator<Item = &'static str> {
    SUBDIRS.iter().map(|s| s.name)
}

pub fn subdir(name: &str) -> Option<&'static Subdir> {
    SUBDIRS.iter().find(|s| s.name == name)
}

/// ルート直下の設定ファイルの属性 (#1333 §1)。`backup` / `ipc` は `Subdir` と同じ意味
#[derive(Clone, Copy, Debug)]
pub struct RootFile {
    pub name: &'static str,
    pub area: Area,
    pub backup: bool,
    pub ipc: bool,
}

const fn root(name: &'static str) -> RootFile {
    RootFile {
        name,
        area: Area::Config,
        backup: true,
        ipc: true,
    }
}

/// Allowed root-level filenames (no subdirectory) と属性。
pub const ROOT_FILES: &[RootFile] = &[
    root("custom.css"),
    root("keybinds.json5"),
    root("ai.json5"),
    root("AI.md"),
    root("performance.json5"),
    root("navbar.json5"),
    root("postform.json5"),
    root("settings.json5"),
    root("tasks.json5"),
    // チュートリアルの達成記録 + NoteDeck 独自実績 (#1029)。達成判定は `resetAt` と
    // 機械の状態からの導出で、持ち込んだ先で食い違うので状態 (再編で state/ へ。実績が
    // バックアップから落ちる代償は利用者が了承、#1334)
    RootFile {
        name: "tutorial.json5",
        area: Area::StateFromV1,
        backup: false,
        ipc: true,
    },
    // principal 別権限 + 確認スキップ (#712 / #714)。capability 層に write を
    // 公開しない制約はここではなく capability registry 側で担保している
    // (settingsFs の固定名ラッパーのみが本コマンドに到達する)
    root("permissions.json5"),
    // themes/ の素の .json5 を取り込んだ記録 (元ファイル名 → 採用 ID、#1041)。この機械の
    // 記録 (再編で state/ へ、#1334)。記録の無い機械で再採用して複製が出ないよう、採用した
    // コピー側に `dropInSource` (元の本文の hash) を持たせる
    RootFile {
        name: "theme-dropins.json5",
        area: Area::StateFromV1,
        backup: false,
        ipc: true,
    },
    // 表示言語 (#135)。端末ごとの値だが持ち出して困らない
    root("locale.json5"),
    // この端末の構成 (embedded / resident、#1106 段階 3a)。復元先で存在しない
    // 常駐を探さないよう、バックアップに含めない
    RootFile {
        name: "client.json5",
        area: Area::StateFromV1,
        backup: false,
        ipc: true,
    },
    // Vault の接続一覧 (#564)。接続 id は ai.json5 から参照されるので復元先で宙に
    // 浮かないようバックアップに含める。変更口は `vault_upsert_connection` 系だけで、
    // 汎用の読み書きには出さない (#1333 §1)。同意 / 鍵の有無 / 時刻は state 側の
    // `connections-meta.json` (Rust だけが書く。allowlist には載せない)
    RootFile {
        name: CONNECTIONS_FILE,
        area: Area::Config,
        backup: true,
        ipc: false,
    },
    // この機械の権限の状態 (#1333 §4): 「今後確認しない」の記憶と、前回起動時の
    // 実効 granted の写し。方針 (`permissions.json5` の principals) とは別に置く
    RootFile {
        name: "permissions-meta.json5",
        area: Area::State,
        backup: false,
        ipc: true,
    },
    // この機械の UI の状態 (#1333 §3): ペットの位置 / ズーム / 投稿フォームの前回値。
    // 窓を動かすたび・投稿のたびに変わる値は設定 (settings.json5) に書かない
    RootFile {
        name: "ui.json5",
        area: Area::State,
        backup: false,
        ipc: true,
    },
];

/// Vault の接続一覧のファイル名 (`vault::connections_store` と共有)
pub const CONNECTIONS_FILE: &str = "connections.json";

pub fn root_file(name: &str) -> Option<&'static RootFile> {
    ROOT_FILES.iter().find(|f| f.name == name)
}

fn root_file_names() -> String {
    ROOT_FILES
        .iter()
        .map(|f| f.name)
        .collect::<Vec<_>>()
        .join(", ")
}

/// Validate a subdirectory name against the whitelist.
pub fn validate_subdir(name: &str) -> Result<&'static Subdir> {
    subdir(name).ok_or_else(|| {
        NoteDeckError::InvalidInput(format!(
            "Invalid subdirectory: {name}. Allowed: {}",
            subdir_names().collect::<Vec<_>>().join(", ")
        ))
    })
}

/// 汎用の IPC (list / read / write / delete / rename) から触ってよい subdir か
pub fn validate_ipc_subdir(name: &str) -> Result<&'static Subdir> {
    let s = validate_subdir(name)?;
    if !s.ipc {
        return Err(NoteDeckError::InvalidInput(format!(
            "{name} is not reachable through the generic file commands"
        )));
    }
    Ok(s)
}

/// 汎用の IPC から触ってよいルート直下のファイルか
pub fn validate_ipc_root_file(name: &str) -> Result<&'static RootFile> {
    let f = root_file(name).ok_or_else(|| {
        NoteDeckError::InvalidInput(format!(
            "Invalid root file: {name}. Allowed: {}",
            root_file_names()
        ))
    })?;
    if !f.ipc {
        return Err(NoteDeckError::InvalidInput(format!(
            "{name} is not reachable through the generic file commands"
        )));
    }
    Ok(f)
}

/// 論理 subdir の物理ディレクトリ
pub fn subdir_path(layout: &Layout, name: &str) -> Result<PathBuf> {
    let s = validate_subdir(name)?;
    Ok(s.area.dir(layout).join(s.dir))
}

/// Validate a filename to prevent path traversal.
pub fn validate_filename(name: &str) -> Result<()> {
    if name.is_empty() {
        return Err(NoteDeckError::InvalidInput(
            "Filename must not be empty".to_string(),
        ));
    }
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid filename: {name}"
        )));
    }
    // ドット始まりは設定ではない (`.git` / `.gitignore` / 書込中の一時ファイル)。利用者が
    // 設定フォルダを `git init` した瞬間に `.git/config` が射程に入らないよう、allowlist /
    // 汎用 IPC / バックアップのすべてで無視する (#1333 原則 5)
    if name.starts_with('.') {
        return Err(NoteDeckError::InvalidInput(format!(
            "Filename must not start with a dot: {name}"
        )));
    }
    // Reject Windows reserved characters
    if name.chars().any(|c| "<>:\"|?*".contains(c)) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Filename contains reserved characters: {name}"
        )));
    }
    if name.len() > 128 {
        return Err(NoteDeckError::InvalidInput(
            "Filename too long (max 128 chars)".to_string(),
        ));
    }
    Ok(())
}

/// Resolve the full path for a settings file.
pub fn resolve_file(layout: &Layout, subdir: &str, name: &str) -> Result<PathBuf> {
    let dir = subdir_path(layout, subdir)?;
    validate_filename(name)?;
    Ok(dir.join(name))
}

/// Resolve the full path for a root-level settings file.
pub fn resolve_root_file(layout: &Layout, name: &str) -> Result<PathBuf> {
    let Some(f) = root_file(name) else {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid root file: {name}. Allowed: {}",
            root_file_names()
        )));
    };
    validate_filename(name)?;
    Ok(f.area.dir(layout).join(f.name))
}

/// 設定ファイルを原子的に書き込む (#719)。同ディレクトリの一時ファイルへ
/// 書いて fsync してから rename する。直接 `fs::write` (truncate → write) だと
/// 書き込み途中のクラッシュ・電源断で途中切れの壊れたファイルが残りうる —
/// 特に permissions.json5 が壊れると権限記憶が失われる。rename は同一 FS 内で
/// atomic なので、読み手は常に旧内容か新内容のいずれか完全な方を見る。
///
/// `mode` 指定時は rename 前に一時ファイルへ適用する (機密ファイルが一瞬でも
/// 緩い権限で見えないように)。
pub fn atomic_write(path: &Path, content: &str, mode: Option<u32>) -> Result<()> {
    let parent = path.parent().ok_or_else(|| {
        NoteDeckError::InvalidInput(format!("path has no parent: {}", path.display()))
    })?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| NoteDeckError::InvalidInput(format!("invalid path: {}", path.display())))?;
    // 一時名は同ディレクトリ内 (cross-device rename を避ける) + pid で衝突回避。
    let tmp = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));

    let write_result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        #[cfg(unix)]
        if let Some(m) = mode {
            use std::os::unix::fs::PermissionsExt;
            f.set_permissions(fs::Permissions::from_mode(m))?;
        }
        // fsync — rename が耐久性を持つのは中身がディスクに届いてから。
        f.sync_all()?;
        Ok(())
    })();
    #[cfg(not(unix))]
    let _ = mode;
    if let Err(e) = write_result {
        let _ = fs::remove_file(&tmp);
        return Err(NoteDeckError::InvalidInput(format!(
            "Failed to write {}: {e}",
            path.display()
        )));
    }

    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        NoteDeckError::InvalidInput(format!("Failed to write {}: {e}", path.display()))
    })
}

/// List files in a settings subdirectory (sorted).
pub fn list_files(layout: &Layout, subdir: &str) -> Result<Vec<String>> {
    let dir = subdir_path(layout, subdir)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut names = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
        if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                if name.starts_with('.') {
                    continue;
                }
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

/// Read a settings file as a UTF-8 string.
pub fn read_file(layout: &Layout, subdir: &str, name: &str) -> Result<String> {
    let path = resolve_file(layout, subdir, name)?;
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write a settings file (creates parent directories if needed).
/// `sessions/` は AI 会話内容 (prompt に誤入力された秘密を含みうる) のため 0o600。
pub fn write_file(layout: &Layout, subdir: &str, name: &str, content: &str) -> Result<()> {
    let path = resolve_file(layout, subdir, name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            NoteDeckError::InvalidInput(format!(
                "Failed to create directory {}: {e}",
                parent.display()
            ))
        })?;
    }
    let mode = if subdir == "sessions" {
        Some(0o600)
    } else {
        None
    };
    atomic_write(&path, content, mode)
}

/// 設定フォルダを Git で管理する人のための `.gitignore` の雛形 (#1333 §5)。
///
/// 無ければ書く (利用者の編集を決定的書込で潰さない)。除外するのは設定ではないもの:
/// 編集履歴のサイドカー、この機械の記録 (tutorial / theme-dropins / client)、人の記録
/// (sessions / memos / notemaid の人格と記憶)、書込中の一時ファイル。接続の同意と鍵の
/// 有無、確認の結果は §4 で `state/` に出たので connections.json / permissions.json5 は
/// 除外しない。再編 (#1334) で `notedeck/` を動かすときは `.git*` も一緒に動かし、
/// 雛形が無編集なら消す
pub const GITIGNORE_TEMPLATE: &str = "\
# NoteDeck settings folder (#1333). Portable, but not meant to be public:
# it holds account bindings (user@host), external service URLs, code that runs
# (plugins / widgets / skills) and permission policies.
#
# The entries below are not settings (machine records, personal records,
# temporary files), so keep them out of Git.
*.history.json5
tutorial.json5
theme-dropins.json5
client.json5
sessions/
memos/
notemaid/
.*.tmp
";

/// 再編後 (#1334) の雛形: `config/` には設定しか無いので、書込中の一時ファイルだけ
pub const GITIGNORE_TEMPLATE_V1: &str = "\
# NoteDeck settings folder (#1333 / #1334). Portable, but not meant to be public:
# it holds account bindings (user@host), external service URLs, code that runs
# (plugins / widgets / skills) and permission policies.
.*.tmp
";

/// `.gitignore` が無ければ雛形を置く。あれば触らない。失敗は warn 止まり
pub fn ensure_gitignore(layout: &Layout) {
    let path = layout.config().join(".gitignore");
    if path.exists() {
        return;
    }
    let template = if layout.is_legacy() {
        GITIGNORE_TEMPLATE
    } else {
        GITIGNORE_TEMPLATE_V1
    };
    if let Err(e) = fs::create_dir_all(layout.config()) {
        tracing::warn!(%e, "cannot create the settings dir for .gitignore");
        return;
    }
    if let Err(e) = atomic_write(&path, template, None) {
        tracing::warn!(%e, "cannot write the .gitignore template");
    }
}

/// AI の人格と記憶のファイル (#1162)。`notemaid/` は allowlist (汎用の読み書き) には
/// 入れず、バックアップの対象としてだけ名指しで扱う。notecore は名前を知るだけ
pub const WORKSPACE_DIR: &str = "notemaid";
pub const WORKSPACE_FILES: &[&str] = &["SOUL.md", "USER.md", "MEMORY.md"];

/// zero-width / bidi 制御など、見えないのに意味を変える文字
fn has_invisible_unicode(s: &str) -> bool {
    s.chars().any(|c| {
        matches!(
            c,
            '\u{200B}'..='\u{200F}'
                | '\u{2060}'..='\u{2064}'
                | '\u{FEFF}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2066}'..='\u{2069}'
                | '\u{00AD}'
        )
    })
}

/// 予約された skill ファイル (#1162)。汎用の rename / delete では触れない (削除・改名は
/// AI の指示チャネルの入口を消す / 隠す操作なので、notemaid の予約 skill の規則で止める)。
/// notecore は名前を知るだけで中身は知らない
pub const RESERVED_SKILL_FILES: &[&str] = &["AGENTS.md", "HEARTBEAT.md"];

fn reject_reserved(subdir: &str, name: &str) -> Result<()> {
    if subdir == "skills" && RESERVED_SKILL_FILES.contains(&name) {
        return Err(NoteDeckError::InvalidInput(format!(
            "{name} is a reserved skill file and cannot be renamed or deleted"
        )));
    }
    Ok(())
}

/// Delete a settings file (missing file is a no-op).
pub fn delete_file(layout: &Layout, subdir: &str, name: &str) -> Result<()> {
    reject_reserved(subdir, name)?;
    let path = resolve_file(layout, subdir, name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| {
            NoteDeckError::InvalidInput(format!("Failed to delete {}: {e}", path.display()))
        })?;
    }
    Ok(())
}

/// Rename a settings file within the same subdirectory.
pub fn rename_file(layout: &Layout, subdir: &str, old_name: &str, new_name: &str) -> Result<()> {
    reject_reserved(subdir, old_name)?;
    reject_reserved(subdir, new_name)?;
    let old_path = resolve_file(layout, subdir, old_name)?;
    let new_path = resolve_file(layout, subdir, new_name)?;
    if !old_path.exists() {
        return Err(NoteDeckError::InvalidInput(format!(
            "File not found: {}",
            old_path.display()
        )));
    }
    if new_path.exists() {
        return Err(NoteDeckError::InvalidInput(format!(
            "File already exists: {}",
            new_path.display()
        )));
    }
    fs::rename(&old_path, &new_path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to rename: {e}")))?;
    // basename が変わる rename なら編集履歴も追随させる (無ければ skip、失敗しても
    // 本体の rename は成功のまま。#1334 段階 2)
    let (old_base, _) = split_compound_ext(old_name);
    let (new_base, _) = split_compound_ext(new_name);
    if old_base != new_base {
        if let (Ok(from), Ok(to)) = (
            history_path(layout, Some(subdir), old_base),
            history_path(layout, Some(subdir), new_base),
        ) {
            if from.is_file() && !to.exists() {
                if let Some(parent) = to.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                if let Err(e) = fs::rename(&from, &to) {
                    tracing::warn!(%e, "failed to move the edit history with the rename");
                }
            }
        }
    }
    Ok(())
}

// --- 編集履歴のサイドカー (`state/history/<subdir|root>/<base>.history.json5`、#1334 段階 2) ---
//
// 履歴は状態 (この機械で編集した記録) なので設定の隣に置かない。バックアップにも入れない。
// 汎用の read / write には「`.history.json5` なら別ルート」の名前分岐を入れず、ここだけが
// 履歴の置き場を知る

/// 履歴の論理 scope。`None` はルート直下のファイル (custom.css)
pub fn history_path(layout: &Layout, subdir: Option<&str>, base: &str) -> Result<PathBuf> {
    let dir = match subdir {
        Some(s) => validate_subdir(s)?.name,
        None => "root",
    };
    let name = crate::edit_history::history_file_name(base);
    validate_filename(&name)?;
    Ok(layout.history().join(dir).join(name))
}

/// 履歴を読む (無ければ空文字)
pub fn read_history(layout: &Layout, subdir: Option<&str>, base: &str) -> Result<String> {
    let path = history_path(layout, subdir, base)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// 履歴を書く (atomic)。変更通知は流さない (履歴の表示は都度読む)
pub fn write_history(
    layout: &Layout,
    subdir: Option<&str>,
    base: &str,
    content: &str,
) -> Result<()> {
    let path = history_path(layout, subdir, base)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            NoteDeckError::InvalidInput(format!(
                "Failed to create directory {}: {e}",
                parent.display()
            ))
        })?;
    }
    atomic_write(&path, content, None)
}

/// 履歴を消す (無ければ no-op)
pub fn delete_history(layout: &Layout, subdir: Option<&str>, base: &str) -> Result<()> {
    let path = history_path(layout, subdir, base)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| {
            NoteDeckError::InvalidInput(format!("Failed to delete {}: {e}", path.display()))
        })?;
    }
    Ok(())
}

/// 旧配置 (設定の隣の `<base>.history.json5` と root の `custom.css.history.json5`) の
/// 履歴を `state/history/` へ移す。両方あれば新 (state 側) を残して旧を消す
pub fn move_history_sidecars(layout: &Layout) {
    let suffix = crate::edit_history::HISTORY_SUFFIX;
    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    for sub in SUBDIRS {
        let dir = sub.area.dir(layout).join(sub.dir);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some(base) = name.strip_suffix(suffix) else {
                continue;
            };
            if let Ok(to) = history_path(layout, Some(sub.name), base) {
                moves.push((entry.path(), to));
            }
        }
    }
    let root_css = layout.config().join("custom.css.history.json5");
    if root_css.is_file() {
        if let Ok(to) = history_path(layout, None, "custom.css") {
            moves.push((root_css, to));
        }
    }
    for (from, to) in moves {
        if to.exists() {
            let _ = fs::remove_file(&from);
            continue;
        }
        if let Some(parent) = to.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Err(e) = fs::rename(&from, &to) {
            tracing::warn!(from = %from.display(), %e, "cannot move an edit history sidecar");
        }
    }
}

/// 持ち主の無い履歴 (本体が消えたもの) を消す。本体の basename は複合拡張子を剥がして比べる
pub fn sweep_orphan_history(layout: &Layout) {
    let suffix = crate::edit_history::HISTORY_SUFFIX;
    let Ok(scopes) = fs::read_dir(layout.history()) else {
        return;
    };
    for scope in scopes.flatten() {
        let scope_name = scope.file_name();
        let Some(scope_name) = scope_name.to_str() else {
            continue;
        };
        let owners: std::collections::HashSet<String> = if scope_name == "root" {
            ROOT_FILES
                .iter()
                .filter(|f| f.area.dir(layout).join(f.name).is_file())
                .map(|f| f.name.to_string())
                .collect()
        } else {
            let Some(sub) = subdir(scope_name) else {
                continue;
            };
            fs::read_dir(sub.area.dir(layout).join(sub.dir))
                .map(|rd| {
                    rd.flatten()
                        .filter_map(|e| e.file_name().to_str().map(str::to_string))
                        .filter(|n| !n.starts_with('.'))
                        .map(|n| split_compound_ext(&n).0.to_string())
                        .collect()
                })
                .unwrap_or_default()
        };
        let Ok(files) = fs::read_dir(scope.path()) else {
            continue;
        };
        for f in files.flatten() {
            let name = f.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some(base) = name.strip_suffix(suffix) else {
                continue;
            };
            if !owners.contains(base) {
                let _ = fs::remove_file(f.path());
            }
        }
    }
}

/// Read a root-level settings file (missing file returns empty string).
pub fn read_root_file(layout: &Layout, name: &str) -> Result<String> {
    let path = resolve_root_file(layout, name)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write a root-level settings file (atomic).
pub fn write_root_file(layout: &Layout, name: &str, content: &str) -> Result<()> {
    let path = resolve_root_file(layout, name)?;
    atomic_write(&path, content, None)
}

// --- 条件付き書込 (#1106 段階 3a 順序 5、仕様 §4.5) ---
//
// notecore 側のファイルは AI (notecore) とデバイスの両方が書くので、丸ごと書き戻す
// 書き手は「読んだときの版」を添え、その間に変わっていれば拒む (If-Match 相当)。
// 版は内容のダイジェストで、無いファイルは空文字の版。プロセスをまたいでも同じ値。

/// 内容から版を作る
pub fn content_version(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    digest[..16].iter().map(|b| format!("{b:02x}")).collect()
}

/// 読んだ内容と、その版 (次の条件付き書込に添える)
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VersionedText {
    pub content: String,
    pub version: String,
}

impl VersionedText {
    pub fn of(content: String) -> Self {
        let version = content_version(&content);
        Self { content, version }
    }
}

/// `expected` があれば今のファイルの版と照合し、違えば `CONFLICT` で拒む
fn ensure_version(path: &Path, expected: Option<&str>) -> Result<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let current = if path.exists() {
        fs::read_to_string(path).map_err(|e| {
            NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display()))
        })?
    } else {
        String::new()
    };
    if content_version(&current) != expected {
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        return Err(NoteDeckError::Localized {
            code: "CONFLICT",
            message: format!("{name} was changed by another writer; reload and retry"),
            i18n: serde_json::Value::Null,
        });
    }
    Ok(())
}

/// 条件付きの `write_file`。戻り値は書いた後の版
pub fn write_file_if(
    layout: &Layout,
    subdir: &str,
    name: &str,
    content: &str,
    expected: Option<&str>,
) -> Result<String> {
    ensure_version(&resolve_file(layout, subdir, name)?, expected)?;
    write_file(layout, subdir, name, content)?;
    Ok(content_version(content))
}

/// 条件付きの `write_root_file`。戻り値は書いた後の版
pub fn write_root_file_if(
    layout: &Layout,
    name: &str,
    content: &str,
    expected: Option<&str>,
) -> Result<String> {
    ensure_version(&resolve_root_file(layout, name)?, expected)?;
    write_root_file(layout, name, content)?;
    Ok(content_version(content))
}

/// 条件付きの `write_settings_json`。戻り値は書いた後の版
pub fn write_settings_json_if(
    layout: &Layout,
    content: &str,
    expected: Option<&str>,
) -> Result<String> {
    ensure_version(&settings_json_path(layout), expected)?;
    write_settings_json(layout, content)?;
    Ok(content_version(content))
}

pub fn read_root_file_versioned(layout: &Layout, name: &str) -> Result<VersionedText> {
    read_root_file(layout, name).map(VersionedText::of)
}

pub fn read_settings_json_versioned(layout: &Layout) -> Result<VersionedText> {
    read_settings_json(layout).map(VersionedText::of)
}

/// Read `settings.json5` (missing file returns empty string — first run).
fn settings_json_path(layout: &Layout) -> PathBuf {
    layout.config().join("settings.json5")
}

pub fn read_settings_json(layout: &Layout) -> Result<String> {
    let path = settings_json_path(layout);
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write `settings.json5`. Creates the settings directory if missing.
/// 他の設定ファイルと同じく atomic write (#719 — 従来ここだけ非 atomic だった)。
pub fn write_settings_json(layout: &Layout, content: &str) -> Result<()> {
    let path = settings_json_path(layout);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            NoteDeckError::InvalidInput(format!(
                "Failed to create directory {}: {e}",
                parent.display()
            ))
        })?;
    }
    atomic_write(&path, content, None)
}

/// 全設定ファイルをバックアップバンドル (相対パス → 内容) に収集する。
pub fn export_bundle(layout: &Layout) -> Result<BTreeMap<String, String>> {
    let mut bundle: BTreeMap<String, String> = BTreeMap::new();

    for sub in SUBDIRS.iter().filter(|s| s.backup) {
        let subdir = sub.name;
        let dir = sub.area.dir(layout).join(subdir);
        if !dir.exists() {
            continue;
        }
        let entries = fs::read_dir(&dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
        for entry in entries {
            let entry = entry.map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            if !entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                continue;
            }
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            // 履歴は状態 (#1334 段階 2)。旧配置に残っていてもバックアップに入れない
            if name_str.starts_with('.') || name_str.ends_with(crate::edit_history::HISTORY_SUFFIX)
            {
                continue;
            }
            let key = format!("{subdir}/{name_str}");
            let content = fs::read_to_string(entry.path())
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(key, content);
        }
    }

    for f in ROOT_FILES.iter().filter(|f| f.backup) {
        let path = f.area.dir(layout).join(f.name);
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(f.name.to_string(), content);
        }
    }

    // AI の人格と記憶 (#1162): 名指しの 3 ファイルだけ (BOOTSTRAP / turns / workspace は端末の都合)
    for name in WORKSPACE_FILES {
        let path = layout.data().join(WORKSPACE_DIR).join(name);
        if path.is_file() {
            let content = fs::read_to_string(&path)
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(format!("{WORKSPACE_DIR}/{name}"), content);
        }
    }

    Ok(bundle)
}

/// バンドルに含まれる人格 / 記憶のファイル名 (import 前の確認に使う)
pub fn workspace_entries(bundle: &BTreeMap<String, String>) -> Vec<&'static str> {
    WORKSPACE_FILES
        .iter()
        .copied()
        .filter(|n| bundle.contains_key(&format!("{WORKSPACE_DIR}/{n}")))
        .collect()
}

/// import キー内ファイル名の強化検証 (#913)。「新しく置くファイル」にのみ適用し、
/// `validate_filename` 本体は強化しない (規約外名の既存ファイルへの読取・削除・
/// リネーム元指定を拒否すると移行が成立しないため)。
/// 文字種 (日本語等) は寛容のまま受ける — 旧バックアップの復元を拒否しない。
fn validate_import_filename(name: &str) -> Result<()> {
    validate_filename(name)?;
    if name.chars().any(|c| c.is_control()) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Filename contains control characters: {name:?}"
        )));
    }
    if name.starts_with('.') {
        return Err(NoteDeckError::InvalidInput(format!(
            "Filename must not start with a dot: {name}"
        )));
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err(NoteDeckError::InvalidInput(format!(
            "Filename must not end with a dot or space: {name}"
        )));
    }
    // Windows 予約デバイス名 (stem = 最初のドットより前で判定)
    let stem = name.split('.').next().unwrap_or(name);
    if is_windows_reserved_stem(stem) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Filename uses a Windows reserved device name: {name}"
        )));
    }
    Ok(())
}

fn is_windows_reserved_stem(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (upper.len() == 4
            && (upper.starts_with("COM") || upper.starts_with("LPT"))
            && matches!(upper.as_bytes()[3], b'1'..=b'9'))
}

/// 種別の規定複合拡張子。suffix は「複合拡張子の前」に挿入するので、長い順に
/// 剥がして basename を得る (`.json5` は複合拡張子の suffix なので必ず最後)。
const COMPOUND_EXTS: &[&str] = &[
    ".meta.json5",
    ".ndprofile.json5",
    ".ndtheme.json5",
    ".is",
    ".md",
    ".json5",
];

/// ファイル名を (basename, 複合拡張子) に分割する。既知の拡張子がなければ
/// 全体を basename とする (suffix は末尾付与になる)。
fn split_compound_ext(name: &str) -> (&str, &str) {
    for ext in COMPOUND_EXTS {
        if let Some(base) = name.strip_suffix(ext) {
            if !base.is_empty() {
                return (base, ext);
            }
        }
    }
    (name, "")
}

/// グループ全構成の宛先を `create_new` で排他予約する。1 つでも既存衝突したら
/// 予約済み分を削除して `Ok(false)` を返す (FS 自身の同名解決 — 非 ASCII
/// casefold・NFC/NFD — を衝突検出の正とするため、事前照合では拾えない衝突も
/// ここで検出される)。
fn reserve_all(dir: &Path, names: &[String]) -> Result<bool> {
    let mut reserved: Vec<PathBuf> = Vec::new();
    for name in names {
        let path = dir.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => reserved.push(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                for p in &reserved {
                    let _ = fs::remove_file(p);
                }
                return Ok(false);
            }
            Err(e) => {
                for p in &reserved {
                    let _ = fs::remove_file(p);
                }
                return Err(NoteDeckError::InvalidInput(format!(
                    "Failed to write {}: {e}",
                    path.display()
                )));
            }
        }
    }
    Ok(true)
}

/// `reserve_all` で確保した宛先をまとめて解放する。書込途中で失敗したグループを
/// そのまま残すと、空の予約ファイルがゴミとして残り次回 import の衝突判定を
/// 汚す (グループは全構成そろって初めて意味を持つので部分適用も残さない)。
fn release_reserved(dir: &Path, names: &[String]) {
    for name in names {
        let _ = fs::remove_file(dir.join(name));
    }
}

/// 同一 basename のグループ (ソース + メタ + 履歴。単一ファイル種別は 1 ファイル
/// = 1 グループ) を書き込む。衝突判定・skip/suffix はグループ単位 — エントリ
/// 単位でばらすとペア種別のソースとメタが別名に分裂し、既存の孤児ソースと
/// 誤ペアリングしたり履歴だけが別アイテムのリングに結合する。
fn import_group(
    layout: &Layout,
    subdir: &str,
    members: &[(String, String)],
    warnings: &mut Vec<crate::i18n::LocalizedLine>,
) -> Result<()> {
    let dir = subdir_path(layout, subdir)?;
    fs::create_dir_all(&dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    // sessions/ は AI 会話内容のため 0o600 を維持 (write_file と同じ流儀)
    let mode = if subdir == "sessions" {
        Some(0o600)
    } else {
        None
    };

    // 書込直前の実列挙 + ASCII casefold の事前スクリーニング (case-sensitive FS
    // でも「大文字小文字のみ異なる既存名は占有」の規則を守る)
    let existing = list_files(layout, subdir)?;
    let collides = |name: &str| -> bool {
        let folded = name.to_ascii_lowercase();
        existing.iter().any(|e| e.to_ascii_lowercase() == folded)
    };

    if !members.iter().any(|(n, _)| collides(n)) {
        let names: Vec<String> = members.iter().map(|(n, _)| n.clone()).collect();
        if reserve_all(&dir, &names)? {
            for (name, content) in members {
                if let Err(e) = atomic_write(&dir.join(name), content, mode) {
                    release_reserved(&dir, &names);
                    return Err(e);
                }
            }
            return Ok(());
        }
        // 排他予約が失敗 = 事前照合で拾えない FS の同名解決 (非 ASCII casefold・
        // NFC/NFD)。予約済み分は削除済みなので、グループごと衝突分岐へ回す
    }

    // --- 衝突分岐 (グループ単位) ---
    // 衝突した構成が全て内容バイト一致ならグループ全体 skip (再 import の no-op
    // 収束)。いずれか不一致ならグループ全体を同一 suffix の basename へ退避する
    // (ファイル内 ID は変えず、次回起動の重複 ID 警告で手動解決に乗せる)。
    let mut any_collision = false;
    let mut all_identical = true;
    for (name, content) in members {
        // fs::read は FS の同名解決を通るので、排他失敗の実体も拾える
        match fs::read(dir.join(name)) {
            Ok(bytes) => {
                any_collision = true;
                if bytes != content.as_bytes() {
                    all_identical = false;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(NoteDeckError::InvalidInput(format!(
                    "Failed to read {subdir}/{name}: {e}"
                )));
            }
        }
        // casefold 一致の別表記 (case-sensitive FS では上の read に映らない)
        let folded = name.to_ascii_lowercase();
        for e in existing.iter().filter(|e| e.to_ascii_lowercase() == folded) {
            any_collision = true;
            match fs::read(dir.join(e)) {
                Ok(bytes) => {
                    if bytes != content.as_bytes() {
                        all_identical = false;
                    }
                }
                Err(_) => all_identical = false,
            }
        }
    }

    let member_keys = || -> String {
        members
            .iter()
            .map(|(n, _)| format!("{subdir}/{n}"))
            .collect::<Vec<_>>()
            .join(", ")
    };

    if any_collision && all_identical {
        tracing::warn!("Import: skipping identical group: {}", member_keys());
        warnings.push(
            crate::i18n::text(
                "_native.backup.skippedSame",
                serde_json::json!({ "items": member_keys() }),
            )
            .into(),
        );
        return Ok(());
    }

    // suffix 退避: 全構成が同時に空く番号を create_new プローブで探索する
    for n in 2..10_000u32 {
        let candidates: Vec<String> = members
            .iter()
            .map(|(name, _)| {
                let (base, ext) = split_compound_ext(name);
                format!("{base}-{n}{ext}")
            })
            .collect();
        if candidates.iter().any(|c| collides(c)) {
            continue;
        }
        if !reserve_all(&dir, &candidates)? {
            continue;
        }
        for ((_, content), cand) in members.iter().zip(&candidates) {
            if let Err(e) = atomic_write(&dir.join(cand), content, mode) {
                release_reserved(&dir, &candidates);
                return Err(e);
            }
        }
        let renamed = candidates.join(", ");
        tracing::warn!(
            "Import: group collides, restored with suffix: {} -> {renamed}",
            member_keys()
        );
        warnings.push(
            crate::i18n::text(
                "_native.backup.restoredRenamed",
                serde_json::json!({ "items": member_keys(), "renamed": renamed }),
            )
            .into(),
        );
        return Ok(());
    }
    Err(NoteDeckError::InvalidInput(format!(
        "No free suffix found for import group: {}",
        member_keys()
    )))
}

/// バックアップバンドルを検証しながら書き戻す。
///
/// - キー構造は「許可サブディレクトリ + ファイル名」の 2 要素、または許可
///   ルートファイル名そのものの 1 要素のみ。3 要素以上のネストは拒否
/// - サブディレクトリ側のファイル名には強化検証 (`validate_import_filename`) を
///   適用。拒否したエントリはスキップし警告として収集する
/// - 許可ルートファイルは固定名の単一ファイルなので復元 = atomic 置換
///   (suffix 退避先の名前は allowlist 外で二度と読まれないため衝突分岐は不適用)
/// - サブディレクトリのアイテムは basename グループ単位で casefold 衝突検査 +
///   排他書込 (詳細は `import_group`)
///
/// 戻り値はスキップ / 別名退避したエントリの警告リスト。
pub fn import_bundle(
    layout: &Layout,
    bundle: &BTreeMap<String, String>,
) -> Result<Vec<crate::i18n::LocalizedLine>> {
    let mut warnings: Vec<crate::i18n::LocalizedLine> = Vec::new();
    // (subdir, basename) → [(filename, content)]。BTreeMap なので処理順は決定的
    let mut groups: BTreeMap<(String, String), Vec<(String, String)>> = BTreeMap::new();

    if !bundle.is_empty() {
        fs::create_dir_all(layout.config())
            .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    }

    // 旧バンドルの編集履歴は捨てる (状態なので復元しない、#1334 段階 2)。警告は 1 行
    let skipped_history = bundle
        .keys()
        .filter(|k| k.ends_with(crate::edit_history::HISTORY_SUFFIX))
        .count();
    if skipped_history > 0 {
        tracing::warn!("Import: skipping {skipped_history} edit history sidecar(s)");
        warnings.push(
            crate::i18n::text(
                "_native.backup.skippedHistory",
                serde_json::json!({ "count": skipped_history }),
            )
            .into(),
        );
    }

    for (key, content) in bundle {
        if key.ends_with(crate::edit_history::HISTORY_SUFFIX) {
            continue;
        }
        let parts: Vec<&str> = key.split('/').collect();
        match parts.as_slice() {
            [name] if root_file(name).is_some() => {
                let f = root_file(name).expect("checked by the guard");
                if !f.backup {
                    // この端末の構成など、復元先に持ち込まないファイル
                    tracing::warn!("Import: skipping device-only file: {key}");
                    continue;
                }
                // 接続一覧は構造を持つ厳密 JSON。壊れた内容を置くと Vault が立たなくなる
                // ので、パースできるときだけ受ける (#1333 §1)
                if f.name == CONNECTIONS_FILE
                    && serde_json::from_str::<crate::vault::model::ConnectionsFile>(content)
                        .is_err()
                {
                    tracing::warn!("Import: skipping unparsable connections file: {key}");
                    warnings.push(
                        crate::i18n::text(
                            "_native.backup.skippedBadKey",
                            serde_json::json!({ "key": key }),
                        )
                        .into(),
                    );
                    continue;
                }
                let dir = f.area.dir(layout);
                fs::create_dir_all(dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
                atomic_write(&dir.join(name), content, None)?;
            }
            [dir, name] if *dir == WORKSPACE_DIR => {
                // 人格 / 記憶 (#1162): 名指しの 3 ファイルだけ、そのまま置く (上限超過は
                // 読む側が「注入しない」で受ける)。見えない文字を含むものは入れない
                if !WORKSPACE_FILES.contains(name) || has_invisible_unicode(content) {
                    tracing::warn!("Import: skipping workspace entry: {key}");
                    warnings.push(
                        crate::i18n::text(
                            "_native.backup.skippedBadKey",
                            serde_json::json!({ "key": key }),
                        )
                        .into(),
                    );
                    continue;
                }
                let dir_path = layout.data().join(WORKSPACE_DIR);
                fs::create_dir_all(&dir_path)
                    .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
                atomic_write(&dir_path.join(name), content, None)?;
            }
            [subdir, name] if self::subdir(subdir).is_some_and(|s| s.backup) => {
                if let Err(e) = validate_import_filename(name) {
                    tracing::warn!("Import: skipping invalid filename: {key}: {e}");
                    warnings.push(
                        crate::i18n::text(
                            "_native.backup.skippedBadFilename",
                            serde_json::json!({ "key": key }),
                        )
                        .into(),
                    );
                    continue;
                }
                let (base, _) = split_compound_ext(name);
                groups
                    .entry((subdir.to_string(), base.to_string()))
                    .or_default()
                    .push((name.to_string(), content.clone()));
            }
            _ => {
                tracing::warn!("Import: skipping unknown entry: {key}");
                warnings.push(
                    crate::i18n::text(
                        "_native.backup.skippedBadKey",
                        serde_json::json!({ "key": key }),
                    )
                    .into(),
                );
            }
        }
    }

    for ((subdir, _), members) in &groups {
        import_group(layout, subdir, members, &mut warnings)?;
    }

    Ok(warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// temp dir をそのまま設定ディレクトリとして扱う
    fn lay(dir: &Path) -> Layout {
        Layout::single_dir(dir)
    }

    #[test]
    fn workspace_files_round_trip_through_the_bundle_but_stay_out_of_the_allowlist() {
        let src = tempfile::tempdir().unwrap();
        let ws = src.path().join("notemaid");
        fs::create_dir_all(ws.join("turns")).unwrap();
        fs::write(ws.join("SOUL.md"), "# SOUL\n").unwrap();
        fs::write(ws.join("USER.md"), "# USER\n- Always call them Taka\n").unwrap();
        fs::write(ws.join("BOOTSTRAP.md"), "ritual").unwrap();
        fs::write(ws.join("turns/taint.json"), "{}").unwrap();
        let bundle = export_bundle(&lay(src.path())).unwrap();
        assert!(bundle.contains_key("notemaid/SOUL.md"));
        assert!(bundle.contains_key("notemaid/USER.md"));
        assert!(!bundle.contains_key("notemaid/MEMORY.md"));
        assert!(!bundle.contains_key("notemaid/BOOTSTRAP.md"));
        assert!(!bundle.keys().any(|k| k.contains("turns")));
        assert_eq!(workspace_entries(&bundle), vec!["SOUL.md", "USER.md"]);

        let dst = tempfile::tempdir().unwrap();
        let mut b = bundle.clone();
        b.insert("notemaid/BOOTSTRAP.md".into(), "x".into());
        b.insert("notemaid/MEMORY.md".into(), "zero\u{200B}width".into());
        let warnings = import_bundle(&lay(dst.path()), &b).unwrap();
        assert_eq!(
            fs::read_to_string(dst.path().join("notemaid/USER.md")).unwrap(),
            "# USER\n- Always call them Taka\n"
        );
        assert!(!dst.path().join("notemaid/BOOTSTRAP.md").exists());
        assert!(!dst.path().join("notemaid/MEMORY.md").exists());
        assert_eq!(warnings.len(), 2);
        // 汎用の読み書きは受け付けない
        assert!(validate_subdir("notemaid").is_err());
        // AI セッションは allowlist にあるが汎用 IPC からは触れない (#1333 §1)
        assert!(validate_subdir("sessions").is_ok());
        assert!(validate_ipc_subdir("sessions").is_err());
        assert!(validate_ipc_subdir("skills").is_ok());
    }

    /// プラグインの loopback 同意 (#1293) は端末固有: バックアップに含めず、汎用の
    /// 読み書きからも触れない
    #[test]
    fn loopback_consent_stays_out_of_the_bundle_and_the_allowlist() {
        let src = tempfile::tempdir().unwrap();
        let dir = src.path().join(crate::loopback_consent::DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("consent.json"), "{}").unwrap();
        let bundle = export_bundle(&lay(src.path())).unwrap();
        assert!(!bundle
            .keys()
            .any(|k| k.starts_with(crate::loopback_consent::DIR)));
        assert!(validate_subdir(crate::loopback_consent::DIR).is_err());
        assert!(root_file("loopback/consent.json").is_none());
    }

    #[test]
    fn reserved_skill_files_cannot_be_renamed_or_deleted_through_the_generic_path() {
        let dir = tempfile::tempdir().unwrap();
        write_file(&lay(dir.path()), "skills", "AGENTS.md", "# AGENTS").unwrap();
        assert!(delete_file(&lay(dir.path()), "skills", "AGENTS.md").is_err());
        assert!(rename_file(&lay(dir.path()), "skills", "AGENTS.md", "rules.md").is_err());
        assert!(rename_file(&lay(dir.path()), "skills", "other.md", "HEARTBEAT.md").is_err());
        assert!(dir.path().join("skills/AGENTS.md").exists());
        // 他の skill と、他のディレクトリの同名は従来どおり
        write_file(&lay(dir.path()), "skills", "other.md", "x").unwrap();
        assert!(delete_file(&lay(dir.path()), "skills", "other.md").is_ok());
        write_file(&lay(dir.path()), "memos", "AGENTS.md", "x").unwrap();
        assert!(delete_file(&lay(dir.path()), "memos", "AGENTS.md").is_ok());
    }

    #[test]
    fn atomic_write_creates_and_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("permissions.json5");

        atomic_write(&path, "{ v: 1 }", None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ v: 1 }");

        // 上書きも旧内容を完全に置き換える
        atomic_write(&path, "{ v: 2 }", None).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ v: 2 }");
    }

    #[test]
    fn conditional_write_matches_the_version_read_and_rejects_stale_writers() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        // 無いファイルは空文字の版
        let first = read_root_file_versioned(&lay(base), "tasks.json5").unwrap();
        assert_eq!(first.content, "");
        assert_eq!(first.version, content_version(""));
        let v1 = write_root_file_if(&lay(base), "tasks.json5", "{ a: 1 }", Some(&first.version))
            .unwrap();
        assert_eq!(v1, content_version("{ a: 1 }"));
        // 古い版で書くと CONFLICT
        let stale = write_root_file_if(&lay(base), "tasks.json5", "{ a: 2 }", Some(&first.version));
        assert_eq!(stale.unwrap_err().code(), "CONFLICT");
        assert_eq!(
            fs::read_to_string(base.join("tasks.json5")).unwrap(),
            "{ a: 1 }"
        );
        // 今の版なら通り、無条件 (None) も通る
        write_root_file_if(&lay(base), "tasks.json5", "{ a: 2 }", Some(&v1)).unwrap();
        write_root_file_if(&lay(base), "tasks.json5", "{ a: 3 }", None).unwrap();
        // settings.json5 と subdir も同じ
        let s = read_settings_json_versioned(&lay(base)).unwrap();
        write_settings_json_if(&lay(base), "{ x: 1 }", Some(&s.version)).unwrap();
        assert_eq!(
            write_settings_json_if(&lay(base), "{ x: 2 }", Some(&s.version))
                .unwrap_err()
                .code(),
            "CONFLICT"
        );
        let v = write_file_if(
            &lay(base),
            "skills",
            "a.md",
            "hello",
            Some(&content_version("")),
        )
        .unwrap();
        assert_eq!(
            write_file_if(
                &lay(base),
                "skills",
                "a.md",
                "bye",
                Some(&content_version(""))
            )
            .unwrap_err()
            .code(),
            "CONFLICT"
        );
        write_file_if(&lay(base), "skills", "a.md", "bye", Some(&v)).unwrap();
    }

    #[test]
    fn atomic_write_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json5");
        atomic_write(&path, "{}", None).unwrap();

        // 成功後、同ディレクトリに一時ファイル (.<name>.<pid>.tmp) が残らない
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files remained: {leftovers:?}");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_applies_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.json5");
        atomic_write(&path, "{}", Some(0o600)).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn write_file_applies_sessions_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        write_file(&lay(dir.path()), "sessions", "20260722.json5", "{}").unwrap();
        let mode = fs::metadata(dir.path().join("sessions/20260722.json5"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn validate_subdir_allowed() {
        assert!(validate_subdir("profiles").is_ok());
        assert!(validate_subdir("themes").is_ok());
        assert!(validate_subdir("plugins").is_ok());
        assert!(validate_subdir("snippets").is_ok());
        assert!(validate_subdir("widgets").is_ok());
        assert!(validate_subdir("skills").is_ok());
        assert!(validate_subdir("sessions").is_ok());
        // カラムクエリ (#783 Phase 1.5)。settingsFs 側が使うので許可が必要
        assert!(validate_subdir("queries").is_ok());
        // memos は settingsFs にラッパーがあるので漏れを防ぐ
        assert!(validate_subdir("memos").is_ok());
        // デッキの状態 (#1333 §3) は state/deck/ に置く
        assert!(validate_subdir("deck-state").is_ok());
        let l = Layout::from_root(std::path::Path::new("/r"));
        assert_eq!(
            subdir_path(&l, "deck-state").unwrap(),
            std::path::Path::new("/r/state/deck")
        );
        assert_eq!(
            resolve_root_file(&l, "ui.json5").unwrap(),
            std::path::Path::new("/r/state/ui.json5")
        );
    }

    #[test]
    fn validate_subdir_rejected() {
        assert!(validate_subdir("").is_err());
        assert!(validate_subdir("secrets").is_err());
        assert!(validate_subdir("../etc").is_err());
    }

    #[test]
    fn permissions_json5_is_allowed_root_file() {
        // #714: 権限プロファイル + 確認スキップの保存先。allowlist から漏れると
        // 読み書きもバックアップも黙って失敗する (#712〜v1.5.0 で実際に発生)
        assert!(root_file("permissions.json5").is_some());
    }

    #[test]
    fn tutorial_json5_is_allowed_root_file() {
        // #1029: チュートリアルの達成記録と実績の保存先。allowlist から漏れると
        // 読み書きもバックアップも黙って失敗する
        assert!(root_file("tutorial.json5").is_some());
    }

    #[test]
    fn theme_dropins_json5_is_allowed_root_file() {
        // #1041: drop-in の採用記録。allowlist から漏れると記録できず、
        // 起動のたびに同じ元ファイルを再取り込みして複製が増える
        assert!(root_file("theme-dropins.json5").is_some());
    }

    #[test]
    fn client_json5_is_never_backed_up() {
        // #1106 段階 3a: この端末の構成。復元先で存在しない常駐を探さない
        let f = root_file("client.json5").unwrap();
        assert_eq!(f.area, Area::StateFromV1);
        assert!(!f.backup);
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("client.json5"), "{ backend: 'resident' }").unwrap();
        fs::write(dir.path().join("locale.json5"), "{ locale: 'auto' }").unwrap();
        let bundle = export_bundle(&lay(dir.path())).unwrap();
        assert!(!bundle.contains_key("client.json5"));
        assert!(bundle.contains_key("locale.json5"));
        let restore = tempfile::tempdir().unwrap();
        let mut b = BTreeMap::new();
        b.insert(
            "client.json5".to_string(),
            "{ backend: 'resident' }".to_string(),
        );
        import_bundle(&lay(restore.path()), &b).unwrap();
        assert!(!restore.path().join("client.json5").exists());
    }

    #[cfg(unix)]
    #[test]
    fn list_files_skips_symlinks() {
        // #1041: themes/ の drop-in はシンボリックリンクを対象にしない
        // (採用コピーの元として追いかけない)。列挙の段階で落ちることを固定する
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let themes = base.join("themes");
        fs::create_dir_all(&themes).unwrap();
        fs::write(themes.join("real.json5"), "{}").unwrap();
        let outside = base.join("outside.json5");
        fs::write(&outside, "{}").unwrap();
        std::os::unix::fs::symlink(&outside, themes.join("link.json5")).unwrap();

        assert_eq!(
            list_files(&lay(base), "themes").unwrap(),
            vec!["real.json5"]
        );
    }

    /// #1334: 達成記録はこの機械の状態 (resetAt からの導出で他の機械と食い違う) なので
    /// バックアップに入れない。旧配置では設定の隣、再編後は state/ から読む
    #[test]
    fn tutorial_json5_is_machine_state() {
        let f = root_file("tutorial.json5").unwrap();
        assert!(!f.backup);
        assert_eq!(f.area, Area::StateFromV1);
        let dir = tempfile::tempdir().unwrap();
        let legacy = Layout::legacy(dir.path());
        assert_eq!(
            resolve_root_file(&legacy, "tutorial.json5").unwrap(),
            legacy.config().join("tutorial.json5")
        );
        let v1 = Layout::v1(dir.path());
        assert_eq!(
            resolve_root_file(&v1, "tutorial.json5").unwrap(),
            v1.state().join("tutorial.json5")
        );
    }

    #[test]
    fn dot_entries_are_invisible_to_the_generic_paths() {
        let dir = tempfile::tempdir().unwrap();
        let l = lay(dir.path());
        fs::create_dir_all(dir.path().join("skills")).unwrap();
        fs::write(dir.path().join("skills/.hidden.md"), "x").unwrap();
        fs::write(dir.path().join("skills/real.md"), "y").unwrap();
        fs::write(dir.path().join(".gitignore"), "sessions/\n").unwrap();
        assert_eq!(list_files(&l, "skills").unwrap(), vec!["real.md"]);
        assert!(read_file(&l, "skills", ".hidden.md").is_err());
        assert!(write_file(&l, "skills", ".git", "x").is_err());
        assert!(resolve_root_file(&l, ".gitignore").is_err());
        let bundle = export_bundle(&l).unwrap();
        assert!(!bundle
            .keys()
            .any(|k| k.contains("/.") || k.starts_with('.')));
        assert!(bundle.contains_key("skills/real.md"));
    }

    #[test]
    fn gitignore_template_is_written_once_and_never_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let l = Layout::from_root(dir.path());
        ensure_gitignore(&l);
        let path = l.config().join(".gitignore");
        assert_eq!(fs::read_to_string(&path).unwrap(), GITIGNORE_TEMPLATE);
        fs::write(&path, "mine\n").unwrap();
        ensure_gitignore(&l);
        assert_eq!(fs::read_to_string(&path).unwrap(), "mine\n");
        // 雛形は設定ではないものだけを除外し、設定ファイルは除外しない
        for kept in [
            "settings.json5",
            "connections.json",
            "permissions.json5",
            "profiles/",
        ] {
            assert!(
                !GITIGNORE_TEMPLATE.contains(kept),
                "{kept} must not be ignored"
            );
        }
        for ignored in [
            "sessions/",
            "memos/",
            "notemaid/",
            "*.history.json5",
            ".*.tmp",
        ] {
            assert!(
                GITIGNORE_TEMPLATE.contains(ignored),
                "{ignored} must be ignored"
            );
        }
    }

    #[test]
    fn validate_filename_ok() {
        assert!(validate_filename("test.json5").is_ok());
        assert!(validate_filename("my-theme.ndtheme.json5").is_ok());
        assert!(validate_filename("plugin.is").is_ok());
    }

    #[test]
    fn validate_filename_path_traversal() {
        assert!(validate_filename("..").is_err());
        assert!(validate_filename("../secret").is_err());
        assert!(validate_filename("foo/bar").is_err());
        assert!(validate_filename("foo\\bar").is_err());
    }

    #[test]
    fn validate_filename_reserved_chars() {
        assert!(validate_filename("file<name").is_err());
        assert!(validate_filename("file>name").is_err());
        assert!(validate_filename("file:name").is_err());
        assert!(validate_filename("file\"name").is_err());
        assert!(validate_filename("file|name").is_err());
        assert!(validate_filename("file?name").is_err());
        assert!(validate_filename("file*name").is_err());
    }

    #[test]
    fn validate_filename_empty() {
        assert!(validate_filename("").is_err());
    }

    #[test]
    fn validate_filename_too_long() {
        let long = "a".repeat(129);
        assert!(validate_filename(&long).is_err());
        let ok = "a".repeat(128);
        assert!(validate_filename(&ok).is_ok());
    }

    #[test]
    fn write_settings_json_is_atomic_and_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        write_settings_json(&lay(dir.path()), "{ a: 1 }").unwrap();
        assert_eq!(read_settings_json(&lay(dir.path())).unwrap(), "{ a: 1 }");
        // 存在しない場合は空文字 (first run)
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(read_settings_json(&lay(empty.path())).unwrap(), "");
    }

    // export_bundle / import_bundle を「実物の service 関数で」round-trip 検証する。
    // 従来はコマンド内ロジックのコピーがテストに埋め込まれていた (#782 で解消)。
    #[test]
    fn bundle_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        write_file(
            &lay(base),
            "profiles",
            "test.ndprofile.json5",
            r#"{ name: "test" }"#,
        )
        .unwrap();
        write_file(
            &lay(base),
            "themes",
            "dark.ndtheme.json5",
            r#"{ name: "dark" }"#,
        )
        .unwrap();
        write_root_file(&lay(base), "custom.css", "body { color: red; }").unwrap();
        write_root_file(&lay(base), "keybinds.json5", r#"{ "search": [] }"#).unwrap();

        let bundle = export_bundle(&lay(base)).unwrap();
        assert_eq!(bundle.len(), 4);

        // 元ファイルを消してから import で復元
        fs::remove_dir_all(base.join("profiles")).unwrap();
        fs::remove_dir_all(base.join("themes")).unwrap();
        fs::remove_file(base.join("custom.css")).unwrap();
        fs::remove_file(base.join("keybinds.json5")).unwrap();

        import_bundle(&lay(base), &bundle).unwrap();

        assert_eq!(
            read_file(&lay(base), "profiles", "test.ndprofile.json5").unwrap(),
            r#"{ name: "test" }"#
        );
        assert_eq!(
            read_file(&lay(base), "themes", "dark.ndtheme.json5").unwrap(),
            r#"{ name: "dark" }"#
        );
        assert_eq!(
            read_root_file(&lay(base), "custom.css").unwrap(),
            "body { color: red; }"
        );
        assert_eq!(
            read_root_file(&lay(base), "keybinds.json5").unwrap(),
            r#"{ "search": [] }"#
        );
    }

    #[test]
    fn import_bundle_rejects_path_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("app");
        fs::create_dir_all(&base).unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("../../../etc/passwd".to_string(), "evil".to_string());
        bundle.insert("profiles/good.json5".to_string(), "ok".to_string());

        import_bundle(&lay(&base), &bundle).unwrap();

        assert!(!dir.path().join("etc/passwd").exists());
        assert_eq!(
            fs::read_to_string(base.join("profiles/good.json5")).unwrap(),
            "ok"
        );
    }

    #[test]
    fn import_bundle_rejects_unknown_entries() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().join("app");
        fs::create_dir_all(&base).unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("custom.css".to_string(), "body{}".to_string());
        bundle.insert("secret.txt".to_string(), "secret".to_string());
        bundle.insert("config/bad.json".to_string(), "bad".to_string());

        let warnings = import_bundle(&lay(&base), &bundle).unwrap();

        assert!(base.join("custom.css").exists());
        assert!(!base.join("secret.txt").exists());
        assert!(!base.join("config/bad.json").exists());
        // 拒否 2 件が警告として収集される
        assert_eq!(warnings.len(), 2);
    }

    /// #1334 段階 2: 履歴は設定の隣ではなく state/history/ に置く。rename に追随し、
    /// バックアップには入らず、旧配置の履歴は移される
    #[test]
    fn edit_history_lives_under_state_and_follows_renames() {
        let dir = tempfile::tempdir().unwrap();
        let l = Layout::from_root(dir.path());
        assert!(root_file("custom.css.history.json5").is_none());
        write_history(&l, None, "custom.css", "{ entries: [] }\n").unwrap();
        assert_eq!(
            history_path(&l, None, "custom.css").unwrap(),
            l.history().join("root/custom.css.history.json5")
        );
        assert_eq!(
            read_history(&l, None, "custom.css").unwrap(),
            "{ entries: [] }\n"
        );
        assert_eq!(read_history(&l, Some("skills"), "none").unwrap(), "");
        assert!(history_path(&l, Some("nope"), "x").is_err());

        write_file(&l, "skills", "a.md", "# a").unwrap();
        write_history(&l, Some("skills"), "a", "{ entries: [1] }\n").unwrap();
        rename_file(&l, "skills", "a.md", "b.md").unwrap();
        assert_eq!(
            read_history(&l, Some("skills"), "b").unwrap(),
            "{ entries: [1] }\n"
        );
        assert_eq!(read_history(&l, Some("skills"), "a").unwrap(), "");
        // バックアップに履歴は入らず、旧バンドルの履歴は 1 行の警告で捨てる
        let bundle = export_bundle(&l).unwrap();
        assert!(!bundle.keys().any(|k| k.contains("history")));
        let mut b = BTreeMap::new();
        b.insert("skills/x.history.json5".to_string(), "{}".to_string());
        b.insert("custom.css.history.json5".to_string(), "{}".to_string());
        let warnings = import_bundle(&l, &b).unwrap();
        assert_eq!(warnings.len(), 1);
        assert!(!l.config().join("skills/x.history.json5").exists());
        // 旧配置の履歴は state/history/ へ、持ち主の無いものは sweep で消える
        fs::write(l.config().join("skills/b.history.json5"), "old").unwrap();
        fs::write(l.config().join("skills/gone.history.json5"), "orphan").unwrap();
        fs::write(l.config().join("custom.css.history.json5"), "css").unwrap();
        move_history_sidecars(&l);
        assert!(!l.config().join("skills/b.history.json5").exists());
        // 両方あったので state 側 (新) が残る
        assert_eq!(
            read_history(&l, Some("skills"), "b").unwrap(),
            "{ entries: [1] }\n"
        );
        assert_eq!(read_history(&l, Some("skills"), "gone").unwrap(), "orphan");
        // custom.css 本体が無いので root の履歴は持ち主なし
        sweep_orphan_history(&l);
        assert_eq!(read_history(&l, Some("skills"), "gone").unwrap(), "");
        assert_eq!(
            read_history(&l, Some("skills"), "b").unwrap(),
            "{ entries: [1] }\n"
        );
        assert_eq!(read_history(&l, None, "custom.css").unwrap(), "");
    }

    #[test]
    fn import_bundle_rejects_nested_keys() {
        // キー構造は 2 要素 (subdir/name) か許可ルートファイルの 1 要素のみ。
        // 3 要素以上のネストは拒否 + 警告
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        let mut bundle = BTreeMap::new();
        bundle.insert("themes/deep/evil.json5".to_string(), "x".to_string());

        let warnings = import_bundle(&lay(base), &bundle).unwrap();
        assert!(!base.join("themes/deep/evil.json5").exists());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].text.contains("themes/deep/evil.json5"));
    }

    #[test]
    fn import_bundle_rejects_reserved_and_malformed_filenames() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        let mut bundle = BTreeMap::new();
        // Windows 予約デバイス名 (stem 判定)
        bundle.insert("themes/aux.ndtheme.json5".to_string(), "x".to_string());
        bundle.insert("skills/COM1.md".to_string(), "x".to_string());
        // 制御文字 / 先頭ドット / 末尾ドット・空白
        bundle.insert("skills/bad\u{1}name.md".to_string(), "x".to_string());
        bundle.insert("skills/.hidden.md".to_string(), "x".to_string());
        bundle.insert("skills/trail .md ".to_string(), "x".to_string());

        let warnings = import_bundle(&lay(base), &bundle).unwrap();
        assert_eq!(warnings.len(), 5);
        assert_eq!(
            list_files(&lay(base), "themes").unwrap(),
            Vec::<String>::new()
        );
        assert_eq!(
            list_files(&lay(base), "skills").unwrap(),
            Vec::<String>::new()
        );
    }

    #[test]
    fn import_bundle_accepts_lenient_charset() {
        // 文字種 (日本語等) は寛容のまま — 旧バックアップの復元を拒否しない
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        let mut bundle = BTreeMap::new();
        bundle.insert(
            "themes/天気テーマ.ndtheme.json5".to_string(),
            "{ id: 't1' }".to_string(),
        );

        let warnings = import_bundle(&lay(base), &bundle).unwrap();
        assert!(warnings.is_empty());
        assert_eq!(
            read_file(&lay(base), "themes", "天気テーマ.ndtheme.json5").unwrap(),
            "{ id: 't1' }"
        );
    }

    #[test]
    fn import_bundle_skips_identical_group() {
        // 衝突した構成が全て内容バイト一致 → グループ全体 skip (再 import の
        // no-op 収束)
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_file(&lay(base), "skills", "weather.md", "# weather").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("skills/weather.md".to_string(), "# weather".to_string());

        let warnings = import_bundle(&lay(base), &bundle).unwrap();
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].text.contains("skills/weather.md"));
        assert_eq!(
            list_files(&lay(base), "skills").unwrap(),
            vec!["weather.md"]
        );
    }

    #[test]
    fn import_bundle_diverts_conflicting_group_with_suffix() {
        // 内容不一致の衝突はグループ全体を同一 suffix の basename へ退避する。
        // ペア種別 (ソース + メタ) はメタが非衝突でも分裂させない
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_file(&lay(base), "widgets", "clock.is", "local code").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("widgets/clock.is".to_string(), "backup code".to_string());
        bundle.insert(
            "widgets/clock.meta.json5".to_string(),
            "{ id: 'w1' }".to_string(),
        );

        let warnings = import_bundle(&lay(base), &bundle).unwrap();
        assert_eq!(warnings.len(), 1);

        // 既存はそのまま、バックアップ側は -2 で並置 (suffix は複合拡張子の前)
        assert_eq!(
            read_file(&lay(base), "widgets", "clock.is").unwrap(),
            "local code"
        );
        assert_eq!(
            read_file(&lay(base), "widgets", "clock-2.is").unwrap(),
            "backup code"
        );
        assert_eq!(
            read_file(&lay(base), "widgets", "clock-2.meta.json5").unwrap(),
            "{ id: 'w1' }"
        );
        assert!(!base.join("widgets/clock.meta.json5").exists());
    }

    #[test]
    fn import_bundle_casefold_collision_diverts_on_case_sensitive_fs() {
        // 大文字小文字のみ異なる既存名は占有 (ASCII casefold の事前照合)。
        // case-sensitive FS でも Windows/macOS と挙動を揃える
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_file(&lay(base), "skills", "Weather.md", "local").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("skills/weather.md".to_string(), "backup".to_string());

        let warnings = import_bundle(&lay(base), &bundle).unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(
            read_file(&lay(base), "skills", "Weather.md").unwrap(),
            "local"
        );
        assert_eq!(
            read_file(&lay(base), "skills", "weather-2.md").unwrap(),
            "backup"
        );
    }

    #[test]
    fn import_bundle_suffix_probes_next_free_number() {
        // -2 が占有済みなら全構成が同時に空く次の番号へ
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_file(&lay(base), "skills", "weather.md", "local").unwrap();
        write_file(&lay(base), "skills", "weather-2.md", "taken").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("skills/weather.md".to_string(), "backup".to_string());

        let warnings = import_bundle(&lay(base), &bundle).unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(
            read_file(&lay(base), "skills", "weather-3.md").unwrap(),
            "backup"
        );
        assert_eq!(
            read_file(&lay(base), "skills", "weather-2.md").unwrap(),
            "taken"
        );
    }

    #[test]
    fn import_bundle_overwrites_root_files_atomically() {
        // 許可ルートファイルは固定名の単一ファイル。復元 = 置換 (skip/suffix の
        // 衝突分岐は適用しない — suffix 先は allowlist 外で二度と読まれない)
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_root_file(&lay(base), "custom.css", "old {}").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("custom.css".to_string(), "new {}".to_string());

        let warnings = import_bundle(&lay(base), &bundle).unwrap();
        assert!(warnings.is_empty());
        assert_eq!(read_root_file(&lay(base), "custom.css").unwrap(), "new {}");
    }

    #[cfg(unix)]
    #[test]
    fn import_bundle_applies_sessions_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        let mut bundle = BTreeMap::new();
        bundle.insert("sessions/20260722.json5".to_string(), "{}".to_string());

        import_bundle(&lay(base), &bundle).unwrap();
        let mode = fs::metadata(base.join("sessions/20260722.json5"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn import_bundle_leaves_no_temp_or_reservation_files() {
        // 排他予約 (create_new) + atomic_write 後に空ファイルや .tmp が残らない
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_file(&lay(base), "skills", "weather.md", "local").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("skills/weather.md".to_string(), "backup".to_string());
        bundle.insert("skills/fresh.md".to_string(), "fresh".to_string());

        import_bundle(&lay(base), &bundle).unwrap();
        assert_eq!(
            list_files(&lay(base), "skills").unwrap(),
            vec!["fresh.md", "weather-2.md", "weather.md"]
        );
        assert_eq!(
            read_file(&lay(base), "skills", "fresh.md").unwrap(),
            "fresh"
        );
    }

    #[test]
    fn split_compound_ext_longest_first() {
        assert_eq!(
            split_compound_ext("clock.meta.json5"),
            ("clock", ".meta.json5")
        );
        // 履歴は設定の隣に無い (#1334 段階 2) ので複合拡張子として扱わない
        assert_eq!(
            split_compound_ext("clock.history.json5"),
            ("clock.history", ".json5")
        );
        assert_eq!(
            split_compound_ext("p.ndprofile.json5"),
            ("p", ".ndprofile.json5")
        );
        assert_eq!(
            split_compound_ext("t.ndtheme.json5"),
            ("t", ".ndtheme.json5")
        );
        assert_eq!(split_compound_ext("w.is"), ("w", ".is"));
        assert_eq!(split_compound_ext("s.md"), ("s", ".md"));
        assert_eq!(split_compound_ext("q.json5"), ("q", ".json5"));
        assert_eq!(split_compound_ext("noext"), ("noext", ""));
    }

    #[test]
    fn validate_import_filename_rules() {
        assert!(validate_import_filename("weather.md").is_ok());
        assert!(validate_import_filename("日本語.json5").is_ok());
        // 予約デバイス名は stem 判定・case-insensitive
        assert!(validate_import_filename("CON").is_err());
        assert!(validate_import_filename("nul.json5").is_err());
        assert!(validate_import_filename("Lpt9.is").is_err());
        // COM0 / COM10 / 部分一致は予約名ではない
        assert!(validate_import_filename("com0.md").is_ok());
        assert!(validate_import_filename("com10.md").is_ok());
        assert!(validate_import_filename("console.md").is_ok());
        assert!(validate_import_filename("\u{7f}x.md").is_err());
        assert!(validate_import_filename(".dotfile").is_err());
        assert!(validate_import_filename("dot.").is_err());
        assert!(validate_import_filename("space ").is_err());
    }
}
