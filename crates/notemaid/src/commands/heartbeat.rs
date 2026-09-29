//! HEARTBEAT の手動実行 (#411 / #1106)。timer は手元側 (アプリ) か notecored が持つが、
//! 「今すぐ 1 回」は本体 (notecore) の run_once をそのまま呼ぶ。常駐構成では notecored が回す

use notecore::context::Core;
use notecore::error::Result;

pub async fn heartbeat_trigger_now(core: &Core) -> Result<()> {
    crate::heartbeat::run_once(core, "manual").await;
    Ok(())
}
