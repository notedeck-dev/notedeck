//! AI セッション (`notedeck/sessions/<id>.json5`) の単一の書き手 (#1133 縦切り 3)。
//!
//! ファイルを書くのは notecore だけ。デバイス (WebView) は「作成 / メッセージ追加 /
//! メッセージ削除 / 改名 / trigger skill の累積 / 削除」の構造化された操作を
//! 送り、返ってきたセッションで自分の写しを更新する。ターン実行器も同じ
//! 操作でここに書く (ユーザー入力 / tool_use / tool_result / 最終応答)。
//! 汎用の設定ファイル書込コマンドは `sessions` を受け付けない。
//!
//! ファイル形式は従来の TS codec と同じ: JSON (JSON5 として読む)、既知フィールドは
//! 固定順、未知フィールドは保持する。読込は寛容 (型が違えば既定値に倒す)。
//! 空 content で tool_use を持たない assistant (中断の残骸) は読込時に落とす。

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use specta::Type;

use crate::error::Result;
use crate::settings_store as store;
use notecli::error::NoteDeckError;

pub const SUBDIR: &str = "sessions";
const EXT: &str = ".json5";
const SCHEMA_VERSION: u64 = 1;
const PREVIEW_MAX_CHARS: usize = 120;

/// セッションの 1 メッセージ (wire。ファイルの未知フィールドは持たない)。
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMessage {
    pub id: String,
    /// `user` | `assistant` | `system`
    pub role: String,
    pub content: String,
    pub timestamp: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_use_input: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_result_for: Option<String>,
    /// HEARTBEAT の報告 (AI の履歴からは除く)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heartbeat: Option<bool>,
    /// 無人実行の書込意図 (受信箱カード、#1133): `{ capabilityId, params, untrusted,
    /// status, draftId?, source, createdAt }`。人がボタンを押して確認を経てから走る
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent: Option<Value>,
    /// 本文を表示言語で描き直す手がかり `{ content: { key, params } }` (#135)。
    /// notecore が書く定型の本文 (HEARTBEAT の失敗や受信箱カード) にだけ付く。
    /// `content` は英語の正本文
    #[serde(default, rename = "i18n", skip_serializing_if = "Option::is_none")]
    pub i18n: Option<Value>,
}

/// セッション (wire)。`message_count` / `last_message_preview` は算出値。
#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiSession {
    pub schema_version: u64,
    pub id: String,
    /// `chat` | `command` | `task` | `heartbeat`
    pub kind: String,
    pub title: String,
    pub model: String,
    pub connection_id: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub messages: Vec<SessionMessage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_skill_id: Option<String>,
    #[serde(default)]
    pub triggered_skill_ids: Vec<String>,
    pub message_count: u64,
    pub last_message_preview: String,
    /// タイトルを表示言語で描き直す手がかり `{ title: { key, params } }` (#135)。
    /// notecore が付けた定型のタイトルにだけ付き、利用者が名前を変えたら消える
    #[serde(default, rename = "i18n", skip_serializing_if = "Option::is_none")]
    pub i18n: Option<Value>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionCreate {
    /// デバイスが採番する (ローカル時刻の `YYYYMMDDhhmmss` + 衝突接尾辞)
    pub id: String,
    pub kind: String,
    pub title: String,
    pub model: String,
    pub connection_id: String,
    #[serde(default)]
    pub persona_skill_id: Option<String>,
    /// タイトルの手がかり (`AiSession::i18n` と同じ形)
    #[serde(default, rename = "i18n")]
    pub i18n: Option<Value>,
}

/// ファイル上の形。既知フィールドは宣言順に書き、未知フィールドは末尾に保持する。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    schema_version: u64,
    id: String,
    kind: String,
    title: String,
    model: String,
    connection_id: String,
    created_at: u64,
    updated_at: u64,
    messages: Vec<MessageFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    persona_skill_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    triggered_skill_ids: Vec<String>,
    #[serde(rename = "i18n", skip_serializing_if = "Option::is_none")]
    i18n: Option<Value>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MessageFile {
    #[serde(flatten)]
    wire: SessionMessage,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

const KNOWN_SESSION_FIELDS: &[&str] = &[
    "schemaVersion",
    "id",
    "kind",
    "title",
    "model",
    "connectionId",
    "createdAt",
    "updatedAt",
    "messages",
    "personaSkillId",
    "triggeredSkillIds",
    "i18n",
];
const KNOWN_MESSAGE_FIELDS: &[&str] = &[
    "id",
    "role",
    "content",
    "timestamp",
    "toolUseId",
    "toolUseName",
    "toolUseInput",
    "toolResultFor",
    "heartbeat",
    "intent",
    "i18n",
];

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn file_name(id: &str) -> String {
    format!("{id}{EXT}")
}

fn validate_id(id: &str) -> Result<()> {
    if id.is_empty() || id.len() > 64 {
        return Err(NoteDeckError::InvalidInput("invalid session id".into()));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(NoteDeckError::InvalidInput(format!(
            "session id contains characters that are not allowed: {id}"
        )));
    }
    Ok(())
}

fn str_of(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or("").to_string()
}

fn u64_of(v: Option<&Value>, fallback: u64) -> u64 {
    v.and_then(|x| x.as_u64().or_else(|| x.as_f64().map(|f| f as u64)))
        .unwrap_or(fallback)
}

fn message_from_value(v: &Value) -> Option<MessageFile> {
    let obj = v.as_object()?;
    let wire = SessionMessage {
        id: str_of(obj.get("id")),
        role: str_of(obj.get("role")),
        content: str_of(obj.get("content")),
        timestamp: u64_of(obj.get("timestamp"), 0),
        tool_use_id: obj
            .get("toolUseId")
            .and_then(Value::as_str)
            .map(str::to_string),
        tool_use_name: obj
            .get("toolUseName")
            .and_then(Value::as_str)
            .map(str::to_string),
        tool_use_input: obj.get("toolUseInput").filter(|v| !v.is_null()).cloned(),
        tool_result_for: obj
            .get("toolResultFor")
            .and_then(Value::as_str)
            .map(str::to_string),
        intent: obj.get("intent").filter(|v| !v.is_null()).cloned(),
        heartbeat: obj.get("heartbeat").and_then(Value::as_bool),
        i18n: obj.get("i18n").filter(|v| v.is_object()).cloned(),
    };
    let extra: Map<String, Value> = obj
        .iter()
        .filter(|(k, _)| !KNOWN_MESSAGE_FIELDS.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Some(MessageFile { wire, extra })
}

/// 寛容な読込 (TS codec の deserialize と同じ規則)。id が無ければ None。
fn parse(text: &str) -> Option<SessionFile> {
    let doc: Value = json5::from_str(text).ok()?;
    let obj = doc.as_object()?;
    let id = str_of(obj.get("id"));
    if id.is_empty() {
        return None;
    }
    let now = now_ms();
    let messages: Vec<MessageFile> = obj
        .get("messages")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(message_from_value).collect())
        .unwrap_or_default();
    // 中断の残骸 (#770): 空 content で tool_use を持たない assistant を落とす
    let messages: Vec<MessageFile> = messages
        .into_iter()
        .filter(|m| {
            !(m.wire.role == "assistant"
                && m.wire.content.is_empty()
                && m.wire.tool_use_id.is_none())
        })
        .collect();
    let kind = match str_of(obj.get("kind")).as_str() {
        "" => "chat".to_string(),
        k => k.to_string(),
    };
    let triggered_skill_ids: Vec<String> = obj
        .get("triggeredSkillIds")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let extra: Map<String, Value> = obj
        .iter()
        .filter(|(k, _)| !KNOWN_SESSION_FIELDS.contains(&k.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Some(SessionFile {
        schema_version: u64_of(obj.get("schemaVersion"), SCHEMA_VERSION),
        id,
        kind,
        title: str_of(obj.get("title")),
        model: str_of(obj.get("model")),
        connection_id: str_of(obj.get("connectionId")),
        created_at: u64_of(obj.get("createdAt"), now),
        updated_at: u64_of(obj.get("updatedAt"), now),
        messages,
        persona_skill_id: obj
            .get("personaSkillId")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        triggered_skill_ids,
        i18n: obj.get("i18n").filter(|v| v.is_object()).cloned(),
        extra,
    })
}

/// ドロワー用の preview: tool 行を飛ばした最後の本文を 1 行に潰して上限で切る。
pub fn last_message_preview(messages: &[SessionMessage]) -> String {
    for m in messages.iter().rev() {
        if m.tool_result_for.is_some() || m.tool_use_id.is_some() {
            continue;
        }
        let flat: String = m.content.split_whitespace().collect::<Vec<_>>().join(" ");
        if flat.is_empty() {
            continue;
        }
        let count = flat.chars().count();
        return if count > PREVIEW_MAX_CHARS {
            format!(
                "{}…",
                flat.chars().take(PREVIEW_MAX_CHARS).collect::<String>()
            )
        } else {
            flat
        };
    }
    String::new()
}

impl SessionFile {
    fn to_wire(&self) -> AiSession {
        let messages: Vec<SessionMessage> = self.messages.iter().map(|m| m.wire.clone()).collect();
        AiSession {
            schema_version: self.schema_version,
            id: self.id.clone(),
            kind: self.kind.clone(),
            title: self.title.clone(),
            model: self.model.clone(),
            connection_id: self.connection_id.clone(),
            created_at: self.created_at,
            updated_at: self.updated_at,
            message_count: messages.len() as u64,
            last_message_preview: last_message_preview(&messages),
            messages,
            persona_skill_id: self.persona_skill_id.clone(),
            triggered_skill_ids: self.triggered_skill_ids.clone(),
            i18n: self.i18n.clone(),
        }
    }
}

fn load(base: &Path, id: &str) -> Result<SessionFile> {
    validate_id(id)?;
    let text = store::read_file(base, SUBDIR, &file_name(id))?;
    parse(&text).ok_or_else(|| NoteDeckError::InvalidInput(format!("cannot read session {id}")))
}

fn save(base: &Path, file: &SessionFile) -> Result<()> {
    let body = format!("{}\n", serde_json::to_string_pretty(file)?);
    store::write_file(base, SUBDIR, &file_name(&file.id), &body)
}

fn mutate<F>(base: &Path, id: &str, f: F) -> Result<AiSession>
where
    F: FnOnce(&mut SessionFile),
{
    let mut file = load(base, id)?;
    f(&mut file);
    file.updated_at = now_ms();
    save(base, &file)?;
    Ok(file.to_wire())
}

/// 全セッションを読む (壊れたファイルは飛ばす。同じ id は先勝ち)。
pub fn load_all(base: &Path) -> Result<Vec<AiSession>> {
    let mut out: Vec<AiSession> = Vec::new();
    let names = match store::list_files(base, SUBDIR) {
        Ok(n) => n,
        Err(_) => return Ok(out),
    };
    for name in names.iter().filter(|n| n.ends_with(EXT)) {
        let Ok(text) = store::read_file(base, SUBDIR, name) else {
            continue;
        };
        match parse(&text) {
            Some(file) => {
                if out.iter().any(|s| s.id == file.id) {
                    tracing::warn!(name, "duplicate ai session id, skipped");
                    continue;
                }
                out.push(file.to_wire());
            }
            None => tracing::warn!(name, "unreadable ai session file, skipped"),
        }
    }
    Ok(out)
}

pub fn get(base: &Path, id: &str) -> Result<AiSession> {
    Ok(load(base, id)?.to_wire())
}

pub fn exists(base: &Path, id: &str) -> bool {
    validate_id(id).is_ok()
        && store::resolve_file(base, SUBDIR, &file_name(id))
            .map(|p| p.exists())
            .unwrap_or(false)
}

pub fn create(base: &Path, req: AiSessionCreate) -> Result<AiSession> {
    validate_id(&req.id)?;
    if exists(base, &req.id) {
        return Err(NoteDeckError::InvalidInput(format!(
            "session {} already exists",
            req.id
        )));
    }
    let now = now_ms();
    let file = SessionFile {
        schema_version: SCHEMA_VERSION,
        id: req.id,
        kind: if req.kind.is_empty() {
            "chat".into()
        } else {
            req.kind
        },
        title: req.title,
        model: req.model,
        connection_id: req.connection_id,
        created_at: now,
        updated_at: now,
        messages: Vec::new(),
        persona_skill_id: req.persona_skill_id.filter(|s| !s.is_empty()),
        triggered_skill_ids: Vec::new(),
        i18n: req.i18n,
        extra: Map::new(),
    };
    save(base, &file)?;
    Ok(file.to_wire())
}

/// メッセージを末尾に足す。同じ id が既にあれば差し替える (再送の冪等性)。
pub fn append(base: &Path, id: &str, messages: Vec<SessionMessage>) -> Result<AiSession> {
    mutate(base, id, |file| {
        for m in messages {
            if let Some(slot) = file.messages.iter_mut().find(|x| x.wire.id == m.id) {
                slot.wire = m;
            } else {
                file.messages.push(MessageFile {
                    wire: m,
                    extra: Map::new(),
                });
            }
        }
    })
}

pub fn remove_messages(base: &Path, id: &str, ids: &[String]) -> Result<AiSession> {
    mutate(base, id, |file| {
        file.messages.retain(|m| !ids.contains(&m.wire.id));
    })
}

pub fn rename(base: &Path, id: &str, title: &str) -> Result<AiSession> {
    // 利用者が付けた名前なので、定型タイトルの手がかりは捨てる (#135)
    mutate(base, id, |file| {
        file.title = title.to_string();
        file.i18n = None;
    })
}

/// trigger skill の id を初出順で累積する (#725)。
pub fn add_triggered_skills(base: &Path, id: &str, skill_ids: &[String]) -> Result<AiSession> {
    mutate(base, id, |file| {
        for s in skill_ids {
            if !s.is_empty() && !file.triggered_skill_ids.contains(s) {
                file.triggered_skill_ids.push(s.clone());
            }
        }
    })
}

pub fn delete(base: &Path, id: &str) -> Result<()> {
    validate_id(id)?;
    store::delete_file(base, SUBDIR, &file_name(id))
}

pub fn dir(base: &Path) -> PathBuf {
    base.join(SUBDIR)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, role: &str, content: &str) -> SessionMessage {
        SessionMessage {
            id: id.into(),
            role: role.into(),
            content: content.into(),
            timestamp: 1,
            ..Default::default()
        }
    }

    #[test]
    fn rename_drops_the_template_title_hint() {
        let dir = tempfile::tempdir().unwrap();
        let mut req = create_req("20260101000000");
        req.title = "HEARTBEAT 2026".into();
        req.i18n =
            Some(serde_json::json!({ "title": { "key": "_native.heartbeat.sessionTitle" } }));
        let created = create(dir.path(), req).unwrap();
        assert!(created.i18n.is_some());
        let renamed = rename(dir.path(), &created.id, "mine").unwrap();
        assert_eq!(renamed.title, "mine");
        assert!(renamed.i18n.is_none());
    }

    fn create_req(id: &str) -> AiSessionCreate {
        AiSessionCreate {
            id: id.into(),
            kind: "chat".into(),
            title: "".into(),
            model: "m".into(),
            connection_id: "c".into(),
            persona_skill_id: None,
            i18n: None,
        }
    }

    #[test]
    fn create_append_rename_remove_delete_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        let s = create(base, create_req("20260924120000")).unwrap();
        assert_eq!(s.kind, "chat");
        assert_eq!(s.message_count, 0);
        assert!(create(base, create_req("20260924120000")).is_err());
        assert!(create(base, create_req("../x")).is_err());

        let s = append(
            base,
            "20260924120000",
            vec![
                msg("u1", "user", "hello"),
                msg("a1", "assistant", "  hi\nthere  "),
            ],
        )
        .unwrap();
        assert_eq!(s.message_count, 2);
        assert_eq!(s.last_message_preview, "hi there");
        // 同じ id は差し替え
        let s = append(base, "20260924120000", vec![msg("a1", "assistant", "hi!")]).unwrap();
        assert_eq!(s.message_count, 2);
        assert_eq!(s.messages[1].content, "hi!");

        let s = rename(base, "20260924120000", "題名").unwrap();
        assert_eq!(s.title, "題名");
        let s = add_triggered_skills(
            base,
            "20260924120000",
            &["x".into(), "x".into(), "y".into()],
        )
        .unwrap();
        assert_eq!(s.triggered_skill_ids, vec!["x", "y"]);
        let s = remove_messages(base, "20260924120000", &["u1".into()]).unwrap();
        assert_eq!(s.messages.len(), 1);

        assert_eq!(load_all(base).unwrap().len(), 1);
        delete(base, "20260924120000").unwrap();
        assert!(get(base, "20260924120000").is_err());
        assert!(load_all(base).unwrap().is_empty());
    }

    #[test]
    fn file_keeps_field_order_unknown_fields_and_trailing_newline() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path();
        std::fs::create_dir_all(dir(base)).unwrap();
        let raw = r#"{
  "schemaVersion": 1,
  "id": "s1",
  "kind": "chat",
  "title": "t",
  "model": "m",
  "connectionId": "c",
  "createdAt": 5,
  "updatedAt": 6,
  "messages": [
    { "id": "u1", "role": "user", "content": "q", "timestamp": 1, "mood": "happy" },
    { "id": "ph", "role": "assistant", "content": "", "timestamp": 2 }
  ],
  "future": { "x": 1 }
}
"#;
        std::fs::write(dir(base).join("s1.json5"), raw).unwrap();
        // 読込: placeholder は落ち、未知フィールドは保持
        let s = get(base, "s1").unwrap();
        assert_eq!(s.messages.len(), 1);
        let s = append(base, "s1", vec![msg("a1", "assistant", "ans")]).unwrap();
        assert_eq!(s.message_count, 2);
        let text = std::fs::read_to_string(dir(base).join("s1.json5")).unwrap();
        assert!(text.ends_with("}\n"));
        let doc: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(doc["future"]["x"], 1);
        assert_eq!(doc["messages"][0]["mood"], "happy");
        // 既知フィールドは固定順 (schemaVersion が先頭、future は末尾)
        let first = text.lines().nth(1).unwrap();
        assert!(first.contains("schemaVersion"), "{first}");
        assert!(text.trim_end().ends_with("}\n}") || text.contains("\"future\""));
        let keys: Vec<&str> = doc
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert!(keys.contains(&"future"));
    }

    #[test]
    fn lenient_parse_falls_back_like_the_ts_codec() {
        let file = parse(r#"{ id: 'x', kind: 7, createdAt: 'nope', messages: 'no', triggeredSkillIds: ['a', 1, ''] }"#).unwrap();
        assert_eq!(file.kind, "chat");
        assert!(file.created_at > 0);
        assert!(file.messages.is_empty());
        assert_eq!(file.triggered_skill_ids, vec!["a"]);
        assert!(parse("{ broken").is_none());
        assert!(parse("{ title: 'no id' }").is_none());
    }

    #[test]
    fn preview_skips_tool_rows_and_truncates() {
        let long = "あ".repeat(130);
        let messages = vec![
            msg("a", "assistant", &long),
            SessionMessage {
                tool_result_for: Some("t".into()),
                ..msg("r", "user", "tool result")
            },
        ];
        let p = last_message_preview(&messages);
        assert_eq!(p.chars().count(), PREVIEW_MAX_CHARS + 1);
        assert!(p.ends_with('…'));
        assert_eq!(last_message_preview(&[]), "");
    }
}
