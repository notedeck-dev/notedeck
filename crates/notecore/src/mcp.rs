//! MCP サーバー (#555 / #513): 外部の AI エージェント (Claude Code / Codex / Cursor など) が
//! 動作中の NoteDeck の capability を tool として呼ぶ面。
//!
//! - transport は Streamable HTTP (`POST /mcp` に JSON-RPC、応答は JSON)。状態は持たず、
//!   session id もサーバー発のストリームも使わない (GET は 405)
//! - tool の一覧は宣言表 (`capabilities`) の `ai_tool` な capability で、AI プロバイダーに
//!   渡す tool と同じ名前 / schema。実行は既存の `capabilities/execute` (橋 → デバイスの
//!   dispatcher) で、認可と汚染は呼び手の principal の枠 (#712) がそのまま効く
//! - 認証は HTTP API と同じ Bearer。principal は永続トークンの種別が決める: 権限ウィンドウで
//!   発行した外部アプリ用は external、NoteDeck が AI として起動した手元の CLI (ACP、#1104) に
//!   渡した harness 用は ai.chat (#1188。AI 本人なので第三者向けの恒久 deny を受けない)

use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::capabilities::{self, CapabilityDecl};
use crate::frontend_bridge::FrontendBridge;
use crate::permissions_profile::PrincipalId;

/// 対応する MCP の版 (新しい順)。クライアントが挙げた版が含まれればそれを、無ければ先頭を返す
pub const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

pub const SERVER_NAME: &str = "notedeck";

/// capability の実行 (橋の往復) の上限。HTTP の `/api/capabilities/{id}/execute` と同じ
/// (確認ダイアログで人の承認を待ちうる)
const EXECUTE_TIMEOUT: Duration = crate::http_server::CAPABILITY_EXECUTE_TIMEOUT;

/// JSON-RPC のエラーコード
const PARSE_ERROR: i64 = -32700;
const INVALID_REQUEST: i64 = -32600;
const METHOD_NOT_FOUND: i64 = -32601;
const INVALID_PARAMS: i64 = -32602;

/// tool として見せる capability (AI プロバイダーに渡すものと同じ集合)
pub fn tool_decls() -> impl Iterator<Item = &'static CapabilityDecl> {
    capabilities::CAPABILITIES.iter().filter(|d| d.ai_tool)
}

/// `tools/list` の 1 件。名前と schema は Anthropic / OpenAI の tool と同じ
pub fn tool(decl: &CapabilityDecl) -> Value {
    json!({
        "name": capabilities::tool_name(decl.id),
        "title": decl.label,
        "description": decl.description,
        "inputSchema": capabilities::input_schema(decl),
    })
}

pub fn negotiate_version(requested: Option<&str>) -> &'static str {
    requested
        .and_then(|r| PROTOCOL_VERSIONS.iter().find(|v| **v == r))
        .copied()
        .unwrap_or(PROTOCOL_VERSIONS[0])
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message.into() } })
}

/// tool の実行結果 (`content` はテキスト 1 件)。失敗は `isError` で返し、JSON-RPC の
/// エラーにはしない (MCP の規約: tool の失敗はモデルに見せる結果)
fn tool_result(text: String, is_error: bool) -> Value {
    let mut m = Map::new();
    m.insert("content".into(), json!([{ "type": "text", "text": text }]));
    if is_error {
        m.insert("isError".into(), Value::Bool(true));
    }
    Value::Object(m)
}

/// JSON-RPC のメッセージを 1 つ処理する。通知 (id なし) は None (応答を返さない)。
/// `principal` は tools/call を dispatcher に渡すときの呼び手 (トークンの種別から決まる)
pub async fn handle(
    bridge: &dyn FrontendBridge,
    principal: PrincipalId,
    message: Value,
    app_version: &str,
) -> Option<Value> {
    let Some(obj) = message.as_object() else {
        return Some(rpc_error(
            Value::Null,
            INVALID_REQUEST,
            "expected a JSON-RPC object",
        ));
    };
    let id = obj.get("id").cloned();
    let Some(method) = obj.get("method").and_then(Value::as_str) else {
        // 応答 (result / error) が届いた場合も無視する
        return id.map(|id| rpc_error(id, INVALID_REQUEST, "missing method"));
    };
    let params = obj.get("params").cloned().unwrap_or(Value::Null);
    if method.starts_with("notifications/") {
        return None;
    }
    let Some(id) = id else {
        // id の無い要求は通知扱い (応答しない)
        return None;
    };
    Some(match method {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(Value::as_str);
            rpc_result(
                id,
                json!({
                    "protocolVersion": negotiate_version(requested),
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": SERVER_NAME, "version": app_version },
                    "instructions": "NoteDeck (a Misskey deck client) exposes its capabilities as tools. Reads return Misskey data; writes may ask the person for confirmation in the app and can be denied by the app's permissions.",
                }),
            )
        }
        "ping" => rpc_result(id, json!({})),
        "tools/list" => rpc_result(
            id,
            json!({ "tools": tool_decls().map(tool).collect::<Vec<_>>() }),
        ),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Some(rpc_error(id, INVALID_PARAMS, "tools/call requires name"));
            };
            let capability_id = capabilities::id_from_tool_name(name);
            let known = capabilities::find(&capability_id).is_some_and(|d| d.ai_tool);
            if !known {
                return Some(rpc_result(
                    id,
                    tool_result(format!("unknown tool: {name}"), true),
                ));
            }
            let arguments = params.get("arguments").cloned().unwrap_or(Value::Null);
            rpc_result(id, call(bridge, principal, &capability_id, arguments).await)
        }
        other => rpc_error(id, METHOD_NOT_FOUND, format!("unknown method: {other}")),
    })
}

/// capability を実行して tool の結果に写す。dispatcher の `DispatchResult`
/// (`{ok, result}` / `{ok, code, error}`) を読む (HTTP の execute と同じ)
async fn call(
    bridge: &dyn FrontendBridge,
    principal: PrincipalId,
    capability_id: &str,
    arguments: Value,
) -> Value {
    let data = match bridge
        .query(
            "capabilities/execute",
            json!({
                "capabilityId": capability_id,
                "params": arguments,
                "principal": principal.as_str(),
            }),
            EXECUTE_TIMEOUT,
        )
        .await
    {
        Ok(v) => v,
        Err(e) => return tool_result(format!("query_failed: {e}"), true),
    };
    match data.get("ok").and_then(Value::as_bool) {
        Some(true) => {
            let result = data.get("result").cloned().unwrap_or(Value::Null);
            let text = match result {
                Value::String(s) => s,
                Value::Null => "ok".into(),
                other => serde_json::to_string_pretty(&other).unwrap_or_default(),
            };
            tool_result(text, false)
        }
        Some(false) => {
            let code = data.get("code").and_then(Value::as_str).unwrap_or("error");
            let error = data.get("error").and_then(Value::as_str).unwrap_or("");
            tool_result(format!("{code}: {error}"), true)
        }
        None => {
            let error = data
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unexpected response from the app");
            tool_result(format!("execute_failed: {error}"), true)
        }
    }
}

/// HTTP の本文 (単体か配列) を処理し、応答の本文を返す。応答が無ければ None (202)
pub async fn handle_body(
    bridge: &dyn FrontendBridge,
    principal: PrincipalId,
    body: Value,
    app_version: &str,
) -> Result<Option<Value>, Value> {
    match body {
        Value::Array(items) => {
            if items.is_empty() {
                return Err(rpc_error(Value::Null, INVALID_REQUEST, "empty batch"));
            }
            let mut out = Vec::new();
            for item in items {
                if let Some(r) = handle(bridge, principal, item, app_version).await {
                    out.push(r);
                }
            }
            Ok((!out.is_empty()).then_some(Value::Array(out)))
        }
        Value::Object(_) => Ok(handle(bridge, principal, body, app_version).await),
        _ => Err(rpc_error(
            Value::Null,
            PARSE_ERROR,
            "expected a JSON-RPC message",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frontend_bridge::BridgeFuture;
    use std::sync::Mutex;

    /// 橋の偽物: 実行要求を記録し、台本の答えを返す
    struct Fake {
        calls: Mutex<Vec<Value>>,
        reply: Result<Value, String>,
    }
    impl FrontendBridge for Fake {
        fn query<'a>(&'a self, _t: &'a str, params: Value, _d: Duration) -> BridgeFuture<'a> {
            self.calls.lock().unwrap().push(params);
            let reply = self.reply.clone();
            Box::pin(async move { reply })
        }
        fn health_report(&self) -> BridgeFuture<'_> {
            Box::pin(async { Ok(Value::Null) })
        }
        fn archive_search(
            &self,
            _r: crate::frontend_bridge::ArchiveSearchRequest,
        ) -> BridgeFuture<'_> {
            Box::pin(async { Ok(json!([])) })
        }
        fn issue_harness_token(&self, _n: String) -> BridgeFuture<'_> {
            Box::pin(async { Err("no".into()) })
        }
        fn revoke_harness_token(&self, _i: String) -> BridgeFuture<'_> {
            Box::pin(async { Ok(Value::Null) })
        }
    }
    fn fake(reply: Result<Value, String>) -> Fake {
        Fake {
            calls: Mutex::new(Vec::new()),
            reply,
        }
    }
    fn req(id: i64, method: &str, params: Value) -> Value {
        json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
    }

    #[tokio::test]
    async fn initialize_negotiates_a_known_version() {
        let b = fake(Ok(Value::Null));
        let r = handle(
            &b,
            PrincipalId::External,
            req(1, "initialize", json!({ "protocolVersion": "2025-03-26" })),
            "1.2.3",
        )
        .await
        .unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(r["result"]["serverInfo"]["version"], "1.2.3");
        let r = handle(
            &b,
            PrincipalId::External,
            req(2, "initialize", json!({ "protocolVersion": "1999-01-01" })),
            "1",
        )
        .await
        .unwrap();
        assert_eq!(r["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
        assert!(r["result"]["capabilities"]["tools"].is_object());
    }

    #[tokio::test]
    async fn notifications_get_no_response_and_unknown_methods_an_error() {
        let b = fake(Ok(Value::Null));
        assert!(handle(
            &b,
            PrincipalId::External,
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
            "1"
        )
        .await
        .is_none());
        let r = handle(
            &b,
            PrincipalId::External,
            req(3, "resources/list", json!({})),
            "1",
        )
        .await
        .unwrap();
        assert_eq!(r["error"]["code"], METHOD_NOT_FOUND);
        let r = handle(&b, PrincipalId::External, req(4, "ping", json!({})), "1")
            .await
            .unwrap();
        assert_eq!(r["result"], json!({}));
    }

    #[tokio::test]
    async fn tools_list_is_the_ai_tool_set_with_the_same_names_and_schemas() {
        let b = fake(Ok(Value::Null));
        let r = handle(
            &b,
            PrincipalId::External,
            req(5, "tools/list", json!({})),
            "1",
        )
        .await
        .unwrap();
        let tools = r["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), tool_decls().count());
        let timeline = tools
            .iter()
            .find(|t| t["name"] == "notes_timeline")
            .expect("notes.timeline is an AI tool");
        let decl = capabilities::find("notes.timeline").unwrap();
        assert_eq!(timeline["inputSchema"], capabilities::input_schema(decl));
        assert!(tools
            .iter()
            .all(|t| !t["name"].as_str().unwrap().contains('.')));
        // AI に見せない capability は並ばない
        let hidden = capabilities::CAPABILITIES
            .iter()
            .find(|d| !d.ai_tool)
            .unwrap();
        let hidden_name = capabilities::tool_name(hidden.id);
        assert!(tools.iter().all(|t| t["name"] != hidden_name));
    }

    #[tokio::test]
    async fn tools_call_goes_through_the_dispatcher_and_maps_results() {
        let ok = fake(Ok(json!({ "ok": true, "result": { "notes": [1, 2] } })));
        let r = handle(
            &ok,
            PrincipalId::External,
            req(
                6,
                "tools/call",
                json!({ "name": "notes_timeline", "arguments": { "type": "home" } }),
            ),
            "1",
        )
        .await
        .unwrap();
        assert_eq!(r["result"]["isError"], Value::Null);
        assert!(r["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("\"notes\""));
        {
            let calls = ok.calls.lock().unwrap();
            assert_eq!(calls[0]["capabilityId"], "notes.timeline");
            assert_eq!(calls[0]["params"]["type"], "home");
            assert_eq!(calls[0]["principal"], "external");
        }

        let denied = fake(Ok(
            json!({ "ok": false, "code": "permission_denied", "error": "notes.write" }),
        ));
        let r = handle(
            &denied,
            PrincipalId::External,
            req(
                7,
                "tools/call",
                json!({ "name": "notes_create", "arguments": {} }),
            ),
            "1",
        )
        .await
        .unwrap();
        assert_eq!(r["result"]["isError"], true);
        assert!(r["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .starts_with("permission_denied"));

        let gone = fake(Err("no device is connected".into()));
        let r = handle(
            &gone,
            PrincipalId::External,
            req(8, "tools/call", json!({ "name": "time_now" })),
            "1",
        )
        .await
        .unwrap();
        assert_eq!(r["result"]["isError"], true);

        // 宣言に無い名前と、AI に見せない capability は dispatcher に届かない
        let r = handle(
            &ok,
            PrincipalId::External,
            req(9, "tools/call", json!({ "name": "no_such_tool" })),
            "1",
        )
        .await
        .unwrap();
        assert_eq!(r["result"]["isError"], true);
        assert_eq!(ok.calls.lock().unwrap().len(), 1);
    }

    /// 手元の CLI (ACP、#1104) のトークンで繋いだ呼び出しは AI 本人 (ai.chat) として
    /// dispatcher に届く (#1188: external だと記憶 / skill の書込が恒久 deny で袋小路)
    #[tokio::test]
    async fn harness_calls_reach_the_dispatcher_as_the_ai() {
        let ok = fake(Ok(json!({ "ok": true, "result": null })));
        let r = handle(
            &ok,
            PrincipalId::AiChat,
            req(
                10,
                "tools/call",
                json!({ "name": "memory_update", "arguments": { "action": "add", "target": "memory", "content": "x" } }),
            ),
            "1",
        )
        .await
        .unwrap();
        assert_eq!(r["result"]["isError"], Value::Null);
        let calls = ok.calls.lock().unwrap();
        assert_eq!(calls[0]["capabilityId"], "memory.update");
        assert_eq!(calls[0]["principal"], "ai.chat");
    }

    #[tokio::test]
    async fn batches_collect_responses_and_drop_notifications() {
        let b = fake(Ok(Value::Null));
        let out = handle_body(
            &b,
            PrincipalId::External,
            json!([
                { "jsonrpc": "2.0", "method": "notifications/initialized" },
                req(1, "ping", json!({}))
            ]),
            "1",
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(out.as_array().unwrap().len(), 1);
        assert!(handle_body(
            &b,
            PrincipalId::External,
            json!([{ "jsonrpc": "2.0", "method": "notifications/x" }]),
            "1"
        )
        .await
        .unwrap()
        .is_none());
        assert!(handle_body(&b, PrincipalId::External, json!("nope"), "1")
            .await
            .is_err());
    }
}
