//! 手元の CLI (#1104) が自分で回した tool 呼び出しを、通常経路と同じ `tool_use` /
//! `tool_result` のイベントとセッションのメッセージに写す。
//!
//! CLI は tool を並列に走らせることがあるが、デバイスの写し (`useAiTurn`) は
//! 「tool_use の次は必ずその tool_result」の順しか扱えないので、ここで 1 件ずつに
//! 直列化する: 表示中の tool が終わるまで次の tool は待たせ、その間に届いた本文は
//! 貯めておいて tool_result の直後に流す。採番は通常経路と同じで、tool 1 件が
//! 1 ラウンドを消費する (`{turn}-a{round}-0` / `{turn}-r{round}-0`、続く本文は
//! `{turn}-a{round+1}`)。

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::{
    assistant_message_id, session_message, tool_result_message_id, tool_use_message_id,
    AiTurnEvent, AiTurnSink, LiveText, SessionSink,
};
use crate::ai_sessions::SessionMessage;

/// CLI が始めた tool 呼び出し
#[derive(Debug, Clone)]
pub(super) struct ToolCall {
    pub id: String,
    /// 通常経路の tool 名 (NoteDeck の capability なら `notes_search` の形、
    /// CLI 自身の tool ならその名前)
    pub name: String,
    pub input: Value,
}

/// tool の結果 (CLI が実行済み)
#[derive(Debug, Clone)]
pub(super) struct ToolOutcome {
    pub text: String,
    pub is_error: bool,
}

/// 届け先 (ターンのイベント / 進行中の本文 / セッションの書き手)
pub(super) struct Ctx<'a> {
    pub sink: &'a dyn AiTurnSink,
    pub live: &'a Arc<Mutex<LiveText>>,
    pub sessions: &'a dyn SessionSink,
}

impl Ctx<'_> {
    fn persist(&self, messages: Vec<SessionMessage>) {
        let session_id = self.live.lock().ok().and_then(|l| l.session_id.clone());
        let Some(sid) = session_id else { return };
        if let Err(e) = self.sessions.append(&sid, messages) {
            tracing::warn!(session_id = sid, "ai session write failed: {e}");
        }
    }
}

struct Open {
    call: ToolCall,
    round: u32,
}

pub(super) struct ExternalTools {
    turn_id: String,
    /// 最初の tool が使うラウンド番号 (= 開始時の `state.rounds`)
    round_base: u32,
    /// 見せた tool の数 (= 消費したラウンド数)
    shown: u32,
    /// 表示中 (tool_use を出し、tool_result 待ち)
    open: Option<Open>,
    /// 表示待ち
    queue: VecDeque<ToolCall>,
    /// 表示前に届いた結果
    early: HashMap<String, ToolOutcome>,
    /// 表示中に届いた本文 (tool_result の直後に流す)
    buffer: String,
    /// 閉じた tool の id (遅れて届く更新は無視)
    done: HashSet<String>,
}

impl ExternalTools {
    pub fn new(turn_id: &str, round_base: u32) -> Self {
        Self {
            turn_id: turn_id.to_string(),
            round_base,
            shown: 0,
            open: None,
            queue: VecDeque::new(),
            early: HashMap::new(),
            buffer: String::new(),
            done: HashSet::new(),
        }
    }

    /// 本文の断片。tool を表示中なら貯める
    pub fn delta(&mut self, text: &str, ctx: &Ctx<'_>) {
        if self.open.is_some() {
            self.buffer.push_str(text);
            return;
        }
        emit_delta(&self.turn_id, text, ctx);
    }

    /// CLI が tool を始めた
    pub fn call(&mut self, call: ToolCall, ctx: &Ctx<'_>) {
        if self.done.contains(&call.id) || self.is_known(&call.id) {
            return;
        }
        if self.open.is_some() {
            self.queue.push_back(call);
        } else {
            self.show(call, ctx);
        }
    }

    /// tool の結果。表示前なら取り置き、未知の id でも名前があればカードを起こす
    pub fn result(
        &mut self,
        id: &str,
        call: Option<ToolCall>,
        outcome: ToolOutcome,
        ctx: &Ctx<'_>,
    ) {
        if self.done.contains(id) {
            return;
        }
        if self.open.as_ref().is_some_and(|o| o.call.id == id) {
            self.finish(outcome, ctx);
            return;
        }
        if !self.is_known(id) {
            let Some(call) = call else {
                tracing::debug!(
                    tool_call_id = id,
                    "dropped a CLI tool result for an unknown call"
                );
                return;
            };
            self.early.insert(id.to_string(), outcome);
            self.call(call, ctx);
            return;
        }
        self.early.insert(id.to_string(), outcome);
    }

    /// provider のラウンドが終わった。結果の無い tool は失敗として閉じ、消費した
    /// ラウンド数を返す
    pub fn close(&mut self, ctx: &Ctx<'_>) -> u32 {
        let unfinished = ToolOutcome {
            text: "Error (no_result): the CLI ended its turn without a result for this tool".into(),
            is_error: true,
        };
        while self.open.is_some() {
            self.finish(unfinished.clone(), ctx);
        }
        self.queue.clear();
        self.early.clear();
        self.shown
    }

    fn is_known(&self, id: &str) -> bool {
        self.open.as_ref().is_some_and(|o| o.call.id == id) || self.queue.iter().any(|c| c.id == id)
    }

    fn show(&mut self, call: ToolCall, ctx: &Ctx<'_>) {
        let round = self.round_base + self.shown;
        self.shown += 1;
        let text = ctx
            .live
            .lock()
            .map(|mut l| {
                let t = std::mem::take(&mut l.text);
                l.message_id = assistant_message_id(&self.turn_id, round + 1);
                t
            })
            .unwrap_or_default();
        let message_id = tool_use_message_id(&self.turn_id, round, 0);
        let mut e = AiTurnEvent::new(&self.turn_id, "tool_use");
        e.text = Some(text.clone());
        e.tool_use_id = Some(call.id.clone());
        e.tool_use_name = Some(call.name.clone());
        e.tool_use_input = Some(call.input.clone());
        e.message_id = Some(message_id.clone());
        ctx.sink.emit(e);
        ctx.persist(vec![SessionMessage {
            tool_use_id: Some(call.id.clone()),
            tool_use_name: Some(call.name.clone()),
            tool_use_input: Some(call.input.clone()),
            ..session_message(message_id, "assistant", text)
        }]);
        let id = call.id.clone();
        self.open = Some(Open { call, round });
        if let Some(outcome) = self.early.remove(&id) {
            self.finish(outcome, ctx);
        }
    }

    fn finish(&mut self, outcome: ToolOutcome, ctx: &Ctx<'_>) {
        let Some(open) = self.open.take() else { return };
        let message_id = tool_result_message_id(&self.turn_id, open.round, 0);
        let mut e = AiTurnEvent::new(&self.turn_id, "tool_result");
        e.tool_use_id = Some(open.call.id.clone());
        e.text = Some(outcome.text.clone());
        e.is_error = Some(outcome.is_error);
        e.message_id = Some(message_id.clone());
        ctx.sink.emit(e);
        ctx.persist(vec![SessionMessage {
            tool_result_for: Some(open.call.id.clone()),
            ..session_message(message_id, "user", outcome.text)
        }]);
        self.done.insert(open.call.id);
        let held = std::mem::take(&mut self.buffer);
        if !held.is_empty() {
            emit_delta(&self.turn_id, &held, ctx);
        }
        if let Some(next) = self.queue.pop_front() {
            self.show(next, ctx);
        }
    }
}

fn emit_delta(turn_id: &str, text: &str, ctx: &Ctx<'_>) {
    if let Ok(mut live) = ctx.live.lock() {
        live.text.push_str(text);
    }
    let mut e = AiTurnEvent::new(turn_id, "delta");
    e.text = Some(text.to_string());
    ctx.sink.emit(e);
}
