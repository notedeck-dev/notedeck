use crate::api::MisskeyClient;
use crate::db::Database;
use crate::error::NoteDeckError;
use crate::format::{print_action, theme, OutputFormat};
use crate::models::{Account, AccountPublic};

pub fn run_accounts(db: &Database, fmt: OutputFormat) -> Result<(), NoteDeckError> {
    let accounts = db.load_accounts()?;
    match fmt {
        OutputFormat::Json => {
            let public: Vec<AccountPublic> = accounts.iter().map(AccountPublic::from).collect();
            println!("{}", serde_json::to_string(&public).unwrap());
        }
        OutputFormat::Jsonl => {
            for a in &accounts {
                let public = AccountPublic::from(a);
                println!("{}", serde_json::to_string(&public).unwrap());
            }
        }
        OutputFormat::Ids => {
            for a in &accounts {
                println!("{}", a.id);
            }
        }
        OutputFormat::Compact => {
            for a in &accounts {
                let name = a.display_name.as_deref().unwrap_or(&a.username);
                println!(
                    "{}\t{}\t{}",
                    theme::muted(&a.id),
                    theme::user(&format!("@{}@{}", a.username, a.host)),
                    theme::name(name)
                );
            }
        }
        OutputFormat::Default => {
            if accounts.is_empty() {
                println!("No accounts found. Use 'notecli login <HOST>' to add one.");
            } else {
                for a in &accounts {
                    let name = a.display_name.as_deref().unwrap_or(&a.username);
                    println!(
                        "{} {} {}",
                        theme::user(&format!("@{}@{}", a.username, a.host)),
                        theme::muted(&format!("({})", a.id)),
                        theme::name(name)
                    );
                }
            }
        }
    }
    Ok(())
}

pub async fn run_login(db: &Database, host: &str, fmt: OutputFormat) -> Result<(), NoteDeckError> {
    // NoteDeck 経路と同じく ASCII 小文字で保存する (accounts の (host, user_id) 一意制約と
    // ノートの取得元 host を揃える。notedeck#1058)
    let host = host.trim().to_ascii_lowercase();
    let host = host.as_str();
    let client = MisskeyClient::new()?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let permissions = [
        "read:account",
        "write:account",
        "read:blocks",
        "write:blocks",
        "read:drive",
        "write:drive",
        "read:favorites",
        "write:favorites",
        "read:following",
        "write:following",
        // Misskey v2025 (#15686) の chat/* endpoints (create-to-{user,room},
        // delete, react, unreact, history, ...) は kind: 'read:chat' / 'write:chat'
        // を要求する。legacy messaging API は v2025 で完全削除済みなので
        // `read:messaging` / `write:messaging` は併記しない。
        "read:chat",
        "write:chat",
        "read:mutes",
        "write:mutes",
        "read:notes",
        "write:notes",
        "read:notifications",
        "write:notifications",
        "read:reactions",
        "write:reactions",
        "write:votes",
    ];
    let permission_str = permissions.join(",");
    let scheme = crate::insecure::http_scheme(host);
    let auth_url =
        format!("{scheme}://{host}/miauth/{session_id}?name=notecli&permission={permission_str}");

    match fmt {
        OutputFormat::Json | OutputFormat::Jsonl => {
            println!(
                r#"{{"authUrl":"{}","sessionId":"{}","status":"waiting"}}"#,
                auth_url, session_id
            );
        }
        _ => {
            println!(
                "{}",
                theme::muted("以下のURLをブラウザで開いて認証してください:")
            );
            println!();
            println!("  {}", theme::link(&auth_url));
            println!();
            println!(
                "{}",
                theme::muted("認証が完了したらEnterを押してください...")
            );
        }
    }

    let mut input = String::new();
    std::io::stdin()
        .read_line(&mut input)
        .map_err(|e| NoteDeckError::InvalidInput(e.to_string()))?;

    let auth = client.complete_auth(host, &session_id).await?;

    let account_id = uuid::Uuid::new_v4().to_string();
    let account = Account {
        id: account_id.clone(),
        host: host.to_string(),
        token: auth.token.clone(),
        user_id: auth.user.id.clone(),
        username: auth.user.username.clone(),
        display_name: auth.user.name.clone(),
        avatar_url: auth.user.avatar_url.clone(),
        software: "misskey".to_string(),
    };

    db.upsert_account(&account)?;

    // Store to keychain and verify before clearing DB (keyutils may lose keys across processes)
    // 再起動非永続な store (Linux keyutils) では DB フォールバックを消さない (notedeck#785)
    if crate::keychain::store_token(&account_id, &auth.token).is_ok()
        && crate::keychain::get_token(&account_id)
            .ok()
            .flatten()
            .is_some()
        && crate::keychain::is_persistent()
    {
        let _ = db.clear_token(&account_id);
    }

    match fmt {
        OutputFormat::Json | OutputFormat::Jsonl => {
            let public = AccountPublic::from(&account);
            println!("{}", serde_json::to_string(&public).unwrap());
        }
        OutputFormat::Ids => println!("{}", account_id),
        OutputFormat::Compact => {
            println!(
                "{}\t{}\t{}",
                theme::muted(&account_id),
                theme::user(&format!("@{}@{}", auth.user.username, host)),
                theme::name(auth.user.name.as_deref().unwrap_or(&auth.user.username))
            );
        }
        OutputFormat::Default => {
            println!(
                "{} {}",
                theme::success("Login successful:"),
                theme::user(&format!("@{}@{}", auth.user.username, host))
            );
        }
    }

    Ok(())
}

pub fn run_logout(
    db: &Database,
    account: &Account,
    fmt: OutputFormat,
) -> Result<(), NoteDeckError> {
    let username = account.username.clone();
    let host = account.host.clone();
    let id = account.id.clone();

    let _ = crate::keychain::delete_token(&id);
    db.delete_account(&id)?;

    print_action(
        fmt,
        &format!(r#"{{"loggedOut":"{id}","username":"{username}","host":"{host}"}}"#),
        &id,
        &format!("Logged out: @{username}@{host}"),
    );

    Ok(())
}
