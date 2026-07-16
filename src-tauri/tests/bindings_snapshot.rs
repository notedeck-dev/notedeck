//! Guards that the committed `src/bindings.ts` snapshot stays in sync with the
//! tauri-specta command/event lists registered in `lib.rs`. The same builder
//! powers the runtime export, the `gen_bindings` example, and this test, so
//! any drift between handlers and bindings.ts surfaces here.
//!
//! If this test fails, run `cargo run --example gen_bindings` and commit the
//! result.

/// 生成された TS に raw トークンフィールドが露出しないことを保証する (#780)。
///
/// アカウントトークンはフロントに渡さない設計（`AccountPublic.hasToken` の
/// ブール化）だが、将来誰かが `Account` 等をうっかり specta export しても
/// スナップショット更新だけでは CI が通ってしまう。ここで不変条件として検証する。
#[test]
fn bindings_do_not_expose_raw_token_fields() {
    // ローカル HTTP API 用トークンの発行時 1 回だけ raw を返す設計上、意図的な露出
    const ALLOWED_TYPES: &[&str] = &["CreatedApiToken"];

    let tmp = tempfile::NamedTempFile::new().expect("create tempfile for bindings export");
    notedeck_lib::export_typescript_bindings(tmp.path()).expect("export typescript bindings");
    let generated = std::fs::read_to_string(tmp.path()).expect("read generated bindings");

    let mut offenders: Vec<&str> = Vec::new();
    for (i, chunk) in generated.split("export type ").enumerate() {
        // 先頭チャンクはコマンド定義部（引数・戻り値のインライン型を含む）
        let name = if i == 0 {
            "(commands section)"
        } else {
            chunk.split([' ', '=', '<']).next().unwrap_or("?")
        };
        if ALLOWED_TYPES.contains(&name) {
            continue;
        }
        // `token: string` / `xxxToken: string` / `xxx_token: string` を検出。
        // `hasToken: boolean` のようなブール化は許容される
        if chunk.to_lowercase().contains("token: string") {
            offenders.push(name);
        }
    }

    assert!(
        offenders.is_empty(),
        "raw token field exposed in bindings.ts: {offenders:?} — \
         トークンは hasToken のようにブール化するか、意図的な露出なら \
         ALLOWED_TYPES に理由を添えて追加すること",
    );
}

#[test]
fn bindings_snapshot_is_current() {
    let tmp = tempfile::NamedTempFile::new().expect("create tempfile for bindings export");
    notedeck_lib::export_typescript_bindings(tmp.path()).expect("export typescript bindings");

    let generated = std::fs::read_to_string(tmp.path()).expect("read generated bindings");
    let committed = include_str!("../../src/bindings.ts");

    assert_eq!(
        generated.trim(),
        committed.trim(),
        "bindings.ts is stale — run `cargo run --example gen_bindings` and commit the result",
    );
}
