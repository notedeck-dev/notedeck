//! push の購読登録を、利用者に本家 Web で 1 回実行してもらうための組み立て
//! (純関数、#330 §5)。
//!
//! 本家の `sw/register` はネイティブトークン限定 (secure) で、アプリの MiAuth トークン
//! では呼べない。本家 Web の Scratchpad で AiScript を 1 回実行してもらうと、その Web
//! セッションのトークンで呼ばれるので本家を変えずに通る (Aria と同じ手口)。ここは
//! 実行してもらうコードの組み立てと、貼り戻された応答の検証だけを持つ。
//! ネットワーク・端末には触らない (tests/lint/rustCoreBoundary が検査)。

use serde_json::{json, Value};

use crate::i18n;

/// 購読の三つ組 (配送アプリが発行したエンドポイントと、端末が持つ鍵の公開側)。
/// 鍵は base64url (パディング無し)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PushKeys {
    pub endpoint: String,
    pub auth: String,
    pub publickey: String,
}

/// 本家 Web の Scratchpad
pub fn scratchpad_url(host: &str) -> String {
    format!("https://{host}/scratchpad")
}

/// AiScript の単一引用符の文字列リテラル。`\` と `'` だけがエスケープの対象
/// (AiScript 1.2.1 で確認。`{` は引用符の中では補間されない)
fn ais_str(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// Scratchpad で実行してもらうコード。先頭で口座名を照合し、別の口座で本家 Web に
/// ログインしていたら止める (別口座の購読を作らない)。既読の合図も受け取る
/// (他端末で全部既読にしたら通知を消すため、§5.3)。同じ三つ組の購読が既にあると
/// 本家の sw/register は既読の合図の設定を更新せずに返すので、無効なら
/// sw/update-registration で有効にしてから見せる。成功したら応答の JSON を
/// コピーしやすい形で出す
pub fn register_code(username: &str, keys: &PushKeys, lang: &str) -> String {
    let wrong_account = i18n::render(
        lang,
        "_native.push.wrongAccount",
        &json!({ "user": format!("@{username}") }),
    );
    let copy_response = i18n::render(lang, "_native.push.copyResponse", &json!({}));
    format!(
        "if (USER_USERNAME != {user}) {{\n\
         \tCore:abort({wrong})\n\
         }}\n\
         let response = Mk:api('sw/register', {{\n\
         \tendpoint: {endpoint},\n\
         \tauth: {auth},\n\
         \tpublickey: {publickey},\n\
         \tsendReadMessage: true,\n\
         }})\n\
         if (Core:type(response) == 'error') {{\n\
         \tMk:dialog(response.name, Core:to_str(response.info), 'error')\n\
         }} else {{\n\
         \tvar updated = response\n\
         \tif (response.sendReadMessage != true) {{\n\
         \t\tupdated = Mk:api('sw/update-registration', {{ endpoint: {endpoint}, sendReadMessage: true }})\n\
         \t}}\n\
         \tif (Core:type(updated) == 'error') {{\n\
         \t\tMk:dialog(updated.name, Core:to_str(updated.info), 'error')\n\
         \t}} else {{\n\
         \t\tresponse.sendReadMessage = updated.sendReadMessage\n\
         \t\tMk:dialog({copy}, ['```json', Json:stringify(response), '```'].join(Str:lf), 'success')\n\
         \t}}\n\
         }}\n",
        user = ais_str(username),
        wrong = ais_str(&wrong_account),
        endpoint = ais_str(&keys.endpoint),
        auth = ais_str(&keys.auth),
        publickey = ais_str(&keys.publickey),
        copy = ais_str(&copy_response),
    )
}

/// 貼り戻された応答を受け入れられない理由
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyError {
    /// JSON として読めない / 登録の応答ではない
    Unreadable,
    /// 別の口座で登録された (本家 Web に別の口座でログインしていた)
    OtherAccount,
    /// 今の端末のエンドポイントではない (古いコードを実行した)
    OtherEndpoint,
    /// サーバーが Web Push を設定していない (登録は成功するが届かない)
    ServerWithoutKey,
}

/// 受け入れた登録
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registered {
    /// サーバーの VAPID 公開鍵 (変わったら登録し直しが要る)
    pub server_key: String,
}

/// 応答を検証する。`user_id` / `endpoint` は今の口座と今の端末のもの。Scratchpad の
/// ダイアログからコピーすると前後の ```json の囲いが付くので外して読む
pub fn verify_response(
    text: &str,
    user_id: &str,
    endpoint: &str,
) -> Result<Registered, VerifyError> {
    let body = text
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let value: Value = serde_json::from_str(body).map_err(|_| VerifyError::Unreadable)?;
    let field = |key: &str| value.get(key).and_then(Value::as_str);
    match field("state") {
        Some("subscribed" | "already-subscribed") => {}
        _ => return Err(VerifyError::Unreadable),
    }
    if field("userId") != Some(user_id) {
        return Err(VerifyError::OtherAccount);
    }
    if field("endpoint") != Some(endpoint) {
        return Err(VerifyError::OtherEndpoint);
    }
    match field("key").filter(|k| !k.is_empty()) {
        Some(key) => Ok(Registered {
            server_key: key.to_string(),
        }),
        None => Err(VerifyError::ServerWithoutKey),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys() -> PushKeys {
        PushKeys {
            endpoint: "https://ntfy.example/upAbC?up=1".into(),
            auth: "aGVsbG8".into(),
            publickey: "BPub_key-1".into(),
        }
    }

    /// 応答の正常形 (本家の sw/register の応答)
    fn response(user: &str, endpoint: &str, key: Option<&str>) -> String {
        serde_json::to_string(&json!({
            "state": "subscribed",
            "key": key,
            "userId": user,
            "endpoint": endpoint,
            "sendReadMessage": true,
        }))
        .unwrap()
    }

    /// コードは口座名の照合・三つ組・既読の合図を含み、引用符と \ を壊さない
    #[test]
    fn register_code_embeds_keys_and_escapes_literals() {
        let code = register_code("alice", &keys(), "ja-JP");
        assert!(code.starts_with("if (USER_USERNAME != 'alice') {"));
        assert!(code.contains("endpoint: 'https://ntfy.example/upAbC?up=1',"));
        assert!(code.contains("auth: 'aGVsbG8',"));
        assert!(code.contains("publickey: 'BPub_key-1',"));
        assert!(code.contains("sendReadMessage: true,"));
        assert!(code.contains("@alice"));
        assert_eq!(ais_str(r"a'b\c"), r"'a\'b\\c'");
        assert_eq!(
            scratchpad_url("misskey.example"),
            "https://misskey.example/scratchpad"
        );
    }

    #[test]
    fn verify_accepts_matching_response_even_inside_code_fence() {
        let ok = response("u1", "https://ntfy.example/upAbC?up=1", Some("BServerKey"));
        assert_eq!(
            verify_response(&ok, "u1", "https://ntfy.example/upAbC?up=1"),
            Ok(Registered {
                server_key: "BServerKey".into()
            })
        );
        let fenced = format!("```json\n{ok}\n```\n");
        assert!(verify_response(&fenced, "u1", "https://ntfy.example/upAbC?up=1").is_ok());
    }

    /// 別口座 / 別エンドポイント / 鍵の無いサーバー / 読めない入力はそれぞれ理由つきで拒む
    #[test]
    fn verify_rejects_with_reason() {
        let ep = "https://ntfy.example/upAbC?up=1";
        assert_eq!(
            verify_response(&response("u2", ep, Some("k")), "u1", ep),
            Err(VerifyError::OtherAccount)
        );
        assert_eq!(
            verify_response(&response("u1", "https://other/", Some("k")), "u1", ep),
            Err(VerifyError::OtherEndpoint)
        );
        assert_eq!(
            verify_response(&response("u1", ep, None), "u1", ep),
            Err(VerifyError::ServerWithoutKey)
        );
        assert_eq!(
            verify_response("not json", "u1", ep),
            Err(VerifyError::Unreadable)
        );
        assert_eq!(
            verify_response(r#"{"error":{"code":"ACCESS_DENIED"}}"#, "u1", ep),
            Err(VerifyError::Unreadable)
        );
    }
}
