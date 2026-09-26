//! AI の token 予算 (#1133 縦切り 6)。Vault 接続単位の日次 token 予算を
//! `ai-turns/budget.json` の台帳で数える。事前は推定 (文字数から)、応答の usage で
//! 事後精算する。予算は ai.json5 の `budgets` (接続 id → 日次 token 数、0 / 無し =
//! 無制限)。日境界は UTC (HEARTBEAT の日次 run 上限と同じ)。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

/// 1 ラウンド / 1 ターンの token 使用量。`estimated` は provider が usage を返さず
/// 文字数から推定した値。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub estimated: bool,
}

impl TokenUsage {
    pub fn total(&self) -> u64 {
        self.input_tokens + self.output_tokens
    }

    /// 同じラウンドの部分報告を合わせる (Anthropic は message_start で入力、
    /// message_delta で累積出力が来る)。
    pub fn merge(&mut self, other: TokenUsage) {
        self.input_tokens = self.input_tokens.max(other.input_tokens);
        self.output_tokens = self.output_tokens.max(other.output_tokens);
        self.estimated = self.estimated && other.estimated;
    }

    pub fn add(&mut self, other: TokenUsage) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.estimated = self.estimated || other.estimated;
    }
}

/// 文字数 → token の推定 (日本語を含む前提で保守的に 3 文字 = 1 token)。
pub fn estimate_tokens(chars: usize) -> u64 {
    (chars as u64).div_ceil(3)
}

const FILE_NAME: &str = "budget.json";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ledger {
    /// UTC の日 (epoch days)。変わったら spent を捨てる
    daily_date: u64,
    /// 接続 id → 今日の使用量
    spent: HashMap<String, TokenUsage>,
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

fn epoch_days(ms: u64) -> u64 {
    ms / 86_400_000
}

fn load(dir: &Path, now_ms: u64) -> Ledger {
    let mut ledger: Ledger = std::fs::read_to_string(path(dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let today = epoch_days(now_ms);
    if ledger.daily_date != today {
        ledger.daily_date = today;
        ledger.spent.clear();
    }
    ledger
}

fn save(dir: &Path, ledger: &Ledger) {
    let _ = std::fs::create_dir_all(dir);
    match serde_json::to_string_pretty(ledger) {
        Ok(text) => {
            if let Err(e) = std::fs::write(path(dir), text) {
                tracing::warn!("budget ledger write failed: {e}");
            }
        }
        Err(e) => tracing::warn!("budget ledger serialize failed: {e}"),
    }
}

/// 今日の使用量 (接続単位)。
pub fn spent_today(dir: &Path, connection_id: &str, now_ms: u64) -> TokenUsage {
    load(dir, now_ms)
        .spent
        .get(connection_id)
        .copied()
        .unwrap_or_default()
}

/// 予算超過 (事前の推定で判定)。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BudgetExceeded {
    pub spent: u64,
    pub estimate: u64,
    pub budget: u64,
}

impl std::fmt::Display for BudgetExceeded {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "token 予算 (本日 {} tokens) を超えます: 使用済み {} + 見込み {}",
            self.budget, self.spent, self.estimate
        )
    }
}

/// ラウンド前の検査: 使用済み + 見込みが予算を超えるなら拒む。`daily_tokens` が
/// 0 なら無制限。
/// 台帳の読み書きを直列化する (並行するターンの精算が互いを上書きしないように)。
fn ledger_lock() -> std::sync::MutexGuard<'static, ()> {
    static L: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    L.get_or_init(|| std::sync::Mutex::new(()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

pub fn check(
    dir: &Path,
    connection_id: &str,
    daily_tokens: u64,
    estimate: u64,
    now_ms: u64,
) -> Result<(), BudgetExceeded> {
    if daily_tokens == 0 {
        return Ok(());
    }
    let _guard = ledger_lock();
    let spent = spent_today(dir, connection_id, now_ms).total();
    if spent + estimate > daily_tokens {
        return Err(BudgetExceeded {
            spent,
            estimate,
            budget: daily_tokens,
        });
    }
    Ok(())
}

/// ラウンド後の精算: 実測 (無ければ推定) を台帳に足す。
pub fn settle(dir: &Path, connection_id: &str, usage: TokenUsage, now_ms: u64) {
    let _guard = ledger_lock();
    let mut ledger = load(dir, now_ms);
    ledger
        .spent
        .entry(connection_id.to_string())
        .or_default()
        .add(usage);
    save(dir, &ledger);
}

/// 観測用 (DevDashboard / HTTP)。
pub fn snapshot(dir: &Path, now_ms: u64) -> Value {
    let ledger = load(dir, now_ms);
    json!({
        "dailyDate": ledger.daily_date,
        "spent": ledger.spent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_and_merge_rules() {
        assert_eq!(estimate_tokens(0), 0);
        assert_eq!(estimate_tokens(1), 1);
        assert_eq!(estimate_tokens(3), 1);
        assert_eq!(estimate_tokens(4), 2);
        let mut u = TokenUsage {
            input_tokens: 10,
            output_tokens: 0,
            estimated: false,
        };
        u.merge(TokenUsage {
            input_tokens: 0,
            output_tokens: 7,
            estimated: false,
        });
        assert_eq!((u.input_tokens, u.output_tokens), (10, 7));
        u.add(TokenUsage {
            input_tokens: 1,
            output_tokens: 1,
            estimated: true,
        });
        assert_eq!(u.total(), 19);
        assert!(u.estimated);
    }

    #[test]
    fn ledger_checks_settles_and_resets_by_utc_day() {
        let dir = tempfile::tempdir().unwrap();
        let day1 = 86_400_000 * 10 + 1_000;
        assert!(check(dir.path(), "c1", 0, 999_999, day1).is_ok());
        assert!(check(dir.path(), "c1", 100, 50, day1).is_ok());
        settle(
            dir.path(),
            "c1",
            TokenUsage {
                input_tokens: 60,
                output_tokens: 20,
                estimated: false,
            },
            day1,
        );
        assert_eq!(spent_today(dir.path(), "c1", day1).total(), 80);
        let err = check(dir.path(), "c1", 100, 30, day1).unwrap_err();
        assert_eq!(
            err,
            BudgetExceeded {
                spent: 80,
                estimate: 30,
                budget: 100
            }
        );
        // 別の接続は別勘定
        assert!(check(dir.path(), "c2", 100, 30, day1).is_ok());
        // 翌日 (UTC) は捨てる
        let day2 = day1 + 86_400_000;
        assert_eq!(spent_today(dir.path(), "c1", day2).total(), 0);
        assert!(check(dir.path(), "c1", 100, 30, day2).is_ok());
    }
}
