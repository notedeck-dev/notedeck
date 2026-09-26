//! ナビバー系 capability (`navbar.list` / `navbar.reset`)。本体は `crate::navbar`。
//! `navbar.set` はカラム種別を実行時レジストリ (プラグイン定義を含む) で検証する
//! のでデバイスに残る。デバイスの deck store は `navbar.json5` の変更通知で写しを
//! 読み直す。

use serde_json::{json, Value};

use super::preview::confirm;
use super::ExecContext;
use crate::context::Core;
use crate::error::Result;
use crate::i18n::text;
use crate::navbar;

pub fn list(core: &Core) -> Result<Value> {
    Ok(Value::Array(
        navbar::load(core)?.iter().map(navbar::project).collect(),
    ))
}

pub fn reset(core: &Core) -> Result<Value> {
    navbar::reset(core)?;
    Ok(json!({ "count": navbar::defaults().len() }))
}

pub fn preview(id: &str, _p: &Value, _ctx: &ExecContext) -> Option<Value> {
    if id != "navbar.reset" {
        return None;
    }
    let defaults = navbar::defaults();
    let code: Vec<Value> = defaults
        .iter()
        .map(|i| {
            let ty = i.get("type").and_then(Value::as_str).unwrap_or("");
            if ty == "divider" {
                json!({ "type": "divider" })
            } else {
                json!({ "type": ty, "accountId": i.get("accountId").and_then(Value::as_str) })
            }
        })
        .collect();
    Some(confirm(
        "warning",
        text("_native.preview.navbar.reset.title", json!({})),
        Some(text(
            "_native.preview.navbar.reset.message_plural",
            json!({ "count": defaults.len() }),
        )),
        text("_native.preview.common.resetToDefault", json!({})),
        json!({
            "code": serde_json::to_string_pretty(&code).unwrap_or_default(),
            "codeLanguage": "json",
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_and_reset() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let base = crate::commands::settings::settings_base_dir(&core).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(
            base.join("navbar.json5"),
            "[{ type: 'chat', accountId: null }]",
        )
        .unwrap();
        assert_eq!(
            list(&core).unwrap(),
            json!([{ "type": "chat", "accountId": null, "label": null }])
        );
        let pv = preview("navbar.reset", &json!({}), &ExecContext::default()).unwrap();
        assert_eq!(pv["title"], "Reset navbar layout to default");
        assert!(pv["code"]
            .as_str()
            .unwrap()
            .contains("\"type\": \"timeline\""));
        let r = reset(&core).unwrap();
        assert_eq!(r["count"], navbar::defaults().len());
        assert_eq!(
            list(&core).unwrap().as_array().unwrap().len(),
            navbar::defaults().len()
        );
    }
}
