use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Listener, Manager};

use notecore::frontend_bridge::{ArchiveSearchRequest, BridgeFuture, FrontendBridge};

/// Bridges HTTP API requests to the frontend (Pinia stores) via Tauri events.
///
/// Flow:
///   HTTP handler → query_frontend() → emit "nd:query-request"
///   → Frontend handles & emits "nd:query-response-{id}"
///   → query_frontend() receives via oneshot channel → HTTP response
///
/// タイムアウトは呼び出し側が決める (既定 5 秒は `core::frontend_bridge::query`)。
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

/// 手元の索引の検索を自分の Core で答える。in-process の notemaid は `TauriBridge` から、
/// 別プロセスの notemaid は中継の `archive/search` 問い合わせから、ここに届く
pub async fn answer_archive_search(
    app: &AppHandle,
    req: ArchiveSearchRequest,
) -> Result<Value, String> {
    let core = app.state::<crate::commands::AppState>();
    let notes = notecore::commands::timeline::search_archive(&core, req)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(notes).map_err(|e| e.to_string())
}

/// 手元の CLI (#1104) に渡す外部アプリ用の永続トークンを発行する。権限ウィンドウで
/// 発行するものと同じ store なので、external principal の権限がそのまま効く
pub fn issue_external_token(app: &AppHandle, name: &str) -> Result<Value, String> {
    let store = app.state::<Arc<notecore::api_tokens::ApiTokenStore>>();
    let (meta, token) = store.create(name).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "id": meta.id, "token": token }))
}

pub fn revoke_external_token(app: &AppHandle, id: &str) -> Result<Value, String> {
    let store = app.state::<Arc<notecore::api_tokens::ApiTokenStore>>();
    store.revoke(id).map_err(|e| e.to_string())?;
    Ok(Value::Null)
}

/// [`FrontendBridge`] の Tauri 実装。HTTP サーバー (core) はこれを通して WebView と
/// managed state に届く (#1106)。
pub struct TauriBridge(pub AppHandle);

impl FrontendBridge for TauriBridge {
    fn query<'a>(
        &'a self,
        query_type: &'a str,
        params: Value,
        timeout: Duration,
    ) -> BridgeFuture<'a> {
        Box::pin(query_frontend_with_timeout(
            &self.0, query_type, params, timeout,
        ))
    }

    fn archive_search(&self, req: ArchiveSearchRequest) -> BridgeFuture<'_> {
        Box::pin(answer_archive_search(&self.0, req))
    }

    fn issue_external_token(&self, name: String) -> BridgeFuture<'_> {
        Box::pin(async move { issue_external_token(&self.0, &name) })
    }

    fn revoke_external_token(&self, id: String) -> BridgeFuture<'_> {
        Box::pin(async move { revoke_external_token(&self.0, &id) })
    }

    fn health_report(&self) -> BridgeFuture<'_> {
        Box::pin(async move {
            let app = &self.0;
            let app_state = app.state::<crate::commands::AppState>();
            let scheduler = app.state::<Arc<crate::commands::HeartbeatScheduler>>();
            let report = crate::commands::build_health_report(app, &app_state, &scheduler)
                .await
                .map_err(|e| e.to_string())?;
            serde_json::to_value(&report).map_err(|e| e.to_string())
        })
    }
}
