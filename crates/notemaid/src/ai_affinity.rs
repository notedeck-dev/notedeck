//! 会話アフィニティ ID (#1160)。
//!
//! プロバイダーの中には「会話ごとに安定した ID」をリクエストに要求するものがある
//! (OpenCode の `x-opencode-session`。無いと 400)。値は接続 ID と会話の鍵から決定的に
//!導出する UUID (v5) で、生の session ID は送らない。
//!
//! - 接続 ID を混ぜる理由: 接続 ID はプロバイダーに出ない内部採番なので、同じ session の
//!   途中で別プロバイダーに切り替えても両者で会話が突合できず、別の API アカウント = 別の
//!   会話という正しい意味になる。ファイルもインストール固有の状態も要らない
//! - 鍵には種別を前置し、種別が違えば同じ文字列でも別の値になる
//! - プロバイダーから見て不透明であればよく、それ以上の秘匿は目的にしない
//!
//! 値を決めるのは会話を知っている層 (ターン実行器と HEARTBEAT)。1 往復の `ai.chat` は
//! 呼び出し元が会話を持たないので送信の入口が stream ID から決める。フロントや外部からは
//! 指定できない (`AiChatRequest::affinity` は wire に出ない)。どのヘッダーに載せるかは
//! 宛先ホストで決まる ([`notecore::connection_templates::affinity_header_for`])。

use uuid::Uuid;

/// `notedeck:ai-affinity` の名前空間 (固定。変えると全接続の会話 ID が変わる)
const NAMESPACE: Uuid = Uuid::from_bytes([
    0x5a, 0x0d, 0x2c, 0x1e, 0x9b, 0x47, 0x4f, 0x3a, 0x8e, 0x61, 0x2d, 0x7f, 0x11, 0x60, 0xaf, 0x01,
]);

/// どの会話の一部としてプロバイダーに見せるか。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConversationKey {
    /// チャットのターン (タイトル生成も含む): session ID。ターン・round・透過リトライ・
    /// continuation・チェックポイント再開をまたいで同じ値
    Session(String),
    /// HEARTBEAT (本体の全 round と報告タイトル): 接続ごとに 1 本の会話。同じ prefix を
    /// 延々送るので固定が正しい
    Heartbeat,
    /// session の無い通常ターン (現状は到達しない fallback): turn ID
    Turn(String),
    /// 1 往復の `ai.chat` (plugin / コマンド / HTTP API): 呼び出しごとの stream ID
    Stream(String),
}

impl ConversationKey {
    fn material(&self) -> String {
        match self {
            ConversationKey::Session(id) => format!("session:{id}"),
            ConversationKey::Heartbeat => "heartbeat".to_string(),
            ConversationKey::Turn(id) => format!("turn:{id}"),
            ConversationKey::Stream(id) => format!("stream:{id}"),
        }
    }
}

/// 接続 + 会話の鍵から導出した会話アフィニティ ID (UUID v5、ハイフン区切りの小文字)。
pub fn affinity_id(connection_id: &str, key: &ConversationKey) -> String {
    let name = format!("{connection_id}\n{}", key.material());
    Uuid::new_v5(&NAMESPACE, name.as_bytes())
        .hyphenated()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str) -> ConversationKey {
        ConversationKey::Session(id.into())
    }

    #[test]
    fn same_connection_and_session_always_derive_the_same_uuid() {
        assert_eq!(
            affinity_id("c1", &session("s1")),
            affinity_id("c1", &session("s1"))
        );
        assert_eq!(
            affinity_id("c1", &ConversationKey::Heartbeat),
            affinity_id("c1", &ConversationKey::Heartbeat)
        );
    }

    #[test]
    fn different_session_connection_or_kind_derive_different_uuids() {
        let base = affinity_id("c1", &session("s1"));
        assert_ne!(base, affinity_id("c1", &session("s2")));
        assert_ne!(base, affinity_id("c2", &session("s1")));
        assert_ne!(base, affinity_id("c1", &ConversationKey::Turn("s1".into())));
        assert_ne!(
            base,
            affinity_id("c1", &ConversationKey::Stream("s1".into()))
        );
        assert_ne!(base, affinity_id("c1", &ConversationKey::Heartbeat));
        assert_ne!(
            affinity_id("c1", &ConversationKey::Heartbeat),
            affinity_id("c2", &ConversationKey::Heartbeat)
        );
    }

    #[test]
    fn the_raw_session_id_is_not_sent_and_the_value_is_uuid_shaped() {
        let id = affinity_id("c1", &session("20261001120000"));
        assert!(!id.contains("20261001120000"));
        assert!(!id.contains("c1"));
        let parsed = Uuid::parse_str(&id).expect("uuid");
        assert_eq!(parsed.get_version(), Some(uuid::Version::Sha1));
        assert_eq!(id, id.to_ascii_lowercase());
        assert_eq!(id.len(), 36);
    }

    #[test]
    fn separators_in_ids_do_not_collide() {
        // 接続 ID と鍵の境界は改行で、鍵の種別は接頭辞。文字列連結の偶然の一致で
        // 別の会話が同じ値になることはない
        assert_ne!(
            affinity_id("c1\nsession:x", &session("y")),
            affinity_id("c1", &session("x\ny"))
        );
    }
}
