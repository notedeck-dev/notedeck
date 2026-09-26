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
mod keybinds;
mod memos;
mod meta;
mod misc;
mod misstore;
mod navbar;
mod net;
mod notes;
mod performance;
mod persona;
mod plugins;
pub(crate) mod preview;
mod project;
mod queries;
mod server;
mod skills;
mod staged;
mod styles;
mod themes;
mod time;
mod user;
mod widgets;
mod writes;

pub use time::iso_from_unix_ms;

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
    /// 呼び出し元のセッションが tainted (他人の内容を読んだ後) か (#1103)。
    /// 書込にラベルを付けるのに使う
    pub tainted: bool,
    /// principal が plugin のときの id (編集履歴の帰属に残す)
    pub plugin_id: Option<String>,
}

/// 実行結果。`tainted` は「ラベル付きの内容を返した」の申告 (呼び出し元の
/// セッションを tainted にする)。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutcome {
    pub value: Value,
    pub tainted: bool,
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
                "accountId is required (the calling context has no account; pick one from account.list and pass it)".into(),
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

/// 確認ダイアログに出す内容 (デバイスの `ConfirmOptions` と同じ JSON: title /
/// message / code / codeLanguage / diff / type / okLabel / cancelLabel /
/// rememberLabel)。None = この引数なら確認は要らない (no-op)。帰属 / 理由 /
/// クロスアカウントの行はデバイスの dispatcher が足す。
pub async fn preview(
    core: &Core,
    id: &str,
    params: Value,
    ctx: &ExecContext,
) -> Result<Option<Value>> {
    if !is_core(id) {
        return Err(NoteDeckError::InvalidInput(format!(
            "{id} cannot run in notecore (its exec is not core)"
        )));
    }
    let _ = (core, ctx);
    let Some(decl) = super::find(id) else {
        return Ok(None);
    };
    if !decl.confirm {
        return Ok(None);
    }
    if id.starts_with("skills.") {
        return skills::preview(core, id, &params, ctx).await;
    }
    if id.starts_with("memos.") {
        if let Some(v) = memos::preview(core, id, &params, ctx)? {
            return Ok(Some(v));
        }
    }
    if id.starts_with("theme.") {
        return themes::preview(core, id, &params, ctx).await;
    }
    if id.starts_with("styles.") {
        return styles::preview(core, id, &params, ctx);
    }
    if id.starts_with("plugins.") {
        return plugins::preview(core, id, &params, ctx).await;
    }
    if id.starts_with("widgets.") {
        return widgets::preview(core, id, &params, ctx).await;
    }
    if id.starts_with("queries.") {
        return queries::preview(core, id, &params, ctx);
    }
    if id.starts_with("keybinds.") {
        return Ok(keybinds::preview(id, &params, ctx));
    }
    if id.starts_with("navbar.") {
        return Ok(navbar::preview(id, &params, ctx));
    }
    if id.starts_with("performance.") {
        return Ok(performance::preview(id, &params, ctx));
    }
    if id == "ai.setPersona" {
        return persona::preview(core, id, &params, ctx);
    }
    Ok(Some(
        preview::custom(id, &params).unwrap_or_else(|| preview::generic(id, &params)),
    ))
}

/// capability を notecore で実行する。宣言表に無い / core でない id はエラー。
pub async fn execute(
    core: &Core,
    id: &str,
    params: Value,
    ctx: &ExecContext,
) -> Result<ExecOutcome> {
    let read_with_taint = match id {
        "skills.read" => Some(skills::read(core, &params)?),
        "memos.list" => Some(memos::list(core, &params)?),
        "memos.search" => Some(memos::search(core, &params)?),
        "memos.backlinks" => Some(memos::backlinks(core, &params)?),
        _ => None,
    };
    if let Some((value, tainted)) = read_with_taint {
        return Ok(ExecOutcome { value, tainted });
    }
    let value = execute_value(core, id, params, ctx).await?;
    Ok(ExecOutcome {
        value,
        tainted: false,
    })
}

async fn execute_value(core: &Core, id: &str, params: Value, ctx: &ExecContext) -> Result<Value> {
    if !is_core(id) {
        return Err(NoteDeckError::InvalidInput(format!(
            "{id} cannot run in notecore (its exec is not core)"
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
        // --- 書込 (縦切り 4 第 2 弾) ---
        "notes.create" => writes::notes_create(core, p, ctx).await,
        "notes.delete" => writes::notes_delete(core, p, ctx).await,
        "notes.pin" => writes::notes_pin(core, p, ctx).await,
        "notes.unpin" => writes::notes_unpin(core, p, ctx).await,
        "notes.react" => writes::notes_react(core, p, ctx).await,
        "notes.unreact" => writes::notes_unreact(core, p, ctx).await,
        "chat.react" => writes::chat_react(core, p, ctx).await,
        "chat.unreact" => writes::chat_unreact(core, p, ctx).await,
        "favorites.add" => writes::favorites_add(core, p, ctx).await,
        "favorites.remove" => writes::favorites_remove(core, p, ctx).await,
        "clips.create" => writes::clips_create(core, p, ctx).await,
        "clips.addNote" => writes::clips_add_note(core, p, ctx).await,
        "clips.removeNote" => writes::clips_remove_note(core, p, ctx).await,
        "list.addUser" => writes::list_add_user(core, p, ctx).await,
        "list.removeUser" => writes::list_remove_user(core, p, ctx).await,
        "user.follow" => writes::user_follow(core, p, ctx).await,
        "user.unfollow" => writes::user_unfollow(core, p, ctx).await,
        "notifications.markRead" => writes::notifications_mark_read(core, p).await,
        "registry.set" => writes::registry_set(core, p, ctx).await,
        "registry.delete" => writes::registry_delete(core, p, ctx).await,
        // --- サーバー側データの読取 ---
        "registry.get" => server::registry_get(core, p, ctx).await,
        "registry.listKeys" => server::registry_list_keys(core, p, ctx).await,
        "announcements.list" => server::announcements_list(core, p, ctx).await,
        "pages.list" => server::pages_list(core, p, ctx).await,
        "pages.show" => server::pages_show(core, p, ctx).await,
        "flash.list" => server::flash_list(core, p, ctx).await,
        "flash.show" => server::flash_show(core, p, ctx).await,
        "gallery.list" => server::gallery_list(core, p, ctx).await,
        "federation.chart" => server::federation_chart(core, p, ctx).await,
        "federation.instance" => server::federation_instance(core, p, ctx).await,
        "federation.instances" => server::federation_instances(core, p, ctx).await,
        // --- notecore が正本を持つローカル情報 ---
        "ai.sessions.list" => meta::ai_sessions_list(core),
        "ai.sessions.read" => meta::ai_sessions_read(core, p),
        "ai.sessions.search" => meta::ai_sessions_search(core, p),
        "meta.permissions" => meta::meta_permissions(ctx).await,
        // --- skill (本体は crate::skills、書込は変更通知つき) ---
        "skills.list" => skills::list(core),
        "skills.history" => skills::history(core, p),
        "skills.create" => skills::create(core, p, ctx),
        "skills.append" => skills::append(core, p, ctx),
        "skills.replaceSection" => skills::replace_section(core, p, ctx),
        "skills.toggle" => skills::toggle(core, p),
        "skills.revert" => skills::revert(core, p, ctx),
        "skills.install" => skills::install(core, p).await,
        "skills.uninstall" => skills::uninstall(core, p),
        // --- メモ (本体は crate::memos) ---
        "memos.create" => memos::create(core, p, ctx).await,
        "memos.update" => memos::update(core, p, ctx).await,
        "memos.delete" => memos::delete(core, p),
        "memos.revert" => memos::revert(core, p, ctx),
        // --- テーマ / カスタム CSS (本体は crate::themes) ---
        "theme.list" => themes::list(core),
        "theme.read" => themes::read(core, p),
        "theme.history" => themes::history(core, p),
        "theme.create" => themes::create(core, p, ctx).await,
        "theme.update" => themes::update(core, p, ctx),
        "theme.revert" => themes::revert(core, p, ctx),
        "theme.install" => themes::install(core, p, ctx).await,
        "theme.uninstall" => themes::uninstall(core, p),
        "styles.read" => styles::read(core),
        "styles.history" => styles::history(core),
        "styles.write" => styles::write(core, p, ctx),
        "styles.append" => styles::append(core, p, ctx),
        "styles.revert" => styles::revert(core, p, ctx),
        "plugins.list" => plugins::list(core),
        "plugins.read" => plugins::read(core, p),
        "plugins.history" => plugins::history(core, p),
        "plugins.setActive" => plugins::set_active(core, p),
        "plugins.delete" => plugins::delete(core, p),
        "plugins.revert" => plugins::revert(core, p, ctx),
        "plugins.install" => plugins::install(core, p, ctx).await,
        "plugins.uninstall" => plugins::uninstall(core, p),
        "widgets.list" => widgets::list(core).await,
        "widgets.read" => widgets::read(core, p),
        "widgets.history" => widgets::history(core, p),
        "widgets.setAutoRun" => widgets::set_auto_run(core, p),
        "widgets.delete" => widgets::delete(core, p),
        "widgets.revert" => widgets::revert(core, p, ctx),
        "widgets.install" => widgets::install(core, p, ctx).await,
        "widgets.uninstall" => widgets::uninstall(core, p),
        "queries.history" => queries::history(core, p),
        "queries.revert" => queries::revert(core, p, ctx),
        "keybinds.list" => keybinds::list(core),
        "keybinds.set" => keybinds::set(core, p),
        "keybinds.reset" => keybinds::reset(core, p),
        "keybinds.resetAll" => keybinds::reset_all(core),
        "navbar.list" => navbar::list(core),
        "navbar.reset" => navbar::reset(core),
        "performance.list" => performance::list(core),
        "performance.set" => performance::set(core, p),
        "performance.reset" => performance::reset(core, p),
        "performance.resetAll" => performance::reset_all(core),
        "performance.applySlider" => performance::apply_slider(core, p),
        "ai.listPersonas" => persona::list_personas(core),
        "ai.setPersona" => persona::set_persona(core, p),
        "meta.persona" => persona::meta_persona(core),
        "meta.activeSkills" => persona::meta_active_skills(core),
        "meta.config" => persona::meta_config(core),
        "meta.heartbeat" => persona::meta_heartbeat(core).await,
        // --- HEARTBEAT の応答契約 ---
        "heartbeat.report" => crate::heartbeat::report_tool(p, ctx),
        // --- 外部ネットワーク ---
        "http.fetch" => net::http_fetch(core, p).await,
        "misstore.search" => net::misstore_search(core, p).await,
        other => Err(NoteDeckError::Internal(format!(
            "declared as exec: core but has no implementation: {other}"
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
    "notes.create",
    "notes.delete",
    "notes.pin",
    "notes.unpin",
    "notes.react",
    "notes.unreact",
    "chat.react",
    "chat.unreact",
    "favorites.add",
    "favorites.remove",
    "clips.create",
    "clips.addNote",
    "clips.removeNote",
    "list.addUser",
    "list.removeUser",
    "user.follow",
    "user.unfollow",
    "notifications.markRead",
    "registry.set",
    "registry.delete",
    "registry.get",
    "registry.listKeys",
    "announcements.list",
    "pages.list",
    "pages.show",
    "flash.list",
    "flash.show",
    "gallery.list",
    "federation.chart",
    "federation.instance",
    "federation.instances",
    "http.fetch",
    "misstore.search",
    "ai.sessions.list",
    "ai.sessions.read",
    "ai.sessions.search",
    "meta.permissions",
    "skills.list",
    "skills.read",
    "skills.history",
    "skills.create",
    "skills.append",
    "skills.replaceSection",
    "skills.toggle",
    "skills.revert",
    "skills.install",
    "skills.uninstall",
    "heartbeat.report",
    "memos.create",
    "memos.update",
    "memos.delete",
    "memos.revert",
    "memos.list",
    "memos.search",
    "memos.backlinks",
    "theme.list",
    "theme.read",
    "theme.history",
    "theme.create",
    "theme.update",
    "theme.revert",
    "theme.install",
    "theme.uninstall",
    "styles.read",
    "styles.history",
    "styles.write",
    "styles.append",
    "styles.revert",
    "plugins.list",
    "plugins.read",
    "plugins.history",
    "plugins.setActive",
    "plugins.delete",
    "plugins.revert",
    "plugins.install",
    "plugins.uninstall",
    "widgets.list",
    "widgets.read",
    "widgets.history",
    "widgets.setAutoRun",
    "widgets.delete",
    "widgets.revert",
    "widgets.install",
    "widgets.uninstall",
    "queries.history",
    "queries.revert",
    "keybinds.list",
    "keybinds.set",
    "keybinds.reset",
    "keybinds.resetAll",
    "navbar.list",
    "navbar.reset",
    "performance.list",
    "performance.set",
    "performance.reset",
    "performance.resetAll",
    "performance.applySlider",
    "ai.listPersonas",
    "ai.setPersona",
    "meta.persona",
    "meta.activeSkills",
    "meta.config",
    "meta.heartbeat",
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
                "{}: exec is core but it is missing from the implementation list",
                d.id
            );
        }
        for id in HAS_BODY {
            assert!(
                is_core(id),
                "{id}: has an implementation but is not declared as core"
            );
        }
    }

    #[test]
    fn resolve_account_id_prefers_params_then_context() {
        let ctx = ExecContext {
            principal: "ai.chat".into(),
            account_id: Some("ctx".into()),
            tainted: false,
            plugin_id: None,
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
