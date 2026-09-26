//! MisStore (store.notedeck.io) の registry 取得と配布ソースの sha512 検証。
//! デバイス側 `src/stores/misstore.ts` の `fetchVerifiedSource` と同じ規則
//! (改行を LF に揃えて hash、不一致は 1 回だけ取り直す)。

use serde_json::{json, Value};
use sha2::{Digest, Sha512};

use crate::commands::http::{self, HttpFetchRequest};
use crate::context::Core;
use crate::error::Result;
use crate::i18n::{text, Text};
use crate::settings_slug::casefold;
use notecli::error::NoteDeckError;

const STORE_BASE_URL: &str = "https://store.notedeck.io";

fn s<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or("")
}

fn invalid(msg: String) -> NoteDeckError {
    NoteDeckError::InvalidInput(msg)
}

pub async fn fetch_text(core: &Core, url: &str) -> Result<String> {
    let res = http::http_fetch(
        core,
        HttpFetchRequest {
            url: url.to_string(),
            method: Some("GET".into()),
            headers: None,
            body: None,
            timeout_ms: Some(15_000),
        },
    )
    .await?;
    if !(200..300).contains(&res.status) {
        return Err(invalid(format!("HTTP {}", res.status)));
    }
    Ok(res.body)
}

/// `registry/<key>.json` の `<key>` 配列から id の項目を探す。
pub async fn registry_entry(core: &Core, key: &str, id: &str) -> Result<Option<Value>> {
    let text = fetch_text(core, &format!("{STORE_BASE_URL}/registry/{key}.json")).await?;
    let doc: Value = serde_json::from_str(&text)
        .map_err(|e| invalid(format!("MisStore registry parse failed: {e}")))?;
    Ok(doc.get(key).and_then(Value::as_array).and_then(|a| {
        a.iter()
            .find(|e| e.get("id").and_then(Value::as_str) == Some(id))
    }))
    .map(|v| v.cloned())
}

/// 配布ソースを取得して sha512 を照合する。戻り値は (本文, 検証済み hash)。
pub async fn fetch_verified_source(core: &Core, entry: &Value) -> Result<(String, String)> {
    let url = s(entry, "sourceUrl");
    let expected = casefold(s(entry, "sha512"));
    for _ in 0..2 {
        let text = fetch_text(core, url).await?;
        let hash = format!(
            "{:x}",
            Sha512::digest(text.replace("\r\n", "\n").as_bytes())
        );
        if hash == expected {
            return Ok((text, hash));
        }
    }
    Err(invalid(
        "hash mismatch: the source may have been tampered with".into(),
    ))
}

/// 確認で見せた配布物 (sha512) と、実行時に取り直した配布物が同じかを確かめる。
/// 確認は既存個体の現在の内容を baseline に、その時点の hash を staged に置く。
/// 確認を経ていない (staged が無い) 場合は通す。
pub fn ensure_approved_hash(capability: &str, key: &str, current: &str, hash: &str) -> Result<()> {
    let approved = super::staged::take_or(capability, key, current, || hash.to_string())?;
    if approved != hash {
        return Err(invalid(format!("{capability}: aborted the update because the MisStore distribution changed after confirmation (start over from the confirmation)")));
    }
    Ok(())
}

/// `formatUpdatedAt`: ISO 日時を `Y/M/D` に (読めなければそのまま)。
pub fn format_updated_at(iso: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(iso) {
        Ok(d) => {
            use chrono::Datelike;
            let d = d.with_timezone(&chrono::Local);
            format!("{}/{}/{}", d.year(), d.month(), d.day())
        }
        Err(_) => iso.to_string(),
    }
}

/// `updateConfirmMessage(name, entry)`。`added` は更新で新しく求める権限 (空なら行を出さない)
pub fn update_confirm_message(name: &str, entry: &Value, added: &[&str]) -> Text {
    let date = format_updated_at(s(entry, "updatedAt"));
    let version = s(entry, "version");
    if added.is_empty() {
        text(
            "_native.preview.misstore.updateConfirm",
            json!({ "name": name, "date": date, "version": version }),
        )
    } else {
        text(
            "_native.preview.misstore.updateConfirmWithPermissions",
            json!({
                "name": name,
                "date": date,
                "version": version,
                "permissions": added.join(", "),
            }),
        )
    }
}

#[cfg(test)]
mod approved_hash_tests {
    use super::*;
    use crate::capabilities::exec::ExecContext;
    use serde_json::json;

    #[test]
    fn install_aborts_when_the_distribution_changed_after_confirmation() {
        let ctx = ExecContext::default();
        let p = json!({ "id": "approved-hash-test" });
        let key = super::super::staged::key("plugins.install", &ctx, &p);
        // 確認なし (staged 無し) は通す
        ensure_approved_hash("plugins.install", &key, "cur", "h1").unwrap();
        // 確認時の hash と同じなら通す
        super::super::staged::stage(key.clone(), "cur", "h1".into());
        ensure_approved_hash("plugins.install", &key, "cur", "h1").unwrap();
        // 確認後に配布物が変わっていれば中止
        super::super::staged::stage(key.clone(), "cur", "h1".into());
        assert!(ensure_approved_hash("plugins.install", &key, "cur", "h2")
            .unwrap_err()
            .to_string()
            .contains("distribution changed after confirmation"));
    }
}
