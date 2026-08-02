//! IPC 境界のクロス言語ジャンプ (#897)。
//!
//! フロントの `commands.xxx()` から Rust 実装へ飛ぶ手段が無く、コマンド名を
//! 手で snake_case に直して grep する作業が常態化していた。LSP も tags 系の
//! ツールも言語境界を越えられないので、この穴は言語サーバーでは埋まらない。
//!
//! 解法は、生成物である `src/bindings.ts` の側に実装位置を埋めること。
//! 生成のたびに実測から作り直されるので腐らない。#895 で「ドキュメントに
//! 行番号を書かない」と決めたのは人間が手で書いた位置情報の話であり、
//! 生成される位置情報はその対象外。
//!
//! **行番号は入れない。** 入れると `commands/*.rs` を 1 行編集するたびに
//! bindings.ts が変わり、スナップショットの再生成が常時必要になる。
//! ファイルさえ分かれば、あとは関数名で 1 手で辿り着ける。

use std::collections::HashMap;
use std::path::Path;

/// `#[tauri::command]` が付いた関数名 → リポジトリルートからの相対パス
pub fn collect_command_locations(src_root: &Path) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut stack = vec![src_root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        // read_dir の順序は OS 依存。生成物を決定的にするため必ず並べ替える
        let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        paths.sort();
        for path in paths {
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if path.extension().is_none_or(|e| e != "rs") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            // src-tauri/src/... の形にする (エディタから開けるパス)
            let rel = path
                .strip_prefix(src_root)
                .map(|p| format!("src-tauri/src/{}", p.display()))
                .unwrap_or_else(|_| path.display().to_string());
            scan_source(&text, &rel, &mut map);
        }
    }
    map
}

fn scan_source(text: &str, rel_path: &str, map: &mut HashMap<String, String>) {
    let mut after_command_attr = false;
    for line in text.lines() {
        let t = line.trim_start();
        // テストモジュールのサンプルコードは実装ではない。慣例どおり末尾に
        // 置かれている前提で、ここから先は読まない
        if t.starts_with("#[cfg(test)]") {
            return;
        }
        if t.starts_with("#[tauri::command") {
            after_command_attr = true;
            continue;
        }
        if !after_command_attr {
            continue;
        }
        // #[specta::specta] のような属性が続くことがある
        if t.starts_with('#') || t.is_empty() {
            continue;
        }
        if let Some(name) = fn_name(t) {
            map.insert(name.to_string(), rel_path.to_string());
        }
        after_command_attr = false;
    }
}

fn fn_name(line: &str) -> Option<&str> {
    let rest = ["pub async fn ", "pub fn ", "async fn ", "fn "]
        .iter()
        .find_map(|prefix| line.strip_prefix(prefix))?;
    let end = rest.find(|c: char| !c.is_alphanumeric() && c != '_')?;
    Some(&rest[..end])
}

/// 生成済みの bindings.ts に `@see` で実装位置を書き加える。
pub fn annotate(ts: &str, locations: &HashMap<String, String>) -> String {
    let lines: Vec<&str> = ts.lines().collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len() + 32);

    for (i, line) in lines.iter().enumerate() {
        // `export const commands = {` 直下のコマンド定義だけが対象。
        // 入れ子のコールバック等はインデントされているので混ざらない
        if line.starts_with("async ") {
            if let Some(path) = invoked_command(&lines[i..]).and_then(|c| locations.get(c)) {
                // 直前が JSDoc の終端なら、既存のコメントの中に足す
                if out.last().is_some_and(|l| l.trim() == "*/") {
                    let close = out.pop().expect("checked by is_some_and");
                    out.push(" *".to_string());
                    out.push(format!(" * @see {path}"));
                    out.push(close);
                } else {
                    out.push(format!("/** @see {path} */"));
                }
            }
        }
        out.push((*line).to_string());
    }

    let mut result = out.join("\n");
    result.push('\n');
    result
}

/// 関数本体から `TAURI_INVOKE("...")` のコマンド名を取り出す。
fn invoked_command<'a>(lines: &[&'a str]) -> Option<&'a str> {
    for line in lines.iter().take(20) {
        if let Some((_, rest)) = line.split_once("TAURI_INVOKE(\"") {
            return rest.split('"').next();
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_source_picks_up_tauri_commands() {
        let src = r#"
#[tauri::command]
#[specta::specta]
pub async fn load_accounts() -> Result<Vec<AccountPublic>, Error> {
    todo!()
}

/// 属性が付いていない関数は対象外
pub fn helper() {}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_account(id: String) {}
"#;
        let mut map = HashMap::new();
        scan_source(src, "src-tauri/src/commands/auth.rs", &mut map);

        assert_eq!(
            map.get("load_accounts").map(String::as_str),
            Some("src-tauri/src/commands/auth.rs")
        );
        assert_eq!(
            map.get("delete_account").map(String::as_str),
            Some("src-tauri/src/commands/auth.rs")
        );
        assert!(!map.contains_key("helper"));
    }

    #[test]
    fn scan_source_stops_at_test_module() {
        // このファイル自身がそうであるように、テスト内のサンプルコードを
        // 実装として拾うと生成物が汚れる
        let src = r#"
#[tauri::command]
pub async fn real_command() {}

#[cfg(test)]
mod tests {
    #[tauri::command]
    pub async fn sample_in_test() {}
}
"#;
        let mut map = HashMap::new();
        scan_source(src, "src-tauri/src/x.rs", &mut map);

        assert!(map.contains_key("real_command"));
        assert!(!map.contains_key("sample_in_test"));
    }

    #[test]
    fn annotate_inserts_see_tag_for_undocumented_command() {
        let ts = r#"export const commands = {
async loadAccounts() : Promise<void> {
    await TAURI_INVOKE("load_accounts");
},
}"#;
        let locations = HashMap::from([(
            "load_accounts".to_string(),
            "src-tauri/src/commands/auth.rs".to_string(),
        )]);

        let annotated = annotate(ts, &locations);

        assert!(
            annotated.contains("/** @see src-tauri/src/commands/auth.rs */\nasync loadAccounts()")
        );
    }

    #[test]
    fn annotate_extends_existing_doc_comment() {
        let ts = r#"export const commands = {
/**
 * 既存の説明。
 */
async setStatusBarStyle(light: boolean) : Promise<void> {
    await TAURI_INVOKE("set_status_bar_style", { light });
},
}"#;
        let locations = HashMap::from([(
            "set_status_bar_style".to_string(),
            "src-tauri/src/commands/utility.rs".to_string(),
        )]);

        let annotated = annotate(ts, &locations);

        // 既存の説明を残したまま、閉じる前に @see を差し込む
        assert!(annotated
            .contains(" * 既存の説明。\n *\n * @see src-tauri/src/commands/utility.rs\n */"));
        // JSDoc を二重に作らない
        assert_eq!(annotated.matches("/**").count(), 1);
    }

    #[test]
    fn annotate_leaves_unknown_commands_untouched() {
        let ts = r#"export const commands = {
async mystery() : Promise<void> {
    await TAURI_INVOKE("mystery");
},
}"#;
        let annotated = annotate(ts, &HashMap::new());
        assert!(!annotated.contains("@see"));
    }
}
