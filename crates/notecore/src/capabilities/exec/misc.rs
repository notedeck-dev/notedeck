//! 一覧系の読取: 通知 / アンテナ / チャンネル / ロール / リスト / クリップ / ドライブ。

use serde_json::{json, Value};

use super::{clamp_limit, param_str, project, require_str, resolve_account_id, ExecContext};
use crate::commands::{content, messaging, timeline};
use crate::context::Core;
use crate::error::Result;
use notecli::error::NoteDeckError;
use notecli::models::TimelineOptions;

/// `notifications.list`
pub async fn notifications(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let account_id = resolve_account_id(params, ctx)?;
    let limit = clamp_limit(params, 10, 100);
    let opts = TimelineOptions::new(
        limit as i64,
        None,
        param_str(params, "untilId").map(str::to_string),
    );
    let list = messaging::api_get_notifications(core, account_id, Some(opts)).await?;
    Ok(project::notifications(&list, limit as usize))
}

/// antenna / channel / role の notes の limit: 移設前は数値をそのまま通していた
/// (既定 20、丸めは API 側)。整数でない数は API に渡せないので入力エラー。
pub(crate) fn passthrough_limit(params: &Value, default: i64) -> Result<i64> {
    match params.get("limit") {
        Some(Value::Number(n)) => n
            .as_i64()
            .ok_or_else(|| NoteDeckError::InvalidInput("limit must be an integer".into())),
        _ => Ok(default),
    }
}

fn take(limit: i64) -> usize {
    limit.max(0) as usize
}

/// `antenna.list`
pub async fn antenna_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let account_id = resolve_account_id(params, ctx)?;
    Ok(serde_json::to_value(
        timeline::api_get_antennas(core, account_id).await?,
    )?)
}

/// `antenna.notes`
pub async fn antenna_notes(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let antenna_id = require_str(params, "antennaId", "antenna.notes")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = passthrough_limit(params, 20)?;
    let until_id = param_str(params, "untilId").map(str::to_string);
    let notes =
        timeline::api_get_antenna_notes(core, account_id, antenna_id, Some(limit), None, until_id)
            .await?;
    Ok(project::notes(&notes, take(limit)))
}

/// `channel.list`
pub async fn channel_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let account_id = resolve_account_id(params, ctx)?;
    Ok(serde_json::to_value(
        timeline::api_get_channels(core, account_id).await?,
    )?)
}

/// `channel.notes`
pub async fn channel_notes(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let channel_id = require_str(params, "channelId", "channel.notes")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = passthrough_limit(params, 20)?;
    let until_id = param_str(params, "untilId").map(str::to_string);
    let notes =
        timeline::api_get_channel_notes(core, account_id, channel_id, Some(limit), None, until_id)
            .await?;
    Ok(project::notes(&notes, take(limit)))
}

/// `role.notes`
pub async fn role_notes(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let role_id = require_str(params, "roleId", "role.notes")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = passthrough_limit(params, 20)?;
    let until_id = param_str(params, "untilId").map(str::to_string);
    let notes =
        timeline::api_get_role_notes(core, account_id, role_id, Some(limit), None, until_id)
            .await?;
    Ok(project::notes(&notes, take(limit)))
}

/// `list.list`
pub async fn list_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let account_id = resolve_account_id(params, ctx)?;
    Ok(serde_json::to_value(
        timeline::api_get_user_lists(core, account_id).await?,
    )?)
}

/// `clips.list`: `{ id, name, description, isPublic, lastClippedAt, favoritedCount }`
pub async fn clips_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let account_id = resolve_account_id(params, ctx)?;
    let clips = timeline::api_get_clips(core, account_id).await?;
    Ok(Value::Array(
        clips
            .iter()
            .map(|c| {
                json!({
                    "id": c.id,
                    "name": c.name,
                    "description": c.description,
                    "isPublic": c.is_public,
                    "lastClippedAt": c.last_clipped_at,
                    "favoritedCount": c.favorited_count,
                })
            })
            .collect(),
    ))
}

/// `clips.notes`
pub async fn clips_notes(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let clip_id = require_str(params, "clipId", "clips.notes")?.to_string();
    let account_id = resolve_account_id(params, ctx)?;
    let limit = clamp_limit(params, 20, 100);
    let notes =
        timeline::api_get_clip_notes(core, account_id, clip_id, Some(limit as i64), None, None)
            .await?;
    Ok(project::notes(&notes, limit as usize))
}

/// `drive.list`: 生の Misskey 応答をそのまま返す。
pub async fn drive_list(core: &Core, params: &Value, ctx: &ExecContext) -> Result<Value> {
    let account_id = resolve_account_id(params, ctx)?;
    let folder_id = param_str(params, "folderId").map(str::to_string);
    let file_type = param_str(params, "fileType").map(str::to_string);
    let limit = clamp_limit(params, 30, 100);
    content::api_get_drive_files(core, account_id, folder_id, Some(limit as i64), file_type).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_limit_defaults_and_rejects_floats() {
        assert_eq!(passthrough_limit(&json!({}), 20).unwrap(), 20);
        assert_eq!(passthrough_limit(&json!({"limit": 3}), 20).unwrap(), 3);
        assert!(passthrough_limit(&json!({"limit": 1.5}), 20).is_err());
        assert_eq!(take(-3), 0);
    }
}
