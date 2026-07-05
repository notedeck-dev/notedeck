//! HTTP API (port 19820) の external principal gate (#712 §5.3 / #711)。
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
//! - **判定に使う granted map はフロントの `resolveFor('external')` の結果を
//!   `permissions_sync` invoke で受け取ったもの** — preset / floor / clamp の
//!   ロジックを Rust に複製しない (判定の二重実装を持たない #712 §4.2)。
//! - **初回 sync 前は deny-by-default**: EXTERNAL_READ_FLOOR キーにマップされる
//!   GET のみ許可し、非 GET と floor 外キーの GET は拒否する。フロント初期化は
//!   数秒であり、「未設定のあいだ開いている」時間帯を作らない。

use std::collections::HashMap;
use std::sync::RwLock;

use axum::extract::Request;
use axum::http::{Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// 永続トークンで認証されたリクエストに付く marker (request extension)。
/// プロセス外から付与できないため「inbound ヘッダーの strip 忘れ」という
/// 脆弱性クラス自体が存在しない (#712 §7.2 と同じ理由で extension 方式)。
#[derive(Clone, Copy, Debug)]
pub struct ExternalTokenMarker;

/// external principal の Misskey コンテンツ read 下限 (#712 §5.3)。
/// フロント側 `EXTERNAL_READ_FLOOR` と同じ意味論的選択 — 「トークンを発行して
/// 渡す行為そのものが Misskey コンテンツ read への同意」。sync 前でもこの
/// キーにマップされる GET は許可する。
const EXTERNAL_READ_FLOOR: [&str; 4] =
    ["notes.read", "account.read", "drive.read", "clips.read"];

/// フロントから同期された external の実効 granted map。
/// None = 初回 sync 前 (deny-by-default で動く)。
static EXTERNAL_GRANTED: RwLock<Option<HashMap<String, bool>>> = RwLock::new(None);

/// フロントの `resolveFor('external')` の結果を受け取る (#712 §4.2)。
/// `reloadPermissionsConfig()` / 権限保存が必ずこれを伴う。
#[tauri::command]
#[specta::specta]
pub fn permissions_sync(external_granted: HashMap<String, bool>) -> Result<(), String> {
    let mut guard = EXTERNAL_GRANTED
        .write()
        .map_err(|e| format!("permissions sync lock poisoned: {e}"))?;
    *guard = Some(external_granted);
    Ok(())
}

/// external gate をフェイルセーフに倒す (#718)。sync がリトライ後も失敗し
/// 続けると、フロントの絞った権限が Rust に届かず古い広い map のまま動いて
/// しまう。フロントは失敗確定時にこれを呼び、floor 以外を全 deny の状態
/// (空 map) に固定する。以後は次の成功 sync が来るまで最小権限で動く。
///
/// 引数を取らないので、payload の serialize / 大きさ起因で `permissions_sync`
/// が失敗するケースでも到達できる (IPC 自体が全断ならこの呼び出しも失敗する
/// が、その場合フロントは警告に残す)。
#[tauri::command]
#[specta::specta]
pub fn permissions_lockdown() -> Result<(), String> {
    let mut guard = EXTERNAL_GRANTED
        .write()
        .map_err(|e| format!("permissions lockdown lock poisoned: {e}"))?;
    *guard = Some(HashMap::new());
    Ok(())
}

/// テスト用: sync 状態を初期化する。
#[cfg(test)]
pub fn reset_external_granted_for_test() {
    *EXTERNAL_GRANTED.write().unwrap() = None;
}

fn is_granted(key: &str) -> bool {
    // floor キーは sync 状態に関わらず常時許可 (resolveFor 側でも ON に clamp
    // されるので表示と一致する)
    if EXTERNAL_READ_FLOOR.contains(&key) {
        return true;
    }
    match EXTERNAL_GRANTED.read() {
        Ok(guard) => match guard.as_ref() {
            Some(map) => map.get(key).copied().unwrap_or(false),
            // 初回 sync 前: floor 外キーは拒否
            None => false,
        },
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

/// per-route 対応表 (#712 §5.3)。openapi.json の全 25 ルートを網羅する。
/// 対応表に無いパスは Deny (deny-by-default)。
pub fn route_rule(method: &Method, path: &str) -> RouteRule {
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();

    // --- 公開 meta / proxy (認証自体が無いルート) ---
    match (method, path) {
        (&Method::GET, "/api") | (&Method::GET, "/api/docs") | (&Method::GET, "/api/openapi.json") => {
            return RouteRule::Exempt;
        }
        _ => {}
    }
    if method == Method::GET && path.starts_with("/proxy/image") {
        return RouteRule::Exempt;
    }

    // --- NoteDeck 固有ルート (先に完全一致で判定 — {host} パターンより優先) ---
    if path == "/api/capabilities" && method == Method::GET {
        // capability id の列挙は静的 metadata で秘匿情報でない。外部アプリの
        // discovery に必要 (#712 §5.3)
        return RouteRule::Exempt;
    }
    if segments.len() == 4
        && segments[0] == "api"
        && segments[1] == "capabilities"
        && segments[3] == "execute"
        && method == Method::POST
    {
        // dispatcher に届くルートは gate 免除 — dispatcher が external
        // principal で enforce する (単一 enforce 点の維持)
        return RouteRule::Exempt;
    }
    if path == "/api/health" && method == Method::GET {
        // self-diagnosis の summary は免除。streams 詳細 (接続先 host 等) の
        // deck.read gate はハンドラ側で応答から間引く
        return RouteRule::Exempt;
    }
    if method == Method::GET {
        match path {
            // ローカル identity 列挙 (全アカウント / 全サーバー) — サーバー側
            // account.read ではなく deck.read (external デフォルト OFF)
            "/api/accounts" => return RouteRule::Keys(&["deck.read"]),
            // カラム構成 = 検索クエリ / アンテナ名等のローカル私的データ
            "/api/deck/columns" | "/api/deck/active" => {
                return RouteRule::Keys(&["deck.read"]);
            }
            // コマンド一覧はインストール済みプラグイン由来の項目を含む
            "/api/commands" => return RouteRule::Keys(&["deck.read"]),
            // SSE: timeline + notification 等の複合面。v1 は接続時に両キーを
            // 要求する (notifications=false で notification イベントだけ filter
            // する形は notecli 側 stream の wrap が必要なので将来)
            "/api/events" => {
                return RouteRule::Keys(&["notes.read", "notifications"]);
            }
            _ => {}
        }
    }

    // --- notecli core proxy: /api/{host}/... ---
    if segments.len() >= 3 && segments[0] == "api" {
        let rest = &segments[2..];
        return match (method, rest) {
            (&Method::POST, ["note"]) => RouteRule::Keys(&["notes.write"]),
            (&Method::GET, ["timeline", _]) => RouteRule::Keys(&["notes.read"]),
            (&Method::GET, ["notifications"]) => RouteRule::Keys(&["notifications"]),
            (&Method::GET, ["search"]) => RouteRule::Keys(&["notes.read"]),
            (&Method::GET, ["notes", _]) => RouteRule::Keys(&["notes.read"]),
            (&Method::DELETE, ["notes", _]) => RouteRule::Keys(&["notes.write"]),
            (&Method::GET, ["notes", _, "children" | "conversation" | "reactions"]) => {
                RouteRule::Keys(&["notes.read"])
            }
            (&Method::POST, ["notes", _, "reactions"])
            | (&Method::DELETE, ["notes", _, "reactions"]) => {
                RouteRule::Keys(&["notes.react"])
            }
            (&Method::GET, ["users", _]) => RouteRule::Keys(&["account.read"]),
            (&Method::GET, ["users", _, "notes"]) => RouteRule::Keys(&["notes.read"]),
            _ => RouteRule::Deny,
        };
    }

    RouteRule::Deny
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
            let denied: Vec<&str> = keys
                .iter()
                .filter(|k| !is_granted(k))
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
pub fn external_may_read_deck() -> bool {
    is_granted("deck.read")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// EXTERNAL_GRANTED はプロセス全体で共有のため、これを触るテストが
    /// 並列実行されると互いの sync/reset が混線して flaky になる (CI 実績あり)。
    /// state を変更するテストはこの lock を先頭で取って直列化する。
    static STATE_LOCK: Mutex<()> = Mutex::new(());

    fn lock_state() -> std::sync::MutexGuard<'static, ()> {
        // 先行テストの assert 失敗で poison されても後続テストは続行してよい
        STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn sync(pairs: &[(&str, bool)]) {
        let map: HashMap<String, bool> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), *v))
            .collect();
        *EXTERNAL_GRANTED.write().unwrap() = Some(map);
    }

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
    fn floor_keys_are_granted_even_before_first_sync() {
        let _guard = lock_state();
        reset_external_granted_for_test();
        assert!(is_granted("notes.read"));
        assert!(is_granted("account.read"));
        // floor 外キーは sync 前は拒否
        assert!(!is_granted("notifications"));
        assert!(!is_granted("deck.read"));
        assert!(!is_granted("notes.write"));
    }

    #[test]
    fn synced_map_controls_non_floor_keys() {
        let _guard = lock_state();
        sync(&[("notes.write", true), ("deck.read", false)]);
        assert!(is_granted("notes.write"));
        assert!(!is_granted("deck.read"));
        // floor は synced 値に関わらず true (resolveFor 側でも clamp 済み)
        assert!(is_granted("clips.read"));
        reset_external_granted_for_test();
    }

    #[test]
    fn lockdown_denies_non_floor_even_after_broad_sync() {
        let _guard = lock_state();
        // 広い権限が同期された後に lockdown すると floor 以外は全 deny (#718)
        sync(&[("notes.write", true), ("notifications", true)]);
        assert!(is_granted("notes.write"));
        permissions_lockdown().unwrap();
        assert!(!is_granted("notes.write"));
        assert!(!is_granted("notifications"));
        // floor は lockdown 後も維持 (トークン発行 = read 同意の下限)
        assert!(is_granted("notes.read"));
        assert!(is_granted("account.read"));
        reset_external_granted_for_test();
    }
}
