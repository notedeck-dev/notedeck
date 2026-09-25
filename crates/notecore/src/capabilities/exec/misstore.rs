//! MisStore (store.notedeck.io) の registry 取得と配布ソースの sha512 検証。
//! デバイス側 `src/stores/misstore.ts` の `fetchVerifiedSource` と同じ規則
//! (改行を LF に揃えて hash、不一致は 1 回だけ取り直す)。

use serde_json::Value;
use sha2::{Digest, Sha512};

use crate::commands::http::{self, HttpFetchRequest};
use crate::context::Core;
use crate::error::Result;
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
        "ハッシュ不一致: ソースが改ざんされている可能性があります".into(),
    ))
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

/// `updateConfirmMessage(name, entry)`。
pub fn update_confirm_message(name: &str, entry: &Value) -> String {
    format!(
        "「{name}」をストアの内容で更新します。\nストア更新日: {} / v{}",
        format_updated_at(s(entry, "updatedAt")),
        s(entry, "version")
    )
}
