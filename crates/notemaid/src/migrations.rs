//! notemaid の持ち物の配置の移行 (#1162)。
//!
//! `notedeck/ai-turns/` (checkpoint / taint.json / budget.json / heartbeat.json) と
//! `notedeck/ai-workspace/` (手元の CLI の cwd) を `notedeck/notemaid/` の下に移す。
//! データ面の migration (`notecore::migrations`) とは別で、こちらは notemaid の所有物なので
//! notemaid が持つ。呼ぶのは data-dir の lock を取った側 (常駐 / sidecar の daemon) と、
//! in-process で AI を回すアプリだけ。失敗しても起動は止めず、読む側は旧パスに fallback する。

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::ai_turn::taint::TaintRecord;
use crate::workspace;

/// ファイル配置の版。transport の Hello で照合し、違えば古い常駐を起動し直す
/// (capability の manifest が同じでも配置だけ変わる版があるため)
pub const FS_LAYOUT: u32 = 2;

const OLD_TURNS: &str = "ai-turns";
const OLD_WORKSPACE: &str = "ai-workspace";
pub const TURNS: &str = "turns";
pub const WORKSPACE: &str = "workspace";

pub fn run_fs(app_dir: &Path) -> std::io::Result<()> {
    let settings = app_dir.join(notecore::commands::settings::SETTINGS_DIR);
    let base = workspace::dir(app_dir);
    move_turns(&settings.join(OLD_TURNS), &base.join(TURNS))?;
    move_dir_if_absent(&settings.join(OLD_WORKSPACE), &base.join(WORKSPACE))?;
    Ok(())
}

/// 旧ディレクトリの中身を新ディレクトリへ。両方にあるファイルは、`taint.json` だけ
/// 新旧の union (安全側は「より汚染」)、それ以外は新を残す。移し終えた旧は消す
fn move_turns(old: &Path, new: &Path) -> std::io::Result<()> {
    if !old.is_dir() {
        return Ok(());
    }
    if !new.exists() {
        if let Some(parent) = new.parent() {
            fs::create_dir_all(parent)?;
        }
        return fs::rename(old, new);
    }
    for entry in fs::read_dir(old)? {
        let entry = entry?;
        let name = entry.file_name();
        let from = entry.path();
        let to = new.join(&name);
        if !entry.file_type()?.is_file() {
            continue;
        }
        if name == "taint.json" && to.exists() {
            let mut merged = read_taint(&to);
            for (session, rec) in read_taint(&from) {
                let slot = merged.entry(session).or_insert_with(|| TaintRecord {
                    since_ms: rec.since_ms,
                    sources: Vec::new(),
                });
                slot.since_ms = slot.since_ms.min(rec.since_ms);
                for s in rec.sources {
                    if !slot.sources.contains(&s) {
                        slot.sources.push(s);
                    }
                }
            }
            fs::write(&to, serde_json::to_string_pretty(&merged)?)?;
            fs::remove_file(&from)?;
        } else if to.exists() {
            fs::remove_file(&from)?;
        } else {
            fs::rename(&from, &to)?;
        }
    }
    // 空になった旧ディレクトリを消す (残っていれば次回また試す)
    let _ = fs::remove_dir(old);
    Ok(())
}

fn move_dir_if_absent(old: &Path, new: &Path) -> std::io::Result<()> {
    if !old.is_dir() {
        return Ok(());
    }
    if new.exists() {
        // 手元の CLI の作業場所は空でよいので、両方あれば旧を捨てる (空のときだけ)
        let _ = fs::remove_dir(old);
        return Ok(());
    }
    if let Some(parent) = new.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(old, new)
}

fn read_taint(path: &Path) -> BTreeMap<String, TaintRecord> {
    fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// 旧パスに残っていて新パスに無いものを読む側の fallback (移行が失敗したとき用)
pub fn turns_dir(app_dir: &Path) -> std::path::PathBuf {
    let new = workspace::dir(app_dir).join(TURNS);
    if new.exists() {
        return new;
    }
    let old = app_dir
        .join(notecore::commands::settings::SETTINGS_DIR)
        .join(OLD_TURNS);
    if old.exists() {
        return old;
    }
    new
}

pub fn workspace_dir(app_dir: &Path) -> std::path::PathBuf {
    workspace::dir(app_dir).join(WORKSPACE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(p: &Path, body: &str) {
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, body).unwrap();
    }

    #[test]
    fn moves_the_old_state_dirs_under_notemaid_and_is_idempotent() {
        let t = tempfile::tempdir().unwrap();
        let settings = t.path().join("notedeck");
        write(&settings.join("ai-turns/budget.json"), "{\"b\":1}");
        write(&settings.join("ai-turns/heartbeat.json"), "{}");
        write(&settings.join("ai-turns/t-1.json"), "{}");
        fs::create_dir_all(settings.join("ai-workspace")).unwrap();
        // 移行前は読む側が旧パスを見る
        assert_eq!(turns_dir(t.path()), settings.join("ai-turns"));

        run_fs(t.path()).unwrap();
        let new = settings.join("notemaid/turns");
        assert!(new.join("budget.json").exists());
        assert!(new.join("heartbeat.json").exists());
        assert!(new.join("t-1.json").exists());
        assert!(!settings.join("ai-turns").exists());
        assert!(settings.join("notemaid/workspace").is_dir());
        assert!(!settings.join("ai-workspace").exists());
        assert_eq!(turns_dir(t.path()), new);
        assert_eq!(workspace_dir(t.path()), settings.join("notemaid/workspace"));
        // 2 回目は何もしない
        run_fs(t.path()).unwrap();
        assert!(new.join("budget.json").exists());
    }

    #[test]
    fn taint_records_are_merged_as_a_union_when_both_exist() {
        let t = tempfile::tempdir().unwrap();
        let settings = t.path().join("notedeck");
        write(
            &settings.join("ai-turns/taint.json"),
            r#"{"s1":{"sinceMs":10,"sources":["notes.show"]},"s2":{"sinceMs":5,"sources":["context"]}}"#,
        );
        write(&settings.join("ai-turns/budget.json"), "old");
        write(
            &settings.join("notemaid/turns/taint.json"),
            r#"{"s2":{"sinceMs":7,"sources":["memos.list"]},"s3":{"sinceMs":9,"sources":["x"]}}"#,
        );
        write(&settings.join("notemaid/turns/budget.json"), "new");
        run_fs(t.path()).unwrap();
        let merged = read_taint(&settings.join("notemaid/turns/taint.json"));
        assert_eq!(merged.len(), 3);
        assert_eq!(merged["s2"].sources, vec!["memos.list", "context"]);
        assert_eq!(merged["s2"].since_ms, 5);
        assert!(merged.contains_key("s1") && merged.contains_key("s3"));
        // それ以外は新を残す
        assert_eq!(
            fs::read_to_string(settings.join("notemaid/turns/budget.json")).unwrap(),
            "new"
        );
        assert!(!settings.join("ai-turns").exists());
    }
}
