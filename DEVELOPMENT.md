# NoteDeck Development Guide

Misskey IDE (Integrated Deck Environment) with fork support — branded as "Misskey Pro" for power users ([BRANDING.md](BRANDING.md))。設計思想・方針は [DESIGN.md](DESIGN.md) を参照。

NoteDeck を手元で動かし、変更し、テストするための手引きと、コードを書くときの規約。
初めて貢献する人は先に [CONTRIBUTING.md](CONTRIBUTING.md) を読むと、最短の手順が分かる。

## 文書の地図

設計の解説は分野ごとの文書にある。ここ (DEVELOPMENT.md) は日々の作業と規約だけを扱う。

| 知りたいこと | 文書 |
|---|---|
| 貢献の方法、PR の流れ、最短の準備 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 環境の準備、コマンド、テスト、ビルド、コーディング規約、フォーク対応の手順 | この文書 |
| どのファイルに何があるか (カラム種別・ウィンドウ種別・ストア・service・設定ファイル) | [CODEMAP.md](CODEMAP.md) |
| 全体のデータの流れ、クレートとプロセスの構成、起動の流れ、OS の状態への適応 (オフラインモードを含む) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| ウィンドウとカラム、ノートの一覧、カラムクエリ、配布物、テーマ、ゲストとログアウト後の表示 | [DECK.md](DECK.md) |
| AI チャット、手元の CLI、人格と記憶、capability、資格情報、HEARTBEAT | [AI.md](AI.md) |
| 認可、秘密の扱い、脅威の想定 | [SECURITY.md](SECURITY.md) |
| 最適化と、採らなかった最適化。パフォーマンス設定 | [PERFORMANCE.md](PERFORMANCE.md) |
| UI の判断基準、設定ファイルの構成 | [DESIGN.md](DESIGN.md) |
| 方向性と、これからやること | [STRATEGY.md](STRATEGY.md) / [ROADMAP.md](ROADMAP.md) |

## Tech Stack

| | |
|---|---|
| Frontend | Vue 3 + TypeScript（Vapor モード移行予定） |
| Backend | Rust (Tauri v2) + [notecli](crates/notecli/) |
| Build | Vite 8 (Rolldown) + Cargo |
| State | Pinia |
| Local DB | SQLite (rusqlite, WAL mode, FTS5) |
| HTTP | reqwest (Rust, via notecli) |
| WebSocket | tokio-tungstenite (Rust, via notecli) |
| HTTP API | Axum (localhost:19820) |
| Script | AiScript (@syuilo/aiscript) |
| Editor | CodeMirror 6 |
| Linter | Biome |
| Style | SCSS + CSS Modules (`$style`) |
| Test | Vitest + happy-dom |

## Prerequisites

### 推奨: Nix flake（ワンコマンドセットアップ）

[Nix](https://nixos.org/) がインストール済みなら、全ての開発依存が自動で揃います。

```bash
nix develop        # Node.js, pnpm, Rust 等が揃ったシェルに入る
pnpm install       # パッケージインストール
```

[direnv](https://direnv.net/) を使うと `cd` するだけで自動的に環境が有効になります（`.envrc` 同梱）。

Android SDK / NDK は nix store を数 GB 占めるため、既定のシェルには入っていません。Android をビルドするときだけ専用シェルに入ってください:

```bash
nix develop .#android    # 上記に加えて JDK + Android SDK/NDK が揃う（内訳は flake.nix）
```

### 手動セットアップ

| ツール | インストール |
|--------|-------------|
| [Node.js](https://nodejs.org/) (LTS) | 公式サイト or `nvm install --lts` |
| [pnpm](https://pnpm.io/) | `corepack enable && corepack prepare pnpm@latest --activate` |
| [Rust](https://www.rust-lang.org/) (stable) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |

**Linux のみ**: Tauri のビルドに追加パッケージが必要です。

```bash
# Ubuntu / Debian
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### 環境診断

セットアップしたのに動かないときは、原因を自力特定せず診断コマンドを実行してください:

```bash
pnpm doctor
```

必要なツールチェーン・システム依存・モバイル SDK の有無を検査し、欠落ごとに具体的な対処コマンドを提示します（[#896](https://github.com/notedeck-dev/notedeck/issues/896)）。

### エディタ / 言語サーバー

言語サーバーは開発環境に同梱されており、`nix develop` に入った時点でエディタを問わず補完・定義ジャンプが動きます:

| 対象 | 言語サーバー | 導入経路 |
|------|-------------|---------|
| Rust | rust-analyzer + rust-src | `rust-toolchain.toml` の components |
| TOML | taplo | `flake.nix` |
| Nix | nil | `flake.nix` |
| Vue SFC | vue-language-server | `flake.nix` |
| TypeScript | tsserver | `node_modules` の typescript（ワークスペース版） |

VS Code 向けの表示層は `.vscode/` に同梱（推奨拡張・ワークスペース設定・デバッグ構成）:

- `rust-analyzer.linkedProjects` で `src-tauri/Cargo.toml` を明示している（リポジトリ直下の
  `Cargo.toml` は workspace なので、他エディタは設定なしでも全クレートを読める）
- デバッグ構成「Tauri desktop (debug)」で Rust 側にブレークポイントを張れる
  （CodeLLDB 使用。vite dev server は preLaunchTask で自動起動）
- WSL2 では `nix develop` したシェルから VS Code を起動すること（EGL 対策の環境変数を継承するため）

#### IPC 境界を跨ぐジャンプ

[#897](https://github.com/notedeck-dev/notedeck/issues/897) —
言語サーバーはフロントと Rust の境界を越えられないため、`commands.xxx()` から実装へは飛べません。
生成物である `src/bindings.ts` の各コマンドに、実装ファイルへの `@see` が埋め込んであります（生成のたびに実測から作り直されるので腐りません）。

| 知りたいこと | 手順 |
|---|---|
| このコマンドの実装はどこか | `commands.xxx()` の定義へ飛び、JSDoc の `@see` のパスを開く |
| この Rust 実装を誰が呼んでいるか | `bindings.ts` を関数名（snake_case のまま）で検索して TS 側の名前を得る → その名前で `src/` を検索 |

逆方向が 2 手になるのは、呼び出し元の情報を手書きの Rust ソースへ書き戻すことになり、生成物ではなくなるためです。
どちらの手順も snake_case と camelCase の変換を人間がやる必要はありません。

## Getting Started

```bash
# Install dependencies
pnpm install

# Start dev server (Tauri desktop)
pnpm tauri:dev

# Start dev server (browser) — tauri:dev 起動中に開くと Dev Dashboard になる（下記参照）
pnpm dev
```

## Available Scripts

```bash
pnpm dev          # Vite dev server
pnpm tauri:dev    # Tauri dev
pnpm build        # Production build
pnpm tauri:build  # Tauri native build
pnpm test         # Run unit tests
pnpm test:watch   # Run tests in watch mode
pnpm test:e2e     # Run E2E tests (要デバッグビルド、下記参照)
pnpm lint         # Lint & format check
pnpm lint:fix     # Lint & format fix
pnpm typecheck    # TypeScript type check
pnpm clean        # Remove build artifacts
```

### テスト構成

テストは 2 プロジェクトに分離（`vitest.config.ts`）:

| プロジェクト | 環境 | ファイルパターン | 用途 |
|------------|------|----------------|------|
| `unit` | Node.js | `*.test.ts` | ロジック・ユーティリティ |
| `dom` | happy-dom | `*.dom.test.ts` | Vue コンポーネント・DOM 操作 |

### E2E テスト（[#702](https://github.com/notedeck-dev/notedeck/issues/702)）

実アプリ（デバッグビルド）を隔離プロファイルで起動し、外部アプリと同じ
HTTP API 面（[#709](https://github.com/notedeck-dev/notedeck/issues/709)、開発版のポート）で駆動する。設定は `vitest.e2e.config.ts`
（`pnpm test` とは独立、`tests/e2e/` 配下）。

```bash
cd src-tauri && cargo build && cd ..   # デバッグバイナリを用意 (初回のみ)
nix develop -c pnpm test:e2e           # WSL2 では nix develop 必須 (EGL 対策)
```

- ハーネス（`tests/e2e/harness.ts`）は一時ディレクトリを `NOTEDECK_APP_DIR`
  に指定してバイナリを spawn し、実データに触れない。バイナリの場所は
  `NOTEDECK_E2E_BINARY` で上書き可能
- 開発版のポートが使用中（= `pnpm tauri:dev` の起動中）の場合は誤操作防止のため即失敗する。配布版は別のポートなので起動したままでよい
- デバッグビルドは devUrl（vite 5173）から frontend を読むため、vite が
  いなければハーネスが自前で起動・終了する
- アサーションは HTTP の state 読み取り（`/api/health` / `/api/deck/columns`
  等）ベース。DOM/ピクセルには依存しない
- モック Misskey サーバー（`tests/e2e/mockMisskey.ts`）でストリーミングの
  切断/再接続/購読 replay を決定論的にテストする。接続には
  `NOTECLI_INSECURE_HOSTS` / `NOTEDECK_E2E_ALLOW_HOSTS`（デバッグビルド限定の
  http/ws 許可）を使う
- CI では `xvfb-run` で実行する。視覚スモーク（`NOTEDECK_E2E_SCREENSHOT=1`
  でスクリーンショットをアーティファクト保存）は develop / main への push の
  ときだけ有効にしている。GPU なしランナーではソフトウェアレンダリングを
  強制するため実機の描画崩れは再現できず、検証も「単色ではない」ことに
  留まる（崩れの判断はアーティファクトを見る人間に委ねている）。実接続を
  伴い所要時間も大きいので、PR では回さない

#### Android 実機 / エミュレータで同一スイートを実行

アプリをデバイス上で起動した状態で、HTTP API を adb 経由でホストに引き込み、
attach モードで同じテストを流す（モック接続系テストは自動スキップ）:

```bash
adb forward tcp:19821 tcp:19821   # 開発版のポート
# デバイスの api-token を取得 (デバッグビルドは run-as が使える。
# app_data_dir 配下の api-token — パスは要確認)
TOKEN=$(adb shell run-as com.notedeck.desktop cat files/api-token)
NOTEDECK_E2E_ATTACH=1 NOTEDECK_E2E_TOKEN=$TOKEN pnpm test:e2e
```

※ この手順は未実機検証。

attach モードはデバイス側アプリを終了させず、デッキ操作系テストは実際に
カラムを追加/削除する（テスト用プロファイルのデバイスで実行すること）。

## Dev Dashboard（[#977](https://github.com/notedeck-dev/notedeck/issues/977)）

`pnpm tauri:dev` 中にブラウザで http://localhost:5173/ を開くと、実行中の
アプリを外から覗く **開発者ダッシュボード** になる（アプリ未起動時は起動案内が
出て、起動を検知すると自動で切り替わる）。デッキとは独立した画面なので、
アプリの UI 状態を汚さずに観測できる。

左のナビでビューを切り替える (観測 / 実行 / 診断 / リソース の 4 グループ)。

観測:

- **概要** — カラム一覧、アカウントごとのストリーム接続 (状態と遷移時刻)、
  `/api/health` と `/api/openapi.json` の raw。`/api/health` は notecli doctor
  (アカウントごとに Misskey へ疎通と token の確認を投げる) を含むので周期では取らず、
  概要を開いたときと「更新」でだけ取る
- **SSE イベント** — `/api/events` を購読して Rust 側イベントバスの流れを
  リアルタイム表示。type prefix フィルタ・種別チップ (クリックで絞り込み)・
  流量・JSON Lines エクスポート・切断時の自動再接続
- **統合タイムライン** — Rust の tracing ログ (Vite dev server の `/dev/logs` が
  SSE 配信、所在は `/api` インデックスの `logDir` から解決) + SSE イベント +
  フロント in-app ログを単一時系列にマージ。「どの層でイベントが消えたか」を
  ソース切替しながら 1 画面で追える。notemaid が別プロセス (sidecar / 常駐) の
  ときはそのログは含まれない (置き場は notemaid ビューの `logDir`)
- **Inspector 照合** — アダプタ層 (Misskey WS raw) と SSE の種別別カウントの突き合わせ

実行:

- **Capabilities** — 登録済み capability の一覧からパラメータを JSON で組んで実行。
  external principal として dispatcher を通るので、権限ゲート
  ([#712](https://github.com/notedeck-dev/notedeck/issues/712)) の deny・確認ダイアログ・
  DispatchResult → HTTP status の写像をそのまま目視テストできる。実行履歴つき
- **MCP** — `POST /mcp` の `tools/list` (下の「MCP サーバー」節)。外部の AI
  エージェントや手元の CLI に見えている tool 名と input schema を確かめる。
  一覧だけで、実行は Capabilities から (同じ dispatcher に届く)
- **実効権限** — principal 別 (ai.chat / ai.heartbeat / plugin / external /
  scratchpad) の granted マトリクス。Capabilities で選んだ capability の要求キー行を
  ハイライトし、403 の理由をその場で照合する
- **MFM** — デッキと同じ `MkMfm` (同じ CSS Modules) で描く MFM プレビュー
  ([#1083](https://github.com/notedeck-dev/notedeck/issues/1083))。ここで動かなければ本体でも動かない。
  サンプル (基本 / 全構文 / 全関数 / アニメーション / MFM アート / 境界条件) と
  自由入力、ノートの枠 (`contain` / `overflow: clip`) での切り取り、画面外と同じ
  停止状態 (`--nd-mfm-play-state`)、高度な MFM / 動きのある MFM の設定、plain /
  nowrap / にゃ化、サーバーの `/api/emojis` からの絵文字、AST (mfm-js のノード)、
  関数一覧の対照表、実行中アプリの `/api/{host}/notes/{id}` からの実ノートの
  読み込み、メンション / `$[clickable]` のイベントログ。mfm-vue のプレイグラウンドに
  ある要素はすべて含む

診断:

- **起動計測** — 起動マークのウォーターフォールと WebView 固定費
  ([#985](https://github.com/notedeck-dev/notedeck/issues/985))
- **HEARTBEAT** — 最終 tick / 直近の結末 / 連続失敗 / 本日の AI 起動 / 設定の断面 /
  失敗の記録 ([#411](https://github.com/notedeck-dev/notedeck/issues/411))。値は HEARTBEAT を回している
  プロセスのもの (notemaid が別プロセスならその申告を中継越しに読む)
- **notemaid** — AI の別プロセスの所在 (in-process / 子プロセス / 常駐)、中継の
  接続と版の指紋、子プロセスの生死、常駐の登録、notemaid 自身の申告
  ([#1106](https://github.com/notedeck-dev/notedeck/issues/1106))。About の自己診断の notemaid 部分と同じ値
- **キャッシュ** — 上限つきキャッシュの size / limit 実測
  ([#987](https://github.com/notedeck-dev/notedeck/issues/987))
- **画像プロキシ** — `/proxy/image` のメモリ / ディスクキャッシュ、失敗を覚えている
  URL、取得中と取得枠、host ごとの連続失敗・breaker・429 の待ち。画像が出ないときに
  どこで止まっているかを切り分ける (動画・音声の中継 `/proxy/media` は
  キャッシュを持たないので対象外)
- **Query Bridge** — HTTP → WebView の query 往復の種別と所要時間

リソース: Scalar の API ドキュメント (`/api/docs`) へのリンク。

読み取り用の面 (`/api/startup/trace` `/api/heartbeat/status` `/api/notemaid/status`
`/api/perf/caches` `/api/perf/media` `/api/logs/recent` `/api/querybridge/trace`
`/api/inspector/recent` `/api/permissions/resolved`) は OpenAPI の `dev` タグで、
永続トークン (外部アプリ / 手元の CLI) には permissions gate が Deny を返す。
起動ごとの ephemeral トークン (= このダッシュボード) だけが読める。ダッシュボード
から書き込み系の操作を増やすときは Capabilities (dispatcher) を通す。

仕組み: Vite の dev proxy (`vite.config.ts`) が `/api` `/mcp` `/proxy` を
内蔵 HTTP サーバー (開発版のポート、[#940](https://github.com/notedeck-dev/notedeck/issues/940)) へ転送し、`/api` と `/mcp` には
無認証の `/api` インデックスが開示する tokenPath から Bearer トークンを読んで注入する。
ブラウザ側は相対パスの fetch だけで認証込みの external API を叩ける。
dev マシン上でしか成立しない橋渡しなので、本番の攻撃面は増えない。

Stream Inspector カラムとの違い: Stream Inspector は**フロントのアダプタ層**
（Misskey WebSocket の raw イベント。カラムが開いている間だけ Rust が生封筒を
流す）を見るのに対し、ダッシュボードの SSE
ビューアは **Rust 側イベントバス → `/api/events`** を見る。別系統なので、
両方を並べると「どの層までイベントが届いているか」の切り分けに使える。

内蔵 HTTP サーバーのポートは配布版と開発版 (debug ビルド) で分けている
([#1231](https://github.com/notedeck-dev/notedeck/issues/1231))。同じ PC で両方を動かすと (WSL2 の開発版は
localhost 転送で Windows 側の同じポートも取る) 後から起動した側が中継を持てず、画像が出なくなるため。
外部ツール (Stream Deck / Raycast 拡張など) は配布版のポートを前提にしているので、配布版の値は変えない。
値の正本は `crates/notecore/src/http_server.rs` の `PORT` / `RELEASE_PORT` で、フロントの写しは
`src/utils/appHttpPort.ts`、CSP (`tauri.conf.json`) は両方を許可している。
ポートを取れなかったときは「アプリの通知」で知らせ、画像は中継を通さず元の URL で読む。

位置づけ（#940 との関係）: このダッシュボードは external API の最初の
本格クライアント（dogfooding）を兼ねる。内蔵 HTTP サーバーに新しい面を足すときの
テストベンチとして育てる。

## Build

Vite 8 (Rolldown + OXC ベース) を使用。`vite.config.ts` で以下のカスタムプラグインを定義：

- **stripUnusedFonts** — 未使用フォント形式（woff, ttf）をビルドから除外
- **subsetTablerIcons** — ソースコードから使用中のアイコンを検出し、CSS ルールとフォントをサブセット化

### Rust ビルド成果物の肥大

`target` (workspace root。以前は `src-tauri/target`) は放置すると際限なく膨らむ。cargo は古い成果物を自動 GC しないため、開発期間に比例して単調増加する。要因は 3 つ:

- `[lib] crate-type` — モバイル対応のため同じコードを複数形態で出力する（`staticlib`/`cdylib` は依存ツリー全体を抱え込む）
- 重量級の依存ツリー（tauri, axum, reqwest, image, specta, utoipa 等）にデバッグ情報が付き、上記の形態数と掛け算になる
- `debug/incremental` はビルドのたびにセッションが積まれ、cargo が消さない

2 つ目が支配的で、workspace root の `Cargo.toml` の `[profile.dev]` でデバッグ情報を削っている（自分のコードは `line-tables-only`、依存クレートと build script / proc-macro は `false`）。デバッグ情報を full にしたフルビルドと比べると 5 倍以上の差が出る。依存クレート内部をデバッガでステップ実行したいときだけ一時的に外すこと。自分のコードのブレークポイントとバックトレースはこの設定のままで効く。

1 つ目は `staticlib`（iOS 専用）を外して 2 形態に減らしてある。iOS プロジェクト（`src-tauri/gen/apple`）を生成するときに戻す。

3 つ目は定期的な手動削除で対処する:

```bash
pnpm clean:incremental   # incremental のみ削除（再ビルドは差分から）
pnpm clean               # dist と target を全消し（フルビルドになる）
```

### 開発環境全体のディスク使用量

`target` 以外にも、開発を続けると単調増加する置き場がある。容量が逼迫したらこの順で確認する:

```bash
du -sh /nix/store ~/.rustup ~/.cargo target node_modules
```

- **`/nix/store`** — flake の入力が更新されるたび旧世代が残る。`nix-collect-garbage -d` で、どの GC root からも参照されていない分が消える。**direnv 利用時は `.direnv/flake-profile-*` が旧 devShell を GC root として掴んだままなので、flake.nix を変えたら先に `direnv reload` すること**（これを忘れると GC しても何も減らない）。Android SDK/NDK は既定シェルから外してあるので、`nix develop .#android` に入らない限り GC 後に戻ってこない
- **`~/.rustup`** — ツールチェーンは 1 つで数百 MB〜GB 規模。`rustup toolchain list` に `rust-toolchain.toml` が指す版以外が並んでいたら `rustup toolchain uninstall <name>`。`rust-docs` は単体で大きく、かつ `rust-toolchain.toml` の components に無いので、オフラインで `rustup doc` を引かないなら `rustup component remove rust-docs`。`rustup set profile minimal` にしておくと以後のインストールに docs が付いてこない
- **`~/.cargo/registry`** — 依存のソースと `.crate` アーカイブ。消しても次のビルドで再取得されるだけなので、オフラインでないなら消してよい

WSL2 では、以上を削除しても Windows 側の `.vhdx` は自動では縮まない（一度膨らんだサイズを保持する）。Windows のディスクを空けたい場合は PowerShell で `wsl --manage <distro> --set-sparse true` を実行する。

## コーディング規約

コードを書くときに守ること。破ると lint か CI で落ちるものが多い。

### Vue Vapor モード（[#52](https://github.com/notedeck-dev/notedeck/issues/52)）— 移行準備完了

Vue 3.6 の Vapor モード（仮想DOMレス・コンパイル時DOM操作）への移行準備が**完了**。
既知のブロッカーはゼロ。Vue 3.6 リリース時にそのまま有効化可能。

**コーディング制約（新規コンポーネントでも維持すること）:**

- `<script setup>` 必須 — Options API / `export default {}` 禁止
- `h()` / JSX 禁止 — テンプレート構文のみ使用
- カスタムディレクティブ禁止 — composable で代替
- mixins / extends 禁止 — composable で代替
- `getCurrentInstance()` 禁止 — provide/inject または composable で代替
- `app.config.globalProperties` 禁止 — provide/inject で代替
- `<Transition>` / `<Teleport>` 禁止 — `useVaporTransition` / `usePortal` で代替

**対応済み:**

- `<Transition>` / `<TransitionGroup>`: 全22箇所を composable + CSS `@keyframes` に移行
- `<Teleport>`: 全箇所を `usePortal()` composable に移行済み
- `app.config.errorHandler`: `onErrorCaptured` composable に移行
- `<Suspense>` / `<KeepAlive>`: 使用なし
- `__VUE_OPTIONS_API__: false` 設定済み（vite.config.ts）

### UI 文言と多言語化（[#135](https://github.com/notedeck-dev/notedeck/issues/135)）

UI に出す文言は辞書に置き、コードに日本語を直書きしない。設計の正本は #135 の設計コメント。

```vue
<script setup lang="ts">
import { i18n } from '@/i18n'
</script>

<template>
  <span>{{ i18n.ts._settings.language }}</span>
  <span>{{ i18n.tsx._settings.languageUnpublished({ name }) }}</span>
</template>
```

- **正本は `locales/ja-JP.yml`**。キーを足したら `pnpm gen:i18n` で型 (`src/i18n/locale.generated.ts`) を再生成してコミットする。存在しないキーは型検査で落ちる
- 補間は `{name}` で `i18n.tsx` から埋める。複数形はキー名を `_plural` で終え、値を CLDR カテゴリ (`other` 必須) で書く。数は `{count}`
- 節 (名前空間) はコンポーネントごとに、ファイル名を lowerCamel にして `_` を付けたもの (`DeckAiColumn.vue` → `_deckAiColumn`)。複数の画面で同じ意味の語は `_common`、カラム名 / ウィンドウ名 / コマンド名と同じ文言は `_columns` / `_windows` / `_commands` を参照する
- 数値の param はそのまま数で渡す。表示言語の書式で桁区切りされる (`toLocaleString()` を渡すと複数形の判定が効かない)
- 文の途中にリンクやタグが入る文言は `<I18n :src="...">` に param 名の slot を渡す。辞書の文言を `v-html` / `MkMfm` に渡さない (param に他人の文字列が入ると表示を偽装できる)
- **モジュールのトップレベルで辞書を読まない**。辞書は起動待ちの中で読むので、import 時に評価される定数からは読めない。定数は getter か辞書のキーで持つ
- **文言は描画のたびに引く**。表示言語の切り替えはリロードせずに辞書を差し替え、辞書を読んだ描画や computed が描き直される。辞書の文言を一度だけ取り出して変数やオブジェクトに保存すると追従しないので、登録物の表示名などは getter で持つ
- 語と表記 (英数字と和文の間の空白、半角括弧、長音、「〜に失敗しました」など) は `locales/GLOSSARY.md` に合わせる。表記は `tests/lint/i18nStyle.test.ts` が検査する。本家と揃えない語は理由をそこに書く
- 訳は `locales/<lang>.yml` に書き、訳し終えたら `pnpm gen:i18n --stamp <lang>` で「どの原文から訳したか」を記録する。原文が後から変わると lint が訳の置き去りとして落とす。未訳のキーは実行時に en-US → ja-JP の順で埋まり、lint では落とさない
- 表示言語は `locale.json5` (端末ごとの値なので `settings.json5` とは別) に `'auto'` か言語コードで持つ。`locales/languages.json5` で `published: false` の言語は開発者モードでだけ選べ、`'auto'` の解決対象にもならない。i18n 導入前からのインストールは日本語に固定される
- **Rust (notecore / src-tauri) が画面向けに出す文言**は辞書の `_native` 節に置き、Rust のソースには書かない。`pnpm gen:i18n` が言語ごとの JSON (`crates/notecore/locales/`) と Android の文字列リソース (`src-tauri/android/res/`) に書き出し、Rust は埋め込んで使う。キーは必ず完全な文字列 (`"_native.xxx"`) で書く (lint がソースから拾って実在を検査する)
  - notecore が返す値は「英語の正本文 + 表示言語で描き直す手がかり `{ key, params }`」(`i18n::text` / `localize_fields`、エラーは `i18n::error` = `NoteDeckError::Localized`)。英語の正本文は AI・HTTP・CLI、版ずれのときの fallback に使う。デバイスは `localizeNative` / `nativeField` / `AppError` で表示言語に描き直す。保存される定型の文言 (セッションタイトル、HEARTBEAT の受信箱カードなど) も同じ形で保存し、表示するときに描き直す
  - 端末側 (OS 通知・トレイ・Android の通知チャネル) は `ui_lang` の表示言語で直接組む。表示言語は起動時に `locale.json5` と OS の言語から決め、切り替えたときはデバイスが `setUiLanguage` で知らせる
  - AI にだけ渡る文字列 (プロンプト、tool の結果やエラー) は辞書に入れず英語で書く。利用者の表示言語はシステムプロンプトの `<user-language>` で渡す
- 日付・数値の書式は `i18n.lang` を渡す。`'ja-JP'` の直書きと引数なしの `toLocale*()` は増やさない。経過時刻は `formatTime` (`src/utils/formatTime.ts`)、件数の短縮表記 (「1.2万」/「1.2K」) は `formatCount`、バイト数は `formatBytes` (本家に揃えて 1024 区切り。どちらも `src/utils/format.ts`) を使い、画面ごとに手組みしない
- 保存する定型の名前 (ゲストの連番名、principal が書いたメモの作者名) は英語の正本で保存し、表示するときに組み直す (`guestDisplayName` / `memoAuthorDisplayName`)。利用者が付けた名前はそのまま出す
- 英語化での崩れは疑似ロケール `en-XA` (開発者モードの言語選択に出る) で見る。英語の文をアクセント付きにして 1.4 倍程度に伸ばし、`[ ]` で囲む。括弧が欠けていれば切り詰め、アクセントの無い文字列は直書き。辞書ファイルは持たず `languages.json5` の `pseudo` から作り、Rust / Android には渡さない (端末側は英語になる)
- 日本語の直書きは `pnpm lint:i18n` が検査する (CI と pre-push)。直書きは 1 行も許さない。AI・プラグイン・ログにだけ出る文字列は英語で書く。辞書に置けない文字列 (固有名詞、区切り文字などのデータ、MFM 仕様の変換表など) は行末に `i18n-ignore: <理由>` を書くか、`scripts/i18n-lint.ts` のファイル単位の免除に理由つきで足す

### Styling

コンポーネントのスタイリングには **CSS Modules + SCSS** を使用しています。

```vue
<template>
  <div :class="$style.container">...</div>
</template>

<style module lang="scss">
.container {
  display: flex;
}
</style>
```

- `<style module lang="scss">` で CSS Modules として定義し、テンプレートから `$style.xxx` で参照
- `vite.config.ts` で `localsConvention: 'camelCaseOnly'` を設定済み（`kebab-case` → `camelCase` 自動変換）
- **`@keyframes` の名前はクラス名と camelCase で衝突させない** (この repo では `kf-` 接頭辞)。CSS Modules は keyframes も export に載せるので、`@keyframes mfm-spin` と `.mfmSpin` は同じキー `mfmSpin` になり、keyframes の方がクラスを上書きして `$style.mfmSpin` が hash 化された keyframes 名を返す (= クラスが一度も当たらない)。MFM のアニメーションが丸ごと死んでいた真因 ([#1083](https://github.com/notedeck-dev/notedeck/issues/1083))。`tests/lint/cssModuleKeyframes.test.ts` が検査する
- グローバルな CSS 変数は `src/styles/global.css` で定義
- モバイル/デスクトップの切り替えは CSS の `display` ではなく `v-if` で制御
- 入力欄・スイッチ・セレクト・スライダー・数値 + 単位は `src/components/common/form/` の部品 (`FormInput` / `FormSwitch` / `FormSwitchRow` / `FormSelect` / `FormRange` / `FormNumber`) を使う。部品にしない欄も枠・フォーカス・placeholder・disabled は `src/styles/_inputs.scss` の `input-base` に寄せ、画面ごとに書き直さない ([#704](https://github.com/notedeck-dev/notedeck/issues/704))
- 入力の誤りは欄の直下にエラー文で出し、`aria-invalid` と `aria-describedby` で欄と結ぶ (`FormInput` / `FormNumber` の `error`)。送信ボタンは誤りがあっても disabled にせず、押されたら誤りの欄を出して最初の欄にフォーカスする。disabled にするのは送信中と「まだ何も入力していない」ときだけで、後者は `title` で理由を見せる

### キーボード操作（アクセシビリティ）

すべての UI 操作がキーボードだけで完結できることを目標とする。以下の composable を利用する。

#### `useFocusTrap(containerRef, options?)`

ダイアログ・モーダル・ポップアップで **Tab をコンテナ内にトラップ** + **Esc で閉じる** + **初期フォーカス設定**。

```ts
const dialogRef = ref<HTMLElement | null>(null)
const { activate, deactivate } = useFocusTrap(dialogRef, {
  initialFocus: 'button.primary', // CSSセレクタ（省略時は最初のfocusable要素）
  onEscape: () => close(),
})

// ダイアログ表示時: nextTick(activate)
// ダイアログ非表示時: deactivate()
```

**適用済み**: `AppConfirm`, `AddColumnDialog`, `NoteReactionPickerPopup`

#### `useMenuKeyboard(options)`

メニュー・ポップアップで **Arrow Up/Down ナビ** + **Home/End** + **Enter 選択** + **Esc 閉じ**。

```ts
const menuRef = ref<HTMLElement | null>(null)
const { activate, deactivate } = useMenuKeyboard({
  containerRef: menuRef,
  itemSelector: 'button',  // ナビ対象のCSSセレクタ
  onClose: () => close(),
})
```

**適用済み**: `PopupMenu`（NoteMoreMenu 等の全派生に波及）, `DeckSettingsMenu`, `DeckProfileMenu`, `NavAccountMenu`

#### 新規コンポーネント作成時のルール

- **ダイアログ/モーダル** → `useFocusTrap` を適用（Esc 閉じ + Tab トラップ必須）
- **ポップアップメニュー** → `PopupMenu` を使えば自動対応。手動メニューは `useMenuKeyboard` を適用
- **クリック専用の `<div>`** → `tabindex="0"` + `@keydown.enter` を追加してキーボードから操作可能にする
- **新機能** → コマンドパレット（`src/commands/definitions.ts`）へのコマンド登録を検討

### アイコン語彙

同じ意味には同じ Tabler アイコンを使い、1 つのアイコンに 2 つの意味を持たせない ([#704](https://github.com/notedeck-dev/notedeck/issues/704) H)。下の表にある意味の操作を足すときは表のアイコンを使い、新しい意味を足すときは表に行を足す。カラム種別のアイコンは `src/columns/registry.ts` の `COLUMN_ICONS`、capability のアイコンは `crates/notecore/capabilities.json5` が正本で、この表の対象外。

| 意味 | アイコン | 備考 |
|------|----------|------|
| 投稿する / ノート | `ti-pencil` | 本家と同じ。投稿ボタン・投稿フォームを開く操作・ノート数 |
| 編集する / 名前を変更 | `ti-edit` | エディタを開く・設定の編集・リネーム。`ti-pencil` は投稿専用 |
| 返信 | `ti-arrow-back-up` | 本家と同じ。「戻す」系に流用しない |
| 戻る (画面・階層を 1 つ戻る) | `ti-arrow-left` | ダイアログ内の階層も含む。進むは `ti-arrow-right` |
| 前の項目 / 次の項目 (画像送り等) | `ti-chevron-left` / `ti-chevron-right` | 「戻る」ではなく同じ階層の送り |
| デッキに戻す (ポップアウト・PiP から) | `ti-arrow-back` | 返信と見分けるため `ti-arrow-back-up` を使わない |
| 再読み込み / 再試行 / 更新 | `ti-refresh` | `ti-reload` は使わない |
| 既定に戻す / 以前の版を復元 | `ti-restore` | 設定のリセット。削除ではないので `ti-trash` にしない |
| PiP (小窓) で開く | `ti-picture-in-picture` | PiP 専用。ウィンドウの「元のサイズに戻す」には使わない |
| 最大化 / 元のサイズに戻す | `ti-square` / `ti-squares` | OS のウィンドウ操作と同じ形 |

### Icon Overlay System

アイコンに重ねるバッジ・インディケーターは **4象限ルール** に従います。

```
┌──────────────────┬──────────────────┐
│ 左上 (TL)         │ 右上 (TR)         │
│ 数量（静的）       │ コンテキスト       │
│ - スタック数       │ - サーバーアイコン  │
│                   │ - 更新ドット       │
├──────────────────┼──────────────────┤
│ 左下 (BL)         │ 右下 (BR)         │
│ アイデンティティ    │ 注意・補足情報      │
│ - アカウントアバター│ - 注意カウント(数字)│
│ - オンライン状態   │ - リアクション種別  │
│                   │ - 通知種別アイコン  │
└──────────────────┴──────────────────┘
```

| 象限 | 意味 | 問い | 例 |
|------|------|------|-----|
| TL (左上) | 数量（静的） | 「いくつ？」 | スタック数バッジ |
| TR (右上) | コンテキスト | 「どこの？」 | サーバー favicon、更新ドット |
| BL (左下) | アイデンティティ | 「誰の？」 | アカウントアバター、オンライン状態 |
| BR (右下) | 注意・補足情報 | 「何が起きた？」 | 注意カウント（通知数、要対応件数）、リアクション絵文字、通知種別 |

**統一デザイントークン:**

- box-shadow（浮き出し枠）: 一律 `3px`
- サーバーバッジ offset: `top: -4px; right: -4px`
- タブ内 stackBadge: `top: 4px; left: calc(50% - 16px); height: 14px`

**主要コンポーネント:**

- `ColumnBadges.vue` — カラムボタン用のサーバー/アカウントバッジ（CSS変数でオーバーライド可）
- `MkAvatar.vue` — オンラインインディケーター（BL）
- `AccountAvatar.vue` — アカウントのアバター + サーバーバッジ（TR）

### 開発者モードと露出タグ（[#1034](https://github.com/notedeck-dev/notedeck/issues/1034)）

開発者向けの面を既定で隠し、開発者モードで開放する。**隠すのは入口だけ**で、デッキに置かれたカラムや開いたウィンドウの描画は止めない。認可の境界でもない（認可は `permissions.json5` の principal — 開発者モードを off にしてもプラグインや AI の権限は変わらない）。

**AI は開発者向けではない。** 接続と権限の設定は一般側に出ていて、接続の組込テンプレートは AI プロバイダーで占められている。AI の存在は既定の顔に露出しているので、AI カラムとエージェント設定を隠すと「鍵は登録できるが使う場所が無い」袋小路になる。API キーを持つことも開発者に限らない。隠すのは API コンソール・API ドキュメント・ストリーム・スクラッチパッド・タスクと、Raw データを見る面・生ファイルを編集する面、About の起動 / 実行時パフォーマンス表示（数値は性能 issue の材料で、一般ユーザーが読んで行動できるものではない。「情報をコピー」の本文には表示に関係なく同梱される）。About の自己診断は隠さない — 「何かが壊れている」を一般ユーザーが知る唯一の場所。

**配布物は「カラムは一般 / 作成・編集は開発者」。** テーマ・プラグイン・ウィジェット・クエリ・スキルが同じ規則に従う。管理カラムごと隠すと MisStore からの受け取りが死ぬ。

**帰属タグ:** カラム / ウィンドウ / コマンド / チュートリアルのカテゴリが `exposure` を持つ。未指定は `'general'` 扱いなので、既存の面は宣言を足さない限り従来どおり出る。判定は `src/settings/exposure.ts` の `isExposed()` 一本で、「アクティブなタグ集合が要求タグを含むか」を見る。複雑さの軸（[#1024](https://github.com/notedeck-dev/notedeck/issues/1024)）が来たらタグを 1 つ足して集合を広げる — boolean にしていないのはこのため。

**判定を参照する面（追加時はここに繋ぐ）:**

| 面 | 参照するもの |
|------|------|
| カラムの追加導線（追加ダイアログ / パレット / ナビバーエディタ / LaunchPad「もっと」） | `src/columns/exposure.ts` の列挙アクセサ |
| ナビバーのボタン | `isColumnExposed`（`navbar.json5` からは消さず描画側で絞る） |
| ウィンドウの入口（文脈メニュー・カード上の編集ボタン） | `src/windows/exposure.ts` の `isWindowExposed` |
| 設定メニュー / 設定のクイックピック | 開くウィンドウのタグ（両者が自動で揃う） |
| コマンドパレット / キーバインド割り当て一覧 | `Command.exposure` |
| 生ファイルを直接編集するタブと、その「OS 既定エディタで開く」 | 各ウィンドウが宣言的に opt-in（`tests/lint/rawFileEditorExposure.test.ts` が宣言漏れを検査する） |
| 配布物の作成・編集の入口（新規作成ボタン / カードの編集 / プラグインのソースタブ） | 編集ウィンドウがあれば `isWindowExposed`、窓自体は一般でタブだけ隠す場合（プラグイン）は `isExposed('developer')` |
| 独立ウィンドウでない Raw 面（プロフィールの Raw、サーバー情報の meta/stats、チャートの JSON、連合インスタンス） | `isExposed('developer')` を直接参照 |

ウィンドウの `open()` は塞がない。プラグイン・AI・`notedeck://` からの正当な呼び出しまで壊すと「機能の削除・劣化はしない」原則に反する。

**初期値:** 既存インストールは on、新規のみ off。判定に `settings.json5` のキー有無は使わない（スカラー設定を一度も変えていない既存ユーザーが新規と区別できなくなる）。アカウントの有無と `ai.json5` の痕跡を信号にして、起動時に一度だけ確定させる（`src/services/developerMode.ts` + `useDeveloperMode`）。

**トグル:** コマンドパレットのトグルコマンドと、「NoteDeck について」のスイッチ。設定メニューには置かない。読み書きは `useDeveloperMode` に集約している。

## Fork support

NoteDeck の対応範囲は **Misskey 本家および「Misskey を名乗り続けるフォーク」** です（yamisskey, misskey-tempura 等）。
**Misskey から名前が別物になったフォーク（Sharkey, CherryPick, Firefish, Iceshrimp 等）は対応していません。**

対応可否は `src/adapters/registry.ts` の `FORKS` テーブル（`supported` フラグ）が単一の source of truth です。
Misskey を名乗るフォークの多くは nodeinfo の `software.name` が `"misskey"` のままなので、
misskey.io のフォーク (`MisskeyIO/misskey`) は nodeinfo 2.1 の `software.repository` で識別します。
repository を返さないサーバー（nodeinfo 2.0 のみ）や、テーブルに無い小規模フォークは本家扱いにフォールバックします。
未対応でも有名フォーク（Sharkey / CherryPick / Iceshrimp）は識別し、ログイン画面で「Sharkey は未対応です」と
名指しで表示します（`unknown` 扱いにしない）。識別できないサーバーのみ「Misskey サーバーではないため未対応です」に落とします。
未対応サーバーでもファビコンのプレビューは行います (#853)。

### 自動検出で動くもの（コード変更不要）

Misskey を名乗るフォークは追加の設定なしで自動的に認識されます。以下の機能は動的に検出されるため、コード変更なしで動作します:

- **カスタムタイムライン**（bubble, yami, hanami 等）— `/api/endpoints` スキャンで自動検出（`src/utils/customTimelines.ts`）
- **モードフラグ**（`isInYamiMode`, `isNoteInYamiMode` 等）— ポリシー API から動的に検出
- **タイムラインフィルター**（`withBots`, `withSensitive` 等）— `/api/endpoint` が返すパラメータ名の有無で可用性を判定（ポリシーではない）
- **公開範囲の制限**（`canPublicNote` 等の `can*Note`）— ポリシーが false の公開範囲を選択肢から外す

### 差分の型と置き場

フォークとの差分は 3 つの型に分かれ、型ごとに置き場が決まっている。「フォーク名で分岐しない」「フォークの知識をフォークのディレクトリから外に漏らさない」の両方を満たすための分け方で、どちらか一方だけで決めない。

| 差分の型 | 可否の判定 | コードの置き場 | 実例 |
|---|---|---|---|
| 本家と同じエンドポイントに、フォーク固有の **値や属性** が乗る | 動的（ポリシーのキー / ノートのフラグ / meta のキー） | 規則は純関数にして `src/adapters/<fork>/` に置き、呼ぶ側（投稿フォーム・MkNote・フィルター）はその関数だけを見る。notecli は `RawNote::normalize` で属性を `NormalizedNote` に残す | モードフラグ（`isNoteIn*Mode`）、tempura のセミパブリック（`src/adapters/misskey-tempura/semiPublic.ts`、#936） |
| フォークにしか無い **エンドポイント** | 静的（nodeinfo の repository で選ばれる adapter が持つか） | `src/adapters/<fork>/index.ts` が本家 adapter を spread して `api` に足す。`MisskeyApi` の契約では任意（`?`）にし、UI は「adapter が持つか」で出し分ける。Rust の command は notecore に共有でよい | はなみ検索（`searchNotes` の差し替え）、tempura の引用一覧（`getNoteQuotes`、#1263） |
| API からは判定できない **静的な知識** | 静的（`ServerFeatures` の宣言） | `src/adapters/<fork>/index.ts` の `*_FEATURES` を `registerAdapter()` に渡す | tempura のリモート絵文字リアクション（#630） |

値や属性の型をエンドポイント一覧の有無で判定して本家 adapter に足すと、本家が応えられないメソッドが共通の契約に混ざる。逆にエンドポイントの型を動的検出にすると、フォークの語彙が共通層に漏れる。迷ったら「本家サーバーに同じ要求を送って意味があるか」で分ける。

利用者向けの対応状況の一覧は [`site/docs/forks.md`](site/docs/forks.md)（英語版は `site/en/docs/forks.md`）が正本。フォークごとの棚卸しと未対応の候補は追跡 issue（Misskey.io #1101 / tempura #1199 / はなみすきー #1200 / yamisskey #1264）に置き、ドキュメントには確定した判断だけを書く。

### フォーク固有の adapter 対応を追加する

フォーク固有の機能が動的検出では不十分な場合（静的な capability 宣言が必要な場合等）、adapter パターンで対応できます。

**ServerSoftware は `owner/repo` 形式**で管理されます。サーバーの識別には nodeinfo 2.1 の `software.repository` フィールド（GitHub URL）を優先し、`software.name` をフォールバックに使います。

**手順:**

1. `src/adapters/types.ts` — `ServerSoftware` 型にリテラルを追加

```typescript
export type ServerSoftware =
  | 'misskey-dev/misskey'
  | 'your-org/your-fork'   // ← 追加
  | 'unknown'
```

2. `src/adapters/registry.ts` — `FORKS` テーブルにエントリを追加

```typescript
{
  id: 'your-org/your-fork',
  displayName: 'Your Fork',
  supported: true,          // 未対応フォークを識別だけしたい場合は false
  names: ['your-fork-name'], // nodeinfo software.name (lowercase)
}
```

3. `src/adapters/<fork>/index.ts` — フォーク固有の capability を宣言し、`registerAdapter()` の第 3 引数で渡す

```typescript
export const YOUR_FORK_FEATURES: Partial<ServerFeatures> = { yourFeature: true }
```

`src/core/server.ts` の `detectFeatures()` が `forkFeatures()` 経由でこれを重ねます
（フォークの知識をフォークのディレクトリから外に漏らさないため、`server.ts` 側に
`if (software === ...)` を足さないこと）。

4. 叩くエンドポイント自体が違う場合は、フォーク固有アダプターを作って `registerAdapter()` で登録する

```typescript
// src/adapters/<fork>/index.ts — 本家アダプターを土台に差分だけ上書きする
const base = createMisskeyAdapter(serverInfo, accountId, hasToken)
return { ...base, api: { ...base.api, searchNotes } }
```

API の実体は notecli 側にあるため、**エンドポイントの差し替えは TS だけでは完結しません**。
`notecli` に typed メソッドを足す → `#[specta::specta]` な Tauri コマンドとして出す →
アダプターがそれを呼ぶ、という経路になります（`src/adapters/hanamisskey/` が実例。
はなみすきーはロールポリシーで `notes/search` が無効なため `notes/hanamisearch-v1` に差し替えている）。

どちらを呼ぶかの判定に DB の `accounts.software` 列を使わないこと。ログイン時の値のまま固定されるため、
フォーク定義を後から追加しても既存アカウントが本家扱いのままになります。判定は nodeinfo 由来の
`ServerInfo.software`（= アダプター選択）に一本化します。

5. カスタムタイムラインのアイコンを追加する場合は `src/utils/customTimelines.ts` の `CUSTOM_TL_ICONS` に SVG パスを追加

**PR を出す前に:**
- `pnpm lint && pnpm typecheck && pnpm test` を通す
- フォークのどの機能が動的検出では動かず、なぜ静的な capability 宣言が必要かを PR 本文に記載する
- 利用者向けの対応表 `site/docs/forks.md`（と英語版）を更新する。`pnpm lint:docs` は root の .md しか見ないので、ここは人が揃える

## License

[AGPL-3.0](LICENSE)
