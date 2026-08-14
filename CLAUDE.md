# NoteDeck — Claude Code 設定

Misskey 統合デッキ環境 (IDE: Integrated Deck Environment)。対外ブランディングは「Misskey Pro」（ヘビーユーザー向け、[BRANDING.md](BRANDING.md)）。Tauri v2 + Vue 3 + TypeScript + Pinia。

## 環境セットアップ

開発環境は Nix flake で管理。`nix develop`（または direnv）で Node.js, pnpm, Rust 等が揃う。Android SDK/NDK は容量が大きいため別シェル（`nix develop .#android`）に分離している。

## 開発コマンド

```bash
pnpm dev          # Vite dev server（tauri:dev 起動中にブラウザで開くと Dev Dashboard #977 — DEVELOPMENT.md 参照）
pnpm tauri:dev    # Tauri デスクトップ開発
pnpm test         # vitest run
pnpm lint         # biome check
pnpm lint:fix     # biome check --write
pnpm lint:rust    # cargo clippy (CI と同じ -D warnings)
pnpm lint:docs    # ルート .md の腐り検査 (#895)
pnpm fmt          # cargo fmt (CI の Format check が落ちたらこれ)
pnpm typecheck    # vue-tsc -b --noEmit
pnpm doctor       # 開発環境の診断（ツールチェーン・システム依存の欠落検査）
```

## Git ワークフロー

- **main への直接 push 禁止** — 必ずブランチを切って PR 経由でマージする
- ブランチ命名: `feat/*`, `fix/*`, `refactor/*`, `chore/*`, `docs/*`
- コミット: Conventional Commits 形式
- pre-commit hook (lefthook): biome check + vue-tsc -b --noEmit（typecheck は ts/vue が staged のときのみ）

## ドキュメントの書き方

リポジトリ直下の `.md` は新規参加者と AI の判断材料になるため、古い記述はそのまま誤った実装判断につながる (#883)。

以下のうち「数値を書かない」「行番号を書かない」は `pnpm lint:docs` が機械的に検査する (pre-commit と CI で自動実行, #895)。守るかどうかを人間の注意力に委ねない。どうしても数値が必要な箇所は直前の行に `<!-- docs-lint-disable-next-line 理由 -->` を置く。

- **書いた瞬間から古くなる数値を書かない** — capability 数・カラム種別数・キャッシュの閾値・行数などは、正本のファイル (`src/permissions/schema.ts`, `BuiltinColumnType`, `perf_config.rs` 等) を指す。マーケティング文脈で数を出すときは「40 種類以上」のように下限で書く
- **未確定のものを断定形で書かない** — 検討中の案は issue に置き、ドキュメントには確定した設計判断だけを残す
- **不採用の判断は理由ごと残す** — 同じ提案の再検討を防ぐため、消さずに「採用しない」として書く
- 方針が変わったら、その方針を書いたすべてのドキュメントを直す (同じ話が SECURITY / STRATEGY / ROADMAP に分散していることがある)

## スタイリング

- `<style module lang="scss">` + `$style.xxx` で参照（CSS Modules）
- グローバル CSS 変数: `src/styles/global.css`
- モバイル/デスクトップ切り替えは `v-if`（CSS display ではない）

## Vue Vapor モード（#52）— 移行準備完了

既知のブロッカーはゼロ。Vue 3.6 リリース時に有効化可能。
新規コンポーネントも以下の制約を維持すること：

- **`<script setup>` 必須** — Options API / `export default {}` 禁止
- **`h()` / JSX 禁止** — テンプレート構文のみ使用
- **カスタムディレクティブ禁止** — composable で代替
- **mixins / extends 禁止** — composable で代替
- **`getCurrentInstance()` 禁止** — provide/inject または composable で代替
- **`app.config.globalProperties` 禁止** — provide/inject で代替
- **`<Transition>` / `<Teleport>` 禁止** — `useVaporTransition` / `usePortal` で代替

## アーキテクチャ要点

- API クライアント・DB・ストリーミングは全て **notecli** クレート側（`src-tauri/` は薄いラッパー）
- **TS service 層 (`src/services/`)**: 正規化・マイグレーション・マージ規則・ファイル codec などの純ロジックは store に書かず `src/services/` に置いて直接ユニットテストする（#782）。store は「購読 + キャッシュ + UI 状態」のみ。新規ロジックは「まず notecli → src-tauri service → `src/services/` に置けないか」の順で検討してから store に足す
- フォーク対応は adapter パターン（`src/adapters/`）
- ゲスト・ログアウト対応: 公開 API は `get_credentials_or_anon()`、認証必須 API は `get_credentials()` を使用（詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "Guest Mode & Logout Fallback"）
- **ウィンドウ / カラム**: ストリーム系はカラム（永続）、IDE ツール系もカラム（永続）、詳細・インスペクタ・ツール系はウィンドウ（一時）。カラムは `accountId: null` で cross-account 対応（詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "Window / Column Model"）
- **IDE 系カラム**: Stream Inspector（WebSocket イベントのリアルタイム監視）。設定ファイルの直接編集は「ファイル → 設定フォルダを開く」で外部エディタに委ねる
- **インスペクタウィンドウ**: ノート/通知/ユーザーの Raw JSON 表示、`settings.json5` Raw JSON エディタ。共通コンポーネント `RawJsonView` + `useSensitiveMask` で機密マスキング対応
- **開発者モード (#1034)**: 開発者向けの面 (API コンソール / API ドキュメント / ストリーム / スクラッチパッド / タスク / Raw JSON / 生ファイル編集タブ) は既定で隠し、トグルで開放する。**AI は対象外** — 接続と権限が一般側に出ている以上、AI カラムとエージェント設定を隠すと袋小路になる。配布物 (テーマ / プラグイン / ウィジェット / クエリ / スキル) は「カラムは一般 / 作成・編集は開発者」。面には帰属タグ `exposure` を持たせ、判定は `src/settings/exposure.ts` の `isExposed()` 一本。**隠すのは入口だけ**でデッキ上のカラムは動き続け、認可の境界でもない。新しい面を足すときは「既定で見せるか」を決めてタグを付ける (詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "開発者モードと露出タグ")
- **ナビバー**: VSCode Activity Bar 式。カラムのトグルボタン。ボタン構成はカスタマイズ可能（`NavItem` 型で `navbar.json5` に永続化 — プロファイルから独立）
- **設定永続化**: スカラー preferences（テーマ選択・モード・ミュート・キャッシュ設定等）は `settings.json5` に集約し `useSettingsStore` が single source of truth。構造を持つ定義は専用ファイル: `keybinds.json5` / `navbar.json5` / `performance.json5` / `postform.json5` / `tasks.json5` / `ai.json5` / `custom.css`。`permissions.json5` は principal 別の認可（#712 — capability から書換不能な場所に隔離）。アカウント情報は `notecli.db`。許可ファイル名の allowlist（= 設定バックアップの対象）は `src-tauri/src/settings_store.rs` が正本
- **シークレット**: Misskey トークンは OS キーチェーン (`notecli::keychain`) に格納。AI API キーを含む外部サービスのシークレットは Secret Vault (#564) に統合され、OS キーチェーンに接続単位で格納。フロントは本体に触れない（詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "AI Credentials" / "Secret Vault"）
- **AI チャット**: Anthropic Messages 互換 / OpenAI Chat Completions 互換の 2 プロトコルを Rust 側で SSE ストリーミング対応。AI プロバイダーは Vault 接続 (`protocol` 付き) として登録し、AI 設定でピッカー選択する。`commands.aiChatSend({ connectionId, model, ... })` invoke + `nd:ai-chat-event` listen のパターン (`commands.aiChatCancel(stream_id)` で abort)。AI セッションは `notedeck/sessions/<YYYYMMDDhhmmss>.json5` (Zettelkasten 形式 ID) にカラムから独立して永続化され、master-detail UI で一覧/切替/CRUD する。`AiSessionKind = 'chat' | 'command' | 'task' | 'heartbeat'` で kind 別のドロワー表示 (heartbeat は最上位 pin / kind icon 付き行)。タイトルは初回応答完了後に AI が要約生成 (`useAiSessionsStore` + `DeckAiColumn`)。詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "AI Chat Streaming"
- **HEARTBEAT (#411 / OpenClaw 流)**: アプリ起動中ずっと走る global daemon (`useHeartbeatDaemon` を `App.vue` で 1 mount)。Rust scheduler (`commands/heartbeat.rs`、global single `Option<ScheduledTask>`) が `nd:ai-heartbeat-tick` を emit → JS daemon が listen → `mode: 'heartbeat'` な skill body を AI に投げる → suppression (`HEARTBEAT_OK` ack) 通過分を target session に append。target は `'auto'` (kind='heartbeat' の専用 session を auto-create) / `'none'` (silent log) / `<session id>` の 3 mode。HEARTBEAT 中の権限は `permissions.json5` の `ai.heartbeat` principal で chat とは独立管理 (#712、default: readonly)。連続 3 回失敗で daemon 自動 disable + warning toast (silent fail 防止)。詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "HEARTBEAT Daemon"
- 詳細は [DEVELOPMENT.md](DEVELOPMENT.md) 参照

## リリース手順

バージョンは以下の **3ファイルを同期** して管理する。手順を飛ばさないこと。
`/release X.Y.Z` スキル（`.claude/skills/release/`）で以下の手順を対話的に実行できる。

### 1. バージョンバンプ（develop ブランチ上）

```bash
bash scripts/bump-version.sh X.Y.Z
```

`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` の同期、`Cargo.lock` の更新、`openapi.json` の再生成（バージョン番号を埋め込んでいるため。忘れると CI の `openapi_snapshot_is_current` が落ちる）をまとめて行う。

コミット例: `chore: bump version to X.Y.Z` + `chore: regenerate openapi.json for X.Y.Z`
(1 コミットにまとめても 2 コミットに分けても可。過去ログは分けるパターンが多い)

### 2. PR 作成・マージ

- develop → main の PR を作成（タイトル例: `Release vX.Y.Z`）
- `pnpm changelog` で変更一覧を PR 本文に記載
- CI（lint, typecheck, test, openapi_snapshot）が通ることを確認
- マージ

### 3. タグ作成・プッシュ（CI トリガー）

```bash
git checkout main && git pull
git tag -s vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

タグ push で `.github/workflows/release.yml` が起動：
- check → build（macOS/Linux/Windows）→ publish（GitHub Release draft）→ AUR & winget 更新

### 4. GitHub Release 確認

- GitHub Release（draft）が作成される → 内容確認後 publish
- アーティファクト: AppImage, DMG, NSIS, latest.json, SHA256SUMS.txt 等
