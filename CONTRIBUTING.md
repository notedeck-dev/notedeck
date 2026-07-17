# Contributing to NoteDeck

## 貢献の方法

### バグ報告・機能提案

[Issues](https://github.com/notedeck-dev/notedeck/issues) から報告してください。
再現手順、スクリーンショット、サーバーのソフトウェア名とバージョンがあると助かります。

### フォーク対応の追加

NoteDeck の成長は対応フォークの数に直結します。
「自分の鯖の固有機能を NoteDeck で使いたい」という PR を歓迎します。

**対応範囲:** Misskey 本家および「Misskey を名乗り続けるフォーク」が対象です。
Misskey から名前が別物になったフォーク（Sharkey, CherryPick, Firefish, Iceshrimp 等）は対応していません。
詳しくは [STRATEGY.md](STRATEGY.md#フォーク対応方針) を参照してください。

多くのフォーク固有機能（カスタム TL、モードフラグ等）はコード変更なしで動的に検出されます。
静的な capability 宣言が必要な場合の具体的な手順は [DEVELOPMENT.md — Fork support](DEVELOPMENT.md#fork-support) を参照してください。

### コードの貢献

1. リポジトリをフォーク
2. ブランチを作成（`git checkout -b feat/your-feature`）
3. `pnpm lint` と `pnpm test` を通す
4. Pull Request を作成

開発コマンド (`pnpm dev` / `pnpm tauri:dev` / `pnpm test` / `pnpm lint` / `pnpm typecheck`) とリリース手順 (バージョン同期・タグ push) は [CLAUDE.md](CLAUDE.md#開発コマンド) を参照してください。

## 開発方針

- **差分を小さく**: 1 つの PR では 1 つのことだけ変える
- **既存パターンに従う**: プロジェクトの慣例を尊重する
- **機能網羅より体験品質**: 少ない機能を心地よく使えることを優先する

## コード以外の貢献

- 使っているフォークの情報共有（API の差異、固有機能の仕様）
- スクリーンショットやデモ動画の提供
- ドキュメントの翻訳・改善

## ライセンス

貢献されたコードは [AGPL-3.0](LICENSE) の下で公開されます。
