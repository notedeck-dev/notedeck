# AI — AI まわりの設計

AI チャット、手元の CLI、人格と記憶、capability、資格情報、HEARTBEAT など、AI に関わる設計の解説。
要点は [CLAUDE.md](CLAUDE.md) の「アーキテクチャ要点」、プロセスの構成 (notecore / notemaid) は [ARCHITECTURE.md](ARCHITECTURE.md#目指す構成-notecore-と-notemaid1106)、認可と秘密の扱いは [SECURITY.md](SECURITY.md) にある。

---

## AI 設定

| ファイル | 役割 |
|---------|------|
| `src/components/window/AiSettingsContent.vue` | AI 設定ウィンドウ (AI 接続ピッカー・モデル・権限・データソース・HEARTBEAT・生成) |
| `src/defaults/ai.json5` | 初期設定 (`activeConnectionId` / `models` / dataSources preset / heartbeat block / generation block)。権限は `permissions.json5` (principal 別 #712) に分離 |
| `src/composables/useAiConfig.ts` | `AiConfig` schema + normalize / merge + Vault 接続移行 |

**永続化:**
- AI 設定は `ai.json5` に格納 (`useAiConfig` が単一 source of truth)。`activeConnectionId` + `models` のみで、API キー / endpoint は持たない
- **API キーは Secret Vault (OS キーチェーン)** に統合。詳細は [AI Credentials](#ai-credentials)

**対応プロバイダー:** Anthropic Messages 互換 / OpenAI Chat Completions 互換のどちらかを話すサービス (自前 LLM ゲートウェイを含む)。Vault 接続として登録し、AI 設定でピッカー選択する。API キーを貼るだけで繋がる内蔵テンプレの一覧は `crates/notecore/connection_templates.json5` が正本 (TS / Rust の表を `pnpm gen:connection-templates` で生成)。詳細は [AI Chat Streaming](#ai-chat-streaming)。

**主要セクション:**
- データソース (`dataSources: DataSourcesConfig`): system prompt の `<notedeck-context>` ブロックに含める情報の制御 (現在のアカウント / カラム / 可視ノート / 会話履歴)
- HEARTBEAT (`heartbeat: HeartbeatConfig`): 詳細は [HEARTBEAT Daemon](#heartbeat-daemon-411)
- 生成 (`generation: GenerationConfig`): 応答の最大トークン / tool 呼び出しの上限ラウンド / タイトル生成の最大トークン / 応答待ちのアイドルタイムアウト。既定で使える値だけを置き、実行先のモデルによって既定が合わなくなるものに限って開けている。範囲と既定値は `useAiConfig.ts` の `AI_*` 定数が正本で、読み込み時に `normalizeGenerationConfig` が clamp する。アイドルタイムアウトだけは Rust 側にも同じ幅の検査があり (`ai_chat_service.rs`)、`read_timeout` が `ClientBuilder` にしか無いため秒数ごとに HTTP クライアントを使い回す
- 権限は AI 設定には含まれない — #712 で principal 別の `permissions.json5` に分離済み (capability から書き換え不能な場所に隔離)。preset (`readonly` / `safe` / `full` / `custom`) + 個別 toggle の構造と principal 別デフォルトは [SKILLS.md §5](SKILLS.md) 参照

**設定の動的反映 (再起動不要):**
- AI tool 呼び出し前に `reloadAiConfig()` (AI 固有設定) と `reloadPermissionsConfig()` (permissions.json5) で再読込する
- 外部エディタで `ai.json5` / `permissions.json5` を編集しても、次回 dispatch 時に最新値で照合される
- 設定 UI からの変更も同じ singleton に流れるため即時反映

**自己改変系 capability の安全弁:**
- skill / widget / plugin / theme の **write 系 capability** (例: `skills.create`, `skills.replaceSection`, `widgets.create`, `plugins.update`, `themes.create`) も `aiTool: true` で tool calling に露出する (plugin 導入時の `aiTool: false` ガードは #107 で廃止)
- 安全弁は 2 層: permission (`skills.write` 等。preset に加え #712 で principal 別解決、`skills.write` は plugin / external に恒久 deny) + `requiresConfirmation` の **確認ダイアログ** (引数 JSON は code block + Shiki シンタックスハイライトで表示)
- `aiTool: false` が残るのは `ai.chat` (プラグイン専用 — AI 自身からの再帰呼び出し防止) のみ。詳細は [SKILLS.md §5.2](SKILLS.md)
- **配布物の動詞は 1 つの語彙** ([#1233](https://github.com/notedeck-dev/notedeck/issues/1233)): plugin / widget / query / skill / theme の capability は `list` / `read` / `create` / `update` / `delete` / `install` / `uninstall` / `setEnabled` / `history` / `revert` を基本の動詞にし、kind にしか無い操作だけ kind 側の名前で残す (`widgets.setAutoRun` は有効フラグではないので別名、`themes.apply` は選択、`skills.append` / `skills.replaceSection` は AI が育てる長い本文向けの部分更新で、全置換の `skills.update` は意図的に置かない)。`delete` はローカル id で消す (無ければ `removed: false`)、`uninstall` はストア由来を外す (plugin / widget は storeId でも引け、無ければエラー)。theme の名前空間は他と同じ複数形 `themes.*` で、権限キーも `themes.read` / `themes.write` (読取系も他の配布物と同じく権限で守る。`permissions: []` は external に素通りする)。権限キーと capability id の改名に移行は無い (β): 古い `permissions.json5` の `theme.write` は読み捨てられて既定 (false) に戻り、`confirmSkips` の旧 id も効かなくなるので、更新後に設定し直す

## AI Capability Registry

**ファイル:** `src/capabilities/`

`Capability` (`src/capabilities/types.ts`) は「実行できる操作」の単位で、**HTTP API / パレットの CLI と slash / AiScript (`Nd:call`) / AI tool calling** が同じ registry を dispatcher 越しに共有する。コマンドパレットの `Command` (`src/commands/registry.ts`) は人が押す入口 (ラベル / アイコン / ショートカット / 露出 / `execute()`) で、型としては別物 (#1098 §9、2026-10-27)。Command が capability を呼ぶかどうかは中身の自由で、`useCommandStore.register` は capability registry に何もしない。id の名前空間も分かれる (Command は kebab `note-react`、capability は dotted `notes.react`)。パレットの CLI (`src/commands/cliHandlers.ts`) のうち API を叩く動詞 (react / renote / delete / follow / favorite など) は `dispatchCapability` を user principal で呼ぶので、slash と同じ確認ダイアログを通る。capability に無い引数を持つ `post` (`--local-only`) と `update` だけが IPC 直呼びで残る。

### 宣言の正本と生成物

**builtin capability の宣言 (id / 権限 / 確認の要否 / cheap / 実行属性 / AI ツールスキーマ) の正本は `crates/notecore/capabilities.json5`** ([#1133](https://github.com/notedeck-dev/notedeck/issues/1133))。`pnpm gen:capabilities` が `src/capabilities/declarations.generated.ts` (TS の宣言表と `CapabilityId` 型) と [SKILLS.md §4.0](SKILLS.md#40-capability-一覧) の表を生成し、最新かどうかは `tests/lint/capabilityDeclarations.test.ts` が検査する (openapi.json / bindings.ts と同じ運用)。実装は `src/capabilities/builtins/<subject>.ts` に `implement('<id>', { execute, requiresConfirmation?, preflight? })` で書く (振る舞いだけ。宣言に無い id はコンパイルで落ち、宣言と実装の不一致は lint で落ちる)。実行時に決まる enum (カラム種別など) は `enumOf` で getter を差す。説明文の共通句は宣言ファイルの `placeholders` に置き `${name}` で参照する。

**権限キーの語彙も同じファイルの `permissions` 節が正本**で、preset (readonly / safe) と floor / deny の集合をキーごとの属性で宣言し、同じ生成器が `src/permissions/keys.generated.ts` と `crates/notecore/src/permissions_keys.generated.rs` を出す (TS と Rust で語彙がずれない。`schema.ts` / `permissions_profile.rs` は生成物を読んで解決規則だけを持つ)。

同じ生成器が **Rust の宣言表** `crates/notecore/src/capabilities/generated.rs` (型と tool schema の組み立ては同 `mod.rs`) も出し、AI に渡す tool schema が TS (`toolSchema.ts`) と Rust で一致することは `src/capabilities/golden/tools.json` (期待値の正本は JS 側、`pnpm gen:golden-tools`) で検査する。

### `exec: 'core'` の本体 (notemaid)

**`exec: 'core'` の capability は本体を notemaid (`crates/notemaid/src/exec/`) に 1 実装だけ置き**、デバイス側は `implementCore('<id>')` で登録だけする (本人操作は `capability_execute` の RPC で notemaid の本体を叩き、AI のターンはターン実行器が直接呼ぶ)。core の宣言 ⇔ 委譲の対応と、core と宣言した id に本体があることは lint (TS / Rust) で落ちる。

確認が要る core capability の表示内容は notemaid の `capability_preview` が組む (`exec/preview.rs`。固有の文面が無いものはラベル + 引数 JSON の汎用形)。AI のターンでは、デバイスが居るときは従来どおりデバイスの dispatcher が確認内容に帰属 / 理由の行を足す。デバイスが答えられないとき (`ai/confirm-preview` の失敗) に限り、core の capability なら `CoreExecutor::preview` (notemaid 自身) で組む。

AI のターン経路は dispatcher を通らないので、dispatcher の実行後 hook (AI Spotlight) は core capability の AI 実行では光らない (プラグイン / 本人操作の経路では従来どおり)。

### 設定フォルダへの書込と変更通知

**core の capability が設定フォルダのファイルを書くときは notecore の `settings_events` の書込ヘルパを通す**: 書けたら `nd:settings-file-changed` (subdir / name / op) をデバイスに流し、デバイスの store は `registerSettingsFileHandler` で自分の面 (subdir か root) の変更だけ受けて写しを読み直す (`useSettingsFileSync`、購読は App.vue でウィンドウごとに始める)。デバイス発の汎用ファイルコマンドは通知しない (自分の写しは自分で更新している)。AI セッションだけは例外で、ターン中の表示用 placeholder を上書きしないよう、イベントの `message_id` とターン終了時の `reload` で揃える (変更通知には乗せない)。

**skill** (この形の最初の消費者): 本体 (`crates/notemaid/src/skills.rs`、frontmatter の codec / slug とファイル名 / ID 凍結 / 編集履歴 (notecore の `edit_history.rs`) / 自己編集の適用) は notemaid にあり、AI の `skills.*` は notemaid が書いてから通知し、デバイスの skills store はそのファイルだけ読み直す。UI からの編集はデバイスの store が同じファイルを書く (notemaid は状態を持たず毎回ファイルを読むので、ファイルだけが正)。自己編集の diff 確認 (#981) は notemaid の preview が適用後全文を組んで `staged` (`exec/staged.rs`) に置き、execute はそれを消費する (確認後に対象が変わっていれば中止、保持は確認要求の TTL と同じ)。

**メモも同じ形** (`crates/notemaid/src/memos.rs`): frontmatter は js-yaml の dump が出す YAML を notecore の `yaml_lite.rs` で読み書きし (数値 / 真偽 / 日時に見える文字列は二重引用符)、id はローカル時刻の Zettelkasten 形式 (占有されていれば 1 秒ずつ先へ)。本文の末尾 LF は「無ければ足す」規則で往復が安定する (以前は再保存のたびに増えていた。デバイス側も同時に直した)。AI の `memos.*` は notemaid が書いて通知し、デバイスの写し (`useMemos`) はそのファイルだけ読み直して AiScript 向けの `memo:*` を出す。

**テーマとカスタム CSS も同じ形** (`crates/notecore/src/themes.rs`): テーマの JSON5 は `json5_out.rs` (`JSON5.stringify` と同じ整形、キー順は `indexmap` で保持、id 凍結の注入も) で書き、ファイル名は表示名の slug。custom.css はルートファイルで、履歴もルートの `custom.css.history.json5` (`edit_history` のルート版)。`theme.apply` (画面への適用と OS の明暗の判定) はデバイスに残る。デバイスの theme store は `themes/` と root の `custom.css` の変更を受けて写しと画面を揃える。

**プラグイン / ウィジェット / カラムクエリも同じ形** (`crates/notecore/src/sidecar/`): src (`.is`) と meta (`.meta.json5`) の 2 ファイルで 1 個体、書込は src → meta、削除は meta → src → 履歴の順、meta のキー順は種別ごとの規定順 (未知のキーは末尾に残す)、ID 欠損はメタファイルの完全名を凍結、ソースの無い個体は読取専用で変更を拒否する。プラグインのヘッダ (`/// @ <ver>` + `### {}`) の解析も notecore (`sidecar/plugin_meta.rs`) で、MisStore からのインストール (sha512 検証、既存個体は本文の diff と「新しい権限」を 1 枚目の確認に畳む) は notemaid (`exec/`)。`plugins.create` / `plugins.update` / `widgets.create` / `widgets.update` は AiScript の構文検証 (preflight) が JS の Parser にしか無いのでデバイスに残る。AiScript の実行はデバイスで、各 store が `plugins/` `widgets/` `queries/` の変更通知を受けて写しを揃え、前後を比べて起動 / 停止 (プラグインの有効化・ソース変更・削除。UI や capability からの同じ変更も同じ hook を通る)、表示中の再実行 (ウィジェットのソース変更)、暴走サスペンドの解除 (クエリのソース変更) を行う。

**キーバインド / ナビバー / パフォーマンス設定も同じ形** (`crates/notecore/src/{keybinds,navbar,performance_settings}.rs`): ルートの `keybinds.json5` / `navbar.json5` / `performance.json5` を notecore が書き、既定値は `src/defaults/` の同じファイルを `include_str!` で共有する。パフォーマンス設定の各 key の範囲 / 刻み / 分類 / スライダー両端は TS の表が正本で、`pnpm gen:golden-perf` が採取する golden (`src/capabilities/golden/performance.json`) を Rust が読む (tools.json と同じ方式)。`performance.list` の表示名・説明・単位は辞書の `_performanceData` 節 (Rust の辞書にも埋め込む) から英語の正本文で返す。デバイスの keybinds / deck / performance store はルートの変更通知を受けて写しを読み直し、パフォーマンス設定は CSS 変数と Rust 側 (`perf_config`) へ反映する。

persona の切替 (`ai.setPersona`) は notemaid が `ai.json5` を書き、`useAiConfig` が変更通知で読み直す。

### 条件付き書込 (仕様 §4.5)

notecore 側のファイルは AI (notemaid) とデバイスの両方が書くので、丸ごと書き戻す書き手は「読んだときの版」を添える。版は内容のダイジェスト (`settings_store::content_version`、無いファイルは空文字の版、プロセスをまたいでも同じ値) で、`write_settings_file` / `write_root_settings_file` / `write_notedeck_json` は `expected` が今の版と違えば `CONFLICT` で拒み、書けたら新しい版を返す。版つきの読取は `read_root_settings_file_versioned` / `read_notedeck_json_versioned`。ルート直下の書込コマンドはコマンド表に載せた (以前は Tauri 側の手書きで、常駐構成では手元のファイルを書いてしまっていた)。

デバイス側で版を通すのはルートの notecore 側ファイルを丸ごと書き戻す store (settings.json5 = 変えたキーだけ最新に載せ直して再試行 / ai.json5 / permissions.json5 / tasks.json5 = 最新に揃える / theme-dropins.json5 = 記録を諦めて次回) で、`isConflictError` で見分ける。サブディレクトリの個体ファイルは store が変更通知で写しを揃えているので、版はまだ添えていない (仕組みは同じコマンドにある)。

### 設定ファイルの置き場と帰属

アプリデータディレクトリの解決は notecore (`app_dir.rs`、bundle identifier の定数と `NOTEDECK_APP_DIR` の上書き) に 1 つ置き、アプリの Tauri 経路と identifier が一致することをテストで保証する (notemaid も同じ関数で同じ場所を開く)。アプリデータディレクトリの中の配置 (設定 `config/` / 人の記録 `data/` / この機械の状態 `state/` / キャッシュ `cache/`。再編前は `notedeck/` に同居し、版印 `layout.json5` の有無で `Layout::legacy` / `Layout::v1` を選ぶ、#1334) は同じ `app_dir.rs` の値型 `Layout` だけが知り、他のコードは `Core::layout()` か `Layout::from_root()` から受け取る (`join("notedeck")` の散在は `tests/lint/rustSettingsDir.test.ts` が禁止、#1333)。ルート直下とサブディレクトリの allowlist は属性表 (`settings_store.rs` の `ROOT_FILES` / `SUBDIRS`: 置き場の `area`、バックアップに含めるかの `backup`、汎用の読み書きで触れるかの `ipc`) になっている。この端末の構成 (`client.json5`、`backend: auto | embedded | resident`、codec は `client_config.rs` と `services/clientConfig.ts`) はバックアップに含めない。設定ファイルの書込は決定的で、各ルートファイルのコーデックは `src/services/settingsFileCodecs.test.ts` に登録する (allowlist にあって登録の無いファイルは落ちる)。

### デバイスなしで AI のターンを回す (notemaid のプロセス)

**デバイスなしの受け入れ検査** (`crates/notemaid/tests/headless_loop.rs`): notemaid と notecore の公開 API だけ (ターン実行器 + `LocalCoreExecutor` + `NoDeviceBridge` + ファイルのセッション / 汚染 / チェックポイント、provider は台本) で、core の読取がひと通り走る / 確認つきの書込は確認内容を notemaid が組んで遠隔の答えで再開し notemaid が書いて変更通知を出す / 無人は確認の要る書込を意図として残す / デバイス依存の capability は `device_unavailable` で AI に返りターンは止まらない、の 4 点を検査する。

別プロセスの notemaid (`crates/notemaid/src/daemon/`) は AI 系 (notemaid の表) だけを RPC で受け、HEARTBEAT timer を持つ。起動役は [ARCHITECTURE.md の「目指す構成」](ARCHITECTURE.md#目指す構成-notecore-と-notemaid1106) のとおり (子プロセスが既定、常駐は AI 設定のトグル = `notemaid service`)。SQLite は開かず、口座の所在は notecore の `AccountStore` trait (アプリは notecli.db が実装、notemaid は `SyncedAccounts` = 接続したアプリが `notemaid.accounts` で写した一覧をメモリと小さなファイルに持ち、口座が変わると `core_sync_accounts` で写し直す)。資格情報の解決 (`credentials.rs`) と口座一覧 (`account_service::list_public_from`) はこの trait だけを見るので、`Core` は DB なし (`initialize_client` + `set_account_store`) でも AI のターンを回せる。トークンは OS キーチェーンから同じ id で読み、キーチェーンが無い環境 (WSL2 など) ではアプリの DB と同じくトークン列が経路になる (写しに含める。保護水準はアプリの DB と同じ)。子プロセスが繋がる前に死んだ / 答えないときは in-process に退避する。

**DB なしの Core で待ち続けない規則**: `Core::ready()` は廃止し `authed*()` / `client()` を使う。取得系が索引 (notes キャッシュ) へ書くのは `Core::with_archive` (索引があるときだけ回し、無ければ素通し) と `spawn_archive_write` (待たない) で、`blocking` は DB の無いプロセスでは即 Err。手元の索引を読む `notes.searchArchive` は `FrontendBridge::archive_search` (型付き。wire は `archive/search`) で端末に聞き、アプリの Rust (`query_bridge::answer_archive_search`) が自分の Core で答える (WebView は通らない)。server_info の検出結果は DB があれば DB、無ければメモリ (`ServerInfoService::new_in_memory`)。この規則は `context.rs` の `client_only_core_never_waits_for_a_database` と notemaid の `search_archive_asks_the_device_through_the_bridge` が押さえる。

### アプリと notemaid の間 (クライアント層と橋)

**アプリ側のクライアント層 (`src-tauri/src/client_layer.rs`)**: 切替点はコマンド表の Tauri ラッパー (`commands/table.rs`) の notemaid 側 (AI 系) の行だけで、別プロセスの notemaid に繋いでいれば引数を wire の形 (camelCase) にして中継し、そうでなければ in-process の notemaid を呼ぶ。データ系コマンドは常に埋め込みの notecore を呼ぶ。中継先が出すイベントは同じ名前で WebView に流し、状態 (接続 / 版 / 指紋の一致) は `nd:client-layer-state` と `client_layer_state` コマンドで出す。

**橋の向き (notemaid → 端末)**: notemaid の橋の問い合わせ (確認内容の組み立て `ai/confirm-preview` / 実行要求 `ai/execute-capability`) は、別プロセスの notemaid では接続中のセッション (最後に繋いだ端末) に `query` frame で投げ、端末は WebView 往復の後に `query_response` で答える。端末が居なければ橋は Err で、ターン実行器は core の capability の確認内容を自分で組み、端末依存の capability を device_unavailable で返す。`notemaid.probe-device` の要求でこの経路を診断できる。HEARTBEAT の文脈を聞く橋 (`heartbeat/context`) は #1162 で廃止した (system は notemaid が組む)。

認可境界の操作 (認証の保存 / アカウントの削除・ログアウト / Vault の secret と信頼の書込 / ルート設定ファイルの書込) も本体は notecore にあり、コマンド表では種別 `authz` の行になる。lint は表の行の種別を名前で固定する (`tests/lint/rustCommandKinds.test.ts` の `TABLE_AUTHZ`)。公開 API 面の永続トークン (external principal) を RPC 面の秘密として出しても通らないことは notemaid の smoke テスト (`crates/notemaid/tests/smoke.rs`) が golden として押さえる。

healthcheck は doctor とキャッシュ統計を notecore の `health_core` から取り、ログ場所や直近の panic は手元で足す。HEARTBEAT の手動実行は notemaid の `run_once` を呼ぶ表の行。timer は in-process でも常駐でも notemaid の `HeartbeatTimer` で、別プロセスの notemaid に繋いでいるときは手元の timer は組まない。

### ストリームの生イベントと未読

**生イベントの内側化**: ストリームの生封筒 (`stream-envelope`、全イベントの tagged union) は Stream Inspector が観測を開いている間 (`stream_observe_start` 〜 `stream_observe_stop`) だけ流し、未読カウンタは Rust が生イベントから切り出す専用イベント `stream-unread` (口座 / 種別 / 増分か全既読か) を受ける。判断は notecore の `stream_fanout.rs` に 1 つで、アプリの emitter が通る。

### デバイス側の規約 (実装方針 / 確認 / 編集履歴 / AiScript)

**API capability の実装方針**: 原則 `ApiAdapter` (`src/adapters/types.ts`) 経由で実装する (フォーク対応の抽象化を維持するため)。Tauri commands 直呼びは `registry.*` / `chat.*` のように Misskey 専用機能で他フォーク対応想定が無い場合のみ許容。詳細は [SKILLS.md §4.0.2](SKILLS.md#402-adapter-経由--tauri-直呼び-の使い分け) 参照。

**AI 用 tool schema は宣言の params / returns から自動変換**:
- Anthropic `tools[]` / OpenAI `functions[]` block を `src/capabilities/toolSchema.ts` で生成
- `.` を含む id は `^[a-zA-Z0-9_-]{1,128}$` 制約のため `_` に変換 (例: `time.now` → `time_now`)
- dispatcher で逆引きするため AI / プラグイン作者は意識不要

**確認ダイアログの「今後確認しない」(#714):**
- `requiresConfirmation` な capability の確認で「今後この操作を確認しない」を ON にして許可すると、scope × capability 単位で `state/permissions-meta.json5` の `confirmSkips` に記憶され、次回以降の確認をスキップする (確認の結果はこの機械の状態で、方針の `permissions.json5` とは別。どちらも capability から書き換え不能、#1333)
- scope は `ai.chat` と `plugin:<pluginId>` (プラグイン / ウィジェット個体単位) のみ。user (本人操作の confirm は削らない) / `ai.heartbeat` (無人実行 — チャットの同意の波及も heartbeat 自身での記憶も不可) / `external` は対象外で常に確認される (同意すり替え防止 #712 §3.3)
- 記憶の一覧・取り消しは権限ウィンドウの該当 principal 行内「確認なしで実行できる操作」
- capability 固有の remember (`onConfirmRemember` — vault.fetch の接続単位信頼) を持つ capability は汎用スキップの対象外

**編集履歴 + revert:**
- skill / widget / plugin / theme / カスタム CSS の各カテゴリで `*.history` / `*.revert` capability を提供
- 編集前のスナップショットを sidecar (`<basename>.history.json5`) で管理 (`src/utils/historyFs.ts`)
- AI が誤って編集しても 1 capability で巻き戻せる
- 各エディタの「履歴」から編集履歴ウィンドウ (`edit-history`) を開くと、選んだスナップショットを「その編集で何が変わったか」の diff で読める (比較相手は 1 つ新しいスナップショット、無ければ現在の内容)。戻す操作は同じウィンドウから `*.revert` capability を通す
- 種別ごとの差分 (snapshot → 全文テキスト・言語・revert 先 capability) は `src/services/editHistory.ts` に集約

**編集履歴の「誰が・なぜ」(#1052):**
- 各スナップショットは帰属 (`by` — 権限の principal をそのまま格納) と理由 (`reason`) を持つ。どちらも無いエントリを読めるようにしてあり、記録開始前の履歴もそのまま表示できる
- 帰属は capability の実行文脈から取る (`src/capabilities/editAttribution.ts`)。store の編集 mutator は帰属を optional 引数で受け、渡されない経路 (UI から直接の編集) は本人の編集として扱う
- 理由は write 系 capability の `reason` パラメータで受ける。AI は編集を要求する時点で理由を持っているので、dispatcher が確認ダイアログへ注入し、**承認前に見せた文字列がそのまま履歴に残る**
- **本人の手編集に理由は付かない** — エディタはデバウンスの自動保存で、保存のたびに入力を求めると破綻する。理由の欄が無いエントリを前提に UI を作ること (空欄を並べない)
- 保持は単純な古い順のリングではなく優先度付き (`evictHistory`)。溢れたときは「本人の手編集かつ理由なし」から先に落とし、AI・プラグインの編集と理由付きを残す。全件が保護対象なら最古から落とす
- 本人の連続した自動保存は直前のエントリに畳んで積まない (`shouldCoalesceEdit`)。スナップショットは「その編集の直前の状態」なので、連続保存では**古い方を残す** = 後続の push を捨てるのが正しい。AI の編集は 1 回ごとに理由が付くため畳まない

**コード面の明暗 (#1053):**
- エディタ / 差分表示 / コードブロックはトークン色と面がセットなので、**アプリのテーマにそのまま追従**する (アプリが OS 追従ならコード面も OS に追従)。設定項目は持たない
- 実効値は root の `data-nd-code-scheme` に出し、CSS 変数 (`--nd-code*`) がそれを見る。CodeMirror のテーマも Shiki のトークン色も同じ実効値から決まる (`useCodeScheme`)
- 明暗を別扱いしたい場合はカスタム CSS で変数を上書きする

**コードの色付けは 2 系統、色の決め方は 1 系統 (#1050):**
- 編集側 (CodeMirror) は `--nd-codeKeyword` 等、読み取り側 (Shiki — MFM コードブロック / 確認ダイアログ / AI チャット / 診断ログ) は役割ごとの `--nd-code-token-<役割>` を指す。読み取り側の役割一覧は `src/utils/highlightTheme.ts` (`ND_CODE_TOKEN_ROLES`) が正本で、スコープの割り当ては VS Code Dark+ を写し、役割は「Dark+ と Light+ で同じ色の組になるスコープ群」で切ってある
- 変数の定義は `src/styles/global.css` の 1 箇所 (dark は `:root`、light は `:root[data-nd-code-scheme='light']`)。`tests/lint/codeTokenVariables.test.ts` が「全役割が定義されている / 他の場所で定義していない」を検査する
- Shiki のテーマは 1 つ (`nd-code`) で色の代わりに `var(--nd-code-token-*)` を返し、出力の span は inline style でそれを乗せる。明暗の切替は CSS 側だけで完結し、再トークナイズも別 CSS の読み込みもしない。トークンの色をカスタム CSS で変えるには変数を上書きする (色ごとのクラスを探す必要はない)
- エディタと同じ役割 (keyword / string / number / comment / variable / function / type) は既定でエディタ側の変数を指すので、`--nd-codeKeyword` を上書きすれば編集画面と読み取り表示の両方に効く
- **編集側の基盤への一本化 (B 案) は不採用**。理由は issue #1050: 本家追従の原則 (MFM のコードブロックは本家と同じ Shiki) と、既製の文法資産による言語カバレッジを捨てる代償に見合う実害が無い。再検討するなら「依存とバンドルを減らす」目的で独立に評価する
- **AiScript の文法定義は 2 本のまま、語彙だけ 1 本** — キーワード / リテラル / 注入定数 / 組込の名前空間とメンバーは `src/aiscript/grammarTokens.ts` が正本。CodeMirror の文法と補完は直接 import、tmLanguage (`src/assets/aiscript.tmLanguage.json`) は `pnpm gen:aiscript-grammar` で生成し、`tests/lint/aiscriptGrammar.test.ts` が一致を検査する。文法の骨格 (文字列・コメント・関数呼び出しの begin/end) は形式が違うので生成せず、スクリプトに静的に持つ

**適用前 diff (#981):**
- 自己拡張系の write 確認 (`ConfirmOptions.diff`) は編集後の断片ではなく、編集前と適用後の**全文**を並べて見せる。部分編集 (追記・セクション置換・props patch) も適用後全文を確認時点で計算する (`src/services/selfEditApply.ts`)
- 承認後は再計算せず、確認に使った全文をそのまま書き込む。確認と書込の間に元ファイルが変わっていたら書かずに中止する (`src/capabilities/stagedEdit.ts` — 「見せたものと書くものの一致」が承認 UI の意味そのもの)

**AiScript からの拡張:**
- AiScript の実行環境 (Mk:* / Nd:* / Ui:* + interpreter) は `src/aiscript/sandbox.ts` の `createAiScriptSandbox` 1 本で組む (#1099)。プラグイン / ウィジェット / Play / Page / スクラッチパッドはすべてここを通り、principal は必須引数で 1 回だけ渡す — Mk:api の endpoint gate、Nd:call / Nd:http の dispatcher 判定、登録 ID の名前空間、呼び出し元の AND 判定に使う `callers` が同じ値を見る。実行面を足すときも `createAiScriptEnv` / `createNoteDeckEnv` を直接組まない
- **プラグインの loopback 同意 (#1293)**: `Nd:http` は手元 (`localhost` / `127.0.0.1` / `[::1]`) を既定で拒み、例外はプラグインがヘッダーの `loopback` で宣言し利用者がそのプラグインに許可したポートだけ。記録は Rust (`crates/notecore/src/loopback_consent.rs`、`notedeck/loopback/consent.json`、バックアップ対象外) が本文の hash に結んで持ち、判定も Rust が要求ごとにディスクを読む (「動かしている本文 = ディスクの本文 = 同意した本文」のときだけ通す。TS は hash を計算せず、起動時に `plugin_body_hash` で受け取って実行要求に添える)。WebView 側は `capabilities/loopbackGate.ts` が `http.fetch` × plugin principal のときだけ規則の順序 (連鎖 → 対象外 → 常に拒否するポート → 宣言 → 本文の鮮度 → 同意) とダイアログ (UI 起点のときだけ。承認 = 記録で、その要求の確認を兼ねる) を担い、許可は Rust の記録でだけ決まる。実行の起点 (`origin: 'ui' | 'other'`) は `withPluginAccountContext` のスロットで、人が押した入口 (ノート / ユーザー / 投稿フォームのアクション、パレット) だけが `'ui'`。拒否はプラグインカラムのバッジ (理由つき、押すと詳細) と運用ログに残る。同意・取り消しは プラグイン詳細の設定と権限ウィンドウの AiScript 行 (`useLoopbackConsent`)。ヘッダー解析の正規化は TS / Rust が `src/aiscript/golden/loopbackHeader.json` を共有する
- `Nd:register_command(id, label, icon, fn, options)` はパレットの `Command` を登録する。`options` に `aiTool: true` と `signature` を渡したものだけ **別に `Capability` としても登録**され (permissions / requiresConfirmation も options から)、HTTP API / `Nd:call` / AI tool calling から呼べる。停止時は両方の登録を disposers が外す
- `Nd:capabilities()` で registry にある capability の宣言情報を列挙 (プラグインの自己発見)
- `Nd:on(name, handler)` で `column:added` / `column:removed` / `streaming:status` / `note:new` / `notification:new` を購読。`note:new` / `notification:new` は queryDelta を `core/queryRegistry`（queryId → flavor/accountId）で振り分けて fan-out する

### 経緯: notecored (データ面の常駐、2026-09-29 に中止)

この小見出しの下は旧 notecored (`crates/notecored`、#1106 段階 3a) の記述で、歴史として読む (中止の理由は [ARCHITECTURE.md の「目指す構成」](ARCHITECTURE.md#目指す構成-notecore-と-notemaid1106))。2026-09-29 に汎用中継 / コアの切替と再起動 / 移行パッケージ / 購読のセッション所有と中継 / 「コア」ウィンドウの切替導線 / データ面 (ストリーミング / クエリランタイム / OGP / 画像キャッシュ / 公開 API 面) を削除し、残る部品 (RPC 面 / transport / service 管理 / secrets の file backend / HEARTBEAT timer / sink) は notemaid の bin (`crates/notemaid/src/daemon/`) に統合した。今の形は上の各小見出しのとおり。

デバイスなしの受け入れ検査 (上の「デバイスなしで AI のターンを回す」) は notecored の前提として作った。同じ段階の下ごしらえとして、アプリデータディレクトリの解決を notecore の `app_dir.rs` に 1 つ置き (notecored も同じ関数で同じ場所を開いた)、ルート直下の設定ファイルの allowlist を属性表にし、この端末の構成 (`client.json5`) を設けた。配布と常駐化の設計 (unit / socket / secret / 切替導線) の正本は #1106 のコメント「notecored の配布と常駐化」。

**notecored (`crates/notecored`)**: `run` が notecore を headless に組み立てる (アプリの起動手順と同じ順で、デバイス依存の物だけが無い)。RPC 面は Unix socket (`$XDG_RUNTIME_DIR/notecored/notecored.sock`、0700 / 0600) 上の改行区切り JSON で、wire 形式は notecore の `rpc.rs` (`hello` で起動毎の秘密・版・マニフェストの指紋、`request` / `batch` はコマンド表の JSON アダプタ、`event` は Tauri と同じイベント名で押し出す)。接続は同じ uid だけ受ける。データディレクトリは `notecore.lock` (flock) で 1 プロセスに限り、再起動しても直らない状態は専用の終了コード (ロック衝突 / DB がバイナリより新しい / runtime dir 不在 / secret の鍵) で抜ける (`exit.rs`)。secret はファイル backend 固定 (`<data-dir>/notecored/secrets.enc`、鍵は設定ディレクトリの `notecored/secret.key` か `--secret-key-file`)。HEARTBEAT の timer は ai.json5 から組み、変更通知で組み直す。公開 API 面は `--api` を付けたときだけ。受け入れは `tests/smoke.rs` (実バイナリを起動して socket 越しに叩き、SIGTERM で止め、二重起動の終了コードを見る)。

**当時のクライアント層**: 切替点は今と同じコマンド表の Tauri ラッパー (`commands/table.rs`) の 1 箇所だったが、`client.json5` の `backend` が `resident` なら AI 系に限らず引数を wire の形 (camelCase) にして notecored に中継し、そうでなければ埋め込みの notecore を呼んだ。常駐構成の起動は DB もストリームも開かず、メディアプロキシとデッキ系ルートの HTTP サーバーだけ手元で動かし、アカウント一覧は notecored から取って `nd:accounts-early` に流した。認可境界の操作 (種別 `authz` の行) も同じ経路で中継した (同一ホストは同じ uid なので data と同じ扱い。外向き (3b) では手元の Rust の本人確認と署名を要する)。healthcheck の `health_core` も常駐構成では中継し、HEARTBEAT の timer は notecored が持ったので `heartbeat_configure` は何もしなかった。常駐構成で断るものは、切替導線そのもの (`core_switch_*`) だけになっていた。

**状態面 (`core_status`)**: unit の状態 (active / inactive / not_installed / unavailable = systemd の user セッション無し)、`XDG_RUNTIME_DIR` の有無、常駐中は notecored 自身の `notecored.status` (稼働時間 / 接続端末 / HEARTBEAT) も返し、「コア」ウィンドウはそれらから案内文を組んで、systemd や runtime dir が無ければ切り替えを無効にした。利用者向けの説明は notedeck.io/docs の「常駐コア (notecored)」ページ (日英) にあった。

**購読はセッションの持ち物**: notecored はカラムクエリの購読と単ノートの捕捉を繋いできたセッションごとに帳簿に付け、切断時に閉じる (別の端末や再接続後の自分が引き継ぐ形はとらない)。イベントには接続ごとの連番が付く。中継クライアントは自分が通した購読を覚えておき、繋ぎ直したら全量を冪等に出し直す。新しい id は WebView が持つ id との対応表で付け替え (応答を読んだその場で結び、直後に届く delta を取りこぼさない。行きの `queryId` 引数も戻りの `query-delta` も書き換える)、終わったら `nd:client-layer-resumed` を出して `useDeckResume` が復帰の catch-up を走らせる。切断中の差分は再送しない (変更ログと差分取得は 3b)。連番の欠落は数えるだけ (`eventGaps`)。生イベントの観測 (`stream_observe_start` 〜 `stream_observe_stop`) も notecored ではセッションの持ち物で、中継は再接続で開き直した。`stream_fanout.rs` の判断はアプリの emitter と notecored の emitter の両方が通った。

**接続モードの格上げ**: `settings.json5` の `modes.realtime` は notecored が自分で適用する (`stream_mode.rs`。起動時は polling のときだけ送り、realtime は接続の既定なので端末の購読で張られる。変更時は両方送る)。変更を知るために `settings.json5` の書込コマンドも変更通知を出す (デバイス側は自分の写しを自分で更新しているので受け手は無い)。アプリの切替は従来どおり全アカウントへモードを送るので常駐構成では二重に届くが、`set_mode` は冪等。polling の間隔は `performance.json5` の上書きを読む。

**配布 (Nix を先出し)**: flake の `packages.notecored` / `packages.notecli` (`nix profile add 'github:notedeck-dev/notedeck#notecored'`。`install` は古い別名。zsh は `#` をグロブに取るのでクォートする)。profile の symlink (`~/.nix-profile/bin/notecored`) は更新後も同じパスで新しい世代を指すので、`service install --exec-path` にはそれを渡し、unit には実パス (`/nix/store/...`、GC で消えうる) を書かない (literal が store 直下なら拒否)。notecored のクレート版はアプリと同じにする (`bump-version.sh` が揃える。指紋が一致しないと繋げないので版も揃えておく)。**配布の形 (2026-09-28)**: Linux の build job がアプリと同じ target で notecored をビルドし、`notecored service render` で ExecStart を `/usr/bin/notecored` に埋めた unit を書き出す。tarball (notedeck / notecored / unit) と deb (`tauri.conf.json` の `bundle.linux.deb.files`。手元で deb を作るときも先に notecored をビルドする) に同梱し、Linux の成果物には build provenance の attestation を付ける。AUR は split package (`packaging/aur/PKGBUILD`、pkgbase `misskey-notedeck-bin` → アプリ / `notecored-bin` / `notecli-bin`、同じタグの Release から同版) で、`sha256sums` は publish 後の SHA256SUMS.txt と実ファイルから実値を書く (`scripts/pkgbuild-checksums.py`)。standalone のバイナリ (`notecored-<version>-<os>-<arch>`、`notecli-...`) は publish の後の job が足す (SHA256SUMS には載らない)。Nix は flake の `homeManagerModules.notecored` (`services.notecored.enable`) が user unit の正本で、`service install` は他所で管理された unit があれば書かずにそのまま使う。macOS / Windows の常駐化は 3b 以降。

**切替導線 (順序 7、`src-tauri/src/core_switch.rs`)**: 設定の「コア」ウィンドウ (`CoreContent.vue`、接続の隣) とナビバーの表示 (常駐中か切替が完了していないときだけ出る)。常駐へ: notecored を探す (`/usr/bin` → PATH) → `service install` (unit を用意するだけ) → 移行パッケージを `$XDG_RUNTIME_DIR/notecored/` に書き出す → `client.json5` を `pending-resident` に → 再起動を促す。次の起動 (`resolve_pending`): 動いていれば止める → パッケージがあれば `notecored migrate import` (停止中限定、ロックを取る) → `service enable` → `resident`。パッケージが無く notecored の secret も空なら常駐は始めず今回は埋め込みで開き、理由を状態面 (`core_status` / `ClientLayerState.switchError`) に出す。戻す: `service stop` → `migrate export` → アプリが自分の backend に取り込む → 差分ゼロのときだけ `secrets purge` → `service uninstall` → `embedded`。**移行パッケージ** (`crates/notecore/src/migration.rs`) は一回限りの鍵で暗号化した notecli の file store と名前の索引 (アカウント ID / Vault の接続 ID と slot / 旧 AI キー) で、取り込みは成功・失敗どちらでも消す。OS キーチェーンからファイル backend への直接コピーは作らない。アプリは systemd を直接呼ばず、lifecycle は全部 `notecored service ...` 経由。確認は WebView の確認ダイアログ (同一ホスト・同一 uid なのでネイティブ dialog は 3b の外向きまで持ち越し)。

**橋の向き (notecored → 端末)**: 橋の問い合わせ (当時は確認内容の組み立て / 実行要求 / HEARTBEAT の文脈) を接続中のセッション (最後に繋いだ端末) に `query` frame で投げ、端末が WebView 往復の後に `query_response` で答える経路は notecored で作り (診断は `notecored.probe-device`)、今は notemaid が引き継いでいる (上の「アプリと notemaid の間」)。

**常駐化のサブコマンド**: `notecored service install` は systemd の user unit を用意するだけ (enable も start もしない。secret の import 前に起動させないため)、`service enable` が enable + start、`uninstall` は disable → 自分が書いた unit の削除 → daemon-reload → reset-failed。unit の正本は notecored クレートの `deploy/notecored.service` (生成マーカー入り、ExecStart と再起動しない終了コードを埋める) で、パッケージは `/usr/lib/systemd/user/` にコピーする。マーカーの無い既存 unit は上書きしない。systemd が無い環境と Nix store のパスは拒否する。`secrets keygen` は system unit の credential 用、`secrets purge` は notecored の secret (本体と鍵) だけを消す。今の `notemaid service` (unit の正本は `crates/notemaid/deploy/notemaid.service`) はこの形を引き継いでいる。

## AI Chat Streaming

チャットの 1 ターン (ユーザー入力 → 応答、途中の tool 呼び出しを含む) は **notemaid のターン実行器** (`crates/notemaid/src/ai_turn/`) が回す ([#1133](https://github.com/notedeck-dev/notedeck/issues/1133) 縦切り 1)。`DeckAiColumn` は `ai_turn_run` で開始し、`nd:ai-turn-event` をセッション store に投影するだけ。1 ラウンド (1 リクエスト分の SSE) の送受信は `ai_chat_service.rs` で、`ai_chat_send` (1 往復、tool なし) もこれを使う。

### 対応プロトコル (OpenAI 互換 / Anthropic Messages 互換)

`ai_turn_run` / `ai_chat_send` は `connection_id` を受け取り、Vault 接続から endpoint / API キー / `protocol` を解決して dispatch する。

| `ConnectionProtocol` | URL パターン | 認証 | プロトコル |
|----------------------|-------------|------|-----------|
| `anthropic` | `<baseUrl>/v1/messages` | `x-api-key` + `anthropic-version: 2023-06-01` | Anthropic Messages API (SSE: `content_block_delta` / `delta.text`) |
| `openai-compat` | `<baseUrl>/chat/completions` | `Authorization: Bearer <key>` | OpenAI Chat Completions 互換 (SSE: `data: {...}` + `[DONE]`)。OpenAI / OpenRouter / Groq / 自前ゲートウェイ等 |

endpoint は接続の `baseUrl`、API キーは Vault の secret slot `primary` から Rust 側で取得する。フロントは決してキー本体を持たない (詳細は [AI Credentials](#ai-credentials))。

**宛先の検査 (#1315)**: `resolve_connection` はキーを開く前に `baseUrl` を `ssrf::validate_external_url` (scheme / host の一次検査 / bad port) に通し、接続の `allowedHosts` が空でなければ host がその中に居ることを求める (空なら `baseUrl` の host だけ、`Connection::allowed_hosts` の規約)。止めたときは `_native.ai.endpointDenied` (host と理由) / `_native.ai.hostNotAllowed` (host) の文言で返す。ストリーミング client は長寿命なので DNS を pin せず、解決のたびに検証する `ssrf::ValidatingResolver` (メディアプロキシと同じ) と `no_proxy` を載せる。redirect は追わない (下記)。`vault_fetch` との差は「pin か都度検証か」と「redirect を追うか追わないか」だけで、拒む規則は同じ。ローカル接続 (`Connection::local`、#880) だけは `check_local_endpoint` (= `ssrf::normalize_loopback_url` が Some) で通し、許可ホストは見ず、secret 無しも許す (`api_key` は空文字。Anthropic 互換側も空なら `x-api-key` を送らない)。

**会話アフィニティ ID (#1160)**: 「会話ごとに安定した ID」を要求するプロバイダー (OpenCode の `x-opencode-session`。無いと 400 `MissingSessionID`) のために、1 リクエストは「どの会話の一部か」(`AiChatRequest::affinity`、`ai_affinity::ConversationKey`) を持つ。値を決めるのは会話を知っている層で、チャットのターン (round / 透過リトライ / continuation / チェックポイント再開 / タイトル生成を含む) は session ID、HEARTBEAT は接続ごとに固定、1 往復の `ai_chat_send` は呼び出しごとの stream ID。送る値は接続 ID + 鍵から導出した UUID v5 で生の session ID は出ず、フロント / 外部からは指定できない (wire に無い)。**どのヘッダーに載せるかは宛先ホストで決める**: 接続の `baseUrl` のホストが `connection_templates.json5` の `allowedHosts` に一致するテンプレの `affinityHeader` を使う (テンプレ id では引かない。既存の接続・手動追加・同じホストの別 API にもアップデートだけで効く)。AI ストリーミングの HTTP client は **redirect を追わない** (ホストをまたぐ redirect で API キーと会話 ID が持ち越されるため)。3xx はリダイレクト先ホストを含む明示エラー (`_native.ai.redirectNotFollowed`) になる。

### ターンのフロー

```
┌─ Vue (DeckAiColumn / useAiTurn) ─────────────────────────────┐
│ user + placeholder を session に積む                          │
│ デバイス文脈 (device_context) と発火した trigger skill を集める │
│ listen('nd:ai-turn-event') → commands.aiTurnRun(req)          │
│   req: principal / 履歴 / device_context / 生成パラメータ /   │
│        device_tools (plugin 由来) / tool_param_enums (実行時 enum) │
└──────────┬────────────────────────────────────────────────────┘
           │ invoke
           ▼
┌─ Rust (notemaid ai_turn::start_turn → drive) ────────────────┐
│ system = SOUL / USER / MEMORY / skill から組む (compose.rs)   │
│ granted = permissions.json5 の principal を解決               │
│ tools = 宣言表 (capabilities/generated.rs) ∩ granted + device_tools │
│ loop {                                                        │
│   1 ラウンド (SSE) → delta を emit、tool_use を貯める          │
│   tool_use が無ければ done                                     │
│   ラウンド上限なら done (stop_reason: tool_round_limit)        │
│   全件を認可 (宣言の権限 ⊆ granted。拒否はデバイスに投げない) │
│   確認の要否を決める (宣言の confirm / クロスアカウント /      │
│     confirmSkips の記憶。無人 HEARTBEAT は聞かずに拒否)        │
│   要る項目があれば: プレビューをデバイスに組ませ               │
│     ("ai/confirm-preview") → 1 枚の confirm_request を emit    │
│     → turn をチェックポイントに書いて解放 (ここで戻る)        │
│   for tool_use in 全件 {                                      │
│     exec: core なら notemaid の本体 (exec/) を直接             │
│     それ以外は bridge.query("ai/execute-capability", confirmed) │
│     tool_use / tool_result を emit、履歴に足す                 │
│   }                                                           │
│ }                                                             │
│ generate_title なら 1 往復でタイトルを作り title を emit      │
│ 失敗は error (phase: before_tool / after_tool)                │
└──────────────────────────────────────────────────────────────┘
           │ query / event
           ▼
┌─ Vue ────────────────────────────────────────────────────────┐
│ apiBridge 'ai/confirm-preview': capability の実装が組む       │
│   確認内容 (diff / 引数 / 帰属 / 理由) を返す。実行はしない   │
│   (exec: core の本文は capability_preview で notemaid が組む) │
│ useAiTurn → aiConfirmRequests: confirm_request を 1 枚の       │
│   ダイアログで出し、表示を伝え (aiConfirmShown)、決定を返す   │
│   (aiConfirmRespond)。「次から確認しない」は権限ファイルへ    │
│ apiBridge 'ai/execute-capability': 設定 / 権限を再読込 →      │
│   dispatchCapability(..., { preConfirmed })。capability 本体  │
└──────────────────────────────────────────────────────────────┘
```

- **1 ラウンドの複数 tool_use は全部順に実行する** (以前の JS ループは先頭以外を捨てていたので provider 側で並列を禁止していた。今は禁止しない)
- **認可は notemaid で決める**: tool 一覧の絞り込みと呼び出しごとの権限検査は Rust。デバイス側の dispatcher は同じ判定を写しとして二重に通す (golden で一致を検査)
- **確認要求は notemaid 発** (`ai_turn/confirm.rs`): 要否 (宣言の `confirm` / クロスアカウント / `confirmSkips` の記憶) は Rust が決め、表示内容は capability の実装がデバイスで組む。1 ラウンドの複数の呼び出しは 1 枚の要求に束ね、決定は全項目に効く。要求を出したループは turn を**チェックポイント** (`<app dir>/state/notemaid/turns/`、0600、notemaid 専有で生ファイル書込の対象外) に書いて解放し、応答で読み戻して再開する。表示してからの TTL と生成してからの絶対 TTL のどちらかを超えると拒否して理由を記録し、応答は compare-and-set で最初の 1 つだけが効く (遅れた応答は明示エラー)。起動時に停止中のまま残った turn は「再起動」の理由で閉じる。無人 HEARTBEAT は確認が要る呼び出しを聞かずに拒否する
- **セッションは notemaid が単一の書き手** (`ai_sessions.rs`): ターン実行器がユーザー入力 / tool_use / tool_result / 最終応答 / 失敗の partial をその場で書く。メッセージ id は turn id から決定的に振り (ユーザー入力は `<turn>-u`)、イベントの `message_id` でデバイスが写しを揃える。デバイスの表示用 placeholder はローカルだけで、ターンの終わりに読み直す。HEARTBEAT の使い捨て履歴は `session_id` 無しで書かない
- **汚染 (taint)** (`ai_turn/taint.rs`、#1103 Phase 1): 宣言 `untrusted: true` の capability (他人の投稿 / プロフィール / 通知 / fetch 結果を返す読取) の結果を読んだセッションと、デバイスが「文脈に他人の内容 (可視ノート) を入れた」と申告したターンのセッションは以後 tainted (`state/notemaid/turns/taint.json`、生ファイル書込の対象外)。tainted なセッションの書き込みは「次から確認しない」を無視して必ず確認する。**宛先の出所**: 宣言 `destinations` の引数 (返信先 / 対象ユーザー / URL など) の値がどこに出てきたかを 3 値で判定する (ユーザー入力 / 信頼済みの結果 / untrusted な本文の中だけ。どこにも無い値も 3 番目に倒す)。3 番目なら確認に「宛先は AI が読んだ他人の内容に由来します」と一文添え (旗は足さない)、記憶の対象外にし、無人実行は聞かずに拒否して理由を記録する。**メモ / skill のラベル**: tainted なセッションからの書込 (実行要求の `tainted`) で作った / 更新したメモと skill には `tainted: true` の frontmatter が付き (一度付いたら外れない)、それを返す読取 capability は `ctx.markTainted()` で申告して読んだセッションを tainted にし、system prompt に注入するときはデバイスが文脈の申告 (`contextUntrusted`) に含める。[#1162](https://github.com/notedeck-dev/notedeck/issues/1162) で turn 内の汚染 2 ビットと「人が承認した人格 / 記憶ファイルへの書込にはラベルを付けない」例外を足した (詳細は「AI の人格と記憶」)
- **中断** (`ai_turn_cancel`): Rust の task を止め、確認待ちなら要求を cancelled で閉じて (デバイス側はダイアログを畳む)、デバイスが待っている実行要求の確認 (保険の経路) も `AbortSignal` で閉じる。途中までの応答は notemaid がセッションに書いて返し、デバイスは写しに載せる。**中断するのは利用者の「停止」とセッションの削除だけ**: 進行中のターンの状態 (投影 / 再試行コンテキスト) はセッション単位でモジュールが持ち、AI カラムを閉じてもセッションを切り替えても投影は続く。開き直したカラムは同じセッションの状態をそのまま見る (#1371)。写しが読み直されて placeholder が消えても、生成中のメッセージは投影の側が持っていて戻す。応答中のセッションは一覧にスピナーで出し (`isAiTurnRunning`)、そのセッションを表示している画面が無い / アプリが隠れている間に終わった応答 (done / error) はアプリの通知に残して押せばセッションを開く (`onFinishUnseen`)。投影はターンを始めたウィンドウが持つので、そのウィンドウを閉じると途中経過は他のウィンドウに出ない (notemaid は走り続けて結果をセッションに書く)。AI カラムはセッションを開くたびに notemaid から読み直すので、結果はそこで見える
- **失敗の段階**: `before_tool` (tool 未実行) なら user + placeholder を外して再送、`after_tool` (実行済み) なら placeholder だけ外して継続モード (`continuation: true`、system 末尾に切断通知)。実行済み write capability を二重実行する経路は構造的に無い (#737)
- **デバイス文脈はスナップショット**: 可視ノート / vault の開示状態はターン開始時に 1 回だけ組む (以前はラウンドごと)
- **WebView なしのハーネス**: provider (`ProviderRound`) とデバイス (`FrontendBridge`) と権限 (`GrantedSource`) は trait で受けるので、`ai_turn/` のテストは偽 provider + 偽デバイスで複数ラウンドのターンを走らせる

`turn_id` で複数列の並行ターンを区別する。1 往復だけの用途 (`ai.chat` capability、HEARTBEAT 報告先のタイトル) は `ai_chat_send` + `nd:ai-chat-event` (`stream_id`) のまま。

### Frontend composables

| ファイル | 役割 |
|---------|------|
| `src/composables/useAiTurn.ts` | ターンの投影: `run(req)` で `ai_turn_run` を開始し、`nd:ai-turn-event` を session の placeholder / tool_use / tool_result に投影する。`cancel()` / `retryContext` / `prepareRetry()`。チャットと HEARTBEAT が共用 |
| `src/composables/aiConfirmRequests.ts` | notemaid の確認要求の表示と応答。複数項目を 1 枚に束ね、表示を伝え、「次から確認しない」を権限ファイルへ減算してから応答する |
| `src/composables/aiTurnExecutions.ts` | ターン単位の実行要求の台帳。中断時に実行要求側の確認 (保険) を `AbortSignal` で閉じる |
| `src/capabilities/deviceTools.ts` | 宣言表に無い AI tool (plugin 由来) と実行時 enum をターン要求に同梱する |
| `src/composables/useAiChat.ts` | `sendMessage(opts)` で 1 往復の chat 呼び出し (tool なし)。`currentText` ref が delta で更新される。`cancel()` で進行中 stream を中断 (Rust 側 `ai_chat_cancel` 経由) |
| `src/composables/useAiConversation.ts` | 指定 sessionId のメッセージ配列に対する reactive な参照を返す薄いラッパー。本文の永続化と debounce は `useAiSessionsStore` 側で集中管理 |
| `src/stores/aiSessions.ts` | AI セッション (`data/sessions/<YYYYMMDDhhmmss>.json5`) のデバイス側の写し。書き手は notemaid (`crates/notemaid/src/ai_sessions.rs`、#1133) で、ストアは「作成 / メッセージ追加 / メッセージ削除 / 改名 / trigger skill の累積 / 削除」の構造化された操作を送って写しを揃える (楽観的更新)。進行中のターンの表示は `setLocalMessages` (notemaid には書かない)。汎用の設定ファイル操作は `sessions` を受け付けない |
| `crates/notemaid/src/ai_turn/compose.rs` | system prompt の組み立て (#1162)。SOUL → キャラクター (persona) → USER → BOOTSTRAP → MEMORY → NoteDeck の運用規約 (固定の文) → AGENTS → 他の `mode: 'always'` / active な `mode: 'manual'` / セッションに累積した trigger skill → デバイス文脈。デバイスは `device_context` (`<notedeck-context>`) と trigger skill の id だけを送り、trigger マッチは `triggerMatchingSkillIds(text)` (`src/stores/skills.ts`) が user 入力を部分一致検索して算出 |
| `src/services/aiSessionId.ts` | Zettelkasten ID (`YYYYMMDDhhmmss`) 生成。同一秒衝突は `a`, `b`, `c`, ... サフィックスで回避 |
| `src/services/sessionTitle.ts` | `timestampTitle(now, suffix)` 初期プレースホルダー / `generateSessionTitle()` 決定論的フォールバック。i18n の既定接尾辞を足す包みが `src/utils/aiSessionTitle.ts` |

### セッション管理 UI (DeckAiColumn)

`DeckAiColumn` は単一カラム内の master-detail で動作する:

- **viewMode = 'sessions'**: セッション一覧 (グループ: 今日/昨日/過去 7 日/それ以前)、検索バー (タイトル絞込)、行ホバーで rename / delete インラインボタン
- **viewMode = 'chat'**: 選択中セッションのメッセージ表示 + 入力欄。ストリーミング中は送信ボタンが停止ボタンに切替

セッションはカラムから独立した**グローバル資産**で、`column.aiCurrentSessionId` が「現在表示中の sessionId」を保持する。`null` ならセッション一覧を表示。同じ sessionId を 2 カラムで開いても破綻しない (`useAiSessionsStore` 経由で書込先は 1 ファイル)。

セッションタイトルは初回 round (user 発話 → assistant 応答) 完了後に AI で自動生成される (ターン実行器が `generate_title` で完了後に 1 往復し、`title` イベントで返す)。失敗時は `timestampTitle` (`<YYYY-MM-DD HH:mm> のチャット`) がそのまま残る。会話は 1 つの user メッセージに集約して投げる (Anthropic は last message が assistant role だと続行扱いになるため)。届く前にユーザーが手動 rename していたら上書きしない。

### エラー UI

| 状況 | 表示 |
|------|------|
| 401 / 403 | 「APIキーが無効です」(設定画面誘導) |
| 429 | 「レート制限に達しました」 |
| 5xx / network | サーバーエラー / 接続失敗 |

エラーは最後の assistant メッセージに `⚠️ <message>` として表示し、履歴にも保存される。

## 手元の CLI を AI にする — ACP ([#1104](https://github.com/notedeck-dev/notedeck/issues/1104))

ログイン済みの Claude Agent (Claude Code) / Codex / OpenCode / Hermes Agent / Grok Build を、API キー無しで AI カラムの provider にする面。CLI は ACP (Agent Client Protocol) を stdio で話す子プロセスで、**notemaid が抱える** (本体は `crates/notemaid/src/acp/`)。CLI が持つ資格情報には触れず、公式 CLI か公式アダプタをそのまま起動するだけ (規約の線引き)。

- **接続の 1 種**: 接続 id は `harness:<id>`。組み込みの一覧 (`acp/harness.rs`) は PATH で検出し、AI 設定の接続ピッカーに「手元の CLI」として並ぶ (`commands.aiHarnessList`)。利用者は ai.json5 の `harnesses[]` に自分のコマンドを足せる。`resolveAiConnection` は `kind: 'vault' | 'harness'` の直和を返し、呼び出し側は `connectionId` だけ使う
- **ターン実行器はそのまま**: `AcpProvider` は `ProviderRound` の実装で、1 ラウンド = CLI の 1 ターン。NoteDeck のセッションごとに ACP セッションを 1 つ持ち (`Registry`)、新規セッションの初回はそれまでの会話と context を prompt に畳み、以降は最新の入力だけ送る。`session/update` の `agent_message_chunk` は `delta`、`tool_call` / `tool_call_update` は `ai_turn::external` が通常経路と同じ `tool_use` / `tool_result` のカード (採番・セッション書込も同じ) に写す。CLI は tool を並列に走らせるが、デバイスの写しは「tool_use の次はその tool_result」の順しか扱えないので 1 件ずつに直列化し、表示中に届いた本文は tool_result の後に流す。NoteDeck の MCP tool は `mcp__notedeck__` などの接頭辞を剥がして通常経路と同じ tool 名 (`notes_search` の形) で見せる。タイトル生成は行わない (CLI のセッションを汚す)。1 往復の経路 (`aiChatSend`) は harness を受けない
- **capability は MCP で渡す**: セッション開始時に橋 `api-token/issue` で harness 種別の永続トークンを発行し、`POST /mcp` の URL と一緒に `session/new` の `mcpServers` に載せる。CLI の tool 呼び出しは MCP サーバー (#555) を通り、認可と汚染は同じ dispatcher で効く。**principal は ai.chat** (AI 設定の権限「AI チャット」に従う): CLI は利用者が AI として選んだ本人であって第三者ではないので、外部アプリ用トークンの external principal にはしない ([#1188](https://github.com/notedeck-dev/notedeck/issues/1188)。external だと `ai.memory.write` / `skills.write` / `ai.persona.write` / `tasks.run` / `backup.create` が preset に関わらず恒久 deny になり、CLI 自身のファイル編集も下で拒否しているため記憶を書く手段が無くなる)。**CLI からの記憶と人格への書込は毎回確認する** ([#1351](https://github.com/notedeck-dev/notedeck/issues/1351)): CLI が自前の道具で何を読んだかは追えないので、他人の本文を読んだ後のセッションと同じに扱い、`ai.memory.write` / `ai.persona.write` の capability は「次から確認しない」の記憶を見ない・出さない (`DispatchOptions.viaHarness`)。それ以外の書込 (投稿など) は、ほかの経路と同じく「次から確認しない」で省略できる (CLI 経由の書込全般を毎回確認にする案は、使い勝手に見合わないので採らない)。CLI の tool 一覧から外す案は採らない (#1188 の袋小路に戻る)。宣言表の `alwaysConfirm` (`soul.propose`) は経路に関わらずデバイスの dispatcher でも記憶を見ない。トークンは notemaid / アプリの終了時に橋 `api-token/revoke` で失効 (`acp::shutdown_all`)。**確認つきの capability は人の承認を待つ**ので、`/mcp` の実行待ちの上限は人のペース (`http_server::CAPABILITY_EXECUTE_TIMEOUT`) にし、CLI 側の MCP tool のタイムアウトも同じ値を環境変数 (`MCP_TOOL_TIMEOUT`、Claude Code が見る。利用者の設定があればそちら) で子プロセスに渡す。短いと CLI には失敗と返るのに NoteDeck は承認後に実行して「後から反映される」になる (#1188 の点検で判明)
- **許可要求は確認ダイアログ**: `session/request_permission` のうち **NoteDeck の MCP tool への要求は、その段階で NoteDeck 自身に確認させる** ([#1191](https://github.com/notedeck-dev/notedeck/issues/1191)。`notedeck_capability_request`: tool 名は CLI の申告で出自の証明にならないので、`kind` が `other` / 省略で `locations` を持たないときだけ NoteDeck の tool と見なす。保護パスの拒否はそれより先に効く)。notemaid は橋 `acp/confirm` でデバイスに (capability id, 引数, ai.chat) を渡し、デバイスの dispatcher が `confirmOnly` で権限の判定と標準の確認ダイアログ (通常経路と同じプレビュー) を済ませ、承認なら `services/acpPreapproval` に記録する。直後の同じ tool 呼び出し (MCP → `capabilities/execute`) はその記録を 1 回だけ消費して `preConfirmed` で通るので 2 度聞かない。記録が無い呼び出し (CLI 側で許可要求が省かれたとき) やデバイスに届かないときは従来どおり実行時に確認する。人の承認を MCP tool のタイムアウトの内側で待たないための形 (以前は実行時にだけ確認していて、CLI には timed out と返るのに承認後に反映されていた)。CLI 自身の tool (ファイル編集 / コマンド実行など) への要求は `confirm::live_register` で即答型の確認要求 (チェックポイント無し、`capabilityId: acp.permission`) としてフロントの `confirm_request` に出す。見た目は通常経路の汎用プレビュー (`exec::preview::generic`) に揃え、「<CLI> が <tool> を実行しようとしています」+ 引数の JSON + 「実行」ボタン (文言は `_native.acp.permission`)。答えは ACP の `optionId` (allow / reject) に写像する。人格 / 記憶のファイルに触る要求 (rawInput の文字列の途中に埋まったパスも含む) は聞かずに拒否し、失敗した tool_result として残す。ターン中断で `session/cancel`
- **規約で線を引いたもの (2026-09-30 調査)**: Gemini CLI は選べない (`blocked`)。個人の Google ログインは 2026-06-18 に廃止され、Gemini CLI の OAuth を第三者ソフトから使うことは google-gemini/gemini-cli の規約文書が違反と明記している。Claude Code の表示名は「Claude Agent」 (Anthropic は Agent SDK 製の製品が "Claude Code" を名乗ることを認めていない。接続 id `harness:claude-code` は保存済みなので変えない)。OpenCode / Hermes Agent を選んだときだけ「Claude はこの経路でなく Claude Agent で」と一文出す (中で Claude のサブスクへ繋ぐのは Anthropic の規約違反)。トークンに触れない・無人で回さないのは全社共通の線
- **CLI は利用者の環境のまま動かす (隔離しない)**: 環境変数とホームは差し替えず、足すのは `MCP_TOOL_TIMEOUT` だけ (`acp/client.rs`)。CLI が利用者全体に持つ記憶・設定・MCP サーバー・skill はそのまま効く。利用者が AI として選んだ本人なので、普段の使い勝手を削ってまで切り離さない。作業フォルダは NoteDeck 専用 (`state/notemaid/workspace`) なので、別のフォルダに紐づく記憶と過去の会話は見えない。CLI 自身の記憶機能がこの作業フォルダに紐づけて溜めるものは、NoteDeck の記憶 (MEMORY.md) とは別物で、NoteDeck の確認と保護の外にある
- **やらないこと**: HEARTBEAT はこの経路で回さない (`AiConfigLite::heartbeat_provider` が `harness:` を「provider 無し」にする。巡回だけ別の接続を選べる、#1321)。モバイルは対象外。CLI のセッション読み込み (`session/load`) と fs / terminal の提供は未 (-32601)。実機での確認は `cargo test -p notemaid acp::client::live -- --ignored` (CLI の契約を 1 リクエスト使う)

## MCP サーバー ([#555](https://github.com/notedeck-dev/notedeck/issues/555) / [#513](https://github.com/notedeck-dev/notedeck/issues/513))

外部の AI エージェント (Claude Code / Codex / Cursor など) が動作中の NoteDeck の capability を tool として呼ぶ面。内蔵 HTTP サーバーの `POST /mcp` (Streamable HTTP、JSON-RPC を JSON で返す。状態なし、サーバー発のストリーム無し、GET は 405) で、本体は `crates/notecore/src/mcp.rs`。

- **tool の集合と schema は AI プロバイダーに渡すものと同じ** (宣言表の `ai_tool` な capability、名前は `.` を `_` にした形、schema は `capabilities::input_schema`)。実行は既存の `capabilities/execute` (橋 → デバイスの dispatcher) なので、認可 (呼び手の principal、#712) と汚染 (#1103) は HTTP の `/api/capabilities/{id}/execute` と同じ 1 か所で効く。tool の失敗は JSON-RPC のエラーではなく `isError` の結果 (dispatcher の `code: error` をそのまま文面に)
- **認証は HTTP API と同じ Bearer**。principal は永続トークンの種別 (`api_tokens::ApiTokenKind`) が決める: 権限ウィンドウの「外部アプリ」で発行したトークンは external、ACP (#1104) のために notemaid が発行する harness 種別は ai.chat ([#1188](https://github.com/notedeck-dev/notedeck/issues/1188))。権限ウィンドウでトークンを発行すると、Claude Code 向けの登録コマンド (`claude mcp add ... --transport http`) が一緒に出る。外部アプリ用のトークンは発行時に **トークン単位の scope** (PermissionsConfig と同じ形、`api-tokens.json` の `scope`) を持ち、実効権限は「external の権限 ∩ scope」(`permissions_profile::resolve_scoped` / TS の `resolveProfiledIn(file, id, tokenScope)`、golden で一致検査)。Rust が検証したトークンの正体 (id / 名前 / scope) は `PersistentTokenMarker` (request extension) と `capabilities/execute` の `token` で運び、dispatcher は `{ kind: 'external', tokenId, tokenName, tokenScope }` を組む。確認ダイアログ / Spotlight / メモの著者 (`token:<id>`) にはトークン名が出る。scope の無いトークン (導入前に発行 / harness) は絞らない。失効はトークンの `until_revoked` で `/api/events` の応答本文を打ち切る ([#1292](https://github.com/notedeck-dev/notedeck/issues/1292))
- 永続トークン gate の対応表では `/mcp` は免除 (tools/list は静的 metadata、tools/call は dispatcher が enforce)。OpenAPI には載せない (JSON-RPC のため)。単体テストは `mcp.rs` (版の交渉 / 一覧 / 実行の写像 / 通知と batch)
- ACP (#1104) で手元の CLI を抱えるときは、この URL とトークンを CLI に渡すだけで NoteDeck の capability が使える

## AI の人格と記憶 — ワークスペースファイル ([#1162](https://github.com/notedeck-dev/notedeck/issues/1162))

notemaid の売りは人格なので、人格と記憶は OpenClaw / Hermes Agent 流の**固定名の markdown**で持つ。ファイルが正本で、人が読み書きでき、AI 自身も認可と汚染の規則の下で更新する。設計は 4 視点 (安全 / アーキテクチャ / 上流への忠実度 / 製品) の敵対的レビューを 2 巡回して 2026-09-30 に確定した (正本は issue の「設計 v4」コメント)。**2026-10-01 に段階 1〜6 (notemaid 側 / capability / デバイス側 / UI / バックアップ / 手元の CLI) を develop に入れた**。実機確認は未。ここには確定した設計と、実装で決まった細部を書く。語彙と挙動は上流に寄せ、逸脱は NoteDeck の不変条件 (汚染 #1103 / principal 認可 #712 / notemaid の所有 / 無人の予算) が要求する所だけ。逸脱は理由ごと残す。

### ファイルと置き場

```
<app data>/
  data/notemaid/            # 人格と記憶。書き手は notemaid だけ (UI の編集も notemaid の RPC 経由)
    SOUL.md                 # 人格の核 (キャラクターを切り替えても変わらない)
    USER.md                 # 相手について。OpenClaw user-model の形式。上限つき
    MEMORY.md               # AI の覚え書き: 小さな耐久事実と決定 (索引ではない)。上限つき
    BOOTSTRAP.md            # 初回だけ (OpenClaw と同じ)。条件を満たしたら notemaid が消す
  state/notemaid/           # notemaid のこの機械の状態 (同期・バックアップの対象外)
    turns/                  # checkpoint, taint.json, budget.json, heartbeat.json
    workspace/              # 手元の CLI の cwd
  config/skills/
    AGENTS.md               # 予約 skill: id / ファイル名 / mode: always 固定、削除・改名・toggle 拒否。notemaid が案内のコメントだけのテンプレで seed
    HEARTBEAT.md            # 予約 skill: mode: heartbeat 固定。既定では置かず「巡回の手順を編集」で初めて seed
```

配置はデータディレクトリの再編 ([#1334](https://github.com/notedeck-dev/notedeck/issues/1334)) 後のもの。再編前は 3 つとも `notedeck/` の下 (`notedeck/notemaid/` に人格と記憶と `turns/` `workspace/` が同居) で、場所を知るのは `Layout` だけ (人格と記憶は `notemaid::workspace::dir`、状態は `Layout::notemaid_state`)。

- ディレクトリ名は種類名の複数形 (`memos` / `skills`) ではなく所有者名 `notemaid` (「1 つの名前 = ディレクトリ = パッケージ = バイナリ」)。`<config dir>/notemaid/` (secret の鍵) とは別物
- HEARTBEAT.md / AGENTS.md は `skills/` の**予約 skill**。既存の capability / 認可 (`skills.write`) / 汚染ラベル / バックアップ / skill UI がそのまま効き、ローダーが 2 系統にならない。予約の強制は notemaid の `skills.rs` と、notecore の汎用設定ファイル書込 (該当名の rename / delete 拒否。notecore はファイル名の定数を知るだけ) の 2 か所
- OpenClaw の TOOLS.md は AGENTS.md に書けばよい (専用の節は置かない)。IDENTITY.md は SOUL / キャラクター (persona) に内包 (Hermes と同じ)。日次ログは作らない (メモ + セッション)
- **手元の CLI の cwd を人格ファイルと同じ場所にしない (不採用)**: cwd を `notemaid/` にすると Codex / Claude Code が AGENTS.md を自動で読む利点があるが、CLI は自前のファイル操作を持つので認可と汚染規則を通さず書き換えられる。`notemaid/` に AGENTS.md を置かないので祖先探索でも拾わない。CLI の fs 書込要求が人格と記憶の場所 (`data/notemaid/`) か notemaid の状態 (`state/notemaid/` の `workspace/` 以外) に触るなら ACP の permission 中継で人に聞かず自動拒否し (2 つは再編後は別の場所なので、作業場所からは導かず配置の正本 `Layout` から求める、#1351。字面の一致に加えて、作業場所からの相対パス・`..`・`cd` 先・`~/`・シンボリックリンクを解いた先も見る。判定は文字列からの推定で、コマンドが実行時に組み立てるパスまでは追えない)、notemaid は自分の書込ごとに人格・記憶ファイルの hash を記録して turn 開始時に不一致なら「外部で変更されました」を 1 行出す

### 注入の契約

- **組み立ての所有者は notemaid 一本。** デバイスが送るのは `device_context` (`<notedeck-context>`) と、その turn で新しく発火した trigger skill の id だけ。persona (session ファイルの `personaSkillId`、HEARTBEAT は ai.json5) / active な manual skill / 累積の trigger は notemaid が読み、`<persona>` ブロックも notemaid が書く
- notemaid が組んだ system は `TurnState` に保持し、ラウンドの再送 / `ProvenanceCorpus` / 予算見積り / checkpoint はそこを読む。**スナップショットの単位は turn run** (turn 開始時に読み、tool 反復 / 継続 / 再開では同じ文字列)。OpenClaw の「毎 run 再構築」と同じで、Hermes の「プロセス寿命の凍結」はセッションが無期限に再開される NoteDeck には持ち込まない。例外は手元の CLI (ACP セッション作成時に畳んだものが続く)
- 順番: SOUL → キャラクター (persona) → USER → BOOTSTRAP (残っている間だけ) → MEMORY → NoteDeck の運用規約 (固定の文) → AGENTS → 他の always / trigger skill → device_context。Hermes 寄り (SOUL が先頭。OpenClaw は AGENTS が先頭)
- 使用率ヘッダは Hermes と同じく凍結ブロックの中に入れる (内容から決まるので prefix cache は壊れない)
- `ProvenanceCorpus` には workspace 部分 (SOUL / USER / MEMORY / AGENTS) と store 由来の skill を**入れない** (trusted にも user にも)。そこにしか無い宛先は untrusted に倒れる (tainted な turn で承認された記憶の宛先が、次の turn で trusted になり無人の宛先検査を素通りする経路を塞ぐ)
- HEARTBEAT: system は SOUL → キャラクター → USER → MEMORY → AGENTS → 固定 INSTRUCTION、**HEARTBEAT.md の本文は user 側の heartbeat メッセージ**に付ける (OpenClaw が scratch を user message に置くのと同じ)。device_context は無し。橋 `heartbeat/context` は廃止 (時刻は notemaid、口座は SyncedAccounts)。固定 INSTRUCTION は OpenClaw の既定に合わせる (「HEARTBEAT.md があればそれに従う / 過去のチャットから古い仕事を推測・反復しない / 何も無ければ `heartbeat.report` を呼ばない / 通知本文に USER の内容を書かない」)。**HEARTBEAT.md が無い、または heartbeat mode の skill 本文がすべて実質空なら tick を skip** (実質空 = OpenClaw の `empty-heartbeat-file` の定義: 空行 / コメント / 見出し / fence / 空のチェックリスト + frontmatter)。OpenClaw は scratch が無くても走ってモデルに任せるが、NoteDeck は無人の予算のため skip する (逸脱)。有効なのに空のときは HEARTBEAT セクションと heartbeat session に「巡回の手順が空です」を出し、予算で見送った tick は「巡回を見送りました (予算)」を 1 行
- 入口は `start_turn_with_sink` 一本。タイトル生成と `aiChatSend` には入れない
- どの種類のセッションに入れるか: chat / command / task / heartbeat すべてに全部。external / MCP principal には一切出さない。手元の CLI への USER.md は既定 on (CLI は利用者が AI として選んだ本人なので API 接続と同じ。AI 設定「メモリー」の「手元の CLI にも渡す」で切れる。2026-10-06 に「ACP」セクションの opt-in から移した)。OpenClaw は cron / subagent / group に USER / MEMORY を出さないが、NoteDeck の全セッションは同じ本人の私的なものなので入れる (逸脱)
- `dataSources.memos` (更新の新しい順に上位 N 件 + リンク展開) は**廃止**。常駐するのは MEMORY.md だけで、生のメモは `memos.search` / `memos.list` で必要なときに読む (上流と同じ)。`excludeTags` は注入専用の設定だったので capability 側へは移さず、注入と一緒に削除した (`memos.search` / `memos.list` に相当する絞り込みは無い)
- 上限の単位は文字数 (bytes は CJK が 1/3 になる)。人が書く SOUL / AGENTS は注入コピーを切り詰めて marker (OpenClaw)、tool が書く USER / MEMORY は書込エラーで AI に整理させる (Hermes)。外部エディタで超過させた分は切り詰めず「超過したので注入しない」を AI に伝える

### AI 自身の編集 (capability と認可)

| 対象 | capability | 権限キー | 確認 |
|---|---|---|---|
| USER.md / MEMORY.md | `memory.update` 1 本。params は Hermes の memory tool と同形 `{ action: add \| replace \| remove, target: user \| memory, content?, old_text? }`。`replace` / `remove` は一意な部分文字列で当て、曖昧ならエラー。完全重複の add は no-op | `ai.memory.write` (`aiInstruction` + `thirdPartyDeny`。presets は safe / full) | confirm。「次から確認しない」の記憶キーに `target` を混ぜる (宣言表の `confirmKeyParams`) ので USER と MEMORY で別々 |
| SOUL.md | `soul.propose` (全文の置換案) | `ai.persona.write` (既存) | **常に確認** (宣言表の `alwaysConfirm`、Rust 側で skip を無視)。未依頼の提案は禁止 |
| AGENTS.md / HEARTBEAT.md | 既存 `skills.append` / `skills.replaceSection` | `skills.write` | 既存どおり。OpenClaw の `heartbeat_respond(scratch)` (AI が scratch を自己更新) は無人書込の拒否と整合しないので採らない |

- 戻り値は Hermes と同形 `{ success, error, current_entries, usage }` (turn 内は prompt が凍っていて自分の書込が見えないため)。同一 turn の書込回数上限は置かない (Hermes は同 turn 内で整理して再試行する前提)
- SOUL / USER / MEMORY の読取 capability は作らない (prompt に入っている)。書込前の検査は不可視 Unicode と上限がエラー、Hermes 流の injection / exfil パターンは**確認強制** (拒否ではない。誤検知が害にならない形)
- 「記憶の整理は過去セッション (untrusted) を読まずメモから。詳しくは `memos.search`」「覚えるのは事実と指示だけ」「通知の本文に相手について覚えていることを書かない」は **notemaid の固定の文** (`compose.rs` の `OPERATING_RULES`) として毎 turn 入れる。当初は AGENTS.md の初期テンプレに書いていたが、利用者が消すと効かなくなる安全側の規約を編集できるファイルに置くのは筋が悪いので移した (2026-10-09)。AGENTS.md は利用者の常設の指示 (話し方や避けてほしいこと) だけを書く場所で、案内のコメントだけの初期状態 (実質空) のあいだは何も渡さない。旧テンプレのまま手付かずのファイルは、組み立てのときに新テンプレへ置き換える

### 汚染 (#1103) との整合

- **turn 内の汚染を 2 ビット**で導入する (既存の汚染はセッション単位で、session の無い HEARTBEAT は untrusted を読んでも tainted にならなかった)。`confirm_forced` (skip の記憶を無視して必ず確認) と `label_writes` (メモ / skill にラベル)。`context_untrusted` / untrusted な capability の非エラー結果 / `outcome.tainted` は両ビット、**store 由来 (`store_id` 付き) の skill が文脈にあれば `confirm_forced` だけ** (全 capability の skip を止めるが、ラベル伝播で全セッションを汚さない)。継続 turn は前 turn の値を引き継がず、`TurnState` に持って checkpoint で再開後も維持。intent event の `reason` に乗せてセッションファイルに永続化し、`runIntent` はそれを読む
- 有人 (チャット) で tainted のときの USER / MEMORY 書込は**確認強制** (拒否ではない。TL や通知を読むのがこのアプリの主用途で大半のセッションが早々に tainted になる)。**人が承認した項目には汚染ラベルを付けない** (メモと違う点。常に注入されるファイルにラベルを残すと以後の全セッションが汚染される。#1103 の例外規定)
- 無人 (HEARTBEAT) からの SOUL / USER / MEMORY 書込は拒否 (intent カードにもしない)。MEMORY の整理は提案まで
- 確認カード (USER / MEMORY の書込と SOUL 提案) は束ねず 1 枚 1 件 (束ねると diff が落ちる)。人間語の差分 1 行、汚染源 (「このセッションで読んだ他人の内容: …」)、store skill が理由なら専用の一文 (自分で選んだキャラクターを「他人の内容」と言わない)、項目本文が untrusted の本文にだけ現れる文と一致したら赤字、本文は生テキストで描画。「次から確認しない」のチェックは tainted な turn では出さない
- 読込 (注入) は tainted なセッションでも外さない (途中で人格と記憶が消える方が悪い)。注入で USER.md の内容を投稿に流す経路は、投稿系が tainted で確認強制になることで受ける
- `taint.json` の移行は fallback ではなく新旧の union (安全側)

### 初回とテンプレ

- テンプレは `crates/notemaid/templates/<lang>/` の素の markdown (`lint:i18n` の対象外)。言語は notemaid が `locale.json5` + OS locale から決める。1 回書いたら利用者のファイル
- SOUL.md テンプレは OpenClaw の SOUL テンプレの見出し (Core Truths / Boundaries / Vibe / Continuity) に沿い「意見を持つ / 迎合しない / 簡潔」を核に。末尾は「変えたいときは提案して承認をもらう」
- USER.md は OpenClaw user-model の形式 (`<!-- observed: YYYY-MM-DD | status: active -->` + `- Prefer / Always / Never …`)。変わったら旧項目を `superseded` にして書き直す。話し方の好みもここ。「評価・同意は書かない、事実と指示だけ」は書込規則と SOUL の核で受ける。MEMORY.md は自由な markdown の箇条書き
- **BOOTSTRAP.md** (OpenClaw の first-run ritual): 儀式の主役は AI 自身の名前と雰囲気 (→ SOUL 提案)、相手については呼び方だけ聞く (最初に個人情報を集めない)。存在する間は注入するが「頼まれたときだけ儀式を始める。未依頼で聞かない (chat でも HEARTBEAT でも)」を本文に書く。削除条件は OpenClaw の fallback と同じ「SOUL.md か USER.md がテンプレと違う」+ 「あなたのことを覚える」を OFF にしたとき
- 起点は AI カラムのセッション一覧の空状態に置くローカル文の挨拶 + ボタン「呼び方を教える」(AI を呼ばずに出せる)。再入口は「あなたについて」カードの空状態。USER OFF のときは隠す
- 記憶の自動保存 (Hermes の post-turn review / OpenClaw の compaction 前 flush) は入れない (無人の別 turn は予算に効く)。セッション切替時の催促も作らない

### UI

- 一般側の面は 2 セクション 3 枚: セクション「ペルソナ」に **「人格」** (SOUL の状態とヒントだけ。本文の編集は開発者モードの AI 設定「SOUL.md」タブ = Markdown のコード編集か外部エディター。設定画面の textarea で markdown を直接触らせると見出しの構造を壊すので置かない、[#1186](https://github.com/notedeck-dev/notedeck/issues/1186)) + キャラクターのカード (persona ピッカー) / セクション「メモリー」に **「あなたについて覚えていること」** (本文、行の inline 編集と削除、トグル「あなたのことを覚える」と「手元の CLI にも渡す」、「すべて忘れる」) と **「覚え書き」** (本文、行の inline 編集と削除)。AI 設定の「接続」と「ACP」(手元の CLI) も別セクション。候補から選ぶカード (接続 / AI プロバイダ / ACP / キャラクター / ペット) は共通の `ChoiceCard` + `ChoiceCardGrid`
- **USER OFF の意味** = 注入停止 + `memory.update` の `target: user` を本体が拒否 (tool 一覧からは外さず、エラーで知らせる) + 定数 1 行「利用者に関する記憶は OFF」を system に + MEMORY の書込規則に「本人に関する事実は書かない」。削除はしない (「すべて忘れる」が別)。OFF 中もバックアップには入る旨を説明文に
- ファイル名は UI に出さない (「設定フォルダを開く」で見える。OpenClaw は Settings → Files で編集、Hermes はパスを直接教える。これは製品判断)。使用率バーは出さず、上限に近いときだけ 1 行。書込の tool カードは人間語の差分 1 行、「覚えました」トーストは作らない
- 予約 skill は配布物ではなく AI の土台なので**スキルカラムには出さない** (2026-10-09。サイドロードに並んで利用者が入れたスキルのように見えていた)。編集の入口は AI 設定: ペルソナの「ルール」(AGENTS.md、`maid_agents_seed` で無ければ置いてから skill エディタで開く) と HEARTBEAT セクションの「巡回の手順を編集」(HEARTBEAT 有効時だけ)。mode と名前は固定のまま
- 「送った system prompt」は開発者モードのウィンドウ (Raw JSON インスペクタと同族)。入口はメッセージ / tool カードのメニュー。メモリ保持のみで永続化しない (sessions/ に写すとバックアップにも複製される)

### 移行・バックアップ・RPC

- `ai-turns/` → `notemaid/turns/`、`ai-workspace/` → `notemaid/workspace/` の rename (再編前の配置の中での移動。再編後は `state/notemaid/` の下) は `notemaid::migrations::run_fs` (notemaid クレート)。daemon は lock 取得後、アプリは in-process のときだけ呼ぶ。sidecar / 常駐時は transport の `Hello` に `fs_layout` を足し、不一致なら `restart_resident()` で古い daemon を先に止める。失敗しても起動は止めず、新パスに無ければ旧パスを読む
- バックアップ: `SUBDIRS` (allowlist) に `notemaid` を**足さない** (汎用 list / read / write / delete / rename が allowlist だけで通り、上限・承認・汚染規則を素通りする)。`export_bundle` に SOUL / USER / MEMORY を明示列挙。import は専用分岐で名指しの 3 ファイルだけを置き、見えない文字を含むものは外す (上限超過は読む側の「注入しない」で受ける)。アプリの import は人格 / 記憶が入っていれば置き換える前に一覧つきで 1 回聞き、断られたらその分だけ外して残りを入れる。notemaid は毎 turn ファイルを読むので reload 通知は要らない
- UI 編集の RPC (`data` 級、notemaid 経由): `maid_workspace_list()` / `maid_workspace_write(kind, body)` / `maid_user_memory_set(enabled)`。変更通知は `SettingsChange { subdir: "notemaid" }` を relay し、`settingsFileSync` に `notemaid` 用ハンドラを 1 つ足す

### 製品判断として確定したもの (2026-09-30)

persona は残し「人格」1 枚の中のキャラクター行にする / USER・MEMORY は command・task セッションにも入れる / USER.md はバックアップに入れる / USER への「次から確認しない」は許す / injection パターン検査は確認強制として入れる / HEARTBEAT.md が無ければ skip / SOUL は提案 + 常に承認 / `dataSources.memos` は廃止 / HEARTBEAT の既定予算は実測後に見直し

## HEARTBEAT Daemon ([#411](https://github.com/notedeck-dev/notedeck/issues/411))

OpenClaw の HEARTBEAT の発想 ([docs.openclaw.ai/gateway/heartbeat](https://docs.openclaw.ai/gateway/heartbeat)) に倣った **アプリ起動中ずっと走る global daemon**。本体は notemaid (`crates/notemaid/src/heartbeat.rs`) にあり、WebView が無くても走る ([#1133](https://github.com/notedeck-dev/notedeck/issues/1133) 縦切り 5)。tick の周期だけ手元側の timer (Tauri は `src-tauri/src/commands/heartbeat.rs`、常駐バイナリは自前) が持ち、tick ごとに notemaid の `heartbeat::run_once` を呼ぶ。**刻み方は両方とも `notemaid::heartbeat_schedule`**: 期限は実時計で見る (前回の巡回 + 間隔、寝ていた時間も数える)。OS のスリープ / ハイバネート中はプロセスごと止まり単調時計は進まないので、実時計と単調時計の進み方の差で復帰を検知し、期限を過ぎていれば少し待って (ネットワークの復帰待ち) 1 回だけ巡回する。溜まった回数はまとめて走らせない。復帰後の巡回は source が `resumed` で、前回からの経過を user メッセージに添え (寝ている間のまとめを書けるように)、その失敗は連続失敗 (自動停止) に数えない。スリープ中に起こして巡回させることはしない。ターン (ラウンドの反復と tool の実行) は notemaid のターン実行器 ([AI Chat Streaming](#ai-chat-streaming)) を `ai.heartbeat` principal で使う。AI カラムの有無 / 開いているカラム数に依存しない (= per-column scope ではない)。

### アーキテクチャ

```
┌─ 手元側 ──────────────────────────────────────────────┐
│  [Tauri] notemaid の HeartbeatTimer を in-process で持つ  │
│    ai.json5 / settings.json5 の変更通知で組み直す        │
│    (オフライン中は止める)。手動は heartbeat_trigger_now  │
│    tick → notemaid::heartbeat::run_due(&core, due)      │
│  [JS] useHeartbeatDaemon (代表窓だけが mount, #1131)    │
│    'nd:ai-heartbeat-event' → セッション写しの読み直し / │
│      アプリの通知 / OS 通知 / ペットの活動表示           │
│    起動時: 閉じている間の報告を 1 件にまとめて通知       │
└────────────────────────────────────────────────────────┘
┌─ notemaid ─────────────────────────────────────────────┐
│  run_once: 設定 (ai.json5) → skill (mode: heartbeat、   │
│    実質空なら skip) → 巡回の provider (鍵を開かずに決める。│
│    無ければ待機) → cheap check (core の cheap な         │
│    capability だけ) → 日次上限 → ターン (session 無し。  │
│    system は SOUL / キャラクター / USER / MEMORY /       │
│    AGENTS の上に固定 INSTRUCTION、手順は user 側)        │
│    → 応答契約 → 報告先 session に書く → HeartbeatSink   │
│  状態: notemaid/turns/heartbeat.json (日次 / cheap check /│
│    連続失敗)。連続失敗と日次上限の自動停止は ai.json5 の │
│    heartbeat.enabled を notemaid が書き換える            │
└────────────────────────────────────────────────────────┘
```

### 主要ファイル

| ファイル | 役割 |
|---------|------|
| `crates/notemaid/src/heartbeat.rs` | daemon 本体。skill 選択 / cheap check / 日次上限 / system prompt / ターン / 応答契約 / 報告先の解決と書込 / タイトル生成 / 失敗の数え方と自動停止 / 観測用の状態 |
| `crates/notemaid/src/ai_config.rs` | ai.json5 の読取断面 (HEARTBEAT / 接続 / 生成の値、正規化はデバイスの `useAiConfig` と同じ規則) と `heartbeat.enabled` の書換。巡回の provider の解決 (`heartbeat_provider`) もここ |
| `src/composables/useHeartbeatStatus.ts` / `src/services/heartbeatStatus.ts` | 「最後の巡回」の写し (`heartbeat_status`、tick の開始 / 終了で読み直す) と、outcome の文字列を表示の種別に落とす純関数 |
| `crates/notemaid/src/heartbeat_timer.rs` | timer。ai.json5 を自分で読んで組み、常駐バイナリと in-process の Tauri (`src-tauri/src/commands/heartbeat.rs` が設定ファイルの変更通知で組み直し、オフライン中は止める) の両方が使う。`HeartbeatSink` は notemaid の `sinks.rs` が Core の EventSink に写す |
| `src/composables/useHeartbeatDaemon.ts` | notemaid の出来事をデバイスに反映する (代表窓だけが mount する、#1131)。timer の構成は Rust が持つ |
| `src/composables/useAiConfig.ts` | `HeartbeatConfig` の正本 (デバイス側)。notemaid が ai.json5 を書いたら変更通知で読み直す |

### 巡回の接続 ([#1321](https://github.com/notedeck-dev/notedeck/issues/1321))

巡回に使う接続は `ai.json5` の `heartbeat.connectionId`。空 = チャットの接続 (`activeConnectionId`) に動的に追従する (複製ではない)。選ぶのは接続だけで、モデルは接続ごとの `models[接続 id]` をそのまま使う (巡回専用のモデルキーは持たない。同じ provider で安いモデルだけ変えたいときは同じ鍵で接続をもう 1 つ作る)。解決は `AiConfigLite::heartbeat_provider` の 1 関数で、`heartbeat.rs` が接続を使う箇所 (推論 / 報告先セッションの snapshot / タイトル生成 / 予算) はすべてこれを通す。「無し」= 接続 id が空 / 手元の CLI (`harness:`、models があっても) / その id の接続が無い / `protocol` が無い / `models[id]` が空、の順で判定し、鍵は開かない (鍵は推論のときに `resolve_connection` が 1 回だけ開く)。TS 側は同じ規則を `resolveHeartbeatConnection` に置く。予算は `AiTurnRequest.connection_id` 経由で巡回の接続の勘定に付く (接続 id ごと。同じ鍵の接続どうしでも合算しない)。

tick の結果は 4 種で数え方が違う (表は `heartbeat.rs` のモジュール doc): **provider 無し** (`skip:no-provider`) と **到達不能** (`skip:unreachable`、何も受け取る前の接続の失敗。送信側が reqwest の `is_connect()` のときだけ `error_kind: transport` を立て、`AttemptError` → `RoundError` → `AiTurnEvent.error_kind` で運ぶ。`retryable` で代用しない: 応答待ちの時間切れとストリームの切断も true になり、ローカル推論の時間切れが永久に待機になる) は連続失敗に数えず、日次も消費せず、失敗の記録にも入れずに状態の `waiting` に置く (toast は signature の初回だけ)。resolver が名前解決の結果を拒んだ (`blocked`、`ssrf::BlockedAddress` を `source()` の連鎖から取り出す) は設定の誤りなので provider 無し。**推論の失敗** (`error`: HTTP / 時間切れ / 受信途中の切断 / 予算超過) だけ数える。日次カウントは「次で超えるか」を推論の前に判定し、加算は結果が出てから。`resumed` / `manual` / `probe` は連続失敗に数えない。

検証手段: 「今すぐ巡回する」(`heartbeat_trigger_now`、無効でも走り cheap check を飛ばし、連続失敗と日次に数えない。実行中の印を同期的に取って spawn し即返す) / 「この接続を試す」(`heartbeat_probe`、通常の tick と同じ組み立ての prompt に固定の指示を足して 1 巡だけ回す。`AiTurnRequest.dry_run` で report tool 以外は執行せず、報告先への書込 / 通知 / 状態の最後の巡回も書かない。予算は消費する。結果は report tool を呼べたかだけ) / 「最後の巡回」(`heartbeat_status`、`HeartbeatStatus` は specta 型で `/api/heartbeat/status` と About の JSON も同じ型。provider は表示用の断面だけで接続 id は出さない)。実行中の印 (`try_begin`) は timer の tick / 手動 / 試走が共有し、同時に 2 本走らせない。切り詰めの注記は、ローカル接続だけ OpenAI 互換の要求に `stream_options.include_usage` を送って最初のラウンドの実測 (`usage` イベント) を取り、送った量の推定を大きく下回るときに可能性として出す (ローカルに限るのは prompt caching のある provider が cache の分を usage に含めず誤検知するため)。

### Skill 駆動

NoteDeck の巡回の手順は `mode: heartbeat` の skill (予約 skill `HEARTBEAT.md` を含む、#1162)。MisStore 配布の skill は frontmatter で `mode: heartbeat` を宣言しておけば install 直後に daemon が拾う。tick ごとに全 heartbeat skill body を結合し、OpenClaw の scratch と同じく **user 側のメッセージ**に付けて 1 回の AI inference に投げる (system は notemaid が組む人格と記憶の上に固定 INSTRUCTION)。本文が全部「実質空」(空行 / コメント / 見出し / fence / 空のチェックリストだけ) なら tick を skip する。skill の `cheapCheckCapabilities` は notemaid 単独で実行できる cheap な capability だけ。notemaid 経由の登録 (AI の作成 / 更新、MisStore からのインストール) では他を含む skill を拒み、外部エディタで直接書かれたものは実行時に無視する (warn)。

### 応答契約 (`heartbeat.report` tool と legacy の `HEARTBEAT_OK`)

AI は報告すべきことがあるときだけ `heartbeat.report` tool を呼び、本文と通知の有無を返す (発想元の OpenClaw と同じ形)。tool を呼ばない応答は legacy の ack として受理する: 先頭 / 末尾の `HEARTBEAT_OK` を剥がし、残りが短ければ (上限は `heartbeat.rs` の定数) 全体を捨てる。知らせるのは tool の `notify` が真のときだけ。legacy で残った本文は報告として書くが知らせない (#1227): 知らせるかは AI が明示したときだけ決まり、INSTRUCTION は報告を tool に限っているので tool を呼ばない本文は契約の外 (「通知に記憶を載せない」の指示も tool の `notify` にしか掛かっていない)。報告は target session に `heartbeat: true` のメッセージとして書き、デバイスは変更を受けてそのセッションの写しを読み直す。

### 知らせ (アプリの通知、#1165)

HEARTBEAT の知らせはアプリの通知 (通知カード + 受信トレイ) で回収し、送り元は HEARTBEAT にする。押して移る先がある知らせは情報でも受信トレイに残る (`stores/toast.ts`)。

- **報告** (`notify`、AI が「通知して」とした報告): 必ず受信トレイに残し、押せば報告先の AI セッションを AI カラムで開く (無ければサイドバーに 1 本開く、消えていればそう知らせる)。報告先が「なし」(`'none'`) でも知らせ、押せば報告先を選べる AI 設定の HEARTBEAT を開く (#1227)。AI 設定の「デスクトップ通知」は notemaid が `desktop` に載せ、アプリを開いている間の OS 通知を出すかだけを決める (フォーカス中は出さない)
- **確認待ちの操作**: `report` に新しく積んだ数 (`pending`) を載せ、1 以上なら受信トレイに出す。押せばそのセッションを開く
- **自動停止 / 失敗 / 日次上限** (`toast`): 押せば AI 設定の HEARTBEAT を開く
- **閉じている間の報告**: 端末に「最後に見た時刻」(localStorage、HEARTBEAT が有効な間だけ持つ。開いている間は報告を受けるたびに進める) を持ち、次に開いたときにそれより後の知らせを数えて「閉じている間の報告 N 件」(確認待ちがあれば一緒に) として 1 件にまとめて出す。報告は開いている間と同じ基準 (「通知して」のものだけ) で数えるため、notemaid が知らせた報告を状態ファイルに記録し (時刻と報告先。報告先が「なし」でも残す、上限つき)、端末は `heartbeat_notices_since` で読む。確認待ちは全セッションの受信箱カードから数える。数える規則は `src/services/heartbeatAway.ts`。受信トレイ自体は保存しない
- notemaid 自身は OS 通知を出さない (採用しない理由は ROADMAP の「採用しない」)

### 停止条件と失敗 (token 予算 / 失敗の永続化)

- **token 予算** (`crates/notemaid/src/ai_budget.rs`): Vault 接続ごとの日次 token 予算を ai.json5 の `budgets` に持ち (0 / 無し = 無制限)、台帳は `notemaid/turns/budget.json` (日境界は UTC)。チャットも HEARTBEAT も同じ勘定。ラウンドの前に「使用済み + 見込み (要求の文字数からの推定)」が予算を超えるなら provider を呼ばずに `budget_exceeded` のエラーで止め、ラウンドの後に応答の usage (Anthropic は message_start / message_delta、OpenAI 互換は最終チャンクの usage。来なければ文字数からの推定) で精算する。OpenAI 互換に usage を返させる指定 (`stream_options.include_usage`) はローカル接続にだけ送る (厳格な互換サーバーが拒むため非ローカルには送らず、来たときだけ読む。#1321)。ターンの `done` に累計の usage を載せる
- **失敗の永続化**: HEARTBEAT の失敗は理由を状態ファイルに残し (上限つき)、数字と空白の揺れを潰した signature が初めてのときだけ toast で知らせる (同じ原因の連続失敗で通知を繰り返さない)。連続 3 回で自動停止するのは従来どおり。直近の失敗は DevDashboard の HEARTBEAT 面 (`/api/heartbeat/status`) に出る

### 無人の書込意図 (受信箱カード / 下書き)

無人実行は承認を待たない。確認が要る操作 (宣言の confirm / クロスアカウント。ただし宣言に `unattended` があるものは権限だけで走る) を HEARTBEAT の AI が呼んだら、ターン実行器は走らせずに書込意図として記録し、AI には「記録した」と返す。daemon は target session に `intent` 付きのメッセージ (受信箱カード) として書き、投稿系 (ノート作成) は同時に下書きにも落とす (アカウントは引数から)。人がカードの実行ボタンを押した時点で、デバイスの dispatcher が本人操作として実行する: 確認は必ず出し (「次から確認しない」の記憶は見ない)、本文の先頭に「無人実行が提案した」旨と、他人の内容を読んだ文脈なら「宛先と本文を確かめて」の一文を添える。実行 / 却下の結果はカードの状態として同じメッセージに書き戻す。他人の本文にだけ出てきた宛先への書込は意図にもせず拒否する。

### Target Routing

`config.heartbeat.target` で 3 mode:
- `'auto'` (default): kind='heartbeat' な session を find or auto-create + 永続使用 (1 個だけを使い回す)
- `'none'`: session に append しない (silent log only)。ただし「通知して」の報告は知らせる (#1227)
- `<session id>`: 既存 session に明示 pin

新規 session 作成時は `timestampTitle(now, 'のHEARTBEAT')` でプレースホルダー → 初回 tick の応答内容を AI で要約してタイトル上書き (失敗時は timestamp が残る)。

### Permissions (HEARTBEAT 中の権限)

`permissions.json5` の `ai.heartbeat` principal で chat (`ai.chat`) とは独立管理 (#712)。default `'readonly'` preset で write 系 / external network 全部 deny。旧 `ai.json5` の `heartbeat.permissions` からは初回起動時に「chat との AND (交差)」で一度きり移行される — 旧実装は絞り込み = heartbeat / 実行時 enforce = chat の実装ずれがあり、実効権限は交差だったため (素朴な複製は権限拡大になる)。

AI に渡す tool 一覧の絞り込みと呼び出しごとの認可は notemaid のターン実行器が `ai.heartbeat` の granted で行う (#1133)。デバイス側の dispatcher も同じ `resolveFor({ kind: 'ai.heartbeat' })` で判定するので、露出と実行の判定が一致する。確認が要る capability は dispatcher が拒否する (無人時に承認を待たない)。

### Silent Fail Prevention

provider error / network error / 429 等で daemon が無言で動かなくなる問題を防ぐ:

- `run_once` (`crates/notemaid/src/heartbeat.rs`) が AI inference の失敗を受け止める
- 失敗時: 失敗の内容を heartbeat session に append (target='none' は除く)
- 連続 `MAX_CONSECUTIVE_FAILURES` 回失敗で notemaid が ai.json5 の `heartbeat.enabled = false` を書き、デバイスに toast で知らせる
- 1 回成功で counter リセット

### Session Drawer 表示 (DeckAiColumn)

session 一覧では `AiSessionKind` 別の icon 統一 (`chat` → `ti-message-circle` / `heartbeat` → `ti-activity-heartbeat` / `command` → `ti-terminal-2` / `task` → `ti-checklist`)。kind='heartbeat' な session は専用「💓 HEARTBEAT」section に最上位 pin され、行は accent カラー強調 (avatar 円 + 左 2px border)。

## AI Credentials

AI プロバイダー (Anthropic / OpenAI / OpenAI 互換) の API キーは **Secret Vault ([#564](#secret-vault-564))** に統合されています。AI 設定は「どの Vault 接続を使うか」(`activeConnectionId`、巡回だけ別にするなら `heartbeat.connectionId`、#1321) と「接続ごとのモデル名」(`models`) だけを `ai.json5` に持ち、endpoint / API キー / protocol は Vault 接続から Rust 側で解決します。フロントエンド・AI はキー本体に**触れません** (credential proxy モデル)。

### データの所在

| 項目 | 場所 |
|------|------|
| API キー | OS キーチェーン (Vault 接続の secret slot `vault/v1/<conn_id>/primary`) |
| endpoint / protocol / 認証方式 | `connections.json` の `Connection` (Rust が source of truth) |
| 使用する接続 + モデル名 | `ai.json5` の `activeConnectionId` + `models: { [connectionId]: model }` |

AI プロバイダーとして使える接続は `Connection.protocol` (`anthropic` / `openai-compat`) が `Some(_)` のもの。AI 設定のピッカーはこの接続のみを表示し、`crates/notemaid/src/ai_chat_service.rs` の SSE パース分岐にもこの `protocol` を使います。

### 旧 `ai.<provider>` キーチェーンからの移行

初回起動時、`ai.json5` に旧 provider 系フィールド (`provider` / `anthropic` / `openai` / `custom`) が残っていれば一度だけ自動移行します (`useAiConfig.ts` の `migrateProvidersToVault`)。

1. `ai_migrate_provider_to_vault(provider, name, baseUrl, protocol)` (`crates/notecore/src/commands/vault.rs`) が旧 `ai.<provider>` キーチェーンエントリーを読み、Vault 接続 (`origin = External`, `externalSource = "ai-provider"`) を作成して secret を移し替え、旧エントリーを削除する。キーチェーンに該当エントリーが無ければ `None` を返す。
2. フロント側が返ってきた接続 id を `models` / `activeConnectionId` に記録し、provider 系フィールドを含まない形で `ai.json5` を書き戻す → 次回以降は移行をスキップ。

### フロントエンド

| ファイル | 役割 |
|---------|------|
| `src/composables/useAiConfig.ts` | `AiConfig` schema (`activeConnectionId` + `models`)、`resolveAiConnection()`、`migrateProvidersToVault()` |
| `src/components/window/AiSettingsContent.vue` | AI 接続ピッカー (Vault 接続のラジオリスト) + モデル名入力。接続の追加・編集は「接続」ウィンドウへ誘導 |
| `crates/notecore/connection_templates.json5` | 内蔵接続テンプレの正本 (#1160)。AI プロバイダーのテンプレは `protocol` / `defaultModel` を持ち、会話 ID のヘッダーを要求するプロバイダーは `affinityHeader` を宣言する。`pnpm gen:connection-templates` で `src/data/connectionTemplates.generated.ts` (宣言表 `BUILTIN_TEMPLATE_DECLS`) と `crates/notecore/src/connection_templates.generated.rs` を生成し、鮮度は `tests/lint/connectionTemplates.test.ts` が検査する。UI が使う `BUILTIN_TEMPLATES` と手書きの補助 (辞書ラベルの解決 / favicon 導出 / URL ペーストの照合) は `src/data/connectionTemplates.ts` |
| `src/defaults/ai.json5` | `activeConnectionId` + `models` スキーマ。**API キー / endpoint は含まない** |

### 新しい AI プロバイダーを追加するとき

ユーザーは「接続」ウィンドウから手動で任意の OpenAI 互換 / Anthropic 互換エンドポイントを登録できます。内蔵テンプレを増やす場合は `crates/notecore/connection_templates.json5` に `protocol` 付きでエントリーを追加して `pnpm gen:connection-templates` を実行するだけ。新しい SSE プロトコルを足す場合のみ `ConnectionProtocol` enum (`crates/notecore/src/vault/model.rs`) と `crates/notemaid/src/ai_chat_service.rs` の dispatch に分岐を追加します。

## Secret Vault ([#564](https://github.com/notedeck-dev/notedeck/issues/564))

AiScript / AI / プラグインが**任意の外部サービス** (GitHub / Linear / 任意の Web API) に接続するための汎用シークレット基盤。Misskey トークン・AI API キーで確立済みの credential proxy モデル (Rust 側で注入、JS / AI には raw secret を渡さない) を任意の外部 API へ拡張する。仕様は 5 round の adversarial review で確定 (170+ 件の指摘を反映、[Issue #564](https://github.com/notedeck-dev/notedeck/issues/564) 参照)。

### データモデル

| レイヤー | 場所 | 内容 |
|---------|------|------|
| metadata | `<configDir>/notedeck/connections.json` | 接続定義。Rust が source of truth として読み書き (atomic write: 同一 dir への一時ファイル + rename)。`schemaVersion` + `connections[]` |
| secret | OS キーチェーン | `service` = `notedeck`、`account` = `vault/v1/<conn_id>/<slot>`。`/` 区切りの構造化 path で既存エントリーと名前空間分離。slot で OAuth (v2) 拡張余地を確保 |

`Connection` フィールド: `id` (ULID) / `name` / `baseUrl` (scheme+host+path のみ、query/userinfo/fragment 拒否) / `kind` ('outbound') / `authType` / `allowedHosts` / `accountScope` / `origin` / `templateId` / `exposedTo` (開示先 principal クラス #712) / `trustedFor` / `slots` / `notes` 等。`authType` は判別共用体: `{ kind: 'bearer' }` / `{ kind: 'header', name }` / `{ kind: 'query', param }` / `{ kind: 'basic', username }`。

### Rust モジュール (`crates/notecore/src/vault/`)

| ファイル | 役割 |
|---------|------|
| `model.rs` | `Connection` データモデル、slot / conn_id バリデーション |
| `backend.rs` | `SecretBackend` trait (同期 / dyn-safe)。Android 用 backend を v2 でこの trait に追加 |
| `keychain_backend.rs` | `notecli::keychain` を使う `KeychainBackend` |
| `connections_store.rs` | `connections.json` の atomic read/write |
| `auth_inject.rs` | bearer/header/query/basic の注入、呼び出し側の危険ヘッダー除去 |
| `redaction.rs` | レスポンスからの secret redaction + 機密ヘッダー drop |
| `fetch.rs` | `vault_fetch` の本体。DNS pinning と redirect 各 hop の host 再検証は notecore 直下の `ssrf.rs` (共用) を使う |
| `error.rs` | `VaultError` (specta::Type で型生成) |

### Tauri コマンド (`crates/notecore/src/commands/vault.rs`)

コマンド: `vault_list_connections` / `vault_get_connection` / `vault_upsert_connection` / `vault_upsert_connection_with_secret` / `vault_set_secret` / `vault_get_secret_status` / `vault_delete_secret` / `vault_delete_connection` / `vault_set_exposed` / `vault_set_trusted` / `vault_set_trusted_plugin` / `vault_fetch` / `vault_test_connection` / `ai_migrate_provider_to_vault`。コマンド表の `(window = app)` 属性で「Tauri の窓から呼ばれたこと」を要求し (JSON 経路からは呼べない。以前は `main` 限定で、ポップアウト / ミラー / PiP の AI カラムが接続を解決できなかった、#1297)、本体で `validate_slot` + `validate_connection_id`。secret は `secrecy::SecretString` で扱い、最小長 16 文字を強制。

### `vault.fetch` のセキュリティ

- **SSRF**: HTTP/1.1 only、`path` は baseUrl 相対のみ (絶対 URL / protocol-relative 拒否。baseUrl のパスの下に足し、`..` で外へ出る path は拒否、#1319)、redirect 各 hop で URL/IP/allowedHosts 再検証、DNS resolver は fetch スコープで共有 (rebinding 防御)、IP deny rules (private/loopback/link-local/multicast、`ssrf.rs` を共用)、`no_proxy()`
- **redaction**: 注入した secret を literal memmem で `<vault-redacted-<nonce>>` に置換 (per-fetch nonce で confuse 攻撃を防ぐ)、`Set-Cookie` / `Authorization` 等の機密ヘッダー drop、レスポンス body は 500 KiB でストリーミング打ち切り
- **型安全**: secret は `secrecy::SecretString` で扱い、`Connection` (メタデータのみ、secret なし) と分離
- **ローカル接続 (#880)**: `Connection::local` の接続 (URL が loopback の 3 表記。`upsert_metadata` が `ssrf::normalize_loopback_url` で両向きに検査・正規化し、開示と信頼を空にする) は `vault_fetch` の入口で `LocalConnectionNotFetchable` として拒む (principal を問わない。`apply_exposed` / `apply_trusted*` も拒む)。疎通は `probe_local_connection` (secret 任意、パスは `models_path_for(protocol)` 固定、redirect なし) で、応答の `data[].id` を `VaultTestResult::models` に載せる (インターネットの接続でも `/models` の形なら同じく載せ、AI 設定のモデル候補になる、#1020)

### AI 統合

- `vault.fetch` は capability registry に登録 (`aiTool: true`, permission `vault.use`, `requiresConfirmation: true`)。AI / AiScript / slash から呼べる
- 開示は principal クラス別 (#712 §6.1 / #759): `exposedTo: ('ai' | 'plugin' | 'external')[]` (接続単位、default 空 = 非開示)。「AI に見せる」「プラグイン・ウィジェットに見せる」「外部アプリに見せる」は別の同意で、`vault.fetch` capability は呼び出し principal のクラスに開示された接続のみ `connectionRef` (name / id) で解決。plugin クラスは接続ごとの明示 opt-in (#759 — secret 自体は Rust 側注入のまま AiScript に露出しない)
- 「今後確認なし」(`trustedFor`) もクラス別 — 外部アプリでの確認同意が AI の trust に化けない。plugin クラスのみクラス一括ではなく**個体単位** (`trustedPlugins: {id, name}[]`) — 1 ウィジェットへの同意が全プラグイン / Play / Page に波及しない。取り消しは接続編集の信頼済み一覧から
- AI の system prompt に `<available-connections>` ブロックを注入 (Ai クラスに開示された接続の name / baseUrl / auth のみ、secret / id は出さない)
- permission `vault.use` は preset readonly/safe = false、full = true。HIGH_RISK 指定

### v1 スコープ外 (後続)

file lock / rate limit / `vault.manage` 権限 / error 3 値正規化 / latency 量子化 / confirm batching / CLI (`notecli vault`) / export-import / audit log は v1.x 以降。OAuth 2 / Webhook (inbound) は v2 以降 ([Issue #564](https://github.com/notedeck-dev/notedeck/issues/564) 参照)。

**AI provider key の Vault 統合は完了済み** — AI プロバイダーの API キーは Vault 接続 (`protocol` 付き) に統合され、`ai_chat_send` は `connection_id` から endpoint / key / protocol を解決する。詳細は [AI Credentials](#ai-credentials)。

### Tauri コマンド追補

`ai_migrate_provider_to_vault(provider, name, baseUrl, protocol)` — 旧 `ai.<provider>` キーチェーンを Vault 接続へ移行 (`origin = External`, `externalSource = "ai-provider"`)。`vault.rs` に定義、コマンド表の `(window = app)` 属性で Tauri の窓からの呼び出しに限る（#1297 までは `main` 限定だった）。

## ペット ([#1080](https://github.com/notedeck-dev/notedeck/issues/1080))

デッキの上に浮かぶ [petdex](https://petdex.dev) 形式のアニメーションペット。アピアランス設定の一項目で既定はオフ。設計の正本は issue #1080 のコメント。

- **配布物ではなく選択肢**: ギャラリー・審査・テイクダウンは petdex が持つので、NoteDeck のストアや管理カラムには載せない。同梱ペットも無し。設定 (`settings.json5` の `pet.*`) には「どれを選んだか・位置・倍率」だけを置き、本体 (スプライトシート + メタ) は `pet_store` (Rust) がキャッシュ領域に置く。消えても再取得できるのでバックアップ対象外で、保持は選択中の 1 体だけ
- **取得は Rust**: petdex のアセット CDN は CORS ヘッダを返さないので、解決 API → スプライト取得 → 寸法からグリッド判定 (v1 / v2) → 保存 を `commands/pet.rs` が行う。フロントは base64 で受けて Blob URL を CSS 背景に敷く
- **スプライトの表**: 行と状態の対応、コマ数、コマごとの表示時間は pet.json に無く描画側の固定表 (`services/petSprite.ts`、petdex desktop と同じ値)
- **AI 活動の集約状態** (`stores/aiActivity.ts`): 「生成中 / ツール実行中 (読み取り系は review) / 承認待ち / 完了 / 失敗」を横断して見られる唯一のリアクティブ状態。`useAiChat` / `useAiTurn` / capability dispatcher (AI principal のみ) / `taskRunner` が `begin` / `pulse` で報告し、`services/petActivity.ts` が優先順位で 1 つに畳む。ペットはその最初の消費者で、Dev Dashboard や Spotlight も読める
- **表示**: デッキ画面を描く窓 (デッキ窓とポップアウト) のデッキ上に 1 体ずつ (`DeckPetOverlay`。表示は全窓の原則、#1131)。PiP では出さない。コンパクトレイアウトでは下端の基準をモバイルナビの上端 (`--nd-mobileNavHeight`) に置き、位置未設定なら FAB の上に載せる。ドラッグで位置を変えられ (向きで running-left / right)、省電力の `staticEmoji` とウィンドウ非表示の間は 1 コマ目で止める
- **当たり判定は不透明領域だけ**: 要素は矩形だが、透過画素の上のクリック・タップ・スクロールは下のデッキに届く (petdex desktop は別 OS ウィンドウなので矩形で困らないが、デッキの上に載せる NoteDeck では死に領域になる)。`pet_store::hit_mask` が読み込み時にスプライトの alpha から状態 (行) ごとのブロックマスクを作り (行内の全コマの和集合を透明側に膨らませたもの)、`services/petSprite.ts` の `petHitClipPath` が表示寸法の `clip-path: path()` にする。clip-path は描画も切るので「見える画素を必ず含む」が不変条件で、Rust テストで固定している。コマごとではなく状態ごとにしているのは、押した場所の判定が数百 ms で変わらないようにするため。マスクが作れない・`path()` 非対応なら矩形に戻る
