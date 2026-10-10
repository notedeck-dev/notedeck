/**
 * 内蔵 HTTP サーバー (#940) のポート。正本は Rust 側の
 * `crates/notecore/src/http_server.rs` の `PORT` で、ここはその写し。
 *
 * 開発版 (debug ビルド) は配布版と別のポートを使う (#1231)。同じ PC で両方を
 * 動かすと (WSL2 の開発版は localhost 転送で Windows 側のポートも取る)、
 * 後から起動した側が中継のポートを取れず画像が出なくなるため。配布版の
 * ポートは外部ツール (Stream Deck / Raycast 拡張) が前提にしているので変えない。
 *
 * フロントは `import.meta.env.DEV` で、Rust は `debug_assertions` で分ける。
 * `pnpm tauri:dev` / `pnpm dev` / E2E はどちらも開発版、配布物はどちらも
 * 配布版になる (`tauri build --debug` のような組み合わせは対象外)。
 */
export const RELEASE_HTTP_PORT = 19820
export const APP_HTTP_PORT = import.meta.env.DEV ? 19821 : RELEASE_HTTP_PORT
