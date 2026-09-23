//! サーバー絵文字辞書 (`/api/emojis` の応答) のディスクキャッシュ。
//!
//! 大規模サーバーの辞書は数千〜数万件・数 MB あり、フロントの localStorage
//! には全量が載らない (host あたり先頭 N 件だけ運んでいる)。そのため起動の
//! たびに全量をサーバーへ取りに行き、その応答は Rust 側の full-ready と
//! ネットワーク往復の後ろに並ぶので、DB キャッシュから先に描画したノートの
//! 絵文字が「unknown アイコン → 数秒後に本物」と二段階で出ていた。
//!
//! ここは「最後にサーバーから受け取った全量」を host 単位のファイルに置く
//! だけの純サービス。鮮度 (`FRESH_FOR`) の中なら command がネットワークを
//! 省略して返し、超えていれば取り直して上書きする。ストリーミングの push
//! (#889) と miss 駆動の再取得はフロント側の辞書に効くので、ここが多少
//! 古くても表示は自己修復する。設定ではなくキャッシュなので、バックアップ
//! (settings_store の allowlist) には入れない。`commands/content.rs` が
//! IPC アダプタ。

use std::path::{Path, PathBuf};
use std::time::Duration;

use notecli::models::ServerEmoji;
use serde::{Deserialize, Serialize};

pub const EMOJI_CACHE_DIR: &str = "emoji_cache";
/// この鮮度の中ならネットワークを省略する。フロントの経年リフレッシュ
/// (`STALE_AFTER_MS`) と同じ 24h — それを超えるとフロントが refresh=true で
/// 取り直すので、ここが単独でこれより長く抱えることはない
pub const FRESH_FOR: Duration = Duration::from_secs(24 * 60 * 60);

const FORMAT_VERSION: u8 = 1;

#[derive(Serialize, Deserialize)]
struct Stored {
    version: u8,
    host: String,
    fetched_at_ms: u64,
    emojis: Vec<ServerEmoji>,
}

pub struct Cached {
    pub fetched_at_ms: u64,
    pub emojis: Vec<ServerEmoji>,
}

fn path_for(app_dir: &Path, host: &str) -> PathBuf {
    // host はサーバー由来の文字列なのでファイル名に直接使わない
    app_dir
        .join(EMOJI_CACHE_DIR)
        .join(format!("{}.json", crate::image_cache::hex_hash(host)))
}

pub fn is_fresh(fetched_at_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(fetched_at_ms) < FRESH_FOR.as_millis() as u64
}

/// 保存済みの辞書。無い・壊れている・別 host のもの (ハッシュ衝突) は `None`
pub fn read(app_dir: &Path, host: &str) -> Option<Cached> {
    let bytes = std::fs::read(path_for(app_dir, host)).ok()?;
    let stored: Stored = serde_json::from_slice(&bytes).ok()?;
    if stored.version != FORMAT_VERSION || stored.host != host {
        return None;
    }
    Some(Cached {
        fetched_at_ms: stored.fetched_at_ms,
        emojis: stored.emojis,
    })
}

/// 一時ファイルに書いてから rename する。書き込み途中で落ちても、次回の
/// read が半端な JSON を読んで `None` → 取り直し、で済む
pub fn write(
    app_dir: &Path,
    host: &str,
    emojis: &[ServerEmoji],
    fetched_at_ms: u64,
) -> std::io::Result<()> {
    let path = path_for(app_dir, host);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let stored = Stored {
        version: FORMAT_VERSION,
        host: host.to_string(),
        fetched_at_ms,
        emojis: emojis.to_vec(),
    };
    let bytes = serde_json::to_vec(&stored).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn emoji(name: &str) -> ServerEmoji {
        ServerEmoji {
            name: name.to_string(),
            url: format!("https://example.com/{name}.png"),
            category: None,
            aliases: vec![],
        }
    }

    #[test]
    fn roundtrips_per_host() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.example", &[emoji("meow")], 1_000).unwrap();
        write(dir.path(), "b.example", &[emoji("woof")], 2_000).unwrap();

        let a = read(dir.path(), "a.example").expect("a");
        assert_eq!(a.fetched_at_ms, 1_000);
        assert_eq!(a.emojis.len(), 1);
        assert_eq!(a.emojis[0].name, "meow");
        let b = read(dir.path(), "b.example").expect("b");
        assert_eq!(b.emojis[0].name, "woof");
        assert!(read(dir.path(), "c.example").is_none());
    }

    #[test]
    fn overwrite_replaces_and_leaves_no_tmp() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.example", &[emoji("old")], 1).unwrap();
        write(dir.path(), "a.example", &[emoji("new")], 2).unwrap();
        let a = read(dir.path(), "a.example").unwrap();
        assert_eq!(a.fetched_at_ms, 2);
        assert_eq!(a.emojis[0].name, "new");
        let leftovers: Vec<_> = std::fs::read_dir(dir.path().join(EMOJI_CACHE_DIR))
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "tmp が残った: {leftovers:?}");
    }

    #[test]
    fn corrupted_or_foreign_file_reads_as_none() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.example", &[emoji("meow")], 1).unwrap();
        let path = path_for(dir.path(), "a.example");
        std::fs::write(&path, b"{ not json").unwrap();
        assert!(read(dir.path(), "a.example").is_none());

        // 別 host の内容が同名ファイルに入っていても信用しない
        let stored = Stored {
            version: FORMAT_VERSION,
            host: "other.example".into(),
            fetched_at_ms: 1,
            emojis: vec![],
        };
        std::fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read(dir.path(), "a.example").is_none());

        // 形式が変わったら読まずに取り直す
        let stored = Stored {
            version: FORMAT_VERSION + 1,
            host: "a.example".into(),
            fetched_at_ms: 1,
            emojis: vec![],
        };
        std::fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read(dir.path(), "a.example").is_none());
    }

    #[test]
    fn freshness_boundary() {
        let ttl = FRESH_FOR.as_millis() as u64;
        assert!(is_fresh(1_000, 1_000));
        assert!(is_fresh(1_000, 1_000 + ttl - 1));
        assert!(!is_fresh(1_000, 1_000 + ttl));
        // 時計が戻っても (fetched_at が未来) 新鮮扱いで、取り直しループにしない
        assert!(is_fresh(5_000, 1_000));
    }
}
