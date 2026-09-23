//! コマンド表 (#1106 §4.1、段階 0b)。
//!
//! データ系コマンドは「`&Core` と引数を取る関数」として各モジュール (timeline / ...) に
//! 置き、この表に 1 行ずつ登録する。表から生成されるもの:
//!
//! - [`CommandId`] と属性 (種別 / 許可ウィンドウ) — [`CommandId::meta`]
//! - JSON アダプタ [`dispatch`] — 引数は camelCase のオブジェクト (Tauri IPC の wire 形と同じ)。
//!   リモート構成の RPC 面がこれを受ける
//! - アプリ側の Tauri ラッパー (src-tauri の `commands/table.rs` が [`with_command_table!`] を
//!   使って生成)。表からしかラッパーが生まれないので、表に無いデータ系コマンドは存在しない
//! - フィクスチャ [`fixture_params`] — 全コマンドを JSON 経路で往復させるテスト用
//!
//! 属性検査 [`check`] は型付き経路 (Tauri ラッパー) でも JSON 経路でも本体を呼ぶ前に通る。
//!
//! 行の形: `<種別> [(window = main)] <名前>(<引数>: <型>, ...) -> <戻り型> = $crate::<本体>;`
//! 型はこの表の外 (アプリ側) でも解決できるよう完全修飾で書く。

pub mod table;
pub mod timeline;

use std::sync::LazyLock;

use notecli::error::NoteDeckError;
use serde_json::Value;

use crate::context::Core;
use crate::error::Result;

pub const MAX_UPLOAD_BYTES: usize = 50 * 1024 * 1024; // 50 MB

/// Regex for extracting HTTPS URLs from note text
static URL_RE: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"https?://[\w\-._~:/?#\[\]@!$&'()*+,;=%]+").unwrap());

/// Media extensions to skip OGP prefetch for (they won't have OGP tags)
static MEDIA_EXT_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?i)\.(jpg|jpeg|png|gif|webp|svg|mp4|webm|mov|mp3|ogg|wav)(\?.*)?$")
        .unwrap()
});

pub fn extract_ogp_urls(text: &str) -> Vec<String> {
    URL_RE
        .find_iter(text)
        .map(|m| m.as_str().to_string())
        .filter(|u| !MEDIA_EXT_RE.is_match(u))
        .collect()
}

/// コマンドの種別 (仕様 §4.1)。表に載るのは data だけ。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandKind {
    /// データ系。デバイスが 1 台も繋がっていなくても意味を持ち、notecored で実行できる
    Data,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandMeta {
    pub name: &'static str,
    pub kind: CommandKind,
    /// 許可ウィンドウ (label)。Some なら、その label のウィンドウからしか呼べない
    pub window: Option<&'static str>,
}

/// 呼び出し文脈。属性検査の材料で、principal は含めない (§4.1)。
#[derive(Debug, Clone, Default)]
pub struct CallContext {
    /// 呼び出し元のウィンドウ label。JSON 経路 (RPC) では None
    pub window: Option<String>,
}

impl CallContext {
    pub fn window(label: &str) -> Self {
        Self {
            window: Some(label.to_string()),
        }
    }
}

/// 本体を呼ぶ前の属性検査。型付き経路と JSON 経路で同じものを通す。
pub fn check(id: CommandId, ctx: &CallContext) -> Result<()> {
    let meta = id.meta();
    if let Some(required) = meta.window {
        if ctx.window.as_deref() != Some(required) {
            return Err(NoteDeckError::InvalidInput(format!(
                "{} is restricted to the {required} window",
                meta.name
            )));
        }
    }
    Ok(())
}

fn unknown_command(name: &str) -> NoteDeckError {
    NoteDeckError::InvalidInput(format!("unknown command: {name}"))
}

fn invalid_params(name: &str, e: serde_json::Error) -> NoteDeckError {
    NoteDeckError::InvalidInput(format!("invalid params for {name}: {e}"))
}

/// フィクスチャ用: snake_case → camelCase (serde の rename_all と同じ規則)
fn camel(snake: &str) -> String {
    let mut out = String::with_capacity(snake.len());
    let mut upper = false;
    for c in snake.chars() {
        if c == '_' {
            upper = true;
        } else if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

macro_rules! command_kind {
    (data) => {
        $crate::commands::CommandKind::Data
    };
}

macro_rules! command_window {
    () => {
        None
    };
    (window = $w:ident) => {
        Some(stringify!($w))
    };
}

/// 表の行を受け取る側のマクロ。`$name(...)` の 1 行ごとに Tauri ラッパーや
/// dispatch の腕を生成する。
macro_rules! define_table {
    ($( $kind:ident $( ( $($attr:tt)* ) )? $name:ident ( $( $arg:ident : $ty:ty ),* $(,)? ) -> $ret:ty = $path:path ; )*) => {
        /// 表に載っている全コマンド。variant 名はコマンド名そのもの (snake_case)。
        #[allow(non_camel_case_types)]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub enum CommandId {
            $( $name, )*
        }

        impl CommandId {
            pub fn name(self) -> &'static str {
                self.meta().name
            }

            pub fn meta(self) -> &'static CommandMeta {
                match self {
                    $( Self::$name => &CommandMeta {
                        name: stringify!($name),
                        kind: command_kind!($kind),
                        window: command_window!($( $($attr)* )?),
                    }, )*
                }
            }

            pub fn parse(name: &str) -> Option<Self> {
                match name {
                    $( stringify!($name) => Some(Self::$name), )*
                    _ => None,
                }
            }
        }

        pub const COMMANDS: &[CommandId] = &[ $( CommandId::$name, )* ];

        /// JSON アダプタ。`params` は引数名 (camelCase) をキーにしたオブジェクト。
        pub async fn dispatch(core: &Core, ctx: &CallContext, name: &str, params: Value) -> Result<Value> {
            let Some(id) = CommandId::parse(name) else {
                return Err(unknown_command(name));
            };
            check(id, ctx)?;
            let params = if params.is_null() { Value::Object(Default::default()) } else { params };
            match id {
                $( CommandId::$name => {
                    #[derive(serde::Deserialize)]
                    #[serde(rename_all = "camelCase")]
                    struct Params { $( $arg: $ty, )* }
                    let p: Params = serde_json::from_value(params).map_err(|e| invalid_params(name, e))?;
                    let out = $path(core, $( p.$arg, )*).await?;
                    Ok(serde_json::to_value(out)?)
                } )*
            }
        }

        /// 各引数の `Default` を camelCase キーで並べた最小の params。
        /// 「全コマンドを JSON 経路で往復させる」テストの入力。
        pub fn fixture_params(id: CommandId) -> Value {
            match id {
                $( CommandId::$name => {
                    #[allow(unused_mut)]
                    let mut m = serde_json::Map::new();
                    $( m.insert(camel(stringify!($arg)), serde_json::to_value(<$ty as Default>::default()).unwrap_or(Value::Null)); )*
                    Value::Object(m)
                } )*
            }
        }
    };
}

crate::with_command_table!(define_table);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::test_support::temp_core;

    #[test]
    fn names_are_unique_and_parse_back() {
        let mut seen = std::collections::HashSet::new();
        for id in COMMANDS {
            assert!(
                seen.insert(id.name()),
                "duplicate command name {}",
                id.name()
            );
            assert_eq!(CommandId::parse(id.name()), Some(*id));
        }
        assert_eq!(CommandId::parse("no_such_command"), None);
    }

    #[test]
    fn extract_urls_from_text() {
        let text = "Check https://example.com/article and https://blog.example.com/post";
        let urls = extract_ogp_urls(text);
        assert_eq!(urls.len(), 2);
        assert!(urls.contains(&"https://example.com/article".to_string()));
    }

    #[test]
    fn skip_media_urls() {
        let text = "Image: https://example.com/photo.jpg and https://example.com/video.mp4";
        let urls = extract_ogp_urls(text);
        assert!(urls.is_empty());
    }

    #[test]
    fn skip_media_with_query_params() {
        let text = "https://example.com/image.png?w=800";
        let urls = extract_ogp_urls(text);
        assert!(urls.is_empty());
    }

    #[test]
    fn extract_non_media_urls_only() {
        let text = "See https://example.com/page and https://example.com/photo.webp";
        let urls = extract_ogp_urls(text);
        assert_eq!(urls.len(), 1);
        assert_eq!(urls[0], "https://example.com/page");
    }

    #[test]
    fn empty_text_no_urls() {
        assert!(extract_ogp_urls("").is_empty());
        assert!(extract_ogp_urls("no urls here").is_empty());
    }

    #[test]
    fn camel_case_matches_serde() {
        assert_eq!(camel("account_id"), "accountId");
        assert_eq!(camel("timeline_type"), "timelineType");
        assert_eq!(camel("uri"), "uri");
    }

    /// 全コマンドを JSON 経路で往復させる (§4.1 の受け入れ)。
    /// 本体は一時 DB を見て AccountNotFound 等で返ってよい — ここで見るのは
    /// 「表に載っている」「params が deserialize できる」「本体まで届く」こと。
    #[tokio::test]
    async fn every_command_round_trips_through_json() {
        let (_dir, core) = temp_core();
        let ctx = CallContext::default();
        for id in COMMANDS {
            let params = fixture_params(*id);
            match dispatch(&core, &ctx, id.name(), params.clone()).await {
                Ok(v) => assert!(
                    v.is_object()
                        || v.is_array()
                        || v.is_string()
                        || v.is_null()
                        || v.is_number()
                        || v.is_boolean()
                ),
                Err(e) => {
                    let msg = e.to_string();
                    assert!(!msg.contains("unknown command"), "{}: {msg}", id.name());
                    assert!(
                        !msg.contains("invalid params"),
                        "{}: params {params} → {msg}",
                        id.name()
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn unknown_and_bad_params_are_distinct_errors() {
        let (_dir, core) = temp_core();
        let ctx = CallContext::default();
        let err = dispatch(&core, &ctx, "nope", Value::Null)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("unknown command"));
        let first = COMMANDS[0];
        let err = dispatch(
            &core,
            &ctx,
            first.name(),
            serde_json::json!({"accountId": 42}),
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("invalid params"), "{err}");
    }
}
