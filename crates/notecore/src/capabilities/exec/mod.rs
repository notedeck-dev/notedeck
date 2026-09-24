//! `exec: core` な capability の本体 (#1133 縦切り 4)。
//!
//! 宣言表で `exec: 'core'` を持つ capability は notecore 単独で実行できる
//! (Misskey API とローカル DB だけで完結し、デバイスの状態を見ない)。本体は
//! ここに 1 実装だけ置き、AI のターン実行器はデバイスに投げずに直接呼び、
//! 本人操作 (パレット / slash / HTTP API) もデバイスの dispatcher から RPC
//! (`capability_execute`) でここを叩く。デバイス側の builtins は委譲だけを持つ。
//!
//! 引数の扱いと結果の形は、移設前の TS 実装と同じにする (AI に見える tool の
//! 挙動を変えない)。認可はここでは見ない (AI は ターン実行器、本人操作は
//! デバイスの dispatcher が済ませている)。

mod account;
mod misc;
mod notes;
mod project;
mod time;
mod user;

use serde_json::Value;

use crate::context::Core;
use crate::error::Result;
use notecli::error::NoteDeckError;

/// 実行の文脈。
#[derive(Debug, Clone, Default)]
pub struct ExecContext {
    /// `ai.chat` / `ai.heartbeat` / `user` / `plugin` / `external`
    pub principal: String,
    /// 呼び出し文脈のアカウント (per-account の AI カラムなど)。無ければ
    /// capability は `params.accountId` を必須にする (#941)
    pub account_id: Option<String>,
}

/// 引数の `accountId` → 文脈のアカウント、の順で解決する (#941)。
pub fn resolve_account_id(params: &Value, ctx: &ExecContext) -> Result<String> {
    if let Some(id) = params
        .get("accountId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Ok(id.to_string());
    }
    ctx.account_id
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            NoteDeckError::InvalidInput(
                "accountId が必要です (呼び出し文脈にアカウントが無いので、account.list から選んで渡してください)".into(),
            )
        })
}

pub fn param_str<'a>(params: &'a Value, name: &str) -> Option<&'a str> {
    params
        .get(name)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

pub fn require_str<'a>(params: &'a Value, name: &str, capability: &str) -> Result<&'a str> {
    param_str(params, name)
        .ok_or_else(|| NoteDeckError::InvalidInput(format!("{capability}: {name} is required")))
}

/// `limit` を [1, max] に丸める (未指定は default)。
pub fn clamp_limit(params: &Value, default: u32, max: u32) -> u32 {
    match params.get("limit").and_then(Value::as_f64) {
        Some(n) if n.is_finite() => (n.floor() as i64).clamp(1, max as i64) as u32,
        _ => default,
    }
}

/// core で実行できる capability か (宣言表の `exec`)。
pub fn is_core(id: &str) -> bool {
    super::find(id)
        .map(|d| d.exec == super::Exec::Core)
        .unwrap_or(false)
}

/// capability を notecore で実行する。宣言表に無い / core でない id はエラー。
pub async fn execute(core: &Core, id: &str, params: Value, ctx: &ExecContext) -> Result<Value> {
    if !is_core(id) {
        return Err(NoteDeckError::InvalidInput(format!(
            "{id} は notecore では実行できません (exec が core ではない)"
        )));
    }
    let p = &params;
    match id {
        "time.now" => time::now(),
        "account.list" => account::list(core).await,
        "account.current" => account::current(core, ctx).await,
        "notes.show" => notes::show(core, p, ctx).await,
        "notes.children" => notes::children(core, p, ctx).await,
        "notes.search" => notes::search(core, p, ctx).await,
        "notes.timeline" => notes::timeline_notes(core, p, ctx).await,
        "notes.user" => notes::user_notes(core, p, ctx).await,
        "notes.searchArchive" => notes::search_archive(core, p).await,
        "user.lookup" => user::lookup(core, p, ctx).await,
        "user.search" => user::search(core, p, ctx).await,
        "user.followers" => user::followers(core, p, ctx).await,
        "user.following" => user::following(core, p, ctx).await,
        "notifications.list" => misc::notifications(core, p, ctx).await,
        "antenna.list" => misc::antenna_list(core, p, ctx).await,
        "antenna.notes" => misc::antenna_notes(core, p, ctx).await,
        "channel.list" => misc::channel_list(core, p, ctx).await,
        "channel.notes" => misc::channel_notes(core, p, ctx).await,
        "role.notes" => misc::role_notes(core, p, ctx).await,
        "list.list" => misc::list_list(core, p, ctx).await,
        "clips.list" => misc::clips_list(core, p, ctx).await,
        "clips.notes" => misc::clips_notes(core, p, ctx).await,
        "drive.list" => misc::drive_list(core, p, ctx).await,
        other => Err(NoteDeckError::Internal(format!(
            "exec: core と宣言されているが本体が無い: {other}"
        ))),
    }
}

/// 本体を持つ id の一覧 (テストで宣言表と突き合わせる)。`execute` の match と
/// 同じ順で保つ。
#[cfg(test)]
const HAS_BODY: &[&str] = &[
    "time.now",
    "account.list",
    "account.current",
    "notes.show",
    "notes.children",
    "notes.search",
    "notes.timeline",
    "notes.user",
    "notes.searchArchive",
    "user.lookup",
    "user.search",
    "user.followers",
    "user.following",
    "notifications.list",
    "antenna.list",
    "antenna.notes",
    "channel.list",
    "channel.notes",
    "role.notes",
    "list.list",
    "clips.list",
    "clips.notes",
    "drive.list",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_core_declaration_has_a_body() {
        // 宣言表で core と言っているのに execute が到達しない id を作らない
        for d in super::super::CAPABILITIES {
            if d.exec != super::super::Exec::Core {
                continue;
            }
            assert!(
                HAS_BODY.contains(&d.id),
                "{}: exec: core だが本体の一覧に無い",
                d.id
            );
        }
        for id in HAS_BODY {
            assert!(is_core(id), "{id}: 本体はあるが宣言が core ではない");
        }
    }

    #[test]
    fn resolve_account_id_prefers_params_then_context() {
        let ctx = ExecContext {
            principal: "ai.chat".into(),
            account_id: Some("ctx".into()),
        };
        assert_eq!(
            resolve_account_id(&serde_json::json!({"accountId": " p "}), &ctx).unwrap(),
            "p"
        );
        assert_eq!(
            resolve_account_id(&serde_json::json!({"accountId": ""}), &ctx).unwrap(),
            "ctx"
        );
        let none = ExecContext::default();
        assert!(resolve_account_id(&serde_json::json!({}), &none).is_err());
    }

    #[test]
    fn clamp_limit_bounds() {
        assert_eq!(clamp_limit(&serde_json::json!({}), 20, 50), 20);
        assert_eq!(clamp_limit(&serde_json::json!({"limit": 999}), 20, 50), 50);
        assert_eq!(clamp_limit(&serde_json::json!({"limit": 0}), 20, 50), 1);
        assert_eq!(clamp_limit(&serde_json::json!({"limit": "x"}), 20, 50), 20);
    }
}
