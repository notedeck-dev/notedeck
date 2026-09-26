//! ターンの永続チェックポイント (#1133 縦切り 2)。
//!
//! 確認要求を出したループは turn の状態をここに書いて解放する (スレッドを
//! 握らない)。応答 / 期限切れ / 中断で読み戻して再開するか閉じる。置き場は
//! notecore 専有 (`<app dir>/notedeck/ai-turns/`) で、設定ファイルの allowlist
//! (生ファイル書込 / バックアップ) には入れない。
//!
//! 閉じた turn は理由を残したファイルに置き換え、一定期間後に掃除する
//! (「失敗は理由を永続化する」の最小形)。

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::TurnState;
use crate::error::Result;
use notecli::error::NoteDeckError;

const DIR_NAME: &str = "ai-turns";
/// 閉じた記録を残す期間
const CLOSED_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// 閉じた turn の記録 (理由つき)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClosedTurn {
    pub turn_id: String,
    pub reason: String,
    pub closed_at_ms: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum Stored {
    Open(Box<TurnState>),
    Closed(ClosedTurn),
}

pub fn dir(app_dir: &Path) -> PathBuf {
    app_dir.join("notedeck").join(DIR_NAME)
}

fn file_name(turn_id: &str) -> String {
    let safe: String = turn_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{safe}.json")
}

fn path(dir: &Path, turn_id: &str) -> PathBuf {
    dir.join(file_name(turn_id))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 停止中の turn を書く。
pub fn write(dir: &Path, state: &TurnState) -> Result<()> {
    let io = |e: std::io::Error| NoteDeckError::Internal(format!("ai turn checkpoint: {e}"));
    std::fs::create_dir_all(dir).map_err(io)?;
    let body = serde_json::to_string_pretty(state)?;
    std::fs::write(path(dir, &state.req.turn_id), body).map_err(io)?;
    Ok(())
}

/// 停止中の turn を読み戻す。閉じた記録や欠損はエラー。
pub fn read(dir: &Path, turn_id: &str) -> Result<TurnState> {
    let text = std::fs::read_to_string(path(dir, turn_id))
        .map_err(|e| NoteDeckError::Internal(format!("ai turn checkpoint: {e}")))?;
    match serde_json::from_str::<Stored>(&text)? {
        Stored::Open(state) => Ok(*state),
        Stored::Closed(c) => Err(NoteDeckError::InvalidInput(format!(
            "turn {turn_id} is already closed ({})",
            c.reason
        ))),
    }
}

/// turn を理由つきで閉じる。チェックポイントが無ければ何もしない
/// (確認で停止したことのない turn)。
pub fn close(dir: &Path, turn_id: &str, reason: &str) {
    let p = path(dir, turn_id);
    if !p.exists() {
        return;
    }
    let closed = ClosedTurn {
        turn_id: turn_id.to_string(),
        reason: reason.to_string(),
        closed_at_ms: now_ms(),
    };
    let written = serde_json::to_string_pretty(&closed)
        .map_err(|e| e.to_string())
        .and_then(|body| std::fs::write(&p, body).map_err(|e| e.to_string()));
    match written {
        Ok(()) => tracing::info!(turn_id, reason, "ai turn closed"),
        Err(e) => tracing::warn!(turn_id, "failed to record closed turn: {e}"),
    }
}

/// 起動時の復旧: 停止中のまま残った turn は「再起動」の理由で閉じる (デバイス側の
/// 投影は失われている)。閉じた記録は保持期間を過ぎたら消す。閉じた turn id を返す。
pub fn recover(dir: &Path) -> Vec<String> {
    let mut closed_now = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return closed_now;
    };
    let now = now_ms();
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else {
            continue;
        };
        match serde_json::from_str::<Stored>(&text) {
            Ok(Stored::Open(state)) => {
                let id = state.req.turn_id.clone();
                close(dir, &id, "restart");
                closed_now.push(id);
            }
            Ok(Stored::Closed(c)) => {
                if now.saturating_sub(c.closed_at_ms) > CLOSED_RETENTION.as_millis() as u64 {
                    let _ = std::fs::remove_file(&p);
                }
            }
            Err(_) => {
                // 読めないものは残しても使えない
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    closed_now
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai_turn::AiTurnRequest;

    fn state(id: &str) -> TurnState {
        TurnState::new(AiTurnRequest {
            turn_id: id.into(),
            ..Default::default()
        })
    }

    #[test]
    fn write_read_close_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let d = dir(tmp.path());
        write(&d, &state("t/1")).unwrap();
        assert_eq!(read(&d, "t/1").unwrap().req.turn_id, "t/1");
        close(&d, "t/1", "cancelled");
        let err = read(&d, "t/1").unwrap_err().to_string();
        assert!(err.contains("cancelled"), "{err}");
        // 無いものを閉じても何も起きない
        close(&d, "nope", "x");
        assert!(read(&d, "nope").is_err());
    }

    #[test]
    fn recover_closes_open_turns_and_prunes_old_closed_ones() {
        let tmp = tempfile::tempdir().unwrap();
        let d = dir(tmp.path());
        write(&d, &state("open")).unwrap();
        std::fs::write(
            path(&d, "old"),
            serde_json::to_string(&ClosedTurn {
                turn_id: "old".into(),
                reason: "decided".into(),
                closed_at_ms: 1,
            })
            .unwrap(),
        )
        .unwrap();
        std::fs::write(path(&d, "junk"), "not json").unwrap();
        assert_eq!(recover(&d), vec!["open".to_string()]);
        assert!(read(&d, "open")
            .unwrap_err()
            .to_string()
            .contains("restart"));
        assert!(!path(&d, "old").exists());
        assert!(!path(&d, "junk").exists());
        // 復旧は冪等
        assert!(recover(&d).is_empty());
    }
}
