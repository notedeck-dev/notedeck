use tauri::State;
use zeroize::Zeroize;

use notecli::error::NoteDeckError;
use notecli::keychain;
use notecli::models::{Account, AccountPublic, AuthSession};

use super::{export_account_list, validate_host, AppState, AuthSessionTracker, Result};

#[tauri::command]
#[specta::specta]
pub async fn auth_start(
    tracker: State<'_, AuthSessionTracker>,
    host: String,
    permissions: Option<Vec<String>>,
) -> Result<AuthSession> {
    let host = validate_host(&host)?;
    let session_id = uuid::Uuid::new_v4().to_string();
    let perms = permissions.unwrap_or_else(|| {
        vec![
            "read:account",
            "write:account",
            "read:notifications",
            "read:reactions",
            "read:favorites",
            "read:drive",
            "write:drive",
            "write:favorites",
            "read:following",
            "write:following",
            "read:mutes",
            "write:mutes",
            "read:blocks",
            "write:blocks",
            "write:notes",
            "write:reactions",
            "write:votes",
            "read:channels",
            "write:channels",
            "read:chat",
            "write:chat",
            "read:flash",
            "read:flash-likes",
            "write:flash-likes",
            "read:pages",
            "read:page-likes",
            "write:page-likes",
            "read:gallery",
            "read:gallery-likes",
            "write:gallery-likes",
            "read:federation",
        ]
        .into_iter()
        .map(String::from)
        .collect()
    });
    for perm in &perms {
        if !perm
            .chars()
            .all(|c| c.is_alphanumeric() || c == ':' || c == '-')
            || perm.len() > 50
        {
            return Err(NoteDeckError::InvalidInput(format!(
                "Invalid permission: {perm}"
            )));
        }
    }
    let permission_str = perms.join(",");
    let url = format!(
        "https://{host}/miauth/{session_id}?name=notedeck&icon=https%3A%2F%2Fraw.githubusercontent.com%2Fhitalin%2Fnotedeck%2Fmain%2Fsrc-tauri%2Ficons%2F128x128.png&permission={permission_str}"
    );
    tracker.register(&session_id, &host);
    Ok(AuthSession {
        session_id,
        url,
        host,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn auth_complete_and_save(
    app: tauri::AppHandle,
    tracker: State<'_, AuthSessionTracker>,
    app_state: State<'_, AppState>,
    session: AuthSession,
    software: String,
) -> Result<AccountPublic> {
    let (db, client) = app_state.ready().await;

    // Validate this session was created by auth_start and hasn't been replayed
    tracker.consume(&session.session_id, &session.host)?;

    let auth_result = client
        .complete_auth(&session.host, &session.session_id)
        .await?;

    let mut token = auth_result.token;

    // DB にはトークン込みで保存（キーチェーンのフォールバック）
    let account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        host: session.host.clone(),
        token: token.clone(),
        user_id: auth_result.user.id.clone(),
        username: auth_result.user.username.clone(),
        display_name: auth_result.user.name.clone(),
        avatar_url: auth_result.user.avatar_url.clone(),
        software,
    };

    db.upsert_account(&account)?;

    // Re-auth の場合、DB 上の id は既存のものが維持されるので正しい id を返す
    let saved = db
        .get_account_by_host_user(&session.host, &auth_result.user.id)?
        .ok_or_else(|| NoteDeckError::Auth("Failed to save account".to_string()))?;

    // キーチェーンに保存し、読み戻せたら DB のトークンをクリア
    if keychain::store_token(&saved.id, &token).is_ok()
        && keychain::get_token(&saved.id).ok().flatten().is_some()
    {
        let _ = db.clear_token(&saved.id);
    }
    token.zeroize();

    export_account_list(&app, &db);

    Ok(AccountPublic::new(&saved, true))
    // account, saved が drop → token が zeroize される
}
