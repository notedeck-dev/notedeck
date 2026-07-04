#[cfg(not(mobile))]
use std::sync::Arc;
use tauri::Manager;
#[cfg(not(mobile))]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(not(mobile))]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
};
#[cfg(not(mobile))]
use tauri_plugin_autostart::MacosLauncher;
#[cfg(not(mobile))]
use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod api_tokens;
mod app_dir;
mod commands;
#[cfg(target_os = "windows")]
mod hwheel_hook;
/// Public so the `gen-openapi` binary and the OpenAPI snapshot test can call
/// [`http_server::build_openapi`].
pub mod http_server;
mod image_cache;
mod migrations;
mod ogp;
mod perf_config;
mod permissions_gate;
mod query_bridge;
mod query_runtime;
mod rate_limit;
mod streaming;
mod vault;
mod win_chrome;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = run_inner() {
        eprintln!("Application error: {e}");
        std::process::exit(1);
    }
}

/// Install the global `tracing` subscriber: stdout plus a daily-rotating
/// `notedeck.log` in the OS log dir (`app_log_dir`). The `EnvFilter` keeps the
/// previous default (`notedeck=info,notecli=info,warn`) and still honors `RUST_LOG`.
/// If the log dir can't be resolved we log to stdout only — logging must never
/// block startup. Called once from `setup`.
fn init_logging(app: &tauri::App) {
    use tracing_subscriber::prelude::*;

    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "notedeck=info,notecli=info,warn".parse().expect("default tracing filter must parse"));

    // File layer is optional: skipped if the log dir can't be created.
    let file_layer = app
        .path()
        .app_log_dir()
        .ok()
        .filter(|dir| std::fs::create_dir_all(dir).is_ok())
        .map(|dir| {
            let appender = tracing_appender::rolling::daily(&dir, "notedeck.log");
            let (non_blocking, guard) = tracing_appender::non_blocking(appender);
            // Keep the writer thread alive for the whole process (flushes on drop),
            // mirroring how the tokio runtime handle is leaked above.
            Box::leak(Box::new(guard));
            tracing_subscriber::fmt::layer().with_ansi(false).with_writer(non_blocking)
        });

    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer())
        .with(file_layer)
        .init();
}

fn run_inner() -> Result<(), Box<dyn std::error::Error>> {
    // Limit tokio worker threads (~2MB stack per thread).
    // 4 threads balance concurrency (multi-server WS + OGP + DB) vs memory.
    // Leak the runtime so the handle remains valid for the app's lifetime.
    let runtime = Box::leak(Box::new(
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()?,
    ));
    tauri::async_runtime::set(runtime.handle().clone());

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_haptics::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(not(mobile))]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            .plugin(tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                Some(vec!["--minimized"]),
            ));
    }

    let specta_builder = build_specta_builder();

    // Export TS bindings on debug builds so the committed src/bindings.ts stays
    // in sync with the live handlers. Same helper is used by the gen_bindings
    // example and the bindings_snapshot test, so the source list cannot drift.
    #[cfg(debug_assertions)]
    if let Err(e) = export_typescript_bindings("../src/bindings.ts") {
        eprintln!("Failed to export typescript bindings: {e}");
    }

    builder = builder.invoke_handler(specta_builder.invoke_handler());

    #[cfg(not(mobile))]
    let has_tray = Arc::new(AtomicBool::new(false));
    #[cfg(not(mobile))]
    let has_tray_for_setup = has_tray.clone();

    builder = builder.setup(move |app| {
        // Structured logging (#644): stdout (unchanged behavior) + a daily-rotating
        // file in the OS log dir, so background work (notecli wrapper / HEARTBEAT /
        // AI SSE) leaves a trace for bug reports and the healthcheck view.
        // Initialized here (not earlier) because the log dir needs the app handle;
        // if it can't be resolved we fall back to stdout-only so startup never blocks.
        init_logging(app);

        // tauri-specta typed events (e.g. QueryDelta) require the registry to be mounted.
        specta_builder.mount_events(app);

        // ══════════════════════════════════════════════════════════
        // Phase 1: Lightweight init (< 50ms) — window shows immediately after this
        // ══════════════════════════════════════════════════════════

        // Initialize app data directory (must be first — other init depends on it)
        let app_dir = app_dir::resolve_app_dir(app)?;
        std::fs::create_dir_all(&app_dir)?;

        // Initialize platform keychain + filesystem migrations (both lightweight)
        if let Err(e) = notecli::keychain::init_store() {
            tracing::warn!("keychain unavailable ({e})");
        }
        migrations::run_fs(&app_dir)?;

        // AppState: empty wrapper — commands await until Phase 2 fills it
        let app_state = commands::AppState::new();
        app.manage(app_state);

        // Performance config: starts with defaults, updated dynamically via Tauri command
        let shared_perf: perf_config::SharedPerfConfig =
            std::sync::Arc::new(tokio::sync::RwLock::new(perf_config::PerformanceConfig::default()));
        let shared_perf_bg = shared_perf.clone();
        app.manage(shared_perf);

        // Shared HTTP client (struct construction — fast, no I/O)
        let shared_http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .pool_max_idle_per_host(8)
            .pool_idle_timeout(std::time::Duration::from_secs(60))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .unwrap_or_default();
        app.manage(shared_http.clone());

        // HEARTBEAT scheduler (#411): per-AI-column tokio interval task。
        // フロントの useHeartbeatScheduler から configure / trigger される。
        app.manage(std::sync::Arc::new(commands::HeartbeatScheduler::new()));

        // Initialize event bus (SSE broadcasting)
        let event_bus = std::sync::Arc::new(notecli::event_bus::EventBus::new());
        app.manage(event_bus.clone());

        // Initialize auth session tracker (replay prevention)
        app.manage(commands::AuthSessionTracker::new());

        // Query runtime: stream events から Read Model を materialize し、
        // pending を貯めて 16ms 間隔で query-delta event をバッチ emit する。
        app.manage(query_runtime::QueryRuntime::default());
        // 常駐 flusher: notify_one を受けて DELTA_FLUSH_WINDOW スリープ後に
        // drain_pending() を emit。
        let flusher_app = app.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            query_runtime::run_delta_flusher(flusher_app).await;
        });

        // Generate API token (256-bit CSPRNG) and write to file
        let api_token: String = rand::random::<[u8; 32]>()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let token_path = app_dir.join("api-token");
        std::fs::write(&token_path, &api_token)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&token_path, std::fs::Permissions::from_mode(0o600))?;
        }
        let token_path_str = token_path.to_string_lossy().to_string();

        // 永続 API トークン (#709): ephemeral と併存する名前付きトークン。
        // ハッシュのみ保存なので読み込みは軽量 (Phase 1 で可)。
        let api_token_store = std::sync::Arc::new(api_tokens::ApiTokenStore::load(&app_dir));
        app.manage(api_token_store.clone());

        // ══════════════════════════════════════════════════════════
        // Phase 2: Heavy init in background thread (two-stage)
        //
        // Stage 1 — DB ready: DB open → migrations → initialize_db()
        //   Unblocks DB-only commands (load_accounts, cache queries).
        //
        // Stage 2 — Full ready: MisskeyClient + HTTP server → initialize()
        //   Unblocks API commands. Emits "nd:backend-ready" when complete.
        //
        // HTTP bind starts in parallel (no DB needed) so the image proxy
        // is ready before the frontend requests emoji images.
        // ══════════════════════════════════════════════════════════

        let app_handle = app.app_handle().clone();
        let app_dir_bg = app_dir.clone();
        std::thread::spawn(move || {
            // Parallel: DB open + MisskeyClient init + HTTP bind (all independent)
            let db_path = app_dir_bg.join("notecli.db");
            let db_handle = std::thread::spawn(move || notecli::db::Database::open(&db_path));
            let client_handle = std::thread::spawn(notecli::api::MisskeyClient::new);
            let http_handle = std::thread::spawn(|| {
                tauri::async_runtime::block_on(http_server::bind())
            });

            let db = match db_handle.join().expect("db open thread panicked") {
                Ok(d) => std::sync::Arc::new(d),
                Err(e) => {
                    tracing::error!("Fatal: DB open failed: {e}");
                    return;
                }
            };
            let client = match client_handle.join().expect("client init thread panicked") {
                Ok(c) => std::sync::Arc::new(c),
                Err(e) => {
                    tracing::error!("Fatal: MisskeyClient init failed: {e}");
                    return;
                }
            };
            let bound_server = http_handle.join().expect("http bind thread panicked");

            // DB migrations + account export (must complete before commands can use credentials)
            migrations::run_db(&db);

            // Stage 1: Signal DB readiness — unblocks DB-only commands (load_accounts, etc.)
            // immediately, without waiting for MisskeyClient or HTTP server.
            let app_state: tauri::State<'_, commands::AppState> = app_handle.state();
            app_state.initialize_db(db.clone());

            commands::export_account_list(&app_handle, &db);

            // Streaming manager (depends on DB)。
            // 必ず emit_accounts_early より前に manage する: アカウント一覧を
            // 受けた JS は即カラムを mount して query_subscribe_* を invoke する
            // ため、後に置くと State 未登録で "state not managed" の即時エラー
            // になる race がある (query 購読は初回失敗すると再試行されない)。
            let emitter = std::sync::Arc::new(streaming::TauriEmitter::new(app_handle.clone()));
            app_handle.manage(notecli::streaming::StreamingManager::new(
                emitter,
                event_bus.clone(),
                db.clone(),
            ));

            // Emit account list to frontend early — before full AppState.initialize() —
            // so the accounts store can populate without waiting for IPC readiness.
            commands::emit_accounts_early(&app_handle, &db);

            // Stage 2: Signal full AppState — unblocks commands needing MisskeyClient.
            app_state.initialize(db.clone(), client.clone());

            // OGP cache (lazy-loaded on first access via ensure_loaded())
            app_handle.manage(ogp::OgpCache::with_client(db.clone(), shared_http.clone(), shared_perf_bg.clone()));

            // Image cache
            let image_cache = std::sync::Arc::new(
                image_cache::ImageCache::with_client(&app_dir_bg, shared_http, shared_perf_bg.clone()),
            );

            // Start HTTP API server (attach routes to pre-bound listener)
            // Wait for the server to be ready before signalling the frontend,
            // so the image proxy can serve emoji requests immediately.
            if let Some(server) = bound_server {
                let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<()>();
                let serve_app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    http_server::serve(http_server::ServeConfig {
                        server,
                        app_handle: serve_app_handle,
                        db,
                        client,
                        event_bus,
                        api_token,
                        api_token_store,
                        token_path: token_path_str,
                        image_cache,
                        perf: shared_perf_bg,
                    }, ready_tx)
                    .await;
                });
                // Block until routes are built and server is about to accept
                tauri::async_runtime::block_on(async { ready_rx.await.ok() });
            }
            let _ = tauri::Emitter::emit(&app_handle, "nd:backend-ready", ());
        });

        // Periodic credential cache cleanup (every 5 minutes)
        tauri::async_runtime::spawn(async {
            let interval = std::time::Duration::from_secs(5 * 60);
            loop {
                tokio::time::sleep(interval).await;
                commands::cleanup_expired_credentials();
            }
        });

        // Deep link handler: forward notedeck:// URLs to the frontend
        #[cfg(not(mobile))]
        {
            use tauri_plugin_deep_link::DeepLinkExt;
            // OS への URL スキーム登録は best-effort — update-desktop-database
            // (desktop-file-utils) が無い環境 (最小構成 Linux / CI) では spawn が
            // ENOENT で失敗するが、deep-link 以外の全機能は無関係なので起動を
            // 止めない (? で伝播すると setup hook 全体が panic しアプリが死ぬ)
            if let Err(e) = app.deep_link().register("notedeck") {
                tracing::warn!("[deep-link] scheme registration failed (non-fatal): {e}");
            }

            let deep_link_handle = app.app_handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls = event.urls();
                if let Some(url) = urls.first() {
                    let url_str = url.as_str().to_string();
                    tracing::info!("[deep-link] received: {url_str}");
                    if let Some(w) = deep_link_handle.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = tauri::Emitter::emit(&deep_link_handle, "nd:deep-link", &url_str);
                }
            });
        }

        // Global shortcuts (desktop only)
        #[cfg(not(mobile))]
        {
            use tauri_plugin_global_shortcut::{
                Code, Modifiers, Shortcut as GShortcut, ShortcutState,
            };

            // Boss Key: Ctrl+Shift+B — toggle window visibility
            let boss_key = GShortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyB);
            app.global_shortcut()
                .on_shortcut(boss_key, |app: &tauri::AppHandle, _, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(w) = app.get_webview_window("main") {
                        if w.is_visible().unwrap_or(false) {
                            let _ = w.hide();
                        } else {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })?;

            // Quick Note: Ctrl+Alt+N — show window + emit event for post mode
            let quick_note = GShortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
            app.global_shortcut()
                .on_shortcut(quick_note, |app: &tauri::AppHandle, _, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                        let _ = w.emit("nd:quick-note", ());
                    }
                })?;
        }

        // System tray (desktop only)
        #[cfg(not(mobile))]
        {
            let show_i = MenuItem::with_id(app, "show", "Show NoteDeck", true, None::<&str>)?;
            let offline_i = MenuItem::with_id(app, "offline", "Offline Mode", true, None::<&str>)?;
            let realtime_i = MenuItem::with_id(app, "realtime", "Realtime Mode", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &offline_i, &realtime_i, &quit_i])?;

            let icon = app
                .default_window_icon()
                .ok_or("Default window icon not found")?
                .clone();

            match TrayIconBuilder::new()
                .icon(icon)
                .tooltip("NoteDeck")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "offline" => {
                        let _ = app.emit("nd:toggle-offline-mode", ());
                    }
                    "realtime" => {
                        let _ = app.emit("nd:toggle-realtime-mode", ());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)
            {
                Ok(_) => {
                    has_tray_for_setup.store(true, Ordering::Relaxed);
                }
                Err(e) => {
                    tracing::warn!("Failed to create tray icon (continuing without it): {e}");
                }
            }
        }

        // Forward WM_MOUSEHWHEEL as Tauri event (Windows WebView2 workaround)
        #[cfg(target_os = "windows")]
        hwheel_hook::install(app.handle());

        // Restore Win11 native chrome (rounded corners, focus-aware border)
        // since `decorations: false` strips them from the OS frame.
        win_chrome::apply_to_main(app.handle());

        // Fit window to monitor if larger than available screen (e.g. low-res VMs)
        #[cfg(not(mobile))]
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(Some(monitor)) = w.current_monitor() {
                let screen = monitor.size();
                let scale = monitor.scale_factor();
                let screen_w = (screen.width as f64 / scale) as u32;
                let screen_h = (screen.height as f64 / scale) as u32;

                if let Ok(outer) = w.outer_size() {
                    let win_w = (outer.width as f64 / scale) as u32;
                    let win_h = (outer.height as f64 / scale) as u32;

                    if win_w > screen_w || win_h > screen_h {
                        let new_w = win_w.min(screen_w);
                        let new_h = win_h.min(screen_h);
                        let _ = w.set_size(tauri::LogicalSize::new(new_w, new_h));
                        let _ = w.center();
                    }
                }
            }
        }

        Ok(())
    });

    // Hide to tray on close (desktop only, requires tray icon)
    #[cfg(not(mobile))]
    {
        let has_tray = has_tray.clone();
        builder = builder.on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if has_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });
    }

    builder.run(tauri::generate_context!())?;

    Ok(())
}

/// Build the tauri-specta builder shared by the runtime, the `gen_bindings`
/// example, and the `bindings_snapshot` test. Keeping the command/event lists
/// in one place is what makes the bindings.ts snapshot meaningful.
pub fn build_specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            commands::load_accounts,
            commands::delete_account,
            commands::logout_account,
            commands::create_guest_account,
            commands::cache_stats,
            commands::account_cache_count,
            commands::clear_account_cache,
            commands::clear_all_cache,
            commands::apply_eviction_config,
            commands::default_eviction_config,
            commands::chat_cache_stats,
            commands::chat_cache_count,
            commands::clear_chat_cache_for_account,
            commands::apply_chat_eviction_config,
            commands::default_chat_eviction_config,
            commands::load_servers,
            commands::get_server,
            commands::upsert_server,
            commands::api_get_endpoints,
            commands::api_get_endpoint_params,
            commands::api_get_user_policies,
            commands::api_update_user_setting,
            commands::api_get_timeline,
            commands::api_get_user_lists,
            commands::api_get_antennas,
            commands::api_get_antenna,
            commands::api_update_antenna,
            commands::api_get_antenna_notes,
            commands::api_get_favorites,
            commands::api_get_featured_notes,
            commands::api_get_mentions,
            commands::api_get_clips,
            commands::api_get_clip_notes,
            commands::api_get_channels,
            commands::api_search_channels,
            commands::api_get_channel_notes,
            commands::api_get_role_notes,
            commands::api_get_note,
            commands::api_create_note,
            commands::api_create_reaction,
            commands::api_delete_reaction,
            commands::api_vote_poll,
            commands::api_get_note_reactions,
            commands::api_update_note,
            commands::api_upload_file,
            commands::api_upload_file_from_path,
            commands::api_create_favorite,
            commands::api_delete_favorite,
            commands::api_delete_note,
            commands::api_follow_user,
            commands::api_unfollow_user,
            commands::api_invalidate_follower,
            commands::api_update_following,
            commands::api_update_user_memo,
            commands::api_accept_follow_request,
            commands::api_reject_follow_request,
            commands::api_cancel_follow_request,
            commands::api_get_user,
            commands::api_get_user_detail,
            commands::api_get_user_notes,
            commands::api_get_server_emojis,
            commands::api_get_pinned_reactions,
            commands::api_get_notifications,
            commands::api_get_notifications_grouped,
            commands::api_search_notes,
            commands::api_get_note_children,
            commands::api_get_note_renotes,
            commands::api_get_note_conversation,
            commands::api_lookup_user,
            commands::api_get_cached_timeline,
            commands::api_delete_cached_note,
            commands::api_verify_notes,
            commands::api_get_cached_timeline_before,
            commands::api_get_cache_date_range,
            commands::api_search_notes_local,
            commands::api_find_notes_by_uri,
            commands::api_pin_note,
            commands::api_unpin_note,
            commands::api_get_user_pinned_note_ids,
            commands::api_mute_user,
            commands::api_unmute_user,
            commands::api_renote_mute_user,
            commands::api_unrenote_mute_user,
            commands::api_get_muted_users,
            commands::api_get_muted_words,
            commands::api_get_renote_muted_users,
            commands::api_block_user,
            commands::api_unblock_user,
            commands::api_report_user,
            commands::api_add_note_to_clip,
            commands::api_remove_note_from_clip,
            commands::api_add_user_to_list,
            commands::api_remove_user_from_list,
            commands::api_get_following,
            commands::api_get_followers,
            commands::api_get_user_relations,
            commands::api_get_unread_notification_count,
            commands::api_mark_all_notifications_as_read,
            commands::api_get_unread_chat,
            commands::api_get_self,
            commands::api_get_drive_folders,
            commands::api_get_drive_files,
            commands::api_delete_drive_file,
            commands::api_get_follow_requests,
            commands::api_search_users,
            commands::api_get_roles,
            commands::api_get_role_users,
            commands::api_get_announcements,
            commands::api_read_announcement,
            commands::api_react_chat_message,
            commands::api_unreact_chat_message,
            commands::api_delete_chat_message,
            commands::api_search_users_by_query,
            commands::api_search_hashtags,
            commands::api_ap_show,
            commands::api_get_server_stats,
            commands::api_get_meta_detail,
            commands::api_get_user_achievements,
            commands::api_get_user_notes_filtered,
            commands::api_get_user_featured_notes,
            commands::api_get_pages,
            commands::api_get_page,
            commands::api_like_page,
            commands::api_unlike_page,
            commands::api_get_gallery_posts,
            commands::api_like_gallery_post,
            commands::api_unlike_gallery_post,
            commands::api_get_flashes,
            commands::api_get_flash,
            commands::api_like_flash,
            commands::api_unlike_flash,
            commands::api_request,
            // Charts (charts/*)
            commands::api_charts_user_notes,
            commands::api_charts_user_following,
            commands::api_charts_user_pv,
            commands::api_charts_active_users,
            commands::api_charts_notes,
            commands::api_charts_users,
            commands::api_charts_federation,
            commands::api_charts_ap_request,
            commands::api_charts_drive,
            // Federation
            commands::api_get_federation_instances,
            commands::api_get_federation_instance,
            // Drafts
            commands::api_get_drafts,
            commands::api_create_draft,
            commands::api_update_draft,
            commands::api_delete_draft,
            // Clips (extras)
            commands::api_get_clip,
            commands::api_get_my_favorite_clips,
            commands::api_create_clip,
            commands::api_favorite_clip,
            commands::api_unfavorite_clip,
            commands::api_get_user_clips,
            // Editor / detail (raw)
            commands::api_update_page,
            commands::api_update_flash,
            commands::api_get_note_raw,
            commands::api_get_drive_file,
            // Users (raw)
            commands::api_get_user_raw,
            commands::api_get_user_reactions,
            commands::api_get_user_pages_by,
            commands::api_get_user_flashs,
            commands::api_get_user_gallery_by,
            // Lists (others / detail / favorite)
            commands::api_get_list,
            commands::api_get_user_lists_by,
            commands::api_favorite_list,
            commands::api_unfavorite_list,
            commands::api_fetch_account_theme,
            commands::api_get_registry_value,
            commands::api_set_registry_value,
            commands::api_delete_registry_value,
            commands::api_list_registry_keys,
            commands::api_get_chat_history,
            commands::api_get_chat_user_messages,
            commands::api_get_chat_room_messages,
            commands::api_create_chat_message,
            commands::api_get_cached_chat_history,
            commands::api_get_cached_chat_thread_messages,
            commands::api_get_cached_chat_latest_message_id,
            commands::auth_start,
            commands::auth_complete_and_save,
            commands::stream_connect,
            commands::stream_disconnect,
            commands::stream_set_mode,
            commands::stream_sub_note,
            commands::stream_unsub_note,
            commands::fetch_ogp,
            commands::fetch_nodeinfo,
            commands::fetch_server_meta,
            commands::fetch_image_base64,
            commands::get_cli_commands,
            commands::get_rustc_version,
            commands::get_openapi_spec,
            commands::open_devtools,
            commands::export_db,
            commands::import_db,
            commands::save_image_to_file,
            commands::list_settings_files,
            commands::read_settings_file,
            commands::write_settings_file,
            commands::delete_settings_file,
            commands::rename_settings_file,
            commands::get_settings_dir,
            commands::get_log_dir,
            commands::open_settings_file_in_editor,
            commands::read_root_settings_file,
            commands::write_root_settings_file,
            commands::read_notedeck_json,
            commands::write_notedeck_json,
            commands::export_settings_json,
            commands::import_settings_json,
            // AI credentials (OS keychain via notecli::keychain)
            // AI chat (LLM streaming via reqwest + emit)
            commands::ai_chat_send,
            commands::ai_chat_cancel,
            // HTTP fetch (http.fetch capability / Nd:http)
            commands::http_fetch,
            // HEARTBEAT (#411 Phase 6) — per-column scheduler
            commands::heartbeat_configure,
            commands::heartbeat_unconfigure,
            commands::heartbeat_trigger_now,
            commands::heartbeat_status,
            // Healthcheck (#644) — notecli doctor + ランタイム状態の自己診断
            commands::run_healthcheck,
            // 永続 API トークン (#709) — 外部アプリ向け名前付きトークンの発行/失効
            commands::list_api_tokens,
            commands::create_api_token,
            commands::revoke_api_token,
            // Secret Vault (#564) — 外部サービス接続のメタデータ + secret 管理
            commands::vault_list_connections,
            commands::vault_get_connection,
            commands::vault_upsert_connection,
            commands::vault_upsert_connection_with_secret,
            commands::vault_set_secret,
            commands::vault_get_secret_status,
            commands::vault_delete_secret,
            commands::vault_delete_connection,
            commands::vault_set_exposed,
            commands::vault_set_trusted,
            commands::vault_fetch,
            commands::vault_test_connection,
            commands::ai_migrate_provider_to_vault,
            query_runtime::query_subscribe_timeline,
            query_runtime::query_subscribe_antenna,
            query_runtime::query_subscribe_channel,
            query_runtime::query_subscribe_role,
            query_runtime::query_subscribe_mentions,
            query_runtime::query_subscribe_notifications,
            query_runtime::query_subscribe_chat_user,
            query_runtime::query_subscribe_chat_room,
            query_runtime::query_open,
            query_runtime::query_set_runtime_state,
            query_runtime::query_close,
            query_runtime::query_get_snapshot,
            query_runtime::query_get_read_model_snapshot,
            perf_config::update_performance_config,
            perf_config::get_performance_config,
            permissions_gate::permissions_sync,
        ])
        .events(tauri_specta::collect_events![
            query_runtime::QueryDelta,
            query_runtime::NoteCaptureBatch,
        ])
}

/// Export TypeScript bindings to `target`. Runs inside a thread with a 64 MB
/// stack so deeply recursive types (e.g. `NormalizedNote`) can render without
/// blowing the default stack.
pub fn export_typescript_bindings(
    target: impl AsRef<std::path::Path>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let target = target.as_ref().to_path_buf();
    let join_result = std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(move || {
            build_specta_builder().export(
                specta_typescript::Typescript::default()
                    .bigint(specta_typescript::BigIntExportBehavior::Number),
                &target,
            )
        })
        .map_err(Box::<dyn std::error::Error + Send + Sync>::from)?
        .join();

    match join_result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(format!("specta export error: {e:?}").into()),
        Err(_) => Err("export thread panicked".into()),
    }
}
