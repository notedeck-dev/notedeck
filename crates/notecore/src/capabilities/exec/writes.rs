//! 純データ系の書込 (Misskey API を 1 回叩いて結果を返すだけのもの)。
//! 引数の扱い・エラー文・結果の形は移設前の TS と同じ。

use regex::Regex;
use serde_json::{json, Value};
use std::sync::OnceLock;

use super::{param_str, project, require_str, resolve_account_id, ExecContext};
use crate::account_service;
use crate::commands::{clips, content, messaging, timeline, user};
use crate::context::Core;
use crate::error::Result;
use notecli::error::NoteDeckError;
use notecli::models::CreateNoteParams;

const VALID_VISIBILITIES: &[&str] = &["public", "home", "followers", "specified"];

/// `notes.create`
pub async fn notes_create(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let text = param_str(params, "text").map(str::to_string);
    let renote_id = param_str(params, "renoteId").map(str::to_string);
    if text.is_none() && renote_id.is_none() {
        return Err(NoteDeckError::InvalidInput(
            "notes.create: text is required (or supply renoteId for pure renote)".into(),
        ));
    }
    let visibility = param_str(params, "visibility").unwrap_or("public");
    if !VALID_VISIBILITIES.contains(&visibility) {
        return Err(NoteDeckError::InvalidInput(format!(
            "notes.create: invalid visibility \"{visibility}\". Valid: {}",
            VALID_VISIBILITIES.join(", ")
        )));
    }
    let account_id = resolve_account_id(params, ctx)?;
    let p = CreateNoteParams {
        text,
        cw: param_str(params, "cw").map(str::to_string),
        visibility: Some(visibility.to_string()),
        reply_id: param_str(params, "replyId").map(str::to_string),
        renote_id,
        ..Default::default()
    };
    let note = timeline::api_create_note(core, account_id, p, None).await?;
    Ok(project::note(&note))
}

fn note_target(params: &Value, ctx: &ExecContext, capability: &str) -> Result<(String, String)> {
    let note_id = require_str(params, "noteId", capability)?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    Ok((account_id, note_id))
}

pub async fn notes_delete(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let (account_id, note_id) = note_target(params, ctx, "notes.delete")?;
    timeline::api_delete_note(core, account_id, note_id.clone()).await?;
    Ok(json!({ "deleted": true, "noteId": note_id }))
}
pub async fn notes_pin(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let (account_id, note_id) = note_target(params, ctx, "notes.pin")?;
    timeline::api_pin_note(core, account_id, note_id.clone()).await?;
    Ok(json!({ "pinned": true, "noteId": note_id }))
}
pub async fn notes_unpin(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let (account_id, note_id) = note_target(params, ctx, "notes.unpin")?;
    timeline::api_unpin_note(core, account_id, note_id.clone()).await?;
    Ok(json!({ "unpinned": true, "noteId": note_id }))
}
pub async fn favorites_add(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let (account_id, note_id) = note_target(params, ctx, "favorites.add")?;
    timeline::api_create_favorite(core, account_id, note_id.clone()).await?;
    Ok(json!({ "favorited": true, "noteId": note_id }))
}
pub async fn favorites_remove(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let (account_id, note_id) = note_target(params, ctx, "favorites.remove")?;
    timeline::api_delete_favorite(core, account_id, note_id.clone()).await?;
    Ok(json!({ "unfavorited": true, "noteId": note_id }))
}

/// `notes.unreact`: `{ ok, noteId }`
pub async fn notes_unreact(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let note_id = require_str(params, "noteId", "notes.unreact")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    timeline::api_delete_reaction(core, account_id, note_id.clone()).await?;
    Ok(json!({ "ok": true, "noteId": note_id }))
}

/// カスタム絵文字リアクション `:name@host:` の解析。マッチしなければ Unicode 絵文字など。
fn custom_emoji_host(reaction: &str) -> Option<Option<String>> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^:([\w+-]+)(?:@([\w.-]+))?:$").expect("emoji regex"));
    let caps = re.captures(reaction)?;
    Some(caps.get(2).map(|m| m.as_str().to_string()))
}

/// リモート絵文字でのリアクションを受け付けるサーバーか (移設前と同じ規則:
/// misskey-tempura だけ。判定は nodeinfo の repository か software 名)。
fn accepts_remote_emoji_reactions(repository: Option<&str>, software_name: &str) -> bool {
    if let Some(repo) = repository {
        let r = repo.to_lowercase();
        if r.contains("github.com/lqvp/misskey-tempura") {
            return true;
        }
        if r.contains("github.com/") {
            // repository が分かるなら名前より優先する (他フォークは不可)
            return false;
        }
    }
    matches!(
        software_name.to_lowercase().as_str(),
        "misskey-tempura" | "tempura"
    )
}

/// リモート絵文字のリアクションが通るか (#630)。
pub(crate) fn reaction_joinable(
    reaction: &str,
    server_host: &str,
    remote_emoji_reactions: bool,
) -> bool {
    match custom_emoji_host(reaction) {
        None => true,
        Some(None) => true,
        Some(Some(host)) => {
            host == "." || host.eq_ignore_ascii_case(server_host) || remote_emoji_reactions
        }
    }
}

/// `notes.react`: `{ ok, noteId, reaction }`
pub async fn notes_react(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let note_id = require_str(params, "noteId", "notes.react")?.to_string();
    let reaction = require_str(params, "reaction", "notes.react")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    // リモート絵文字は受け付けるサーバー (tempura) 以外では弾く
    let accounts = core.blocking(account_service::list_public).await?;
    if let Some(host) = accounts
        .iter()
        .find(|a| a.id == account_id)
        .map(|a| a.host.clone())
    {
        let svc = core.server_info().await;
        let remote_ok = match svc.get_or_fetch(&host).await {
            Ok(d) => {
                accepts_remote_emoji_reactions(d.software_repository.as_deref(), &d.software_name)
            }
            Err(_) => false,
        };
        if !reaction_joinable(&reaction, &host, remote_ok) {
            return Err(NoteDeckError::InvalidInput(format!(
                "notes.react: {host} はリモートの絵文字でリアクションできません"
            )));
        }
    }
    timeline::api_create_reaction(core, account_id, note_id.clone(), reaction.clone()).await?;
    Ok(json!({ "ok": true, "noteId": note_id, "reaction": reaction }))
}

async fn chat_reaction(
    core: &Core,
    params: &Value,
    ctx: &ExecContext,
    capability: &str,
    add: bool,
) -> Result<Value> {
    let message_id = require_str(params, "messageId", capability)?.to_string();
    let reaction = require_str(params, "reaction", capability)?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    if add {
        messaging::api_react_chat_message(core, account_id, message_id.clone(), reaction.clone())
            .await?;
    } else {
        messaging::api_unreact_chat_message(core, account_id, message_id.clone(), reaction.clone())
            .await?;
    }
    Ok(json!({ "ok": true, "messageId": message_id, "reaction": reaction }))
}

pub async fn chat_react(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    chat_reaction(core, params, ctx, "chat.react", true).await
}
pub async fn chat_unreact(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    chat_reaction(core, params, ctx, "chat.unreact", false).await
}

/// `clips.create`: `{ id, name, isPublic, description }`
pub async fn clips_create(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let name = require_str(params, "name", "clips.create")?.to_string();
    let description = param_str(params, "description").map(str::to_string);
    let is_public = params.get("isPublic").and_then(Value::as_bool) == Some(true);
    let account_id = resolve_account_id(params, ctx)?;
    let clip = clips::api_create_clip(
        core,
        account_id,
        json!({ "name": name, "description": description, "isPublic": is_public }),
    )
    .await?;
    Ok(json!({
        "id": clip.id,
        "name": clip.name,
        "isPublic": clip.is_public,
        "description": clip.description,
    }))
}

async fn clip_note(
    core: &Core,
    params: &Value,
    ctx: &ExecContext,
    capability: &str,
    add: bool,
) -> Result<Value> {
    let clip_id = require_str(params, "clipId", capability)?.to_string();
    let note_id = require_str(params, "noteId", capability)?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    if add {
        timeline::api_add_note_to_clip(core, account_id, clip_id.clone(), note_id.clone()).await?;
    } else {
        timeline::api_remove_note_from_clip(core, account_id, clip_id.clone(), note_id.clone())
            .await?;
    }
    Ok(json!({ "ok": true, "clipId": clip_id, "noteId": note_id }))
}

pub async fn clips_add_note(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    clip_note(core, params, ctx, "clips.addNote", true).await
}
pub async fn clips_remove_note(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    clip_note(core, params, ctx, "clips.removeNote", false).await
}

async fn list_member(
    core: &Core,
    params: &Value,
    ctx: &ExecContext,
    capability: &str,
    add: bool,
) -> Result<Value> {
    let list_id = require_str(params, "listId", capability)?.to_string();
    let user_id = require_str(params, "userId", capability)?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    if add {
        user::api_add_user_to_list(core, account_id, list_id.clone(), user_id.clone()).await?;
        Ok(json!({ "added": true, "listId": list_id, "userId": user_id }))
    } else {
        user::api_remove_user_from_list(core, account_id, list_id.clone(), user_id.clone()).await?;
        Ok(json!({ "removed": true, "listId": list_id, "userId": user_id }))
    }
}

pub async fn list_add_user(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    list_member(core, params, ctx, "list.addUser", true).await
}
pub async fn list_remove_user(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    list_member(core, params, ctx, "list.removeUser", false).await
}

/// `userId` は空でなければそのまま (移設前は trim しない)。
pub(crate) fn user_id_of(params: &Value, capability: &str) -> Result<String> {
    params
        .get("userId")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| NoteDeckError::InvalidInput(format!("{capability}: userId is required")))
}

pub async fn user_follow(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let user_id = user_id_of(params, "user.follow")?;
    let account_id = resolve_account_id(params, ctx)?;
    user::api_follow_user(core, account_id, user_id.clone()).await?;
    Ok(json!({ "followed": true, "userId": user_id }))
}
pub async fn user_unfollow(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let user_id = user_id_of(params, "user.unfollow")?;
    let account_id = resolve_account_id(params, ctx)?;
    user::api_unfollow_user(core, account_id, user_id.clone()).await?;
    Ok(json!({ "unfollowed": true, "userId": user_id }))
}

/// `notifications.markRead`: accountId 指定ならそのアカウント、無ければトークンを
/// 持つ全アカウント (呼び出し文脈のアカウントは見ない。移設前と同じ)。
/// アカウントごとに試み、失敗は warn に残して続ける。
pub async fn notifications_mark_read(core: &Core, params: &Value) -> Result<Value> {
    let targets: Vec<String> = match param_str(params, "accountId") {
        Some(id) => vec![id.to_string()],
        None => core
            .blocking(account_service::list_public)
            .await?
            .into_iter()
            .filter(|a| a.has_token)
            .map(|a| a.id)
            .collect(),
    };
    let mut marked = 0u32;
    for id in targets {
        match messaging::api_mark_all_notifications_as_read(core, id.clone()).await {
            Ok(()) => marked += 1,
            Err(e) => tracing::warn!(account_id = id, "notifications.markRead failed: {e}"),
        }
    }
    Ok(json!({ "markedAccounts": marked }))
}

/// registry の scope (`["client", "misskey"]`)。移設前と同じ検査。
pub(crate) fn pick_scope(params: &Value) -> Result<Vec<String>> {
    let arr = params
        .get("scope")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            NoteDeckError::InvalidInput(
                "registry: scope must be a string array (e.g. [\"client\"])".into(),
            )
        })?;
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        match v.as_str() {
            Some(s) if !s.is_empty() => out.push(s.to_string()),
            _ => {
                return Err(NoteDeckError::InvalidInput(
                    "registry: scope entries must be non-empty strings".into(),
                ))
            }
        }
    }
    Ok(out)
}

pub async fn registry_set(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let scope = pick_scope(params)?;
    let key = require_str(params, "key", "registry.set")?.to_string();
    let value = params.get("value").cloned().ok_or_else(|| {
        NoteDeckError::InvalidInput(
            "registry.set: value is required (null も可、未指定不可)".into(),
        )
    })?;
    let account_id = resolve_account_id(params, ctx)?;
    content::api_set_registry_value(core, account_id, scope.clone(), key.clone(), value).await?;
    Ok(json!({ "ok": true, "scope": scope, "key": key }))
}

pub async fn registry_delete(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let scope = pick_scope(params)?;
    let key = require_str(params, "key", "registry.delete")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    content::api_delete_registry_value(core, account_id, scope.clone(), key.clone()).await?;
    Ok(json!({ "deleted": true, "scope": scope, "key": key }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_emoji_reactions_follow_the_ts_rules() {
        // Unicode / ローカル絵文字は常に可
        assert!(reaction_joinable("👍", "example.com", false));
        assert!(reaction_joinable(":blob:", "example.com", false));
        assert!(reaction_joinable(":blob@.:", "example.com", false));
        assert!(reaction_joinable(
            ":blob@Example.COM:",
            "example.com",
            false
        ));
        // リモートは受け付けるサーバーだけ
        assert!(!reaction_joinable(
            ":blob@other.example:",
            "example.com",
            false
        ));
        assert!(reaction_joinable(
            ":blob@other.example:",
            "example.com",
            true
        ));
        assert!(accepts_remote_emoji_reactions(
            Some("https://github.com/lqvp/misskey-tempura"),
            "misskey"
        ));
        assert!(!accepts_remote_emoji_reactions(
            Some("https://github.com/misskey-dev/misskey"),
            "tempura"
        ));
        assert!(accepts_remote_emoji_reactions(None, "misskey-tempura"));
        assert!(!accepts_remote_emoji_reactions(None, "misskey"));
    }

    #[test]
    fn registry_scope_and_user_id_validation() {
        assert_eq!(
            pick_scope(&json!({"scope": ["client", "misskey"]})).unwrap(),
            vec!["client", "misskey"]
        );
        assert!(pick_scope(&json!({"scope": "client"}))
            .unwrap_err()
            .to_string()
            .contains("string array"));
        assert!(pick_scope(&json!({"scope": ["", "x"]}))
            .unwrap_err()
            .to_string()
            .contains("non-empty"));
        assert_eq!(
            user_id_of(&json!({"userId": " u "}), "user.follow").unwrap(),
            " u "
        );
        assert!(user_id_of(&json!({"userId": ""}), "user.follow").is_err());
    }
}
