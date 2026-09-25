//! HTTP API (port 19820) の external principal gate (#712 §5.3 / #711 / #1099)。
//!
//! 永続トークン由来のリクエストを external プロファイル (permissions.json5 の
//! `external`) に従属させる。従来は永続トークンが起動毎の ephemeral 全権
//! トークンへ詰め替えられて notecli の生 Misskey ルート (投稿 / 削除 /
//! リアクション等) にそのまま流れており、「外部アプリ = readonly」が生ルートに
//! 対して嘘だった。
//!
//! - **gate の適用対象は永続トークン由来のみ** (`ExternalTokenMarker` 付き)。
//!   ephemeral トークン直用 (notecli CLI 等のローカルプロセス) は token file を
//!   読める = 本人と同格の local trust として免除 (挙動変更ゼロ)。
//! - **GET / 非 GET とも deny-by-default + per-route の明示対応表**。対応表に
//!   無いルートはメソッド問わず 403 (notecli 側で新ルートが増えても黙って
//!   開かない)。
//! - **granted 集合は Rust が permissions.json5 を直接読んで解決する**
//!   (`permissions_profile`)。以前はフロントの `resolveFor('external')` の結果を
//!   IPC で受け取っていたが、WebView 内の任意 JS がその command を呼べる以上、
//!   外部トークンの権限を JS から全許可に書き換えられた (#1099)。ファイルは
//!   リクエストごとに読む — 外部トークン由来のリクエストにしか走らず、
//!   ファイルは小さいので、キャッシュの整合を持ち込むより単純で確実。
//! - **ファイルが無ければ既定プロファイル、壊れていれば readonly** — フロントと
//!   同じ倒し方 (golden で一致検査)。読取エラーも readonly 側に倒す。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use axum::extract::Request;
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

use crate::permissions_profile::{self, Granted, PrincipalId};

/// 永続トークンで認証されたリクエストに付く marker (request extension)。
/// プロセス外から付与できないため「inbound ヘッダーの strip 忘れ」という
/// 脆弱性クラス自体が存在しない (#712 §7.2 と同じ理由で extension 方式)。
#[derive(Clone, Copy, Debug)]
pub struct ExternalTokenMarker;

const PERMISSIONS_FILE_NAME: &str = "permissions.json5";

/// `<settings dir>/permissions.json5`。起動時に `init` で 1 回だけ決まる。
static PERMISSIONS_PATH: OnceLock<PathBuf> = OnceLock::new();

/// 設定ディレクトリ (`<app dir>/notedeck`) を登録する。HTTP サーバー起動前
/// (setup) に呼ぶ。
pub fn init(settings_dir: &Path) {
    let _ = PERMISSIONS_PATH.set(settings_dir.join(PERMISSIONS_FILE_NAME));
}

/// ファイル読取結果 → principal の実効 granted。NotFound は「ファイル無し」
/// (既定プロファイル)、その他の IO エラーは破損と同じ readonly に倒す。
fn granted_from_read(result: std::io::Result<String>, id: PrincipalId) -> Granted {
    match result {
        Ok(content) => permissions_profile::resolve(Some(&content), id),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            permissions_profile::resolve(None, id)
        }
        Err(_) => permissions_profile::resolve_fallback(id),
    }
}

/// principal の実効 granted を permissions.json5 から解決する。呼ぶたびに
/// ファイルを読むので、外部エディタでの変更は次の判定から効く (再起動不要)。
/// `init` 前 (HTTP サーバーは setup 後に起動するので通常は無い) は既定プロファイル。
/// AI ループ (#1133) は tool 一覧の組み立てと tool 呼び出しごとの認可に使う。
pub async fn granted_for(id: PrincipalId) -> Granted {
    match PERMISSIONS_PATH.get() {
        Some(path) => granted_from_read(tokio::fs::read_to_string(path).await, id),
        None => permissions_profile::resolve(None, id),
    }
}

/// principal の preset 名と実効 granted (`meta.permissions`)。`granted_for` と同じ
/// 読み方で、ファイル無し / 読取失敗の扱いも揃える。
pub async fn profile_for(id: PrincipalId) -> (&'static str, Granted) {
    let Some(path) = PERMISSIONS_PATH.get() else {
        return (
            permissions_profile::preset_of(None, id),
            permissions_profile::resolve(None, id),
        );
    };
    match tokio::fs::read_to_string(path).await {
        Ok(content) => (
            permissions_profile::preset_of(Some(&content), id),
            permissions_profile::resolve(Some(&content), id),
        ),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (
            permissions_profile::preset_of(None, id),
            permissions_profile::resolve(None, id),
        ),
        Err(_) => ("readonly", permissions_profile::resolve_fallback(id)),
    }
}

async fn external_granted() -> Granted {
    granted_for(PrincipalId::External).await
}

/// 「次から確認しない」(#714) の記憶を permissions.json5 の `confirmSkips`
/// から引く。AI ループ (#1133) が確認の要否を決めるときに使う。読めない /
/// 壊れている / `init` 前は「記憶なし」(= 確認する側に倒す)。
pub async fn confirm_skipped(scope: &str, capability_id: &str) -> bool {
    let Some(path) = PERMISSIONS_PATH.get() else {
        return false;
    };
    match tokio::fs::read_to_string(path).await {
        Ok(content) => permissions_profile::confirm_skipped(&content, scope, capability_id),
        Err(_) => false,
    }
}

/// ルート → 必要 PermissionKey の判定結果。
#[derive(Debug, PartialEq)]
pub enum RouteRule {
    /// gate 免除 (公開 meta / discovery / dispatcher 到達ルート)
    Exempt,
    /// このキーが全て granted なら許可
    Keys(&'static [&'static str]),
    /// 対応表に無い / 恒久拒否
    Deny,
}

/// per-route 対応表 (#712 §5.3)。openapi.json の全ルートを網羅する — 網羅は
/// `every_openapi_route_has_an_explicit_rule` が機械検査する (#1098)。
/// 対応表に無いパスは Deny (deny-by-default)。
pub fn route_rule(method: &Method, path: &str) -> RouteRule {
    explicit_route_rule(method, path).unwrap_or(RouteRule::Deny)
}

/// 対応表に明示されたルールだけを返す。None = 対応表に無い (fallback の Deny)。
/// 恒久拒否のルートは `Some(Deny)` で書き、「忘れて Deny」と区別する。
fn explicit_route_rule(method: &Method, path: &str) -> Option<RouteRule> {
    use RouteRule::{Deny, Exempt, Keys};
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();

    // --- 公開 meta / proxy (認証自体が無いルート) ---
    match (method, path) {
        (&Method::GET, "/api")
        | (&Method::GET, "/api/docs")
        | (&Method::GET, "/api/openapi.json") => {
            return Some(Exempt);
        }
        _ => {}
    }
    if method == Method::GET && path.starts_with("/proxy/image") {
        return Some(Exempt);
    }

    // --- NoteDeck 固有ルート (先に完全一致で判定 — {host} パターンより優先) ---
    if path == "/api/capabilities" && method == Method::GET {
        // capability id の列挙は静的 metadata で秘匿情報でない。外部アプリの
        // discovery に必要 (#712 §5.3)
        return Some(Exempt);
    }
    if segments.len() == 4
        && segments[0] == "api"
        && segments[1] == "capabilities"
        && segments[3] == "execute"
        && method == Method::POST
    {
        // dispatcher に届くルートは gate 免除 — dispatcher が external
        // principal で enforce する (単一 enforce 点の維持)
        return Some(Exempt);
    }
    if path == "/api/health" && method == Method::GET {
        // self-diagnosis の summary は免除。streams 詳細 (接続先 host 等) の
        // deck.read gate はハンドラ側で応答から間引く
        return Some(Exempt);
    }
    if method == Method::GET {
        match path {
            // ローカル identity 列挙 (全アカウント / 全サーバー) — サーバー側
            // account.read ではなく deck.read (external デフォルト OFF)
            "/api/accounts" => return Some(Keys(&["deck.read"])),
            // カラム構成 = 検索クエリ / アンテナ名等のローカル私的データ
            "/api/deck/columns" | "/api/deck/active" => {
                return Some(Keys(&["deck.read"]));
            }
            // コマンド一覧はインストール済みプラグイン由来の項目を含む
            "/api/commands" => return Some(Keys(&["deck.read"])),
            // SSE: timeline + notification 等の複合面。v1 は接続時に両キーを
            // 要求する (notifications=false で notification イベントだけ filter
            // する形は notecli 側 stream の wrap が必要なので将来)
            "/api/events" => {
                return Some(Keys(&["notes.read", "notifications"]));
            }
            // 診断・開発向けの面。従来は対応表に無く fallback で Deny だったのを
            // 明示した (挙動は同じ)。外部トークンへ開放するなら個別に判断する
            "/api/heartbeat/status"
            | "/api/inspector/recent"
            | "/api/logs/recent"
            | "/api/perf/caches"
            | "/api/permissions/resolved"
            | "/api/querybridge/trace"
            | "/api/startup/trace" => return Some(Deny),
            _ => {}
        }
    }

    // --- notecli core proxy: /api/{host}/... ---
    if segments.len() >= 3 && segments[0] == "api" {
        let rest = &segments[2..];
        return match (method, rest) {
            (&Method::POST, ["note"]) => Some(Keys(&["notes.write"])),
            (&Method::GET, ["timeline", _]) => Some(Keys(&["notes.read"])),
            (&Method::GET, ["notifications"]) => Some(Keys(&["notifications"])),
            (&Method::GET, ["search"]) => Some(Keys(&["notes.read"])),
            (&Method::GET, ["notes", _]) => Some(Keys(&["notes.read"])),
            (&Method::DELETE, ["notes", _]) => Some(Keys(&["notes.write"])),
            (&Method::GET, ["notes", _, "children" | "conversation" | "reactions"]) => {
                Some(Keys(&["notes.read"]))
            }
            (&Method::POST, ["notes", _, "reactions"])
            | (&Method::DELETE, ["notes", _, "reactions"]) => Some(Keys(&["notes.react"])),
            (&Method::GET, ["users", _]) => Some(Keys(&["account.read"])),
            (&Method::GET, ["users", _, "notes"]) => Some(Keys(&["notes.read"])),
            _ => None,
        };
    }

    None
}

fn forbidden(required: &[&str]) -> Response {
    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "ok": false,
            "code": "permission_denied",
            "principal": "external",
            "required": required,
            "error": format!(
                "denied for external principal: required [{}] (permissions.json5 の外部アプリ権限で許可すると使えます)",
                required.join(", ")
            ),
        })),
    )
        .into_response()
}

/// external gate middleware。`ExternalTokenMarker` が付いたリクエスト
/// (= 永続トークン由来) のみ enforce する。
pub async fn external_gate_middleware(req: Request, next: Next) -> Response {
    if req.extensions().get::<ExternalTokenMarker>().is_none() {
        return next.run(req).await;
    }
    match route_rule(req.method(), req.uri().path()) {
        RouteRule::Exempt => next.run(req).await,
        RouteRule::Keys(keys) => {
            let granted = external_granted().await;
            let denied: Vec<&str> = keys
                .iter()
                .filter(|k| !granted.contains(*k))
                .copied()
                .collect();
            if denied.is_empty() {
                next.run(req).await
            } else {
                forbidden(&denied)
            }
        }
        RouteRule::Deny => forbidden(&[]),
    }
}

/// health ハンドラ用: 永続トークン由来のリクエストで streams 詳細
/// (接続先 host 等のローカルデータ) を返してよいか。
pub async fn external_may_read_deck() -> bool {
    external_granted().await.contains("deck.read")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_write_routes_require_write_keys() {
        assert_eq!(
            route_rule(&Method::POST, "/api/misskey.io/note"),
            RouteRule::Keys(&["notes.write"])
        );
        assert_eq!(
            route_rule(&Method::DELETE, "/api/misskey.io/notes/abc123"),
            RouteRule::Keys(&["notes.write"])
        );
        assert_eq!(
            route_rule(&Method::POST, "/api/misskey.io/notes/abc123/reactions"),
            RouteRule::Keys(&["notes.react"])
        );
    }

    #[test]
    fn get_routes_map_to_read_keys() {
        assert_eq!(
            route_rule(&Method::GET, "/api/misskey.io/timeline/home"),
            RouteRule::Keys(&["notes.read"])
        );
        assert_eq!(
            route_rule(&Method::GET, "/api/misskey.io/notifications"),
            RouteRule::Keys(&["notifications"])
        );
        assert_eq!(
            route_rule(&Method::GET, "/api/misskey.io/users/xyz"),
            RouteRule::Keys(&["account.read"])
        );
        // ローカル identity 列挙は deck.read (サーバー側 account.read ではない)
        assert_eq!(
            route_rule(&Method::GET, "/api/accounts"),
            RouteRule::Keys(&["deck.read"])
        );
        assert_eq!(
            route_rule(&Method::GET, "/api/deck/columns"),
            RouteRule::Keys(&["deck.read"])
        );
    }

    #[test]
    fn dispatcher_and_discovery_routes_are_exempt() {
        assert_eq!(
            route_rule(&Method::POST, "/api/capabilities/notes.create/execute"),
            RouteRule::Exempt
        );
        assert_eq!(
            route_rule(&Method::GET, "/api/capabilities"),
            RouteRule::Exempt
        );
        assert_eq!(route_rule(&Method::GET, "/api/health"), RouteRule::Exempt);
        assert_eq!(route_rule(&Method::GET, "/api"), RouteRule::Exempt);
    }

    /// openapi.json の全ルートが対応表に明示されている (#1098)。新しいルートを
    /// 足して表を忘れると fallback の Deny で黙って塞がるので、ここで落とす。
    #[test]
    fn every_openapi_route_has_an_explicit_rule() {
        let spec: serde_json::Value =
            serde_json::from_str(include_str!("../../../src-tauri/openapi.json"))
                .expect("openapi.json parses");
        let paths = spec["paths"].as_object().expect("paths object");
        let mut missing = Vec::new();
        for (template, ops) in paths {
            let concrete = template
                .replace("{host}", "misskey.io")
                .replace("{note_id}", "abc123")
                .replace("{user_id}", "u1")
                .replace("{tl_type}", "home")
                .replace("{capability_id}", "notes.create");
            for method in ops.as_object().expect("operations").keys() {
                let m = match method.as_str() {
                    "get" => Method::GET,
                    "post" => Method::POST,
                    "put" => Method::PUT,
                    "delete" => Method::DELETE,
                    "patch" => Method::PATCH,
                    _ => continue,
                };
                if explicit_route_rule(&m, &concrete).is_none() {
                    missing.push(format!("{} {}", m, template));
                }
            }
        }
        assert!(
            missing.is_empty(),
            "routes without an explicit rule: {missing:?}"
        );
    }

    #[test]
    fn unknown_routes_are_denied() {
        assert_eq!(
            route_rule(&Method::POST, "/api/misskey.io/follow"),
            RouteRule::Deny
        );
        assert_eq!(
            route_rule(&Method::PUT, "/api/deck/columns"),
            RouteRule::Deny
        );
        assert_eq!(route_rule(&Method::GET, "/api/unknown"), RouteRule::Deny);
    }

    #[test]
    fn missing_file_grants_only_misskey_read_floor() {
        let g = granted_from_read(
            Err(std::io::Error::from(std::io::ErrorKind::NotFound)),
            PrincipalId::External,
        );
        assert!(g.contains("notes.read"));
        assert!(g.contains("account.read"));
        // floor 外は既定で拒否
        assert!(!g.contains("notifications"));
        assert!(!g.contains("deck.read"));
        assert!(!g.contains("notes.write"));
    }

    #[test]
    fn file_content_controls_non_floor_keys() {
        let g = granted_from_read(
            Ok(
            "{ principals: { external: { preset: 'custom', custom: { 'notes.write': true, 'deck.read': false } } } }"
                .to_string(),
            ),
            PrincipalId::External,
        );
        assert!(g.contains("notes.write"));
        assert!(!g.contains("deck.read"));
        // floor は保存値に関わらず true
        assert!(g.contains("clips.read"));
    }

    #[test]
    fn unreadable_file_falls_back_to_readonly_with_floor() {
        // 広い権限は届かず、readonly + floor に倒れる (旧 lockdown と同じ側)
        let g = granted_from_read(
            Err(std::io::Error::from(std::io::ErrorKind::PermissionDenied)),
            PrincipalId::External,
        );
        assert!(!g.contains("notes.write"));
        assert!(!g.contains("notifications"));
        assert!(g.contains("notes.read"));
    }

    #[tokio::test]
    async fn reads_permissions_file_from_disk_per_request() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PERMISSIONS_FILE_NAME);
        // このテストは OnceLock を触らず、ファイル読取 → 解決の経路だけを実機で確かめる
        std::fs::write(&path, "{ principals: { external: { preset: 'full' } } }").unwrap();
        let g = granted_from_read(
            tokio::fs::read_to_string(&path).await,
            PrincipalId::External,
        );
        assert!(g.contains("notes.write"));
        assert!(
            !g.contains("tasks.run"),
            "third-party deny survives full preset"
        );
        std::fs::write(
            &path,
            "{ principals: { external: { preset: 'readonly' } } }",
        )
        .unwrap();
        let g = granted_from_read(
            tokio::fs::read_to_string(&path).await,
            PrincipalId::External,
        );
        assert!(!g.contains("notes.write"));
    }
}
