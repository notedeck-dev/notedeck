//! capability の宣言表 (Rust 側)。正本は `crates/notecore/capabilities.json5`、
//! 表そのものは `generated.rs` に生成される (`pnpm gen:capabilities`、#1133)。
//!
//! notecore のエージェントループはここから AI に渡す tool 一覧を組み、
//! 宣言 (権限 / 確認の要否 / cheap / 実行属性) を読んで認可と経路を決める。
//! TS 側 (`src/capabilities/declarations.generated.ts` と `toolSchema.ts`) と
//! 同じ宣言から同じ tool schema になることを golden (`src/capabilities/golden/
//! tools.json`、期待値の正本は JS 側) で検査する。

pub mod exec;

use serde_json::{json, Map, Value};

/// capability の実行属性 (#1106 §4.8)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exec {
    /// notecore 単独で実行できる
    Core,
    /// 接続中のデバイスに実行要求する (UI 系・plugin 由来)
    Device,
    /// ライブ接続必須
    Live,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    General,
    Navigation,
    Column,
    Account,
    Note,
    Window,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamType {
    String,
    Number,
    Boolean,
    Object,
    Array,
}

impl ParamType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::String => "string",
            Self::Number => "number",
            Self::Boolean => "boolean",
            Self::Object => "object",
            Self::Array => "array",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReturnType {
    String,
    Number,
    Boolean,
    Object,
    Array,
    Void,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParamDecl {
    pub name: &'static str,
    pub ty: ParamType,
    pub description: &'static str,
    /// 省略可能なら true (= tool schema の required に入れない)
    pub optional: bool,
    /// 宣言時に決まる許容値。実行時に決まる enum (カラム種別など) は宣言に無く、
    /// デバイス側が tool schema を組むときに足す
    pub enum_values: Option<&'static [&'static str]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReturnDecl {
    pub ty: ReturnType,
    pub description: Option<&'static str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityDecl {
    pub id: &'static str,
    pub label: &'static str,
    pub category: Category,
    pub icon: &'static str,
    pub permissions: &'static [&'static str],
    /// AI の tool として見せるか
    pub ai_tool: bool,
    /// 実行前に確認が要りうるか (表示内容の組み立てはデバイス側)
    pub confirm: bool,
    pub acts_as_account: bool,
    /// HEARTBEAT の cheap check に使ってよいか (#411)
    pub cheap: bool,
    /// コマンドパレットに並べるか
    pub visible: bool,
    /// 結果に他人の内容 (投稿 / プロフィール / 通知 / fetch 結果) を含みうる読取。
    /// 読んだセッションは以後 tainted (#1103 / #1133)
    pub untrusted: bool,
    /// 無人実行 (HEARTBEAT) でも確認なしで走ってよい (権限だけで gate)
    pub unattended: bool,
    /// 書き込みの宛先になる引数 (返信先 / 対象ユーザー / URL)。値の出所を判定する
    pub destinations: &'static [&'static str],
    pub exec: Exec,
    pub description: &'static str,
    pub params: &'static [ParamDecl],
    pub returns: Option<ReturnDecl>,
}

include!("generated.rs");

/// id で宣言を引く (id は生成時に辞書順で並ぶので二分探索)。
pub fn find(id: &str) -> Option<&'static CapabilityDecl> {
    CAPABILITIES
        .binary_search_by(|d| d.id.cmp(id))
        .ok()
        .map(|i| &CAPABILITIES[i])
}

/// capability id → AI tool name。Anthropic / OpenAI とも `.` を許さないので
/// `_` に置換する (TS 側 `sanitizeToolName` と同じ 1 対 1 写像)。
pub fn tool_name(id: &str) -> String {
    id.replace('.', "_")
}

/// tool name → capability id (逆写像。id に `_` は無い)。
pub fn id_from_tool_name(name: &str) -> String {
    name.replace('_', ".")
}

/// 引数宣言を JSON Schema (object) にする。TS 側 `paramsToInputSchema` と同じ形。
pub fn input_schema(decl: &CapabilityDecl) -> Value {
    let mut properties = Map::new();
    let mut required = Vec::new();
    for p in decl.params {
        let mut schema = Map::new();
        schema.insert("type".into(), Value::String(p.ty.as_str().into()));
        schema.insert("description".into(), Value::String(p.description.into()));
        if let Some(values) = p.enum_values {
            schema.insert("enum".into(), json!(values));
        }
        properties.insert(p.name.into(), Value::Object(schema));
        if !p.optional {
            required.push(Value::String(p.name.into()));
        }
    }
    let mut out = Map::new();
    out.insert("type".into(), Value::String("object".into()));
    out.insert("properties".into(), Value::Object(properties));
    if !required.is_empty() {
        out.insert("required".into(), Value::Array(required));
    }
    Value::Object(out)
}

/// Anthropic Messages の tool 定義。
pub fn anthropic_tool(decl: &CapabilityDecl) -> Value {
    json!({
        "name": tool_name(decl.id),
        "description": decl.description,
        "input_schema": input_schema(decl),
    })
}

/// OpenAI Chat Completions の tool 定義 (Custom = OpenAI 互換もこれ)。
pub fn openai_tool(decl: &CapabilityDecl) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool_name(decl.id),
            "description": decl.description,
            "parameters": input_schema(decl),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permissions_profile::PERMISSION_KEYS;

    #[test]
    fn ids_are_sorted_and_unique() {
        for w in CAPABILITIES.windows(2) {
            assert!(w[0].id < w[1].id, "{} >= {}", w[0].id, w[1].id);
        }
        assert!(find("notes.create").is_some());
        assert!(find("no.such").is_none());
    }

    #[test]
    fn permissions_are_in_vocabulary() {
        for d in CAPABILITIES {
            for p in d.permissions {
                assert!(PERMISSION_KEYS.contains(p), "{}: unknown key {p}", d.id);
            }
        }
    }

    #[test]
    fn tool_name_round_trips() {
        for d in CAPABILITIES {
            assert!(
                !d.id.contains('_'),
                "{}: id に _ があると逆写像が壊れる",
                d.id
            );
            assert_eq!(id_from_tool_name(&tool_name(d.id)), d.id);
        }
    }

    #[test]
    fn openai_tool_wraps_the_same_schema() {
        for d in CAPABILITIES {
            let a = anthropic_tool(d);
            let o = openai_tool(d);
            assert_eq!(o["type"], "function");
            assert_eq!(o["function"]["name"], a["name"]);
            assert_eq!(o["function"]["description"], a["description"]);
            assert_eq!(o["function"]["parameters"], a["input_schema"]);
        }
    }

    /// 共有 golden (#1133)。JS 側 `goldenTools.test.ts` が宣言表から
    /// `toAnthropicTool` で組んだ tool 一覧と、Rust が同じ宣言から組んだものが
    /// 一致する (= ループを Rust に移しても AI に見える tool は変わらない)。
    #[test]
    fn anthropic_tools_match_golden() {
        #[derive(serde::Deserialize)]
        struct Golden {
            tools: Vec<Value>,
        }
        let golden: Golden = serde_json::from_str(include_str!(
            "../../../../src/capabilities/golden/tools.json"
        ))
        .expect("parse tools.json");
        assert_eq!(
            golden.tools.len(),
            CAPABILITIES.len(),
            "tool 数が JS 側と一致しません (`pnpm gen:golden-tools` で採取し直す)"
        );
        for (d, expected) in CAPABILITIES.iter().zip(&golden.tools) {
            let got = anthropic_tool(d);
            assert_eq!(
                &got, expected,
                "{}: tool schema が JS 側と一致しません (`pnpm gen:golden-tools` で採取し直す)",
                d.id
            );
        }
    }
}
