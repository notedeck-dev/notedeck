//! アプリと別プロセスの notemaid を繋ぐ経路 (#1106 案 B)。
//!
//! Unix (Linux / macOS) は Unix socket、Windows は named pipe。どちらも改行区切り JSON
//! (`notecore::rpc::Frame`) を流す。in-process (iOS、または sidecar が無いとき) は
//! この経路を使わず、コマンド表のラッパーが直接本体を呼ぶ。
//!
//! 置き場は 2 種類: 常駐 (ログイン時のユーザータスク / 手で `notemaid run`) が使う既定の
//! 場所 [`default_endpoint`] と、アプリが子プロセスとして起動したときの
//! [`child_endpoint`] (親の pid 入り)。アプリは既定の場所を先に叩き、居なければ子を起動する。

use std::fmt;
use std::io;
use std::path::PathBuf;

use tokio::io::{AsyncRead, AsyncWrite};

pub const NAME: &str = "notemaid";

pub trait AsyncStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> AsyncStream for T {}

/// 接続の両端が使う双方向ストリーム
pub type Stream = Box<dyn AsyncStream>;

/// 繋ぐ先。文字列との相互変換は CLI の `--socket` と状態面のため
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Endpoint {
    Unix(PathBuf),
    Pipe(String),
}

impl Endpoint {
    /// `--socket` の値から。Windows の `\\.\pipe\...` は named pipe、それ以外はパス
    pub fn parse(s: &str) -> Endpoint {
        if s.starts_with(r"\\.\pipe\") {
            Endpoint::Pipe(s.to_string())
        } else {
            Endpoint::Unix(PathBuf::from(s))
        }
    }
}

impl fmt::Display for Endpoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Endpoint::Unix(p) => write!(f, "{}", p.display()),
            Endpoint::Pipe(n) => f.write_str(n),
        }
    }
}

/// 常駐 (ログイン時のユーザータスク) が待ち受ける既定の場所。
/// Unix: `$XDG_RUNTIME_DIR/notemaid/notemaid.sock` (無ければ None)。
/// Windows: `\\.\pipe\notemaid-<ユーザー名>`
pub fn default_endpoint() -> Option<Endpoint> {
    if cfg!(windows) {
        let user = std::env::var("USERNAME").unwrap_or_else(|_| "user".into());
        return Some(Endpoint::Pipe(format!(r"\\.\pipe\{NAME}-{user}")));
    }
    std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|v| !v.is_empty())
        .map(|dir| Endpoint::Unix(PathBuf::from(dir).join(NAME).join(format!("{NAME}.sock"))))
}

/// アプリが子プロセスとして起動した notemaid の場所 (親の pid 入り、親ごとに別)。
/// Unix は runtime dir が無ければ一時ディレクトリ (macOS には XDG_RUNTIME_DIR が無い)
pub fn child_endpoint(parent_pid: u32) -> Endpoint {
    if cfg!(windows) {
        return Endpoint::Pipe(format!(r"\\.\pipe\{NAME}-child-{parent_pid}"));
    }
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    Endpoint::Unix(base.join(NAME).join(format!("child-{parent_pid}.sock")))
}

/// 相手の素性。同じユーザーでなければ RPC 面は応じない
pub struct Peer {
    pub same_user: bool,
}

pub async fn connect(endpoint: &Endpoint) -> io::Result<Stream> {
    match endpoint {
        #[cfg(unix)]
        Endpoint::Unix(path) => Ok(Box::new(tokio::net::UnixStream::connect(path).await?)),
        #[cfg(windows)]
        Endpoint::Pipe(name) => {
            let client = tokio::net::windows::named_pipe::ClientOptions::new().open(name)?;
            Ok(Box::new(client))
        }
        #[allow(unreachable_patterns)]
        other => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!("{other} is not usable on this platform"),
        )),
    }
}

pub struct Listener {
    endpoint: Endpoint,
    inner: ListenerInner,
}

enum ListenerInner {
    #[cfg(unix)]
    Unix(tokio::net::UnixListener),
    #[cfg(windows)]
    Pipe {
        name: String,
        current: tokio::net::windows::named_pipe::NamedPipeServer,
    },
}

/// 待ち受けを開く。Unix は親ディレクトリを 0700、socket を 0600 にし、応答の無い古い
/// socket ファイルは消す (応答があれば AddrInUse)。Windows は最初のインスタンスを作る
pub async fn bind(endpoint: &Endpoint) -> io::Result<Listener> {
    match endpoint {
        #[cfg(unix)]
        Endpoint::Unix(path) => {
            use std::os::unix::fs::PermissionsExt;
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
                std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
            }
            if path.exists() {
                if tokio::net::UnixStream::connect(path).await.is_ok() {
                    return Err(io::Error::new(
                        io::ErrorKind::AddrInUse,
                        format!("another {NAME} is answering on the socket"),
                    ));
                }
                std::fs::remove_file(path)?;
            }
            let listener = tokio::net::UnixListener::bind(path)?;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
            Ok(Listener {
                endpoint: endpoint.clone(),
                inner: ListenerInner::Unix(listener),
            })
        }
        #[cfg(windows)]
        Endpoint::Pipe(name) => {
            // first_pipe_instance: 同名の pipe が既にあれば失敗する (二重起動の検知)
            let current = tokio::net::windows::named_pipe::ServerOptions::new()
                .first_pipe_instance(true)
                .reject_remote_clients(true)
                .create(name)?;
            Ok(Listener {
                endpoint: endpoint.clone(),
                inner: ListenerInner::Pipe {
                    name: name.clone(),
                    current,
                },
            })
        }
        #[allow(unreachable_patterns)]
        other => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!("{other} is not usable on this platform"),
        )),
    }
}

impl Listener {
    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    pub async fn accept(&mut self) -> io::Result<(Stream, Peer)> {
        match &mut self.inner {
            #[cfg(unix)]
            ListenerInner::Unix(listener) => {
                let (stream, _) = listener.accept().await?;
                // 所有者の照合: 同じ uid だけ (仕様 §4.3)
                let same_user = stream
                    .peer_cred()
                    .map(|c| c.uid() == unsafe { libc::getuid() })
                    .unwrap_or(false);
                Ok((Box::new(stream), Peer { same_user }))
            }
            #[cfg(windows)]
            ListenerInner::Pipe { name, current } => {
                current.connect().await?;
                let next =
                    tokio::net::windows::named_pipe::ServerOptions::new().create(name.as_str())?;
                let connected = std::mem::replace(current, next);
                // named pipe は作ったユーザーの既定 DACL で守られ、リモートは拒否している
                Ok((Box::new(connected), Peer { same_user: true }))
            }
        }
    }

    /// 待ち受けの後始末 (Unix は socket ファイルを消す)
    pub fn cleanup(&self) {
        if let Endpoint::Unix(path) = &self.endpoint {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pipe_names_and_paths() {
        assert_eq!(
            Endpoint::parse(r"\\.\pipe\notemaid-x"),
            Endpoint::Pipe(r"\\.\pipe\notemaid-x".into())
        );
        assert_eq!(
            Endpoint::parse("/run/x.sock"),
            Endpoint::Unix("/run/x.sock".into())
        );
        assert_eq!(Endpoint::parse("/run/x.sock").to_string(), "/run/x.sock");
    }

    #[test]
    fn child_endpoints_differ_per_parent() {
        assert_ne!(child_endpoint(1), child_endpoint(2));
        assert!(child_endpoint(7).to_string().contains("child-7"));
    }
}
