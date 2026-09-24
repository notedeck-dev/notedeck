//! 設定ファイルの変更通知 (#1133 縦切り 4 第 3 弾)。
//!
//! notecore が設定フォルダのファイルを書くとき (AI セッション、`exec: core` な
//! 設定系 capability、復元など)、デバイスの store が持つ写しは古くなる。写しが
//! 古いまま書き戻すと notecore の変更が消えるので、notecore が書き手のときは
//! 必ずここを通して「どのファイルが変わったか」をデバイスに知らせ、デバイスは
//! 該当の store だけ読み直す (AI セッションの `reload` を一般化したもの)。
//!
//! デバイス発の汎用ファイル操作 (`write_settings_file` 等のコマンド) は通知
//! しない。自分の写しは自分で更新している (通知すると自分の書込で自分を
//! 読み直す往復になる)。

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::context::Core;
use crate::error::Result;
use crate::settings_store as store;

/// 変更の種類。rename は「旧名の delete + 新名の write」の 2 件で表す。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum SettingsChangeOp {
    Write,
    Delete,
}

/// 変わったファイル。`subdir` が `None` ならルート直下 (`settings.json5` 等)。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChange {
    pub subdir: Option<String>,
    pub name: String,
    pub op: SettingsChangeOp,
}

/// 変更をデバイスへ届ける口。Tauri 実装は `nd:settings-file-changed` を emit する。
pub trait SettingsSink: Send + Sync + 'static {
    fn settings_changed(&self, change: SettingsChange);
}

/// notecore が書き手として設定ファイルを書く。書けたら通知する。
pub fn write_file(core: &Core, subdir: &str, name: &str, content: &str) -> Result<()> {
    store::write_file(&base(core)?, subdir, name, content)?;
    notify(core, Some(subdir), name, SettingsChangeOp::Write);
    Ok(())
}

/// notecore が書き手として設定ファイルを消す。消せたら通知する。
pub fn delete_file(core: &Core, subdir: &str, name: &str) -> Result<()> {
    store::delete_file(&base(core)?, subdir, name)?;
    notify(core, Some(subdir), name, SettingsChangeOp::Delete);
    Ok(())
}

/// notecore が書き手としてルート直下の設定ファイルを書く。
pub fn write_root_file(core: &Core, name: &str, content: &str) -> Result<()> {
    store::write_root_file(&base(core)?, name, content)?;
    notify(core, None, name, SettingsChangeOp::Write);
    Ok(())
}

fn base(core: &Core) -> Result<std::path::PathBuf> {
    crate::commands::settings::settings_base_dir(core)
}

fn notify(core: &Core, subdir: Option<&str>, name: &str, op: SettingsChangeOp) {
    core.notify_settings_change(SettingsChange {
        subdir: subdir.map(str::to_string),
        name: name.to_string(),
        op,
    });
}

/// テスト用: 届いた変更を溜める sink。
#[cfg(test)]
pub struct MemorySink(pub std::sync::Mutex<Vec<SettingsChange>>);

#[cfg(test)]
impl SettingsSink for MemorySink {
    fn settings_changed(&self, change: SettingsChange) {
        self.0.lock().expect("lock").push(change);
    }
}

#[allow(dead_code)]
fn _assert_object_safe(_: &Arc<dyn SettingsSink>) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_through_core_notify_and_device_style_writes_do_not() {
        let dir = tempfile::tempdir().expect("tempdir");
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let sink = Arc::new(MemorySink(Default::default()));
        core.set_settings_sink(sink.clone());

        write_file(&core, "skills", "a.md", "# a").unwrap();
        write_root_file(&core, "keybinds.json5", "{}").unwrap();
        delete_file(&core, "skills", "a.md").unwrap();
        // デバイス発の汎用書込は通知しない
        store::write_file(&base(&core).unwrap(), "skills", "b.md", "# b").unwrap();

        let got = sink.0.lock().unwrap().clone();
        assert_eq!(
            got,
            vec![
                SettingsChange {
                    subdir: Some("skills".into()),
                    name: "a.md".into(),
                    op: SettingsChangeOp::Write
                },
                SettingsChange {
                    subdir: None,
                    name: "keybinds.json5".into(),
                    op: SettingsChangeOp::Write
                },
                SettingsChange {
                    subdir: Some("skills".into()),
                    name: "a.md".into(),
                    op: SettingsChangeOp::Delete
                },
            ]
        );
    }

    #[test]
    fn without_a_sink_writes_still_succeed() {
        let dir = tempfile::tempdir().expect("tempdir");
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        write_file(&core, "skills", "a.md", "# a").unwrap();
        assert_eq!(
            store::read_file(&base(&core).unwrap(), "skills", "a.md").unwrap(),
            "# a"
        );
    }
}
