//! 設定ファイルの domain service (#782)。
//!
//! commands/settings.rs から検証・atomic 書込・export/import バンドル収集を
//! 吸い上げ、コマンドハンドラを「パス解決 + service 呼び出し」の薄い層にする。
//! `base_dir` を引数に取り AppHandle に依存しないため、temp dir で直接
//! ユニットテストできる (従来はテスト側が export/import ロジックを再実装していた)。

use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use notecli::error::NoteDeckError;

type Result<T> = std::result::Result<T, NoteDeckError>;

/// Allowed subdirectory names for settings files. Also the set included in settings backup.
pub const ALLOWED_SUBDIRS: &[&str] = &[
    "profiles", "themes", "plugins", "snippets", "memos", "widgets", "skills", "sessions",
    // カラムクエリ (#783 Phase 1.5)。settingsFs の QUERIES_DIR に対応
    "queries",
];

/// Allowed root-level filenames (no subdirectory).
/// このリストは設定バックアップ (export/import) の対象も兼ねる。
pub const ALLOWED_ROOT_FILES: &[&str] = &[
    "custom.css",
    "keybinds.json5",
    "ai.json5",
    "AI.md",
    "performance.json5",
    "navbar.json5",
    "postform.json5",
    "settings.json5",
    "tasks.json5",
    // チュートリアルの達成記録 + NoteDeck 独自実績 (#1029)。プロファイル・
    // アカウントから独立 (アプリ操作の習熟はアカウントに紐づかない)
    "tutorial.json5",
    // principal 別権限 + 確認スキップ (#712 / #714)。capability 層に write を
    // 公開しない制約はここではなく capability registry 側で担保している
    // (settingsFs の固定名ラッパーのみが本コマンドに到達する)
    "permissions.json5",
    // custom.css の編集履歴サイドカー (#913 付随修正)。allowlist から漏れて
    // いたため、フロントの履歴 read/write が一度も成功していなかった
    "custom.css.history.json5",
];

/// Validate a subdirectory name against the whitelist.
pub fn validate_subdir(subdir: &str) -> Result<()> {
    if !ALLOWED_SUBDIRS.contains(&subdir) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid subdirectory: {subdir}. Allowed: {}",
            ALLOWED_SUBDIRS.join(", ")
        )));
    }
    Ok(())
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

/// Resolve the full path for a settings file under `base_dir`.
pub fn resolve_file(base_dir: &Path, subdir: &str, name: &str) -> Result<PathBuf> {
    validate_subdir(subdir)?;
    validate_filename(name)?;
    Ok(base_dir.join(subdir).join(name))
}

/// Resolve the full path for a root-level settings file under `base_dir`.
pub fn resolve_root_file(base_dir: &Path, name: &str) -> Result<PathBuf> {
    if !ALLOWED_ROOT_FILES.contains(&name) {
        return Err(NoteDeckError::InvalidInput(format!(
            "Invalid root file: {name}. Allowed: {}",
            ALLOWED_ROOT_FILES.join(", ")
        )));
    }
    validate_filename(name)?;
    Ok(base_dir.join(name))
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
pub fn list_files(base_dir: &Path, subdir: &str) -> Result<Vec<String>> {
    validate_subdir(subdir)?;
    let dir = base_dir.join(subdir);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut names = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    for entry in entries {
        let entry = entry.map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
        if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

/// Read a settings file as a UTF-8 string.
pub fn read_file(base_dir: &Path, subdir: &str, name: &str) -> Result<String> {
    let path = resolve_file(base_dir, subdir, name)?;
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write a settings file (creates parent directories if needed).
/// `sessions/` は AI 会話内容 (prompt に誤入力された秘密を含みうる) のため 0o600。
pub fn write_file(base_dir: &Path, subdir: &str, name: &str, content: &str) -> Result<()> {
    let path = resolve_file(base_dir, subdir, name)?;
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

/// Delete a settings file (missing file is a no-op).
pub fn delete_file(base_dir: &Path, subdir: &str, name: &str) -> Result<()> {
    let path = resolve_file(base_dir, subdir, name)?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| {
            NoteDeckError::InvalidInput(format!("Failed to delete {}: {e}", path.display()))
        })?;
    }
    Ok(())
}

/// Rename a settings file within the same subdirectory.
pub fn rename_file(base_dir: &Path, subdir: &str, old_name: &str, new_name: &str) -> Result<()> {
    let old_path = resolve_file(base_dir, subdir, old_name)?;
    let new_path = resolve_file(base_dir, subdir, new_name)?;
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
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to rename: {e}")))
}

/// Read a root-level settings file (missing file returns empty string).
pub fn read_root_file(base_dir: &Path, name: &str) -> Result<String> {
    let path = resolve_root_file(base_dir, name)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write a root-level settings file (atomic).
pub fn write_root_file(base_dir: &Path, name: &str, content: &str) -> Result<()> {
    let path = resolve_root_file(base_dir, name)?;
    atomic_write(&path, content, None)
}

/// Read `settings.json5` (missing file returns empty string — first run).
pub fn read_settings_json(base_dir: &Path) -> Result<String> {
    let path = base_dir.join("settings.json5");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path)
        .map_err(|e| NoteDeckError::InvalidInput(format!("Failed to read {}: {e}", path.display())))
}

/// Write `settings.json5`. Creates the settings directory if missing.
/// 他の設定ファイルと同じく atomic write (#719 — 従来ここだけ非 atomic だった)。
pub fn write_settings_json(base_dir: &Path, content: &str) -> Result<()> {
    let path = base_dir.join("settings.json5");
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
pub fn export_bundle(base_dir: &Path) -> Result<BTreeMap<String, String>> {
    let mut bundle: BTreeMap<String, String> = BTreeMap::new();

    for subdir in ALLOWED_SUBDIRS {
        let dir = base_dir.join(subdir);
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
            let key = format!("{subdir}/{}", name.to_string_lossy());
            let content = fs::read_to_string(entry.path())
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(key, content);
        }
    }

    for root_file in ALLOWED_ROOT_FILES {
        let path = base_dir.join(root_file);
        if path.exists() {
            let content = fs::read_to_string(&path)
                .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
            bundle.insert(root_file.to_string(), content);
        }
    }

    Ok(bundle)
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
    ".history.json5",
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

/// 同一 basename のグループ (ソース + メタ + 履歴。単一ファイル種別は 1 ファイル
/// = 1 グループ) を書き込む。衝突判定・skip/suffix はグループ単位 — エントリ
/// 単位でばらすとペア種別のソースとメタが別名に分裂し、既存の孤児ソースと
/// 誤ペアリングしたり履歴だけが別アイテムのリングに結合する。
fn import_group(
    base_dir: &Path,
    subdir: &str,
    members: &[(String, String)],
    warnings: &mut Vec<String>,
) -> Result<()> {
    let dir = base_dir.join(subdir);
    fs::create_dir_all(&dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    // sessions/ は AI 会話内容のため 0o600 を維持 (write_file と同じ流儀)
    let mode = if subdir == "sessions" {
        Some(0o600)
    } else {
        None
    };

    // 書込直前の実列挙 + ASCII casefold の事前スクリーニング (case-sensitive FS
    // でも「大文字小文字のみ異なる既存名は占有」の規則を守る)
    let existing = list_files(base_dir, subdir)?;
    let collides = |name: &str| -> bool {
        let folded = name.to_ascii_lowercase();
        existing.iter().any(|e| e.to_ascii_lowercase() == folded)
    };

    if !members.iter().any(|(n, _)| collides(n)) {
        let names: Vec<String> = members.iter().map(|(n, _)| n.clone()).collect();
        if reserve_all(&dir, &names)? {
            for (name, content) in members {
                atomic_write(&dir.join(name), content, mode)?;
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
        warnings.push(format!("スキップ (既存と内容同一): {}", member_keys()));
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
            atomic_write(&dir.join(cand), content, mode)?;
        }
        let renamed = candidates.join(", ");
        tracing::warn!(
            "Import: group collides, restored with suffix: {} -> {renamed}",
            member_keys()
        );
        warnings.push(format!(
            "別名で復元 (既存と衝突): {} → {renamed}",
            member_keys()
        ));
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
pub fn import_bundle(base_dir: &Path, bundle: &BTreeMap<String, String>) -> Result<Vec<String>> {
    let mut warnings: Vec<String> = Vec::new();
    // (subdir, basename) → [(filename, content)]。BTreeMap なので処理順は決定的
    let mut groups: BTreeMap<(String, String), Vec<(String, String)>> = BTreeMap::new();

    if !bundle.is_empty() {
        fs::create_dir_all(base_dir).map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;
    }

    for (key, content) in bundle {
        let parts: Vec<&str> = key.split('/').collect();
        match parts.as_slice() {
            [name] if ALLOWED_ROOT_FILES.contains(name) => {
                atomic_write(&base_dir.join(name), content, None)?;
            }
            [subdir, name] if ALLOWED_SUBDIRS.contains(subdir) => {
                if let Err(e) = validate_import_filename(name) {
                    tracing::warn!("Import: skipping invalid filename: {key}: {e}");
                    warnings.push(format!("スキップ (不正なファイル名): {key}"));
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
                warnings.push(format!("スキップ (不正なキー): {key}"));
            }
        }
    }

    for ((subdir, _), members) in &groups {
        import_group(base_dir, subdir, members, &mut warnings)?;
    }

    Ok(warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        write_file(dir.path(), "sessions", "20260722.json5", "{}").unwrap();
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
        assert!(ALLOWED_ROOT_FILES.contains(&"permissions.json5"));
    }

    #[test]
    fn tutorial_json5_is_allowed_root_file() {
        // #1029: チュートリアルの達成記録と実績の保存先。allowlist から漏れると
        // 読み書きもバックアップも黙って失敗する
        assert!(ALLOWED_ROOT_FILES.contains(&"tutorial.json5"));
    }

    #[test]
    fn tutorial_json5_is_backed_up() {
        // #1029: 達成記録はユーザーの習熟の記録なので、設定のバックアップに含める
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_root_file(base, "tutorial.json5", r#"{ version: 1 }"#).unwrap();

        let bundle = export_bundle(base).unwrap();
        assert_eq!(
            bundle.get("tutorial.json5").map(String::as_str),
            Some(r#"{ version: 1 }"#)
        );

        fs::remove_file(base.join("tutorial.json5")).unwrap();
        import_bundle(base, &bundle).unwrap();
        assert_eq!(
            read_root_file(base, "tutorial.json5").unwrap(),
            r#"{ version: 1 }"#
        );
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
        write_settings_json(dir.path(), "{ a: 1 }").unwrap();
        assert_eq!(read_settings_json(dir.path()).unwrap(), "{ a: 1 }");
        // 存在しない場合は空文字 (first run)
        let empty = tempfile::tempdir().unwrap();
        assert_eq!(read_settings_json(empty.path()).unwrap(), "");
    }

    // export_bundle / import_bundle を「実物の service 関数で」round-trip 検証する。
    // 従来はコマンド内ロジックのコピーがテストに埋め込まれていた (#782 で解消)。
    #[test]
    fn bundle_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        write_file(
            base,
            "profiles",
            "test.ndprofile.json5",
            r#"{ name: "test" }"#,
        )
        .unwrap();
        write_file(base, "themes", "dark.ndtheme.json5", r#"{ name: "dark" }"#).unwrap();
        write_root_file(base, "custom.css", "body { color: red; }").unwrap();
        write_root_file(base, "keybinds.json5", r#"{ "search": [] }"#).unwrap();

        let bundle = export_bundle(base).unwrap();
        assert_eq!(bundle.len(), 4);

        // 元ファイルを消してから import で復元
        fs::remove_dir_all(base.join("profiles")).unwrap();
        fs::remove_dir_all(base.join("themes")).unwrap();
        fs::remove_file(base.join("custom.css")).unwrap();
        fs::remove_file(base.join("keybinds.json5")).unwrap();

        import_bundle(base, &bundle).unwrap();

        assert_eq!(
            read_file(base, "profiles", "test.ndprofile.json5").unwrap(),
            r#"{ name: "test" }"#
        );
        assert_eq!(
            read_file(base, "themes", "dark.ndtheme.json5").unwrap(),
            r#"{ name: "dark" }"#
        );
        assert_eq!(
            read_root_file(base, "custom.css").unwrap(),
            "body { color: red; }"
        );
        assert_eq!(
            read_root_file(base, "keybinds.json5").unwrap(),
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

        import_bundle(&base, &bundle).unwrap();

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

        let warnings = import_bundle(&base, &bundle).unwrap();

        assert!(base.join("custom.css").exists());
        assert!(!base.join("secret.txt").exists());
        assert!(!base.join("config/bad.json").exists());
        // 拒否 2 件が警告として収集される
        assert_eq!(warnings.len(), 2);
    }

    #[test]
    fn custom_css_history_is_allowed_root_file() {
        // #913 付随修正: allowlist から漏れていて履歴の read/write が常に
        // reject されていた (フロントは settingsFs の history 系でこの名前を使う)
        assert!(ALLOWED_ROOT_FILES.contains(&"custom.css.history.json5"));
        let dir = tempfile::tempdir().unwrap();
        write_root_file(dir.path(), "custom.css.history.json5", "{ entries: [] }").unwrap();
        assert_eq!(
            read_root_file(dir.path(), "custom.css.history.json5").unwrap(),
            "{ entries: [] }"
        );
    }

    #[test]
    fn import_bundle_rejects_nested_keys() {
        // キー構造は 2 要素 (subdir/name) か許可ルートファイルの 1 要素のみ。
        // 3 要素以上のネストは拒否 + 警告
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        let mut bundle = BTreeMap::new();
        bundle.insert("themes/deep/evil.json5".to_string(), "x".to_string());

        let warnings = import_bundle(base, &bundle).unwrap();
        assert!(!base.join("themes/deep/evil.json5").exists());
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("themes/deep/evil.json5"));
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

        let warnings = import_bundle(base, &bundle).unwrap();
        assert_eq!(warnings.len(), 5);
        assert_eq!(list_files(base, "themes").unwrap(), Vec::<String>::new());
        assert_eq!(list_files(base, "skills").unwrap(), Vec::<String>::new());
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

        let warnings = import_bundle(base, &bundle).unwrap();
        assert!(warnings.is_empty());
        assert_eq!(
            read_file(base, "themes", "天気テーマ.ndtheme.json5").unwrap(),
            "{ id: 't1' }"
        );
    }

    #[test]
    fn import_bundle_skips_identical_group() {
        // 衝突した構成が全て内容バイト一致 → グループ全体 skip (再 import の
        // no-op 収束)
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_file(base, "skills", "weather.md", "# weather").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("skills/weather.md".to_string(), "# weather".to_string());

        let warnings = import_bundle(base, &bundle).unwrap();
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("skills/weather.md"));
        assert_eq!(list_files(base, "skills").unwrap(), vec!["weather.md"]);
    }

    #[test]
    fn import_bundle_diverts_conflicting_group_with_suffix() {
        // 内容不一致の衝突はグループ全体を同一 suffix の basename へ退避する。
        // ペア種別 (ソース + メタ) はメタが非衝突でも分裂させない
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_file(base, "widgets", "clock.is", "local code").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("widgets/clock.is".to_string(), "backup code".to_string());
        bundle.insert(
            "widgets/clock.meta.json5".to_string(),
            "{ id: 'w1' }".to_string(),
        );

        let warnings = import_bundle(base, &bundle).unwrap();
        assert_eq!(warnings.len(), 1);

        // 既存はそのまま、バックアップ側は -2 で並置 (suffix は複合拡張子の前)
        assert_eq!(
            read_file(base, "widgets", "clock.is").unwrap(),
            "local code"
        );
        assert_eq!(
            read_file(base, "widgets", "clock-2.is").unwrap(),
            "backup code"
        );
        assert_eq!(
            read_file(base, "widgets", "clock-2.meta.json5").unwrap(),
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
        write_file(base, "skills", "Weather.md", "local").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("skills/weather.md".to_string(), "backup".to_string());

        let warnings = import_bundle(base, &bundle).unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(read_file(base, "skills", "Weather.md").unwrap(), "local");
        assert_eq!(read_file(base, "skills", "weather-2.md").unwrap(), "backup");
    }

    #[test]
    fn import_bundle_suffix_probes_next_free_number() {
        // -2 が占有済みなら全構成が同時に空く次の番号へ
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_file(base, "skills", "weather.md", "local").unwrap();
        write_file(base, "skills", "weather-2.md", "taken").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("skills/weather.md".to_string(), "backup".to_string());

        let warnings = import_bundle(base, &bundle).unwrap();
        assert_eq!(warnings.len(), 1);
        assert_eq!(read_file(base, "skills", "weather-3.md").unwrap(), "backup");
        assert_eq!(read_file(base, "skills", "weather-2.md").unwrap(), "taken");
    }

    #[test]
    fn import_bundle_overwrites_root_files_atomically() {
        // 許可ルートファイルは固定名の単一ファイル。復元 = 置換 (skip/suffix の
        // 衝突分岐は適用しない — suffix 先は allowlist 外で二度と読まれない)
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        write_root_file(base, "custom.css", "old {}").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("custom.css".to_string(), "new {}".to_string());

        let warnings = import_bundle(base, &bundle).unwrap();
        assert!(warnings.is_empty());
        assert_eq!(read_root_file(base, "custom.css").unwrap(), "new {}");
    }

    #[cfg(unix)]
    #[test]
    fn import_bundle_applies_sessions_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();

        let mut bundle = BTreeMap::new();
        bundle.insert("sessions/20260722.json5".to_string(), "{}".to_string());

        import_bundle(base, &bundle).unwrap();
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
        write_file(base, "skills", "weather.md", "local").unwrap();

        let mut bundle = BTreeMap::new();
        bundle.insert("skills/weather.md".to_string(), "backup".to_string());
        bundle.insert("skills/fresh.md".to_string(), "fresh".to_string());

        import_bundle(base, &bundle).unwrap();
        assert_eq!(
            list_files(base, "skills").unwrap(),
            vec!["fresh.md", "weather-2.md", "weather.md"]
        );
        assert_eq!(read_file(base, "skills", "fresh.md").unwrap(), "fresh");
    }

    #[test]
    fn split_compound_ext_longest_first() {
        assert_eq!(
            split_compound_ext("clock.meta.json5"),
            ("clock", ".meta.json5")
        );
        assert_eq!(
            split_compound_ext("clock.history.json5"),
            ("clock", ".history.json5")
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
