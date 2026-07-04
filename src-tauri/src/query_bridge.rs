use std::sync::Mutex;
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Listener};

/// Bridges HTTP API requests to the frontend (Pinia stores) via Tauri events.
///
/// Flow:
///   HTTP handler → query_frontend() → emit "nd:query-request"
///   → Frontend handles & emits "nd:query-response-{id}"
///   → query_frontend() receives via oneshot channel → HTTP response
pub async fn query_frontend(
    app: &AppHandle,
    query_type: &str,
    params: Value,
) -> Result<Value, String> {
    query_frontend_with_timeout(app, query_type, params, Duration::from_secs(5)).await
}

/// [`query_frontend`] のタイムアウト指定版。capability 実行のように
/// ユーザー確認ダイアログ待ちを挟みうる query で使う。
pub async fn query_frontend_with_timeout(
    app: &AppHandle,
    query_type: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
    let tx = Mutex::new(Some(tx));

    let response_event = format!("nd:query-response-{id}");
    let _listener = app.once(response_event, move |event| {
        if let Some(tx) = tx.lock().unwrap().take() {
            let data = serde_json::from_str(event.payload()).unwrap_or(Value::Null);
            let _ = tx.send(data);
        }
    });

    app.emit(
        "nd:query-request",
        serde_json::json!({
            "id": id,
            "type": query_type,
            "params": params,
        }),
    )
    .map_err(|e| e.to_string())?;

    tokio::time::timeout(timeout, rx)
        .await
        .map_err(|_| "Query timed out".to_string())?
        .map_err(|_| "Channel closed".to_string())
}
