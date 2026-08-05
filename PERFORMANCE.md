# PERFORMANCE — パフォーマンス設計

NoteDeck に入っている最適化と、検討したうえで採用しないと決めた最適化をまとめる。
アーキテクチャ全体は [ARCHITECTURE.md](ARCHITECTURE.md) を参照。

閾値や上限値はここには書かない — ユーザー設定で変わるため、`src-tauri/src/perf_config.rs` の `PerformanceConfig` が正本。

---

## 実装済みの最適化

| 領域 | 実装 | 主要ファイル |
|------|------|-------------|
| 仮想スクロール | TanStack Vue Virtual + EMA 動的高さ推定 | `src/components/common/NoteScroller.vue` |
| Frame scheduling | 5 フェーズ Frame Engine (input/animate/read/write/idle) | `src/engine/frameEngine.ts` |
| 反応性制御 | `shallowRef` + `scheduleTrigger()` バッチ更新 | `src/stores/notes.ts` |
| ストリーミングバッチ | RAF バッファリング + emergency cap | `src/composables/useStreamingBatch.ts` |
| overflow 通知 | emergency cap 到達時に warning toast (取りこぼしをバグと誤認させない) | 同上 |
| 画像プリフェッチ | 先読み | `src/composables/useImagePrefetch.ts` |
| OGP キャッシュ | LRU | `src/composables/useOgpPreview.ts` |
| OGP inflight dedup | 同時リクエストの重複排除 | `src-tauri/src/ogp/mod.rs` |
| コード分割 | `defineAsyncComponent` による per-component 分割。`manualChunks` は書かない (#985: rolldown-vite では名前付きグループが共有モジュールを吸収して entry を肥大化させる)。出力は CI の `check:dist` で予算検査 | `vite.config.ts`, `scripts/check-dist-budget.mjs` |
| Multi-tier cache | メモリ LRU → ディスクキャッシュ → ネットワーク | `src-tauri/src/image_cache.rs` |
| 適応的品質 | CPU / メモリから low / balanced / high を自動判定 | `src/composables/useAdaptiveQuality.ts` |
| WebSocket 共有 | accountId 毎に 1 接続、subscriptionId で多重化 | `src/adapters/misskey/streaming.ts` |
| 2 段階初期化 | Phase 1 で最小構成を立ち上げ、Phase 2 を並行実行 | `src-tauri/src/lib.rs` |
| カラム遅延表示 | IntersectionObserver + paused 制御 | `src/composables/useColumnMount.ts` |
| 非表示カラムの購読停止 | 画面外カラムの購読を解除し、再表示時に sinceId 差分で追いつく | `src/composables/useNoteColumn.ts` |
| Query Subscription state machine | `Live` ↔ `Warm` ↔ `Suspended` を Rust `QueryRuntime` が自動遷移。ColumnMountRegistry の visibility に連動 | `src/composables/useColumnMount.ts`, `src-tauri/src/query_runtime.rs` |
| queryDelta の debounce | stream batch を Rust 側で時間窓にまとめて 1 回だけ emit | `src-tauri/src/query_runtime.rs` |
| フォント最適化 | Tabler Icons の動的サブセット (woff2) | Vite plugin |
| 楽観的リアクション | 即座に UI 更新 + API 失敗時ロールバック | `src/utils/toggleReaction.ts` |
| リジューム並行化 | `onResume()` でキャッシュと API を `Promise.all()` | `src/composables/useNoteColumn.ts` |
| 初回 connect 並行化 | キャッシュ即表示 + API はバックグラウンド fetch | 同上 |
| MFM Worker プリフェッチ | Web Worker でバッチパース → メインスレッドのキャッシュへ注入 | `src/composables/useMfmPrefetch.ts` |
| ノート重複排除 | `mergeSortedNotes` の ID dedup | `src/utils/sortNotes.ts` |
| Emoji grid 仮想化 | 行ベースの仮想スクロール | `src/composables/useGridVirtualizer.ts` |
| キャッシュ eviction 制御 | preset (省メモリ / バランス / 高パフォーマンス) + 個別調整 | `src/components/window/CacheEditorContent.vue` |
| Chat メッセージキャッシュ | ローカル DB cache + ログアウト後閲覧 + 起動時 hydrate + thread prefetch | `src/components/deck/DeckChatColumn.vue` + Rust `chat_messages_cache` |
| Memo link expand | `memo:<id>` markdown link で本文展開 + `referencedBy` 添付 | `src/composables/useAiSystemContext.ts` |
| Vapor Mode 対応 | 既知のブロッカーゼロ。errorHandler も `onErrorCaptured` へ移行済み | `src/composables/useVaporTransition.ts` |

### Rust 側の並列処理

| 領域 | 状況 | 手法 |
|------|------|------|
| OGP プリフェッチ | 並列 | `buffer_unordered` |
| 画像キャッシュ取得 | 並列 | `Semaphore` で同時数を制御 |
| 起動時初期化 | 並列 | DB / Client / HTTP を別スレッドで同時起動 |
| 起動計測 | performance.mark + About「起動パフォーマンス」(prod 唯一の計測面, #985) | `src/utils/startupTrace.ts` |
| WebSocket 接続 | 並行 | アカウントごとに独立管理 |
| API リクエスト | **直列** | 個々のコマンドは直列実行 |
| CPU 並列 (rayon 等) | **未使用** | — |

---

## 採用しない最適化

検討したうえで不採用と判断したもの。同じ提案を再検討しないための記録。

| 候補 | 出典 | 不採用理由 |
|------|------|-----------|
| マルチサーバー同時タイムライン取得 | Nostr 複数リレー | Vue の async mount で全カラムが十分短時間に並行開始することを実測で確認済み。追加の並列化は不要 |
| WebSocket 接続の集約 | — | 同一サーバーに複数アカウントを持つのは少数派。1 接続あたりのコストも小さい |
| 連合 URI ベースのノートデデュプ | ActivityPub | 重複の割合が小さく、節約できるメモリに対して `uri` 必須化のコストが大きい |
| オフラインキュー (Outbox) | ActivityPub | 楽観的更新は実装済み。オフライン状態での投稿は低頻度 |
| アダプティブプリフェッチ | TweetDeck | 現在の先読み量で足りている。高速スクロール時の画像遅延が報告されていない |
| Compositor-Only CSS 監査 | Web パフォーマンス | ジャンクが報告されていない。frameTelemetry で検出されてから着手する |
| ノート詳細の並列取得 | Rust 並列処理 | タイムラインより表示頻度が低く、notecli の API 変更が必要 |
| サーバーサイドフィルタリングの最大活用 | Bluesky Feed Generator | Misskey API のパラメータは既に渡しており、追加の効果が小さい |
| CID 風ハッシュ比較による resolve 最適化 | Bluesky AT Protocol | 現在の参照比較で足りる。複雑性に見合わない |
| LMDB デュアルストア | Nostr Gossip | SQLite がボトルネックである証拠がない |
| SharedArrayBuffer マルチウィンドウ | TweetDeck | Tauri イベントで共有済み。COOP/COEP 設定が複雑 |
| Service Worker オフライン | PWA 文化 | Tauri アプリでは Rust のキャッシュ層が同等の役割を果たす |
| Snowflake ID ソート最適化 | Twitter | 現在のリストサイズでは O(n) で十分 |
| L-1 キャッシュ層 (computed バイパス) | Twitter Manhattan | `skipTrigger` で部分的に実現済み |
| rayon による CPU 並列 | Rust エコシステム | 現在の worker 設定では効果が限定的。I/O バウンドが支配的 |
| 通知の複数サーバー同時ポーリング | Nostr 複数リレー | WebSocket 接続時は不要。フォールバック時のみ有効で優先度が低い |
| 連合グラフを使ったプリフェッチ | ActivityPub | `/api/federation/stats` の信頼性がサーバーごとに異なる |
| 分散キャッシュとしてのクライアント | ActivityPub | 差別化要素だが実装コストが巨大。長期構想として記録のみ |
| `resolve()` の spread 削除 | noteStore 最適化 | renote 参照の stale 検出に**必要**。別タイムライン経由の更新をカバーするため不可欠 |
| stream-event listener の Singleton 化 | — | 世代チェック + unlistenFns で既に堅牢。実運用のアカウント数ではオーバーヘッドが無視できる |
| ReactionPicker の仮想スクロール | grid 仮想化 | セクション折りたたみで既に遅延レンダリングされている |

サーバーヘルスモニタリング・サーバー機能差分の動的適応は、パフォーマンスではなく信頼性・正確性の改善として [ROADMAP.md](ROADMAP.md) 側で扱う。

---

## 知見の出典

### Bluesky / AT Protocol

- **AppView 分離**: データ加工をサーバー/バックエンド側に集約し、クライアントは表示に専念
- **Feed Generator**: サーバーサイドでフィード計算を完結させ、クライアントのフィルタリングコストをゼロに
- **Content-Addressed Storage (CID)**: 不変ハッシュによるキャッシュ。同一 CID = 安全に再利用
- **画面外コンテンツ完全アンマウント**: 復帰はインメモリキャッシュから瞬時復元

### Nostr

- **NIP-01 REQ/CLOSE**: 不要サブスクリプションの即時破棄でリレー負荷・クライアント処理負荷を最小化
- **Local Relay**: ローカルに NIP-01 互換リレーを立て、オフラインでもシームレスに動作
- **Relay Scoring**: Gossip/Damus のリレースコアリング。レイテンシ・可用性の EMA 追跡で最適リレー選択
- **Gossip (Rust 製)**: LMDB で zerocopy イベント読み書き。outbox model でユーザー毎の最適リレー追跡

### ActivityPub / 分散システム

- **楽観的書き込み (Optimistic UI)**: 非同期プロトコルの特性を活かし、ローカル即反映 + サーバー確認で reconcile
- **連合 URI デデュプ**: 複数サーバー経由で届く同一ノートを ActivityPub URI で重複排除
- **部分稼働**: 1 サーバーがダウンしても他サーバーのカラムは正常稼働（中央集権にはない利点）
- **分散キャッシュ**: クライアントが複数サーバーのデータを持つこと自体がクロスサーバー検索・耐障害性の基盤
- **機能差分適応**: サーバーごとの API 差異を動的に検出・適応する adapter 層の柔軟性

### 旧 Twitter OSS / TweetDeck

- **Finagle バックプレッシャー**: 処理しきれない場合の明示的ドロップ + 差分再取得フロー
- **Snowflake ID**: 時間ソート可能 64bit ID。ID 比較のみで時系列クエリ実現
- **Manhattan/Memcache マルチティア**: ホットデータの読み取りオーバーヘッド最小化
- **TweetDeck 高速スクロール**: スクロール速度に応じたアダプティブプリフェッチ
