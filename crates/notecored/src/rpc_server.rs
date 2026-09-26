//! RPC 面 (Unix socket、#1106 §4.3)。接続ごとに所有者 (uid) を照合し、起動毎の秘密を
//! hello で渡す。要求はコマンド表の JSON アダプタに流し、notecore のイベントは
//! 全セッションに押し出す。

use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Arc;

use notecore::commands::{self, CallContext};
use notecore::context::Core;
use notecore::rpc::{BatchItem, Frame, Outcome, RpcError, SELF_PREFIX};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

use crate::sinks::Events;

pub use notecore::rpc::default_socket_path;

pub type StatusFn = Arc<dyn Fn() -> Value + Send + Sync>;

pub struct RpcServer {
    pub core: Arc<Core>,
    pub events: Events,
    pub secret: String,
    pub socket: PathBuf,
    pub status: StatusFn,
}

impl RpcServer {
    /// 置き場を用意して bind する。残骸の socket は繋がらなければ消す
    pub async fn bind(&self) -> std::io::Result<UnixListener> {
        if let Some(dir) = self.socket.parent() {
            std::fs::create_dir_all(dir)?;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        if self.socket.exists() {
            if UnixStream::connect(&self.socket).await.is_ok() {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::AddrInUse,
                    "another notecored is answering on the socket",
                ));
            }
            std::fs::remove_file(&self.socket)?;
        }
        let listener = UnixListener::bind(&self.socket)?;
        std::fs::set_permissions(&self.socket, std::fs::Permissions::from_mode(0o600))?;
        Ok(listener)
    }

    pub async fn serve(
        self: Arc<Self>,
        listener: UnixListener,
        shutdown: notecore::shutdown::ShutdownToken,
    ) {
        loop {
            let accepted = tokio::select! {
                _ = shutdown.clone().cancelled() => break,
                r = listener.accept() => r,
            };
            match accepted {
                Ok((stream, _)) => {
                    let server = self.clone();
                    tokio::spawn(async move { server.session(stream).await });
                }
                Err(e) => {
                    tracing::warn!("[rpc] accept failed: {e}");
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
        let _ = std::fs::remove_file(&self.socket);
    }

    async fn session(self: Arc<Self>, stream: UnixStream) {
        // 所有者の照合: 同じ uid だけ (仕様 §4.3)
        match stream.peer_cred() {
            Ok(cred) if cred.uid() == unsafe { libc::getuid() } => {}
            Ok(cred) => {
                tracing::warn!(
                    uid = cred.uid(),
                    "[rpc] refused connection from another uid"
                );
                return;
            }
            Err(e) => {
                tracing::warn!("[rpc] peer credentials unavailable: {e}");
                return;
            }
        }
        let (reader, mut writer) = stream.into_split();
        let (tx, mut rx) = mpsc::channel::<Frame>(1024);
        let hello = Frame::Hello {
            protocol: notecore::rpc::PROTOCOL_VERSION,
            secret: self.secret.clone(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            fingerprint: notecore::rpc::manifest_fingerprint(),
        };
        if tx.send(hello).await.is_err() {
            return;
        }
        // 書き手: 応答とイベントを 1 本に
        let mut events = self.events.0.subscribe();
        let writer_task = tokio::spawn(async move {
            loop {
                let frame = tokio::select! {
                    f = rx.recv() => match f { Some(f) => f, None => break },
                    e = events.recv() => match e {
                        Ok(f) => f,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!(dropped = n, "[rpc] session lagged; events dropped");
                            continue;
                        }
                        Err(_) => break,
                    },
                };
                let mut line = match serde_json::to_string(&frame) {
                    Ok(l) => l,
                    Err(_) => continue,
                };
                line.push('\n');
                if writer.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
            }
        });
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let frame: Frame = match serde_json::from_str(&line) {
                Ok(f) => f,
                Err(e) => {
                    tracing::warn!("[rpc] bad frame: {e}");
                    continue;
                }
            };
            let server = self.clone();
            let tx = tx.clone();
            tokio::spawn(async move {
                if let Some(reply) = server.handle(frame).await {
                    let _ = tx.send(reply).await;
                }
            });
        }
        drop(tx);
        let _ = writer_task.await;
    }

    async fn handle(&self, frame: Frame) -> Option<Frame> {
        match frame {
            Frame::Request {
                id,
                secret,
                name,
                params,
                window,
            } => {
                let outcome = if secret != self.secret {
                    Outcome::failure(unauthorized())
                } else {
                    self.call(&name, params, window).await
                };
                Some(Frame::Response { id, outcome })
            }
            Frame::Batch { id, secret, items } => {
                let outcome = if secret != self.secret {
                    Outcome::failure(unauthorized())
                } else {
                    let mut results = Vec::with_capacity(items.len());
                    for BatchItem {
                        name,
                        params,
                        window,
                    } in items
                    {
                        results.push(self.call(&name, params, window).await);
                    }
                    Outcome::success(serde_json::to_value(results).unwrap_or(Value::Null))
                };
                Some(Frame::Response { id, outcome })
            }
            _ => None,
        }
    }

    async fn call(&self, name: &str, params: Value, window: Option<String>) -> Outcome {
        if let Some(own) = name.strip_prefix(SELF_PREFIX) {
            return match own {
                "status" => Outcome::success((self.status)()),
                "ping" => Outcome::success(json!({ "pong": true })),
                _ => Outcome::failure(RpcError {
                    code: "INVALID_INPUT".into(),
                    message: format!("unknown daemon request: {name}"),
                    i18n: None,
                }),
            };
        }
        let ctx = CallContext { window };
        match commands::dispatch(&self.core, &ctx, name, params).await {
            Ok(v) => Outcome::success(v),
            Err(e) => Outcome::failure(RpcError::from(&e)),
        }
    }
}

fn unauthorized() -> RpcError {
    RpcError {
        code: "UNAUTHORIZED".into(),
        message: "secret does not match this notecored".into(),
        i18n: None,
    }
}

/// 起動毎の秘密 (hello で渡す)
pub fn new_secret() -> String {
    rand::random::<[u8; 32]>()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
