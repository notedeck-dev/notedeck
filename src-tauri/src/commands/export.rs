//! ファイルエクスポート (#92)
//!
//! 添付 / ドライブファイルを `~/Downloads/notedeck/<segments...>/` へ一括保存
//! する下回り。UI からもプラグイン capability (#813) からも同じ経路を通す。
//!
//! - SSRF 防御は `http_fetch` と同じ二段構え (`validate_external_url` +
//!   `PinningResolver`)。添付 URL はリモートサーバー由来の非信頼値のため必須
//! - 同一ファイル (fileId) の再保存はスキップ (保存先ディレクトリの
//!   sidecar index で判定)。冪等なので失敗分のリトライは全件再投入でよい
//! - 別ファイルの同名衝突は " (n)" 連番で回避
//! - 進捗は `ExportProgress` イベントで通知し、`export_files_cancel` で中断

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::Manager;
use tauri_specta::Event;

use crate::commands::validate_external_url;
use crate::vault::ssrf::PinningResolver;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// chunk 間の無通信タイムアウト。総時間の上限は設けない (大きい動画を殺さない)
const READ_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB
const CONCURRENCY: usize = 4;
const MAX_ITEMS: usize = 10_000;
const MAX_SEGMENTS: usize = 4;
/// fileId → 保存ファイル名の対応表。保存先ディレクトリ直下に置く
const INDEX_FILE: &str = ".notedeck-export.json";

/// キャンセル要求済みの taskId。タスク終了時に掃除する
static CANCELLED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportFileItem {
    pub file_id: String,
    pub url: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub task_id: String,
    /// 対象 fileId。タスク全体イベント (finished / cancelled) では空文字
    pub file_id: String,
    /// "saving" | "done" | "skipped" | "failed" | "finished" | "cancelled"
    pub status: String,
    pub error: Option<String>,
    /// 完了 (done + skipped + failed) 件数
    pub done: u32,
    pub total: u32,
}

fn export_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dl = app
        .path()
        .download_dir()
        .map_err(|e| format!("download dir unavailable: {e}"))?;
    Ok(dl.join("notedeck"))
}

/// エクスポートルートを (無ければ作って) 返す。… メニューの
/// 「ダウンロードフォルダを開く」用
#[tauri::command]
#[specta::specta]
pub async fn get_export_dir(app: tauri::AppHandle) -> Result<String, String> {
    let root = export_root(&app)?;
    std::fs::create_dir_all(&root).map_err(|e| format!("failed to create export dir: {e}"))?;
    Ok(root.to_string_lossy().into_owned())
}

#[tauri::command]
#[specta::specta]
pub async fn export_files_cancel(task_id: String) {
    CANCELLED.lock().unwrap().insert(task_id);
}

/// エクスポートを開始し、解決済みの保存先ディレクトリを返す。
/// 即座に返り、以後の進捗は `ExportProgress` に流れる
#[tauri::command]
#[specta::specta]
pub async fn export_files_start(
    app: tauri::AppHandle,
    task_id: String,
    segments: Vec<String>,
    items: Vec<ExportFileItem>,
) -> Result<String, String> {
    if items.is_empty() {
        return Err("no items to export".to_string());
    }
    if items.len() > MAX_ITEMS {
        return Err(format!("too many items (max {MAX_ITEMS})"));
    }
    if segments.is_empty() || segments.len() > MAX_SEGMENTS {
        return Err(format!("segments must be 1..={MAX_SEGMENTS}"));
    }

    let mut dir = export_root(&app)?;
    for seg in &segments {
        dir.push(sanitize_component(seg));
    }
    std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create export dir: {e}"))?;

    CANCELLED.lock().unwrap().remove(&task_id);
    let dir_str = dir.to_string_lossy().into_owned();
    tauri::async_runtime::spawn(run_export(app, task_id, dir, items));
    Ok(dir_str)
}

fn is_cancelled(task_id: &str) -> bool {
    CANCELLED.lock().unwrap().contains(task_id)
}

fn emit(
    app: &tauri::AppHandle,
    task_id: &str,
    file_id: &str,
    status: &str,
    error: Option<String>,
    done: u32,
    total: u32,
) {
    let _ = ExportProgress {
        task_id: task_id.to_string(),
        file_id: file_id.to_string(),
        status: status.to_string(),
        error,
        done,
        total,
    }
    .emit(app);
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .dns_resolver(Arc::new(PinningResolver::new()))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))
}

async fn run_export(
    app: tauri::AppHandle,
    task_id: String,
    dir: PathBuf,
    items: Vec<ExportFileItem>,
) {
    let total = items.len() as u32;
    let done = Arc::new(AtomicU32::new(0));
    let index = Arc::new(Mutex::new(load_index(&dir)));

    // 保存名は並列ダウンロード前に一括で確定する (名前の奪い合いを排除)。
    // None = index に既存で実ファイルもある → スキップ
    let plans: Vec<(ExportFileItem, Option<String>)> = {
        let idx = index.lock().unwrap();
        let mut claimed: HashSet<String> = HashSet::new();
        items
            .into_iter()
            .map(|item| {
                if let Some(existing) = idx.get(&item.file_id) {
                    if dir.join(existing).exists() {
                        return (item, None);
                    }
                }
                let name = resolve_collision(&dir, &sanitize_component(&item.name), &claimed);
                claimed.insert(name.clone());
                (item, Some(name))
            })
            .collect()
    };

    let client = match build_client() {
        Ok(c) => c,
        Err(e) => {
            emit(&app, &task_id, "", "failed", Some(e), 0, total);
            emit(&app, &task_id, "", "finished", None, 0, total);
            return;
        }
    };

    futures_util::stream::iter(plans)
        .map(|(item, plan)| {
            let app = app.clone();
            let task_id = task_id.clone();
            let dir = dir.clone();
            let client = client.clone();
            let done = done.clone();
            let index = index.clone();
            async move {
                if is_cancelled(&task_id) {
                    return;
                }
                let Some(name) = plan else {
                    let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                    emit(&app, &task_id, &item.file_id, "skipped", None, d, total);
                    return;
                };
                emit(
                    &app,
                    &task_id,
                    &item.file_id,
                    "saving",
                    None,
                    done.load(Ordering::SeqCst),
                    total,
                );
                let result = download_one(&client, &item.url, &dir, &name).await;
                let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                match result {
                    Ok(()) => {
                        {
                            let mut idx = index.lock().unwrap();
                            idx.insert(item.file_id.clone(), name);
                            save_index(&dir, &idx);
                        }
                        emit(&app, &task_id, &item.file_id, "done", None, d, total);
                    }
                    Err(e) => emit(&app, &task_id, &item.file_id, "failed", Some(e), d, total),
                }
            }
        })
        .buffer_unordered(CONCURRENCY)
        .collect::<Vec<()>>()
        .await;

    let cancelled = is_cancelled(&task_id);
    CANCELLED.lock().unwrap().remove(&task_id);
    emit(
        &app,
        &task_id,
        "",
        if cancelled { "cancelled" } else { "finished" },
        None,
        done.load(Ordering::SeqCst),
        total,
    );
}

async fn download_one(
    client: &reqwest::Client,
    url: &str,
    dir: &Path,
    name: &str,
) -> Result<(), String> {
    validate_external_url(url)?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    let part = dir.join(format!("{name}.part"));
    match write_stream(resp, &part).await {
        Ok(()) => std::fs::rename(&part, dir.join(name)).map_err(|e| {
            let _ = std::fs::remove_file(&part);
            format!("rename failed: {e}")
        }),
        Err(e) => {
            let _ = std::fs::remove_file(&part);
            Err(e)
        }
    }
}

async fn write_stream(resp: reqwest::Response, part: &Path) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(part)
        .await
        .map_err(|e| format!("file create failed: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut written: u64 = 0;
    loop {
        let next = tokio::time::timeout(READ_TIMEOUT, stream.next())
            .await
            .map_err(|_| "read timeout".to_string())?;
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|e| format!("read failed: {e}"))?;
        written += chunk.len() as u64;
        if written > MAX_FILE_BYTES {
            return Err(format!("file exceeds {MAX_FILE_BYTES} bytes limit"));
        }
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write failed: {e}"))?;
    }
    file.flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;
    Ok(())
}

/// パス区切り・Windows 禁止文字・制御文字を潰し、末尾のドット/空白を落とす。
/// 空や ".." のような危険値は "_" に倒す
fn sanitize_component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() || trimmed.chars().all(|c| c == '.') {
        return "_".to_string();
    }
    // Windows の予約デバイス名は拡張子付き ("CON.txt") でも無効なので退避する
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = trimmed.split('.').next().unwrap_or("");
    if RESERVED.iter().any(|r| stem.eq_ignore_ascii_case(r)) {
        return format!("_{trimmed}");
    }
    trimmed.to_string()
}

/// "photo.jpg" → ("photo", ".jpg")。拡張子なし・dotfile は ext 空
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// ディスク上の既存ファイルとこのタスクで確保済みの名前の両方を避けて
/// " (n)" 連番の保存名を決める
fn resolve_collision(dir: &Path, want: &str, claimed: &HashSet<String>) -> String {
    let taken = |name: &str| claimed.contains(name) || dir.join(name).exists();
    if !taken(want) {
        return want.to_string();
    }
    let (stem, ext) = split_name(want);
    for n in 1.. {
        let candidate = format!("{stem} ({n}){ext}");
        if !taken(&candidate) {
            return candidate;
        }
    }
    unreachable!()
}

fn load_index(dir: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(dir.join(INDEX_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_index(dir: &Path, index: &HashMap<String, String>) {
    if let Ok(json) = serde_json::to_string(index) {
        let _ = std::fs::write(dir.join(INDEX_FILE), json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_component_replaces_separators_and_forbidden_chars() {
        assert_eq!(sanitize_component("a/b\\c:d"), "a_b_c_d");
        assert_eq!(sanitize_component("a*b?c\"d<e>f|g"), "a_b_c_d_e_f_g");
    }

    #[test]
    fn sanitize_component_rejects_traversal_and_empty() {
        assert_eq!(sanitize_component(".."), "_");
        assert_eq!(sanitize_component("."), "_");
        assert_eq!(sanitize_component(""), "_");
        assert_eq!(sanitize_component("   "), "_");
    }

    #[test]
    fn sanitize_component_strips_trailing_dots_and_spaces() {
        assert_eq!(sanitize_component("photo.jpg."), "photo.jpg");
        assert_eq!(sanitize_component("name. "), "name");
    }

    #[test]
    fn sanitize_component_escapes_windows_reserved_names() {
        assert_eq!(sanitize_component("CON"), "_CON");
        assert_eq!(sanitize_component("con.txt"), "_con.txt");
        assert_eq!(sanitize_component("COM3.jpg"), "_COM3.jpg");
        assert_eq!(sanitize_component("console.txt"), "console.txt");
        assert_eq!(sanitize_component("COM10.jpg"), "COM10.jpg");
    }

    #[test]
    fn split_name_handles_extension_and_dotfiles() {
        assert_eq!(split_name("photo.jpg"), ("photo", ".jpg"));
        assert_eq!(split_name("archive.tar.gz"), ("archive.tar", ".gz"));
        assert_eq!(split_name("noext"), ("noext", ""));
        assert_eq!(split_name(".hidden"), (".hidden", ""));
    }

    #[test]
    fn resolve_collision_appends_sequence_numbers() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        assert_eq!(resolve_collision(dir, "a.jpg", &HashSet::new()), "a.jpg");

        std::fs::write(dir.join("a.jpg"), b"x").unwrap();
        assert_eq!(
            resolve_collision(dir, "a.jpg", &HashSet::new()),
            "a (1).jpg"
        );

        let mut claimed = HashSet::new();
        claimed.insert("a (1).jpg".to_string());
        assert_eq!(resolve_collision(dir, "a.jpg", &claimed), "a (2).jpg");
    }

    #[test]
    fn index_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        assert!(load_index(dir).is_empty());

        let mut idx = HashMap::new();
        idx.insert("file1".to_string(), "a.jpg".to_string());
        save_index(dir, &idx);
        assert_eq!(load_index(dir), idx);
    }
}
