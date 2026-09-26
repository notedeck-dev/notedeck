//! 受け入れ検査 (#1133 / #1106 段階 2a の前提): WebView (デバイス) が 1 台も
//! 繋がっていなくても、AI のターンが notecore だけで同じように回ること。
//!
//! 使うのは notecore の公開 API だけ (notecored が使うものと同じ):
//! ターン実行器 + `LocalCoreExecutor` + `NoDeviceBridge` + ファイルの
//! セッション / 汚染 / チェックポイント。provider だけ台本に差し替える。

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notecore::ai_chat_service::{
    AiChatEvent, AiChatMessage, AiChatRequest, AiChatRole, AiChatSink, RoundError,
};
use notecore::ai_sessions::{self, AiSessionCreate};
use notecore::ai_turn::{
    self, checkpoint, confirm, taint, AiTurnEvent, AiTurnRequest, AiTurnSink, BoxFuture,
    FileSessions, GrantedSource, LocalCoreExecutor, ProviderRound, TurnRuntime,
};
use notecore::context::Core;
use notecore::frontend_bridge::NoDeviceBridge;
use notecore::permissions_profile::{Granted, PERMISSION_KEYS};
use notecore::settings_events::{SettingsChange, SettingsSink};
use notecore::vault::ConnectionProtocol;
use serde_json::{json, Value};

// --- 台本の provider ---

struct ScriptedProvider(Mutex<Vec<Vec<AiChatEvent>>>);

impl ProviderRound for ScriptedProvider {
    fn protocol(&self) -> ConnectionProtocol {
        ConnectionProtocol::Anthropic
    }
    fn run<'a>(
        &'a self,
        _req: &'a AiChatRequest,
        sink: &'a dyn AiChatSink,
    ) -> BoxFuture<'a, Result<(), RoundError>> {
        let round = {
            let mut rounds = self.0.lock().unwrap();
            if rounds.is_empty() {
                Vec::new()
            } else {
                rounds.remove(0)
            }
        };
        Box::pin(async move {
            for e in round {
                sink.emit(e);
            }
            Ok(())
        })
    }
}

fn event(kind: &str) -> AiChatEvent {
    AiChatEvent {
        stream_id: String::new(),
        kind: kind.into(),
        text: None,
        error: None,
        error_i18n: None,
        tool_use_id: None,
        tool_use_name: None,
        tool_use_input: None,
        usage: None,
    }
}

fn delta(text: &str) -> AiChatEvent {
    let mut e = event("delta");
    e.text = Some(text.into());
    e
}

fn tool_use(id: &str, name: &str, input: Value) -> AiChatEvent {
    let mut e = event("tool_use");
    e.tool_use_id = Some(id.into());
    e.tool_use_name = Some(name.into());
    e.tool_use_input = Some(input);
    e
}

// --- 観測 ---

#[derive(Default)]
struct RecordingSink(Mutex<Vec<AiTurnEvent>>);

impl AiTurnSink for RecordingSink {
    fn emit(&self, event: AiTurnEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl RecordingSink {
    fn all(&self) -> Vec<AiTurnEvent> {
        self.0.lock().unwrap().clone()
    }
    fn kinds(&self) -> Vec<String> {
        self.all().iter().map(|e| e.kind.clone()).collect()
    }
    fn find(&self, kind: &str) -> Option<AiTurnEvent> {
        self.all().into_iter().find(|e| e.kind == kind)
    }
    async fn wait_for(&self, kind: &str) -> AiTurnEvent {
        for _ in 0..1000 {
            if let Some(e) = self.find(kind) {
                return e;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("event {kind} did not arrive; got {:?}", self.kinds());
    }
    /// (tool 名 = capability id の `.` を `_` にしたもの, 結果本文, エラーか)。tool_result は tool_use_id で
    /// 先行する tool_use と対になる (名前は tool_use 側にしか無い)
    fn tool_results(&self) -> Vec<(String, String, bool)> {
        let all = self.all();
        all.iter()
            .filter(|e| e.kind == "tool_result")
            .map(|e| {
                let name = all
                    .iter()
                    .find(|u| u.kind == "tool_use" && u.tool_use_id == e.tool_use_id)
                    .and_then(|u| u.tool_use_name.clone())
                    .unwrap_or_default();
                (
                    name,
                    e.text.clone().unwrap_or_default(),
                    e.is_error == Some(true),
                )
            })
            .collect()
    }
}

#[derive(Default)]
struct ChangeLog(Mutex<Vec<SettingsChange>>);

impl SettingsSink for ChangeLog {
    fn settings_changed(&self, change: SettingsChange) {
        self.0.lock().unwrap().push(change);
    }
}

/// 全権限 (permissions.json5 の代わり。認可の判定そのものは別のテストが持つ)
struct AllGranted;

impl GrantedSource for AllGranted {
    fn granted(&self) -> BoxFuture<'_, Granted> {
        Box::pin(async { PERMISSION_KEYS.iter().copied().collect() })
    }
}

// --- ハーネス ---

struct Headless {
    _dir: tempfile::TempDir,
    app_dir: PathBuf,
    changes: Arc<ChangeLog>,
    sink: Arc<RecordingSink>,
    rt: Arc<TurnRuntime>,
}

fn settings_dir(app_dir: &Path) -> PathBuf {
    app_dir.join(notecore::commands::settings::SETTINGS_DIR)
}

fn headless(rounds: Vec<Vec<AiChatEvent>>) -> Headless {
    let dir = tempfile::tempdir().unwrap();
    let app_dir = dir.path().to_path_buf();
    let core = Arc::new(Core::new());
    core.set_app_dir(app_dir.clone());
    std::fs::create_dir_all(settings_dir(&app_dir)).unwrap();
    let changes = Arc::new(ChangeLog::default());
    core.set_settings_sink(changes.clone());
    let sink = Arc::new(RecordingSink::default());
    let rt = Arc::new(TurnRuntime {
        provider: Arc::new(ScriptedProvider(Mutex::new(rounds))),
        granted: Arc::new(AllGranted),
        skips: Arc::new(HashSet::<String>::new()),
        bridge: Arc::new(NoDeviceBridge),
        sink: sink.clone(),
        store_dir: checkpoint::dir(&app_dir),
        policy: confirm::ConfirmPolicy::default(),
        sessions: Arc::new(FileSessions(settings_dir(&app_dir))),
        taint: Arc::new(taint::FileTaint::new(&app_dir)),
        core: Some(Arc::new(LocalCoreExecutor(core))),
        budget: None,
    });
    Headless {
        _dir: dir,
        app_dir,
        changes,
        sink,
        rt,
    }
}

fn request(turn_id: &str, session_id: Option<&str>, principal: &str, text: &str) -> AiTurnRequest {
    AiTurnRequest {
        turn_id: turn_id.into(),
        session_id: session_id.map(str::to_string),
        principal: principal.into(),
        account_id: None,
        connection_id: "conn".into(),
        model: "m".into(),
        system: Some("headless".into()),
        messages: vec![AiChatMessage {
            role: AiChatRole::User,
            content: text.into(),
            tool_use_id: None,
            tool_use_name: None,
            tool_use_input: None,
            tool_result_for: None,
        }],
        max_tokens: None,
        read_timeout_ms: None,
        max_tool_rounds: None,
        continuation: false,
        generate_title: false,
        title_max_tokens: None,
        tool_param_enums: None,
        device_tools: Vec::new(),
        context_untrusted: false,
    }
}

fn create_session(h: &Headless, id: &str) {
    ai_sessions::create(
        &settings_dir(&h.app_dir),
        AiSessionCreate {
            id: id.into(),
            kind: "chat".into(),
            title: "t".into(),
            model: "m".into(),
            connection_id: "conn".into(),
            persona_skill_id: None,
            i18n: None,
        },
    )
    .unwrap();
}

/// 読取系の core capability をひと通り (設定系 / 配布物 / 自己参照)。
/// デバイスに投げるものは 1 つも無い
#[tokio::test]
async fn reads_across_the_core_capabilities_need_no_device() {
    let reads = [
        "time.now",
        "memos.list",
        "keybinds.list",
        "navbar.list",
        "performance.list",
        "skills.list",
        "ai.listPersonas",
        "meta.heartbeat",
        "meta.config",
        "meta.permissions",
        "plugins.list",
        "widgets.read",
        "theme.list",
        "styles.read",
    ];
    let round: Vec<AiChatEvent> = reads
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let input = if *id == "widgets.read" {
                json!({ "installId": "nope" })
            } else {
                json!({})
            };
            tool_use(&format!("tu{i}"), &id.replace('.', "_"), input)
        })
        .collect();
    let h = headless(vec![round, vec![delta("done")]]);
    create_session(&h, "20260927120000");
    ai_turn::begin_turn(
        h.rt.clone(),
        request(
            "t-reads",
            Some("20260927120000"),
            "ai.chat",
            "list everything",
        ),
    )
    .unwrap();
    h.sink.wait_for("done").await;

    let results = h.sink.tool_results();
    assert_eq!(results.len(), reads.len(), "{:?}", h.sink.kinds());
    for (name, text, is_error) in &results {
        // widgets.read だけは「無い」というエラー (device_unavailable ではない)
        if name == "widgets_read" {
            assert!(text.contains("widget \"nope\" not found"), "{text}");
            continue;
        }
        assert!(!is_error, "{name}: {text}");
        assert!(!text.contains("device_unavailable"), "{name}: {text}");
    }
    let by_name = |n: &str| results.iter().find(|r| r.0 == n).unwrap().1.clone();
    assert!(by_name("keybinds_list").contains("\"commandId\":\"command-palette\""));
    assert!(by_name("performance_list").contains("\"key\":\"emojiCacheHosts\""));
    assert!(by_name("meta_heartbeat").contains("\"permissionsPreset\":\"readonly\""));
    assert!(by_name("meta_permissions").contains("\"principal\":\"ai.chat\""));
    // 読取だけなら設定ファイルは何も書かれない
    assert!(h.changes.0.lock().unwrap().is_empty());
    // セッションにはユーザー入力と最終応答が書かれている
    let session = ai_sessions::get(&settings_dir(&h.app_dir), "20260927120000").unwrap();
    let roles: Vec<&str> = session.messages.iter().map(|m| m.role.as_str()).collect();
    assert_eq!(roles.first(), Some(&"user"));
    assert_eq!(session.messages.last().unwrap().content, "done");
    assert!(session.messages.iter().any(|m| m.tool_result_for.is_some()));
}

/// 書込 (確認あり) は、確認内容を notecore が組み、遠隔の答えで再開して
/// notecore が書き、変更通知が出る
#[tokio::test]
async fn confirmed_writes_are_previewed_and_written_by_notecore() {
    let h = headless(vec![
        vec![
            delta("saving"),
            tool_use(
                "tu1",
                "keybinds_set",
                json!({ "commandId": "search", "shortcuts": [{ "key": "j", "scope": "body" }] }),
            ),
            tool_use("tu2", "memos_create", json!({ "text": "headless memo" })),
        ],
        vec![delta("saved")],
    ]);
    create_session(&h, "20260927120100");
    ai_turn::begin_turn(
        h.rt.clone(),
        request(
            "t-writes",
            Some("20260927120100"),
            "ai.chat",
            "bind j and take a note",
        ),
    )
    .unwrap();
    let req = h.sink.wait_for("confirm_request").await;
    // 確認内容は core が組んだ (汎用の「実行しますか？」ではない)
    let items = req.confirm_items.clone().unwrap();
    assert_eq!(items.as_array().unwrap().len(), 2);
    assert_eq!(items[0]["capabilityId"], "keybinds.set");
    assert_eq!(items[0]["preview"]["title"], "Change keybinding");
    assert_eq!(
        items[0]["preview"]["i18n"]["title"]["key"],
        "_native.preview.keybinds.set.title"
    );
    // memos.create に固有の文面は無いので汎用形 (表示名 + 引数)。デバイス経由でも同じ
    assert_eq!(items[1]["capabilityId"], "memos.create");
    assert_eq!(
        items[1]["preview"]["i18n"]["title"]["key"],
        "_native.preview.generic.title"
    );
    assert!(items[1]["preview"]["code"]
        .as_str()
        .unwrap()
        .contains("headless memo"));
    // まだ何も書かれていない
    assert!(h.changes.0.lock().unwrap().is_empty());
    assert!(!settings_dir(&h.app_dir).join("keybinds.json5").exists());

    confirm::respond(&req.confirm_request_id.clone().unwrap(), true).unwrap();
    h.sink.wait_for("done").await;
    let results = h.sink.tool_results();
    assert_eq!(results.len(), 2, "{:?}", h.sink.kinds());
    for (name, text, is_error) in &results {
        assert!(!is_error, "{name}: {text}");
    }
    assert!(results[0].1.contains("\"count\":1"));
    // notecore が書き、変更通知が出た
    {
        let changes = h.changes.0.lock().unwrap();
        assert!(changes
            .iter()
            .any(|c| c.subdir.is_none() && c.name == "keybinds.json5"));
        assert!(changes
            .iter()
            .any(|c| c.subdir.as_deref() == Some("memos") && c.name.ends_with(".md")));
    }
    let keybinds =
        std::fs::read_to_string(settings_dir(&h.app_dir).join("keybinds.json5")).unwrap();
    assert!(keybinds.contains("search"));
    assert_eq!(
        notecore::memos::load_all(&settings_dir(&h.app_dir)).len(),
        1
    );
}

/// 無人 (HEARTBEAT) は確認を待たず、確認の要る書込は意図として残す。
/// 読取は走る
#[tokio::test]
async fn unattended_turn_queues_confirmed_writes_as_intents() {
    let h = headless(vec![
        vec![
            tool_use("tu1", "memos_list", json!({})),
            tool_use(
                "tu2",
                "performance_set",
                json!({ "key": "emojiCacheHosts", "value": 8 }),
            ),
        ],
        vec![delta("HEARTBEAT_OK")],
    ]);
    ai_turn::begin_turn(
        h.rt.clone(),
        request("t-unattended", None, "ai.heartbeat", "tick"),
    )
    .unwrap();
    h.sink.wait_for("done").await;
    let kinds = h.sink.kinds();
    assert!(!kinds.iter().any(|k| k == "confirm_request"), "{kinds:?}");
    let intent = h.sink.find("intent").expect("intent event");
    assert_eq!(intent.tool_use_name.as_deref(), Some("performance.set"));
    let results = h.sink.tool_results();
    assert_eq!(results[0].0, "memos_list");
    assert!(!results[0].2);
    assert!(
        results[1].1.starts_with("Queued (unattended)"),
        "{}",
        results[1].1
    );
    // 書かれていない
    assert!(!settings_dir(&h.app_dir).join("performance.json5").exists());
    assert!(h.changes.0.lock().unwrap().is_empty());
}

/// デバイス依存の capability は、デバイスが居なければその旨のエラーで AI に返る
/// (ターンは止まらない)
#[tokio::test]
async fn device_capabilities_fail_softly_without_a_device() {
    let h = headless(vec![
        vec![
            tool_use("tu1", "column_list", json!({})),
            tool_use("tu2", "time_now", json!({})),
        ],
        vec![delta("ok")],
    ]);
    ai_turn::begin_turn(
        h.rt.clone(),
        request("t-device", None, "ai.chat", "columns?"),
    )
    .unwrap();
    h.sink.wait_for("done").await;
    let results = h.sink.tool_results();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].0, "column_list");
    assert!(results[0].2);
    assert!(
        results[0].1.starts_with("Error (device_unavailable)"),
        "{}",
        results[0].1
    );
    assert_eq!(results[1].0, "time_now");
    assert!(!results[1].2);
}
