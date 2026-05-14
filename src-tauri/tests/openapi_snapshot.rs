//! Guards that the committed `openapi.json` snapshot stays in sync with the
//! route annotations. Because routes are registered via `utoipa-axum`'s
//! `routes!` macro, the spec always reflects the code — this test makes the
//! committed artifact a reviewable diff: any API surface change shows up in
//! `openapi.json` in the PR.
//!
//! If this test fails, run `cargo run --example gen_openapi` and commit the result.

#[test]
fn openapi_snapshot_is_current() {
    let spec = notedeck_lib::http_server::build_openapi();
    let generated = serde_json::to_string_pretty(&spec).expect("serialize OpenAPI spec");
    let committed = include_str!("../openapi.json");
    assert_eq!(
        generated.trim(),
        committed.trim(),
        "openapi.json is stale — run `cargo run --example gen_openapi` and commit the result",
    );
}
