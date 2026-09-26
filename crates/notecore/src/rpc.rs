//! notecored の RPC 面の wire 形式 (#1106 §4.3、段階 3a)。
//!
//! 同一ホストでは Unix socket 上の改行区切り JSON。notecored (サーバー) と
//! アプリのクライアント層 (橋) が同じ型を使う。transport はここに無い。
//!
//! - 接続直後にサーバーが `hello` を 1 つ送る (起動毎の秘密、版、マニフェストの指紋)
//! - 要求 `request` / `batch` は秘密を添える。`name` はコマンド表の名前
//!   (`notecored.` で始まる名前はサーバー自身が答える)
//! - 応答 `response` は要求の `id` を返す。batch の応答は `result` が要素ごとの配列
//! - サーバーが押し出す `event` は Tauri のイベント名と同じ (`nd:ai-turn-event` など)
//! - サーバーからの `query` は橋の問い合わせで、端末が `query_response` で答える

use std::path::PathBuf;

use notecli::error::NoteDeckError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::vault::VaultError;

/// wire 形式の版。破壊的に変えたら上げる
pub const PROTOCOL_VERSION: u32 = 1;

/// サーバー自身が答える要求名の接頭辞
pub const SELF_PREFIX: &str = "notecored.";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RpcError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub i18n: Option<Value>,
}

impl From<&notecli::error::NoteDeckError> for RpcError {
    fn from(e: &notecli::error::NoteDeckError) -> Self {
        Self {
            code: e.code().to_string(),
            message: e.safe_message(),
            i18n: e.i18n().cloned(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchItem {
    pub name: String,
    #[serde(default)]
    pub params: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
}

/// 1 要求の結果 (batch の要素にも使う)
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

impl Outcome {
    pub fn success(result: Value) -> Self {
        Self {
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    pub fn failure(error: RpcError) -> Self {
        Self {
            ok: false,
            result: None,
            error: Some(error),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Frame {
    #[serde(rename_all = "camelCase")]
    Hello {
        protocol: u32,
        secret: String,
        version: String,
        fingerprint: String,
    },
    #[serde(rename_all = "camelCase")]
    Request {
        id: u64,
        secret: String,
        name: String,
        #[serde(default)]
        params: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    Batch {
        id: u64,
        secret: String,
        items: Vec<BatchItem>,
    },
    #[serde(rename_all = "camelCase")]
    Response {
        id: u64,
        #[serde(flatten)]
        outcome: Outcome,
    },
    #[serde(rename_all = "camelCase")]
    Event { name: String, payload: Value },
    /// notecored → 端末: 橋の問い合わせ (確認内容の組み立て / 実行要求 / HEARTBEAT の文脈)。
    /// 端末は `query_response` で答える (仕様 §4.4 の「確認要求」「実行要求」の運び方)
    #[serde(rename_all = "camelCase")]
    Query {
        id: u64,
        query_type: String,
        #[serde(default)]
        params: Value,
        timeout_ms: u64,
    },
    #[serde(rename_all = "camelCase")]
    QueryResponse {
        id: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

/// 同一ホストの socket の既定: `$XDG_RUNTIME_DIR/notecored/notecored.sock` (無ければ None)
pub fn default_socket_path() -> Option<PathBuf> {
    std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|v| !v.is_empty())
        .map(|dir| PathBuf::from(dir).join("notecored").join("notecored.sock"))
}

/// 引数名 (snake_case) を wire のキー (camelCase) に。コマンド表の JSON アダプタ
/// (`serde(rename_all = "camelCase")`) と同じ規則
pub fn camel_case(ident: &str) -> String {
    let mut out = String::with_capacity(ident.len());
    let mut upper = false;
    for c in ident.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

/// 中継で戻ってきたエラーを型付き経路のエラーに戻す。code は既知のものだけ
/// 静的な文字列に戻し、それ以外は `REMOTE`
fn static_code(code: &str) -> &'static str {
    const KNOWN: &[&str] = &[
        "DATABASE",
        "NETWORK",
        "JSON",
        "ACCOUNT_NOT_FOUND",
        "API",
        "NO_CONNECTION",
        "CONNECTION_CLOSED",
        "INVALID_INPUT",
        "KEYCHAIN",
        "INTERNAL",
        "UNAUTHORIZED",
        "AUTH_NO_TOKEN",
        "AUTH_MIAUTH_FAILED",
        "AUTH_MIAUTH_PENDING",
        "AUTH_CREDENTIAL_MISSING",
    ];
    KNOWN
        .iter()
        .find(|k| **k == code)
        .copied()
        .unwrap_or("REMOTE")
}

impl From<RpcError> for NoteDeckError {
    fn from(e: RpcError) -> Self {
        NoteDeckError::Localized {
            code: static_code(&e.code),
            message: e.message,
            i18n: e.i18n.unwrap_or(Value::Null),
        }
    }
}

impl From<RpcError> for VaultError {
    fn from(e: RpcError) -> Self {
        VaultError::RequestFailed { message: e.message }
    }
}

/// マニフェストの指紋: コマンド表の名前と capability の id を並べた sha256 (仕様 §4.3)。
/// 橋は毎応答ではなく hello で受け取り、不一致を状態面に出す
pub fn manifest_fingerprint() -> String {
    let mut h = Sha256::new();
    h.update(PROTOCOL_VERSION.to_string().as_bytes());
    for c in crate::commands::COMMANDS {
        h.update(b"\n");
        h.update(c.name().as_bytes());
    }
    for d in crate::capabilities::CAPABILITIES {
        h.update(b"\n");
        h.update(d.id.as_bytes());
    }
    format!("{:x}", h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn frames_round_trip_as_tagged_json() {
        let f = Frame::Request {
            id: 7,
            secret: "s".into(),
            name: "api_get_timeline".into(),
            params: json!({ "accountId": "a" }),
            window: Some("main".into()),
        };
        let text = serde_json::to_string(&f).unwrap();
        assert!(text.starts_with("{\"type\":\"request\""));
        assert_eq!(serde_json::from_str::<Frame>(&text).unwrap(), f);
        let r = Frame::Response {
            id: 7,
            outcome: Outcome::failure(RpcError {
                code: "INVALID_INPUT".into(),
                message: "bad".into(),
                i18n: None,
            }),
        };
        let text = serde_json::to_string(&r).unwrap();
        assert!(text.contains("\"ok\":false"));
        assert!(!text.contains("i18n"));
        assert_eq!(serde_json::from_str::<Frame>(&text).unwrap(), r);
    }

    #[test]
    fn camel_case_matches_the_json_adapter() {
        assert_eq!(camel_case("account_id"), "accountId");
        assert_eq!(camel_case("until_id"), "untilId");
        assert_eq!(camel_case("query"), "query");
        assert_eq!(camel_case("is_sensitive"), "isSensitive");
    }

    #[test]
    fn remote_errors_map_back_to_typed_errors() {
        let e: NoteDeckError = RpcError {
            code: "INVALID_INPUT".into(),
            message: "bad".into(),
            i18n: None,
        }
        .into();
        assert_eq!(e.code(), "INVALID_INPUT");
        assert_eq!(e.safe_message(), "bad");
        let e: NoteDeckError = RpcError {
            code: "SOMETHING_NEW".into(),
            message: "x".into(),
            i18n: Some(json!({ "key": "k" })),
        }
        .into();
        assert_eq!(e.code(), "REMOTE");
        assert_eq!(e.i18n().unwrap()["key"], "k");
    }

    #[test]
    fn query_frames_round_trip() {
        let q = Frame::Query {
            id: 3,
            query_type: "ai/confirm-preview".into(),
            params: json!({ "capabilityId": "notes.create" }),
            timeout_ms: 30_000,
        };
        let text = serde_json::to_string(&q).unwrap();
        assert!(text.contains("\"type\":\"query\""));
        assert_eq!(serde_json::from_str::<Frame>(&text).unwrap(), q);
        let r = Frame::QueryResponse {
            id: 3,
            result: None,
            error: Some("no handler".into()),
        };
        let text = serde_json::to_string(&r).unwrap();
        assert!(!text.contains("result"));
        assert_eq!(serde_json::from_str::<Frame>(&text).unwrap(), r);
    }

    #[test]
    fn fingerprint_is_stable_and_hex() {
        let a = manifest_fingerprint();
        assert_eq!(a, manifest_fingerprint());
        assert_eq!(a.len(), 64);
    }
}
