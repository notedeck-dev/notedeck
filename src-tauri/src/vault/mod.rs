//! 汎用 Secret Vault ([#564](https://github.com/notedeck-dev/notedeck/issues/564))。
//!
//! AiScript / AI / プラグインが任意の外部サービスへ接続するためのシークレット基盤。
//! Misskey トークン・AI API キーで確立済みの credential proxy モデル
//! (Rust 側で注入、JS / AI には raw secret を渡さない) を任意の外部 API へ拡張する。
//!
//! - メタデータ: `<configDir>/notedeck/connections.json` (Rust が source of truth)
//! - secret: OS キーチェーン (`vault/v1/<conn_id>/<slot>`)
//!
//! Phase A: データモデル + secret backend。

pub mod auth_inject;
pub mod backend;
pub mod connections_service;
pub mod connections_store;
pub mod error;
pub mod fetch;
pub mod keychain_backend;
pub mod model;
pub mod redaction;
pub mod ssrf;

pub use backend::SecretBackend;
pub use error::{VaultError, VaultResult};
pub use keychain_backend::KeychainBackend;
pub use model::{
    AuthType, Connection, ConnectionKind, ConnectionOrigin, ConnectionProtocol,
};
