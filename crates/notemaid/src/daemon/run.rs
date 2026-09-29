//! `notemaid run`: notemaid (AI) を headless に常駐させる (#1106 案 B の途中段階)。
//! 常駐するのはエージェントループ / HEARTBEAT と AI 系コマンドの RPC 面だけで、
//! データ面 (ストリーミング / クエリランタイム / OGP / 画像キャッシュ / 公開 HTTP API)
//! は持たない (デバイスのアプリが持つ)。アプリの notes DB は開かず、自分の小さな DB
//! (`notemaid.db`: 口座の一覧だけ。接続したアプリが `notemaid.accounts` で同期する) を持つ。
//! トークンは OS キーチェーン (`--secrets keychain`) から同じ id で読む。

use std::sync::Arc;
use std::time::{Duration, Instant};

use notecore::context::Core;
use serde_json::json;

use crate::daemon::heartbeat_timer::HeartbeatTimer;
use crate::daemon::rpc_server::{new_secret, RpcServer, SessionBridge, Sessions};
use crate::daemon::sinks::{self, Events};
use crate::daemon::{exit, lock, logging, RunArgs};

/// notemaid 自身の DB。アプリの notecli.db とは別 (版ずれと排他を持ち込まない)
pub const DB_FILE: &str = "notemaid.db";
use crate::CoreMaidExt;

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
    tracing::info!(data_dir = %data_dir.display(), version = env!("CARGO_PKG_VERSION"), "notemaid starting");

    // ロック: 同じ data-dir で notemaid を動かすのは 1 プロセスだけ (アプリとは併存する)
    let _lock = match lock::acquire(&data_dir) {
        Ok(l) => l,
        Err(lock::LockError::Held) => {
            tracing::error!("another notemaid is running on this data directory");
            return exit::LOCK_HELD;
        }
        Err(lock::LockError::Io(e)) => {
            tracing::error!("lock failed: {e}");
            return exit::FAILURE;
        }
    };

    // RPC 面の場所
    let Some(socket) = args
        .socket
        .socket
        .clone()
        .map(|s| crate::transport::Endpoint::parse(&s))
        .or_else(crate::transport::default_endpoint)
    else {
        tracing::error!("XDG_RUNTIME_DIR is not set; pass --socket");
        return exit::RUNTIME_DIR_MISSING;
    };

    // secret の置き場: 常駐 / サーバーは暗号化ファイル、アプリの子プロセスは OS キーチェーン
    match args.secrets {
        crate::daemon::SecretsBackend::Keychain => {
            // アプリと同じ扱い: キーチェーンが無くても起動は続け、トークンが要る呼び出しが
            // 個別に失敗する (子プロセスが即死するとアプリ側の中継が宙に浮くため)
            if let Err(e) = notecli::keychain::init_store() {
                tracing::warn!("keychain unavailable ({e}); AI calls that need tokens will fail");
            }
        }
        crate::daemon::SecretsBackend::File => {
            let key_path = args
                .secret_key_file
                .clone()
                .or_else(|| dirs::config_dir().map(|d| d.join("notemaid").join("secret.key")));
            let Some(key_path) = key_path else {
                tracing::error!("no config directory for the secret key; pass --secret-key-file");
                return exit::SECRET_KEY;
            };
            let data_path = crate::daemon::secrets::secrets_path(&data_dir);
            if let Err(e) = notecli::keychain::init_file_store(&key_path, &data_path) {
                tracing::error!(key = %key_path.display(), "secret store unavailable: {e}");
                return exit::SECRET_KEY;
            }
        }
    }

    // 親 (アプリ) が死んだら一緒に終わる: stdin の EOF を別スレッドで待つ
    let parent_gone = if args.exit_on_stdin_close {
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        std::thread::spawn(move || {
            use std::io::Read;
            let mut buf = [0u8; 64];
            let mut stdin = std::io::stdin().lock();
            loop {
                match stdin.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
            let _ = tx.send(());
        });
        Some(rx)
    } else {
        None
    };

    // DB がこのバイナリより新しければ再起動しても直らない
    if let Err(e) = notecore::migrations::run_fs(&data_dir) {
        tracing::error!("filesystem migration failed: {e}");
        return exit::FAILURE;
    }
    let db_path = data_dir.join(DB_FILE);
    if db_path.exists() {
        match notecli::db::Database::migration_status(&db_path) {
            Ok(status) if status.is_openable() => {}
            Ok(status) => {
                tracing::error!(
                    ?status,
                    "database is newer than this notemaid; update notemaid"
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
    runtime.block_on(serve(data_dir, socket, parent_gone))
}

async fn serve(
    data_dir: std::path::PathBuf,
    socket: crate::transport::Endpoint,
    parent_gone: Option<tokio::sync::oneshot::Receiver<()>>,
) -> i32 {
    let started = Instant::now();
    notecore::crash_report::install_panic_hook(data_dir.join("logs"));
    notecore::permissions_gate::init(&data_dir.join(notecore::commands::settings::SETTINGS_DIR));
    crate::ai_turn::recover(&data_dir);
    crate::heartbeat::restore_status(&data_dir);

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
    crate::install(&core);
    core.set_ai_event_sink(Arc::new(events.clone()));
    // 橋: 接続中の端末に確認内容の組み立てや実行要求を投げる。居なければ端末なし扱い
    core.set_frontend_bridge(Arc::new(SessionBridge(sessions.clone())));
    core.set_core_executor(Arc::new(crate::ai_turn::LocalCoreExecutor(core.clone())));
    {
        let core_for_timer = core.clone();
        let timer_for_sink = timer.clone();
        core.set_settings_sink(Arc::new(sinks::ConfigSink {
            events: events.clone(),
            on_change: Arc::new(move |change| {
                if change.subdir.is_some() {
                    return;
                }
                if change.name == crate::ai_config::FILE_NAME {
                    timer_for_sink.reconfigure(core_for_timer.clone());
                }
            }),
        }));
    }
    let shutdown = Arc::new(notecore::shutdown::Shutdown::new(
        tokio::runtime::Handle::current(),
    ));

    // DB と Misskey クライアント
    let db = match notecli::db::Database::open(&data_dir.join(DB_FILE)) {
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
    core.initialize(db.clone(), client.clone());
    timer.reconfigure(core.clone());

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
        endpoint: socket.clone(),
        sessions: sessions.clone(),
        status: Arc::new(move || {
            json!({
                "running": true,
                "devices": status_sessions.count(),
                "pid": std::process::id(),
                "version": env!("CARGO_PKG_VERSION"),
                "fingerprint": notecore::rpc::manifest_fingerprint(),
                "dataDir": status_dir.display().to_string(),
                "socket": status_socket.to_string(),
                "uptimeSeconds": started.elapsed().as_secs(),
                "ready": status_core.is_ready(),
                "heartbeatIntervalMinutes": status_timer.interval_minutes(),
                "heartbeat": crate::heartbeat::status_json(),
                "exitCodes": exit::NO_RESTART.iter().map(|c| json!({ "code": c, "name": exit::name(*c) })).collect::<Vec<_>>(),
            })
        }),
    });
    let listener = match server.bind().await {
        Ok(l) => l,
        Err(e) => {
            tracing::error!(socket = %socket, "socket bind failed: {e}");
            return exit::FAILURE;
        }
    };
    tracing::info!(socket = %socket, "RPC surface ready");
    let serve_task = tokio::spawn(server.clone().serve(listener, shutdown.token()));

    // 停止: SIGTERM / SIGINT (または親の stdin が閉じた) → 再起動予告 → graceful
    match parent_gone {
        Some(rx) => {
            tokio::select! {
                _ = wait_for_signal() => {}
                _ = rx => tracing::info!("parent closed stdin; exiting"),
            }
        }
        None => wait_for_signal().await,
    }
    tracing::info!("shutting down");
    events.emit("nd:notemaid-restarting", &json!({ "graceMs": 5000 }));
    timer.stop();
    shutdown.trigger();
    crate::ai_chat_service::abort_all_streams();
    crate::ai_turn::abort_all_turns();
    let _ = tokio::time::timeout(Duration::from_secs(5), serve_task).await;
    if let crate::transport::Endpoint::Unix(path) = &socket {
        let _ = std::fs::remove_file(path);
    }
    0
}

#[cfg(not(unix))]
async fn wait_for_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(unix)]
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
