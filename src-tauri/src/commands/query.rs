//! クエリランタイムの Tauri 側 (#1106): delta flusher と Tauri イベントへの流し込み。
//! IPC コマンド本体は notecore のコマンド表 (commands/query.rs) に移った。

use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use notecore::query_runtime::{NoteCaptureBatch, QueryDelta, QueryRuntime};

// notecore のペイロード型を Tauri イベントとして流すための newtype (orphan rule 対策)。
// serde / specta とも transparent なので、イベント名とペイロードの TS 型は derive(Event)
// を core 側に付けていたときと同じ (`query-delta` / `QueryDelta`)。bindings.ts には
// `QueryDeltaEvent = QueryDelta` の alias が 1 行増えるだけ。
#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct QueryDeltaEvent(pub QueryDelta);

impl Event for QueryDeltaEvent {
    const NAME: &'static str = "query-delta";
}

#[derive(Clone, serde::Serialize, specta::Type)]
#[serde(transparent)]
#[specta(transparent)]
pub struct NoteCaptureBatchEvent(pub NoteCaptureBatch);

impl Event for NoteCaptureBatchEvent {
    const NAME: &'static str = "note-capture-batch";
}

/// Long-running flusher task. Spawned once at app startup. `notified()` で起き
/// (multiple notifies coalesce to one wakeup), notecore::query_runtime::DELTA_FLUSH_WINDOW スリープして
/// 同じ window 内の追加イベントを取り込んでから drain & emit する。
pub async fn run_delta_flusher(app: AppHandle) {
    let notify = match app.try_state::<std::sync::Arc<QueryRuntime>>() {
        Some(runtime) => runtime.flush_notify(),
        None => return,
    };
    loop {
        notify.notified().await;
        tokio::time::sleep(notecore::query_runtime::DELTA_FLUSH_WINDOW).await;
        let Some(runtime) = app.try_state::<std::sync::Arc<QueryRuntime>>() else {
            return;
        };
        for delta in runtime.drain_pending() {
            if let Err(e) = QueryDeltaEvent(delta).emit(&app) {
                tracing::warn!("[query-delta] emit failed: {e}");
            }
        }
        let captures = runtime.drain_captures();
        if !captures.is_empty() {
            if let Err(e) = NoteCaptureBatchEvent(NoteCaptureBatch { captures }).emit(&app) {
                tracing::warn!("[note-capture-batch] emit failed: {e}");
            }
        }
    }
}
