//! system prompt の組み立て (#1162)。所有者は notemaid 一本。
//!
//! 順番は SOUL → キャラクター (persona) → USER → BOOTSTRAP → MEMORY → AGENTS →
//! 他の always / active / trigger skill → デバイス文脈 (`<notedeck-context>`)。
//! Hermes 寄り (SOUL が先頭。OpenClaw は AGENTS が先頭)。turn 開始時に 1 回だけ組み、
//! その turn の中 (tool 反復 / 継続 / 再開) は同じ文字列を使う。

use std::collections::HashMap;
use std::path::Path;

use crate::skills::{self, SkillMeta};
use crate::workspace::{self, Kind};

/// 予約 skill AGENTS.md のファイル名 (拡張子なし)。`skills/AGENTS.md`
pub const AGENTS_FILE_BASE: &str = "AGENTS";

/// 「あなたのことを覚える」が OFF のとき USER.md の代わりに入れる定数 1 行
/// (定数なので prefix cache を壊さない)
pub const USER_MEMORY_OFF: &str =
    "## USER.md\nMemory about the person is off. Do not record facts about them.";

#[derive(Debug, Clone, Default)]
pub struct Composed {
    pub system: Option<String>,
    /// 出所判定で trusted に数える本文 (store 由来でない skill の本文)。
    /// ワークスペースファイルと store 由来 skill は入れない
    pub trusted_skill_bodies: Vec<String>,
    /// 文脈に store 由来 (`store_id` 付き) の skill がある
    pub store_skill_in_context: bool,
    /// 文脈にラベル付き (tainted) の skill がある
    pub tainted_skill_in_context: bool,
    /// 注入した各ファイルの内容 hash (外部で変えられたかの検知用)
    pub workspace_hashes: HashMap<Kind, String>,
}

pub struct Input<'a> {
    pub app_dir: &'a Path,
    /// テンプレの言語 (初回 seed のときだけ使う)
    pub lang: &'a str,
    pub persona_skill_id: Option<&'a str>,
    /// セッションに累積した trigger skill の id
    pub trigger_skill_ids: &'a [String],
    pub device_context: Option<&'a str>,
    pub user_memory_enabled: bool,
}

/// persona の宣言ブロック (デバイスが `<notedeck-context>` の中に書いていたものと同文)
fn persona_block(sk: &SkillMeta) -> String {
    let id = format!("skill:{}", sk.id);
    let mut lines = vec![
        "<persona>".to_string(),
        format!("Act as {} (id: {id}).", sk.name),
        format!("When calling memos.create / memos.update, pass authorId='{id}'."),
    ];
    if let Some(bio) = sk.description.as_deref().filter(|b| !b.trim().is_empty()) {
        lines.push(format!("bio: {bio}"));
    }
    lines.push("</persona>".into());
    lines.join("\n")
}

pub fn compose(input: Input<'_>) -> Composed {
    let mut out = Composed::default();
    if let Err(e) = workspace::seed(input.app_dir, input.lang) {
        tracing::warn!("cannot seed the workspace files: {e}");
    }
    let mut parts: Vec<String> = Vec::new();

    let push_ws = |kind: Kind, parts: &mut Vec<String>, out: &mut Composed| {
        if let Ok(Some(body)) = workspace::read(input.app_dir, kind) {
            out.workspace_hashes
                .insert(kind, workspace::content_hash(&body));
            parts.push(workspace::render_block(kind, &body));
        }
    };

    push_ws(Kind::Soul, &mut parts, &mut out);

    let settings_dir = input
        .app_dir
        .join(notecore::commands::settings::SETTINGS_DIR);
    let all = skills::load_all(&settings_dir, skills::now_ms()).items;
    let persona = input
        .persona_skill_id
        .and_then(|id| all.iter().find(|s| s.id == id && s.is_persona));
    if let Some(p) = persona {
        note_skill(p, &mut out);
        let body = p.body.trim();
        if !body.is_empty() {
            parts.push(body.to_string());
        }
        parts.push(persona_block(p));
    }

    if input.user_memory_enabled {
        push_ws(Kind::User, &mut parts, &mut out);
    } else {
        parts.push(USER_MEMORY_OFF.to_string());
    }
    push_ws(Kind::Bootstrap, &mut parts, &mut out);
    push_ws(Kind::Memory, &mut parts, &mut out);

    // skill: 予約の AGENTS を先頭に、あとは作成順 (load_all が保証)
    let selected: Vec<&SkillMeta> = all
        .iter()
        .filter(|s| !s.is_persona)
        .filter(|s| {
            s.mode == "always"
                || s.active == Some(true)
                || (s.mode == "trigger" && input.trigger_skill_ids.iter().any(|t| t == &s.id))
        })
        .collect();
    let (agents, rest): (Vec<&SkillMeta>, Vec<&SkillMeta>) = selected
        .into_iter()
        .partition(|s| s.file_base.as_deref() == Some(AGENTS_FILE_BASE));
    for s in agents.into_iter().chain(rest) {
        let body = s.body.trim();
        if body.is_empty() {
            continue;
        }
        note_skill(s, &mut out);
        parts.push(body.to_string());
    }

    if let Some(ctx) = input
        .device_context
        .map(str::trim)
        .filter(|c| !c.is_empty())
    {
        parts.push(ctx.to_string());
    }

    out.system = (!parts.is_empty()).then(|| parts.join("\n\n"));
    out
}

fn note_skill(s: &SkillMeta, out: &mut Composed) {
    if s.store_id.is_some() {
        out.store_skill_in_context = true;
    } else {
        let body = s.body.trim();
        if !body.is_empty() {
            out.trusted_skill_bodies.push(body.to_string());
        }
    }
    if s.tainted == Some(true) && !s.body.trim().is_empty() {
        out.tainted_skill_in_context = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn put_skill(app_dir: &Path, base: &str, fm: &str, body: &str) {
        let dir = app_dir.join("notedeck").join("skills");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(format!("{base}.md")),
            format!("---\n{fm}\n---\n{body}\n"),
        )
        .unwrap();
    }

    fn compose_in(
        app_dir: &Path,
        persona: Option<&str>,
        triggers: &[String],
        ctx: Option<&str>,
        user_on: bool,
    ) -> Composed {
        compose(Input {
            app_dir,
            lang: "en",
            persona_skill_id: persona,
            trigger_skill_ids: triggers,
            device_context: ctx,
            user_memory_enabled: user_on,
        })
    }

    fn pos(hay: &str, needle: &str) -> usize {
        hay.find(needle)
            .unwrap_or_else(|| panic!("{needle:?} not in system:\n{hay}"))
    }

    #[test]
    fn orders_soul_persona_user_memory_agents_skills_then_device_context() {
        let t = tempfile::tempdir().unwrap();
        put_skill(t.path(), "mei", "id: mei\nname: Mei\ndescription: a calm maid\nmode: manual\nisPersona: true\ncreatedAt: 1", "Speak softly.");
        put_skill(
            t.path(),
            "other-persona",
            "id: other-persona\nname: Other\nmode: manual\nisPersona: true\ncreatedAt: 2",
            "I am someone else.",
        );
        put_skill(
            t.path(),
            "AGENTS",
            "id: agents\nname: Rules\nmode: always\ncreatedAt: 5",
            "Rule one.",
        );
        put_skill(
            t.path(),
            "always1",
            "id: always1\nname: A1\nmode: always\ncreatedAt: 3",
            "Always one.",
        );
        put_skill(
            t.path(),
            "manual-on",
            "id: manual-on\nname: M\nmode: manual\nactive: true\ncreatedAt: 4",
            "Manual on.",
        );
        put_skill(
            t.path(),
            "manual-off",
            "id: manual-off\nname: M2\nmode: manual\ncreatedAt: 4",
            "Manual off.",
        );
        put_skill(
            t.path(),
            "trig",
            "id: trig\nname: T\nmode: trigger\ntriggers: [hi]\ncreatedAt: 6",
            "Triggered.",
        );
        put_skill(
            t.path(),
            "trig2",
            "id: trig2\nname: T2\nmode: trigger\ntriggers: [yo]\ncreatedAt: 7",
            "Not triggered.",
        );
        let c = compose_in(
            t.path(),
            Some("mei"),
            &["trig".into()],
            Some("<notedeck-context>\nctx\n</notedeck-context>"),
            true,
        );
        let s = c.system.unwrap();
        let order = [
            "## SOUL.md",
            "Speak softly.",
            "<persona>\nAct as Mei (id: skill:mei).\nWhen calling memos.create / memos.update, pass authorId='skill:mei'.\nbio: a calm maid\n</persona>",
            "## USER.md [",
            "## BOOTSTRAP.md",
            "## MEMORY.md [",
            "Rule one.",
            "Always one.",
            "Manual on.",
            "Triggered.",
            "<notedeck-context>",
        ];
        let mut last = 0;
        for needle in order {
            let p = pos(&s, needle);
            assert!(p >= last, "{needle:?} is out of order");
            last = p;
        }
        for absent in ["I am someone else.", "Manual off.", "Not triggered."] {
            assert!(
                !s.contains(absent),
                "{absent:?} leaked into the system prompt"
            );
        }
        assert!(c.workspace_hashes.contains_key(&Kind::Soul));
        assert!(c.workspace_hashes.contains_key(&Kind::User));
        assert!(!c.store_skill_in_context && !c.tainted_skill_in_context);
        // trusted に数えるのは skill の本文だけ (ワークスペースは入れない)
        assert!(c.trusted_skill_bodies.contains(&"Rule one.".to_string()));
        assert!(c
            .trusted_skill_bodies
            .contains(&"Speak softly.".to_string()));
        assert!(!c.trusted_skill_bodies.iter().any(|b| b.contains("SOUL")));
    }

    #[test]
    fn user_memory_off_replaces_user_file_with_a_constant_line() {
        let t = tempfile::tempdir().unwrap();
        let c = compose_in(t.path(), None, &[], None, false);
        let s = c.system.unwrap();
        assert!(s.contains(USER_MEMORY_OFF));
        assert!(!s.contains("## USER.md ["));
        assert!(!c.workspace_hashes.contains_key(&Kind::User));
    }

    #[test]
    fn store_and_tainted_skills_are_flagged_and_not_counted_as_trusted() {
        let t = tempfile::tempdir().unwrap();
        put_skill(
            t.path(),
            "shop",
            "id: shop\nname: Shop\nmode: always\nstoreId: store-1\ncreatedAt: 1",
            "From the store.",
        );
        put_skill(
            t.path(),
            "dirty",
            "id: dirty\nname: Dirty\nmode: always\ntainted: true\ncreatedAt: 2",
            "Labelled.",
        );
        let c = compose_in(t.path(), None, &[], None, true);
        assert!(c.store_skill_in_context);
        assert!(c.tainted_skill_in_context);
        assert!(!c
            .trusted_skill_bodies
            .contains(&"From the store.".to_string()));
        assert!(c.trusted_skill_bodies.contains(&"Labelled.".to_string()));
        assert!(c.system.unwrap().contains("From the store."));
    }

    #[test]
    fn a_dangling_or_non_persona_id_adds_no_persona_block() {
        let t = tempfile::tempdir().unwrap();
        put_skill(
            t.path(),
            "plain",
            "id: plain\nname: Plain\nmode: manual\ncreatedAt: 1",
            "not a persona",
        );
        let c = compose_in(t.path(), Some("plain"), &[], None, true);
        let s = c.system.unwrap();
        assert!(!s.contains("<persona>"));
        assert!(!s.contains("not a persona"));
        let c = compose_in(t.path(), Some("missing"), &[], None, true);
        assert!(!c.system.unwrap().contains("<persona>"));
    }
}
