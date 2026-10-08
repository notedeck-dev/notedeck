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

- **書いた瞬間から古くなる数値を書かない** — capability 数・カラム種別数・キャッシュの閾値・行数などは、正本のファイル (`crates/notecore/capabilities.json5`, `BuiltinColumnType`, `perf_config.rs` 等) を指す。マーケティング文脈で数を出すときは「40 種類以上」のように下限で書く
- **未確定のものを断定形で書かない** — 検討中の案は issue に置き、ドキュメントには確定した設計判断だけを残す
- **不採用の判断は理由ごと残す** — 同じ提案の再検討を防ぐため、消さずに「採用しない」として書く
- 方針が変わったら、その方針を書いたすべてのドキュメントを直す (同じ話が SECURITY / STRATEGY / ROADMAP に分散していることがある)

## スタイリング

- `<style module lang="scss">` + `$style.xxx` で参照（CSS Modules）
- グローバル CSS 変数: `src/styles/global.css`
- モバイル/デスクトップ切り替えは `v-if`（CSS display ではない）

## UI 文言（#135）

- UI に出す文言は `locales/ja-JP.yml` に足して `i18n.ts` / `i18n.tsx` で引く。日本語の直書きは `pnpm lint:i18n` (CI / pre-push) が増えたら落とす
- **「メイド」は UI 文言に出さない。** notemaid はバイナリ / クレートの名前で、利用者向けには今のフロントエンドの語彙どおり「AI」と呼ぶ (「AI チャット」「AI 設定」のように)。開発ドキュメントの説明で比喩として使うのは可
- キーを足したら `pnpm gen:i18n`。語は `locales/GLOSSARY.md` に合わせる。詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の「UI 文言と多言語化」

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

- Misskey API クライアント・DB・ストリーミングコアは **notecli** クレート側。`src-tauri/` は「薄いラッパー」ではなく、Tauri に依存しないドメイン（OGP 抽出 / Secret Vault / クエリランタイム / 画像キャッシュ / AI SSE クライアント / HTTP API サーバー）も抱える。置き場の規則は「`commands/*.rs` は IPC アダプタとして薄く保つ / トップレベルの `*_service.rs` `*_store.rs` は引数を取る単体テスト可能なサービス」（#782）。**目指す構成 (#1106、2026-09-29 に案 C へ転換)**: Tauri に依存しないドメインを **notecore** (`crates/notecore`、2026-09-23 に切り出し済み) に集め、AI が所有するもの (エージェントループ / HEARTBEAT / capability の実行 / セッション / skill / メモ / AI 設定) は **notemaid** (`crates/notemaid`、lib + bin の 1 クレート。2026-09-29 に決定・切り出し済み) に置く。クレートの依存は notecli ← notecore ← notemaid ← アプリの一方向で、notemaid が借りるのは共有基盤 (Vault / 認可 / 設定 store / アカウント情報) だけ。プロセスとしては並列。notecore は AI を知らない。**データ面は常に手元で動き、常駐の対象は notemaid だけ** (データ面の常駐 = 旧 notecored は #1106 で中止し、クレートごと notemaid の bin に統合して削除済み)。**notemaid は常に別プロセス** (案 B、2026-09-29): アプリは AI 系コマンドを常に socket (Windows は named pipe) で notemaid に送り、違うのは誰が notemaid を起動するかだけ。アプリが同梱の sidecar を子プロセスとして起動し終了時に落とす (既定 `auto`、デスクトップ、設定ゼロ。`src-tauri/src/maid_launcher.rs`、子は stdin の EOF と Linux の PDEATHSIG で親に追随) / ログイン時のユーザー権限タスクとして常駐 (AI 設定の HEARTBEAT にある「アプリを終了しても続ける」のトグル 1 つ。利用者にとっての意味は巡回の継続なので HEARTBEAT の一部として見せる。「コア」ウィンドウは廃止。systemd user unit / LaunchAgent / Run キー、`notemaid service`)。**別の端末やサーバーで動く notemaid に繋ぐ構成 (リモート) は採用しない** (2026-09-29): 得られるのは巡回の継続だけでローカルの常駐と同じ、対象者は常時稼働のサーバーを持ちトークンをそこに置ける人に限られ、認証 / ペアリング / TLS / 配送 / 版ずれの保守が見合わない。transport の抽象は残すが、外向きの認証や配送は作らない。notemaid は SQLite を開かない: 口座の所在は notecore の `AccountStore` trait (`crates/notecore/src/accounts.rs`) で、アプリは notecli.db がそのまま実装し、notemaid は接続時と口座変更時にアプリが写した一覧 (`SyncedAccounts`、メモリ + 小さなファイル) が実装する。トークンは OS キーチェーン (無い環境ではアプリの DB と同じトークン列)。**DB を持たない Core (`initialize_client`) で DB を待つコードを書かない**: 取得系の索引への書込は `Core::with_archive` (索引があるときだけ)、手元の索引を読む用途は `FrontendBridge::archive_search` で端末に聞く (notes.searchArchive)、`blocking` は DB の無いプロセスでは待たずに Err、`ready()` は廃止 (`authed*()` を使う)。経路は `notemaid::transport` (Unix socket / Windows named pipe)。in-process は iOS / Android と、sidecar が無い開発時の経路。sidecar は release だけ `tauri.sidecar.conf.json` で externalBin に足し、`scripts/build-sidecar.sh` が置く。**データ面の notecore はデバイスに 1 つ (アプリの中) だけで、notemaid は notes DB を開かない** (Misskey は notecli で直接)。同一端末では設定ディレクトリを共有し、書くのは自分の持ち物 (セッション / メモ / skill / AI 設定) だけ。WebView は常に手元の Rust と話す。リポジトリは notedeck 1 つで、notecli / notecore / notemaid / アプリの 4 クレート (notecli は取り込み済み)。命名は「1 つの名前 = ディレクトリ = パッケージ = バイナリ (ライブラリも同名)」、`note` + 役割名詞は配布単位か共有コアだけ、`-d` 接尾辞はライブラリと daemon が同名になるときだけ (固有の名前を持つ daemon には付けない)、内部の分割は `notecore-*` の接尾辞、`nd` はコード内の名前空間専用。**新しいドメインは「デバイスが 1 台も繋がっていなくても意味を持つか」で notecore 側と手元側 (OS 統合) に分け、混ぜない**。notecore 側は `crates/notecore` に置き (Tauri 非依存を lint で検査、手元側が要る処理は trait で受ける。上に載るクレートへの口は型付きの `EventSink` / `FrontendBridge` / `ServeConfig` の関数で、型消去のスロットやプロセス全体のレジストリは置かない)、全 `#[tauri::command]` は直前行に `// nd-command: data|local|authz|mixed` を付ける (lint で必須。詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の「目指す構成」)
- **TS service 層 (`src/services/`)**: 正規化・マイグレーション・マージ規則・ファイル codec などの純ロジックは store に書かず `src/services/` に置いて直接ユニットテストする（#782）。store は「購読 + キャッシュ + UI 状態」のみ。新規ロジックは「まず notecli → src-tauri service → `src/services/` に置けないか」の順で検討してから store に足す
- フォーク対応は adapter パターン（`src/adapters/`）
- ゲスト・ログアウト対応: 公開 API は `get_credentials_or_anon()`、認証必須 API は `get_credentials()` を使用（詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "Guest Mode & Logout Fallback"）
- **ウィンドウ / カラム**: ストリーム系はカラム（永続）、IDE ツール系もカラム（永続）、詳細・インスペクタ・ツール系はウィンドウ（一時）。カラムは `accountId: null` で cross-account 対応（詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "Window / Column Model"）
- **IDE 系カラム**: Stream Inspector（WebSocket イベントのリアルタイム監視）。設定ファイルの直接編集は「ファイル → 設定フォルダを開く」で外部エディタに委ねる
- **インスペクタウィンドウ**: ノート/通知/ユーザーの Raw JSON 表示、`settings.json5` Raw JSON エディタ。共通コンポーネント `RawJsonView` + `useSensitiveMask` で機密マスキング対応
- **開発者モード (#1034)**: 開発者向けの面 (API コンソール / API ドキュメント / ストリーム / スクラッチパッド / タスク / Raw JSON / 生ファイル編集タブ / About のパフォーマンス表示) は既定で隠し、トグルで開放する。**AI は対象外** — 接続と権限が一般側に出ている以上、AI カラムとエージェント設定を隠すと袋小路になる。配布物 (テーマ / プラグイン / ウィジェット / クエリ / スキル) は「カラムは一般 / 作成・編集は開発者」。面には帰属タグ `exposure` を持たせ、判定は `src/settings/exposure.ts` の `isExposed()` 一本。**隠すのは入口だけ**でデッキ上のカラムは動き続け、認可の境界でもない。新しい面を足すときは「既定で見せるか」を決めてタグを付ける (詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "開発者モードと露出タグ")
- **ナビバー**: VSCode Activity Bar 式。カラムのトグルボタン。ボタン構成はカスタマイズ可能（`NavItem` 型で `navbar.json5` に永続化 — プロファイルから独立）
- **設定永続化**: スカラー preferences（テーマ選択・モード・ミュート・キャッシュ設定等）は `settings.json5` に集約し `useSettingsStore` が single source of truth。構造を持つ定義は専用ファイル: `keybinds.json5` / `navbar.json5` / `performance.json5` / `postform.json5` / `tasks.json5` / `ai.json5` / `custom.css`。`permissions.json5` は principal 別の認可（#712 — capability から書換不能な場所に隔離）。アカウント情報は `notecli.db`。許可ファイル名の allowlist（= 設定バックアップの対象）は `crates/notecore/src/settings_store.rs` が正本
- **シークレット**: Misskey トークンは OS キーチェーン (`notecli::keychain`) に格納。AI API キーを含む外部サービスのシークレットは Secret Vault (#564) に統合され、OS キーチェーンに接続単位で格納。フロントは本体に触れない（詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "AI Credentials" / "Secret Vault"）
- **AI チャット**: Anthropic Messages 互換 / OpenAI Chat Completions 互換の 2 プロトコルを Rust 側で SSE ストリーミング対応。AI プロバイダーは Vault 接続 (`protocol` 付き) として登録し、AI 設定でピッカー選択する。チャットの 1 ターン (tool 呼び出しの反復・認可・タイトル生成) は notemaid のターン実行器 (`ai_turn/`) が回し、フロントは `commands.aiTurnRun` + `nd:ai-turn-event` の投影 (`useAiTurn`) だけ。確認の要否と確認要求も notemaid 発 (`ai_turn/confirm.rs`、turn はチェックポイントに退避して応答で再開)、表示内容は capability の実装がデバイスで組む。tool の実行は `exec: 'core'` (純データ系の読取と書込、skill / メモ / テーマ / カスタム CSS / プラグイン / ウィジェット / クエリ (AiScript の構文検証が要る作成・更新は除く) / キーバインド / ナビバー (全置換は除く) / パフォーマンス設定 / persona と自己参照 / セッション読取。確認プレビューも `exec/preview.rs`) なら notemaid の本体 (`crates/notemaid/src/exec/`) を直接、それ以外 (UI / ミュート / Vault / 下書き / 設定系) はデバイスへの実行要求 (`ai/execute-capability`) で既存の dispatcher を使う。core の本体は 1 実装で、デバイス側は `implementCore` で委譲だけ (#1133)。1 往復だけの用途は `commands.aiChatSend` + `nd:ai-chat-event`。**手元の CLI (#1104)**: 接続 id `harness:<id>` は ACP で CLI (Claude Agent (Claude Code) / Codex / OpenCode / Hermes Agent / Grok Build) を notemaid の子プロセスにする `AcpProvider` (`crates/notemaid/src/acp/`) が provider になり、capability は MCP (#555) で渡す (トークンは harness 種別で、権限は external ではなく **ai.chat principal** = 「AI チャット」の行。#1188)。HEARTBEAT はこの経路で回さない。**人格と記憶 (#1162、2026-10-01 に段階 1〜6 を develop に入れた。実機未確認)**: OpenClaw / Hermes 流に `notedeck/notemaid/` の SOUL.md / USER.md / MEMORY.md / BOOTSTRAP.md と `skills/` の予約 skill AGENTS.md / HEARTBEAT.md。組み立ては notemaid 一本 (デバイスは `device_context` だけ)、snapshot は turn 単位、tool は Hermes 同形の `memory.update` と `soul.propose` (常に確認)、tainted からの書込は確認強制で承認後はラベル無し、無人は拒否。詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の「AI の人格と記憶」。AI セッションは `notedeck/sessions/<YYYYMMDDhhmmss>.json5` (Zettelkasten 形式 ID) にカラムから独立して永続化され (書き手は notemaid の `ai_sessions.rs` のみ、フロントは構造化操作を送る写し)、master-detail UI で一覧/切替/CRUD する。他人の内容を読んだセッションは tainted になり書き込みは必ず確認、他人の本文にだけ出てきた宛先への書き込みは一文添えて記憶の対象外・無人は拒否、tainted なセッションが書いたメモ / skill はラベル付きで読んだ側も tainted (`ai_turn/taint.rs`、宣言表の `untrusted` / `destinations`)。`AiSessionKind = 'chat' | 'command' | 'task' | 'heartbeat'` で kind 別のドロワー表示 (heartbeat は最上位 pin / kind icon 付き行)。タイトルは初回応答完了後に AI が要約生成 (`useAiSessionsStore` + `DeckAiColumn`)。詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "AI Chat Streaming"
- **HEARTBEAT (#411 / OpenClaw 流)**: アプリ起動中ずっと走る global daemon。本体は notemaid (`heartbeat.rs`、#1133 縦切り 5): tick ごとに `mode: 'heartbeat'` な skill body をターン実行器に投げ (`ai.heartbeat` principal、session 無し)、応答契約は `heartbeat.report` tool (本文 + 通知の有無)、tool を呼ばない応答は legacy の `HEARTBEAT_OK` ack として抑制。cheap check は core の cheap な capability だけ。報告は target session (`'auto'` = kind='heartbeat' の専用 session を auto-create / `'none'` / `<session id>`) に notemaid が書く。手元側は timer (`commands/heartbeat.rs`) と `useHeartbeatDaemon` (設定 → timer、`nd:ai-heartbeat-event` → 写しの読み直し / OS 通知 / toast / ペット) だけ (橋 `heartbeat/context` は #1162 で廃止。system は notemaid が組み、HEARTBEAT.md と heartbeat skill の本文は user 側のメッセージに付け、ローカル時刻は notemaid が刻む)。HEARTBEAT 中の権限は `permissions.json5` の `ai.heartbeat` principal で chat とは独立管理 (#712、default: readonly)。無人実行は確認を待たず、確認が要る操作は走らせずに書込意図として target session に受信箱カード (`intent` 付きメッセージ、投稿系は下書きも) で残し、人がボタンを押して確認 (生成元と汚染の一文つき、記憶は見ない) を経てから走る。`unattended` 属性の capability (backup.create) だけ権限のみで走る。連続失敗と日次上限の自動 disable は notemaid が ai.json5 を書き、デバイスは変更通知で追従。接続ごとの日次 token 予算 (`ai_budget.rs`、ai.json5 の `budgets`、事前は文字数推定・事後は usage で精算、チャットも同じ勘定) と失敗の永続化 (signature の初回だけ通知) も notemaid。詳細は [DEVELOPMENT.md](DEVELOPMENT.md) の "HEARTBEAT Daemon"
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
