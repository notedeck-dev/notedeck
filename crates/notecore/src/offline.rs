//! 手動のオフラインモードの判定と保存 (#1350)。
//!
//! 利用者が切り替えたオフラインモードかどうかを答える 1 か所。アプリも、別プロセスの
//! notemaid も、ここを呼ぶ (呼ぶたびにファイルを読むので、プロセスの間で状態を
//! 写し合わない。アプリを閉じた常駐でも同じ答えになる)。
//!
//! 置き場は `state/` の専用のファイルで、書くのは Rust だけ:
//!
//! - オフラインはこの機械だけのもの。持ち運ぶ設定 (`config/`) に置くと、別の機械で
//!   入れたオフラインが同期した先の巡回を止めたり、同期で解除されたりする
//! - 画面の状態のファイル (フロントが全体を書き戻す) に置くと、別の窓の古い写しが
//!   オフラインを上書きし、止めたはずの通信が黙って再開する
//!
//! 回線が無いことによる自動のオフラインは WebView が観測する一時状態で、ここでは
//! 分からない。自動のオフラインでは要求が失敗するだけなので、止めることを求めない。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::app_dir::Layout;
use crate::error::Result;

/// 門や巡回がオフラインで断ったときのエラーの種類。再ログインの案内 (`AUTH_*`) にも、
/// 再試行できる通信エラー (`NETWORK`) にも当たらない名前にする
pub const ERROR_CODE: &str = "OFFLINE_MODE";

const FILE: &str = "offline.json";

#[derive(Serialize, Deserialize)]
struct Stored {
    offline: bool,
}

/// 状態のファイル
pub fn path(layout: &Layout) -> PathBuf {
    layout.state().join(FILE)
}

/// 手動のオフラインモードが有効か。
///
/// - 状態のファイルが在る: その値。**在るのに読めない / 解釈できないときはオフライン**
///   (Rust だけが書くファイルなので、壊れているのは異常。通信しない側に倒す。画面にも
///   オフラインと出るので、利用者が解除すれば書き直されて直る)
/// - 無い: まだ移していない。今までの設定 (`settings.json5` の `modes.offline`) を読む
///   (アプリより先に常駐が起動しても、オフラインを取り違えない)。それも無ければ
///   初回の起動でオンライン
pub fn manual(layout: &Layout) -> bool {
    match std::fs::read_to_string(path(layout)) {
        Ok(text) => serde_json::from_str::<Stored>(&text)
            .map(|s| s.offline)
            .unwrap_or(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => legacy(layout),
        Err(_) => true,
    }
}

/// 移す前の置き場の値。設定は利用者が手で編集するので、読めないときは今までどおり
/// オンラインに倒す
fn legacy(layout: &Layout) -> bool {
    let text = crate::settings_store::read_settings_json(layout).unwrap_or_default();
    crate::stream_mode::offline_enabled(&text)
}

/// 手動のオフラインモードを切り替える
pub fn set(layout: &Layout, offline: bool) -> Result<()> {
    let text = serde_json::to_string(&Stored { offline })
        .map_err(|e| notecli::error::NoteDeckError::Internal(e.to_string()))?;
    std::fs::create_dir_all(layout.state()).map_err(|e| {
        notecli::error::NoteDeckError::InvalidInput(format!(
            "Failed to create {}: {e}",
            layout.state().display()
        ))
    })?;
    crate::settings_store::atomic_write(&path(layout), &text, Some(0o600))
}

/// 今までの設定の値を、状態のファイルへ 1 回だけ移す (アプリの起動時)。既に在れば何もしない。
///
/// 設定が在るのに読めない / 解釈できないときは移さずに Err を返す (次の起動でやり直す)。
/// ここで「オフラインでない」と保存すると、以後は状態のファイルが優先され、元の
/// オフラインが黙って解除される。設定が無い (初回の起動) ときだけ既定を保存する
pub fn migrate(layout: &Layout) -> Result<()> {
    if path(layout).exists() {
        return Ok(());
    }
    let text = crate::settings_store::read_settings_json(layout)?;
    if !text.trim().is_empty() {
        json5::from_str::<serde_json::Value>(&text).map_err(|e| {
            notecli::error::NoteDeckError::InvalidInput(format!(
                "settings.json5 cannot be parsed, the offline flag is not moved: {e}"
            ))
        })?;
    }
    set(layout, crate::stream_mode::offline_enabled(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout_with(settings: Option<&str>, state: Option<&str>) -> (tempfile::TempDir, Layout) {
        let dir = tempfile::tempdir().unwrap();
        let layout = Layout::v1(dir.path());
        if let Some(text) = settings {
            std::fs::create_dir_all(layout.config()).unwrap();
            std::fs::write(layout.config().join("settings.json5"), text).unwrap();
        }
        if let Some(text) = state {
            std::fs::create_dir_all(layout.state()).unwrap();
            std::fs::write(path(&layout), text).unwrap();
        }
        (dir, layout)
    }

    #[test]
    fn the_state_file_decides_and_settings_are_ignored_once_it_exists() {
        // 別の機械から同期された設定が何と言っていても、この機械の状態が答え
        let (_d, on) = layout_with(
            Some("{ 'modes.offline': false }"),
            Some(r#"{"offline":true}"#),
        );
        assert!(manual(&on));
        let (_d, off) = layout_with(
            Some("{ 'modes.offline': true }"),
            Some(r#"{"offline":false}"#),
        );
        assert!(!manual(&off));
    }

    #[test]
    fn an_unreadable_state_file_is_offline() {
        // Rust だけが書くファイルなので、壊れているのは異常。通信しない側に倒す
        let (_d, broken) = layout_with(None, Some("{\"offline\":tr"));
        assert!(manual(&broken));
        let (_d, empty) = layout_with(None, Some(""));
        assert!(manual(&empty));
    }

    #[test]
    fn before_the_move_the_settings_value_is_used() {
        // 状態のファイルがまだ無い (アプリより先に常駐が起動した) ときは、今までの設定を読む
        let (_d, on) = layout_with(Some("{ 'modes.offline': true }"), None);
        assert!(manual(&on));
        let (_d, off) = layout_with(Some("{ 'modes.offline': false }"), None);
        assert!(!manual(&off));
        let (_d, first_run) = layout_with(None, None);
        assert!(!manual(&first_run));
    }

    #[test]
    fn set_writes_the_state_and_migrate_carries_the_old_value_once() {
        let (_d, layout) = layout_with(Some("{ 'modes.offline': true }"), None);
        migrate(&layout).unwrap();
        assert_eq!(
            std::fs::read_to_string(path(&layout)).unwrap(),
            r#"{"offline":true}"#
        );
        // 切替は状態に書く。以後の移行は上書きしない
        set(&layout, false).unwrap();
        assert!(!manual(&layout));
        migrate(&layout).unwrap();
        assert!(!manual(&layout));
    }

    #[test]
    fn migrate_does_not_record_online_when_the_old_value_cannot_be_read() {
        // 設定が壊れている / 読めないときに「オフラインでない」と保存すると、以後は状態の
        // ファイルが優先されて、元のオフラインが黙って解除される。移さずに次の起動へ回す
        let (_d, broken) = layout_with(Some("{ 'modes.offline': tr"), None);
        assert!(migrate(&broken).is_err());
        assert!(!path(&broken).exists());

        // 設定が無いのは初回の起動。既定 (オンライン) を保存してよい
        let (_d, first_run) = layout_with(None, None);
        migrate(&first_run).unwrap();
        assert_eq!(
            std::fs::read_to_string(path(&first_run)).unwrap(),
            r#"{"offline":false}"#
        );
    }
}
