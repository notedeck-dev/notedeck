//! カラムクエリの QIR (typed Query IR) 型定義と検証コマンド (#783)。
//!
//! QIR 型は Rust が source of truth で、specta 経由で bindings.ts に載る (V21)。
//! フロントの compiler (src/services/columnQuery/compiler.ts) は AiScript AST を
//! この型へコンパイルし、JS QIR eval が streaming/fetch 面で評価する。
//! Phase 3 で Rust QIR eval (ローカルキャッシュ検索・バックフィル) が加わる。
//!
//! 意味論は AiScript 1.2.1 と同一 (不変条件 (a))。全評価器は共有 golden vector
//! (src/services/columnQuery/golden/vectors.json) で一致を検証する。

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use specta::Type;
use std::borrow::Cow;
use std::collections::HashMap;

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
type EvalResult<'a> = Result<Cow<'a, JsonValue>, EvalError>;

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
