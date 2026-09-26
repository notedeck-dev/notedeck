//! 設定ファイルの編集履歴 `<subdir>/<base>.history.json5` (#981 / #1040)。
//! TS の `src/utils/historyFs.ts` + `src/services/editHistory.ts` と同じ規則:
//! 先頭が最新、上限 30 件、本人の 60 秒以内の連続保存は 1 件にまとめ、
//! 溢れたら「本人の理由なし → 本人の理由あり → 他者 (AI 等)」の順に古いものから捨てる。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

use crate::context::Core;
use crate::error::Result;
use crate::settings_events;
use crate::settings_store as store;

pub const HISTORY_SUFFIX: &str = ".history.json5";
pub const HISTORY_LIMIT: usize = 30;
const COALESCE_WINDOW_MS: u64 = 60_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub at: u64,
    pub snapshot: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 誰が / なぜ (確認ダイアログの理由欄)。`by` は principal (`{ kind: ... }`)。
#[derive(Clone, Debug, Default)]
pub struct Attribution {
    pub by: Option<Value>,
    pub reason: Option<String>,
}

/// TS `sanitizeFilename`: 危険文字を `_` に、trim、`_` の連続を 1 つに、上限 64 文字、空なら untitled。
pub fn sanitize_filename(name: &str) -> String {
    let replaced: String = name
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = replaced.trim();
    let mut out = String::new();
    let mut prev_us = false;
    for c in trimmed.chars() {
        if c == '_' {
            if !prev_us {
                out.push(c);
            }
            prev_us = true;
        } else {
            out.push(c);
            prev_us = false;
        }
    }
    let mut out: String = out.chars().take(64).collect();
    if out.is_empty() {
        out = "untitled".into();
    }
    out
}

pub fn history_file_name(base: &str) -> String {
    format!("{}{HISTORY_SUFFIX}", sanitize_filename(base))
}

fn is_self(by: Option<&Value>) -> bool {
    match by {
        None => true,
        Some(v) => v.get("kind").and_then(Value::as_str) == Some("user"),
    }
}

/// 本人の連続保存 (60 秒以内) は新しい方を捨てる。
pub fn should_coalesce(prev: Option<&HistoryEntry>, at: u64, by: Option<&Value>) -> bool {
    let Some(prev) = prev else {
        return false;
    };
    is_self(prev.by.as_ref()) && is_self(by) && at >= prev.at && at - prev.at < COALESCE_WINDOW_MS
}

fn rank(e: &HistoryEntry) -> u8 {
    if !is_self(e.by.as_ref()) {
        2
    } else if e.reason.is_some() {
        1
    } else {
        0
    }
}

/// 上限を超えた分を「順位の低い順、同順位なら古い順」に捨てる (元の並びは保つ)。
pub fn evict(entries: Vec<HistoryEntry>, limit: usize) -> Vec<HistoryEntry> {
    if entries.len() <= limit {
        return entries;
    }
    let excess = entries.len() - limit;
    let mut order: Vec<usize> = (0..entries.len()).collect();
    order.sort_by(|&a, &b| {
        rank(&entries[a])
            .cmp(&rank(&entries[b]))
            .then_with(|| b.cmp(&a))
    });
    let removed: std::collections::HashSet<usize> = order.into_iter().take(excess).collect();
    entries
        .into_iter()
        .enumerate()
        .filter(|(i, _)| !removed.contains(i))
        .map(|(_, e)| e)
        .collect()
}

/// 履歴を読む。無い / 壊れているときは 0 件。
pub fn list(base_dir: &Path, subdir: &str, base: &str) -> Vec<HistoryEntry> {
    let Ok(text) = store::read_file(base_dir, subdir, &history_file_name(base)) else {
        return Vec::new();
    };
    parse_entries(&text, base)
}

/// ルート直下のファイル (custom.css) の履歴を読む。
pub fn list_root(base_dir: &Path, base: &str) -> Vec<HistoryEntry> {
    let Ok(text) = store::read_root_file(base_dir, &history_file_name(base)) else {
        return Vec::new();
    };
    parse_entries(&text, base)
}

fn parse_entries(text: &str, base: &str) -> Vec<HistoryEntry> {
    let Ok(doc) = json5::from_str::<Value>(text) else {
        tracing::warn!(base, "history file is not valid JSON5, treated as empty");
        return Vec::new();
    };
    doc.get("entries")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| serde_json::from_value::<HistoryEntry>(v.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

fn with_snapshot(
    mut entries: Vec<HistoryEntry>,
    snapshot: Value,
    attribution: Option<&Attribution>,
    at: u64,
) -> Option<String> {
    let by = attribution.and_then(|a| a.by.clone());
    if should_coalesce(entries.first(), at, by.as_ref()) {
        return None;
    }
    entries.insert(
        0,
        HistoryEntry {
            at,
            snapshot,
            by,
            reason: attribution
                .and_then(|a| a.reason.clone())
                .filter(|r| !r.is_empty()),
        },
    );
    let entries = evict(entries, HISTORY_LIMIT);
    serde_json::to_string_pretty(&serde_json::json!({ "entries": entries }))
        .ok()
        .map(|s| s + "\n")
}

/// ルート直下のファイル (custom.css) 用の `push_snapshot`。
pub fn push_snapshot_root(
    core: &Core,
    base_dir: &Path,
    base: &str,
    snapshot: Value,
    attribution: Option<&Attribution>,
    at: u64,
) -> Result<()> {
    let entries = list_root(base_dir, base);
    match with_snapshot(entries, snapshot, attribution, at) {
        Some(body) => settings_events::write_root_file(core, &history_file_name(base), &body),
        None => Ok(()),
    }
}

/// 編集前の snapshot を積む。まとめる条件に当たれば何もしない。
pub fn push_snapshot(
    core: &Core,
    base_dir: &Path,
    subdir: &str,
    base: &str,
    snapshot: Value,
    attribution: Option<&Attribution>,
    at: u64,
) -> Result<()> {
    let entries = list(base_dir, subdir, base);
    match with_snapshot(entries, snapshot, attribution, at) {
        Some(body) => settings_events::write_file(core, subdir, &history_file_name(base), &body),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn e(at: u64, by: Option<&str>, reason: Option<&str>) -> HistoryEntry {
        HistoryEntry {
            at,
            snapshot: json!({}),
            by: by.map(|k| json!({ "kind": k })),
            reason: reason.map(str::to_string),
        }
    }

    #[test]
    fn coalesce_only_self_edits_within_window() {
        let prev = e(1_000, None, None);
        assert!(should_coalesce(Some(&prev), 21_000, None));
        assert!(should_coalesce(
            Some(&prev),
            21_000,
            Some(&json!({"kind": "user"}))
        ));
        assert!(!should_coalesce(Some(&prev), 121_000, None));
        assert!(!should_coalesce(
            Some(&prev),
            2_000,
            Some(&json!({"kind": "ai.chat"}))
        ));
        let ai = e(1_000, Some("ai.chat"), None);
        assert!(!should_coalesce(Some(&ai), 2_000, None));
        assert!(!should_coalesce(None, 2_000, None));
        assert!(!should_coalesce(Some(&prev), 500, None));
    }

    #[test]
    fn evict_drops_low_rank_oldest_first_and_keeps_order() {
        // 先頭が最新。自分の理由なし (rank 0) の古いものから消える
        let entries = vec![
            e(5, Some("ai.chat"), None),
            e(4, None, Some("r")),
            e(3, None, None),
            e(2, None, None),
            e(1, Some("ai.chat"), None),
        ];
        let kept = evict(entries, 3);
        assert_eq!(kept.iter().map(|x| x.at).collect::<Vec<_>>(), vec![5, 4, 1]);
    }

    #[test]
    fn sanitize_filename_matches_ts() {
        assert_eq!(sanitize_filename("a<b>:c"), "a_b_c");
        assert_eq!(sanitize_filename("  x__y  "), "x_y");
        assert_eq!(sanitize_filename("///"), "_");
        assert_eq!(sanitize_filename(""), "untitled");
        assert_eq!(sanitize_filename("my-skill"), "my-skill");
    }

    #[test]
    fn push_and_list_round_trip_with_attribution() {
        let dir = tempfile::tempdir().unwrap();
        let core = Core::new();
        core.set_app_dir(dir.path().to_path_buf());
        let base_dir = crate::commands::settings::settings_base_dir(&core).unwrap();
        let attr = Attribution {
            by: Some(json!({"kind": "ai.chat"})),
            reason: Some("r".into()),
        };
        push_snapshot(
            &core,
            &base_dir,
            "skills",
            "a",
            json!({"body": "1"}),
            Some(&attr),
            10,
        )
        .unwrap();
        push_snapshot(
            &core,
            &base_dir,
            "skills",
            "a",
            json!({"body": "2"}),
            None,
            20,
        )
        .unwrap();
        // 本人の連続保存はまとめる
        push_snapshot(
            &core,
            &base_dir,
            "skills",
            "a",
            json!({"body": "3"}),
            None,
            30,
        )
        .unwrap();
        let got = list(&base_dir, "skills", "a");
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].snapshot["body"], "2");
        assert_eq!(got[1].reason.as_deref(), Some("r"));
        assert_eq!(got[1].by, Some(json!({"kind": "ai.chat"})));
        assert!(list(&base_dir, "skills", "missing").is_empty());
    }
}
