//! notecore が正本を持つローカル情報の読取: AI セッション (単一書き手は
//! `ai_sessions.rs`) と principal の実効権限 (`permissions_profile.rs`)。

use serde_json::{json, Value};

use super::ExecContext;
use crate::ai_sessions::{self, AiSession};
use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::error::Result;
use crate::permissions_gate;
use crate::permissions_profile::PrincipalId;
use notecli::error::NoteDeckError;

fn sessions_sorted(core: &Core) -> Result<Vec<AiSession>> {
    let mut all = ai_sessions::load_all(&settings_base_dir(core)?)?;
    all.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(all)
}

/// `ai.sessions.list`: `[{ id, kind, title, updatedAt, messageCount }]` (updatedAt 降順)
pub fn ai_sessions_list(core: &Core) -> Result<Value> {
    Ok(Value::Array(
        sessions_sorted(core)?
            .iter()
            .map(|s| {
                json!({
                    "id": s.id,
                    "kind": s.kind,
                    "title": s.title,
                    "updatedAt": s.updated_at,
                    "messageCount": s.message_count,
                })
            })
            .collect(),
    ))
}

/// `ai.sessions.read`: `{ id, kind, title, messages: [{ role, content }] }`
pub fn ai_sessions_read(core: &Core, params: &Value) -> Result<Value> {
    let id = params
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| NoteDeckError::InvalidInput("ai.sessions.read: id is required".into()))?;
    let base = settings_base_dir(core)?;
    if !ai_sessions::exists(&base, id) {
        return Err(NoteDeckError::InvalidInput(format!(
            "ai.sessions.read: session \"{id}\" not found"
        )));
    }
    let s = ai_sessions::get(&base, id)?;
    Ok(json!({
        "id": s.id,
        "kind": s.kind,
        "title": s.title,
        "messages": s.messages.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect::<Vec<_>>(),
    }))
}

/// ヒット位置の前後 40 文字を切り出す (移設前と同じ。境界は文字単位)。
pub(crate) fn snippet(content: &str, needle_lower: &str) -> Option<String> {
    let lower = content.to_lowercase();
    let byte_idx = lower.find(needle_lower)?;
    let chars: Vec<char> = content.chars().collect();
    // 小文字化で長さが変わる文字があるので、位置は小文字側の文字数で取る
    let idx = lower[..byte_idx].chars().count().min(chars.len());
    let needle_len = needle_lower.chars().count();
    let start = idx.saturating_sub(40);
    let end = (idx + needle_len + 40).min(chars.len());
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(chars[start..end].iter());
    if end < chars.len() {
        out.push('…');
    }
    Some(out)
}

/// `ai.sessions.search`: `[{ id, title, snippet }]`
pub fn ai_sessions_search(core: &Core, params: &Value) -> Result<Value> {
    let query = params
        .get("query")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            NoteDeckError::InvalidInput("ai.sessions.search: query is required".into())
        })?;
    let limit = params
        .get("limit")
        .and_then(Value::as_f64)
        .filter(|n| *n > 0.0)
        .map(|n| n as usize)
        .unwrap_or(20);
    let needle = query.to_lowercase();
    let mut out = Vec::new();
    for s in sessions_sorted(core)? {
        if out.len() >= limit {
            break;
        }
        if let Some(snip) = s.messages.iter().find_map(|m| snippet(&m.content, &needle)) {
            out.push(json!({ "id": s.id, "title": s.title, "snippet": snip }));
        }
    }
    Ok(Value::Array(out))
}

/// `meta.permissions`: 呼び出し元 principal 自身の preset と実効 granted map。
/// `user` はプロファイル無し = 全キー true / preset null。
pub async fn meta_permissions(ctx: &ExecContext) -> Result<Value> {
    let kind = ctx.principal.as_str();
    let Some(id) = PrincipalId::parse(kind) else {
        if kind != "user" {
            return Err(NoteDeckError::InvalidInput(format!(
                "meta.permissions: unknown principal \"{kind}\""
            )));
        }
        let resolved: serde_json::Map<String, Value> = crate::permissions_profile::PERMISSION_KEYS
            .iter()
            .map(|k| ((*k).to_string(), Value::Bool(true)))
            .collect();
        return Ok(json!({ "principal": "user", "preset": Value::Null, "resolved": resolved }));
    };
    let (preset, granted) = permissions_gate::profile_for(id).await;
    let resolved: serde_json::Map<String, Value> = crate::permissions_profile::PERMISSION_KEYS
        .iter()
        .map(|k| ((*k).to_string(), Value::Bool(granted.contains(k))))
        .collect();
    Ok(json!({ "principal": kind, "preset": preset, "resolved": resolved }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippet_takes_forty_chars_around_the_hit_case_insensitively() {
        let text = format!("{}NoteDeck{}", "a".repeat(50), "b".repeat(50));
        let s = snippet(&text, "notedeck").unwrap();
        assert!(s.starts_with('…') && s.ends_with('…'));
        assert_eq!(s.chars().count(), 1 + 40 + 8 + 40 + 1);
        assert_eq!(snippet("短い本文", "本文").unwrap(), "短い本文");
        assert!(snippet("nothing", "x").is_none());
    }
}
