//! パフォーマンス設定 (ルートの `performance.json5` = 既定値との差分だけを持つ
//! 上書きマップ) の読み書き (#1133 第 3 弾)。デバイス側
//! `src/stores/performance.ts` と同じ規則。既定値は `src/defaults/performance.json5`、
//! 各 key の範囲 / 刻み / 分類 / スライダー両端は TS の表から採った golden
//! (`src/capabilities/golden/performance.json`、`pnpm gen:golden-perf`) を共有する。
//! 画面 (CSS 変数) と Rust 側の反映はデバイスが変更通知を受けて行う。

use serde_json::Value;
use std::sync::LazyLock;

use crate::commands::settings::settings_base_dir;
use crate::context::Core;
use crate::error::Result;
use crate::json5_out::{self, J5};
use crate::settings_events;
use crate::settings_store as store;

pub const FILE_NAME: &str = "performance.json5";
const DEFAULTS_SRC: &str = include_str!("../../../src/defaults/performance.json5");
const FIELDS_SRC: &str = include_str!("../../../src/capabilities/golden/performance.json");

#[derive(Clone, Debug, PartialEq)]
pub struct Field {
    pub key: String,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub category: String,
    /// 単位の表示文 (直書きの 'MB' 等)。辞書にあるものは `unit_key` で引き直す
    pub unit: String,
    pub unit_key: Option<String>,
    pub low: f64,
    pub high: f64,
    pub default: f64,
}

impl Field {
    pub fn clamp(&self, v: f64) -> f64 {
        v.max(self.min).min(self.max)
    }

    /// `interpolateKey`: 両端はプリセット値そのもの、間は (両端が正なら) 幾何補間、
    /// step で丸めて clamp。
    pub fn interpolate(&self, t: f64) -> f64 {
        if t <= 0.0 {
            return self.clamp(self.low);
        }
        if t >= 1.0 {
            return self.clamp(self.high);
        }
        let raw = if self.low > 0.0 && self.high > 0.0 {
            self.low * (self.high / self.low).powf(t)
        } else {
            self.low + (self.high - self.low) * t
        };
        self.clamp((raw / self.step).round() * self.step)
    }
}

/// 全 key (TS の `FIELD_META` の宣言順)
static FIELDS: LazyLock<Vec<Field>> = LazyLock::new(|| {
    let defaults: Value = json5::from_str(DEFAULTS_SRC).expect("performance.json5 is valid JSON5");
    let golden: J5 = json5::from_str(FIELDS_SRC).expect("performance golden is valid JSON");
    let Some(J5::Obj(fields)) = golden.get("fields") else {
        panic!("performance golden has no fields");
    };
    fields
        .iter()
        .map(|(key, f)| {
            let num = |k: &str| f.get(k).and_then(J5::as_f64).unwrap_or(0.0);
            Field {
                key: key.clone(),
                min: num("min"),
                max: num("max"),
                step: num("step"),
                category: f
                    .get("category")
                    .and_then(J5::as_str)
                    .unwrap_or("")
                    .to_string(),
                unit: f.get("unit").and_then(J5::as_str).unwrap_or("").to_string(),
                unit_key: f
                    .get("unitKey")
                    .and_then(J5::as_str)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string),
                low: num("low"),
                high: num("high"),
                default: defaults.get(key).and_then(Value::as_f64).unwrap_or(0.0),
            }
        })
        .collect()
});

pub fn fields() -> &'static [Field] {
    &FIELDS
}

pub fn field(key: &str) -> Option<&'static Field> {
    FIELDS.iter().find(|f| f.key == key)
}

/// 上書きマップ (ファイル順)。無い / 壊れているときは空。
pub fn load_overrides(core: &Core) -> Result<J5> {
    let text = store::read_root_file(&settings_base_dir(core)?, FILE_NAME).unwrap_or_default();
    Ok(match json5::from_str::<J5>(&text) {
        Ok(v @ J5::Obj(_)) => v,
        _ => J5::Obj(vec![]),
    })
}

fn write_overrides(core: &Core, overrides: &J5) -> Result<()> {
    let text = json5_out::stringify(overrides) + "\n";
    settings_events::write_root_file(core, FILE_NAME, &text)
}

/// 現在値 (上書きがあればそれ、無ければ既定)。
pub fn current(overrides: &J5, f: &Field) -> f64 {
    overrides
        .get(&f.key)
        .and_then(J5::as_f64)
        .unwrap_or(f.default)
}

/// `set`: 範囲に丸め、既定値と同じなら上書きを消す。戻り値は保存後の値。
pub fn set(core: &Core, f: &Field, value: f64) -> Result<f64> {
    let clamped = f.clamp(value);
    let mut overrides = load_overrides(core)?;
    if clamped == f.default {
        overrides.remove(&f.key);
    } else {
        overrides.set(&f.key, J5::Num(clamped));
    }
    write_overrides(core, &overrides)?;
    Ok(clamped)
}

pub fn reset_key(core: &Core, f: &Field) -> Result<()> {
    let mut overrides = load_overrides(core)?;
    overrides.remove(&f.key);
    write_overrides(core, &overrides)
}

pub fn reset_all(core: &Core) -> Result<()> {
    write_overrides(core, &J5::Obj(vec![]))
}

/// `applySlider(t)`: 全 key を補間し、既定値と違うものだけを上書きにする。
pub fn apply_slider(core: &Core, t: f64) -> Result<()> {
    let mut pairs: Vec<(String, J5)> = Vec::new();
    for f in fields() {
        let v = f.interpolate(t);
        if v != f.default {
            pairs.push((f.key.clone(), J5::Num(v)));
        }
    }
    write_overrides(core, &J5::Obj(pairs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_come_from_the_golden_and_interpolate_like_ts() {
        let f = field("emojiCacheHosts").unwrap();
        assert_eq!((f.min, f.max, f.step), (4.0, 200.0, 4.0));
        assert_eq!(f.category, "emoji");
        assert_eq!(f.unit_key.as_deref(), Some("hosts"));
        assert_eq!(f.default, 32.0);
        assert_eq!(f.interpolate(0.0), 8.0);
        assert_eq!(f.interpolate(1.0), 64.0);
        // 幾何補間 8 * 8^0.5 ≒ 22.6 → step 4 で 24
        assert_eq!(f.interpolate(0.5), 24.0);
        assert_eq!(f.clamp(1000.0), 200.0);
        assert!(fields().len() > 40);
        assert!(field("nope").is_none());
    }

    #[test]
    fn overrides_only_keep_non_default_values() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let base = settings_base_dir(&core).unwrap();
        std::fs::create_dir_all(&base).unwrap();
        let f = field("emojiCacheHosts").unwrap();
        assert_eq!(set(&core, f, 1000.0).unwrap(), 200.0);
        assert_eq!(
            std::fs::read_to_string(base.join(FILE_NAME)).unwrap(),
            "{\n  emojiCacheHosts: 200,\n}\n"
        );
        assert_eq!(current(&load_overrides(&core).unwrap(), f), 200.0);
        assert_eq!(set(&core, f, 32.0).unwrap(), 32.0);
        assert_eq!(
            std::fs::read_to_string(base.join(FILE_NAME)).unwrap(),
            "{}\n"
        );
        apply_slider(&core, 0.0).unwrap();
        let ov = load_overrides(&core).unwrap();
        assert_eq!(ov.get("emojiCacheHosts").and_then(J5::as_f64), Some(8.0));
        reset_key(&core, f).unwrap();
        assert!(load_overrides(&core)
            .unwrap()
            .get("emojiCacheHosts")
            .is_none());
        reset_all(&core).unwrap();
        assert_eq!(
            std::fs::read_to_string(base.join(FILE_NAME)).unwrap(),
            "{}\n"
        );
    }
}
