//! 状態面に載せる値の提供口。上に載るクレート (notemaid) が自分の状態
//! (HEARTBEAT の snapshot 等) を名前つきで登録し、公開 HTTP API はここから引く。
//! notecore が notemaid を知らずに済ませるための差し込み口で、プロセスに 1 つ。

use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use serde_json::Value;

type Provider = Arc<dyn Fn() -> Value + Send + Sync>;

static PROVIDERS: RwLock<Option<HashMap<&'static str, Provider>>> = RwLock::new(None);

pub fn register(key: &'static str, f: Provider) {
    let mut w = PROVIDERS.write().unwrap_or_else(|e| e.into_inner());
    w.get_or_insert_with(HashMap::new).insert(key, f);
}

/// 未登録なら None (呼ぶ側が既定値を決める)
pub fn get(key: &str) -> Option<Value> {
    let f = {
        let r = PROVIDERS.read().unwrap_or_else(|e| e.into_inner());
        r.as_ref().and_then(|m| m.get(key).cloned())
    };
    f.map(|f| f())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unregistered_is_none_and_registered_is_called() {
        assert!(get("nope").is_none());
        register("t", Arc::new(|| serde_json::json!({"ok": true})));
        assert_eq!(get("t"), Some(serde_json::json!({"ok": true})));
    }
}
