use axum::{
    body::Body,
    extract::{Path, Query, Request, State},
    http::{header::AUTHORIZATION, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::AppHandle;
use tower_http::cors::CorsLayer;
use utoipa::{IntoParams, Modify, OpenApi, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

use subtle::ConstantTimeEq;

use crate::image_cache::ImageCache;
use crate::query_bridge;
use crate::rate_limit::{self, RateLimiter};
use notecli::api::MisskeyClient;
use notecli::db::Database;
use notecli::event_bus::EventBus;

/// Base OpenAPI metadata (info + tags) for the full NoteDeck API.
///
/// Paths and component schemas are NOT listed here — they are collected
/// structurally via [`OpenApiRouter`] + `routes!` so a route cannot be added
/// without appearing in the spec. NoteDeck owns the complete tag list because
/// it is the host that produces the final merged spec (NoteDeck-specific tags
/// plus the notecli core tags).
#[derive(OpenApi)]
#[openapi(
    info(
        title = "NoteDeck API",
        description = "NoteDeck localhost API — Misskey desktop client control interface",
        license(name = "MIT"),
    ),
    tags(
        (name = "deck", description = "Deck state"),
        (name = "commands", description = "Command execution"),
        (name = "proxy", description = "Image proxy / CDN cache"),
        (name = "accounts", description = "Logged-in accounts"),
        (name = "timeline", description = "Timelines and user notes"),
        (name = "notes", description = "Note read / create / delete / reactions"),
        (name = "users", description = "User profiles"),
        (name = "search", description = "Note search"),
        (name = "events", description = "Server-sent event stream"),
        (name = "capabilities", description = "Capability listing and execution (#709)"),
        (name = "health", description = "Self-diagnosis and readiness"),
        (name = "meta", description = "API discovery and documentation"),
    ),
)]
struct ApiDoc;

struct SecurityAddon;

impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            utoipa::openapi::security::SecurityScheme::Http(utoipa::openapi::security::Http::new(
                utoipa::openapi::security::HttpAuthScheme::Bearer,
            )),
        );
    }
}

/// Error response body
#[derive(serde::Serialize, ToSchema)]
struct ApiErrorResponse {
    /// Error code (e.g. "NOT_FOUND", "UNAUTHORIZED")
    error: String,
    /// Human-readable error message
    message: String,
}

const PORT: u16 = 19820;

// --- NoteDeck-specific state (for deck, commands, proxy routes) ---

#[derive(Clone)]
struct DeckState {
    app_handle: AppHandle,
    api_token: String,
    image_cache: Arc<ImageCache>,
}

// --- Error type ---

struct ApiError {
    status: StatusCode,
    code: String,
    message: String,
}

impl ApiError {
    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "UNAUTHORIZED".to_string(),
            message: "Missing or invalid Bearer token".to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = json!({ "error": self.code, "message": self.message });
        (self.status, Json(body)).into_response()
    }
}

// --- Routes ---

/// Pre-bound HTTP server ready to serve.
/// Created by [`bind`], consumed by [`serve`].
pub struct BoundServer {
    listener: tokio::net::TcpListener,
}

/// Phase 1: bind the TCP listener (no DB/client needed).
/// Returns `None` if binding fails after retries.
pub async fn bind() -> Option<BoundServer> {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));

    const MAX_RETRIES: u32 = 5;
    const RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(1);
    let mut last_err = None;
    let mut bound = None;
    for attempt in 1..=MAX_RETRIES {
        match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => {
                bound = Some(l);
                break;
            }
            Err(e) => {
                tracing::warn!(attempt, max = MAX_RETRIES, %e, "HTTP bind failed");
                last_err = Some(e);
                if attempt < MAX_RETRIES {
                    tokio::time::sleep(RETRY_DELAY).await;
                }
            }
        }
    }
    let listener = match bound {
        Some(l) => l,
        None => {
            tracing::error!(
                %addr,
                error = %last_err.map(|e| e.to_string()).unwrap_or_default(),
                "giving up on HTTP bind after {MAX_RETRIES} attempts",
            );
            return None;
        }
    };

    tracing::info!(%addr, "HTTP server bound");

    Some(BoundServer { listener })
}

/// Configuration for starting the HTTP server (Phase 2).
pub struct ServeConfig {
    pub server: BoundServer,
    pub app_handle: AppHandle,
    pub db: Arc<Database>,
    pub client: Arc<MisskeyClient>,
    pub event_bus: Arc<EventBus>,
    pub api_token: String,
    pub api_token_store: Arc<crate::api_tokens::ApiTokenStore>,
    pub token_path: String,
    pub image_cache: Arc<ImageCache>,
    pub perf: crate::perf_config::SharedPerfConfig,
}

/// 永続トークン → ephemeral トークンのブリッジ用 state。
#[derive(Clone)]
struct TokenBridgeState {
    store: Arc<crate::api_tokens::ApiTokenStore>,
    api_token: String,
}

/// 永続 API トークン (#709) を受理する認証ブリッジ。
///
/// Bearer が有効な永続トークンなら Authorization ヘッダを起動毎の ephemeral
/// トークンに書き換えて下流に流す。これで notecli コアルート (accounts /
/// timeline / events 等) と NoteDeck 固有ルートの両方の既存認証がそのまま
/// 通る (notecli 側の変更不要)。無効・無関係な Bearer はそのまま下流の
/// 認証で 401 になる。
async fn persistent_token_middleware(
    State(state): State<TokenBridgeState>,
    mut req: Request,
    next: Next,
) -> Response {
    let presented = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    if let Some(token) = presented {
        if state.store.verify(token) {
            let bridged = format!("Bearer {}", state.api_token);
            if let Ok(value) = axum::http::HeaderValue::from_str(&bridged) {
                req.headers_mut().insert(AUTHORIZATION, value);
            }
            // 永続トークン由来の目印 (#712 §5.3)。external gate はこの
            // extension が付いたリクエストのみ enforce する — ephemeral 直用
            // (notecli CLI 等) は local trust として免除
            req.extensions_mut()
                .insert(crate::permissions_gate::ExternalTokenMarker);
        }
    }
    next.run(req).await
}

/// Phase 2: attach routes and start serving. Requires DB/client.
/// Sends `()` on `ready_tx` once routes are built and the server is about to accept connections.
pub async fn serve(config: ServeConfig, ready_tx: tokio::sync::oneshot::Sender<()>) {
    // Build core Misskey API routes from notecli (OpenApiRouter — route
    // registration and OpenAPI spec generation stay in lockstep).
    let notecli_state = notecli::http_server::AppState::new(
        config.db,
        config.client,
        config.event_bus,
        config.api_token.clone(),
        config.token_path.clone(),
    );
    let core_routes = notecli::http_server::build_core_routes(notecli_state);

    // NoteDeck-specific state
    let deck_state = DeckState {
        app_handle: config.app_handle,
        api_token: config.api_token.clone(),
        image_cache: config.image_cache,
    };

    // Authenticated NoteDeck-specific routes (deck, commands)
    let deck_routes = deck_openapi_router()
        .layer(middleware::from_fn_with_state(
            deck_state.clone(),
            deck_auth_middleware,
        ))
        .layer(CorsLayer::permissive())
        .with_state(deck_state.clone());

    // Public image proxy (no auth)
    let proxy_routes = proxy_openapi_router()
        .layer(CorsLayer::permissive())
        .with_state(deck_state);

    // Merge every annotated route into one OpenApiRouter — the Router half is
    // what we serve. The spec is (re)built via build_openapi() so the served
    // /api/openapi.json, the Tauri command, and the committed snapshot all
    // share a single source of truth.
    // The full spec — single source of truth, also handed to the meta routes
    // so `/api` and `/api/openapi.json` serve it without a second derivation.
    let openapi = Arc::new(build_openapi());

    // Public meta routes (no auth): `/api` index, raw spec, Scalar UI.
    let meta_routes = meta_openapi_router()
        .layer(CorsLayer::permissive())
        .with_state(MetaState {
            openapi: openapi.clone(),
            token_path: config.token_path.clone(),
        });

    // Merge every annotated route into one OpenApiRouter and serve the Router
    // half. The spec half is discarded — `build_openapi()` above is canonical
    // (identical content, shared with the snapshot test).
    let (api_router, _) = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(core_routes)
        .merge(deck_routes)
        .merge(proxy_routes)
        .merge(meta_routes)
        .split_for_parts();

    // Rate limiter for upstream Misskey API requests
    let rate_limiter = RateLimiter::new(config.perf);

    let app = Router::new()
        .merge(api_router)
        // external principal gate (#712 §5.3): 永続トークン由来のリクエストを
        // per-route 対応表で enforce する。persistent_token_middleware (外側)
        // が付けた marker を見るため、その内側に置く
        .layer(middleware::from_fn(
            crate::permissions_gate::external_gate_middleware,
        ))
        .layer(middleware::from_fn_with_state(
            rate_limiter.clone(),
            rate_limit::rate_limit_middleware,
        ))
        // 永続トークンブリッジは host guard の内側 (= rebinding 拒否後) かつ
        // 各ルートの認証より外側で走る
        .layer(middleware::from_fn_with_state(
            TokenBridgeState {
                store: config.api_token_store.clone(),
                api_token: config.api_token.clone(),
            },
            persistent_token_middleware,
        ))
        .layer(middleware::from_fn(host_guard_middleware));

    // Background cleanup of stale rate-limit entries
    {
        let limiter = rate_limiter.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(120));
            loop {
                interval.tick().await;
                limiter.cleanup().await;
            }
        });
    }

    tracing::info!("HTTP server serving");
    ready_tx.send(()).ok();

    if let Err(e) = axum::serve(config.server.listener, app).await {
        tracing::error!(%e, "HTTP server error");
    }
}

// --- DNS rebinding guard (applied to all routes) ---

/// Reject requests where the Host header does not point to localhost.
/// Prevents DNS rebinding attacks against the internal HTTP API.
async fn host_guard_middleware(req: Request, next: Next) -> Result<Response, Response> {
    let host = req
        .headers()
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let host_without_port = host.split(':').next().unwrap_or("");

    if matches!(host_without_port, "127.0.0.1" | "localhost" | "[::1]") || host.is_empty() {
        Ok(next.run(req).await)
    } else {
        tracing::warn!(host, "DNS rebinding attempt blocked");
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "FORBIDDEN", "message": "Invalid Host header" })),
        )
            .into_response())
    }
}

// --- Auth middleware for NoteDeck-specific routes ---

async fn deck_auth_middleware(
    State(state): State<DeckState>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    let token = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    match token {
        Some(t) if bool::from(t.as_bytes().ct_eq(state.api_token.as_bytes())) => {
            Ok(next.run(req).await)
        }
        _ => {
            tracing::warn!(uri = %req.uri(), "unauthorized API access attempt");
            Err(ApiError::unauthorized().into_response())
        }
    }
}

// --- QueryBridge handlers (deck state + commands) ---

#[utoipa::path(get, path = "/api/deck/columns", tag = "deck",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Deck columns list"),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
    )
)]
async fn get_deck_columns(State(state): State<DeckState>) -> Result<Json<Value>, ApiError> {
    let data = query_bridge::query_frontend(&state.app_handle, "deck/columns", json!({}))
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "QUERY_FAILED".to_string(),
            message: e,
        })?;
    Ok(Json(data))
}

#[utoipa::path(get, path = "/api/deck/active", tag = "deck",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Active column info"),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
    )
)]
async fn get_deck_active(State(state): State<DeckState>) -> Result<Json<Value>, ApiError> {
    let data = query_bridge::query_frontend(&state.app_handle, "deck/active", json!({}))
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "QUERY_FAILED".to_string(),
            message: e,
        })?;
    Ok(Json(data))
}

#[utoipa::path(get, path = "/api/commands", tag = "commands",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Available commands"),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
    )
)]
async fn list_commands(State(state): State<DeckState>) -> Result<Json<Value>, ApiError> {
    let data = query_bridge::query_frontend(&state.app_handle, "commands/list", json!({}))
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "QUERY_FAILED".to_string(),
            message: e,
        })?;
    Ok(Json(data))
}

// --- Capability API (#709: 外部アプリ向け操作面) ---
// カラム追加/削除・コマンド実行の旧ルートは #711 で削除した。外部からの操作は
// すべて POST /api/capabilities/{id}/execute (= 権限判定を通る dispatcher) を使う。

/// Capability 実行はユーザー確認ダイアログ待ちを挟みうるので、
/// query_bridge 既定の 5 秒ではなく長めのタイムアウトを使う。
const CAPABILITY_EXECUTE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

#[utoipa::path(get, path = "/api/capabilities", tag = "capabilities",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Registered capabilities with signatures (id, name, label, category, description, params, returns, permissions, requiresConfirmation)"),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
    )
)]
async fn list_capabilities(State(state): State<DeckState>) -> Result<Json<Value>, ApiError> {
    let data = query_bridge::query_frontend(&state.app_handle, "capabilities/list", json!({}))
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "QUERY_FAILED".to_string(),
            message: e,
        })?;
    Ok(Json(data))
}

#[utoipa::path(post, path = "/api/capabilities/{capability_id}/execute", tag = "capabilities",
    security(("bearer_auth" = [])),
    params(("capability_id" = String, Path, description = "Capability ID (dotted `notes.create` or sanitized `notes_create`)")),
    request_body(content = Value, description = "Capability params (JSON object, omit for parameterless capabilities)"),
    responses(
        (status = 200, description = "Executed: `{ ok: true, result }`"),
        (status = 400, description = "Preflight (input validation) failed", body = ApiErrorResponse),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 403, description = "Denied by httpApi permissions profile", body = ApiErrorResponse),
        (status = 404, description = "Unknown capability", body = ApiErrorResponse),
        (status = 409, description = "User cancelled the confirmation dialog", body = ApiErrorResponse),
    )
)]
async fn execute_capability(
    State(state): State<DeckState>,
    Path(capability_id): Path<String>,
    body: Option<Json<Value>>,
) -> (StatusCode, Json<Value>) {
    let params = body.map(|Json(v)| v).unwrap_or(Value::Null);
    let data = match query_bridge::query_frontend_with_timeout(
        &state.app_handle,
        "capabilities/execute",
        json!({ "capabilityId": capability_id, "params": params }),
        CAPABILITY_EXECUTE_TIMEOUT,
    )
    .await
    {
        Ok(data) => data,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "ok": false, "code": "query_failed", "error": e })),
            );
        }
    };

    // DispatchResult (`{ok, result}` / `{ok, code, error}`) を HTTP status に写像する。
    // body はそのまま返す (外部クライアントは code で機械判別できる)。
    match data.get("ok").and_then(Value::as_bool) {
        Some(true) => (StatusCode::OK, Json(data)),
        Some(false) => {
            let status = match data.get("code").and_then(Value::as_str) {
                Some("unknown_capability") => StatusCode::NOT_FOUND,
                Some("permission_denied") => StatusCode::FORBIDDEN,
                Some("preflight_failed") => StatusCode::BAD_REQUEST,
                Some("user_cancelled") => StatusCode::CONFLICT,
                _ => StatusCode::INTERNAL_SERVER_ERROR,
            };
            (status, Json(data))
        }
        // frontend が DispatchResult 以外 (handleQuery の error envelope 等) を
        // 返した場合は構造化エラーに正規化する。
        None => {
            let error = data
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unexpected response from frontend")
                .to_string();
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "ok": false, "code": "execute_failed", "error": error })),
            )
        }
    }
}

// --- Health (#709: readiness + doctor + ストリーム状態) ---

#[utoipa::path(get, path = "/api/health", tag = "health",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Health report: notecli doctor + backendReady + frontendReady + per-account stream states"),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 500, description = "Healthcheck failed", body = ApiErrorResponse),
    )
)]
async fn get_health(
    State(state): State<DeckState>,
    external: Option<axum::Extension<crate::permissions_gate::ExternalTokenMarker>>,
) -> Result<Json<Value>, ApiError> {
    use tauri::Manager;
    let app = &state.app_handle;
    let app_state = app.state::<crate::commands::AppState>();
    let scheduler = app.state::<Arc<crate::commands::HeartbeatScheduler>>();
    let report = crate::commands::build_health_report(app, &app_state, &scheduler)
        .await
        .map_err(|e| ApiError {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "HEALTHCHECK_FAILED".to_string(),
            message: e.to_string(),
        })?;
    let mut body = serde_json::to_value(&report).map_err(|e| ApiError {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        code: "HEALTHCHECK_FAILED".to_string(),
        message: e.to_string(),
    })?;

    // frontend 死活プローブ: WebView (query bridge) が応答するか + ストリーム状態。
    // Rust 側レポートは frontend が死んでいても返せる — それ自体が診断情報。
    // 永続トークン由来 (external principal) で deck.read が無い場合、streams
    // 詳細 (接続先 host 等のローカルデータ) は応答から間引く (#712 §5.3)。
    // self-diagnosis の summary 部 (backendReady / frontendReady 等) は返す
    let may_read_streams = external.is_none() || crate::permissions_gate::external_may_read_deck();

    if let Value::Object(map) = &mut body {
        match query_bridge::query_frontend(app, "health/streams", json!({})).await {
            Ok(streams) => {
                map.insert("frontendReady".into(), Value::Bool(true));
                map.insert(
                    "streams".into(),
                    if may_read_streams {
                        streams
                    } else {
                        Value::Null
                    },
                );
            }
            Err(e) => {
                map.insert("frontendReady".into(), Value::Bool(false));
                map.insert("frontendError".into(), Value::String(e));
                map.insert("streams".into(), Value::Null);
            }
        }
    }
    Ok(Json(body))
}

// --- OpenAPI docs ---

/// NoteDeck-specific deck/command routes, as an [`OpenApiRouter`].
/// Used by both [`serve`] (runtime router) and [`build_openapi`] (state-free
/// spec) — `routes!` keeps registration and spec in lockstep.
fn deck_openapi_router() -> OpenApiRouter<DeckState> {
    OpenApiRouter::new()
        .routes(routes!(get_deck_columns))
        .routes(routes!(get_deck_active))
        .routes(routes!(list_commands))
        .routes(routes!(list_capabilities))
        .routes(routes!(execute_capability))
        .routes(routes!(get_health))
}

/// Public image-proxy route, as an [`OpenApiRouter`].
fn proxy_openapi_router() -> OpenApiRouter<DeckState> {
    OpenApiRouter::new().routes(routes!(proxy_image))
}

/// Build the full merged OpenAPI spec without any runtime state.
///
/// The single source of truth for the spec: shared by [`serve`]'s
/// `/api/openapi.json`, the `get_openapi_spec` Tauri command, the
/// `gen-openapi` binary, and the snapshot test. Merges NoteDeck's deck / proxy
/// / meta routes and the notecli core routes into the [`ApiDoc`] base, then
/// registers the `bearer_auth` security scheme once.
///
/// Every served route is covered — including the meta endpoints (`/api`,
/// `/api/openapi.json`, `/api/docs`) — so the spec has no gaps.
pub fn build_openapi() -> utoipa::openapi::OpenApi {
    let mut openapi = ApiDoc::openapi();
    openapi.merge(deck_openapi_router().split_for_parts().1);
    openapi.merge(proxy_openapi_router().split_for_parts().1);
    openapi.merge(meta_openapi_router().split_for_parts().1);
    openapi.merge(notecli::http_server::core_openapi());
    SecurityAddon.modify(&mut openapi);
    openapi
}

/// Return the OpenAPI spec (used by the Tauri command `get_openapi_spec`).
pub fn openapi_spec() -> utoipa::openapi::OpenApi {
    build_openapi()
}

/// State for the public meta routes — carries the generated spec so `/api`
/// and `/api/openapi.json` serve it directly, no second derivation.
#[derive(Clone)]
struct MetaState {
    openapi: Arc<utoipa::openapi::OpenApi>,
    token_path: String,
}

/// Public meta routes (no auth): API discovery, raw spec, Scalar UI.
fn meta_openapi_router() -> OpenApiRouter<MetaState> {
    OpenApiRouter::new()
        .routes(routes!(api_index))
        .routes(routes!(openapi_json))
        .routes(routes!(openapi_docs))
}

#[utoipa::path(
    get, path = "/api", tag = "meta",
    responses((status = 200, description = "API name, version, auth hint, and the \
        full endpoint list derived from this spec")),
)]
async fn api_index(State(state): State<MetaState>) -> Json<Value> {
    Json(json!({
        "name": "notedeck",
        "version": env!("CARGO_PKG_VERSION"),
        "auth": "Bearer token required. Read token from the file at tokenPath.",
        "tokenPath": state.token_path,
        "docs": "/api/docs",
        "openapi": "/api/openapi.json",
        "endpoints": notecli::http_server::endpoints_from_spec(&state.openapi),
    }))
}

#[utoipa::path(
    get, path = "/api/openapi.json", tag = "meta",
    responses((status = 200, description = "This OpenAPI 3.1 specification, as JSON")),
)]
async fn openapi_json(State(state): State<MetaState>) -> Json<utoipa::openapi::OpenApi> {
    Json((*state.openapi).clone())
}

#[utoipa::path(
    get, path = "/api/docs", tag = "meta",
    responses((status = 200, description = "Scalar API reference UI (HTML)",
        content_type = "text/html")),
)]
async fn openapi_docs() -> axum::response::Html<&'static str> {
    axum::response::Html(
        r#"<!DOCTYPE html>
<html><head>
<title>NoteDeck API</title>
<meta charset="utf-8">
</head><body>
<script>
// Scalar の自動マウントは #api-reference の直前に mount 先 div を挿入する。
// head に置くと div ごと head 内に入り描画されない (display:none) ため body に置く。
(function() {
  var dark = location.hash !== '#light';
  var el = document.createElement('script');
  el.id = 'api-reference';
  el.dataset.url = '/api/openapi.json';
  el.dataset.configuration = JSON.stringify({ darkMode: dark });
  document.currentScript.after(el);
})();
</script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>"#,
    )
}

// --- Image proxy ---

#[derive(Debug, Deserialize, IntoParams)]
struct ProxyImageParams {
    url: String,
    /// Optional max width for thumbnail generation (e.g. 300)
    w: Option<u32>,
    /// Optional max height (aspect-preserving fit; emoji-style sizing)
    h: Option<u32>,
    /// Optional output format ("webp" to convert)
    format: Option<String>,
}

#[utoipa::path(get, path = "/proxy/image", tag = "proxy",
    params(ProxyImageParams),
    responses(
        (status = 200, description = "Proxied image (with 3-layer cache)"),
        (status = 304, description = "Not Modified (ETag match)"),
        (status = 502, description = "Upstream fetch failed"),
    )
)]
async fn proxy_image(
    State(state): State<DeckState>,
    headers: axum::http::HeaderMap,
    Query(params): Query<ProxyImageParams>,
) -> Response {
    use crate::image_cache::StreamingFetchResult;
    use crate::media_proxy::MediaRequest;

    // 変換パラメータ込みのキー / ETag は custom protocol 側と同じ規則を使う
    let req = MediaRequest {
        url: params.url.clone(),
        w: params.w,
        h: params.h,
        format: params.format.clone(),
    };
    let etag = req.etag();

    // ETag conditional: return 304 if client already has this image
    if let Some(if_none_match) = headers.get("if-none-match").and_then(|v| v.to_str().ok()) {
        if if_none_match == etag {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header("ETag", &etag)
                .header("Cache-Control", "public, max-age=86400, immutable")
                .body(Body::empty())
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    }

    // Helper: build a plain 200 response from ready bytes
    let ok_response = |data: Vec<u8>, ct: &str, etag: &str| -> Response {
        Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", ct)
            .header("Cache-Control", "public, max-age=86400, immutable")
            .header("ETag", etag)
            .body(Body::from(data))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
    };

    // Helper macro: resolve CacheEntry → bytes (mem or disk) and build response
    macro_rules! respond_from_cache {
        ($entry:expr, $etag:expr) => {{
            let entry = $entry;
            if let Some(ref mem) = entry.mem_bytes {
                ok_response(mem.as_ref().clone(), &entry.content_type, $etag)
            } else {
                match tokio::fs::read(&entry.path).await {
                    Ok(b) => ok_response(b, &entry.content_type, $etag),
                    Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                }
            }
        }};
    }

    // 変換要求 (絵文字・アバターのサムネイル): variant キャッシュ経路に
    // 載せる。この route は WebView 全プラットフォームのメディア主経路
    // (#921) なので、リクエスト毎に再変換すると初回表示のたびに decode +
    // WebP エンコードの CPU を払い続けることになる。ensure_media_inner が
    // cache_key で variant を永続化し、2 回目以降はヒットで返る。
    if req.wants_transform() {
        if let Some(entry) = state.image_cache.check_cache_only(&req.cache_key()).await {
            return respond_from_cache!(entry, &etag);
        }
        return match crate::media_proxy::ensure_media_inner(&state.image_cache, &req).await {
            Ok((bytes, content_type)) => ok_response(bytes, &content_type, &etag),
            Err(msg) => {
                tracing::warn!(url = %params.url, error = %msg, "proxy_image: fetch failed");
                (StatusCode::BAD_GATEWAY, msg).into_response()
            }
        };
    }

    // 無変換 (効果音・原寸画像): オリジナルをそのまま配信
    // Phase 1: Check cache (instant response)
    if let Some(entry) = state.image_cache.check_cache_only(&params.url).await {
        return respond_from_cache!(entry, &etag);
    }

    // Phase 2: Fetch from upstream — stream directly for low TTFB
    match state.image_cache.fetch_streaming(&params.url).await {
        Ok(StreamingFetchResult::Cached(entry)) => respond_from_cache!(entry, &etag),
        Ok(StreamingFetchResult::Streaming {
            byte_stream,
            content_type,
        }) => {
            let body = Body::from_stream(byte_stream);
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", &content_type)
                .header("Cache-Control", "public, max-age=86400, immutable")
                .header("ETag", &etag)
                .body(body)
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(msg) => {
            tracing::warn!(url = %params.url, error = %msg, "proxy_image: upstream fetch failed");
            (StatusCode::BAD_GATEWAY, msg).into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use tower::ServiceExt;

    /// DNS rebinding ガード (#877)。外部公開 API の入口で唯一 state を持たない
    /// middleware なので、ここだけは Router を組んで直接叩ける。
    async fn status_for_host(host: Option<&str>) -> StatusCode {
        let app = Router::new()
            .route("/ping", get(|| async { "pong" }))
            .layer(middleware::from_fn(host_guard_middleware));

        let mut req = Request::builder().uri("/ping");
        if let Some(h) = host {
            req = req.header(axum::http::header::HOST, h);
        }
        app.oneshot(req.body(Body::empty()).unwrap())
            .await
            .expect("router should respond")
            .status()
    }

    #[tokio::test]
    async fn allows_localhost_hosts() {
        for host in [
            "127.0.0.1",
            "127.0.0.1:19820",
            "localhost",
            "localhost:19820",
        ] {
            assert_eq!(status_for_host(Some(host)).await, StatusCode::OK, "{host}");
        }
    }

    #[tokio::test]
    async fn allows_missing_host_header() {
        // HTTP/2 は Host を送らない (:authority を使う)
        assert_eq!(status_for_host(None).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn rejects_foreign_hosts() {
        for host in [
            "evil.example.com",
            "evil.example.com:19820",
            "192.168.1.10:19820",
        ] {
            assert_eq!(
                status_for_host(Some(host)).await,
                StatusCode::FORBIDDEN,
                "{host}"
            );
        }
    }

    #[tokio::test]
    async fn rejects_bracketed_ipv6() {
        // 現状の記録: ポート除去が最初の ':' で切るので `[::1]` は `[` になり、
        // 許可リストの "[::1]" には到達しない。bind 先は 127.0.0.1 だけなので
        // IPv6 で届くリクエスト自体が無く、安全側に倒れている
        for host in ["[::1]", "[::1]:19820"] {
            assert_eq!(
                status_for_host(Some(host)).await,
                StatusCode::FORBIDDEN,
                "{host}"
            );
        }
    }
}
