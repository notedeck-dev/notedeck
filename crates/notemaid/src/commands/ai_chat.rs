//! AI チャットのデータ系コマンド (#1106 段階 0b)。本体は [`crate::ai_chat_service`]。
//! イベントの届け先 (AiChatSink) と app dir は Core から引く。

use crate::ai_chat_service::{self, AiChatRequest};
use crate::ai_turn::{self, AiTurnRequest};
use crate::sinks::CoreMaidExt;
use notecore::context::Core;
use notecore::error::Result;

/// Start a streaming chat completion request. Returns immediately;
/// the actual request runs in a background task that emits events
/// to the sink keyed by `stream_id`.
pub async fn ai_chat_send(core: &Core, req: AiChatRequest) -> Result<()> {
    ai_chat_service::start_stream(
        core.ai_chat_sink()?,
        core.app_dir()?,
        core.http()?.clone(),
        req,
    )
    .await
}

/// Cancel an in-flight streaming chat. Idempotent — silently no-ops if the
/// stream has already completed or never existed.
pub async fn ai_chat_cancel(_core: &Core, stream_id: String) -> Result<()> {
    ai_chat_service::cancel_stream(&stream_id);
    Ok(())
}

/// AI エージェントのターン (#1133) を開始する。即座に返り、以後のイベントは
/// `nd:ai-turn-event` に流れる。tool の実行はデバイスへの実行要求 (橋) で行う。
pub async fn ai_turn_run(core: &Core, req: AiTurnRequest) -> Result<()> {
    ai_turn::start_turn(core, req).await
}

/// 手元の CLI (ACP、#1104) の一覧。PATH で検出し、使えないものは理由つきで返す
pub async fn ai_harness_list(core: &Core) -> Result<Vec<crate::acp::HarnessInfo>> {
    let custom = crate::ai_config::load(core)
        .map(|c| c.harnesses)
        .unwrap_or_default();
    Ok(
        tokio::task::spawn_blocking(move || crate::acp::harness::list(&custom))
            .await
            .unwrap_or_default(),
    )
}

/// 進行中のターンを中断する。冪等。確認待ちなら要求を cancelled で閉じる。
/// 途中までの応答があればセッションに書き、そのメッセージを返す。
pub async fn ai_turn_cancel(
    _core: &Core,
    turn_id: String,
) -> Result<Option<crate::ai_sessions::SessionMessage>> {
    Ok(ai_turn::cancel_turn(&turn_id))
}

/// 確認要求への応答 (今回だけ許可 / 今回だけ拒否)。最初の 1 つだけが効き、
/// 決着済みならエラー。
pub async fn ai_confirm_respond(_core: &Core, request_id: String, accepted: bool) -> Result<()> {
    ai_turn::confirm::respond(&request_id, accepted)
}

/// 確認要求を表示した (表示 TTL の起点)。
pub async fn ai_confirm_shown(_core: &Core, request_id: String) -> Result<()> {
    ai_turn::confirm::shown(&request_id)
}

/// `exec: core` な capability を notecore で実行する (本人操作 / plugin / 外部の
/// dispatcher からの RPC、#1133 縦切り 4)。認可は呼び出し側の dispatcher が
/// 済ませている。AI のターンはこの経路を通らず、ターン実行器が直接呼ぶ。
pub async fn capability_execute(
    core: &Core,
    id: String,
    params: serde_json::Value,
    principal: String,
    account_id: Option<String>,
    tainted: bool,
    plugin_id: Option<String>,
) -> Result<crate::exec::ExecOutcome> {
    let ctx = crate::exec::ExecContext {
        principal,
        account_id,
        tainted,
        plugin_id,
    };
    crate::exec::execute(core, &id, params, &ctx).await
}

/// `exec: core` な capability の確認内容 (プレビュー) を組む。要否の判定は
/// 呼び出し側 (ターン実行器 / デバイスの dispatcher) が済ませ、ここは表示内容
/// だけを返す。None = この引数なら確認は要らない。
pub async fn capability_preview(
    core: &Core,
    id: String,
    params: serde_json::Value,
    principal: String,
    account_id: Option<String>,
    tainted: bool,
    plugin_id: Option<String>,
) -> Result<Option<serde_json::Value>> {
    let ctx = crate::exec::ExecContext {
        principal,
        account_id,
        tainted,
        plugin_id,
    };
    crate::exec::preview(core, &id, params, &ctx).await
}
