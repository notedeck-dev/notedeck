//! `notecored run`: notecore を headless に組み立てて常駐する。Tauri アプリの
//! 起動手順 (Phase 1 / 2) と同じ順で、デバイス依存の物 (ウィンドウ / トレイ /
//! OS 通知 / WebView) だけが無い。

use std::sync::Arc;
use std::time::{Duration, Instant};

use notecore::context::Core;
use serde_json::json;

use crate::heartbeat_timer::HeartbeatTimer;
use crate::rpc_server::{default_socket_path, new_secret, RpcServer, SessionBridge, Sessions};
use crate::sinks::{self, Events};
use crate::{exit, lock, logging, RunArgs};

pub fn run(args: RunArgs) -> i32 {
    let Some(data_dir) = args
        .data_dir
        .clone()
        .or_else(notecore::app_dir::default_app_dir)
    else {
        eprintln!("no data directory: set --data-dir");
        return exit::FAILURE;
    };
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        eprintln!("cannot create {}: {e}", data_dir.display());
        return exit::FAILURE;
    }
    logging::init(logging::resolve(args.log), &data_dir);
    tracing::info!(data_dir = %data_dir.display(), version = env!("CARGO_PKG_VERSION"), "notecored starting");

    // ロック: 同じ data-dir で notecore を動かすのは 1 プロセスだけ
    let _lock = match lock::acquire(&data_dir) {
        Ok(l) => l,
        Err(lock::LockError::Held) => {
            tracing::error!(
                "another notecore is running on this data directory (app embedded or notecored)"
            );
            return exit::LOCK_HELD;
        }
        Err(lock::LockError::Io(e)) => {
            tracing::error!("lock failed: {e}");
            return exit::FAILURE;
        }
    };

    // socket の置き場
    let Some(socket) = args.socket.socket.clone().or_else(default_socket_path) else {
        tracing::error!("XDG_RUNTIME_DIR is not set; pass --socket");
        return exit::RUNTIME_DIR_MISSING;
    };

    // secret: ファイル backend 固定 (OS キーチェーンは probe しない)
    #[cfg(target_os = "linux")]
    {
        let key_path = args
            .secret_key_file
            .clone()
            .or_else(|| dirs::config_dir().map(|d| d.join("notecored").join("secret.key")));
        let Some(key_path) = key_path else {
            tracing::error!("no config directory for the secret key; pass --secret-key-file");
            return exit::SECRET_KEY;
        };
        let data_path = data_dir.join("notecored").join("secrets.enc");
        if let Err(e) = notecli::keychain::init_file_store(&key_path, &data_path) {
            tracing::error!(key = %key_path.display(), "secret store unavailable: {e}");
            return exit::SECRET_KEY;
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        if let Err(e) = notecli::keychain::init_store() {
            tracing::error!("secret store unavailable: {e}");
            return exit::SECRET_KEY;
        }
    }

    // DB がこのバイナリより新しければ再起動しても直らない
    if let Err(e) = notecore::migrations::run_fs(&data_dir) {
        tracing::error!("filesystem migration failed: {e}");
        return exit::FAILURE;
    }
    let db_path = data_dir.join("notecli.db");
    if db_path.exists() {
        match notecli::db::Database::migration_status(&db_path) {
            Ok(status) if status.is_openable() => {}
            Ok(status) => {
                tracing::error!(
                    ?status,
                    "database is newer than this notecored; update notecored"
                );
                return exit::DB_NEWER;
            }
            Err(e) => {
                tracing::error!("migration check failed: {e}");
                return exit::FAILURE;
            }
        }
    }

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            tracing::error!("tokio runtime: {e}");
            return exit::FAILURE;
        }
    };
    runtime.block_on(serve(args, data_dir, socket))
}

async fn serve(args: RunArgs, data_dir: std::path::PathBuf, socket: std::path::PathBuf) -> i32 {
    let started = Instant::now();
    notecore::crash_report::install_panic_hook(data_dir.join("logs"));
    notecore::permissions_gate::init(&data_dir.join(notecore::commands::settings::SETTINGS_DIR));
    notecore::ai_turn::recover(&data_dir);
    notecore::heartbeat::restore_status(&data_dir);

    let core = Arc::new(Core::new());
    core.set_app_dir(data_dir.clone());
    core.set_app_version(env!("CARGO_PKG_VERSION").to_string());
    let perf: notecore::perf_config::SharedPerfConfig = Arc::new(tokio::sync::RwLock::new(
        notecore::perf_config::PerformanceConfig::default(),
    ));
    core.set_perf(perf.clone());
    let http = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(8)
        .pool_idle_timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::limited(5))
        .dns_resolver(Arc::new(notecore::ssrf::ValidatingResolver))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("http client: {e}");
            return exit::FAILURE;
        }
    };
    core.set_http(http.clone());

    let events = Events::new();
    let timer = Arc::new(HeartbeatTimer::default());
    let sessions = Arc::new(Sessions::default());
    core.set_ai_chat_sink(Arc::new(sinks::ChatSink(events.clone())));
    core.set_ai_turn_sink(Arc::new(sinks::TurnSink(events.clone())));
    core.set_heartbeat_sink(Arc::new(sinks::HbSink(events.clone())));
    // 橋: 接続中の端末に確認内容の組み立てや実行要求を投げる。居なければ端末なし扱い
    core.set_frontend_bridge(Arc::new(SessionBridge(sessions.clone())));
    core.set_core_executor(Arc::new(notecore::ai_turn::LocalCoreExecutor(core.clone())));
    {
        let core_for_timer = core.clone();
        let timer_for_sink = timer.clone();
        core.set_settings_sink(Arc::new(sinks::ConfigSink {
            events: events.clone(),
            on_change: Arc::new(move |change| {
                if change.subdir.is_none() && change.name == notecore::ai_config::FILE_NAME {
                    timer_for_sink.reconfigure(core_for_timer.clone());
                }
            }),
        }));
    }
    core.set_hint_sink(Arc::new(sinks::Hints(events.clone())));

    let image_cache = Arc::new(notecore::image_cache::ImageCache::with_client(
        &data_dir,
        http.clone(),
        perf.clone(),
    ));
    core.set_image_cache(image_cache.clone());
    let warmer = notecore::media_warm::MediaWarmer::new(image_cache.clone());
    core.set_media_warmer(warmer.clone());
    tokio::spawn(async move { warmer.spawn_workers() });

    let shutdown = Arc::new(notecore::shutdown::Shutdown::new(
        tokio::runtime::Handle::current(),
    ));
    {
        let cache = image_cache.clone();
        shutdown.spawn(async move {
            tokio::time::sleep(Duration::from_secs(60)).await;
            loop {
                cache.sweep_disk().await;
                tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
            }
        });
    }

    let query_runtime = Arc::new(notecore::query_runtime::QueryRuntime::default());
    core.set_query_runtime(query_runtime.clone());
    shutdown.spawn(sinks::run_delta_flusher(
        query_runtime.clone(),
        events.clone(),
    ));
    let event_bus = Arc::new(notecli::event_bus::EventBus::new());

    // DB と Misskey クライアント
    let db = match notecli::db::Database::open(&data_dir.join("notecli.db")) {
        Ok(db) => Arc::new(db),
        Err(e) => {
            tracing::error!("database open failed: {}", e.safe_message());
            return exit::FAILURE;
        }
    };
    let client = match notecli::api::MisskeyClient::new() {
        Ok(c) => Arc::new(c),
        Err(e) => {
            tracing::error!("misskey client: {e}");
            return exit::FAILURE;
        }
    };
    notecore::migrations::run_db(&db);
    core.initialize_db(db.clone());
    {
        let db = db.clone();
        std::thread::spawn(move || {
            while db
                .backfill_identity_chunk(2000)
                .map(|n| n > 0)
                .unwrap_or(false)
            {
                std::thread::sleep(Duration::from_millis(20));
            }
        });
    }
    notecore::commands::export_account_list(&core, &db);
    let streaming = Arc::new(notecli::streaming::StreamingManager::new(
        Arc::new(sinks::StreamEmitter {
            runtime: query_runtime.clone(),
            events: events.clone(),
        }),
        event_bus.clone(),
        db.clone(),
    ));
    core.set_streaming(streaming);
    core.initialize(db.clone(), client.clone());
    core.set_ogp(notecore::ogp::OgpCache::with_client(
        db.clone(),
        http.clone(),
        perf.clone(),
    ));
    timer.reconfigure(core.clone());

    // 公開 API 面は既定 off
    if args.api {
        match notecore::http_server::bind().await {
            Some(server) => {
                let api_token = new_secret();
                let token_path = data_dir.join("api-token");
                if let Err(e) = write_private(&token_path, &api_token) {
                    tracing::warn!("api token write failed: {e}");
                }
                let config = notecore::http_server::ServeConfig {
                    server,
                    app_version: env!("CARGO_PKG_VERSION").to_string(),
                    bridge: Arc::new(SessionBridge(sessions.clone())),
                    db: Some(db.clone()),
                    client: Some(client.clone()),
                    event_bus: event_bus.clone(),
                    api_token,
                    api_token_store: Arc::new(notecore::api_tokens::ApiTokenStore::load(&data_dir)),
                    token_path: token_path.display().to_string(),
                    log_dir: Some(data_dir.join("logs").display().to_string()),
                    image_cache: image_cache.clone(),
                    media_proxy_token: notecore::http_server::MediaProxyToken(new_secret()),
                    perf: perf.clone(),
                    shutdown: shutdown.token(),
                };
                let (ready_tx, _ready_rx) = tokio::sync::oneshot::channel();
                tokio::spawn(notecore::http_server::serve(config, ready_tx));
                tracing::info!("public API surface enabled");
            }
            None => tracing::warn!("public API surface could not bind; continuing without it"),
        }
    }

    // RPC 面
    let secret = new_secret();
    let status_core = core.clone();
    let status_timer = timer.clone();
    let status_socket = socket.clone();
    let status_dir = data_dir.clone();
    let status_sessions = sessions.clone();
    let server = Arc::new(RpcServer {
        core: core.clone(),
        events: events.clone(),
        secret,
        socket: socket.clone(),
        sessions: sessions.clone(),
        status: Arc::new(move || {
            json!({
                "running": true,
                "devices": status_sessions.count(),
                "pid": std::process::id(),
                "version": env!("CARGO_PKG_VERSION"),
                "fingerprint": notecore::rpc::manifest_fingerprint(),
                "dataDir": status_dir.display().to_string(),
                "socket": status_socket.display().to_string(),
                "uptimeSeconds": started.elapsed().as_secs(),
                "ready": status_core.is_ready(),
                "heartbeatIntervalMinutes": status_timer.interval_minutes(),
                "heartbeat": notecore::heartbeat::status_json(),
                "exitCodes": exit::NO_RESTART.iter().map(|c| json!({ "code": c, "name": exit::name(*c) })).collect::<Vec<_>>(),
            })
        }),
    });
    let listener = match server.bind().await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(socket = %socket.display(), "socket bind failed: {e}");
            return exit::FAILURE;
        }
    };
    tracing::info!(socket = %socket.display(), "RPC surface ready");
    let serve_task = tokio::spawn(server.clone().serve(listener, shutdown.token()));

    // 停止: SIGTERM / SIGINT → 再起動予告 → graceful
    wait_for_signal().await;
    tracing::info!("shutting down");
    events.emit("nd:notecored-restarting", &json!({ "graceMs": 5000 }));
    timer.stop();
    shutdown.trigger();
    notecore::ai_chat_service::abort_all_streams();
    notecore::ai_turn::abort_all_turns();
    let _ = tokio::time::timeout(Duration::from_secs(5), serve_task).await;
    let _ = std::fs::remove_file(&socket);
    0
}

async fn wait_for_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let mut term = match signal(SignalKind::terminate()) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("SIGTERM handler unavailable: {e}");
            let _ = tokio::signal::ctrl_c().await;
            return;
        }
    };
    tokio::select! {
        _ = term.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
    }
}

fn write_private(path: &std::path::Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    f.write_all(content.as_bytes())
}
