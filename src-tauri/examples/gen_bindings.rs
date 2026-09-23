//! Regenerates `src/bindings.ts` from the tauri-specta command/event lists.
//!
//! Run after changing any `commands::*` / `query_runtime::*`
//! handler that is exposed to the frontend:
//!
//! ```sh
//! cargo run --example gen_bindings
//! ```
//!
//! The committed `src/bindings.ts` is the frontend-facing API artifact and is
//! verified in CI by `tests/bindings_snapshot.rs`.

use std::path::Path;

fn main() {
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/bindings.ts");
    notedeck_lib::export_typescript_bindings(&target).expect("export typescript bindings");
    println!("wrote {}", target.display());
}
