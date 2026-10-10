//! HEARTBEAT の手動実行 (#411 / #1106)。timer は手元側 (アプリ) か notemaid が持つが、
//! 「今すぐ 1 回」は本体 (notecore) の run_once をそのまま呼ぶ。常駐構成では notemaid が回す

use notecore::context::Core;
use notecore::error::Result;

pub async fn heartbeat_trigger_now(core: &Core) -> Result<()> {
    crate::heartbeat::run_once(core, "manual").await;
    Ok(())
}

/// `since` (ms) より後に AI が「通知して」とした報告の記録 (#1227)。アプリを閉じている間の
/// 件数を、開いている間に知らせたものと同じ基準で数える
pub async fn heartbeat_notices_since(
    core: &Core,
    since: u64,
) -> Result<Vec<crate::heartbeat::HeartbeatNotice>> {
    let state = crate::heartbeat::load_state(core.app_dir()?);
    Ok(crate::heartbeat::notices_since(&state, since))
}
