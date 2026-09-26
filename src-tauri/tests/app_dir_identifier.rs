//! アプリと notecored が同じデータディレクトリを指すための不変条件 (#1106 段階 3a)。
//! Tauri の `app_data_dir()` は「OS のデータディレクトリ / bundle identifier」で、
//! notecored は notecore の `default_app_dir()` で同じ場所を出す。identifier が
//! tauri.conf.json と notecore でずれると、常駐化の切替で別のデータを見に行く。

#[test]
fn notecore_identifier_matches_tauri_conf() {
    let conf: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json is JSON");
    assert_eq!(
        conf["identifier"].as_str().unwrap(),
        notecore::app_dir::APP_IDENTIFIER
    );
}
