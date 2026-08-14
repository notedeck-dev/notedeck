#!/usr/bin/env bash
# PostToolUse (Edit|Write): http_server.rs の変更後に openapi.json の再生成を促す。
# utoipa アノテーションは http_server.rs に集約されており、ここを触って
# openapi.json を再生成し忘れると CI の openapi_snapshot_is_current だけが後から落ちる。
set -euo pipefail

file_path=$(jq -r '.tool_input.file_path // empty' 2>/dev/null || true)

case "$file_path" in
*/src-tauri/src/http_server.rs) ;;
*) exit 0 ;;
esac

repo_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# openapi.json が既に再生成済み (working tree に変更あり) なら黙る
if ! git -C "$repo_root" diff --quiet HEAD -- src-tauri/openapi.json 2>/dev/null; then
  exit 0
fi

{
  echo "http_server.rs を変更したので openapi.json の再生成が必要です:"
  echo "  cargo run --manifest-path src-tauri/Cargo.toml --example gen_openapi --quiet"
  echo "忘れると CI の openapi_snapshot_is_current が落ちます。"
} >&2
exit 2
