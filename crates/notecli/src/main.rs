use clap::{CommandFactory, Parser};
use notecli::cli::Cli;
use notecli::format::OutputFormat;

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

    // HTTP の面は notecli 単体では出さない (notedeck#1106 段階 3a で廃止)。
    // ルート定義はライブラリに残り、NoteDeck 本体と notecored の公開 API 面が取り込む
    match cli.command {
        None => {
            let _ = Cli::command().print_help();
            println!();
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
