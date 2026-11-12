//! HEARTBEAT の手動実行 / 試走 / 状態 (#411 / #1106 / #1321)。timer は手元側 (アプリ) か
//! notemaid が持つが、「今すぐ 1 回」「この接続を試す」「最後の巡回」は本体をそのまま呼ぶ。
//! 常駐構成では notemaid が回す (中継で届く)

use notecli::error::NoteDeckError;
use notecore::context::Core;
use notecore::error::Result;

/// 「今すぐ巡回する」(#1321): 無効でも走り、cheap check を飛ばし、連続失敗と日次に数えない。
/// 実行中の印を同期的に取ってから background で走らせ、即返す (結果は event と
/// `heartbeat_status` で見る)。実行中 / 手動のオフラインモード中なら Err
pub async fn heartbeat_trigger_now(core: &Core) -> Result<()> {
    // 手動のオフラインモード中は始めず、理由を返す (#1350)。巡回はサーバーの内容を読む前提
    if notecore::offline::manual(core.layout()?) {
        return Err(notecore::i18n::error(
            notecore::offline::ERROR_CODE,
            "_native.heartbeat.offlineNoRun",
            serde_json::json!({}),
        ));
    }
    let guard = crate::heartbeat::try_begin()
        .ok_or_else(|| NoteDeckError::InvalidInput("HEARTBEAT is already running".into()))?;
    let core = core.shared()?;
    tokio::spawn(async move { crate::heartbeat::run_manual(&core, guard).await });
    Ok(())
}

/// 「この接続を試す」(#1321)。結果を待って返す
pub async fn heartbeat_probe(core: &Core) -> Result<crate::heartbeat::HeartbeatProbeResult> {
    crate::heartbeat::probe(core).await
}

/// 「最後の巡回」(#1321)。`/api/heartbeat/status` と About の JSON も同じ型
pub async fn heartbeat_status(_core: &Core) -> Result<crate::heartbeat::HeartbeatStatus> {
    Ok(crate::heartbeat::status())
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
