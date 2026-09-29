//! notemaid の受け入れ (段階 3a 順序 2): 実バイナリを空のデータディレクトリで起動し、
//! socket 越しに status とコマンド表を叩き、SIGTERM で行儀よく止まり、二重起動は
//! ロック衝突の終了コードで抜けること。

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use notecore::rpc::Frame;
use serde_json::{json, Value};

fn spawn(data_dir: &Path, socket: &Path) -> Child {
    Command::new(env!("CARGO_BIN_EXE_notemaid"))
        .args(["run", "--log", "stdout"])
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--socket")
        .arg(socket)
        .arg("--secret-key-file")
        .arg(data_dir.join("test-secret.key"))
        .env("RUST_LOG", "warn")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn notemaid")
}

fn wait_socket(socket: &Path) {
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if UnixStream::connect(socket).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("socket did not appear at {}", socket.display());
}

struct Session {
    lines: std::io::Lines<BufReader<UnixStream>>,
    writer: UnixStream,
    secret: String,
    next_id: u64,
}

impl Session {
    fn connect(socket: &Path) -> (Self, Frame) {
        let stream = UnixStream::connect(socket).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        let writer = stream.try_clone().unwrap();
        let mut lines = BufReader::new(stream).lines();
        let hello: Frame = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        let secret = match &hello {
            Frame::Hello { secret, .. } => secret.clone(),
            other => panic!("expected hello, got {other:?}"),
        };
        (
            Self {
                lines,
                writer,
                secret,
                next_id: 1,
            },
            hello,
        )
    }

    /// 要求を送り、届く `query` には `{ echo: params }` で答えながら応答を待つ
    fn request(&mut self, name: &str, params: Value, secret: Option<&str>) -> Frame {
        let id = self.next_id;
        self.next_id += 1;
        let req = Frame::Request {
            id,
            secret: secret.unwrap_or(&self.secret).to_string(),
            name: name.into(),
            params,
            window: None,
        };
        let mut line = serde_json::to_string(&req).unwrap();
        line.push('\n');
        self.writer.write_all(line.as_bytes()).unwrap();
        loop {
            let frame: Frame = serde_json::from_str(&self.lines.next().unwrap().unwrap()).unwrap();
            match frame {
                Frame::Response { id: got, .. } if got == id => return frame,
                Frame::Query {
                    id: qid, params, ..
                } => {
                    let reply = Frame::QueryResponse {
                        id: qid,
                        result: Some(json!({ "echo": params })),
                        error: None,
                    };
                    let mut line = serde_json::to_string(&reply).unwrap();
                    line.push('\n');
                    self.writer.write_all(line.as_bytes()).unwrap();
                }
                _ => {}
            }
        }
    }
}

fn outcome(frame: Frame) -> notecore::rpc::Outcome {
    match frame {
        Frame::Response { outcome, .. } => outcome,
        other => panic!("expected response, got {other:?}"),
    }
}

#[test]
fn boots_answers_over_the_socket_and_stops_on_sigterm() {
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let socket = dir.path().join("run").join("notemaid.sock");
    let mut child = spawn(&data_dir, &socket);
    wait_socket(&socket);

    let (mut s, hello) = Session::connect(&socket);
    match hello {
        Frame::Hello {
            protocol,
            fingerprint,
            version,
            ..
        } => {
            assert_eq!(protocol, notecore::rpc::PROTOCOL_VERSION);
            assert_eq!(fingerprint, notecore::rpc::manifest_fingerprint());
            assert_eq!(version, env!("CARGO_PKG_VERSION"));
        }
        _ => unreachable!(),
    }
    // 自身の状態
    let st = outcome(s.request("notemaid.status", json!({}), None));
    assert!(st.ok, "{st:?}");
    let st = st.result.unwrap();
    assert_eq!(st["running"], true);
    assert_eq!(st["dataDir"], data_dir.display().to_string());
    assert_eq!(st["exitCodes"][0]["name"], "lock_held");
    // AI 系のコマンド表 (セッション一覧: 空の一覧が返る)
    let r = outcome(s.request("ai_sessions_load_all", json!({}), None));
    assert!(r.ok, "{r:?}");
    assert!(r.result.unwrap().as_array().unwrap().is_empty());
    // データ系はデバイスの notecore が持つ: 中継しない
    let r = outcome(s.request(
        "api_note_identity",
        json!({ "uri": "https://example.com/notes/abc" }),
        None,
    ));
    assert!(!r.ok);
    // 橋の問い合わせが接続中の端末 (このセッション) に届いて答えが返る
    let r = outcome(s.request("notemaid.probe-device", json!({ "hello": 1 }), None));
    assert!(r.ok, "{r:?}");
    assert_eq!(r.result.unwrap()["echo"]["hello"], 1);
    let st = outcome(s.request("notemaid.status", json!({}), None))
        .result
        .unwrap();
    assert_eq!(st["devices"], 1);
    // 未知のコマンドと秘密の不一致
    let r = outcome(s.request("no_such_command", json!({}), None));
    assert!(!r.ok);
    assert_eq!(r.error.as_ref().unwrap().code, "INVALID_INPUT");
    let r = outcome(s.request("ai_sessions_load_all", json!({}), Some("wrong")));
    assert_eq!(r.error.as_ref().unwrap().code, "UNAUTHORIZED");
    // 公開 API 面の永続トークン (external principal) は RPC 面では通らない (仕様 §4.3 の golden)
    let (_, external_token) = notecore::api_tokens::ApiTokenStore::load(&data_dir)
        .create("golden")
        .unwrap();
    let r = outcome(s.request("ai_sessions_load_all", json!({}), Some(&external_token)));
    assert!(!r.ok);
    assert_eq!(r.error.as_ref().unwrap().code, "UNAUTHORIZED");
    // hello の秘密を差し替えて繋ぎ直しても、秘密は起動毎で同じ値
    let (mut s2, _) = Session::connect(&socket);
    assert_eq!(s2.secret, s.secret);
    let r = outcome(s2.request("ai_sessions_load_all", json!({}), Some(&external_token)));
    assert_eq!(r.error.as_ref().unwrap().code, "UNAUTHORIZED");
    drop(s2);
    // データディレクトリのロックが取られ、secret の鍵は指定した場所に生成されている
    assert!(data_dir.join("notemaid.lock").exists());
    assert!(data_dir.join("test-secret.key").exists());

    // 二重起動はロック衝突の終了コードで抜ける
    let second_socket = dir.path().join("run").join("second.sock");
    let second = spawn(&data_dir, &second_socket)
        .wait_with_output()
        .expect("second instance");
    assert_eq!(second.status.code(), Some(10));

    // SIGTERM で行儀よく止まり socket を消す
    unsafe {
        libc::kill(child.id() as i32, libc::SIGTERM);
    }
    let status = child.wait().unwrap();
    assert_eq!(status.code(), Some(0));
    assert!(!socket.exists());
}

#[test]
fn refuses_to_start_without_a_socket_location() {
    let dir = tempfile::tempdir().unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_notemaid"))
        .args(["run", "--log", "stdout"])
        .arg("--data-dir")
        .arg(dir.path().join("data"))
        .env_remove("XDG_RUNTIME_DIR")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(12));
}

/// アプリの子プロセスとしての契約: `--exit-on-stdin-close` で起動し、親が stdin の
/// 書き口を閉じたら自分から終わる (kill しなくてよい)。socket も片付ける
#[test]
fn exits_when_the_parent_closes_stdin() {
    use std::io::Write;
    let dir = tempfile::tempdir().unwrap();
    let data_dir = dir.path().join("data");
    let socket = dir.path().join("run").join("child.sock");
    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_notemaid"))
        .args(["run", "--log", "stdout", "--exit-on-stdin-close"])
        .arg("--data-dir")
        .arg(&data_dir)
        .arg("--socket")
        .arg(&socket)
        .arg("--secret-key-file")
        .arg(data_dir.join("test-secret.key"))
        .env("RUST_LOG", "warn")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("spawn notemaid");
    wait_socket(&socket);
    // 親が生きている間は繋がる
    let (mut s, _) = Session::connect(&socket);
    let st = outcome(s.request("notemaid.status", json!({}), None));
    assert!(st.ok, "{st:?}");
    drop(s);
    // 書き口を閉じる = 親の死
    let mut stdin = child.stdin.take().unwrap();
    let _ = stdin.flush();
    drop(stdin);
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "child did not exit after stdin closed"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    };
    assert_eq!(status.code(), Some(0));
    assert!(!socket.exists());
}
