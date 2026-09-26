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

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

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
    fn fingerprint_is_stable_and_hex() {
        let a = manifest_fingerprint();
        assert_eq!(a, manifest_fingerprint());
        assert_eq!(a.len(), 64);
    }
}
