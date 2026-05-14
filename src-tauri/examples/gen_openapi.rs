//! Regenerates `src-tauri/openapi.json` from the live route annotations.
//!
//! Run after changing any HTTP route or response model:
//!
//! ```sh
//! cargo run --example gen_openapi
//! ```
//!
//! The committed `openapi.json` is the external-facing API artifact and is
//! verified in CI by `tests/openapi_snapshot.rs`.

use std::path::Path;

fn main() {
    let spec = notedeck_lib::http_server::build_openapi();
    let json = serde_json::to_string_pretty(&spec).expect("serialize OpenAPI spec");
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("openapi.json");
    std::fs::write(&path, format!("{json}\n")).expect("write openapi.json");
    println!("wrote {}", path.display());
}
