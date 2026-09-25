//! 確認と実行の間で「適用後の全文」を持ち越す (#981 の不変条件: 承認後は
//! 再計算せず、確認に使った全文をそのまま書く)。
//!
//! デバイスの `stagedEdit` は確認と実行が同じ ctx を共有することに頼っていたが、
//! notecore の preview と execute は別々の呼び出しなので、引数から決まるキーで
//! 一時的に保持する。寿命は確認要求の絶対 TTL と同じ。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;
use sha2::{Digest, Sha256};

use super::ExecContext;
use crate::error::Result;
use notecli::error::NoteDeckError;

const TTL: Duration = Duration::from_secs(15 * 60);
const MAX_ENTRIES: usize = 64;

struct Entry {
    at: Instant,
    baseline: String,
    next: String,
}

fn table() -> &'static Mutex<HashMap<String, Entry>> {
    static T: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(HashMap::new()))
}

/// capability + principal + アカウント + 引数 から決まるキー。
pub fn key(id: &str, ctx: &ExecContext, params: &Value) -> String {
    let mut h = Sha256::new();
    h.update(id.as_bytes());
    h.update(b"\n");
    h.update(ctx.principal.as_bytes());
    h.update(b"\n");
    h.update(ctx.account_id.as_deref().unwrap_or("").as_bytes());
    h.update(b"\n");
    h.update(serde_json::to_string(params).unwrap_or_default().as_bytes());
    format!("{:x}", h.finalize())
}

fn evict(map: &mut HashMap<String, Entry>) {
    let now = Instant::now();
    map.retain(|_, e| now.duration_since(e.at) < TTL);
    while map.len() >= MAX_ENTRIES {
        let Some(oldest) = map.iter().min_by_key(|(_, e)| e.at).map(|(k, _)| k.clone()) else {
            break;
        };
        map.remove(&oldest);
    }
}

/// 確認に使う適用後全文を保持する。戻り値は next そのもの。
pub fn stage(key: String, baseline: &str, next: String) -> String {
    let mut map = table().lock().expect("staged lock");
    evict(&mut map);
    map.insert(
        key,
        Entry {
            at: Instant::now(),
            baseline: baseline.to_string(),
            next: next.clone(),
        },
    );
    next
}

/// 保持していれば消費して返す。確認後に対象が変わっていれば中止。無ければ再計算。
pub fn take_or(
    capability: &str,
    key: &str,
    current: &str,
    fallback: impl FnOnce() -> String,
) -> Result<String> {
    let staged = table().lock().expect("staged lock").remove(key);
    match staged {
        Some(e) if e.baseline != current => Err(NoteDeckError::InvalidInput(format!(
            "{capability}: 確認後に対象が変更されたため書き込みを中止しました (最新の内容を読み直してからやり直すこと)"
        ))),
        Some(e) => Ok(e.next),
        None => Ok(fallback()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn staged_text_is_consumed_once_and_checks_baseline() {
        let ctx = ExecContext {
            principal: "ai.chat".into(),
            ..Default::default()
        };
        let k = key("skills.append", &ctx, &json!({"id": "a", "content": "x"}));
        assert_eq!(
            k,
            key("skills.append", &ctx, &json!({"content": "x", "id": "a"}))
        );
        stage(k.clone(), "old", "old\nx".into());
        assert_eq!(
            take_or("skills.append", &k, "old", || "fallback".into()).unwrap(),
            "old\nx"
        );
        // 消費済みなので再計算
        assert_eq!(
            take_or("skills.append", &k, "old", || "fallback".into()).unwrap(),
            "fallback"
        );
        stage(k.clone(), "old", "n".into());
        let err = take_or("skills.append", &k, "changed", || "f".into()).unwrap_err();
        assert!(err.to_string().contains("確認後に対象が変更された"));
    }
}
