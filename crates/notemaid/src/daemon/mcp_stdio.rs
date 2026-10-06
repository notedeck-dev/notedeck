//! `notemaid mcp`: stdio の MCP サーバー (#513)。
//!
//! Claude Desktop / Cline など stdio が標準の MCP クライアントは、サーバーを
//! 子プロセスとして起動し、stdin / stdout の改行区切り JSON-RPC で話す。
//! NoteDeck の MCP 本体は動いているアプリの `POST /mcp` (Streamable HTTP、
//! セッション無し) なので、ここでは stdin の 1 行を 1 つの POST に写し、
//! 返事をそのまま stdout に 1 行で書くだけ。状態は持たない。
//!
//! 認証は権限設定で発行した永続 API トークン (`--token` か `NOTEDECK_API_TOKEN`)。
//! アプリが起動していないときは、要求ごとに JSON-RPC のエラーで答える
//! (クライアントの画面に理由が出る。通知には答えない)。

use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::time::Duration;

#[derive(clap::Args, Debug, Clone, Default)]
pub struct McpArgs {
    /// NoteDeck の MCP エンドポイント (既定: 内蔵 HTTP サーバーの /mcp)
    #[arg(long)]
    pub url: Option<String>,
    /// 永続 API トークン (権限設定で発行)。省略時は環境変数 NOTEDECK_API_TOKEN
    #[arg(long)]
    pub token: Option<String>,
}

/// 1 つの要求の転送結果
#[derive(Debug, PartialEq)]
pub enum Reply {
    /// 返事を stdout に書く
    Body(String),
    /// 通知 (id 無し) だったので何も書かない
    Nothing,
}

/// stdin の 1 行を `/mcp` に転送し、stdout に書くものを返す。
/// HTTP 層の失敗は、要求に id があれば JSON-RPC のエラーに写す。
pub async fn forward(client: &reqwest::Client, url: &str, token: &str, line: &str) -> Reply {
    let id = request_id(line);
    let res = client
        .post(url)
        .bearer_auth(token)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .body(line.to_string())
        .send()
        .await;
    match res {
        Ok(res) if res.status() == reqwest::StatusCode::ACCEPTED => Reply::Nothing,
        Ok(res) => {
            let status = res.status();
            match res.text().await {
                Ok(body) if !body.trim().is_empty() => Reply::Body(body.trim().to_string()),
                Ok(_) => match id {
                    Some(id) => Reply::Body(rpc_error(
                        id,
                        -32000,
                        &format!("empty reply from NoteDeck ({status})"),
                    )),
                    None => Reply::Nothing,
                },
                Err(e) => match id {
                    Some(id) => {
                        Reply::Body(rpc_error(id, -32000, &format!("reading reply failed: {e}")))
                    }
                    None => Reply::Nothing,
                },
            }
        }
        Err(e) => match id {
            Some(id) => {
                let message = if e.is_connect() {
                    format!("NoteDeck is not running (cannot connect to {url})")
                } else {
                    format!("request to NoteDeck failed: {e}")
                };
                Reply::Body(rpc_error(id, -32000, &message))
            }
            None => Reply::Nothing,
        },
    }
}

/// 行の JSON-RPC id (通知なら None)。壊れた JSON は id: null として扱い、
/// サーバー側の parse error をそのまま返せるよう id を Null にする
fn request_id(line: &str) -> Option<Value> {
    match serde_json::from_str::<Value>(line) {
        Ok(Value::Object(m)) => m.get("id").cloned(),
        Ok(Value::Array(items)) => {
            // バッチは 1 つでも id があれば答えが要る
            items
                .iter()
                .any(|v| v.get("id").is_some())
                .then_some(Value::Null)
        }
        _ => Some(Value::Null),
    }
}

fn rpc_error(id: Value, code: i64, message: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }).to_string()
}

pub fn run(args: McpArgs) -> i32 {
    let token = args
        .token
        .or_else(|| std::env::var("NOTEDECK_API_TOKEN").ok())
        .filter(|t| !t.trim().is_empty());
    let Some(token) = token else {
        eprintln!("notemaid mcp: no API token. Pass --token or set NOTEDECK_API_TOKEN (issue one in NoteDeck: Settings → Permissions → API tokens)");
        return crate::daemon::exit::FAILURE;
    };
    let url = args.url.unwrap_or_else(notecore::http_server::mcp_url);
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("runtime: {e}");
            return crate::daemon::exit::FAILURE;
        }
    };
    // tools/call は NoteDeck 側の確認ダイアログを人が押すまで返らない。
    // サーバーの上限 (30 分) に揃える
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(30 * 60))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("http client: {e}");
            return crate::daemon::exit::FAILURE;
        }
    };
    // stdin / stdout は同期で読み書きする (1 行 = 1 要求、順に処理)
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if let Reply::Body(body) = rt.block_on(forward(&client, &url, &token, &line)) {
            if writeln!(out, "{body}").is_err() || out.flush().is_err() {
                break;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// 1 要求だけ受けて固定の返事を返す最小の HTTP サーバー。受けた body と
    /// Authorization を返す
    async fn one_shot_server(
        status: &'static str,
        body: &'static str,
    ) -> (String, tokio::task::JoinHandle<(String, String)>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 1024];
            loop {
                let n = sock.read(&mut tmp).await.unwrap();
                buf.extend_from_slice(&tmp[..n]);
                let text = String::from_utf8_lossy(&buf).to_string();
                if let Some((head, rest)) = text.split_once("\r\n\r\n") {
                    let len = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if rest.len() >= len || n == 0 {
                        let auth = head
                            .lines()
                            .find_map(|l| {
                                l.strip_prefix("authorization: ")
                                    .or_else(|| l.strip_prefix("Authorization: "))
                            })
                            .unwrap_or("")
                            .to_string();
                        let reply = format!(
                            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        sock.write_all(reply.as_bytes()).await.unwrap();
                        return (rest[..len.min(rest.len())].to_string(), auth);
                    }
                }
            }
        });
        (format!("http://{addr}/mcp"), handle)
    }

    #[tokio::test]
    async fn forwards_a_request_with_the_bearer_token_and_returns_the_body() {
        let (url, server) =
            one_shot_server("200 OK", r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#).await;
        let client = reqwest::Client::new();
        let line = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;
        let reply = forward(&client, &url, "tok-123", line).await;
        assert_eq!(
            reply,
            Reply::Body(r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#.into())
        );
        let (received, auth) = server.await.unwrap();
        assert_eq!(received, line);
        assert_eq!(auth, "Bearer tok-123");
    }

    #[tokio::test]
    async fn a_notification_answered_with_202_writes_nothing() {
        let (url, server) = one_shot_server("202 Accepted", "").await;
        let client = reqwest::Client::new();
        let reply = forward(
            &client,
            &url,
            "t",
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        )
        .await;
        assert_eq!(reply, Reply::Nothing);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn when_notedeck_is_down_a_request_gets_a_json_rpc_error_with_its_id() {
        // 誰も listen していないポート
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        drop(listener);
        let client = reqwest::Client::new();
        let reply = forward(
            &client,
            &url,
            "t",
            r#"{"jsonrpc":"2.0","id":"abc","method":"tools/list"}"#,
        )
        .await;
        let Reply::Body(body) = reply else {
            panic!("expected an error body")
        };
        let v: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(v["id"], "abc");
        assert_eq!(v["error"]["code"], -32000);
        assert!(v["error"]["message"]
            .as_str()
            .unwrap()
            .contains("not running"));
        // 通知には答えない
        let reply = forward(
            &client,
            &url,
            "t",
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        )
        .await;
        assert_eq!(reply, Reply::Nothing);
    }

    #[test]
    fn request_id_reads_scalar_ids_and_treats_broken_json_as_null_id() {
        assert_eq!(request_id(r#"{"id":7,"method":"x"}"#), Some(json!(7)));
        assert_eq!(request_id(r#"{"id":"s","method":"x"}"#), Some(json!("s")));
        assert_eq!(request_id(r#"{"method":"x"}"#), None);
        assert_eq!(request_id("not json"), Some(Value::Null));
        assert_eq!(
            request_id(r#"[{"id":1},{"method":"n"}]"#),
            Some(Value::Null)
        );
        assert_eq!(request_id(r#"[{"method":"n"}]"#), None);
    }
}
