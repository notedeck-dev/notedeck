//! push の状態ファイル (#330)。本体 (遷移) は `notecore::push_state`、ここは読み書きと
//! 直列化だけ。
//!
//! 置き場は `Layout::push_state_file` (`notify_cursor.json` と同じ並び)。端末ごとの状態で
//! 秘密は置かない (三つ組は keychain)。端末外バックアップからは外す (backup_rules.xml /
//! data_extraction_rules.xml)。アプリのコマンド・push の受信・ワーカーは同じプロセスで
//! 同時に進めうるので、読み → 変更 → 書き を 1 つのロックで直列化する。
// 使うのは Android だけ (ほかの OS では手順のテストからだけ呼ぶ)
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notecore::push_state::PushStore;

const TMP_NAME: &str = "push_state.json.tmp";

static LOCK: Mutex<()> = Mutex::new(());

fn path(app_dir: &Path) -> PathBuf {
    notecore::app_dir::Layout::from_root(app_dir).push_state_file()
}

fn read(app_dir: &Path) -> PushStore {
    std::fs::read_to_string(path(app_dir))
        .map(|text| PushStore::from_json(&text))
        .unwrap_or_default()
}

/// 今の状態 (無ければ空)
pub fn load(app_dir: &Path) -> PushStore {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    read(app_dir)
}

/// 状態を変える。変わったときだけ書く (一時ファイルに書いてから rename で置き換える。
/// 書込の途中でプロセスが殺されても、途中までの JSON で全口座の状態を失わない)
pub fn update<R>(app_dir: &Path, change: impl FnOnce(&mut PushStore) -> R) -> R {
    let _guard = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut store = read(app_dir);
    let before = store.clone();
    let result = change(&mut store);
    if store != before {
        let tmp = app_dir.join(TMP_NAME);
        let written = std::fs::write(&tmp, store.to_json())
            .and_then(|()| std::fs::rename(&tmp, path(app_dir)));
        if let Err(e) = written {
            tracing::warn!("[push] state write failed: {e}");
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use notecore::app_dir::Layout;
    use std::path::Path;

    /// 規則 1 節ぶんの `domain="root"` の除外パス
    fn root_excludes(section: &str) -> Vec<&str> {
        section
            .split("<exclude domain=\"root\" path=\"")
            .skip(1)
            .filter_map(|rest| rest.split('"').next())
            .collect()
    }

    /// 端末ごとの状態が、配置の新旧どちらでも端末外バックアップと端末間の移行から
    /// 外れている (#1356)。配置 (`Layout`) を変えたら除外規則も変える
    #[test]
    fn android_backup_rules_exclude_device_state() {
        let android = Path::new(env!("CARGO_MANIFEST_DIR")).join("android");
        let old = std::fs::read_to_string(android.join("backup_rules.xml")).unwrap();
        let new = std::fs::read_to_string(android.join("data_extraction_rules.xml")).unwrap();
        let (cloud, transfer) = new.split_once("<device-transfer>").unwrap();

        let root = Path::new("/app");
        let mut targets = Vec::new();
        for layout in [Layout::legacy(root), Layout::v1(root)] {
            for file in [layout.notify_cursor_file(), layout.push_state_file()] {
                targets.push(file.with_extension("json.tmp"));
                targets.push(file);
            }
        }
        let v1 = Layout::v1(root);
        targets.push(v1.state().to_path_buf());
        targets.push(v1.cache().to_path_buf());
        targets.push(v1.logs());
        // 移行前の退避 (`layout_migration` の `pre_layout_backup`)。旧配置の写し
        targets.push(root.join("backups"));

        for (name, section) in [
            ("backup_rules.xml", old.as_str()),
            ("data_extraction_rules.xml <cloud-backup>", cloud),
            ("data_extraction_rules.xml <device-transfer>", transfer),
        ] {
            let excludes = root_excludes(section);
            for target in &targets {
                let rel = target.strip_prefix(root).unwrap();
                assert!(
                    excludes.iter().any(|e| rel.starts_with(e)),
                    "{name} が {} を除外していない",
                    rel.display()
                );
            }
        }
    }
}
