# notecli - Claude Code 設定

## プロジェクト概要

Misskey クライアントライブラリ + CLI ツールの単一クレート。
NoteDeck が最大の消費者で、Rust crate 依存としてコアモジュールを直接利用している。
CLI は同じクレート内に同居する独立したフロントエンド。

## ビルド & テスト

```sh
cargo build            # ビルド
cargo clippy           # lint
cargo test             # テスト（現状少ない）
```

## アーキテクチャ原則

- **コアはライブラリ**: api, models, db, streaming, event_bus がコアロジック。CLI と HTTP daemon はフロントエンド
- **ステートレス API クライアント**: `MisskeyClient` は副作用を持たない純粋な HTTP ラッパー
- **イベント駆動**: streaming → EventBus → 複数の消費者（SSE, Tauri IPC 等）
- 詳細は ARCHITECTURE.md を参照

## notedeck からの変更を受け入れる基準

| 変更対象 | 受け入れ条件 |
|---------|-------------|
| models.rs | notecli 単体でも意味がある型・フィールドの追加 |
| api.rs | Misskey API カバレッジの向上 |
| http_server.rs | 汎用的なエンドポイント。notedeck 専用なら notedeck 側で `build_core_routes()` を拡張 |
| streaming.rs | 汎用的なイベント処理の改善 |

## ブランチ運用（notedeck と同一）

- `develop`: 開発用ブランチ。feature/fix ブランチの PR は develop に向ける
- `main`: リリース用ブランチ。develop → main の Release PR 経由でのみ更新
- CI は main / develop への push・PR で実行される

## リリース手順

### 1. バージョンバンプ（develop ブランチ上）

`Cargo.toml` の `version = "X.Y.Z"` を更新：

```bash
cargo check   # Cargo.lock も同期
```

コミット例: `chore: bump version to X.Y.Z`

### 2. PR 作成・マージ

- develop → main の PR を作成（タイトル例: `Release vX.Y.Z`）
- 本文に `git log --oneline vPREV..develop` ベースの変更一覧を記載
- CI が通ることを確認してマージ

### 3. タグ作成・プッシュ（CI トリガー）

```bash
git checkout main && git pull
git tag -s vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

タグ push で `.github/workflows/release.yml` が起動し、5 ターゲット（Linux amd64/arm64, macOS amd64/arm64, Windows amd64）のバイナリ付き GitHub Release が作成される。

## コーディング規約

- エラー型は `error.rs` の `NoteDeckError` に統一（歴史的な名前。notedeck / notetui / notebot も同名で参照している）
- API トークンをログ・エラーメッセージに含めない（`safe_message()` を使用）
- 認証情報は keychain 優先、DB フォールバック
- 新しい Misskey API エンドポイントは `api.rs` の `MisskeyClient` に追加
