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

#### フォーク開発者へのお願い

NoteDeck 側にコードを書かなくても、フォーク側の設定次第で自動的に対応できる範囲が広がります。

- **nodeinfo 2.1 の `software.repository` に自分のリポジトリ URL を入れてください。** NoteDeck はこれでフォークを識別します。`software.name` を `misskey` のままにしているフォークが多く、名前だけでは本家と区別できません。repository を返さないサーバーは本家扱いにフォールバックします
- **独自エンドポイントは `/api/endpoints` に載せてください。** カスタムタイムラインはこのスキャンで自動検出します
- **機能の有効/無効はロールポリシー (`/api/meta` の `policies`) に出してください。** クライアント側はこれを見て UI を出し分けられます。ポリシーに出ていない機能は「叩いてエラー」でしか判定できず、静的宣言をコードに焼き込むことになります

#### フォーク対応の 3 パターン

| パターン | 必要な作業 | 例 |
|---|---|---|
| 動的検出で動く | なし | カスタム TL、モードフラグ、タイムラインフィルター |
| 静的な capability 宣言が要る | `src/adapters/<fork>/` で宣言 | リモート絵文字リアクション (misskey-tempura) |
| 叩くエンドポイント自体が違う | notecli にメソッド追加 → Tauri コマンド → アダプターで差し替え | はなみすきーのノート検索 (`notes/hanamisearch-v1`) |

API クライアントの実体は別リポジトリ [notecli](https://github.com/notedeck-dev/notecli) にあるため、
3 番目のパターンは 2 リポジトリにまたがります。手順は [DEVELOPMENT.md — Fork support](DEVELOPMENT.md#fork-support) にあります。

**PR に書いてほしいこと:** 対象サーバーのホスト名、`/api/meta` と nodeinfo の実測値（該当部分の抜粋）、
なぜ動的検出では足りないか。実測値があると再現・検証がすぐできます。

### コードの貢献

1. リポジトリをフォーク
2. ブランチを作成（`git checkout -b feat/your-feature`）
3. `pnpm lint` と `pnpm test` を通す（`src-tauri/` を触ったら `pnpm fmt` と `pnpm lint:rust` も）
4. Pull Request を作成

環境がうまく動かないときは `pnpm doctor` を実行してください。
ツールチェーン・システム依存の欠落を検査し、対処コマンドを提示します。
エディタの補完・デバッグ構成は [DEVELOPMENT.md — エディタ / 言語サーバー](DEVELOPMENT.md#エディタ--言語サーバー) を参照してください。

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
