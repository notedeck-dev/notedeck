mod auth;
/// Public so embedders (notedeck の healthcheck) can call [`doctor::diagnose`]
/// to reuse the same checks the `doctor` CLI subcommand runs.
pub mod doctor;
mod notes;
mod users;

use crate::api::MisskeyClient;
use crate::cli::Commands;
use crate::db::Database;
use crate::error::NoteDeckError;
use crate::format::OutputFormat;
use crate::models::Account;

/// Authenticated command context (shared across note/user handlers).
pub(crate) struct CmdContext {
    pub client: MisskeyClient,
    pub host: String,
    pub token: String,
    pub account: Account,
    pub fmt: OutputFormat,
}

pub async fn run_cli(
    cmd: &Commands,
    account_spec: Option<&str>,
    fmt: OutputFormat,
) -> Result<(), NoteDeckError> {
    let data_dir = dirs_data_dir().join("notecli");
    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");

    let db_path = data_dir.join("notecli.db");
    let db = Database::open(&db_path)?;

    // Commands that don't need credentials
    match cmd {
        Commands::Accounts => return auth::run_accounts(&db, fmt),
        Commands::Doctor => return doctor::run_doctor(&db, &db_path, account_spec, fmt).await,
        Commands::Login { host } => return auth::run_login(&db, host, fmt).await,
        Commands::Logout { target } => {
            let account = resolve_account(&db, Some(target))?;
            return auth::run_logout(&db, &account, fmt);
        }
        Commands::Cache(cache_cmd) => {
            return match cache_cmd {
                crate::cli::CacheCommands::Sweep => {
                    let deleted = db.sweep_orphan_notes()?;
                    crate::format::print_action(
                        fmt,
                        &format!(r#"{{"removed":{deleted}}}"#),
                        &deleted.to_string(),
                        &format!("Removed {deleted} orphan note(s) from cache"),
                    );
                    Ok(())
                }
            }
        }
        _ => {}
    }

    let account = resolve_account(&db, account_spec)?;
    let (host, token) = crate::get_credentials(&db, &account.id)?;
    let client = MisskeyClient::new()?;
    let ctx = CmdContext {
        client,
        host,
        token,
        account,
        fmt,
    };

    match cmd {
        Commands::Post {
            text,
            cw,
            visibility,
            reply_to,
            local_only,
        } => {
            notes::run_post(
                &ctx,
                text,
                cw.as_deref(),
                visibility,
                reply_to.as_deref(),
                *local_only,
            )
            .await
        }
        Commands::Timeline { r#type, limit } => notes::run_timeline(&ctx, r#type, *limit).await,
        Commands::Search { query, limit } => notes::run_search(&ctx, query, *limit).await,
        Commands::Note { id } => notes::run_note(&ctx, id).await,
        Commands::Replies { id, limit } => notes::run_replies(&ctx, id, *limit).await,
        Commands::Thread { id, limit } => notes::run_thread(&ctx, id, *limit).await,
        Commands::Delete { id } => notes::run_delete(&ctx, id).await,
        Commands::Update { id, text, cw } => notes::run_update(&ctx, id, text, cw.as_deref()).await,
        Commands::React { note_id, reaction } => notes::run_react(&ctx, note_id, reaction).await,
        Commands::Unreact { note_id } => notes::run_unreact(&ctx, note_id).await,
        Commands::Renote { note_id } => notes::run_renote(&ctx, note_id).await,
        Commands::Notifications { limit } => notes::run_notifications(&ctx, *limit).await,
        Commands::Mentions { limit } => notes::run_mentions(&ctx, *limit).await,
        Commands::Favorite { note_id } => notes::run_favorite(&ctx, note_id).await,
        Commands::Unfavorite { note_id } => notes::run_unfavorite(&ctx, note_id).await,
        Commands::Favorites { limit } => notes::run_favorites(&ctx, *limit).await,
        Commands::Emojis => notes::run_emojis(&ctx).await,
        Commands::User { target } => users::run_user(&ctx, target).await,
        Commands::UserNotes { user_id, limit } => {
            users::run_user_notes(&ctx, user_id, *limit).await
        }
        Commands::Follow { user_id } => users::run_follow(&ctx, user_id).await,
        Commands::Unfollow { user_id } => users::run_unfollow(&ctx, user_id).await,
        Commands::Accounts
        | Commands::Doctor
        | Commands::Daemon { .. }
        | Commands::Login { .. }
        | Commands::Logout { .. }
        | Commands::Cache(..) => {
            unreachable!()
        }
    }
}

fn resolve_account(db: &Database, spec: Option<&str>) -> Result<Account, NoteDeckError> {
    let accounts = db.load_accounts()?;
    if accounts.is_empty() {
        return Err(NoteDeckError::AccountNotFound(
            "no accounts found. Use 'notecli login <HOST>' to add one".to_string(),
        ));
    }

    let Some(spec) = spec else {
        return Ok(accounts.into_iter().next().unwrap());
    };

    // @user@host format
    if let Some(rest) = spec.strip_prefix('@') {
        if let Some((user, host)) = rest.split_once('@') {
            return accounts
                .into_iter()
                .find(|a| a.username.eq_ignore_ascii_case(user) && a.host.contains(host))
                .ok_or_else(|| NoteDeckError::AccountNotFound(spec.to_string()));
        }
    }

    // Try as account ID
    if let Some(account) = db.get_account(spec)? {
        return Ok(account);
    }

    // Try as username (partial match)
    accounts
        .into_iter()
        .find(|a| a.username.eq_ignore_ascii_case(spec))
        .ok_or_else(|| NoteDeckError::AccountNotFound(spec.to_string()))
}

fn dirs_data_dir() -> std::path::PathBuf {
    dirs::data_dir().unwrap_or_else(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        std::path::PathBuf::from(home).join(".local/share")
    })
}
