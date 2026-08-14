---
name: run-app
description: NoteDeck を起動して動作確認する。Tauri デスクトップ / ブラウザ (Dev Dashboard) / E2E の起動手順と起動判定
user-invocable: true
argument-hint: "[desktop|browser|e2e]"
allowed-tools: Bash(nix *), Bash(pnpm *), Bash(curl *), Read
---

# アプリ起動

正本は [DEVELOPMENT.md](../../../DEVELOPMENT.md) の "Getting Started" / "Dev Dashboard"。

## 前提

- ツールチェーンは Nix flake で管理。direnv が有効ならそのまま、無効なら各コマンドを `nix develop -c` 経由で実行する
- **flake 環境外で `pnpm tauri:dev` を実行しない** — WSL2 では WebKitGTK が EGL エラーで窓が出ない。必要な環境変数（mesa EGL 明示、`WEBKIT_DISABLE_DMABUF_RENDERER=1`、`GIO_EXTRA_MODULES` 等）は flake.nix の shellHook が設定する
- 依存未取得なら `pnpm install`

## 起動方法

### desktop（既定）

```bash
nix develop -c pnpm tauri:dev
```

- 長時間走るので run_in_background で起動する。初回は Rust ビルドで数分かかる
- デバッグビルドは frontend を vite (5173) から読むため、tauri:dev が vite も一緒に起動する

### browser / Dev Dashboard

- `pnpm tauri:dev` 起動中にブラウザで http://localhost:5173/ を開くと Dev Dashboard になる
- tauri:dev なしの `pnpm dev` は素の Vite dev server（Tauri IPC なし）

### e2e

```bash
nix develop -c pnpm test:e2e
```

- デバッグビルドが必要。port 19820 が使用中（= 実アプリ起動中）だと誤操作防止のため即失敗するので、先に実アプリを終了する

## 起動判定・動作確認

- 内蔵 HTTP API で判定: `curl -s http://127.0.0.1:19820/api/health`
- デッキ状態の確認は `GET /api/deck/columns` / `GET /api/deck/active`、直近ログは `GET /api/logs/recent`（一覧は `GET /api/docs`）
- UI 描画の異常は tauri:dev の stdout（WebKit / Gtk 警告）も見る。`Gtk-CRITICAL: gtk_widget_get_scale_factor` は wry 内部由来で無害
