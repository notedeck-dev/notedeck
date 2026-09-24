//! ノート系の読取 (`notes.*`)。引数の扱いは移設前の TS と同じ。

use serde_json::{json, Value};

use super::{clamp_limit, param_str, project, require_str, resolve_account_id, ExecContext};
use crate::account_service;
use crate::commands::{timeline, user};
use crate::context::Core;
use crate::error::Result;
use notecli::error::NoteDeckError;
use notecli::models::{SearchOptions, TimelineOptions};

const DEFAULT_LIMIT: u32 = 10;
const MAX_LIMIT: u32 = 100;
const VALID_TIMELINE_TYPES: &[&str] = &["home", "local", "social", "global"];

fn until_id(params: &Value) -> Option<String> {
    param_str(params, "untilId").map(str::to_string)
}

/// はなみすきーは検索エンドポイントが違う (TS の adapter 選択と同じ判定:
/// nodeinfo の repository が hanamisskey/misskey)。
async fn is_hanamisskey(core: &Core, account_id: &str) -> bool {
    let Ok(accounts) = core.blocking(account_service::list_public).await else {
        return false;
    };
    let Some(host) = accounts
        .iter()
        .find(|a| a.id == account_id)
        .map(|a| a.host.clone())
    else {
        return false;
    };
    let svc = core.server_info().await;
    match svc.get_or_fetch(&host).await {
        Ok(d) => d
            .software_repository
            .as_deref()
            .map(|r| r.to_lowercase().contains("github.com/hanamisskey/misskey"))
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// `notes.search`
pub async fn search(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let query = require_str(params, "query", "notes.search")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = clamp_limit(params, DEFAULT_LIMIT, MAX_LIMIT);
    let mut opts = SearchOptions::new(limit as i64);
    opts.until_id = until_id(params);
    let notes = if is_hanamisskey(core, &account_id).await {
        timeline::api_search_notes_hanami(core, account_id, query, Some(opts)).await?
    } else {
        timeline::api_search_notes(core, account_id, query, Some(opts)).await?
    };
    Ok(project::notes(&notes, limit as usize))
}

/// `notes.searchArchive` の引数 (アカウント文脈を使わない)。
pub(crate) struct ArchiveArgs {
    pub account_ids: Vec<String>,
    pub query: String,
    pub limit: u32,
    pub since: Option<String>,
    pub until: Option<String>,
    pub author: Option<String>,
    pub has_files: Option<bool>,
    pub public_only: bool,
}

pub(crate) fn archive_args(params: &Value, known: &[String]) -> ArchiveArgs {
    let account_ids = match params.get("accountIds").and_then(Value::as_array) {
        Some(requested) => requested
            .iter()
            .filter_map(Value::as_str)
            .filter(|id| known.iter().any(|k| k == id))
            .map(str::to_string)
            .collect(),
        None => known.to_vec(),
    };
    ArchiveArgs {
        account_ids,
        query: param_str(params, "query").unwrap_or("").to_string(),
        limit: clamp_limit(params, DEFAULT_LIMIT, MAX_LIMIT),
        since: param_str(params, "since").map(str::to_string),
        until: param_str(params, "until").map(str::to_string),
        author: param_str(params, "author").map(str::to_string),
        has_files: params.get("hasFiles").and_then(Value::as_bool),
        public_only: params.get("includePrivate").and_then(Value::as_bool) != Some(true),
    }
}

/// `notes.searchArchive`: 手元の索引の横断検索 (#947)。
pub async fn search_archive(core: &Core, params: &Value) -> Result<Value> {
    let known: Vec<String> = core
        .blocking(account_service::list_public)
        .await?
        .into_iter()
        .map(|a| a.id)
        .collect();
    let a = archive_args(params, &known);
    if a.account_ids.is_empty() {
        return Ok(Value::Array(Vec::new()));
    }
    let notes = timeline::api_search_notes_cached_across(
        core,
        a.account_ids,
        a.query,
        Some(a.limit as i64),
        a.since,
        a.until,
        Some(false),
        a.author,
        a.has_files,
        Some(a.public_only),
    )
    .await?;
    let rows = notes
        .iter()
        .take(a.limit as usize)
        .map(|n| {
            let mut row = project::note(n);
            if let Value::Object(m) = &mut row {
                m.insert("accountId".into(), json!(n.account_id));
                m.insert("serverHost".into(), json!(n.server_host));
            }
            row
        })
        .collect();
    Ok(Value::Array(rows))
}

pub(crate) fn timeline_type(params: &Value) -> Result<String> {
    let t = params.get("type").and_then(Value::as_str).unwrap_or("");
    if !VALID_TIMELINE_TYPES.contains(&t) {
        return Err(NoteDeckError::InvalidInput(format!(
            "notes.timeline: invalid type \"{t}\". Valid: {}",
            VALID_TIMELINE_TYPES.join(", ")
        )));
    }
    Ok(t.to_string())
}

/// `notes.timeline`
pub async fn timeline_notes(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let kind = timeline_type(params)?;
    let account_id = resolve_account_id(params, ctx)?;
    let limit = clamp_limit(params, DEFAULT_LIMIT, MAX_LIMIT);
    let opts = TimelineOptions::new(limit as i64, None, until_id(params));
    let notes = timeline::api_get_timeline(core, account_id, kind, Some(opts)).await?;
    Ok(project::notes(&notes, limit as usize))
}

/// `notes.user`
pub async fn user_notes(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let user_id = require_str(params, "userId", "notes.user")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = clamp_limit(params, DEFAULT_LIMIT, MAX_LIMIT);
    let opts = TimelineOptions::new(limit as i64, None, until_id(params));
    let notes = user::api_get_user_notes(core, account_id, user_id, Some(opts)).await?;
    Ok(project::notes(&notes, limit as usize))
}

/// `notes.show`
pub async fn show(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let note_id = require_str(params, "noteId", "notes.show")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let note = timeline::api_get_note(core, account_id, note_id).await?;
    Ok(project::note(&note))
}

/// `notes.children` (`untilId` は移設前から使われていない)
pub async fn children(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let note_id = require_str(params, "noteId", "notes.children")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = clamp_limit(params, DEFAULT_LIMIT, MAX_LIMIT);
    let notes = timeline::api_get_note_children(core, account_id, note_id, Some(limit)).await?;
    Ok(project::notes(&notes, limit as usize))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_type_is_validated() {
        assert_eq!(timeline_type(&json!({"type": "home"})).unwrap(), "home");
        let err = timeline_type(&json!({"type": "nope"}))
            .unwrap_err()
            .to_string();
        assert!(err.contains("invalid type \"nope\""), "{err}");
        assert!(timeline_type(&json!({})).is_err());
    }

    #[test]
    fn archive_args_filter_unknown_accounts_and_default_to_public() {
        let known = vec!["a".to_string(), "b".to_string()];
        let a = archive_args(
            &json!({"accountIds": ["a", "zz", 1], "query": " q "}),
            &known,
        );
        assert_eq!(a.account_ids, vec!["a"]);
        assert_eq!(a.query, "q");
        assert!(a.public_only);
        assert_eq!(a.limit, DEFAULT_LIMIT);
        let all = archive_args(
            &json!({"includePrivate": true, "hasFiles": false, "limit": 500}),
            &known,
        );
        assert_eq!(all.account_ids, known);
        assert!(!all.public_only);
        assert_eq!(all.has_files, Some(false));
        assert_eq!(all.limit, MAX_LIMIT);
        let none = archive_args(&json!({"accountIds": []}), &known);
        assert!(none.account_ids.is_empty());
    }

    #[test]
    fn required_params_error_like_ts() {
        assert!(require_str(&json!({"noteId": " "}), "noteId", "notes.show")
            .unwrap_err()
            .to_string()
            .contains("notes.show: noteId is required"));
        assert!(require_str(&json!({}), "query", "notes.search").is_err());
    }
}
