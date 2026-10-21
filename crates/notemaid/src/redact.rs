//! 保存前の秘匿化 (#1164)。AI セッション / HEARTBEAT の状態 / ログに秘密が平文で
//! 残らないよう、書く直前に消す。表示側のマスク (useSensitiveMask) とは別で、こちらは
//! 元に戻せない。
//!
//! 検出は 2 段:
//! 1. **既知の値の完全一致**: このプロセスに流れた秘密 (Vault の api_key / Misskey の
//!    トークン / harness トークン / RPC 秘密) を [`register`] で覚え、出現したら消す。
//!    主力。誤検出が無い
//! 2. **形の規則**: 鍵らしい接頭辞 (`sk-` / `sk-ant-` / `ndp_` / `ghp_`) と
//!    `Authorization: Bearer` / `x-api-key` ヘッダ、JSON の資格情報キー
//!    (`token` / `i` / `apiKey` …) の値。保守的に、Misskey の id やハッシュを巻き込まない
//!
//! 置換は `[redacted:<種別>]`。何を消したかは分かるが、値は戻らない。

use std::borrow::Cow;
use std::sync::{LazyLock, RwLock};

use regex::Regex;
use serde_json::Value;

use crate::ai_sessions::SessionMessage;

/// これより短い既知の値は消さない (短い文字列の完全一致は誤検出になる。Vault も
/// `connections_service` が同じ下限を secret の登録時に強制する)
pub const MIN_KNOWN_LEN: usize = 16;

/// 既知の秘密の種別。置換の印に出る
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Vault の secret (AI プロバイダーの api_key)
    Vault,
    /// Misskey のアクセストークン
    MisskeyToken,
    /// 外部 CLI (ACP) に渡す MCP 用トークン
    HarnessToken,
    /// RPC の起動毎の秘密
    RpcSecret,
}

impl Kind {
    fn marker(self) -> &'static str {
        match self {
            Kind::Vault => "[redacted:vault]",
            Kind::MisskeyToken => "[redacted:misskey-token]",
            Kind::HarnessToken => "[redacted:harness-token]",
            Kind::RpcSecret => "[redacted:rpc-secret]",
        }
    }
}

const MARKER_PATTERN: &str = "[redacted:key]";
const MARKER_FIELD: &str = "[redacted:field]";

struct Known {
    kind: Kind,
    value: String,
}

static KNOWN: LazyLock<RwLock<Vec<Known>>> = LazyLock::new(|| RwLock::new(Vec::new()));

/// 形で見つける規則。`ai_chat_service` がエラー本文に掛けていた 4 つに、公開 API の
/// 永続トークン (`ndp_`) と GitHub の個人トークン (`ghp_`) を足した
static PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    vec![
        Regex::new(r"sk-ant-[A-Za-z0-9_\-]{20,}").unwrap(),
        Regex::new(r"sk-[A-Za-z0-9_\-]{20,}").unwrap(),
        Regex::new(r"ndp_[A-Za-z0-9_\-]{20,}").unwrap(),
        Regex::new(r"ghp_[A-Za-z0-9]{36}").unwrap(),
        Regex::new(r"(?i)Bearer\s+[A-Za-z0-9._\-]{20,}").unwrap(),
        Regex::new(r#"(?i)x-api-key["'\s:=]+[A-Za-z0-9_\-]{20,}"#).unwrap(),
    ]
});

/// JSON で値を丸ごと消すキー (`exec/project.rs` の strip_credentials と同じ集合)
pub const SENSITIVE_KEYS: &[&str] = &[
    "token",
    "i",
    "accessToken",
    "refreshToken",
    "apiKey",
    "password",
    "secret",
];

/// 既知の秘密を覚える。短いもの・空は無視。同じ値の再登録は無視
pub fn register(kind: Kind, value: &str) {
    if value.len() < MIN_KNOWN_LEN {
        return;
    }
    let mut known = KNOWN.write().unwrap_or_else(|e| e.into_inner());
    if known.iter().any(|k| k.value == value) {
        return;
    }
    known.push(Known {
        kind,
        value: value.to_string(),
    });
}

/// 文字列から秘密を消す。何も無ければ借用のまま返す
pub fn text(s: &str) -> Cow<'_, str> {
    let mut out: Cow<'_, str> = Cow::Borrowed(s);
    {
        let known = KNOWN.read().unwrap_or_else(|e| e.into_inner());
        for k in known.iter() {
            if out.contains(k.value.as_str()) {
                out = Cow::Owned(out.replace(k.value.as_str(), k.kind.marker()));
            }
        }
    }
    for re in PATTERNS.iter() {
        if re.is_match(&out) {
            out = Cow::Owned(re.replace_all(&out, MARKER_PATTERN).into_owned());
        }
    }
    out
}

/// JSON から秘密を消す。資格情報キーの値は型を問わず丸ごと印に置き換え、残りの文字列は
/// [`text`] に通す
pub fn value(v: Value) -> Value {
    match v {
        Value::String(s) => match text(&s) {
            Cow::Borrowed(_) => Value::String(s),
            Cow::Owned(o) => Value::String(o),
        },
        Value::Array(a) => Value::Array(a.into_iter().map(value).collect()),
        Value::Object(o) => Value::Object(
            o.into_iter()
                .map(|(k, v)| {
                    if SENSITIVE_KEYS.contains(&k.as_str()) {
                        (k, Value::String(MARKER_FIELD.into()))
                    } else {
                        (k, value(v))
                    }
                })
                .collect(),
        ),
        other => other,
    }
}

/// セッションの 1 メッセージから秘密を消す (本文 / tool の入力 / 受信箱カード)
pub fn message(mut m: SessionMessage) -> SessionMessage {
    if let Cow::Owned(o) = text(&m.content) {
        m.content = o;
    }
    m.tool_use_input = m.tool_use_input.map(value);
    m.intent = m.intent.map(value);
    m
}

/// ログの書き手を包み、1 回の書込ごとに秘匿化してから下に流す。`tracing` の fmt 層は
/// 1 イベントを 1 回の書込で渡すので、行をまたいだ秘密は想定しない
pub struct Writer<W>(pub W);

impl<W: std::io::Write> std::io::Write for Writer<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        match std::str::from_utf8(buf) {
            Ok(s) => match text(s) {
                Cow::Borrowed(_) => self.0.write_all(buf)?,
                Cow::Owned(o) => self.0.write_all(o.as_bytes())?,
            },
            Err(_) => self.0.write_all(buf)?,
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // テストは 1 つのプロセスで走るので、登録する値は衝突しないものにする
    const VAULT_KEY: &str = "test-vault-key-0123456789abcdef";
    const MISSKEY_TOKEN: &str = "mkTokenAbCdEfGhIjKlMnOpQrStUvWx";

    #[test]
    fn 既知の値は種別つきの印に置き換わる() {
        register(Kind::Vault, VAULT_KEY);
        register(Kind::MisskeyToken, MISSKEY_TOKEN);
        let s = format!("key={VAULT_KEY} token={MISSKEY_TOKEN} twice={VAULT_KEY}");
        assert_eq!(
            text(&s),
            "key=[redacted:vault] token=[redacted:misskey-token] twice=[redacted:vault]"
        );
    }

    #[test]
    fn 短い既知の値は登録されない() {
        register(Kind::Vault, "short");
        assert_eq!(text("a short value"), "a short value");
    }

    #[test]
    fn 何も無ければ借用のまま() {
        assert!(matches!(text("plain text"), Cow::Borrowed(_)));
    }

    #[test]
    fn 鍵らしい形は印に置き換わる() {
        let s = "a sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123 b sk-abcdefghijklmnopqrstuvwxyz \
                 c ndp_abcdefghijklmnopqrstuvwxyz d ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ \
                 e Authorization: Bearer abcdefghij.klmnopqrstuvwxyz f x-api-key: abcdefghijklmnopqrstu";
        let out = text(s);
        assert!(!out.contains("sk-"), "{out}");
        assert!(!out.contains("ndp_"), "{out}");
        assert!(!out.contains("ghp_"), "{out}");
        assert!(!out.contains("abcdefghij.klmnopqrstuvwxyz"), "{out}");
        assert!(!out.contains("abcdefghijklmnopqrstu"), "{out}");
        assert_eq!(out.matches("[redacted:key]").count(), 6, "{out}");
    }

    #[test]
    fn ノート_id_やハッシュは消さない() {
        let s = "note 9xk2abcd1234efgh user a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 ok";
        assert_eq!(text(s), s);
    }

    #[test]
    fn json_の資格情報キーは型を問わず丸ごと消える() {
        let v = json!({
            "i": "anything",
            "nested": { "apiKey": 42, "list": [{ "token": "x" }, "keep"] },
            "name": "keep me"
        });
        assert_eq!(
            value(v),
            json!({
                "i": "[redacted:field]",
                "nested": { "apiKey": "[redacted:field]", "list": [{ "token": "[redacted:field]" }, "keep"] },
                "name": "keep me"
            })
        );
    }

    #[test]
    fn json_の文字列値にも既知の値と形の規則が掛かる() {
        register(Kind::Vault, VAULT_KEY);
        let v = json!({ "text": format!("use {VAULT_KEY}"), "hdr": "Bearer abcdefghijklmnopqrstuvwxyz" });
        assert_eq!(
            value(v),
            json!({ "text": "use [redacted:vault]", "hdr": "[redacted:key]" })
        );
    }

    #[test]
    fn セッションメッセージは本文_tool_入力_受信箱カードが対象() {
        register(Kind::Vault, VAULT_KEY);
        let m = SessionMessage {
            id: "m1".into(),
            role: "user".into(),
            content: format!("result: {VAULT_KEY}"),
            timestamp: 1,
            tool_use_input: Some(json!({ "q": VAULT_KEY })),
            intent: Some(json!({ "params": { "text": VAULT_KEY } })),
            ..Default::default()
        };
        let out = message(m);
        assert_eq!(out.id, "m1");
        assert_eq!(out.content, "result: [redacted:vault]");
        assert_eq!(out.tool_use_input, Some(json!({ "q": "[redacted:vault]" })));
        assert_eq!(
            out.intent,
            Some(json!({ "params": { "text": "[redacted:vault]" } }))
        );
    }

    #[test]
    fn ログの書き手は書込ごとに秘匿化する() {
        use std::io::Write as _;
        register(Kind::Vault, VAULT_KEY);
        let mut w = Writer(Vec::new());
        writeln!(w, "INFO got {VAULT_KEY} done").unwrap();
        w.write_all(b"plain\n").unwrap();
        assert_eq!(
            String::from_utf8(w.0).unwrap(),
            "INFO got [redacted:vault] done\nplain\n"
        );
    }
}
