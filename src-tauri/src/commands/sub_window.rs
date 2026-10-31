//! 子窓 (ポップアウト / ミラー / PiP) の生成・破棄・名簿の口 (#1131 段 4)。
//!
//! 窓を作るのは Rust。URL と label はここで組み (外部 URL や `main` の名乗りの口を
//! 作らない)、親子・生成数の上限・ジオメトリの記録も Rust が持つ。JS は kind ごとの
//! payload と描画知識 (サイズ) と、人の操作か自動かの `origin` を渡すだけ。
//! capability からは窓生成の権限を外してある (`capabilities/default.json`)。
//!
//! Windows では同期 command やイベントハンドラ内で窓を作ると deadlock するので、
//! 生成は async command の中だけで行う。

use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{Manager, State};
use tauri_specta::Event;

use super::{Result, WindowRoleState};
use crate::window_registry::{is_valid_popout_label, CloseReason, WindowKind};

/// 開きたい窓。URL は Rust が組む
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SubWindowRequest {
    /// カラム群を切り出す。label はプロファイルの `windows[].id` と一致させる必要が
    /// あるので JS が渡す (形式は Rust が検証する)
    Popout {
        #[serde(rename = "profileId")]
        profile_id: String,
        #[serde(rename = "windowId")]
        window_id: String,
    },
    /// 2 枚目以降のデッキ窓 (対等)
    Mirror {
        #[serde(rename = "profileId")]
        profile_id: String,
    },
    /// カラム 1 本 (`col`) かウィンドウ内容 1 つ (`win`)。どちらも base64 の JSON
    /// (PipPage が復号する)。無ければカラムの選択画面
    Pip {
        col: Option<String>,
        win: Option<String>,
    },
}

/// 誰が開こうとしたか。上限に達したとき、自動は拒み、人の操作は警告して開く
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SubWindowOrigin {
    User,
    Automatic,
}

/// 描画知識 (論理 px)。JS が決める
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SubWindowSize {
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SubWindowCreateResult {
    /// 開いた。`over_limit` なら呼び元が警告を出す (枚数つき)
    Created {
        label: String,
        #[serde(rename = "openCount")]
        open_count: usize,
        #[serde(rename = "overLimit")]
        over_limit: bool,
    },
    /// 自動の経路で上限に達していたので開かなかった
    Rejected {
        #[serde(rename = "openCount")]
        open_count: usize,
    },
}

/// 名簿の 1 行 (`main` を含む)
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SubWindowEntry {
    pub label: String,
    pub kind: WindowKind,
    pub parent: Option<String>,
}

/// 窓の位置と大きさ (論理 px)。`WebviewWindow` の生成オプションと同じ単位
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub monitor: Option<String>,
}

/// 子窓が消えた。宛先は親 (居なければ代表窓)。`reason` は Rust が決める
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ChildClosed {
    pub to: String,
    pub label: String,
    pub kind: WindowKind,
    pub reason: CloseReason,
    /// 最後に記録した位置と大きさ (ポップアウトだけ)
    pub geometry: Option<WindowGeometry>,
}

/// 子窓 (ポップアウト) が動いた / 大きさが変わった (debounce 済み)。宛先は親
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct ChildGeometry {
    pub to: String,
    pub label: String,
    pub geometry: WindowGeometry,
}

/// PiP の「デッキに戻す」。宛先は最も近いデッキ画面を描く祖先 (無ければ代表窓)。
/// 受けた窓は自分の windowId を付けて addColumn する
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct PipReturnRequested {
    pub to: String,
    pub column: serde_json::Value,
}

/// 名簿の label が増減した。全窓へ流す (宛先付きではない)。デッキ窓は「その窓が
/// 生きているか」で windowId 付きのカラムを描くかを決める (#1131 §6)
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct SubWindowsChanged {
    pub labels: Vec<String>,
}

static LABEL_SEQ: AtomicU64 = AtomicU64::new(0);

fn gen_label(prefix: &str) -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let n = LABEL_SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    format!("{prefix}-{millis}-{n}")
}

fn invalid(msg: impl Into<String>) -> notecli::error::NoteDeckError {
    notecli::error::NoteDeckError::InvalidInput(msg.into())
}

/// base64 (btoa) の文字だけ許す。URL の query に素のまま置く
fn is_base64_like(s: &str) -> bool {
    !s.is_empty()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
}

/// 相対 URL (path + query) を組む。値は form エンコードで、外部 URL にはならない
fn app_url(path: &str, pairs: &[(&str, &str)]) -> String {
    let mut url = tauri::Url::parse("app://localhost/").expect("static base url");
    url.set_path(path);
    if !pairs.is_empty() {
        let mut q = url.query_pairs_mut();
        for (k, v) in pairs {
            q.append_pair(k, v);
        }
    }
    match url.query() {
        Some(q) => format!("{}?{q}", url.path()),
        None => url.path().to_string(),
    }
}

/// 要求を (label, kind, 相対 URL) に解く。label の検証と URL の組み立てはここだけ
pub(crate) fn resolve_request(req: &SubWindowRequest) -> Result<(String, WindowKind, String)> {
    match req {
        SubWindowRequest::Popout {
            profile_id,
            window_id,
        } => {
            if !is_valid_popout_label(window_id) {
                return Err(invalid(format!("invalid popout window id: {window_id}")));
            }
            let url = app_url("/", &[("profile", profile_id), ("window", window_id)]);
            Ok((window_id.clone(), WindowKind::Popout, url))
        }
        SubWindowRequest::Mirror { profile_id } => Ok((
            gen_label("deck"),
            WindowKind::Mirror,
            app_url("/", &[("profile", profile_id)]),
        )),
        SubWindowRequest::Pip { col, win } => {
            let mut pairs: Vec<(&str, &str)> = Vec::new();
            if let Some(c) = col {
                if !is_base64_like(c) {
                    return Err(invalid("pip col payload must be base64"));
                }
                pairs.push(("col", c));
            } else if let Some(w) = win {
                if !is_base64_like(w) {
                    return Err(invalid("pip win payload must be base64"));
                }
                pairs.push(("win", w));
            }
            // base64 の `+` を form エンコードすると `%2B` になり、PipPage の
            // `route.query` が復号して元に戻る
            Ok((gen_label("pip"), WindowKind::Pip, app_url("/pip", &pairs)))
        }
    }
}

/// kind ごとに許される呼び元: ポップアウト / ミラーを頼めるのはデッキ窓だけ。
/// PiP はデッキ画面を描く窓か PiP (ポップアウトのカラムも PiP にできる)
fn caller_may_open(caller: WindowKind, kind: WindowKind) -> bool {
    match kind {
        WindowKind::Popout | WindowKind::Mirror => caller.is_deck(),
        WindowKind::Pip => true,
        WindowKind::Main => false,
    }
}

/// 子窓を作る。親は呼び元の窓 (ミラーは対等なので親を記録しない)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn sub_window_create(
    webview: tauri::WebviewWindow,
    state: State<'_, WindowRoleState>,
    request: SubWindowRequest,
    origin: SubWindowOrigin,
    size: SubWindowSize,
) -> Result<SubWindowCreateResult> {
    let app = webview.app_handle().clone();
    let caller = webview.label().to_string();
    let caller_kind = state.kind(&caller).unwrap_or_else(|| {
        // 名乗る前に呼ばれた (起動直後)。URL から決める
        webview
            .url()
            .map(|u| crate::window_registry::kind_from_url(&caller, u.path(), u.query()))
            .unwrap_or(WindowKind::Mirror)
    });
    let (label, kind, url) = resolve_request(&request)?;
    if !caller_may_open(caller_kind, kind) {
        return Err(invalid(format!(
            "a {caller_kind:?} window may not open a {kind:?} window"
        )));
    }
    if app.get_webview_window(&label).is_some() {
        return Err(invalid(format!("window label already exists: {label}")));
    }

    let (open_count, at_limit) = state.limit_check();
    if at_limit && origin == SubWindowOrigin::Automatic {
        tracing::info!(
            label,
            open_count,
            "[sub-window] limit reached, automatic open rejected"
        );
        return Ok(SubWindowCreateResult::Rejected { open_count });
    }
    state.begin_create(&label);

    let parent = (kind != WindowKind::Mirror).then_some(caller.as_str());
    let built = build_window(&app, &label, kind, &url, &size);
    match built {
        Ok(win) => {
            state.register(&app, &label, kind, parent);
            if kind == WindowKind::Pip {
                // Windows ではビルダーの always_on_top が効かないことがあるので掛け直す
                let _ = win.set_always_on_top(true);
            } else {
                crate::window_events::arm_show_fuse(&app, &label);
            }
            let (open_count, over_limit) = state.limit_check();
            Ok(SubWindowCreateResult::Created {
                label,
                open_count,
                over_limit,
            })
        }
        Err(e) => {
            state.end_create(&label);
            tracing::warn!(label, "[sub-window] create failed: {e}");
            Err(invalid(format!("failed to create window: {e}")))
        }
    }
}

fn build_window(
    app: &tauri::AppHandle,
    label: &str,
    kind: WindowKind,
    url: &str,
    size: &SubWindowSize,
) -> tauri::Result<tauri::WebviewWindow> {
    let mut b = tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App(url.into()))
        .inner_size(size.width, size.height)
        .min_inner_size(size.min_width, size.min_height)
        .decorations(false)
        .resizable(true);
    if let (Some(x), Some(y)) = (size.x, size.y) {
        b = b.position(x, y);
    }
    b = match kind {
        WindowKind::Pip => b
            .title("NoteDeck PiP")
            .always_on_top(true)
            .minimizable(false)
            .maximizable(false)
            .visible(true)
            .disable_drag_drop_handler(),
        // デッキ画面は mount 後に JS が show する (起動時の窓と同じ)
        _ => b.title("NoteDeck").visible(false),
    };
    b.build()
}

/// 子窓を閉じる。名簿に居る `main` 以外だけ。
/// `graceful` なら `close()` (CloseRequested を見るので理由は `user`、カラムは回収される。
/// 「すべてのウィンドウを閉じる」用)、そうでなければ `destroy()` (`lost`。プロファイル
/// 切替の一括クローズ用で、旧プロファイルの windowId は残り切り戻しで復元される)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub async fn sub_window_close(
    webview: tauri::WebviewWindow,
    state: State<'_, WindowRoleState>,
    label: String,
    graceful: bool,
) -> Result<()> {
    let Some(kind) = state.kind(&label) else {
        return Err(invalid(format!("unknown window: {label}")));
    };
    if kind == WindowKind::Main {
        return Err(invalid("main window cannot be closed this way"));
    }
    if let Some(w) = webview.app_handle().get_webview_window(&label) {
        let r = if graceful { w.close() } else { w.destroy() };
        r.map_err(|e| invalid(format!("failed to close {label}: {e}")))?;
    }
    Ok(())
}

/// 名簿 (全窓)。受けた知らせの label が居ないことの確認や、自分の子の列挙に使う
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn sub_window_list(state: State<'_, WindowRoleState>) -> Result<Vec<SubWindowEntry>> {
    Ok(state
        .entries()
        .into_iter()
        .map(|e| SubWindowEntry {
            label: e.label,
            kind: e.kind,
            parent: e.parent,
        })
        .collect())
}

/// PiP の「デッキに戻す」。カラムの設定を最も近いデッキ画面を描く祖先へ届ける。
/// 窓は呼び元が自分で close する (CloseRequested を見るので `user`)
// nd-command: local
#[tauri::command]
#[specta::specta]
pub fn pip_return_to_deck(
    webview: tauri::WebviewWindow,
    state: State<'_, WindowRoleState>,
    column: serde_json::Value,
) -> Result<()> {
    if state.kind(webview.label()) != Some(WindowKind::Pip) {
        return Err(invalid("only a pip window can return a column"));
    }
    if !column.is_object() {
        return Err(invalid("column must be an object"));
    }
    if state.deliver_pip_return(webview.app_handle(), webview.label(), column) {
        Ok(())
    } else {
        Err(invalid("no deck window to return the column to"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn popout_url_is_built_by_rust_with_the_profile_and_window_ids_encoded() {
        let (label, kind, url) = resolve_request(&SubWindowRequest::Popout {
            profile_id: "日本語 profile".into(),
            window_id: "deck-1-1".into(),
        })
        .unwrap();
        assert_eq!(label, "deck-1-1");
        assert_eq!(kind, WindowKind::Popout);
        assert_eq!(
            url,
            "/?profile=%E6%97%A5%E6%9C%AC%E8%AA%9E+profile&window=deck-1-1"
        );
    }

    #[test]
    fn popout_cannot_claim_main_or_a_pip_label() {
        for bad in ["main", "pip-1-1", "deck-x", "../evil"] {
            let err = resolve_request(&SubWindowRequest::Popout {
                profile_id: "p".into(),
                window_id: bad.into(),
            });
            assert!(err.is_err(), "{bad}");
        }
    }

    #[test]
    fn mirror_and_pip_labels_are_generated_with_the_capability_prefixes() {
        let (label, kind, url) = resolve_request(&SubWindowRequest::Mirror {
            profile_id: "p".into(),
        })
        .unwrap();
        assert!(label.starts_with("deck-"), "{label}");
        assert!(is_valid_popout_label(&label), "{label}");
        assert_eq!(kind, WindowKind::Mirror);
        assert_eq!(url, "/?profile=p");

        let (label, kind, url) = resolve_request(&SubWindowRequest::Pip {
            col: Some("eyJ0eXBlIjoi+/=".into()),
            win: None,
        })
        .unwrap();
        assert!(label.starts_with("pip-"), "{label}");
        assert_eq!(kind, WindowKind::Pip);
        assert_eq!(url, "/pip?col=eyJ0eXBlIjoi%2B%2F%3D");

        let (_, _, url) = resolve_request(&SubWindowRequest::Pip {
            col: None,
            win: None,
        })
        .unwrap();
        assert_eq!(url, "/pip");
    }

    #[test]
    fn pip_payloads_must_be_base64() {
        assert!(resolve_request(&SubWindowRequest::Pip {
            col: Some("javascript:alert(1)".into()),
            win: None,
        })
        .is_err());
        assert!(resolve_request(&SubWindowRequest::Pip {
            col: None,
            win: Some("a b".into()),
        })
        .is_err());
    }

    #[test]
    fn only_deck_windows_open_popouts_and_mirrors() {
        assert!(caller_may_open(WindowKind::Main, WindowKind::Popout));
        assert!(caller_may_open(WindowKind::Mirror, WindowKind::Mirror));
        assert!(!caller_may_open(WindowKind::Popout, WindowKind::Popout));
        assert!(!caller_may_open(WindowKind::Pip, WindowKind::Mirror));
        assert!(caller_may_open(WindowKind::Popout, WindowKind::Pip));
        assert!(caller_may_open(WindowKind::Pip, WindowKind::Pip));
        assert!(!caller_may_open(WindowKind::Main, WindowKind::Main));
    }
}
