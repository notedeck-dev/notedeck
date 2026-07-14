# NoteDeck Strategy

## ポジショニング

NoteDeck は Misskey とそのフォークに対応した **Misskey 統合デッキ環境 (IDE: Integrated Deck Environment)** である。
対外ブランディングは **Misskey Pro** — X Pro（旧 TweetDeck）と同様に「ヘビーユーザー向け」を一語で伝え、ストア検索で Misskey の語に引っかける（詳細は [BRANDING.md](BRANDING.md)）。
閲覧（ブラウザ）・投稿（エディタ）・検索（データベース）・連携（API ハブ）を統合し、
notecli（Rust コアエンジン）の上に WebView ベースの統合フロントエンドを提供する。

- **ターゲット**: 複数サーバーのタイムラインを効率よく閲覧・管理し、AI / 外部ツールで自分の SNS 環境を自動化したいユーザー
- **対象プラットフォーム**: Windows / macOS / Linux / Android
- **ゴール**: 日常操作の 80% を NoteDeck 内で完結させ、Web UI を開く頻度を最小化する。さらに **AI と外部ツールから駆動できるプラットフォーム** として、Misskey エコシステムのハブを目指す

### プラットフォームごとの体験

- **デスクトップ**: デッキ UI（複数カラム同時表示）、キーボード操作、ローカル検索、AI 統合
- **モバイル**: シングルカラム + タブ切替による軽快な閲覧体験。デッキの全カラムにアクセス可能（AI 機能含む）

---

## フォーク対応方針

NoteDeck は **Misskey 本家および「Misskey を名乗り続けるフォーク」** に対応する。
yamisskey や misskey-tempura のような、Misskey の名前・API 体系を維持しつつ独自拡張を加えるフォークが対象。

**対応しないもの:** Sharkey・CherryPick・Firefish・Iceshrimp 等の、Misskey から名前が別物になるレベルの派生。
サポート対象ソフトウェアが乖離しすぎると負担が増大し、サポートが破綻しかねない。
また、Misskey ユーザーの大半は日本人であり、これらの大型フォークへの対応は優先度が低い。

---

## 他のサードパーティクライアントとの棲み分け

### Aria との関係

Misskey サードパーティクライアントとしては **Aria**（Flutter 製）が先行しており、
iOS / Android / デスクトップの全プラットフォームをカバーしている。
NoteDeck は Aria と競合するのではなく、アプローチの違いによる棲み分けを目指す。

- **Aria**: Flutter で全プラットフォームを統一的にカバー。モバイルに強い
- **NoteDeck**: Tauri（Vue 3 + Rust）で全プラットフォーム対応。WebView + Rust の二層構造により、Web コンテンツ（MFM / OGP / Play）のネイティブ描画と OS 統合（ローカル DB / API ハブ / キーチェーン）を両立

### 機能比較

各プロジェクトの得意領域が異なる。NoteDeck は WebView + Rust の二層構造を活かし、
Misskey コンテンツの描画と OS 統合の両方をカバーする統合環境を目指す。

| | NoteDeck (Tauri) | Aria (Flutter) | Misskey Web (PWA) |
|---|---|---|---|
| **プラットフォーム** | | | |
| デスクトップ (Win/Mac/Linux) | ✅ | ✅ | ✅ ブラウザ |
| Android | ✅ 未署名 | ✅ | ✅ ブラウザ |
| iOS | ❌ 対応しない | ✅ | ✅ ブラウザ |
| **Misskey 機能** | | | |
| MFM レンダリング | ✅ | ✅ | ✅ |
| 数式レンダリング（KaTeX） | ✅ | ❌ | ❌（本家で削除済み） |
| クリップ | ✅ | ✅ | ✅ |
| アンテナ | ✅ | ✅ | ✅ |
| リスト管理 | ✅ | ✅ | ✅ |
| Misskey Play (AiScript) | ✅ 本家 AiScript 内蔵 | ✅ aiscript-rs 内蔵 | ✅（本家） |
| AiScript プラグイン | ✅ 予定 | ❌ | ✅（本家） |
| **デスクトップネイティブ機能** | | | |
| デッキ UI（マルチカラム） | ✅ | ❌ | ✅（デッキモード） |
| ローカル DB + FTS5 全文検索 | ✅ | ❌ | ❌ |
| localhost HTTP API（外部連携口） | ✅ port 19820 | ❌ | ❌ |
| システムトレイ常駐 | ✅ | ❌ | ❌ |
| グローバルホットキー | ✅ | ❌ | ❌ |
| OS キーチェーン連携 | ✅ | △ 限定的 | ❌ |
| マルチウィンドウ・マルチモニター | ✅ | ❌ | ❌ |
| 外部プロセス起動（Ollama 等） | ✅ | ❌ | ❌ |
| 自動アップデート（署名検証付き） | ✅ | △ ストア経由 | ❌ |

### パフォーマンス — ネイティブだから出せる軽さ

Tauri v2 + Rust バックエンドにより、ブラウザベースや Flutter ベースのクライアントと比較して桁違いのリソース効率を実現する。
これは単にフレームワークの恩恵ではなく、アプリケーション層で専用の最適化を積んでいる。

- **メモリ使用量**: ブラウザタブや Flutter ランタイムのオーバーヘッドがなく、圧倒的に軽量
- **起動時間**: ネイティブバイナリの即時起動。ブラウザ起動や VM 初期化の待ち時間がない

**主要な最適化:**
- **2 段階初期化**: DB 開放（Stage 1）で即座に UI 表示、HTTP / ストリーム初期化は Stage 2 でバックグラウンド実行
- **Adaptive Quality**: フレームレート EMA / P95 / Jank を毎秒計測し、CSS エフェクト（blur / shadow / animation）を動的に軽減・復帰
- **Frame Scheduler**: DOM read/write をバッチングして Layout Thrashing を排除。ワークがないフレームではループを停止し CPU ウェイクアップを回避
- **3 段階画像キャッシュ**: メモリ LRU（32 MB）→ ディスク（TTL 7 日）→ ネットワーク。ネガティブキャッシング（4xx: 24h, 5xx: 2min）で不要な再フェッチを削減
- **WebP 自動変換**: PNG/JPEG を WebP に変換して通信量とキャッシュサイズを削減
- **ホスト別サーキットブレーカー**: 連続失敗時に一時遮断（5 回 → 60 秒）し、障害サーバーへの無駄なリクエストを防止
- **tokio ワーカースレッド 4 固定**: デフォルト（CPU コア数）では過剰なため制限し、アイドル時メモリを削減

### オフラインファースト & データ所有権

ブラウザや他のクライアントは「サーバーに接続できなければ何も見えない」。
NoteDeck はローカル DB にノートを蓄積し、**サーバーが消えても投稿が手元に残る**設計を採る。

- **SQLite + WAL モード**: 高速書き込み、FTS5 全文検索でローカルノートを即座に発見
- **オフラインモード**: ストリーム接続を全停止し、キャッシュのみで閲覧。バッテリー消費を最小化
- **ワンファイルバックアップ**: `notecli.db` をコピーするだけで全データ（ノート・お気に入り・リアクション履歴）を完全復元
- **設定エクスポート / インポート**: JSON + DB ファイルでデッキレイアウト・テーマ・キーバインドを丸ごと移行
- **ログアウト後のデータ保持**: トークンのみ削除し、カラムとキャッシュは読み取り専用で保持。後から過去ノートをローカル検索で復旧可能

### ゲストモード — 試すハードルをゼロにする

NoteDeck はゲストモード（`userId: __guest__`）をサポートし、**アカウント登録なしで公開タイムラインを閲覧**できる。
「まずインストールして触ってみる → 気に入ったらログイン」という導線を設計し、新規ユーザーの獲得障壁を下げる。

### キーボード駆動 — パワーユーザーの生産性

- **コマンドパレット**（Ctrl+K / Cmd+K）: 30 以上のビルトインコマンドを検索・実行
- **全キーバインドカスタマイズ**: JSON5 で自由に再割り当て
- **グローバルホットキー**: Boss Key（Ctrl+Shift+B）でウィンドウを即隠し、Quick Note（Ctrl+Alt+N）でどこからでも即投稿
- デスクトップ SNS クライアントでコマンドパレット＋フルキーバインドカスタマイズを備えるものは他にない

### リッチコンテンツ表示

- **OGP 専用パーサー 16 種**: YouTube / Spotify / ニコニコ動画 / Pixiv / Amazon / Bluesky / TikTok / DLsite 等、URL を貼るだけでリッチプレビュー展開
- **MFM 全構文対応**: Misskey Flavored Markdown の関数記法・引用・中央揃え等すべてをレンダリング
- **KaTeX 数式レンダリング**: インライン・ブロック数式に対応（Web UI 本家では削除済み、Aria も未対応）
- **Shiki コードハイライト**: コードブロックの構文ハイライト

### localhost API — 最大の構造的優位

port 19820 の HTTP API は、Tauri の Rust バックエンド（Axum）だからこそ自然に載る。
Flutter / Web には原理的に不可能。この API を**外部ツール連携の正式プロトコル**に育てることで、
NoteDeck を Misskey エコシステムのハブにする。

```
連携例:
├── Raycast ワークフロー → ランチャーから直接投稿
├── Obsidian プラグイン → サイドバーに Misskey の関連ノートを表示
├── VS Code 拡張 → コード書きながらサイドバーで TL 監視
├── シェルスクリプト / cron → 定期キーワード検索 → 結果を通知
├── Hammerspoon / AutoHotKey → 選択テキストを即投稿
└── StreamDeck → 物理ボタンで投稿・TL 切替・ミュート
```

---

## サーバー運営者との共生

サードパーティクライアントがサーバー広告を無視すると、運営者から「ただ乗り」「広告回避ツール」
と見なされ、API ブロックや非推奨扱いを受けるリスクがある。
NoteDeck は**サーバー運営者を敵にしない**ことを設計原則とし、広告表示と支援導線を積極的に整備する。

**なぜこれが重要か:**
- 管理者が NoteDeck を推薦すれば、そのサーバーのユーザーが流入する（インフルエンサー効果）
- **「広告を正しく表示するサードパーティクライアント」は現状ほぼ存在しない** → それ自体が差別化

| 行動 | サーバー管理者の反応 |
|---|---|
| 広告を無視（他のクライアントの現状） | 敵視 → API ブロック / 「非推奨」告知 |
| 広告を表示 | 好感 → 「NoteDeck おすすめ」告知 |
| 広告 + 支援導線 | **積極的推薦** |

### AI 機能のセキュリティ — なぜデスクトップアプリなら安全か

| 脅威 | Web アプリ | NoteDeck (Tauri) |
|---|---|---|
| XSS（スクリプト注入） | localStorage からキー窃取 | **WebView と Rust がプロセス分離。JS からキーチェーンにアクセス不可** |
| ブラウザ拡張 | ページの DOM を読める | **Tauri ウィンドウに拡張は入れない** |
| 開発者ツール | localStorage が丸見え | **フロントエンドにキーが存在しない** |
| ディスク上の保存 | localStorage = 平文 JSON | **OS キーチェーン = OS 暗号化** |

---

## AI 統合 — 自律エージェントとしての NoteDeck

NoteDeck の AI 統合は「AI とチャットする SNS クライアント」ではなく、**「AI 自律エージェントと自己拡張可能な IDE」** としての差別化を目指す。

### 設計の中核: Capability Registry

`Command` / HTTP API / CLI / AiScript / AI Tool calling の **5 経路が同一の Capability Registry を共有** する設計。コマンドパレットに追加したものが即 AI ツールにも公開される。69 個の builtin (notes / column / account / memos / theme / skills / widgets / plugins / ai / meta / clipboard / drive / http / time / user / notifications / tasks / ui / misstore / logs) を備える。

これにより以下の戦略的優位が生まれる:

- **UI 発見性と AI 拡張性が同じ仕組みで進化** — 新コマンド = 新 AI ツール
- **プラグインから本体 AI を呼べる** (`ai.chat` capability) — AI Actions プラグインで実用化
- **AiScript プラグインから capability を登録** — `Nd:register_command` の `options` 引数で型・権限・確認ダイアログを宣言、即 5 経路に公開

### Permission 設計 — Claude Code 流の preset

- `readonly` (default) / `safe` / `full` / `custom` の 4 段階プリセット
- AI に渡すデータソース (`<currentAccount>` / `<currentColumn>` / `<visibleNotes>` / `<recentConversation>` / `<memos>` / `<persona>`) を個別 on/off
- 書き込み系は確認ダイアログで dispatch 直前に enforce
- skill / widget / plugin / theme の自己改変系は **`aiTool:false` でデフォルト非露出** (構造的な安全弁)

### 自律エージェント: HEARTBEAT Daemon

`OpenClaw` 流の HEARTBEAT を実装。**アプリ起動中ずっと走る global daemon** が定期的に AI を起こし、ユーザー定義のチェックリストを実行する。重要な発見があれば会話セッションを生成し、なければ静かに `HEARTBEAT_OK` で終了。

- **Cheap Check First**: ローカルで低コスト判定 (未読数等) を行い閾値以下なら AI を呼ばない → トークン消費爆発の防止
- **専用 deny リスト**: 通常許可している `notes.write` 等を HEARTBEAT 中だけ deny にできる (暴走スパム防止)
- **silent fail 解消**: 連続 3 回失敗で daemon 自動 disable + warning toast

「リアクティブな AI チャット」から「常駐型アシスタント」への進化が他クライアントとの差別化軸となる。

### AI Persona と永続記憶

- **AI Persona**: `skill.isPersona` フラグで AI に固定の identity を持たせる。`<persona>` block で AI に「あなたは <displayName> として振る舞え」と指示
- **永続記憶 (memos)**: 専用 MEMORY 機構は作らず、**既存プリミティブの組み合わせ**で再現 — メモ + `dataSources.memos` + `memos.write` permission + `notedeck-memo` always skill の 4 要素
- AI が `memos.create` / `memos.update` で書き込み → 次ターンで `<memos>` として読み戻す = persistent memory の最小実装

### 自己拡張する IDE

skill / theme / widget / plugin を AI が編集できる capability 群を提供。全カテゴリで **編集履歴 + revert** (`*.history` / `*.revert`) を完備し、AI が誤って編集しても 1 capability で巻き戻せる。

これは「AI に好きなツールを作らせて自分の SNS 環境を育てる」という、他のクライアントが提供できない体験を狙う最重要差別化軸である。

---

## 配布戦略

### コード署名と信頼性

OSSアプリは署名なしだと「危険なアプリ」警告が表示され、一般ユーザーのインストールを阻害する。
無料で利用可能な仕組みを活用し、コストをかけずに信頼性を確保する。

| プラットフォーム | 課題 | 対策 |
|---|---|---|
| Windows | SmartScreen が未署名アプリをブロック | SignPath Foundation（OSS向け無料EV署名） |
| macOS | Gatekeeper 警告 | 対応見送り（$99/年の Apple Developer Program 必須） |
| Linux | 問題なし | パッケージマネージャ経由で信頼される |
| Android | Google Play は $25 必要 | F-Droid（無料、OSS審査あり） |

### 配布チャネル

| チャネル | プラットフォーム | コスト | 状態 |
|---|---|---|---|
| GitHub Releases | 全プラットフォーム | 無料 | ✅ 実施中 |
| AUR | Arch Linux | 無料 | ✅ 実施中 |
| NixOS | NixOS | 無料 | ✅ 実施中 |
| winget | Windows | 無料 | ✅ 対応済み |
| F-Droid | Android | 無料 | 検討中 |
| SignPath Foundation | Windows（署名） | 無料 | 検討中 |

**対応しないもの:** Homebrew — メンテナンスコストに対してユーザー数が見合わない。

---

## 持続可能な開発のための収益化

NoteDeck はオープンソース（AGPL-3.0）を維持しつつ、持続可能な開発を支援する仕組みを整備する。

**原則:**
- **アプリ内広告は入れない** — ユーザー体験を最優先。サーバー広告の表示は運営者への敬意であり、NoteDeck 自身の収益源ではない
- **コア機能は全て無料・オープンソース** — 機能制限（フリーミアム）はしない
- **寄付導線はバージョン情報画面のみ** — しつこいポップアップやアイコンは Apple 式思想に反する。知りたい人だけが辿り着ける場所に
- **モバイル対応（iOS / Android ストア公開）は採算が取れてから** — 審査費用・年間維持費（Apple: $99/年、Google: $25 一回）の壁があり、寄付で最低限の採算が見えるまでストア公開はしない

### 収益モデル

| モデル | 内容 | 検討状態 |
|---|---|---|
| GitHub Sponsors | 既存。導線を強化 | ✅ 実施中 |
| Sponsors 限定ベータ | 新機能を Sponsors に先行提供 | 検討中 |

### アプリ内寄付導線

しつこさゼロ。知りたい人だけが辿り着ける場所に置く。

- [x] **設定メニューに支援リンク** — 設定メニューのバージョン情報の上に「開発を支援する」リンク。
  GitHub Sponsors ページへの導線
- [x] **バージョン情報画面** — 開発者名・ライセンス・バージョン番号・支援リンクをまとめた専用画面（AboutDialog.vue）
