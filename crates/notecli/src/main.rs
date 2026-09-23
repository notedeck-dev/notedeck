use std::sync::Arc;

use clap::Parser;
use notecli::cli::{Cli, Commands};
use notecli::db::Database;
use notecli::event_bus::EventBus;
use notecli::format::OutputFormat;
use notecli::streaming::{EventBusEmitter, StreamingManager};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .with_writer(std::io::stderr)
        .init();

    if let Err(e) = notecli::keychain::init_store() {
        tracing::warn!(error = %e, "keychain unavailable");
    }

    let cli = Cli::parse();
    notecli::format::init_color(cli.color);

    match cli.command {
        None | Some(Commands::Daemon { .. }) => {
            let port = match &cli.command {
                Some(Commands::Daemon { port }) => *port,
                _ => 19820,
            };
            run_daemon(port).await;
        }
        Some(ref cmd) => {
            let fmt = OutputFormat::from_cli(&cli);
            if let Err(e) = notecli::commands::run_cli(cmd, cli.account.as_deref(), fmt).await {
                match fmt {
                    OutputFormat::Json | OutputFormat::Jsonl => {
                        let err =
                            serde_json::json!({ "error": e.code(), "message": e.safe_message() });
                        eprintln!("{err}");
                    }
                    _ => {
                        eprintln!("Error: {}", e.safe_message());
                    }
                }
                std::process::exit(1);
            }
        }
    }
}

async fn run_daemon(port: u16) {
    let data_dir = dirs_data_dir().join("notecli");
    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");

    let db_path = data_dir.join("notecli.db");
    let db = Arc::new(Database::open(&db_path).expect("Failed to open database"));

    let client =
        Arc::new(notecli::api::MisskeyClient::new().expect("Failed to create HTTP client"));

    let event_bus = Arc::new(EventBus::new());

    let emitter = Arc::new(EventBusEmitter::new(event_bus.clone()));
    let _streaming = StreamingManager::new(emitter, event_bus.clone(), db.clone());

    let api_token: String = rand::random::<[u8; 32]>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let token_path = data_dir.join("api-token");
    std::fs::write(&token_path, &api_token).expect("Failed to write API token");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&token_path, std::fs::Permissions::from_mode(0o600))
            .expect("Failed to set token file permissions");
    }
    let token_path_str = token_path.to_string_lossy().to_string();

    tracing::info!(data_dir = %data_dir.display(), token_path = %token_path_str, port, "daemon starting");

    notecli::http_server::start_on_port(db, client, event_bus, api_token, token_path_str, port)
        .await;
}

fn dirs_data_dir() -> std::path::PathBuf {
    dirs::data_dir().unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home).join(".local/share")
    })
}
