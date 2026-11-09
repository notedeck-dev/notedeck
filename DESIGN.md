# NoteDeck Design Document

設計思想と方針をまとめたドキュメント。実装詳細は [DEVELOPMENT.md](DEVELOPMENT.md) を参照。

## 設計原則

- Apple 式直感 UI: 設定項目を増やさず、触ればわかる操作で完結
- 機能網羅より体験品質: 少ない機能を心地よく使えることを優先
- Web UI へのリンク導線: 非対応機能はブラウザで開けるようにする
- サーバー運営者との共生: 広告表示・支援導線を整備し、エコシステムの持続可能性に貢献する
- ライブラリ選定は Misskey 本家追従（後述）
- **User Respect over Engagement Maximization** — ユーザーの注意を奪わず、コントロールを返す（後述）

## UX 思想 — Engagement Maximization よりも User Respect

NoteDeck は「ユーザーの注意を奪わず、コントロールを返す」設計を採る。X / Threads / Instagram に見られる滞在時間最大化のための UI パターンは、広告ビジネスを支える経済合理性の産物であり、Misskey エコシステム（広告非依存・分散・ユーザー主権）には合致しない。Bluesky / Misskey 公式 / Mastodon が同様にこれらを採用しないのも同じ理由による。

VSCode・Apple 純正アプリのように「ユーザーがやりたいことを最短でやらせて、終わったら手放す」を理想とする。

### 採用しないダークパターン

| パターン | 例 | 不採用理由 |
|---|---|---|
| スクロール連動 UI 退避 | スクロール時にナビバー / FAB を隠す | "もう少し見せる" ための 1px 稼ぎ。広告・エンゲージメント駆動の意匠 |
| 過剰なバッジ煽り | "9+", "新着 N 件" の強調表示 | 強迫的に開かせる装置 |
| 時刻の曖昧化 | "たった今" を長く維持、絶対時刻を隠す | "新鮮なものがある" 感の演出 |
| 終端隠蔽 | 無限スクロールで読了を伝えない | 終わらせない設計 |
| 離脱の摩擦 | 戻る・閉じるが奥にある、確認モーダルでの引き止め | 滞在時間延長のための心理的コスト |
| 自動再生・大音量サムネ | 動画自動再生 | 注意を強制的に引く |
| アルゴリズム介入の通知 | "あなたへのおすすめ" 割り込み | 受動的体験への誘導 |
| 装飾アニメ・過剰なバウンス | プルリフレッシュの過剰な弾性 | ドーパミン的に "もう一回" を誘発 |

### 採用するパターン

**レイアウト**

- **静的・予測可能**: 同じ要素は常に同じ場所に配置する。マッスルメモリーが効く = 認知負荷ゼロ
- **アフォーダンス可視**: 主要アクションはアイコンで見えている。ジェスチャは "おまけ" であって必須機能にしない
- **読了の明示**: 既読と新着の境界に "ここまで読みました" 区切り線を honest に表示する (アプリ・カラム再オープン時、前回 topmost に居た位置の上に divider を出す)

**アニメーション**

- **機能的アニメだけ**: "開いた / 閉じた / 移動した" を伝えるためのものに限る。装飾アニメは入れない
- **短く (150–250ms)**: 長いアニメは "気持ちいい" が "操作を待たされる" に変わる
- **ease-out 主体・bounce 禁止**: 弾性は注意を引きすぎる。例外は到達感のためのごく小さなオーバーシュート (リアクションの数の跳ねなど、1 回きりで短いもの) だけで、上限は `global.css` の `--nd-ease-spring-bouncy`。それより強い弾みや繰り返す弾みは入れない
- **`prefers-reduced-motion` 尊重**: アクセシビリティ対応必須
- **共有要素遷移**: ノート → 詳細など同一物の移動はトラッキングできるように

**情報の honesty**

- **絶対カウント**: 実数を出す。"9+" のように早い段階で潰して「たくさんある」感を演出しない。ナビバーのバッジのように幅が固定で桁が溢れる場所だけ、その幅で読める上限を超えたら "N+" に丸める（上限値は各バッジの実装が正本）
- **絶対時刻併記**: 相対時刻 + tooltip で絶対時刻
- **誠実なロード状態**: 画面・カラム全体のロードは "Loading..." とスピナーで待たせていることを正直に出す。スケルトン UI で「もう中身がある」ように偽装しない（体感的に逆に遅く感じるため）
  - 例外は **既にレンダリング済みの本文に埋まる、レイアウトが確定しているサブブロック**（ノート中の URL プレビュー・埋め込みノート、画面外カラムの未マウント枠）。ここでの骨格は中身の偽装ではなく確定済みの寸法の確保であって、外すと差し込み時にレイアウトが飛ぶ。主コンテンツの待ち時間をごまかす用途には使わない
- **エラーは隠さず説明**: 黙って失敗しない

**通知・操作**

- **未読は粒度高く ON / OFF**: 何を通知するか細かく選べる
- **FAB 常駐**: 投稿ボタンは常に同じ場所（モバイルでもスクロールで消さない）
- **キーボードショートカット完備**: IDE 思想と整合
- **コマンドパレット中心の機能発見性**: メニューで埋め尽くさない

### 判断基準

新しい UI / アニメ / 通知パターンを追加するときは、必ずこう問う:

> **これはユーザーがやりたいことを助けているか? それともアプリ内にもう少し留めようとしているか?**

前者だけ採用する。後者は却下する。

## AI 機能の範囲 — テキストのみ、画像は扱わない

NoteDeck の AI チャットは設計上 **テキストのみ** を扱う。画像入力 (vision)・画像生成・添付メディアの自動取り込みはサポートしない。

### 理由

Misskey エコシステムには絵師・イラストレーターが多く、生成 AI に対する強い忌避感がコミュニティ全体に存在する。たとえユーザー自身が能動的にアップロードする用途であっても、「クライアントが AI に画像を送る経路を持つ」こと自体がコミュニティの信頼を損なう。NoteDeck は Misskey 統合環境を名乗る以上、コミュニティの空気を尊重する。

### 対応しないもの

- 画像ファイルの AI への送信 (添付・ドラッグ&ドロップ・ペースト)
- ノート添付メディアの AI コンテキストへの自動同梱
- 画像生成プロバイダー連携 (DALL-E / Stable Diffusion 等)

### 対応するもの

- テキストの要約・翻訳・推敲
- tool call による Misskey API 操作
- HEARTBEAT 等の自律エージェント機能 (テキスト範疇)

関連: #452

## AI UI の設計判断

NoteDeck の AI は「画面の一角でチャットする機能」ではなく、**カラムから独立した AI セッションを master-detail UI で管理する** 構造を採る。設計の中核は以下:

### AI セッション = カラムから独立した永続オブジェクト

- セッションは `data/sessions/<YYYYMMDDhhmmss>.json5` に保存され、カラムを削除しても残る
- `AiSessionKind = 'chat' | 'command' | 'task' | 'heartbeat'` で kind 別の UI を切り替え
- master-detail (一覧 + 詳細) で並列のチャットを CRUD。タイトルは初回応答完了後に AI が要約生成
- HEARTBEAT 由来のセッションは **最上位 pin + 専用 icon** で常に視認できる位置に固定

これは「AI とのやりとりは流れて消える」のではなく「ノートのように所有・再開できる対象」と位置付ける UX 判断。

### tool calling の可視化 — 「AI が何をしようとしているか」を常に見せる

- AI が capability を呼ぶたびに `tool_use` / `tool_result` を **チャット UI 上にカード表示**
- 引数 JSON は **code block + Shiki シンタックスハイライト**で人間が読める形にレンダリング
- 書き込み系 capability は dispatch 直前に **確認ダイアログ**を出し、引数を同じ形式で再表示してから「実行」/「キャンセル」を選ばせる
- 確認ダイアログのアイコンは **Misskey 本家風 SVG** に統一し、アプリ全体の警告系 UI と語感を揃える

「AI に何をされているかわからない」「気づいたら投稿されていた」という不安を構造的に消す。

### 既読/新着境界 — 「ここまで読みました」区切り

タイムライン系カラムでは既読位置に **"ここまで読みました" 区切り線** を表示し、読み戻し / 新着検知の認知負荷を下げる。Apple 式直感 UI 原則 (説明書なしで触ればわかる) に従い、設定で隠す選択肢は提供しない。

詳細実装は [DEVELOPMENT.md](DEVELOPMENT.md) の "AI Chat Streaming" / "HEARTBEAT Daemon" / "AI Capability Registry"、capability 一覧は [SKILLS.md](SKILLS.md) §4。

## 依存ライブラリ選定方針

NoteDeck のフロントエンド依存ライブラリは、原則として **Misskey 本家 (`misskey-dev/misskey`) が採用しているものと揃える**。本家の実装を参照実装として活用でき、UI 互換性・学習コスト・保守コスト・バンドルサイズを同時に最適化できる。

### 3 原則

1. **本家互換機能は本家と同じライブラリで** — プロフィール Activity タブ、MFM レンダリング、画像クロップ等、本家に同等機能がある場合はライブラリもコード構造も本家を踏襲する。本家の実装（例: `MkChart*.vue`）を参照実装として直接活用できる
2. **独自機能も本家ライブラリで実現可能な範囲まで** — 横断検索・Digital Wellbeing 等の NoteDeck 独自機能でも、本家の既存ライブラリセットで実現可能ならそれを使う。新ライブラリ追加は「本家のライブラリでは実現不可能」と証明された時のみ
3. **本家ライブラリで不可能な機能は原則実装しない** — 連合ネットワーク図・ユーザー向けパフォーマンス監視 UI・高頻度時系列チャート等、本家のライブラリセットでは作れない機能は「構造的に対応しない領域」に倣って最初から作らない

### 具体例: チャート

Misskey 本家は以下のスタックを採用しており、NoteDeck も同一とする:

| ライブラリ | 用途 |
|---|---|
| `chart.js` | チャート本体（折れ線・棒・レーダー等） |
| `chartjs-adapter-date-fns` | 時系列の日付軸 |
| `chartjs-chart-matrix` | カレンダーヒートマップ（プロフィール Activity 等） |
| `chartjs-plugin-gradient` | グラデーション塗り |

この結果、連合ネットワーク図（Cytoscape/Sigma 等が必要）や高頻度リアルタイム時系列（uPlot 等が必要）は本方針により不実装となる。

### 対象外（NoteDeck のネイティブ・IDE 層）

Misskey 本家が扱わない領域 — デスクトップネイティブ機能・ローカル永続化・IDE 的機能 — は NoteDeck の差別化根幹のため本方針の対象外:

- Tauri v2 (デスクトップランタイム)
- notecli (Rust バックエンド・ローカル DB / API クライアント / ストリーミング)
- CodeMirror 6 + Web Worker LSP (AiScript エディタ)
- @tanstack/vue-virtual (仮想スクロール)
- Scalar (API ドキュメント表示)
- tauri-specta (型付き IPC)
- Shiki (コードハイライト — 本家とは独立導入済み。ただし本家も同一採用のため結果的に一致)

### バージョン追従ポリシー

「同一ライブラリを使う」レベルで十分。本家の patch/minor には逐一追随せず、メジャーバージョンが大きく離れた場合にのみ見直しを検討する。

## Why Multi-Server（なぜマルチサーバーか）

Misskey（ActivityPub）はサーバーが主語の設計になっている。検索はサーバーのローカルインデックス、通知・お気に入り・リストはアカウント単位、フォロー関係もサーバーに紐づく。複数サーバーにアカウントを持つユーザーにとって、これらが分断されることは構造上避けられない。

NoteDeck は複数サーバーへの同時ログインとローカル DB を組み合わせることで、この分断をクライアント側で緩和する。

| 分断 | Misskey 単体 | NoteDeck |
|------|-------------|----------|
| 検索 | サーバーのローカルインデックスのみ | 複数サーバーへ並列クエリ + ローカル FTS5 で大幅改善 |
| 通知 | アカウントごとに散在 | cross-account カラムで統合表示 |
| タイムライン | サーバーごとに分断 | 複数アカウントの TL をマージ可能 |
| フォロー操作 | リモートフォローの UI 遷移が煩雑 | ログイン済みアカウントから直接操作 |
| 既読状態 | クライアント・サーバー間で不整合 | ローカル DB で一元管理 |
| 投稿の永続性 | サーバー依存（サーバー消滅でデータ喪失） | ローカル DB にキャッシュとして残る |

**プロトコルの限界は受け入れる。** ActivityPub のアイデンティティはサーバーに属しており、これはクライアントでは変えられない。NoteDeck が実現するのは「サーバーに縛られない体験」であって「サーバーに縛られない存在」ではない。リスト・アンテナの管理やプロフィール編集など、サーバー側の責務はサーバーに委ねる（[ROADMAP.md](ROADMAP.md) の「構造的に対応しない領域」を参照）。

## Data Sovereignty（データ主権）

NoteDeck はユーザーのデータ主権を尊重する。ユーザーが意図的にカスタマイズした設定はすべて**テキストファイル**として管理し、バックアップ・インポート・端末間共有を可能にする。

### 原則

- **ファイルが source of truth** — localStorage はキャッシュ/起動高速化の役割
- **人間が読み書き可能** — JSON5/CSS/AiScript 等のテキスト形式を採用
- **アプリ非依存** — テキストエディタで直接編集可能。アプリが消えてもデータは残る
- **ポータブル** — ファイルコピーで別端末に持ち運べる
- **常駐での「手元」** — AI (notemaid) を OS のログイン時タスクとして常駐させても ([#1106](https://github.com/notedeck-dev/notedeck/issues/1106))、これらの原則の「手元」は端末のまま。常駐は同じ端末の上で動き、持ち物 (セッション / メモ / skill / AI 設定) も同じ設定ディレクトリのファイルが source of truth (2026-09-29 に「手元 = 自分のホスト」への読み替えは撤回し、別サーバーで動かす構成も採用しない)

### ファイル構造

再編後 (#1334。初回起動時にアプリが旧配置から移す):

```
appDataDir/
├── layout.json5        # 配置の版印（無ければ旧配置として読む）
├── notecli.db          # SQLite（アカウント/サーバー情報・ノートキャッシュ）。同期させない
├── api-token           # 公開 API の生のトークン（notecli README の公開仕様。動かさない）
├── config/             # 設定 = 持ち出す単位。Git / dotfiles マネージャで管理できる（公開前提ではない）
│   ├── .gitignore          # 雛形（無ければ書く）
│   ├── settings.json5      # スカラー preferences（後述）
│   ├── locale.json5        # 表示言語（#135）
│   ├── keybinds.json5      # キーバインド
│   ├── navbar.json5        # ナビバー構成（プロファイルから独立）
│   ├── performance.json5   # パフォーマンス
│   ├── postform.json5      # 投稿フォーム構成
│   ├── ai.json5            # AI 設定（使用する Vault 接続とモデル名。キー本体は持たない）
│   ├── tasks.json5         # タスク定義
│   ├── permissions.json5   # principal 別の認可の方針（#712。確認の結果は state/ 側）
│   ├── connections.json    # Secret Vault の接続の定義（同意と鍵の有無は state/ 側）
│   ├── custom.css          # カスタム CSS
│   ├── profiles/           # *.ndprofile.json5（窓の配置と一時入力は state/deck/ 側）
│   ├── themes/             # *.ndtheme.json5（素の *.json5 は起動時に一回きりコピーして採用）
│   ├── plugins/            # *.is + *.meta.json5
│   ├── widgets/            # *.is + *.meta.json5
│   ├── skills/             # *.md
│   ├── snippets/           # *.json5
│   └── queries/            # カラムクエリ
├── data/               # 人の記録（他人の本文を含む。同期は案内しない）
│   ├── memos/              # *.md
│   ├── sessions/           # AI セッション（0600）
│   └── notemaid/           # AI の人格と記憶（SOUL.md / USER.md / MEMORY.md / BOOTSTRAP.md、#1162）
├── state/              # この機械の状態。同期・バックアップの対象外
│   ├── ui.json5                # ペットの位置 / ズーム / 投稿フォームの前回値（#1333）
│   ├── deck/<profile id>.json5 # 窓の配置（windows[]）とカラムの一時入力（windowId / query / …）
│   ├── connections-meta.json   # 接続の同意（開示・信頼・loopback）/ 鍵の有無 / 時刻
│   ├── permissions-meta.json5  # 「今後確認しない」の記憶と前回起動時の実効権限の写し
│   ├── loopback-consent.json   # プラグインの loopback 同意（#1293）
│   ├── client.json5            # この端末の構成（notemaid の起動方法、#1106）
│   ├── tutorial.json5          # チュートリアルの達成記録（#1029。resetAt からの導出で機械ごと）
│   ├── theme-dropins.json5     # themes/ の素の .json5 を取り込んだ記録（元ファイル名 → 採用 ID）
│   ├── notify_cursor.json / push_state.json  # Android の通知の処理位置と push の状態
│   ├── history/<subdir|root>/<base>.history.json5  # 編集前 snapshot のサイドカー
│   ├── notemaid/               # notemaid の状態（turns/ チェックポイント、workspace/ 手元の CLI の cwd）
│   ├── notemaid.lock           # 常駐の排他（旧配置の root 直下のロックも併せて押さえる）
│   └── secrets/                # 0700: api-tokens.json（ハッシュと scope）、notemaid-accounts.json
├── cache/              # 消してよい（images/ emoji/ pets/）
├── logs/               # notemaid のログ（アプリ本体は Tauri の app_log_dir()）
└── backups/pre-layout-<stamp>/   # 移行前の自動退避（設定バンドルと DB の写し。次の版まで）
```

**置き場の判断** (#1334): 「別の機械に持っていって意味があるか (config)」「人の記録か (data)」「この機械・この起動の状態か (state)」「消しても作り直せるか (cache)」の順で問い、迷ったら state。config の中には config しか無い (除外リストが要らない状態を保つ)。DB はどこにも同期させず、持ち出しはバックアップ経由。`notemaid/secrets.enc` (Linux の常駐の file secrets) だけは notemaid の secrets モジュールが場所を持つので再編の対象外。配置を知るのは `crates/notecore/src/app_dir.rs` の `Layout` だけで、版印に従って旧配置 / 再編後を選ぶ。

いずれもテキストエディタで直接編集でき、アプリ内の対応する編集ウィンドウからも編集できる。許可されるサブディレクトリ名とルートファイル名は `crates/notecore/src/settings_store.rs` の allowlist が正本で、設定バックアップの対象もここで決まる (`backup: true` のものだけ)。各エントリは置き場 (`area`: 設定 / 人の記録 / この機械の状態。物理的な場所は `app_dir.rs` の `Layout` が決める) と、汎用の読み書きで触れるか (`ipc`) を持つ。`connections.json` は allowlist に載るが `ipc: false` で、変更口は Vault のコマンドだけ。`notemaid/` は汎用の読み書きが allowlist だけで通り上限・承認・汚染の規則を素通りするので allowlist に足さず、バックアップは SOUL / USER / MEMORY を名指しで含める (詳細は DEVELOPMENT.md の「AI の人格と記憶」)。ドットで始まるエントリ (`.git` / `.gitignore` / 書込中の一時ファイル) は allowlist・汎用の読み書き・バックアップのすべてで無視する。

**設定と状態の境界 (#1333)**: 「別の機械で消えたら驚くか」で引く。消えて驚くもの (カラム幅、ナビバー幅、いつも使うモデル) は設定で `notedeck/` に、その機械でその時に許した事実 (同意、鍵の有無、確認スキップ) とその機械の見え方 (窓の位置、ズーム、ペットの位置、投稿フォームの前回値) は状態で `state/` に置く。設定ファイルの書込は決定的 (同じ内容を読んで書けば同じバイト列。`src/services/json5Document.ts` と `json5_out::stringify` が整形の正本) で、読んだだけでは書かない。コメントは保持しない — アプリが再保存するとコメントは消える (JSON5 を AST で編集する実装は大きいので採らない)。

**appDataDir の場所:**

| OS | パス |
|----|------|
| Windows | `%APPDATA%\com.notedeck.desktop` |
| macOS | `~/Library/Application Support/com.notedeck.desktop` |
| Linux | `~/.local/share/com.notedeck.desktop` |

### ファイル形式の選定

| 形式 | 用途 | 理由 |
|------|------|------|
| JSON5 | `settings.json5` (スカラー preferences) / プロファイル / テーマ | VSCode `settings.json` 相当の立ち位置。フラット dot-notation、コメント可、trailing comma 可、Misskey テーマと互換 |
| CSS | カスタムCSS | そのまま。エディタのシンタックスハイライトが効く |
| AiScript (.is) | プラグイン | AiScript 標準拡張子 |

**ファイル名は `settings.json5`** — エクスポートバンドル `notedeck.json` との衝突を避けるため、拡張子は `.json5` を採用する。TOML/YAML は現状の設定構造では導入する積極的理由がないため不採用。

### settings.json5 — VSCode settings.json 相当の統合設定ファイル

NoteDeck のスカラー設定 (選択・トグル・ユーザー preferences) は単一ファイル `settings.json5` に集約する。VSCode の `settings.json` と同じ立ち位置:

- **フラット dot-notation キー空間**: `theme.manual`, `modes.realtime`, `mute.emojis` 等
- **GUI 設定エディタ ↔ raw JSON エディタの 2-way binding**: どちらから編集しても反映
- **不正値は schema のデフォルトにフォールバック**: 安全性

**settings.json5 に含まれるもの** (キー空間の正本は `src/settings/schema.ts`):

| カテゴリ | キー例 | 備考 |
|---|---|---|
| テーマ選択状態 | `theme.manual`, `theme.selectedDarkThemeId` | テーマ **定義** は `themes/*.ndtheme.json5` に別置き |
| モード | `modes.realtime`, `modes.offline` | |
| デック | `deck.wallpaper` | プロファイル **定義** は `profiles/*.ndprofile.json5` に別置き。アクティブプロファイルはウィンドウごとに切り替わるためファイルに持たない |
| ミュート | `mute.emojis` 等 | ワード / インスタンスミュートはサーバー側設定 |
| 投稿フォームの挙動 | `postForm.preview`, `postForm.rememberVisibility` 等 | ボタン構成そのものは `postform.json5` |
| キャッシュ | `cache.evictionPreset`, `chat.cacheEnabled` 等 | |

**settings.json5 に含まれないもの** (別ファイル):

| 対象 | 理由 |
|---|---|
| `themes/*.ndtheme.json5` | Misskey 互換フォーマット維持 — コミュニティテーマを `themes/` に drop するだけで使えるようにするため。素の `*.json5` は起動時にテーマとして解釈できたものだけ新しい ID の slug 名ファイルへ**コピーして採用**する（元ファイルは触らない・採用は一回きりで以後の編集は反映されない・シンボリックリンクは対象外）。再取り込みを防ぐ採用記録は `theme-dropins.json5`（[#1041](https://github.com/notedeck-dev/notedeck/issues/1041)） |
| `plugins/*.is` + `*.meta.json5` | Misskey AiScript プラグインフォーマット維持 |
| `snippets/*.json5` | VSCode スニペット互換フォーマット |
| `profiles/*.ndprofile.json5` | NoteDeck 独自だが複数存在するコレクション。肥大化回避 + 個別エクスポート導線 |
| `memos/*.md` | PKM 連携のため Markdown + YAML frontmatter で外部 vault (Obsidian/Logseq) として直接開ける形式 |
| `keybinds.json5` / `performance.json5` / `navbar.json5` / `postform.json5` / `tasks.json5` / `ai.json5` | スカラーではなく構造を持つ定義。それぞれ専用の編集ウィンドウがあり、単体でエクスポート・共有できる |
| `permissions.json5` | principal 別の認可 (#712)。capability から書き換えられない場所に隔離する必要がある |
| `custom.css` | CSS は JSON ではない。テキストエディタで直接編集 |
| `connections.json` | Secret Vault の接続の定義。Rust が source of truth。同意 / 鍵の有無 / 時刻は `state/connections-meta.json` (#1333) |
| アカウント情報・トークン | `notecli.db` と OS キーチェーン |

**設計原則の背景**: VSCode の `settings.json` は「設定全体」ではなく**スカラー preferences/toggles/selections** の集合。テーマ本体は extension フォルダに、keybindings は `keybindings.json` に、snippets は `.vscode/snippets/` に別置き。NoteDeck もこの構造に倣い、構造を持つ定義と Misskey 互換性が要件となる部分 (themes/plugins) は別ファイルのまま残す。

## プロファイル仕様（.ndprofile.json5）

### フォーマット

```json5
{
  id: "profile-1711100000000",
  name: "メイン作業用",
  createdAt: 1711100000000,
  columns: [
    {
      // Misskey 互換フィールド
      id: "col-1711100000000-1",
      type: "tl",
      name: null,
      width: 400,
      tl: "home",

      // NoteDeck 拡張フィールド
      accountId: "abc123",        // ローカルDB参照用
      account: "user@misskey.io", // ポータブル識別子
    },
  ],
  layout: [
    ["col-1711100000000-1"],       // 1カラム目（単独）
    ["col-2", "col-3"],           // 2カラム目（スタック: 縦積み）
  ],
  windows: [],                    // マルチウィンドウレイアウト
}
```

### Misskey 互換性

カラム定義は Misskey 本家の Column 型と互換。JSON は未知のフィールドを無視するため：

- **Misskey → NoteDeck**: `accountId` なし → デフォルトアカウントを割り当て
- **NoteDeck → Misskey**: 独自フィールド（`accountId`, `account`, `windowId` 等）は無視される

NoteDeck 独自の拡張フィールド (主なもの。正本は `src/stores/deck.ts` の `DeckColumn`):

| フィールド | 型 | 用途 |
|-----------|-----|------|
| `accountId` | `string` | ローカルDB のアカウントID参照 |
| `account` | `string` | `"user@host"` 形式のポータブル識別子 |
| `windowId` | `string` | マルチウィンドウ割り当て |
| `query` | `string` | 検索カラムのクエリ |
| `filters` | `object` | タイムラインフィルタ |
| `clipId` | `string` | クリップID |
| `userId` | `string` | ユーザーカラムの対象ユーザー |
| `aiscriptCode` | `string` | AiScript カラムのコード |
| `flashId` | `string` | Misskey Play ID |
| `pageId` | `string` | Misskey Pages ID |

### 端末間ポータビリティ

`accountId` はローカル DB に依存するため端末間で一致しない。`account` フィールド（`"user@host"` 形式）を併記し、インポート時にローカルアカウントを逆引きする:

| ケース | 動作 |
|--------|------|
| 同一端末 | `accountId` でそのまま解決 |
| 別端末（NoteDeck） | `account` からローカル `accountId` を逆引き |
| Misskey 本家からのインポート | `accountId` なし → デフォルトアカウント割り当て |

## バックアップ

NoteDeck のデータは大きく2種類に分かれる:

| 種別 | 内容 | ファイル |
|------|------|----------|
| **DB** | アカウント・サーバー情報・キャッシュ | `notecli.db` |
| **設定** | `notedeck/` 以下のテキストファイル群 | 前掲のファイル構造を参照 |

### バックアップ対象の網羅原則

**原則**: 「バックアップされるもの = 設定」。localStorage のみにしかない設定が存在してはならない。

環境依存データ (アカウント情報・トークン) のみが明示的に除外される — 他環境での復元時に整合性を壊すため。アカウントは DB エクスポート側で扱う。

### アプリ内バックアップ（設定メニュー）

設定メニューの「データ」セクションから以下の操作が可能:

| 操作 | 対象 | 形式 | 備考 |
|------|------|------|------|
| **DB エクスポート** | `notecli.db` | SQLite | アカウント・サーバー情報の完全バックアップ |
| **DB インポート** | `notecli.db` | SQLite | SQLiteヘッダ検証付き。インポート後アプリ再起動 |
| **設定エクスポート** | `notedeck/` 以下のテキストファイル群 | JSON | allowlist されたルートファイルとサブディレクトリを、キー→値の JSON バンドルとして出力 |
| **設定インポート** | 同上 | JSON | パストラバーサル防止・ホワイトリスト検証付き。インポート後アプリ再起動 |

**セキュリティ:**
- DB インポート: SQLite マジックバイト（`SQLite format 3\0`）を検証。WAL/SHM ファイルも自動クリーンアップ
- 設定インポート: `..` や絶対パスを含むエントリを拒否。許可されたディレクトリ/ファイル名のみ展開

バックアップ対象は `settings_store.rs` の `SUBDIRS` / `ROOT_FILES` (`backup: true` のもの) に、名指しで含める `notemaid/` の SOUL / USER / MEMORY を足したもの。設定ファイルを追加するときは、この allowlist に載せないとバックアップから漏れる。allowlist の各エントリは置き場 (`area`: config / data / state、物理的な場所は `app_dir.rs` の `Layout` が決める) と `ipc` (汎用の list / read / write / delete / rename で触れるか。AI セッションと Vault の `connections.json` は false で、専用の構造化操作だけが書く) も持つ (#1333)。

### 手動バックアップ

1. **ディレクトリコピー** — `appDataDir/` 以下をそのままコピー（最も確実）
2. **個別ファイル編集** — テキストエディタで JSON5/CSS を直接編集し、再起動で反映

### 設定フォルダは Git で管理する (#1333 / #1334。2026-11-09 に Git を一級と決めた)

`config/` はそのまま `git init` して管理できる (再編前は `notedeck/`)。config の中には設定しか無いので、起動時に置く `.gitignore` の雛形は書込中の一時ファイルを除外するだけ (再編前の雛形は編集履歴・この機械の記録・AI セッションとメモ・人格と記憶も除外していた)。記録は `data/`、状態は `state/` に分かれている。プロファイルのファイルにはこの機械の UUID を書かず `account: user@host` だけを書くので、2 台で同じリポジトリを使っても差分が往復しない。ファイル単位のシンボリックリンク (GNU stow 等) は設定として読み、保存はリンクの向き先に書く。

**同期ソフト (Dropbox 等) は一級にしない。** Git の `pull` は利用者が打つ操作なので「アプリと常駐を閉じてから」で成立するが、同期ソフトの書き戻しはアプリを開いている最中に届き、2 台で同時に開けば last-writer-wins から原理的に抜け出せない。一級にするには外部変更の watcher、競合コピーの検出と選択 UI、同一フォルダの多重起動の排他が要り、それでも同時編集は保証できない。利用者の方針 (dotfiles は Git、ドキュメントは同期ソフト) とも合うので、同期ソフトは「できるが保証しない」(書く端末は 1 台、競合コピーは読み飛ばして知らせる、`data/` は向けない) と案内するに留める。

- **設定ファイルは「持ち出す単位」であって「公開してよい」ではない。** アカウントの紐付け (`user@host`、監視対象の ID)、外部サービスの URL、実行されるコード (plugins / widgets / skills)、権限の方針が入る。公開リポジトリに置かない
- **`git pull` や外部エディタでの変更はアプリと常駐 notemaid を閉じてから。** 設定ファイルの外部変更を拾う watcher は無く、開いたまま pull すると次の操作で写しが書き戻して pull 分が消える (HEARTBEAT の `ai.json5` 書き戻しも同じ)。**watcher は作らない** (不採用、2026-11-09): Git 一級なら `pull` の前にアプリを閉じるだけで足り、watcher が本当に要るのは同期ソフトを一級にしたときだけ。自分の書込の除外・エディタの多重イベント・書込途中の読取という保守対象を増やす見返りが無い
- **別の機械で clone して起動したとき**: 接続は定義だけが立ち、鍵と同意は無い (使おうとした時に設定画面が求める)。カラムとアカウントの結び付けは `account: user@host` でその機械のアカウントに再結合する (#1332)

### 端末間同期（シンボリックリンク方式、条件つき）

アプリ側にカスタムディレクトリ設定は実装しない。ユーザーがシンボリックリンクで保存先をクラウドストレージに向けることはできるが、上の「同期ソフトは一級にしない」のとおり保証はしない (書く端末は 1 台、別の端末の変更は再起動まで反映されない、競合コピーは読み飛ばして知らせる):

```bash
# 例: config/profiles/ を Dropbox に同期
ln -s ~/Dropbox/notedeck/profiles ~/.local/share/com.notedeck.desktop/config/profiles
```

`data/` (AI セッション / メモ / 人格と記憶) を同期ソフトに向けることはできるが**案内はしない**: 他人の本文 (フォロワー限定・DM を含む) と未投稿の下書き、AI が観測した利用者像が入るので暗号化されないクラウドには置かない。2 台で同時に開くとセッションは先に列挙された版が勝ち、MEMORY.md は後勝ちで片方が消える (「書く端末は 1 つ」が前提)。`state/` `cache/` `logs/` `notecli.db` は同期しない。

この方式の利点:
- アプリ側のコード追加不要
- `profiles/` だけ、`themes/` だけ、といった粒度の選択がユーザー側で自由
- Dropbox/OneDrive/Google Drive/Syncthing/Git/NAS 等、何でも使える
- アプリが知らないストレージサービスにも対応

### マイグレーション

設定の保存先が変わったときは、旧レイアウトを起動時に自動で引き継ぐ。

- **localStorage → ファイル**: 起動時にファイルが 0 件かつ localStorage にデータがあれば、テキストファイルとして書き出す。以降はファイルが source of truth (localStorage はキャッシュとして残す)
- **ファイル配置・拡張子の変更**: `run_fs()` (`crates/notecore/src/migrations.rs`) が DB を開く前に実行する。`.json` → `.json5` へのリネーム、loopback 同意と編集履歴の `state/` への移動等。設定に同居していた状態 (接続の同意、確認スキップ、プロファイルの窓の配置) は、それぞれの読み手が最初の読込で `state/` へ分ける (#1333)
- **config / data / state / cache への再編** (#1334、`crates/notecore/src/layout_migration.rs`): 移行するのは**アプリだけ**。版印 `layout.json5` が無ければ、まず常駐の notemaid (旧配置の書き手) を `notemaid.shutdown` で止め (再起動ではない。AppImage / Nix では常駐を起動し直せない)、止められたときだけ `.layout.lock` を blocking で取って動かす。daemon は lock を取った後・secret store を開く前に版印を見て `Layout` を選ぶだけで、自分では移行しない (旧版アプリの不在を確認できない)。Android は daemon が無いので worker も同じ入口を通す。規則は「エントリ単位で移動元があり移動先が無いときだけ `rename` (判定は `symlink_metadata`、リンクは辿らずリンクそのものを動かす、EXDEV の copy + remove は採らない)」「全か無か (途中で失敗したら逆順で戻し、旧配置のまま起動を続ける。エントリ単位の二重解決は作らない)」「`notedeck/` 自体がシンボリックリンクなら移行しない (中身を引き抜くと同期先から消える。設定画面ではなく起動時の知らせで、リンクを config/ と data/ に張り直してから再起動と案内)」「両方ある (旧版を起動した痕跡) ときは型ごとに併合: sessions / turns / memos は `updatedAt` の新しい方、MEMORY.md は行の和集合、それ以外は新を残して旧を `notedeck.old-<stamp>/` に退避して知らせる」「版印は全エントリ成功時にだけ書く」「`notemaid.lock` と `api-token` は動かさない」。移行前に `backups/pre-layout-<stamp>/` (0700) に設定バンドルと DB の写しを置く (保持は次の版まで)。**旧版へ戻すのは非対応** (β 方針): 旧版は `notedeck/` が無いので初回起動扱いになり、再び新版を起動すると「両方ある」規則で取り込む。知らせるのは操作が要る人だけ (リンク構成、退避が起きた人、常駐を止めた人、失敗した人)。不採用: Linux だけ XDG の 4 ディレクトリに分散 / cache を Tauri の `app_cache_dir()` に置く (root から導出できない場所が増える) / DB を `data/` に置く / `tutorial.json5` を config に残す / `notedeck/` の名前を残して中を分ける / 失敗時にエントリ単位で旧パスを読み続ける / daemon も移行者になる / 全員向けの移行通知
- **DB トークン → OS キーチェーン**: `run_db()` が DB 初期化後に実行する

各マイグレーションは前提条件を自分で確認する冪等な関数として書き、`run_fs()` / `run_db()` の末尾に追加する。再実行しても壊れないことが要件。

## ブラウザ・エディタパターンの導入方針

NoteDeck は Tauri（WebView）ベースのデスクトップアプリであり、Chrome / Vivaldi / VS Code 等の Electron / Chromium ベースアプリの UX パターンを積極的に取り入れる。以下は NoteDeck の既存概念とブラウザ・エディタの機能マッピング、および導入方針。

### 概念マッピング

| ブラウザ / エディタ | NoteDeck | 状態 |
|-------------------|----------|------|
| タブタイリング (Vivaldi) | カラム横並び表示 | ✅ アプリの本質 |
| Web パネル (Vivaldi) | ナビバー（左サイドバー） | ✅ 実装済み |
| アドレスバー / オムニボックス | コマンドパレット (Ctrl+K) | ✅ 実装済み |
| 戻る / 進む | カラム間の履歴ナビゲーション | ✅ 実装済み |
| タブ検索 (Ctrl+Shift+A) | コマンドパレットでカラム検索 | ✅ 実装済み |
| 縦タブ (Edge / Vivaldi) | ナビバー（既に縦配置） | ✅ 実装済み |
| キーボードショートカット | カスタマイズ可能なキーバインド | ✅ 実装済み |
| Spaces (Arc) | プロファイル切替 | ✅ 実装済み（メニュー経由） |
| コマンドパレット (VS Code) | コマンドパレット | ✅ 実装済み |
| Explorer (VS Code) | Workspace Explorer カラム | 採用しない (廃止) — 既存の設定 UI と導線が重複し、固有の価値がリネームだけだった。設定ファイルの直接編集は「ファイル → 設定フォルダを開く」で外部エディタに委ねる |
| Output パネル (VS Code) | Stream Inspector カラム | ✅ 実装済み |
| JSON Inspector (DevTools) | Raw JSON インスペクタウィンドウ | ✅ 実装済み |
| Settings Editor (VS Code) | settings.json5 Raw JSON エディタ | ✅ 実装済み |
| ブックマーク | お気に入り / クリップ | ✅ Misskey API 経由 |

### 階層構造

NoteDeck の UI は以下の階層で整理される。ブラウザ / エディタの概念と1対1で対応する:

```
┌─ Level 0: ウィンドウ（OS レベル）
│   = ブラウザウィンドウ / VS Code ウィンドウ
│
├─ Level 1: プロファイル（メニュー切替）
│   = 1ウィンドウ1プロファイル。メニューから切替
│
├─ Level 2: カラム（メインエリア横並び）
│   = Vivaldi タブタイリング / VS Code スプリットエディタ
│   1つのプロファイル内の複数ビュー
│
├─ Sidebar: ナビバー（左サイドバー）
│   = Vivaldi Web パネル / VS Code アクティビティバー
│   プロファイル切替を跨いで永続するショートカット
│
└─ Level 3: カラムタブ（ボトムバー）
    = Vivaldi タブスタック内のタブ一覧 / VS Code エディタグループ内タブ
    アクティブプロファイル内のカラム一覧
```

### 導入しないパターン

| 機能 | 出典 | 不採用理由 |
|------|------|-----------|
| ミニマップ | VS Code / Sublime | テキストエディタ特有。タイムラインの俯瞰には不向き |
| Split Diff | VS Code | 2つのタイムライン比較は SNS の文脈で意味をなさない |
| リーダーモード | Safari / Firefox | SNS の短文には不要 |
| マウスジェスチャー | Vivaldi | 実装コストに対してリターンが少ない |
| スナップレイアウト | Edge / Windows 11 | プロファイルで代替可能 |
