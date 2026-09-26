//! パフォーマンス設定系 capability (`performance.*`)。本体は
//! `crate::performance_settings`。画面 (CSS 変数) と Rust 側の反映はデバイスの
//! performance store が `performance.json5` の変更通知を受けて行う。

use serde_json::{json, Value};

use super::preview::confirm;
use super::ExecContext;
use crate::context::Core;
use crate::error::Result;
use crate::i18n::{render, text, Text, CANONICAL};
use crate::json5_out::J5;
use crate::performance_settings::{self as perf, Field};
use notecli::error::NoteDeckError;

fn s<'a>(p: &'a Value, k: &str) -> &'a str {
    p.get(k).and_then(Value::as_str).unwrap_or("")
}

fn invalid(msg: String) -> NoteDeckError {
    NoteDeckError::InvalidInput(msg)
}

/// JS の number をそのまま JSON に (整数は整数で)
fn num(v: f64) -> Value {
    J5::Num(v).to_value()
}

fn label_text(f: &Field) -> Text {
    text(&format!("_performanceData.labels.{}", f.key), json!({}))
}

/// 単位: 辞書にあれば手がかり付き、直書き ('MB' 等) はそのまま
fn unit_param(f: &Field) -> Value {
    match &f.unit_key {
        Some(k) => text(&format!("_performanceData.units.{k}"), json!({})).i18n,
        None => Value::String(f.unit.clone()),
    }
}

fn require_field(capability: &str, p: &Value) -> Result<&'static Field> {
    let key = s(p, "key");
    if key.is_empty() {
        return Err(invalid(format!("{capability}: key is required")));
    }
    perf::field(key).ok_or_else(|| invalid(format!("{capability}: unknown key \"{key}\"")))
}

pub fn list(core: &Core) -> Result<Value> {
    let overrides = perf::load_overrides(core)?;
    Ok(Value::Array(
        perf::fields()
            .iter()
            .map(|f| {
                json!({
                    "key": f.key,
                    "value": num(perf::current(&overrides, f)),
                    "default": num(f.default),
                    "min": num(f.min),
                    "max": num(f.max),
                    "step": num(f.step),
                    "unit": match &f.unit_key {
                        Some(k) => render(CANONICAL, &format!("_performanceData.units.{k}"), &json!({})),
                        None => f.unit.clone(),
                    },
                    "category": f.category,
                    "label": render(CANONICAL, &format!("_performanceData.labels.{}", f.key), &json!({})),
                    "description": render(CANONICAL, &format!("_performanceData.descriptions.{}", f.key), &json!({})),
                    "customized": overrides.get(&f.key).is_some(),
                })
            })
            .collect(),
    ))
}

pub fn set(core: &Core, p: &Value) -> Result<Value> {
    let f = require_field("performance.set", p)?;
    let Some(value) = p
        .get("value")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
    else {
        return Err(invalid(
            "performance.set: value must be a finite number".into(),
        ));
    };
    let saved = perf::set(core, f, value)?;
    Ok(json!({ "key": f.key, "value": num(saved) }))
}

pub fn reset(core: &Core, p: &Value) -> Result<Value> {
    let f = require_field("performance.reset", p)?;
    perf::reset_key(core, f)?;
    Ok(json!({ "key": f.key, "reset": true, "value": num(f.default) }))
}

pub fn reset_all(core: &Core) -> Result<Value> {
    perf::reset_all(core)?;
    Ok(json!({ "reset": true }))
}

pub fn apply_slider(core: &Core, p: &Value) -> Result<Value> {
    let Some(raw) = p.get("t").and_then(Value::as_f64).filter(|v| v.is_finite()) else {
        return Err(invalid(
            "performance.applySlider: t must be a finite number".into(),
        ));
    };
    let t = raw.clamp(0.0, 1.0);
    perf::apply_slider(core, t)?;
    Ok(json!({ "applied": true, "t": num(t) }))
}

/// TS の `typeof value === 'number' ? value : NaN` の表示
fn number_or_nan(v: Option<&Value>) -> Value {
    match v.and_then(Value::as_f64) {
        Some(n) => num(n),
        None => Value::String("NaN".into()),
    }
}

pub fn preview(id: &str, p: &Value, _ctx: &ExecContext) -> Option<Value> {
    Some(match id {
        "performance.set" => {
            let key = s(p, "key");
            let value = number_or_nan(p.get("value"));
            let message = match perf::field(key) {
                Some(f) => text(
                    "_native.preview.performance.set.message",
                    json!({
                        "label": label_text(f).i18n,
                        "key": key,
                        "value": value,
                        "unit": unit_param(f),
                        "min": num(f.min),
                        "max": num(f.max),
                    }),
                ),
                None => text(
                    "_native.preview.performance.set.messageUnknown",
                    json!({ "key": key, "value": value }),
                ),
            };
            confirm(
                "normal",
                text("_native.preview.performance.set.title", json!({})),
                Some(message),
                text("_native.preview.performance.set.ok", json!({})),
                json!({}),
            )
        }
        "performance.reset" => {
            let key = s(p, "key");
            let message = match perf::field(key) {
                Some(f) => text(
                    "_native.preview.performance.reset.message",
                    json!({ "label": label_text(f).i18n, "key": key }),
                ),
                None => text(
                    "_native.preview.performance.reset.messageUnknown",
                    json!({ "key": key }),
                ),
            };
            confirm(
                "normal",
                text("_native.preview.performance.reset.title", json!({})),
                Some(message),
                text("_native.preview.common.resetToDefault", json!({})),
                json!({}),
            )
        }
        "performance.resetAll" => confirm(
            "warning",
            text("_native.preview.performance.resetAll.title", json!({})),
            Some(text(
                "_native.preview.performance.resetAll.message",
                json!({}),
            )),
            text("_native.preview.common.resetAllToDefault", json!({})),
            json!({}),
        ),
        "performance.applySlider" => {
            let t = p.get("t").and_then(Value::as_f64).unwrap_or(f64::NAN);
            let label_key = if t <= 0.1 {
                "_native.preview.performance.applySlider.presetPowerSaving"
            } else if t >= 0.9 {
                "_native.preview.performance.applySlider.presetRich"
            } else {
                "_native.preview.performance.applySlider.presetBalanced"
            };
            confirm(
                "warning",
                text("_native.preview.performance.applySlider.title", json!({})),
                Some(text(
                    "_native.preview.performance.applySlider.message",
                    json!({ "t": format!("{t:.2}"), "label": text(label_key, json!({})).i18n }),
                )),
                text("_native.preview.performance.applySlider.ok", json!({})),
                json!({}),
            )
        }
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_reset_slider_and_previews_follow_ts() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        std::fs::create_dir_all(crate::commands::settings::settings_base_dir(&core).unwrap())
            .unwrap();
        let ctx = ExecContext::default();
        assert!(set(&core, &json!({}))
            .unwrap_err()
            .to_string()
            .contains("key is required"));
        assert!(set(&core, &json!({"key": "nope", "value": 1}))
            .unwrap_err()
            .to_string()
            .contains("unknown key \"nope\""));
        assert!(set(&core, &json!({"key": "emojiCacheHosts", "value": "x"}))
            .unwrap_err()
            .to_string()
            .contains("value must be a finite number"));
        assert_eq!(
            set(&core, &json!({"key": "emojiCacheHosts", "value": 9999})).unwrap(),
            json!({ "key": "emojiCacheHosts", "value": 200 })
        );
        let l = list(&core).unwrap();
        let row = l
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["key"] == "emojiCacheHosts")
            .unwrap();
        assert_eq!(row["value"], 200);
        assert_eq!(row["default"], 32);
        assert_eq!(row["unit"], "hosts");
        assert_eq!(row["label"], "Dictionary hosts");
        assert_eq!(row["customized"], true);
        assert_eq!(
            reset(&core, &json!({"key": "emojiCacheHosts"})).unwrap(),
            json!({ "key": "emojiCacheHosts", "reset": true, "value": 32 })
        );
        assert!(apply_slider(&core, &json!({"t": "x"}))
            .unwrap_err()
            .to_string()
            .contains("t must be a finite number"));
        assert_eq!(apply_slider(&core, &json!({"t": 2})).unwrap()["t"], 1);
        assert_eq!(reset_all(&core).unwrap()["reset"], true);
        let pv = preview(
            "performance.set",
            &json!({"key": "emojiCacheHosts", "value": 64}),
            &ctx,
        )
        .unwrap();
        assert_eq!(
            pv["message"],
            "Changes Dictionary hosts (`emojiCacheHosts`) to 64hosts. Out-of-range values are clamped to 4..200."
        );
        assert_eq!(
            pv["i18n"]["message"]["params"]["unit"]["key"],
            "_performanceData.units.hosts"
        );
        let pv = preview(
            "performance.set",
            &json!({"key": "memoryCacheMaxMB", "value": 1.5}),
            &ctx,
        )
        .unwrap();
        assert!(pv["message"].as_str().unwrap().contains("to 1.5MB."));
        let pv = preview("performance.set", &json!({"key": "zzz"}), &ctx).unwrap();
        assert_eq!(pv["message"], "Changes `zzz` to NaN.");
        let pv = preview("performance.applySlider", &json!({"t": 0.05}), &ctx).unwrap();
        assert_eq!(
            pv["message"],
            "Applies the preset at slider position t=0.05 (power saving) to every key."
        );
    }
}
