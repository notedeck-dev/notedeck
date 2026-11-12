//! 手動のオフラインモードの判定 (#1350)。
//!
//! 利用者が切り替えたオフラインモードかどうかを答える 1 か所。アプリも、別プロセスの
//! notemaid も、ここを呼ぶ (呼ぶたびにファイルを読むので、プロセスの間で状態を
//! 写し合わない。アプリを閉じた常駐でも同じ答えになる)。
//!
//! 回線が無いことによる自動のオフラインは WebView が観測する一時状態で、ここでは
//! 分からない。自動のオフラインでは要求が失敗するだけなので、止めることを求めない。

use crate::app_dir::Layout;

/// 門や巡回がオフラインで断ったときのエラーの種類。再ログインの案内 (`AUTH_*`) にも、
/// 再試行できる通信エラー (`NETWORK`) にも当たらない名前にする
pub const ERROR_CODE: &str = "OFFLINE_MODE";

/// 手動のオフラインモードが有効か。設定が無い / 読めない / 壊れているときは false
/// (今の置き場は利用者が手で編集し、別の機械と同期する `settings.json5`。編集途中の
/// 誤りでオフラインに倒すと、理由の分からないまま通信が止まる)
pub fn manual(layout: &Layout) -> bool {
    let text = crate::settings_store::read_settings_json(layout).unwrap_or_default();
    crate::stream_mode::offline_enabled(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout_with(settings: Option<&str>) -> (tempfile::TempDir, Layout) {
        let dir = tempfile::tempdir().unwrap();
        let layout = Layout::v1(dir.path());
        if let Some(text) = settings {
            std::fs::create_dir_all(layout.config()).unwrap();
            std::fs::write(layout.config().join("settings.json5"), text).unwrap();
        }
        (dir, layout)
    }

    #[test]
    fn reads_the_manual_flag_from_settings() {
        let (_d, on) = layout_with(Some("{ 'modes.offline': true }"));
        assert!(manual(&on));
        let (_d, off) = layout_with(Some("{ 'modes.offline': false }"));
        assert!(!manual(&off));
    }

    #[test]
    fn a_missing_or_broken_settings_file_is_online() {
        let (_d, missing) = layout_with(None);
        assert!(!manual(&missing));
        let (_d, broken) = layout_with(Some("{ 'modes.offline': tr"));
        assert!(!manual(&broken));
    }
}
