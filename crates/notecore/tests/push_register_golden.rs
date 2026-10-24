//! push の購読登録のコード (#330 §5) の golden。AiScript 1.2.1 (本家のフロントと同じ版) で
//! 実際に動かす検査 (tests/core/pushRegisterCode.test.ts) がこのファイルを読む。
//! 純関数のモジュール (push_register) は I/O を持てないので、ファイルの読み書きはここ。
//! 辞書や組み立てを変えたら `UPDATE_GOLDEN=1 cargo test -p notecore --test push_register_golden`
//! で書き直す

use notecore::push_register::{register_code, Target};

#[test]
fn register_code_matches_golden() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/push_register_code.is");
    let targets = [
        Target {
            user_id: "u1".into(),
            name: "@alice".into(),
        },
        Target {
            user_id: "u2".into(),
            name: "@bob".into(),
        },
    ];
    let code = register_code("newnonceaaaaaaaa", &targets, "ja-JP");
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        std::fs::write(&path, &code).unwrap();
    }
    let golden = std::fs::read_to_string(&path).expect("golden がある");
    assert_eq!(code, golden, "UPDATE_GOLDEN=1 で書き直す");
}
