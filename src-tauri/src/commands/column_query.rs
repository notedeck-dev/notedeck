//! カラムクエリの QIR (typed Query IR) 型定義と検証コマンド (#783)。
//!
//! QIR 型は Rust が source of truth で、specta 経由で bindings.ts に載る (V21)。
//! フロントの compiler (src/services/columnQuery/compiler.ts) は AiScript AST を
//! この型へコンパイルし、JS QIR eval が streaming/fetch 面で評価する。
//! Phase 3 で Rust QIR eval (ローカルキャッシュ検索・バックフィル) が加わる。
//!
//! 意味論は AiScript 1.2.1 と同一 (不変条件 (a))。全評価器は共有 golden vector
//! (src/services/columnQuery/golden/vectors.json) で一致を検証する。

use super::{AppState, Result};
use notecli::db::CachedNoteCursor;
use notecli::error::NoteDeckError;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use specta::Type;
use std::borrow::Cow;
use std::collections::HashMap;
use tauri::State;

/// QIR スキーマ世代。互換性のない構造変更で上げる。
pub const QIR_SCHEMA_VERSION: u32 = 1;

/// QIR 全体のノード数上限 (関数脱糖後、V18/V19)。
pub const QIR_MAX_NODES: u32 = 2000;

/// QIR の深さ上限 (eval の深さガードと対、V18)。二項 &&/|| の左結合連鎖は
/// 深さ = 項数になるため、キーワードリスト系クエリ (数百項の ||) を想定して
/// 余裕を持たせる。評価器の再帰はこの深さでもスタック安全。
pub const QIR_MAX_DEPTH: u32 = 256;

/// コンパイル済みカラムクエリ。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QirQuery {
    /// QIR_SCHEMA_VERSION。評価器は未知世代を必ず拒否する。
    pub schema_version: u32,
    /// トップレベル式。コンパイラが静的に bool 型であることを保証する (V20)。
    pub root: QirNode,
}

/// 数値比較演算子 (AiScript の `< <= > >=`、数値専用)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum QirCmpOp {
    Lt,
    Lteq,
    Gt,
    Gteq,
}

/// 文字列判定演算 (レシーバ str・引数 str・返り値 bool。1 引数形のみ)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum QirStrTestOp {
    Incl,
    StartsWith,
    EndsWith,
}

/// 文字列変換演算 (レシーバ str・返り値 str)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum QirStrMapOp {
    Lower,
    Upper,
}

/// let 束縛。slot はコンパイラが式全体で一意に割り当てる
/// (関数脱糖後もシャドーイングが発生しないよう名前でなく番号で参照する)。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QirBinding {
    pub slot: u32,
    pub expr: QirNode,
}

/// QIR ノード。意味論は AiScript 1.2.1 と同一:
/// - 欠落キーへのアクセスは null
/// - null レシーバへの演算は per-note エラー (= ノート除外 + 診断計上)
/// - `&&`/`||`/`!` は boolean 必須、比較は数値専用、`==`/`!=` はスカラーのみ
/// - Let は eager 評価でエラー伝播 (未使用束縛のエラーも観測される、V19)
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum QirNode {
    /// 文字列リテラル
    Str { value: String },
    /// 数値リテラル
    Num { value: f64 },
    /// 真偽リテラル
    Bool { value: bool },
    /// null リテラル
    Null,
    /// note ルートからのフィールドアクセス列 (例: ["user","host"])。
    /// 各ステップ: 現在値が obj → キー取得 (欠落は null)、null → エラー、他 → エラー
    Field { path: Vec<String> },
    /// obj への文字列リテラル index (例: note.reactions["👍"])。欠落キーは null
    ObjIndex { target: Box<QirNode>, key: String },
    /// 配列の .len (prop 参照)。str.len は独自計数のため QIR 対象外 (V20)
    ArrLen { target: Box<QirNode> },
    /// let 束縛列 + 本体。束縛は宣言順に eager 評価しエラー伝播する
    Let {
        bindings: Vec<QirBinding>,
        body: Box<QirNode>,
    },
    /// 束縛スロットの参照
    Ref { slot: u32 },
    /// 論理否定 (boolean 必須)
    Not { expr: Box<QirNode> },
    /// 短絡 AND (両辺 boolean 必須)
    And {
        left: Box<QirNode>,
        right: Box<QirNode>,
    },
    /// 短絡 OR (両辺 boolean 必須)
    Or {
        left: Box<QirNode>,
        right: Box<QirNode>,
    },
    /// 数値比較 (両辺 num 必須、他型はエラー)
    Cmp {
        op: QirCmpOp,
        left: Box<QirNode>,
        right: Box<QirNode>,
    },
    /// スカラー等値 (negated=true で !=)。null==null は true、型不一致は false
    Eq {
        negated: bool,
        left: Box<QirNode>,
        right: Box<QirNode>,
    },
    /// str.incl / str.starts_with / str.ends_with (1 引数形)
    StrTest {
        op: QirStrTestOp,
        target: Box<QirNode>,
        needle: Box<QirNode>,
    },
    /// str.lower / str.upper
    StrMap {
        op: QirStrMapOp,
        target: Box<QirNode>,
    },
    /// arr.incl (要素とのスカラー等値判定)
    ArrIncl {
        target: Box<QirNode>,
        needle: Box<QirNode>,
    },
}

/// qir_validate の結果。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QirValidation {
    pub ok: bool,
    pub node_count: u32,
    pub max_depth: u32,
    /// ok=false のときの理由 (人間可読)。
    pub errors: Vec<String>,
}

struct Walk {
    count: u32,
    max_depth: u32,
}

fn walk(node: &QirNode, depth: u32, w: &mut Walk) {
    w.count = w.count.saturating_add(1);
    w.max_depth = w.max_depth.max(depth);
    // 上限超過後は打ち切り (悪意ある巨大 QIR で validate 自体が重くならないように)
    if w.count > QIR_MAX_NODES || depth > QIR_MAX_DEPTH {
        return;
    }
    match node {
        QirNode::Str { .. }
        | QirNode::Num { .. }
        | QirNode::Bool { .. }
        | QirNode::Null
        | QirNode::Field { .. }
        | QirNode::Ref { .. } => {}
        QirNode::ObjIndex { target, .. }
        | QirNode::ArrLen { target }
        | QirNode::StrMap { target, .. }
        | QirNode::Not { expr: target } => walk(target, depth + 1, w),
        QirNode::Let { bindings, body } => {
            for b in bindings {
                walk(&b.expr, depth + 1, w);
            }
            walk(body, depth + 1, w);
        }
        QirNode::And { left, right }
        | QirNode::Or { left, right }
        | QirNode::Cmp { left, right, .. }
        | QirNode::Eq { left, right, .. } => {
            walk(left, depth + 1, w);
            walk(right, depth + 1, w);
        }
        QirNode::StrTest { target, needle, .. } | QirNode::ArrIncl { target, needle } => {
            walk(target, depth + 1, w);
            walk(needle, depth + 1, w);
        }
    }
}

/// QIR の構造検証 (スキーマ世代 + ノード数/深さ上限)。
///
/// IPC 受領時の Rust 側検証 (V18/V21)。Phase 1 では評価はフロントで完結する
/// ため副作用はないが、bindings.ts に QIR 型契約を載せる役割を兼ねる。
#[tauri::command]
#[specta::specta]
pub fn qir_validate(query: QirQuery) -> QirValidation {
    let mut errors = Vec::new();
    if query.schema_version != QIR_SCHEMA_VERSION {
        errors.push(format!(
            "unsupported schemaVersion {} (expected {})",
            query.schema_version, QIR_SCHEMA_VERSION
        ));
    }
    let mut w = Walk {
        count: 0,
        max_depth: 0,
    };
    walk(&query.root, 1, &mut w);
    if w.count > QIR_MAX_NODES {
        errors.push(format!("node count exceeds {QIR_MAX_NODES}"));
    }
    if w.max_depth > QIR_MAX_DEPTH {
        errors.push(format!("depth exceeds {QIR_MAX_DEPTH}"));
    }
    QirValidation {
        ok: errors.is_empty(),
        node_count: w.count,
        max_depth: w.max_depth,
        errors,
    }
}

/// キャッシュ検索の結果 (Phase 3)。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QirSearchResult {
    pub notes: Vec<notecli::models::NormalizedNote>,
    /// 実際に読んだ行数 (走査上限に対する進み具合)
    pub scanned: u32,
    /// per-note エラーで除外した件数 (V14 の診断計上)
    pub errors: u32,
    /// 走査上限で打ち切ったときの継続位置。読み切った場合は null
    pub cursor: Option<QirSearchCursor>,
}

/// 継続カーソル。次の呼び出しにそのまま渡す。
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QirSearchCursor {
    pub created_at: String,
    pub note_id: String,
}

/// ローカルキャッシュをクエリで検索する (#783 Phase 3)。
///
/// FTS5 で粗く絞ってから QIR 評価器で判定する。押し込むリテラルの抽出は
/// 偽陰性を出さない規則に従うので (不変条件 (b))、FTS で落ちたノートが
/// 本来マッチするということはない。
///
/// `timeline_key` (canonical 文字列) を渡すと当該バケット所属のみを母集合に
/// する。実体/所属分離 (notecli#30) 以前は所属が後勝ち上書きで種別絞りが
/// 取りこぼしになるため全体走査しかなかったが、その妥協は解消済み。
/// null は従来どおりアカウントの全キャッシュを走査する。
///
/// 走査上限に達したら打ち切って継続カーソルを返す。呼び出し側は必要なだけ
/// 繰り返す (一度の呼び出しで巨大キャッシュを読み切らせない)。カーソルは
/// 同じ timeline_key の続き読みにのみ使うこと。
#[tauri::command]
#[specta::specta]
pub async fn qir_search_cache(
    app_state: State<'_, AppState>,
    account_id: String,
    query: QirQuery,
    timeline_key: Option<String>,
    limit: Option<u32>,
    max_scanned_rows: Option<u32>,
    cursor: Option<QirSearchCursor>,
) -> Result<QirSearchResult> {
    let validation = qir_validate(query.clone());
    if !validation.ok {
        return Err(NoteDeckError::InvalidInput(validation.errors.join(", ")));
    }
    // 不正キーは黙殺せず Err で顕在化 (キャッシュ読み出し系と同方針)
    let scope = timeline_key
        .as_deref()
        .map(notecli::models::TimelineKey::parse)
        .transpose()?;
    let literals = extract_fts_literals(&query);
    let limit = limit.unwrap_or(40).clamp(1, 200) as usize;
    let max_scanned = max_scanned_rows.unwrap_or(2000).clamp(1, 20_000) as usize;
    let after = cursor.map(|c| CachedNoteCursor {
        created_at: c.created_at,
        note_id: c.note_id,
    });

    let db = app_state.db().await;
    let scan = db.scan_cached_notes(
        &account_id,
        scope.as_ref(),
        &literals,
        limit,
        max_scanned,
        after.as_ref(),
        |note| match serde_json::to_value(note) {
            Ok(value) => match evaluate_qir(&query, &value) {
                QirVerdict::Match => Some(true),
                QirVerdict::Unmatch => Some(false),
                QirVerdict::Error => None,
            },
            // 手元の値を JSON に戻せない = 評価対象の形にできない。
            // None を返せば scan 側が per-note エラーとして数える
            Err(_) => None,
        },
    )?;

    Ok(QirSearchResult {
        notes: scan.notes,
        scanned: scan.scanned as u32,
        errors: scan.errors as u32,
        cursor: scan.cursor.map(|c| QirSearchCursor {
            created_at: c.created_at,
            note_id: c.note_id,
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leaf() -> QirNode {
        QirNode::Bool { value: true }
    }

    #[test]
    fn validates_simple_query() {
        let v = qir_validate(QirQuery {
            schema_version: QIR_SCHEMA_VERSION,
            root: QirNode::And {
                left: Box::new(leaf()),
                right: Box::new(QirNode::Not {
                    expr: Box::new(leaf()),
                }),
            },
        });
        assert!(v.ok);
        assert_eq!(v.node_count, 4);
        assert_eq!(v.max_depth, 3);
    }

    #[test]
    fn rejects_unknown_schema_version() {
        let v = qir_validate(QirQuery {
            schema_version: QIR_SCHEMA_VERSION + 1,
            root: leaf(),
        });
        assert!(!v.ok);
    }

    #[test]
    fn rejects_excessive_depth() {
        let mut node = leaf();
        for _ in 0..(QIR_MAX_DEPTH + 5) {
            node = QirNode::Not {
                expr: Box::new(node),
            };
        }
        let v = qir_validate(QirQuery {
            schema_version: QIR_SCHEMA_VERSION,
            root: node,
        });
        assert!(!v.ok);
    }

    #[test]
    fn serde_shape_is_tagged_camel_case() {
        let json = serde_json::to_value(QirNode::StrTest {
            op: QirStrTestOp::StartsWith,
            target: Box::new(QirNode::Field {
                path: vec!["text".into()],
            }),
            needle: Box::new(QirNode::Str { value: "a".into() }),
        })
        .unwrap();
        assert_eq!(json["kind"], "strTest");
        assert_eq!(json["op"], "startsWith");
        assert_eq!(json["target"]["kind"], "field");
        assert_eq!(json["target"]["path"][0], "text");
    }
}

// --- QIR 評価器 (Phase 3) ---------------------------------------------------

// 評価器は Phase 3 の結線 (notecli の predicate 注入 API へ述語として渡す) で
// 初めて呼ばれる。それまでは golden differential test からのみ参照されるため、
// 非テストビルドでは未使用になる。

/// per-note の判定結果 (V14 の 3 値)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum QirVerdict {
    Match,
    Unmatch,
    /// 型エラー・null レシーバ・非 bool 結果。ノートを除外して診断に計上する
    Error,
}

/// 評価中の per-note エラー。呼び出し側では Verdict::Error に畳まれる。
#[allow(dead_code)]
struct EvalError;

#[allow(dead_code)]
type EvalResult<'a> = std::result::Result<Cow<'a, JsonValue>, EvalError>;

#[allow(dead_code)]
struct Evaluator<'a> {
    note: &'a JsonValue,
    slots: HashMap<u32, JsonValue>,
}

#[allow(dead_code)]
impl<'a> Evaluator<'a> {
    fn new(note: &'a JsonValue) -> Self {
        Self {
            note,
            slots: HashMap::new(),
        }
    }

    /// AiScript の `==`: null==null は true、スカラーは値比較、型不一致は false。
    /// 非スカラー同士はコンパイラが静的に禁止しているため false に倒す
    /// (JS 側の参照等価分岐に相当する到達不能ケース)。
    fn ai_eq(l: &JsonValue, r: &JsonValue) -> bool {
        match (l, r) {
            (JsonValue::Null, JsonValue::Null) => true,
            (JsonValue::Null, _) | (_, JsonValue::Null) => false,
            (JsonValue::String(a), JsonValue::String(b)) => a == b,
            (JsonValue::Number(a), JsonValue::Number(b)) => a.as_f64() == b.as_f64(),
            (JsonValue::Bool(a), JsonValue::Bool(b)) => a == b,
            _ => false,
        }
    }

    fn eval(&mut self, node: &QirNode, depth: u32) -> EvalResult<'a> {
        if depth > QIR_MAX_DEPTH {
            return Err(EvalError);
        }
        let d = depth + 1;
        match node {
            QirNode::Str { value } => Ok(Cow::Owned(JsonValue::String(value.clone()))),
            QirNode::Num { value } => Ok(Cow::Owned(
                serde_json::Number::from_f64(*value)
                    .map(JsonValue::Number)
                    .unwrap_or(JsonValue::Null),
            )),
            QirNode::Bool { value } => Ok(Cow::Owned(JsonValue::Bool(*value))),
            QirNode::Null => Ok(Cow::Owned(JsonValue::Null)),
            QirNode::Field { path } => {
                let mut cur = self.note;
                for key in path {
                    match cur {
                        // null へのプロパティ参照はエラー、欠落キーは null
                        JsonValue::Null => return Err(EvalError),
                        JsonValue::Object(map) => {
                            cur = map.get(key).unwrap_or(&JsonValue::Null);
                        }
                        _ => return Err(EvalError),
                    }
                }
                Ok(Cow::Borrowed(cur))
            }
            QirNode::ObjIndex { target, key } => {
                let target = self.eval(target, d)?;
                match target.as_ref() {
                    JsonValue::Object(map) => {
                        Ok(Cow::Owned(map.get(key).cloned().unwrap_or(JsonValue::Null)))
                    }
                    _ => Err(EvalError),
                }
            }
            QirNode::ArrLen { target } => {
                let target = self.eval(target, d)?;
                match target.as_ref() {
                    JsonValue::Array(items) => {
                        Ok(Cow::Owned(JsonValue::Number(items.len().into())))
                    }
                    _ => Err(EvalError),
                }
            }
            QirNode::Let { bindings, body } => {
                for b in bindings {
                    // eager 評価 + エラー伝播 (V19)。使われない束縛でもここで落ちる
                    let v = self.eval(&b.expr, d)?.into_owned();
                    self.slots.insert(b.slot, v);
                }
                self.eval(body, d)
            }
            QirNode::Ref { slot } => match self.slots.get(slot) {
                Some(v) => Ok(Cow::Owned(v.clone())),
                // コンパイラは割当済みスロットしか参照を出さない (QIR 破損)
                None => Err(EvalError),
            },
            QirNode::Not { expr } => {
                let v = self.eval(expr, d)?;
                match v.as_bool() {
                    Some(b) => Ok(Cow::Owned(JsonValue::Bool(!b))),
                    None => Err(EvalError),
                }
            }
            QirNode::And { left, right } => {
                let l = self.eval(left, d)?.as_bool().ok_or(EvalError)?;
                if !l {
                    return Ok(Cow::Owned(JsonValue::Bool(false)));
                }
                let r = self.eval(right, d)?.as_bool().ok_or(EvalError)?;
                Ok(Cow::Owned(JsonValue::Bool(r)))
            }
            QirNode::Or { left, right } => {
                let l = self.eval(left, d)?.as_bool().ok_or(EvalError)?;
                if l {
                    return Ok(Cow::Owned(JsonValue::Bool(true)));
                }
                let r = self.eval(right, d)?.as_bool().ok_or(EvalError)?;
                Ok(Cow::Owned(JsonValue::Bool(r)))
            }
            QirNode::Cmp { op, left, right } => {
                let l = self.eval(left, d)?.as_f64().ok_or(EvalError)?;
                let r = self.eval(right, d)?.as_f64().ok_or(EvalError)?;
                let out = match op {
                    QirCmpOp::Lt => l < r,
                    QirCmpOp::Lteq => l <= r,
                    QirCmpOp::Gt => l > r,
                    QirCmpOp::Gteq => l >= r,
                };
                Ok(Cow::Owned(JsonValue::Bool(out)))
            }
            QirNode::Eq {
                negated,
                left,
                right,
            } => {
                let l = self.eval(left, d)?.into_owned();
                let r = self.eval(right, d)?;
                let eq = Self::ai_eq(&l, r.as_ref());
                Ok(Cow::Owned(JsonValue::Bool(if *negated { !eq } else { eq })))
            }
            QirNode::StrTest { op, target, needle } => {
                let target = self.eval(target, d)?;
                let target = target.as_str().ok_or(EvalError)?;
                let needle = self.eval(needle, d)?;
                let needle = needle.as_str().ok_or(EvalError)?;
                let out = match op {
                    QirStrTestOp::Incl => target.contains(needle),
                    QirStrTestOp::StartsWith => target.starts_with(needle),
                    QirStrTestOp::EndsWith => target.ends_with(needle),
                };
                Ok(Cow::Owned(JsonValue::Bool(out)))
            }
            QirNode::StrMap { op, target } => {
                let target = self.eval(target, d)?;
                let target = target.as_str().ok_or(EvalError)?;
                let out = match op {
                    QirStrMapOp::Lower => target.to_lowercase(),
                    QirStrMapOp::Upper => target.to_uppercase(),
                };
                Ok(Cow::Owned(JsonValue::String(out)))
            }
            QirNode::ArrIncl { target, needle } => {
                let target = self.eval(target, d)?.into_owned();
                let items = match &target {
                    JsonValue::Array(items) => items,
                    _ => return Err(EvalError),
                };
                let needle = self.eval(needle, d)?;
                let hit = items.iter().any(|el| Self::ai_eq(el, needle.as_ref()));
                Ok(Cow::Owned(JsonValue::Bool(hit)))
            }
        }
    }
}

/// コンパイル済みクエリを 1 ノート (NormalizedNote の serde 形) に対して評価する。
///
/// 意味論は JS 評価器・AiScript 1.2.1 と同一で、共有 golden vector で
/// 一致を検証する (不変条件 (a))。
#[allow(dead_code)]
pub fn evaluate_qir(query: &QirQuery, note: &JsonValue) -> QirVerdict {
    if query.schema_version != QIR_SCHEMA_VERSION {
        return QirVerdict::Error;
    }
    match Evaluator::new(note).eval(&query.root, 1) {
        Ok(v) => match v.as_bool() {
            Some(true) => QirVerdict::Match,
            Some(false) => QirVerdict::Unmatch,
            // トップレベルが bool でないのは per-note エラー (V20)
            None => QirVerdict::Error,
        },
        Err(EvalError) => QirVerdict::Error,
    }
}

#[cfg(test)]
mod golden_tests {
    use super::*;
    use std::collections::BTreeMap;

    /// 共有 golden vector (不変条件 (a) の Rust 面)。
    ///
    /// 期待値の正本は AiScript 1.2.1 の実挙動で、JS 側は同じ vectors.json を
    /// 参照評価器と JS QIR eval の 2 面で検証している。ここは 3 面目。
    /// QIR は JS のコンパイラが生成したスナップショット (`pnpm gen:golden-qir`)。
    #[derive(serde::Deserialize)]
    struct GoldenFile {
        cases: Vec<GoldenCase>,
    }

    #[derive(serde::Deserialize)]
    struct GoldenCase {
        name: String,
        note: JsonValue,
        expected: String,
    }

    #[derive(serde::Deserialize)]
    struct QirSnapshot {
        cases: BTreeMap<String, QirQuery>,
    }

    fn read(rel: &str) -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
        std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()))
    }

    #[test]
    fn rust_eval_matches_golden_vectors() {
        let golden: GoldenFile =
            serde_json::from_str(&read("../src/services/columnQuery/golden/vectors.json"))
                .expect("parse vectors.json");
        let snapshot: QirSnapshot = serde_json::from_str(&read(
            "../src/services/columnQuery/golden/qir.generated.json",
        ))
        .expect("parse qir.generated.json — run `pnpm gen:golden-qir`");

        let mut checked = 0;
        for case in &golden.cases {
            // 静的型エラーで QIR にコンパイルされないケースは fallback 専用ベクタ
            let Some(query) = snapshot.cases.get(&case.name) else {
                continue;
            };
            let verdict = evaluate_qir(query, &case.note);
            let expected = match case.expected.as_str() {
                "match" => QirVerdict::Match,
                "unmatch" => QirVerdict::Unmatch,
                "error" => QirVerdict::Error,
                other => panic!("unknown expected verdict: {other}"),
            };
            assert_eq!(verdict, expected, "golden case `{}`", case.name);
            checked += 1;
        }
        assert!(checked > 0, "no golden case was evaluated");
    }

    /// スナップショットが古いと「評価されないケース」が黙って増える。
    /// 静的拒否ケース以外はすべて QIR を持っているはず。
    #[test]
    fn qir_snapshot_covers_every_compilable_case() {
        const STATIC_REJECT: &[&str] = &[
            "non-bool-result-error",
            "lt-on-string-error",
            "and-non-bool-error",
            "not-non-bool-error",
        ];
        let golden: GoldenFile =
            serde_json::from_str(&read("../src/services/columnQuery/golden/vectors.json")).unwrap();
        let snapshot: QirSnapshot = serde_json::from_str(&read(
            "../src/services/columnQuery/golden/qir.generated.json",
        ))
        .unwrap();
        let missing: Vec<&str> = golden
            .cases
            .iter()
            .map(|c| c.name.as_str())
            .filter(|n| !STATIC_REJECT.contains(n) && !snapshot.cases.contains_key(*n))
            .collect();
        assert!(
            missing.is_empty(),
            "QIR スナップショットが古いです。`pnpm gen:golden-qir` を実行してください: {missing:?}"
        );
    }
}

// --- FTS5 プリフィルタ (Phase 3b) --------------------------------------------

/// FTS5 の trigram トークナイザが成立する最小文字数。これ未満は 0 件になるので
/// 押し込むと偽陰性になる (notecli 側も同じ閾値で FTS/LIKE を分岐している)。
const FTS_MIN_CHARS: usize = 3;

/// FTS5 プリフィルタに押し込めるリテラルを抽出する (V16 の健全性規則)。
///
/// 不変条件 (b) は「偽陰性を出さない」こと。つまり返すリテラルは
/// **eval が真になるノートなら必ず note.text に含まれている**ものに限る。
/// そのために辿ってよい位置を次に絞る:
///
///   - トップレベルからの連言 (`And`) と `Let` の body のみ
///   - `Or` の枝には入らない (片側が偽でも全体が真になりうる)
///   - `Not` の下 (負極性) には入らない (真 = 含まないなので逆になる)
///   - レシーバは `note.text` そのもの。`lower()` 等を挟んだものは押し込まない
///   - `cw` や `user.username` は対象外 (FTS インデックスは text のみ)
///
/// 返り値は AND 結合で使う想定。MATCH 文字列の組み立てとエスケープは
/// クエリを発行する側 (notecli) の責務。
#[allow(dead_code)]
pub fn extract_fts_literals(query: &QirQuery) -> Vec<String> {
    let mut out = Vec::new();
    if query.schema_version != QIR_SCHEMA_VERSION {
        return out;
    }
    collect_conjunctive_literals(&query.root, &mut out);
    out
}

/// note.text へのフィールド参照そのものか (変換を挟んでいないか)
fn is_note_text(node: &QirNode) -> bool {
    matches!(node, QirNode::Field { path } if path.as_slice() == ["text"])
}

fn collect_conjunctive_literals(node: &QirNode, out: &mut Vec<String>) {
    match node {
        QirNode::And { left, right } => {
            collect_conjunctive_literals(left, out);
            collect_conjunctive_literals(right, out);
        }
        // 束縛は eager 評価されるだけで、真偽を決めるのは body
        QirNode::Let { body, .. } => collect_conjunctive_literals(body, out),
        QirNode::StrTest {
            op: QirStrTestOp::Incl,
            target,
            needle,
        } => {
            if !is_note_text(target) {
                return;
            }
            if let QirNode::Str { value } = needle.as_ref() {
                if value.chars().count() >= FTS_MIN_CHARS {
                    out.push(value.clone());
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod fts_tests {
    use super::*;

    fn field(path: &[&str]) -> QirNode {
        QirNode::Field {
            path: path.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn incl(target: QirNode, needle: &str) -> QirNode {
        QirNode::StrTest {
            op: QirStrTestOp::Incl,
            target: Box::new(target),
            needle: Box::new(QirNode::Str {
                value: needle.to_string(),
            }),
        }
    }

    fn not_null(target: QirNode) -> QirNode {
        QirNode::Eq {
            negated: true,
            left: Box::new(target),
            right: Box::new(QirNode::Null),
        }
    }

    fn and(l: QirNode, r: QirNode) -> QirNode {
        QirNode::And {
            left: Box::new(l),
            right: Box::new(r),
        }
    }

    fn or(l: QirNode, r: QirNode) -> QirNode {
        QirNode::Or {
            left: Box::new(l),
            right: Box::new(r),
        }
    }

    fn not(e: QirNode) -> QirNode {
        QirNode::Not { expr: Box::new(e) }
    }

    fn query(root: QirNode) -> QirQuery {
        QirQuery {
            schema_version: QIR_SCHEMA_VERSION,
            root,
        }
    }

    #[test]
    fn extracts_conjunctive_text_literal() {
        let q = query(and(
            not_null(field(&["text"])),
            incl(field(&["text"]), "misskey"),
        ));
        assert_eq!(extract_fts_literals(&q), vec!["misskey".to_string()]);
    }

    #[test]
    fn extracts_every_literal_in_a_conjunction() {
        let q = query(and(
            incl(field(&["text"]), "alpha"),
            incl(field(&["text"]), "bravo"),
        ));
        assert_eq!(
            extract_fts_literals(&q),
            vec!["alpha".to_string(), "bravo".to_string()]
        );
    }

    #[test]
    fn skips_disjunction() {
        // どちらか片方でも真なら通るので、片方のリテラルを押し込むと偽陰性になる
        let q = query(or(
            incl(field(&["text"]), "alpha"),
            incl(field(&["text"]), "bravo"),
        ));
        assert!(extract_fts_literals(&q).is_empty());
    }

    #[test]
    fn skips_negation() {
        // 真 = 含まない、なので押し込むと意味が逆になる
        let q = query(not(incl(field(&["text"]), "alpha")));
        assert!(extract_fts_literals(&q).is_empty());
    }

    #[test]
    fn skips_short_literal() {
        // trigram は 3 文字未満で 0 件を返す
        let q = query(incl(field(&["text"]), "ab"));
        assert!(extract_fts_literals(&q).is_empty());
        let q = query(incl(field(&["text"]), "abc"));
        assert_eq!(extract_fts_literals(&q), vec!["abc".to_string()]);
    }

    #[test]
    fn skips_transformed_receiver() {
        // lower() を挟むとケース保存でなくなるので押し込めない
        let lowered = QirNode::StrMap {
            op: QirStrMapOp::Lower,
            target: Box::new(field(&["text"])),
        };
        let q = query(incl(lowered, "misskey"));
        assert!(extract_fts_literals(&q).is_empty());
    }

    #[test]
    fn skips_other_fields() {
        // FTS インデックスが張られているのは text のみ
        let q = query(incl(field(&["cw"]), "misskey"));
        assert!(extract_fts_literals(&q).is_empty());
        let q = query(incl(field(&["user", "username"]), "misskey"));
        assert!(extract_fts_literals(&q).is_empty());
    }

    #[test]
    fn looks_through_let_body() {
        let q = query(QirNode::Let {
            bindings: vec![QirBinding {
                slot: 0,
                expr: field(&["text"]),
            }],
            body: Box::new(incl(field(&["text"]), "misskey")),
        });
        assert_eq!(extract_fts_literals(&q), vec!["misskey".to_string()]);
    }

    #[test]
    fn counts_unicode_chars_not_bytes() {
        // 日本語 3 文字は 9 バイトだが trigram としては成立する
        let q = query(incl(field(&["text"]), "技術書"));
        assert_eq!(extract_fts_literals(&q), vec!["技術書".to_string()]);
    }

    #[test]
    fn rejects_unknown_schema_version() {
        let q = QirQuery {
            schema_version: QIR_SCHEMA_VERSION + 1,
            root: incl(field(&["text"]), "misskey"),
        };
        assert!(extract_fts_literals(&q).is_empty());
    }

    /// 不変条件 (b) の直接検証: eval が真になるノートは、抽出した全リテラルを
    /// note.text に含んでいなければならない (含んでいなければ FTS プリフィルタが
    /// そのノートを落とし、偽陰性になる)。
    ///
    /// proptest は入れず、QIR の形とノートの全組み合わせを回して確かめる。
    #[test]
    fn prefilter_never_produces_false_negatives() {
        let shapes: Vec<(&str, QirNode)> = vec![
            ("plain-incl", incl(field(&["text"]), "alpha")),
            (
                "guarded-incl",
                and(not_null(field(&["text"])), incl(field(&["text"]), "alpha")),
            ),
            (
                "conjunction",
                and(
                    incl(field(&["text"]), "alpha"),
                    incl(field(&["text"]), "bravo"),
                ),
            ),
            (
                "disjunction",
                or(
                    incl(field(&["text"]), "alpha"),
                    incl(field(&["text"]), "bravo"),
                ),
            ),
            ("negation", not(incl(field(&["text"]), "alpha"))),
            (
                "mixed",
                and(
                    incl(field(&["text"]), "alpha"),
                    or(
                        incl(field(&["text"]), "bravo"),
                        incl(field(&["text"]), "charlie"),
                    ),
                ),
            ),
            (
                "negated-conjunction",
                not(and(
                    incl(field(&["text"]), "alpha"),
                    incl(field(&["text"]), "bravo"),
                )),
            ),
            (
                "let-body",
                QirNode::Let {
                    bindings: vec![QirBinding {
                        slot: 0,
                        expr: QirNode::Bool { value: true },
                    }],
                    body: Box::new(incl(field(&["text"]), "alpha")),
                },
            ),
            (
                "cw-only",
                and(not_null(field(&["cw"])), incl(field(&["cw"]), "alpha")),
            ),
        ];

        let texts: Vec<JsonValue> = vec![
            JsonValue::Null,
            JsonValue::String(String::new()),
            JsonValue::String("alpha".into()),
            JsonValue::String("bravo".into()),
            JsonValue::String("alpha bravo".into()),
            JsonValue::String("alpha charlie".into()),
            JsonValue::String("nothing here".into()),
            JsonValue::String("ALPHA".into()),
        ];
        let cws: Vec<JsonValue> = vec![JsonValue::Null, JsonValue::String("alpha".into())];

        for (name, root) in &shapes {
            let q = query(root.clone());
            let literals = extract_fts_literals(&q);
            for text in &texts {
                for cw in &cws {
                    let note = serde_json::json!({ "text": text, "cw": cw });
                    if evaluate_qir(&q, &note) != QirVerdict::Match {
                        continue;
                    }
                    let haystack = text.as_str().unwrap_or("");
                    for lit in &literals {
                        assert!(
                            haystack.contains(lit.as_str()),
                            "偽陰性: shape={name} literal={lit:?} text={haystack:?} が \
                             eval では match なのに FTS プリフィルタで落ちる"
                        );
                    }
                }
            }
        }
    }
}
