use axum::{
    extract::{Path, Query, Request, State},
    http::{
        header::{AUTHORIZATION, CONTENT_TYPE},
        HeaderValue, Method, StatusCode,
    },
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use futures_util::stream::Stream;
use serde::Deserialize;
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use subtle::ConstantTimeEq;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tower_http::cors::{AllowOrigin, CorsLayer};
use utoipa::{IntoParams, OpenApi, ToSchema};
use utoipa_axum::{router::OpenApiRouter, routes};

use crate::api::MisskeyClient;
use crate::db::Database;
use crate::event_bus::EventBus;
use crate::models::{
    AccountPublic, CreateNoteParams, NormalizedNote, NormalizedNoteReaction,
    NormalizedNotification, NormalizedUserDetail, TimelineKey,
};

pub const DEFAULT_PORT: u16 = 19820;

// --- OpenAPI ---

/// OpenAPI metadata for the standalone notecli server.
/// When notecli routes are embedded in a larger app (e.g. NoteDeck), the host
/// app provides its own `info`/`tags` and merges the `OpenApiRouter` returned
/// by [`build_core_routes`].
#[derive(OpenApi)]
#[openapi(
    info(
        title = "notecli API",
        description = "Headless Misskey client — localhost HTTP API",
        license(name = "MIT"),
    ),
    tags(
        (name = "accounts", description = "Logged-in accounts"),
        (name = "timeline", description = "Timelines and user notes"),
        (name = "notes", description = "Note read / create / delete / reactions"),
        (name = "users", description = "User profiles"),
        (name = "search", description = "Note search"),
        (name = "events", description = "Server-sent event stream"),
    ),
    modifiers(&SecurityAddon),
)]
pub struct ApiDoc;

/// Registers the `bearer_auth` security scheme. Apply once on the final spec.
pub struct SecurityAddon;

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

#[derive(Clone)]
pub struct AppState {
    db: Arc<Database>,
    client: Arc<MisskeyClient>,
    event_bus: Arc<EventBus>,
    api_token: String,
    token_path: String,
}

impl AppState {
    pub fn new(
        db: Arc<Database>,
        client: Arc<MisskeyClient>,
        event_bus: Arc<EventBus>,
        api_token: String,
        token_path: String,
    ) -> Self {
        Self {
            db,
            client,
            event_bus,
            api_token,
            token_path,
        }
    }

    fn account_id_for_host(&self, host: &str) -> Result<String, ApiError> {
        self.db
            .get_account_by_host(host)?
            .map(|a| a.id.clone())
            .ok_or_else(|| ApiError::not_found(&format!("No account for host: {host}")))
    }
}

// --- Error type ---

/// Error response body returned by all endpoints on failure.
#[derive(serde::Serialize, ToSchema)]
pub struct ApiErrorResponse {
    /// Error code (e.g. "NOT_FOUND", "UNAUTHORIZED")
    error: String,
    /// Human-readable error message
    message: String,
}

struct ApiError {
    status: StatusCode,
    code: String,
    message: String,
}

impl ApiError {
    fn not_found(msg: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "NOT_FOUND".to_string(),
            message: msg.to_string(),
        }
    }

    fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "UNAUTHORIZED".to_string(),
            message: "Missing or invalid Bearer token".to_string(),
        }
    }
}

impl From<crate::error::NoteDeckError> for ApiError {
    fn from(e: crate::error::NoteDeckError) -> Self {
        let code = e.code().to_string();
        let status = match &e {
            // クライアント入力起因 (不正なタイムラインキー等) は 400。
            crate::error::NoteDeckError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            code,
            // 外部へ出すメッセージは必ず safe_message() を通す。Display は
            // Internal / Database の内部詳細をそのまま含み得る。
            message: e.safe_message(),
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

pub async fn start(
    db: Arc<Database>,
    client: Arc<MisskeyClient>,
    event_bus: Arc<EventBus>,
    api_token: String,
    token_path: String,
) {
    start_on_port(db, client, event_bus, api_token, token_path, DEFAULT_PORT).await;
}

pub async fn start_on_port(
    db: Arc<Database>,
    client: Arc<MisskeyClient>,
    event_bus: Arc<EventBus>,
    api_token: String,
    token_path: String,
    port: u16,
) {
    let state = AppState {
        db,
        client,
        event_bus,
        api_token,
        token_path,
    };

    let app = build_router(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!(%addr, "HTTP server listening");

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(%addr, error = %e, "failed to bind");
            return;
        }
    };

    if let Err(e) = axum::serve(listener, app).await {
        tracing::error!(error = %e, "HTTP server error");
    }
}

/// 単体デーモン用の CORS。ループバック bind なので、ブラウザから叩けるのは同じマシンの
/// localhost / 127.0.0.1 の origin (ポートは問わない) だけに限る。以前の permissive は
/// 任意の origin に応答を返していた (notedeck#1106 §9)。
fn localhost_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _| {
            is_localhost_origin(origin.to_str().unwrap_or(""))
        }))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
        ])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE])
}

/// `http://localhost[:port]` と `http://127.0.0.1[:port]` だけを許す。
fn is_localhost_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let host = rest.split(':').next().unwrap_or("");
    (host == "localhost" || host == "127.0.0.1")
        && rest[host.len()..]
            .strip_prefix(':')
            .is_none_or(|port| !port.is_empty() && port.chars().all(|c| c.is_ascii_digit()))
}

/// Full router with `/api` index, auth middleware, and CORS.
/// Use this for standalone notecli server.
pub fn build_router(state: AppState) -> Router {
    let token_path = state.token_path.clone();

    let (core_router, openapi) = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .merge(build_core_routes(state))
        .split_for_parts();

    let index_route = Router::new()
        .route("/api", get(index))
        .with_state(IndexState {
            openapi: Arc::new(openapi),
            token_path,
        });

    Router::new()
        .merge(index_route)
        .merge(core_router)
        .layer(localhost_cors_layer())
}

/// Route registration for the core API — no state, no layers.
///
/// This is the single list of core routes. `routes!` ties each route to its
/// `#[utoipa::path]` annotation, so a route cannot be registered without
/// appearing in the OpenAPI spec. Both [`build_core_routes`] (runtime router)
/// and [`core_openapi`] (state-free spec) are derived from this.
fn core_openapi_router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .routes(routes!(list_accounts))
        .routes(routes!(get_timeline))
        .routes(routes!(get_notifications))
        .routes(routes!(create_note))
        .routes(routes!(get_note, delete_note))
        .routes(routes!(get_note_children))
        .routes(routes!(get_note_conversation))
        .routes(routes!(
            get_note_reactions,
            create_reaction,
            delete_reaction
        ))
        .routes(routes!(get_user))
        .routes(routes!(get_user_notes))
        .routes(routes!(search_notes))
        .routes(routes!(sse_events))
}

/// Core API routes with auth middleware and CORS, without the `/api` index.
///
/// Returns an [`OpenApiRouter`] so route registration and OpenAPI generation
/// stay in lockstep. Use this when embedding notecli routes in a larger
/// application that provides its own index endpoint and merges this into its
/// own spec.
pub fn build_core_routes(state: AppState) -> OpenApiRouter {
    // CORS はここでは掛けない。埋め込む側 (notedeck) が自分の allowlist を、
    // 単体デーモンは build_router が localhost 限定の layer を、それぞれ外側で掛ける。
    // 以前はここに permissive が入っていて、notedeck の allowlist をすり抜けていた
    // (notedeck#1106 §9)。
    core_openapi_router()
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state)
}

/// The core API OpenAPI spec, built without any runtime state.
///
/// Lets a host application (e.g. NoteDeck) generate a full merged spec — for
/// a `/api/openapi.json` endpoint, a Tauri command, or a committed snapshot —
/// without constructing a database/client. Does **not** include `info`/`tags`;
/// the host merges this into its own [`ApiDoc`]-based base spec.
pub fn core_openapi() -> utoipa::openapi::OpenApi {
    core_openapi_router().split_for_parts().1
}

/// Derive a flat endpoint list from an OpenAPI spec.
/// The spec is the single source of truth — the `/api` index never maintains
/// its own hand-written list.
pub fn endpoints_from_spec(openapi: &utoipa::openapi::OpenApi) -> Vec<Value> {
    let mut out = Vec::new();
    for (path, item) in &openapi.paths.paths {
        for (method, op) in [
            ("GET", &item.get),
            ("POST", &item.post),
            ("PUT", &item.put),
            ("DELETE", &item.delete),
            ("PATCH", &item.patch),
        ] {
            if let Some(op) = op {
                let description = op
                    .description
                    .clone()
                    .or_else(|| op.summary.clone())
                    .unwrap_or_default();
                out.push(json!({ "method": method, "path": path, "description": description }));
            }
        }
    }
    out.sort_by(|a, b| {
        let ka = (
            a["path"].as_str().unwrap_or(""),
            a["method"].as_str().unwrap_or(""),
        );
        let kb = (
            b["path"].as_str().unwrap_or(""),
            b["method"].as_str().unwrap_or(""),
        );
        ka.cmp(&kb)
    });
    out
}

// --- Auth middleware ---

// axum の middleware は「通す (Next の応答) / 弾く (エラー応答)」を
// Result<Response, Response> で短絡させるのが定型で、Err 側の Response を
// Box にすると from_fn の型に乗らない。新しい clippy (result_large_err) が
// Err の大きさだけを見て警告するので、この関数に限って許可する
#[allow(clippy::result_large_err)]
async fn auth_middleware(
    State(state): State<AppState>,
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

// --- Handlers ---

/// State for the `/api` index route — carries the generated spec so the
/// endpoint list is always derived, never hand-maintained.
#[derive(Clone)]
struct IndexState {
    openapi: Arc<utoipa::openapi::OpenApi>,
    token_path: String,
}

async fn index(State(state): State<IndexState>) -> Json<Value> {
    Json(json!({
        "name": "notecli",
        "version": env!("CARGO_PKG_VERSION"),
        "auth": "Bearer token required. Read token from the file at tokenPath.",
        "tokenPath": state.token_path,
        "docs": "See /api/openapi.json when embedded in NoteDeck.",
        "endpoints": endpoints_from_spec(&state.openapi),
    }))
}

#[utoipa::path(
    get, path = "/api/accounts", tag = "accounts",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "Logged-in accounts (tokens stripped)", body = Vec<AccountPublic>),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
    )
)]
async fn list_accounts(
    State(state): State<AppState>,
) -> Result<Json<Vec<AccountPublic>>, ApiError> {
    let accounts = state.db.load_accounts()?;
    Ok(Json(accounts.iter().map(AccountPublic::from).collect()))
}

#[utoipa::path(
    get, path = "/api/{host}/timeline/{tl_type}", tag = "timeline",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host (e.g. misskey.io)"),
        ("tl_type" = String, Path, description = "Timeline type: home | local | social | global (or fork-specific basic timelines like bubble)"),
        TimelineQueryParams,
    ),
    responses(
        (status = 200, description = "Timeline notes", body = Vec<NormalizedNote>),
        (status = 400, description = "Invalid or non-basic timeline key", body = ApiErrorResponse),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "No account for host", body = ApiErrorResponse),
    )
)]
async fn get_timeline(
    State(state): State<AppState>,
    Path((host, tl_type)): Path<(String, String)>,
    Query(opts): Query<TimelineQueryParams>,
) -> Result<Json<Vec<crate::models::NormalizedNote>>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let options = opts.into_timeline_options();
    // allowlist: daemon の公開面は Basic タイムラインのみ。パラメータ付きキー
    // (antenna: 等) を受理すると実効 API 面が黙って拡大するため 400 で明示拒否する。
    let key = TimelineKey::parse(&tl_type)?;
    if !matches!(key, TimelineKey::Basic(_)) {
        return Err(ApiError::from(crate::error::NoteDeckError::InvalidInput(
            format!("only basic timelines are exposed here (got '{key}')"),
        )));
    }
    let notes = state
        .client
        .get_timeline(&h, &token, &account_id, &key, options)
        .await?;
    Ok(Json(notes))
}

#[utoipa::path(
    get, path = "/api/{host}/notifications", tag = "timeline",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        TimelineQueryParams,
    ),
    responses(
        (status = 200, description = "Notifications", body = Vec<NormalizedNotification>),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "No account for host", body = ApiErrorResponse),
    )
)]
async fn get_notifications(
    State(state): State<AppState>,
    Path(host): Path<String>,
    Query(opts): Query<TimelineQueryParams>,
) -> Result<Json<Vec<crate::models::NormalizedNotification>>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let options = opts.into_timeline_options();
    let notifications = state
        .client
        .get_notifications(&h, &token, &account_id, options)
        .await?;
    Ok(Json(notifications))
}

#[utoipa::path(
    post, path = "/api/{host}/note", tag = "notes",
    security(("bearer_auth" = [])),
    params(("host" = String, Path, description = "Account host")),
    request_body = CreateNoteBody,
    responses(
        (status = 200, description = "Created note", body = NormalizedNote),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "No account for host", body = ApiErrorResponse),
    )
)]
async fn create_note(
    State(state): State<AppState>,
    Path(host): Path<String>,
    Json(body): Json<CreateNoteBody>,
) -> Result<Json<crate::models::NormalizedNote>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let params = CreateNoteParams {
        text: Some(body.text),
        cw: body.cw,
        visibility: body.visibility,
        local_only: body.local_only,
        mode_flags: None,
        reply_id: body.reply_id,
        renote_id: body.renote_id,
        file_ids: body.file_ids,
        poll: None,
        scheduled_at: body.scheduled_at,
    };
    let note = state
        .client
        .create_note(&h, &token, &account_id, params)
        .await?;
    Ok(Json(note))
}

#[utoipa::path(
    get, path = "/api/{host}/search", tag = "search",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        SearchQueryParams,
    ),
    responses(
        (status = 200, description = "Matching notes", body = Vec<NormalizedNote>),
        (status = 400, description = "Missing query parameter: q", body = ApiErrorResponse),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "No account for host", body = ApiErrorResponse),
    )
)]
async fn search_notes(
    State(state): State<AppState>,
    Path(host): Path<String>,
    Query(params): Query<SearchQueryParams>,
) -> Result<Json<Vec<crate::models::NormalizedNote>>, ApiError> {
    let query = params.q.unwrap_or_default();
    if query.is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            code: "BAD_REQUEST".to_string(),
            message: "Missing query parameter: q".to_string(),
        });
    }
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let notes = state
        .client
        .search_notes(&h, &token, &account_id, &query, Default::default())
        .await?;
    Ok(Json(notes))
}

#[utoipa::path(
    get, path = "/api/{host}/notes/{note_id}", tag = "notes",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("note_id" = String, Path, description = "Note ID"),
    ),
    responses(
        (status = 200, description = "Note", body = NormalizedNote),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "Note or account not found", body = ApiErrorResponse),
    )
)]
async fn get_note(
    State(state): State<AppState>,
    Path((host, note_id)): Path<(String, String)>,
) -> Result<Json<crate::models::NormalizedNote>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let note = state
        .client
        .get_note(&h, &token, &account_id, &note_id)
        .await?;
    Ok(Json(note))
}

#[utoipa::path(
    delete, path = "/api/{host}/notes/{note_id}", tag = "notes",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("note_id" = String, Path, description = "Note ID"),
    ),
    responses(
        (status = 204, description = "Note deleted"),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "Note or account not found", body = ApiErrorResponse),
    )
)]
async fn delete_note(
    State(state): State<AppState>,
    Path((host, note_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    state.client.delete_note(&h, &token, &note_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get, path = "/api/{host}/notes/{note_id}/children", tag = "notes",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("note_id" = String, Path, description = "Note ID"),
        LimitQueryParams,
    ),
    responses(
        (status = 200, description = "Direct replies to the note", body = Vec<NormalizedNote>),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "Note or account not found", body = ApiErrorResponse),
    )
)]
async fn get_note_children(
    State(state): State<AppState>,
    Path((host, note_id)): Path<(String, String)>,
    Query(opts): Query<LimitQueryParams>,
) -> Result<Json<Vec<crate::models::NormalizedNote>>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let limit = opts.limit.unwrap_or(20);
    let notes = state
        .client
        .get_note_children(&h, &token, &account_id, &note_id, limit)
        .await?;
    Ok(Json(notes))
}

#[utoipa::path(
    get, path = "/api/{host}/notes/{note_id}/conversation", tag = "notes",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("note_id" = String, Path, description = "Note ID"),
        LimitQueryParams,
    ),
    responses(
        (status = 200, description = "Ancestor notes (conversation thread)", body = Vec<NormalizedNote>),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "Note or account not found", body = ApiErrorResponse),
    )
)]
async fn get_note_conversation(
    State(state): State<AppState>,
    Path((host, note_id)): Path<(String, String)>,
    Query(opts): Query<LimitQueryParams>,
) -> Result<Json<Vec<crate::models::NormalizedNote>>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let limit = opts.limit.unwrap_or(20);
    let notes = state
        .client
        .get_note_conversation(&h, &token, &account_id, &note_id, limit)
        .await?;
    Ok(Json(notes))
}

#[utoipa::path(
    get, path = "/api/{host}/notes/{note_id}/reactions", tag = "notes",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("note_id" = String, Path, description = "Note ID"),
        ReactionQueryParams,
    ),
    responses(
        (status = 200, description = "Reactions on the note", body = Vec<NormalizedNoteReaction>),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "Note or account not found", body = ApiErrorResponse),
    )
)]
async fn get_note_reactions(
    State(state): State<AppState>,
    Path((host, note_id)): Path<(String, String)>,
    Query(opts): Query<ReactionQueryParams>,
) -> Result<Json<Vec<crate::models::NormalizedNoteReaction>>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let limit = opts.limit.unwrap_or(20);
    let reactions = state
        .client
        .get_note_reactions(
            &h,
            &token,
            &note_id,
            opts.r#type.as_deref(),
            limit,
            opts.until_id.as_deref(),
        )
        .await?;
    Ok(Json(reactions))
}

#[utoipa::path(
    post, path = "/api/{host}/notes/{note_id}/reactions", tag = "notes",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("note_id" = String, Path, description = "Note ID"),
    ),
    request_body = ReactionBody,
    responses(
        (status = 204, description = "Reaction added"),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "Note or account not found", body = ApiErrorResponse),
    )
)]
async fn create_reaction(
    State(state): State<AppState>,
    Path((host, note_id)): Path<(String, String)>,
    Json(body): Json<ReactionBody>,
) -> Result<StatusCode, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    state
        .client
        .create_reaction(&h, &token, &note_id, &body.reaction)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete, path = "/api/{host}/notes/{note_id}/reactions", tag = "notes",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("note_id" = String, Path, description = "Note ID"),
    ),
    responses(
        (status = 204, description = "Reaction removed"),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "Note or account not found", body = ApiErrorResponse),
    )
)]
async fn delete_reaction(
    State(state): State<AppState>,
    Path((host, note_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    state.client.delete_reaction(&h, &token, &note_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get, path = "/api/{host}/users/{user_id}", tag = "users",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("user_id" = String, Path, description = "User ID"),
    ),
    responses(
        (status = 200, description = "User profile detail", body = NormalizedUserDetail),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "User or account not found", body = ApiErrorResponse),
    )
)]
async fn get_user(
    State(state): State<AppState>,
    Path((host, user_id)): Path<(String, String)>,
) -> Result<Json<crate::models::NormalizedUserDetail>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let user = state
        .client
        .get_user_detail(&h, &token, &account_id, &user_id)
        .await?;
    Ok(Json(user))
}

#[utoipa::path(
    get, path = "/api/{host}/users/{user_id}/notes", tag = "users",
    security(("bearer_auth" = [])),
    params(
        ("host" = String, Path, description = "Account host"),
        ("user_id" = String, Path, description = "User ID"),
        TimelineQueryParams,
    ),
    responses(
        (status = 200, description = "Notes authored by the user", body = Vec<NormalizedNote>),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
        (status = 404, description = "User or account not found", body = ApiErrorResponse),
    )
)]
async fn get_user_notes(
    State(state): State<AppState>,
    Path((host, user_id)): Path<(String, String)>,
    Query(opts): Query<TimelineQueryParams>,
) -> Result<Json<Vec<crate::models::NormalizedNote>>, ApiError> {
    let account_id = state.account_id_for_host(&host)?;
    let (h, token) = crate::get_credentials(&state.db, &account_id)?;
    let options = opts.into_timeline_options();
    let notes = state
        .client
        .get_user_notes(&h, &token, &account_id, &user_id, options)
        .await?;
    Ok(Json(notes))
}

/// SSE `data:` payload の union (#781 Phase 4)。discriminator は SSE の
/// `event:` フィールド (out-of-band) なので untagged oneOf として文書化する。
/// `event:` 名と variant の対応:
/// note/mention → StreamNote/StreamMentionEvent、note-updated →
/// StreamNoteUpdatedEvent、note-capture-updated → StreamNoteCaptureEvent、
/// notification → StreamNotificationEvent、main-{eventType} → StreamMainEvent、
/// chat → StreamChatMessageEvent、chat-deleted / chat-reacted / chat-unreacted →
/// StreamChatMessage{Deleted,Reacted,Unreacted}Event、status → StreamStatusEvent、
/// emoji-changed → StreamEmojiChangedEvent
#[derive(serde::Serialize, ToSchema)]
#[serde(untagged)]
#[allow(dead_code, clippy::large_enum_variant)] // OpenAPI ドキュメント専用の型
enum SseEventPayload {
    Note(crate::streaming::StreamNoteEvent),
    Notification(crate::streaming::StreamNotificationEvent),
    Mention(crate::streaming::StreamMentionEvent),
    Main(crate::streaming::StreamMainEvent),
    NoteUpdated(crate::streaming::StreamNoteUpdatedEvent),
    NoteCaptureUpdated(crate::streaming::StreamNoteCaptureEvent),
    ChatMessage(crate::streaming::StreamChatMessageEvent),
    ChatMessageDeleted(crate::streaming::StreamChatMessageDeletedEvent),
    ChatMessageReacted(crate::streaming::StreamChatMessageReactedEvent),
    ChatMessageUnreacted(crate::streaming::StreamChatMessageUnreactedEvent),
    Status(crate::streaming::StreamStatusEvent),
    EmojiChanged(crate::streaming::StreamEmojiChangedEvent),
}

#[utoipa::path(
    get, path = "/api/events", tag = "events",
    security(("bearer_auth" = [])),
    params(SseQueryParams),
    responses(
        (status = 200,
         description = "Server-sent event stream (`text/event-stream`). Each event \
            carries an `event:` type and a JSON `data:` payload typed as \
            `SseEventPayload` — the `event:` name selects the variant \
            (`note` / `mention` / `note-updated` / `note-capture-updated` / \
            `notification` / `main-{eventType}` / `chat` / `chat-deleted` / \
            `chat-reacted` / `chat-unreacted` / `status` / `emoji-changed`). \
            The `type` query param filters by event-name prefix.",
         content_type = "text/event-stream", body = SseEventPayload),
        (status = 401, description = "Unauthorized", body = ApiErrorResponse),
    )
)]
async fn sse_events(
    State(state): State<AppState>,
    Query(params): Query<SseQueryParams>,
) -> Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>> {
    let rx = state.event_bus.subscribe();

    let type_filter: Option<Vec<String>> = params
        .r#type
        .map(|t| t.split(',').map(|s| s.trim().to_string()).collect());

    let stream = BroadcastStream::new(rx).filter_map(move |result| match result {
        Ok(sse_event) => {
            if let Some(ref filter) = type_filter {
                if !filter.iter().any(|f| sse_event.event_type.starts_with(f)) {
                    return None;
                }
            }
            let event = Event::default()
                .event(&sse_event.event_type)
                .json_data(&sse_event.data)
                .ok()?;
            Some(Ok(event))
        }
        Err(_) => None,
    });

    Sse::new(stream).keep_alive(KeepAlive::default())
}

// --- Query / Body types ---

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct TimelineQueryParams {
    /// Max number of items to return (default 20)
    limit: Option<i64>,
    /// Return items newer than this ID
    since_id: Option<String>,
    /// Return items older than this ID
    until_id: Option<String>,
}

impl TimelineQueryParams {
    fn into_timeline_options(self) -> crate::models::TimelineOptions {
        crate::models::TimelineOptions::new(self.limit.unwrap_or(20), self.since_id, self.until_id)
    }
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct SearchQueryParams {
    /// Search query string (required)
    q: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct LimitQueryParams {
    /// Max number of items to return (default 20)
    limit: Option<u32>,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct ReactionQueryParams {
    /// Filter by reaction type
    r#type: Option<String>,
    /// Max number of reactions to return (default 20)
    limit: Option<u32>,
    /// Return reactions older than this ID
    until_id: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
struct ReactionBody {
    /// Reaction emoji (e.g. "👍" or ":custom_emoji:")
    reaction: String,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
struct SseQueryParams {
    /// Comma-separated event type prefixes to filter the stream
    r#type: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
struct CreateNoteBody {
    /// Note body text
    text: String,
    /// Content warning
    cw: Option<String>,
    /// Visibility: public | home | followers | specified
    visibility: Option<String>,
    /// Federate locally only
    local_only: Option<bool>,
    /// Reply target note ID
    reply_id: Option<String>,
    /// Renote target note ID
    renote_id: Option<String>,
    /// Attached drive file IDs
    file_ids: Option<Vec<String>>,
    /// Schedule the note for this ISO-8601 timestamp
    scheduled_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use utoipa::Modify;

    #[test]
    fn localhost_origin_predicate() {
        for ok in [
            "http://localhost",
            "http://localhost:5173",
            "http://127.0.0.1",
            "http://127.0.0.1:19820",
        ] {
            assert!(is_localhost_origin(ok), "{ok} should be allowed");
        }
        for ng in [
            "https://evil.example",
            "http://localhost.evil.example",
            "http://localhost:abc",
            "http://127.0.0.1:",
            "https://localhost",
            "http://[::1]:5173",
            "",
        ] {
            assert!(!is_localhost_origin(ng), "{ng} should be rejected");
        }
    }

    /// Every core route must appear in the generated OpenAPI spec.
    /// `routes!` makes this structural — this test guards against the
    /// `OpenApiRouter` wiring regressing (e.g. a route dropped from the macro).
    #[test]
    fn core_routes_are_all_in_the_spec() {
        let mut openapi = core_openapi();
        SecurityAddon.modify(&mut openapi);

        // 12 distinct paths, 15 operations.
        assert_eq!(openapi.paths.paths.len(), 12, "unexpected path count");
        let op_count: usize = openapi
            .paths
            .paths
            .values()
            .map(|item| {
                [&item.get, &item.post, &item.put, &item.delete, &item.patch]
                    .iter()
                    .filter(|o| o.is_some())
                    .count()
            })
            .sum();
        assert_eq!(op_count, 15, "unexpected operation count");

        // bearer_auth scheme is registered by SecurityAddon.
        assert!(openapi
            .components
            .as_ref()
            .is_some_and(|c| c.security_schemes.contains_key("bearer_auth")));
    }

    #[test]
    fn endpoints_are_derived_from_spec() {
        let openapi = ApiDoc::openapi();
        // ApiDoc alone has no paths; the derived list is empty until routes merge in.
        assert!(endpoints_from_spec(&openapi).is_empty());
    }
}
