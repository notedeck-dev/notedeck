//! `notecored status`: socket に繋いで状態を表示する。

use notecore::rpc::Frame;
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

use crate::rpc_server::default_socket_path;
use crate::SocketArgs;

pub fn status(args: SocketArgs) -> i32 {
    let Some(socket) = args.socket.or_else(default_socket_path) else {
        eprintln!("no socket path: set --socket or XDG_RUNTIME_DIR");
        return crate::exit::RUNTIME_DIR_MISSING;
    };
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("runtime: {e}");
            return crate::exit::FAILURE;
        }
    };
    rt.block_on(async move {
        let stream = match UnixStream::connect(&socket).await {
            Ok(s) => s,
            Err(e) => {
                println!(
                    "{}",
                    json!({ "running": false, "socket": socket.display().to_string(), "error": e.to_string() })
                );
                return crate::exit::FAILURE;
            }
        };
        let (reader, mut writer) = stream.into_split();
        let mut lines = BufReader::new(reader).lines();
        let Ok(Some(first)) = lines.next_line().await else {
            eprintln!("no hello from notecored");
            return crate::exit::FAILURE;
        };
        let secret = match serde_json::from_str::<Frame>(&first) {
            Ok(Frame::Hello { secret, .. }) => secret,
            _ => {
                eprintln!("unexpected first frame: {first}");
                return crate::exit::FAILURE;
            }
        };
        let req = Frame::Request {
            id: 1,
            secret,
            name: "notecored.status".into(),
            params: json!({}),
            window: None,
        };
        let mut line = serde_json::to_string(&req).unwrap_or_default();
        line.push('\n');
        if writer.write_all(line.as_bytes()).await.is_err() {
            return crate::exit::FAILURE;
        }
        while let Ok(Some(l)) = lines.next_line().await {
            if let Ok(Frame::Response { id: 1, outcome }) = serde_json::from_str::<Frame>(&l) {
                match outcome.result {
                    Some(v) => println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default()),
                    None => println!("{}", json!({ "running": true, "error": outcome.error })),
                }
                return 0;
            }
        }
        crate::exit::FAILURE
    })
}
