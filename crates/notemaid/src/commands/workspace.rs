//! AI の人格と記憶 (#1162) の UI 向け操作。読み書きは notemaid 経由に限る
//! (汎用の設定ファイル操作には `notemaid/` を乗せない: 上限と承認と汚染規則を素通りするため)。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ai_config;
use crate::workspace::{self, Kind, Usage};
use notecli::error::NoteDeckError;
use notecore::context::Core;
use notecore::error::Result;
use notecore::settings_events::{SettingsChange, SettingsChangeOp};

/// 1 ファイルの写し (UI 表示用)
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub kind: Kind,
    pub exists: bool,
    pub body: String,
    /// 現役の項目 (USER / MEMORY だけ。他は空)
    pub entries: Vec<String>,
    pub usage: Usage,
    /// notemaid が最後に書いた内容と違う (外部エディタで変えられた)
    pub externally_changed: bool,
}

fn snapshot(app_dir: &std::path::Path, kind: Kind) -> Result<WorkspaceFile> {
    let body = workspace::read(app_dir, kind)?;
    let exists = body.is_some();
    let body = body.unwrap_or_default();
    Ok(WorkspaceFile {
        kind,
        exists,
        entries: workspace::entries(kind, &body),
        usage: workspace::usage(kind, &body),
        externally_changed: exists && workspace::externally_changed(app_dir, kind, &body),
        body,
    })
}

fn notify(core: &Core, kind: Kind, op: SettingsChangeOp) {
    workspace::notify_changed(core, kind, op);
}

/// 4 ファイルの写し。無いものは seed してから返す (UI が開いた時点で揃う)
pub async fn maid_workspace_list(core: &Core) -> Result<Vec<WorkspaceFile>> {
    let app_dir = core.app_dir()?;
    workspace::seed(app_dir, &workspace::language(app_dir))?;
    Kind::ALL.iter().map(|k| snapshot(app_dir, *k)).collect()
}

/// 人が UI から書く。上限は AI の書込と同じ (超えたらエラー)。BOOTSTRAP は書けない
pub async fn maid_workspace_write(core: &Core, kind: Kind, body: String) -> Result<WorkspaceFile> {
    if kind == Kind::Bootstrap {
        return Err(NoteDeckError::InvalidInput(
            "BOOTSTRAP.md is not edited from the app".into(),
        ));
    }
    if workspace::has_invisible_unicode(&body) {
        return Err(NoteDeckError::InvalidInput(
            workspace::UpdateError::InvisibleUnicode.message(),
        ));
    }
    let u = workspace::usage(kind, &body);
    if u.over() {
        return Err(NoteDeckError::InvalidInput(format!(
            "{} would be {} chars, the limit is {}",
            kind.file_name(),
            u.chars,
            u.limit
        )));
    }
    let app_dir = core.app_dir()?;
    let text = if body.ends_with('\n') {
        body
    } else {
        format!("{body}\n")
    };
    workspace::write(app_dir, kind, &text)?;
    workspace::record_hash(app_dir, kind, &text);
    let cfg = ai_config::load(core)?;
    if workspace::bootstrap_done(app_dir, cfg.user_memory) && workspace::remove_bootstrap(app_dir) {
        notify(core, Kind::Bootstrap, SettingsChangeOp::Delete);
    }
    notify(core, kind, SettingsChangeOp::Write);
    snapshot(app_dir, kind)
}

/// 「あなたのことを覚える」のトグル (ai.json5 の `userMemory`)。OFF にしたら
/// BOOTSTRAP の役目も終わる
pub async fn maid_user_memory_set(core: &Core, enabled: bool) -> Result<()> {
    ai_config::set_user_memory(core, enabled)?;
    if !enabled {
        let app_dir = core.app_dir()?;
        if workspace::remove_bootstrap(app_dir) {
            notify(core, Kind::Bootstrap, SettingsChangeOp::Delete);
        }
    }
    Ok(())
}

/// 予約 skill を無ければ置いて (冪等)、その写しを返す。AI 設定の編集の入口から呼ぶ
async fn seed_reserved_skill(
    core: &Core,
    which: workspace::Reserved,
) -> Result<crate::skills::SkillMeta> {
    let app_dir = core.app_dir()?;
    let settings_dir = notecore::commands::settings::settings_base_dir(core)?;
    crate::skills::seed_reserved(
        &settings_dir,
        which,
        &workspace::language(app_dir),
        crate::skills::now_ms(),
    )?;
    core.notify_settings_change(SettingsChange {
        subdir: Some(crate::skills::SUBDIR.to_string()),
        name: which.file_name().to_string(),
        op: SettingsChangeOp::Write,
    });
    crate::skills::get(core, which.file_name().trim_end_matches(".md"))?.ok_or_else(|| {
        NoteDeckError::InvalidInput(format!("{} was not created", which.file_name()))
    })
}

/// 「巡回の手順を編集」で初めて HEARTBEAT.md を置く。戻り値は skill の写し
pub async fn maid_heartbeat_steps_seed(core: &Core) -> Result<crate::skills::SkillMeta> {
    seed_reserved_skill(core, workspace::Reserved::Heartbeat).await
}

/// 「いつも守ること」の編集の入口。AGENTS.md は最初の AI ターンで置かれるが、それより
/// 前に AI 設定から開いても編集できるように、無ければここで置く。戻り値は skill の写し
pub async fn maid_agents_seed(core: &Core) -> Result<crate::skills::SkillMeta> {
    seed_reserved_skill(core, workspace::Reserved::Agents).await
}

/// 送った system prompt (開発者モードの「この応答に送った指示」)。メモリ保持のみ
pub async fn maid_turn_system(_core: &Core, turn_id: String) -> Result<Option<Value>> {
    Ok(crate::ai_turn::recent_system(&turn_id).map(Value::String))
}
