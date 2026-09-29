//! 手元の CLI (ハーネス) の一覧と検出 (#1104)。
//!
//! ACP (Agent Client Protocol) を stdio で話すエージェントを、NoteDeck は「接続」の 1 種として
//! 扱う (`activeConnectionId = "harness:<id>"`)。組み込みの定義は公式 CLI か公式アダプタを
//! そのまま起動する形だけで、CLI が持つ資格情報には触れない (規約の線引き、#1104)。
//! 利用者が ai.json5 の `harnesses` に自分のコマンドを足すこともできる。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const ID_PREFIX: &str = "harness:";

/// 接続ピッカーに並べる 1 件。`available` が false なら `detail` に足りないものを書く
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInfo {
    /// `claude-code` など。接続 id は `harness:` + これ
    pub id: String,
    pub name: String,
    /// 起動コマンド (PATH で解決した実体、または利用者の指定)
    pub command: String,
    pub args: Vec<String>,
    pub available: bool,
    /// 使えないときの理由 / 補足 (英語のまま。開発者向け)
    pub detail: Option<String>,
    /// 利用者が ai.json5 に書いた定義か
    pub custom: bool,
}

impl HarnessInfo {
    pub fn connection_id(&self) -> String {
        format!("{ID_PREFIX}{}", self.id)
    }
}

/// 接続 id が手元の CLI を指すなら harness id を返す
pub fn harness_id(connection_id: &str) -> Option<&str> {
    connection_id.strip_prefix(ID_PREFIX)
}

/// 組み込みの定義。`requires` の全部が PATH に見つかれば使える
struct Builtin {
    id: &'static str,
    name: &'static str,
    /// 起動する実行ファイル (PATH で解決)
    command: &'static str,
    args: &'static [&'static str],
    /// ほかに PATH に要るもの (CLI 本体など。起動には使わない)
    requires: &'static [&'static str],
    hint: &'static str,
}

const BUILTINS: &[Builtin] = &[
    Builtin {
        id: "claude-code",
        name: "Claude Code",
        command: "npx",
        args: &["-y", "@agentclientprotocol/claude-agent-acp"],
        requires: &["claude"],
        hint: "needs the `claude` CLI (logged in) and `npx`",
    },
    Builtin {
        id: "codex",
        name: "Codex",
        command: "npx",
        args: &["-y", "@agentclientprotocol/codex-acp"],
        requires: &["codex"],
        hint: "needs the `codex` CLI (logged in) and `npx`",
    },
    Builtin {
        id: "opencode",
        name: "OpenCode",
        command: "opencode",
        args: &["acp"],
        requires: &[],
        hint: "needs the `opencode` CLI",
    },
    Builtin {
        id: "gemini",
        name: "Gemini CLI",
        command: "gemini",
        args: &["--experimental-acp"],
        requires: &[],
        hint: "needs the `gemini` CLI (logged in)",
    },
    Builtin {
        id: "hermes",
        name: "Hermes Agent",
        command: "hermes",
        args: &["acp"],
        requires: &[],
        hint: "needs the `hermes` CLI",
    },
];

/// 利用者の定義 (ai.json5 の `harnesses[]`)
#[derive(Debug, Clone, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CustomHarness {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
}

/// PATH から実行ファイルを探す (Windows は PATHEXT も見る)
pub fn find_in_path(name: &str) -> Option<PathBuf> {
    find_in(
        name,
        std::env::var_os("PATH").as_deref(),
        std::env::var_os("PATHEXT").as_deref(),
    )
}

fn find_in(
    name: &str,
    path: Option<&std::ffi::OsStr>,
    pathext: Option<&std::ffi::OsStr>,
) -> Option<PathBuf> {
    let p = Path::new(name);
    if p.components().count() > 1 {
        return p.is_file().then(|| p.to_path_buf());
    }
    let exts: Vec<String> = if cfg!(windows) {
        let mut v: Vec<String> = pathext
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_lowercase())
            .collect();
        v.insert(0, String::new());
        v
    } else {
        vec![String::new()]
    };
    for dir in std::env::split_paths(path?) {
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 組み込み + 利用者の定義を、使えるかどうかの判定つきで返す
pub fn list(custom: &[CustomHarness]) -> Vec<HarnessInfo> {
    let mut out: Vec<HarnessInfo> = BUILTINS
        .iter()
        .map(|b| {
            let command = find_in_path(b.command);
            let missing: Vec<&str> = b
                .requires
                .iter()
                .copied()
                .filter(|r| find_in_path(r).is_none())
                .collect();
            let available = command.is_some() && missing.is_empty();
            let detail = if available {
                None
            } else {
                let mut need: Vec<String> = Vec::new();
                if command.is_none() {
                    need.push(format!("`{}` not found in PATH", b.command));
                }
                for m in missing {
                    need.push(format!("`{m}` not found in PATH"));
                }
                Some(format!("{} ({})", b.hint, need.join(", ")))
            };
            HarnessInfo {
                id: b.id.into(),
                name: b.name.into(),
                command: command
                    .map(|p| p.display().to_string())
                    .unwrap_or_else(|| b.command.into()),
                args: b.args.iter().map(|s| s.to_string()).collect(),
                available,
                detail,
                custom: false,
            }
        })
        .collect();
    for c in custom {
        if c.id.trim().is_empty() || c.command.trim().is_empty() {
            continue;
        }
        let command = find_in_path(&c.command);
        let available = command.is_some();
        out.push(HarnessInfo {
            id: c.id.clone(),
            name: if c.name.trim().is_empty() {
                c.id.clone()
            } else {
                c.name.clone()
            },
            command: command
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| c.command.clone()),
            args: c.args.clone(),
            available,
            detail: (!available).then(|| format!("`{}` not found in PATH", c.command)),
            custom: true,
        });
    }
    out
}

/// id で 1 件引く (無ければ None)
pub fn find(custom: &[CustomHarness], id: &str) -> Option<HarnessInfo> {
    list(custom).into_iter().find(|h| h.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_executables_on_the_given_path_only() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join(if cfg!(windows) {
            "mytool.cmd"
        } else {
            "mytool"
        });
        std::fs::write(&exe, "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let path = std::env::join_paths([dir.path()]).unwrap();
        assert_eq!(
            find_in(
                "mytool",
                Some(path.as_os_str()),
                Some(std::ffi::OsStr::new(".CMD;.EXE"))
            ),
            Some(exe.clone())
        );
        assert!(find_in("nope", Some(path.as_os_str()), None).is_none());
        // 絶対パスはそのまま
        assert_eq!(
            find_in(exe.to_str().unwrap(), Some(path.as_os_str()), None),
            Some(exe)
        );
    }

    #[test]
    fn custom_entries_join_the_builtins_and_report_missing_commands() {
        let custom = vec![
            CustomHarness {
                id: "mine".into(),
                name: "".into(),
                command: "definitely-not-a-real-binary-xyz".into(),
                args: vec!["acp".into()],
            },
            CustomHarness {
                id: "".into(),
                ..Default::default()
            },
        ];
        let all = list(&custom);
        assert!(all.iter().any(|h| h.id == "claude-code" && !h.custom));
        let mine = all.iter().find(|h| h.id == "mine").unwrap();
        assert!(mine.custom && !mine.available);
        assert_eq!(mine.name, "mine");
        assert_eq!(mine.connection_id(), "harness:mine");
        assert!(all.iter().all(|h| !h.id.is_empty()));
        assert_eq!(harness_id("harness:codex"), Some("codex"));
        assert_eq!(harness_id("01ABC"), None);
    }
}
