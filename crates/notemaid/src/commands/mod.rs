//! notemaid のコマンド (AI 系) と、その表から生成する JSON アダプタ。
//!
//! 表は [`crate::with_maid_command_table!`] (commands/table.rs)。生成器は notecore の
//! [`notecore::define_command_table!`] を使い、`CommandId` / `COMMANDS` / `check` /
//! `dispatch` / `fixture_params` をこのモジュールに出す。属性検査の中身は
//! notecore の `check_meta` に委ねるので、データ系と同じ規則で通る。

pub mod ai_chat;
pub mod ai_sessions;
pub mod heartbeat;
pub mod table;

use notecore::define_command_table;

crate::with_maid_command_table!(define_command_table);

#[cfg(test)]
mod tests {
    use super::*;
    use notecore::commands::CallContext;
    use notecore::context::test_support::temp_core;
    use serde_json::Value;

    #[test]
    fn names_are_unique_and_parse_back() {
        let mut seen = std::collections::HashSet::new();
        for id in COMMANDS {
            assert!(
                seen.insert(id.name()),
                "duplicate command name: {}",
                id.name()
            );
            assert_eq!(CommandId::parse(id.name()), Some(*id));
        }
        assert_eq!(CommandId::parse("no_such_command"), None);
    }

    /// 全コマンドを JSON 経路で往復させる (§4.1 の受け入れ)。見るのは
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
    async fn unknown_command_is_an_error() {
        let (_dir, core) = temp_core();
        let err = dispatch(&core, &CallContext::default(), "nope", Value::Null)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("unknown command"));
    }
}
