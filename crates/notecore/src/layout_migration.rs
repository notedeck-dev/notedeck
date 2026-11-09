//! アプリデータディレクトリの再編 (#1334 段階 3)。
//!
//! 旧配置 (`notedeck/` に設定と記録と状態が同居、キャッシュと状態が root に平置き) を
//! `config/` `data/` `state/` `cache/` に分ける。**何が消してよいものか・同期してよい
//! ものかが置き場で分かる**状態にするのが目的で、移行は app だけが行う (daemon は
//! 旧版アプリの不在を確認できないので版印に従うだけ)。
//!
//! 規則:
//! - **全か無か。** 移行を始める前に実行可能性を確かめ、途中で失敗したら動かした分を
//!   逆順で戻し、旧配置のまま起動を続ける。エントリ単位の二重解決は作らない
//! - エントリ単位で「移動元があり移動先が無い」ときだけ `rename`。判定は
//!   `symlink_metadata` (リンクは辿らず、リンクそのものを動かす)。別ファイルシステム
//!   (EXDEV) の copy + remove は採らない
//! - `notedeck/` 自体がシンボリックリンクなら移行しない (中身を引き抜くと同期先から
//!   消え、旧版の別端末の設定が消える)
//! - 移動元と移動先が両方ある (旧版を起動した痕跡) ときは型ごとに併合し、負けた方は
//!   `notedeck.old-<stamp>/` に退避して知らせる
//! - 版印 `layout.json5` は全エントリ成功時にだけ書く
//! - `notemaid.lock` と公開仕様の `api-token` は動かさない

use std::fs;
use std::path::{Path, PathBuf};

use crate::app_dir::{Layout, FS_LAYOUT};
use crate::settings_store::{self as store, Area};

/// 移行しなかった理由
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Skip {
    /// 既に再編済み
    AlreadyDone,
    /// `notedeck/` がシンボリックリンク (同期先を向けている)。手で張り直してから
    SettingsIsSymlink,
    /// 旧配置の書き手 (常駐 notemaid) を止められなかった
    ResidentAlive,
    /// 途中で失敗し、動かした分は戻した
    Failed(String),
}

/// 利用者に知らせること (操作が要る人だけ)
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LayoutNotice {
    /// 旧配置と新配置の両方にあったものを退避した
    #[serde(rename_all = "camelCase")]
    Shelved { dir: String, count: u32 },
    /// `notedeck/` がリンクなので移行しなかった
    SymlinkedSettings,
    /// 常駐 notemaid を止めた (更新するまで HEARTBEAT の継続が切れる)
    StandaloneStopped,
    /// 常駐 notemaid を止められず、移行しなかった
    ResidentAlive,
    /// 失敗して旧配置のまま
    Failed { message: String },
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LayoutMigrationReport {
    /// この起動で再編した
    pub migrated: bool,
    pub notices: Vec<LayoutNotice>,
}

/// 両方あるときの併合規則
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Merge {
    /// 記録 (sessions / turns / memos): id 単位の和集合、同 id は `updatedAt` の新しい方
    NewestByUpdatedAt,
    /// MEMORY.md: 行の和集合
    LineUnion,
    /// それ以外: 新 (移動先) を残し旧を退避
    KeepNew,
}

#[derive(Clone, Debug)]
struct Move {
    from: PathBuf,
    to: PathBuf,
    merge: Merge,
}

/// 人の記録の中で、両方あったときに行の和集合を取るもの
const LINE_UNION_FILES: &[&str] = &["MEMORY.md"];

fn stamp() -> String {
    // YYYYMMDDhhmmss (UTC)。chrono を足さずに手で組む
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // 日数 → 暦 (Howard Hinnant の civil_from_days)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}{m:02}{d:02}{:02}{:02}{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn exists_no_follow(p: &Path) -> bool {
    fs::symlink_metadata(p).is_ok()
}

fn is_symlink(p: &Path) -> bool {
    fs::symlink_metadata(p)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// 旧配置に移すものがあるか (無ければ初回起動 = 版印だけ書いて新配置で始める)
fn has_legacy_content(root: &Path) -> bool {
    let legacy = Layout::legacy(root);
    exists_no_follow(legacy.config())
        || exists_no_follow(&legacy.image_cache())
        || exists_no_follow(&legacy.emoji_cache())
        || exists_no_follow(&legacy.pet_cache())
        || exists_no_follow(&legacy.api_tokens_file())
        || exists_no_follow(&legacy.notemaid_accounts_file())
        || exists_no_follow(&legacy.notify_cursor_file())
        || exists_no_follow(&legacy.push_state_file())
}

/// 移動の計画。旧配置の実在するエントリだけを並べる
fn plan(root: &Path) -> Vec<Move> {
    let old = Layout::legacy(root);
    let new = Layout::v1(root);
    let mut moves = Vec::new();
    let mut push = |from: PathBuf, to: PathBuf, merge: Merge| {
        if exists_no_follow(&from) {
            moves.push(Move { from, to, merge });
        }
    };

    // 設定ディレクトリの中身
    let settings = old.config();
    let mut known: std::collections::HashSet<String> = std::collections::HashSet::new();
    for f in store::ROOT_FILES {
        known.insert(f.name.to_string());
        let to = match f.area {
            Area::Config => new.config().join(f.name),
            Area::Data => new.data().join(f.name),
            Area::State | Area::StateFromV1 => new.state().join(f.name),
        };
        push(settings.join(f.name), to, Merge::KeepNew);
    }
    for s in store::SUBDIRS {
        known.insert(s.dir.to_string());
        let merge = match s.name {
            "sessions" | "memos" => Merge::NewestByUpdatedAt,
            _ => Merge::KeepNew,
        };
        let to = match s.area {
            Area::Config => new.config().join(s.dir),
            Area::Data => new.data().join(s.dir),
            Area::State | Area::StateFromV1 => new.state().join(s.dir),
        };
        if s.area != Area::State {
            push(settings.join(s.dir), to, merge);
        }
    }
    // 人格と記憶 (data) と notemaid の状態 (turns / workspace)
    known.insert(store::WORKSPACE_DIR.to_string());
    let maid = settings.join(store::WORKSPACE_DIR);
    if exists_no_follow(&maid) {
        if let Ok(entries) = fs::read_dir(&maid) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                let from = e.path();
                let (to, merge) = match name.as_str() {
                    "turns" => (new.notemaid_state().join("turns"), Merge::NewestByUpdatedAt),
                    "workspace" => (new.notemaid_state().join("workspace"), Merge::KeepNew),
                    n if LINE_UNION_FILES.contains(&n) => (
                        new.data().join(store::WORKSPACE_DIR).join(&name),
                        Merge::LineUnion,
                    ),
                    _ => (
                        new.data().join(store::WORKSPACE_DIR).join(&name),
                        Merge::KeepNew,
                    ),
                };
                push(from, to, merge);
            }
        }
    }
    // Git の持ち物は設定と一緒に動かす (ドット始まりを無視する規則の例外)。root の編集履歴
    // (`custom.css.history.json5` 等) は state/history/root/ へ (#1334 段階 2)
    if let Ok(entries) = fs::read_dir(settings) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with(".git") {
                known.insert(name.clone());
                push(e.path(), new.config().join(&name), Merge::KeepNew);
            } else if let Some(base) = name.strip_suffix(crate::edit_history::HISTORY_SUFFIX) {
                if let Ok(to) = store::history_path(&new, None, base) {
                    known.insert(name.clone());
                    push(e.path(), to, Merge::KeepNew);
                }
            }
        }
    }
    // loopback 同意 (#1293) は状態: 旧 `loopback/consent.json` → `state/loopback-consent.json`
    let consent = settings
        .join(crate::loopback_consent::DIR)
        .join("consent.json");
    known.insert(crate::loopback_consent::DIR.to_string());
    push(
        consent,
        new.state().join(crate::loopback_consent::FILE),
        Merge::KeepNew,
    );
    // root 直下の平置き
    push(old.image_cache(), new.image_cache(), Merge::KeepNew);
    push(old.emoji_cache(), new.emoji_cache(), Merge::KeepNew);
    push(old.pet_cache(), new.pet_cache(), Merge::KeepNew);
    push(old.api_tokens_file(), new.api_tokens_file(), Merge::KeepNew);
    push(
        old.notemaid_accounts_file(),
        new.notemaid_accounts_file(),
        Merge::KeepNew,
    );
    push(
        old.notify_cursor_file(),
        new.notify_cursor_file(),
        Merge::KeepNew,
    );
    push(old.push_state_file(), new.push_state_file(), Merge::KeepNew);
    moves
}

/// 設定ディレクトリに残る、計画に無いエントリ (未知のもの、一時ファイル)
fn unknown_entries(root: &Path, moves: &[Move]) -> Vec<PathBuf> {
    let settings = Layout::legacy(root).config().to_path_buf();
    let planned: std::collections::HashSet<PathBuf> =
        moves.iter().map(|m| m.from.clone()).collect();
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(&settings) {
        for e in entries.flatten() {
            let p = e.path();
            if planned.contains(&p) {
                continue;
            }
            // notemaid/ と loopback/ の中は個別に計画している
            if p == settings.join(store::WORKSPACE_DIR)
                || p == settings.join(crate::loopback_consent::DIR)
            {
                continue;
            }
            out.push(p);
        }
    }
    out
}

/// 実行の記録 (戻すため)
struct Journal {
    done: Vec<(PathBuf, PathBuf)>,
    created_dirs: Vec<PathBuf>,
    shelved: u32,
    shelf: PathBuf,
}

impl Journal {
    fn rename(&mut self, from: &Path, to: &Path) -> std::io::Result<()> {
        if let Some(parent) = to.parent() {
            self.mkdirs(parent)?;
        }
        fs::rename(from, to)?;
        self.done.push((from.to_path_buf(), to.to_path_buf()));
        Ok(())
    }

    fn mkdirs(&mut self, dir: &Path) -> std::io::Result<()> {
        let mut missing = Vec::new();
        let mut cur = Some(dir);
        while let Some(d) = cur {
            if d.exists() {
                break;
            }
            missing.push(d.to_path_buf());
            cur = d.parent();
        }
        fs::create_dir_all(dir)?;
        for d in missing.into_iter().rev() {
            self.created_dirs.push(d);
        }
        Ok(())
    }

    /// 負けた側を退避する
    fn shelve(&mut self, from: &Path, root: &Path) -> std::io::Result<()> {
        let rel = from.strip_prefix(root).unwrap_or(from);
        let to = self.shelf.join(rel);
        self.rename(from, &to)?;
        self.shelved += 1;
        Ok(())
    }

    fn rollback(&mut self) {
        for (from, to) in self.done.drain(..).rev() {
            if let Err(e) = fs::rename(&to, &from) {
                tracing::error!(from = %from.display(), to = %to.display(), %e, "layout rollback failed");
            }
        }
        for d in self.created_dirs.drain(..).rev() {
            let _ = fs::remove_dir(&d);
        }
    }
}

fn updated_at(path: &Path) -> Option<f64> {
    let text = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = json5::from_str(&text).ok()?;
    match v.get("updatedAt") {
        Some(serde_json::Value::Number(n)) => n.as_f64(),
        Some(serde_json::Value::String(s)) => {
            // ISO 文字列は辞書順 = 時系列なので、先頭 14 桁の数字に落とす
            let digits: String = s.chars().filter(|c| c.is_ascii_digit()).take(14).collect();
            digits.parse::<f64>().ok()
        }
        _ => None,
    }
}

fn mtime(path: &Path) -> f64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// 1 エントリを動かす。移動先があれば併合規則に従う
fn apply(
    j: &mut Journal,
    root: &Path,
    from: &Path,
    to: &Path,
    merge: Merge,
) -> std::io::Result<()> {
    if !exists_no_follow(to) {
        // リンクは辿らず、リンクそのものを動かす。深さが変わる先では相対の向き先が
        // 狂うので絶対化して張り直す
        if is_symlink(from) {
            let target = fs::read_link(from)?;
            let abs = if target.is_absolute() {
                target
            } else {
                from.parent().unwrap_or(root).join(target)
            };
            if let Some(parent) = to.parent() {
                j.mkdirs(parent)?;
            }
            #[cfg(unix)]
            std::os::unix::fs::symlink(&abs, to)?;
            #[cfg(not(unix))]
            {
                let _ = abs;
                return Err(std::io::Error::other(
                    "symlinked entries are not migrated here",
                ));
            }
            fs::remove_file(from)?;
            j.done.push((from.to_path_buf(), to.to_path_buf()));
            return Ok(());
        }
        return j.rename(from, to);
    }
    let from_meta = fs::symlink_metadata(from)?;
    let to_meta = fs::symlink_metadata(to)?;
    if from_meta.is_dir() && to_meta.is_dir() {
        // ディレクトリ同士: 子ごとに
        let mut children: Vec<PathBuf> = fs::read_dir(from)?.flatten().map(|e| e.path()).collect();
        children.sort();
        for child in children {
            let name = child.file_name().map(PathBuf::from).unwrap_or_default();
            let child_merge = if LINE_UNION_FILES.iter().any(|f| name == Path::new(f)) {
                Merge::LineUnion
            } else {
                merge
            };
            apply(j, root, &child, &to.join(&name), child_merge)?;
        }
        let _ = fs::remove_dir(from);
        return Ok(());
    }
    // ファイル同士 (片方がディレクトリなら新を残して旧を退避)
    match merge {
        Merge::NewestByUpdatedAt if from_meta.is_file() && to_meta.is_file() => {
            let a = updated_at(from).unwrap_or_else(|| mtime(from));
            let b = updated_at(to).unwrap_or_else(|| mtime(to));
            if a > b {
                j.shelve(to, root)?;
                j.rename(from, to)
            } else {
                j.shelve(from, root)
            }
        }
        Merge::LineUnion if from_meta.is_file() && to_meta.is_file() => {
            let old = fs::read_to_string(from).unwrap_or_default();
            let new = fs::read_to_string(to).unwrap_or_default();
            let mut merged: Vec<&str> = new.lines().collect();
            for line in old.lines() {
                if !line.trim().is_empty() && !merged.contains(&line) {
                    merged.push(line);
                }
            }
            let body = format!("{}\n", merged.join("\n"));
            // 退避してから書く (戻すときは退避分が旧)
            j.shelve(from, root)?;
            store::atomic_write(to, &body, None).map_err(std::io::Error::other)
        }
        _ => j.shelve(from, root),
    }
}

/// 移行前の自動バックアップ (`backups/pre-layout-<stamp>/`、0700)。設定バンドルと
/// DB のファイルをそのまま写す。`~/Downloads` には置かない (他人の本文を含む)
fn pre_layout_backup(root: &Path, stamp: &str) -> std::io::Result<PathBuf> {
    let dir = root.join("backups").join(format!("pre-layout-{stamp}"));
    fs::create_dir_all(&dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(root.join("backups"), fs::Permissions::from_mode(0o700));
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    let legacy = Layout::legacy(root);
    if let Ok(bundle) = store::export_bundle(&legacy) {
        let json = serde_json::to_string_pretty(&bundle)?;
        store::atomic_write(&dir.join("settings.json"), &json, Some(0o600))
            .map_err(std::io::Error::other)?;
    }
    for name in ["notecli.db", "notecli.db-wal", "notecli.db-shm"] {
        let src = root.join(name);
        if src.is_file() {
            fs::copy(&src, dir.join(name))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(dir.join(name), fs::Permissions::from_mode(0o600));
            }
        }
    }
    // 前の版の pre-layout は消す (保持は次の版まで)
    if let Ok(entries) = fs::read_dir(root.join("backups")) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with("pre-layout-") && e.path() != dir {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
    Ok(dir)
}

fn write_marker(root: &Path) -> std::io::Result<()> {
    let body = format!(
        "// NoteDeck のデータディレクトリの配置の版 (#1334)。消すと旧配置として読まれる\n{{\n  version: {FS_LAYOUT},\n  migratedAt: '{}',\n}}\n",
        stamp()
    );
    store::atomic_write(&Layout::marker_path(root), &body, None).map_err(std::io::Error::other)
}

/// 再編を 1 回試みる。呼ぶ側が `.layout.lock` を取り、旧配置の書き手 (常駐 notemaid) が
/// 居ないことを確かめてから呼ぶ。戻り値は利用者に知らせること
pub fn migrate(root: &Path) -> Result<LayoutMigrationReport, Skip> {
    if Layout::marker_path(root).is_file() {
        return Err(Skip::AlreadyDone);
    }
    let legacy = Layout::legacy(root);
    if is_symlink(legacy.config()) {
        return Err(Skip::SettingsIsSymlink);
    }
    if !has_legacy_content(root) {
        // 初回起動: 新配置で始める
        for d in [
            Layout::v1(root).config().to_path_buf(),
            Layout::v1(root).data().to_path_buf(),
            Layout::v1(root).state().to_path_buf(),
            Layout::v1(root).cache().to_path_buf(),
        ] {
            fs::create_dir_all(&d).map_err(|e| Skip::Failed(e.to_string()))?;
        }
        write_marker(root).map_err(|e| Skip::Failed(e.to_string()))?;
        // 何も動かしていないので「移行した」とは言わない
        return Ok(LayoutMigrationReport {
            migrated: false,
            notices: Vec::new(),
        });
    }
    let stamp = stamp();
    // 実行可能性: 各移動元が読める
    let moves = plan(root);
    for m in &moves {
        if fs::symlink_metadata(&m.from).is_err() {
            return Err(Skip::Failed(format!("cannot read {}", m.from.display())));
        }
    }
    if let Err(e) = pre_layout_backup(root, &stamp) {
        return Err(Skip::Failed(format!("pre-layout backup failed: {e}")));
    }
    let mut journal = Journal {
        done: Vec::new(),
        created_dirs: Vec::new(),
        shelved: 0,
        shelf: root.join(format!("notedeck.old-{stamp}")),
    };
    let unknown = unknown_entries(root, &moves);
    let run = (|| -> std::io::Result<()> {
        for m in &moves {
            apply(&mut journal, root, &m.from, &m.to, m.merge)?;
        }
        // 設定ではないものが設定の隣に残らないように、未知のエントリは退避する
        for p in &unknown {
            journal.shelve(p, root)?;
        }
        let new = Layout::v1(root);
        for d in [new.config(), new.data(), new.state(), new.cache()] {
            journal.mkdirs(d)?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let secrets = new.secrets();
            journal.mkdirs(&secrets)?;
            let _ = fs::set_permissions(&secrets, fs::Permissions::from_mode(0o700));
        }
        // 空になった旧ディレクトリを消す (notemaid/ と loopback/ は子を個別に動かしたので先に)
        let _ = fs::remove_dir(legacy.config().join(store::WORKSPACE_DIR));
        let _ = fs::remove_dir(legacy.config().join(crate::loopback_consent::DIR));
        let _ = fs::remove_dir(legacy.config());
        write_marker(root)
    })();
    if let Err(e) = run {
        journal.rollback();
        let _ = fs::remove_file(Layout::marker_path(root));
        let _ = fs::remove_dir(&journal.shelf);
        return Err(Skip::Failed(e.to_string()));
    }
    // チェックポイント (セッション同等の中身) は 0600 に揃える
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(entries) = fs::read_dir(Layout::v1(root).notemaid_state().join("turns")) {
            for e in entries.flatten() {
                if e.path().is_file() {
                    let _ = fs::set_permissions(e.path(), fs::Permissions::from_mode(0o600));
                }
            }
        }
    }
    // 雛形のままの .gitignore は消す (再編後は除外が要らない)
    let gi = Layout::v1(root).config().join(".gitignore");
    if fs::read_to_string(&gi).ok().as_deref() == Some(store::GITIGNORE_TEMPLATE) {
        let _ = fs::remove_file(&gi);
    }
    let mut notices = Vec::new();
    if journal.shelved > 0 {
        notices.push(LayoutNotice::Shelved {
            dir: journal.shelf.display().to_string(),
            count: journal.shelved,
        });
    }
    Ok(LayoutMigrationReport {
        migrated: true,
        notices,
    })
}

/// 退避 (`notedeck.old-<stamp>/`) と移行前のバックアップ (`backups/pre-layout-<stamp>/`) の
/// 保持は「次の版まで」。版の境界は配置からは分からないので、日数で近似して消す
pub const SHELF_RETENTION_DAYS: u64 = 30;

/// 古い退避と移行前のバックアップを消す (起動時、warn 止まり)
pub fn sweep_old_shelves(root: &Path) {
    let cutoff = std::time::SystemTime::now().checked_sub(std::time::Duration::from_secs(
        SHELF_RETENTION_DAYS * 86_400,
    ));
    let Some(cutoff) = cutoff else {
        return;
    };
    let mut targets: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().starts_with("notedeck.old-") {
                targets.push(e.path());
            }
        }
    }
    if let Ok(entries) = fs::read_dir(root.join("backups")) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().starts_with("pre-layout-") {
                targets.push(e.path());
            }
        }
    }
    for dir in targets {
        let old_enough = fs::metadata(&dir)
            .and_then(|m| m.modified())
            .map(|t| t < cutoff)
            .unwrap_or(false);
        if !old_enough {
            continue;
        }
        match fs::remove_dir_all(&dir) {
            Ok(()) => tracing::info!(path = %dir.display(), "removed an old layout shelf"),
            Err(e) => {
                tracing::warn!(path = %dir.display(), %e, "cannot remove an old layout shelf")
            }
        }
    }
}

/// 排他 (`.layout.lock`、blocking) を取って `migrate` を呼ぶ。版印があれば何もしない
pub fn run_locked(root: &Path) -> Result<LayoutMigrationReport, Skip> {
    if Layout::marker_path(root).is_file() {
        return Err(Skip::AlreadyDone);
    }
    let _lock = crate::app_dir::lock_layout(root).map_err(|e| Skip::Failed(e.to_string()))?;
    migrate(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, body: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }

    #[test]
    fn stamp_is_fourteen_digits() {
        let s = stamp();
        assert_eq!(s.len(), 14);
        assert!(s.chars().all(|c| c.is_ascii_digit()));
        assert!(s.starts_with("20"));
    }

    #[test]
    fn a_fresh_install_starts_in_the_new_layout() {
        let t = tempfile::tempdir().unwrap();
        let r = migrate(t.path()).unwrap();
        assert!(!r.migrated && r.notices.is_empty());
        let l = Layout::from_root(t.path());
        assert!(!l.is_legacy());
        assert!(l.config().is_dir() && l.state().is_dir());
        assert_eq!(migrate(t.path()), Err(Skip::AlreadyDone));
    }

    #[test]
    fn a_legacy_tree_is_split_into_config_data_state_and_cache() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        let old = Layout::legacy(root);
        write(&old.config().join("settings.json5"), "{ a: 1 }\n");
        write(&old.config().join("client.json5"), "{ backend: 'auto' }\n");
        write(&old.config().join("tutorial.json5"), "{}\n");
        write(
            &old.config().join("profiles/main.ndprofile.json5"),
            "{ id: 'm' }\n",
        );
        write(&old.config().join("memos/a.md"), "memo\n");
        write(
            &old.config().join("sessions/s.json5"),
            "{ id: 's', updatedAt: 1 }\n",
        );
        write(&old.config().join("notemaid/SOUL.md"), "soul\n");
        write(&old.config().join("notemaid/turns/taint.json"), "{}\n");
        write(&old.config().join("notemaid/workspace/.keep"), "");
        write(&old.config().join(".gitignore"), store::GITIGNORE_TEMPLATE);
        write(&old.config().join("unknown.txt"), "???");
        write(
            &old.config().join("custom.css.history.json5"),
            "{ entries: [] }",
        );
        write(&old.config().join("loopback/consent.json"), "{}");
        write(&old.image_cache().join("x.bin"), "img");
        write(&old.api_tokens_file(), "[]");
        write(&root.join("notecli.db"), "db");
        write(&root.join("notemaid.lock"), "1");
        write(&root.join("api-token"), "tok");

        let r = migrate(root).unwrap();
        assert!(r.migrated);
        let new = Layout::from_root(root);
        assert!(!new.is_legacy());
        assert_eq!(
            fs::read_to_string(new.config().join("settings.json5")).unwrap(),
            "{ a: 1 }\n"
        );
        assert!(new.config().join("profiles/main.ndprofile.json5").is_file());
        assert!(new.state().join("client.json5").is_file());
        assert!(new.state().join("tutorial.json5").is_file());
        assert!(new.data().join("memos/a.md").is_file());
        assert!(new.data().join("sessions/s.json5").is_file());
        assert!(new.data().join("notemaid/SOUL.md").is_file());
        assert!(new.notemaid_state().join("turns/taint.json").is_file());
        assert!(new.notemaid_state().join("workspace").is_dir());
        assert!(new.image_cache().join("x.bin").is_file());
        assert!(new.api_tokens_file().is_file());
        assert!(new
            .state()
            .join("history/root/custom.css.history.json5")
            .is_file());
        assert!(new.state().join("loopback-consent.json").is_file());
        // 動かさないもの
        assert!(root.join("notecli.db").is_file());
        assert!(root.join("notemaid.lock").is_file());
        assert!(root.join("api-token").is_file());
        // 旧ディレクトリは消え、未知のものは退避され、雛形の .gitignore は消える
        assert!(!old.config().exists());
        assert!(!new.config().join(".gitignore").exists());
        assert!(matches!(
            r.notices.as_slice(),
            [LayoutNotice::Shelved { count: 1, .. }]
        ));
        let shelf = fs::read_dir(root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .find(|n| n.starts_with("notedeck.old-"))
            .expect("shelf");
        assert!(root.join(&shelf).join("notedeck/unknown.txt").is_file());
        // 移行前のバックアップ
        let backups: Vec<_> = fs::read_dir(root.join("backups"))
            .unwrap()
            .flatten()
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(backups[0].path().join("settings.json").is_file());
        assert!(backups[0].path().join("notecli.db").is_file());
    }

    #[test]
    fn both_sides_present_are_merged_by_type() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        let old = Layout::legacy(root);
        let new = Layout::v1(root);
        write(
            &old.config().join("sessions/s.json5"),
            "{ id: 's', updatedAt: 5 }\n",
        );
        write(
            &new.data().join("sessions/s.json5"),
            "{ id: 's', updatedAt: 2 }\n",
        );
        write(
            &old.config().join("sessions/only-old.json5"),
            "{ id: 'o', updatedAt: 1 }\n",
        );
        write(&old.config().join("notemaid/MEMORY.md"), "- a\n- b\n");
        write(&new.data().join("notemaid/MEMORY.md"), "- b\n- c\n");
        write(&old.config().join("settings.json5"), "old");
        write(&new.config().join("settings.json5"), "new");
        let r = migrate(root).unwrap();
        // sessions: 新しい updatedAt が勝つ、片方だけのものは和集合
        assert_eq!(
            fs::read_to_string(new.data().join("sessions/s.json5")).unwrap(),
            "{ id: 's', updatedAt: 5 }\n"
        );
        assert!(new.data().join("sessions/only-old.json5").is_file());
        // MEMORY.md は行の和集合
        assert_eq!(
            fs::read_to_string(new.data().join("notemaid/MEMORY.md")).unwrap(),
            "- b\n- c\n- a\n"
        );
        // 設定は新を残して旧を退避
        assert_eq!(
            fs::read_to_string(new.config().join("settings.json5")).unwrap(),
            "new"
        );
        assert!(
            matches!(r.notices.as_slice(), [LayoutNotice::Shelved { count, .. }] if *count >= 3)
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_settings_dir_is_left_alone() {
        let t = tempfile::tempdir().unwrap();
        let target = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(target.path(), Layout::legacy(t.path()).config()).unwrap();
        assert_eq!(migrate(t.path()), Err(Skip::SettingsIsSymlink));
        assert!(Layout::from_root(t.path()).is_legacy());
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_entries_move_as_links_with_an_absolute_target() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        let old = Layout::legacy(root);
        let target = tempfile::tempdir().unwrap();
        fs::create_dir_all(old.config()).unwrap();
        std::os::unix::fs::symlink(target.path(), old.config().join("profiles")).unwrap();
        write(&target.path().join("main.ndprofile.json5"), "{ id: 'm' }");
        migrate(root).unwrap();
        let link = Layout::v1(root).config().join("profiles");
        assert!(is_symlink(&link));
        assert_eq!(fs::read_link(&link).unwrap(), target.path());
        assert!(link.join("main.ndprofile.json5").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn a_failure_rolls_everything_back() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap();
        let root = t.path();
        let old = Layout::legacy(root);
        write(&old.config().join("settings.json5"), "{}");
        write(&old.config().join("profiles/main.ndprofile.json5"), "{}");
        // 移動先の親を読取専用にして rename を失敗させる
        fs::create_dir_all(root.join("config")).unwrap();
        fs::set_permissions(root.join("config"), fs::Permissions::from_mode(0o500)).unwrap();
        let r = migrate(root);
        fs::set_permissions(root.join("config"), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(matches!(r, Err(Skip::Failed(_))), "{r:?}");
        assert!(old.config().join("settings.json5").is_file());
        assert!(old.config().join("profiles/main.ndprofile.json5").is_file());
        assert!(!Layout::marker_path(root).exists());
        assert!(Layout::from_root(root).is_legacy());
    }
}
