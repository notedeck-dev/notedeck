/**
 * settings.json の型定義。VSCode `settings.json` と同じく、トップレベルは
 * フラット dot-notation キー空間 (`theme.manual`, `modes.realtime` 等)。
 *
 * 設計原則・長期ゴールは [DESIGN.md](../../DESIGN.md) の
 * 「settings.json — VSCode settings.json 相当の統合設定ファイル」節を参照。
 *
 * performance 設定は `performance.json5` に分離済み（独立ファイル）。
 * keybinds 設定は `keybinds.json5` に分離済み（独立ファイル）。
 * AI 設定は `ai.json5` に分離済み（独立ファイル）。システムプロンプトは skills/ 配下に統合。
 */
export interface NotedeckSettings {
  /** スキーマバージョン。破壊的変更時に bump してマイグレーションを行う。 */
  _schema: number

  // --- Theme (Next 1 移行済み、dual-write + reconcile) ---
  'theme.manual'?: 'dark' | 'light' | null
  'theme.selectedDarkThemeId'?: string | null
  'theme.selectedLightThemeId'?: string | null

  // --- Deck (Next 1 移行済み) ---
  'deck.wallpaper'?: string | null
  'deck.activeProfileId'?: string | null

  // --- Modes (PoC 移行済み) ---
  'modes.realtime'?: boolean
  'modes.offline'?: boolean

  // --- Post form ---
  'postForm.preview'?: boolean
  'postForm.autoSaveDraft'?: boolean
  'postForm.autoSaveMemo'?: boolean

  // --- Lists ---
  /**
   * アカウントごとにお気に入りしたリスト ID をキャッシュする。Misskey 本家に
   * 「お気に入りリスト一覧取得」API が存在しないので、NoteDeck 側で管理する。
   * ListDetailContent のお気に入りトグル操作時に同期する。他クライアントで
   * トグルした分は反映されない（既知の制限）。キー: accountId、値: listIds。
   */
  'lists.favoritedIdsByAccount'?: Record<string, string[]>

  // --- Cache eviction (notes_cache の自動掃除) ---
  /**
   * notes_cache の eviction プリセット。
   * - `search-priority`: 完全永続。検索 UX 最優先。`{ perAccountLimit: null, ttlDays: null }`
   * - `balanced`: notecli の `EvictionConfig::default()` 相当。暴走防止のみ。
   * - `storage-priority`: 古い 90 日 + 50000 件 cap。容量重視のヘビー掃除。
   * - `custom`: `cache.perAccountLimit` / `cache.ttlDays` をそのまま使う。
   */
  'cache.evictionPreset'?:
    | 'search-priority'
    | 'balanced'
    | 'storage-priority'
    | 'custom'
  /** preset='custom' のとき適用するアカウントごと note 上限。null = 無制限。 */
  'cache.perAccountLimit'?: number | null
  /** preset='custom' のとき適用する TTL (日)。null = 無期限。 */
  'cache.ttlDays'?: number | null

  // --- Chat cache (chat_messages_cache の自動掃除、#460) ---
  /**
   * チャット履歴をローカル DB にキャッシュするか。
   * - `true` (default): REST/WS で受信した chat メッセージを SQLite に upsert する
   * - `false`: 透過的にキャッシュを停止 (履歴は揮発、再起動で消える)
   */
  'chat.cacheEnabled'?: boolean
  /** アカウントごとの chat 件数上限。null = 無制限。default 1,000,000。 */
  'chat.perAccountLimit'?: number | null
  /** chat の TTL (日)。null = 無期限保持 (default)。 */
  'chat.ttlDays'?: number | null

  // keybinds は keybinds.json5 に分離済み（独立ファイル）
  // AI は ai.json5 に分離済み。システムプロンプトは skills/ に統合済み
}

/** 現在のスキーマバージョン。将来の破壊的変更時に bump する。 */
export const CURRENT_SCHEMA_VERSION = 1

/**
 * デフォルト設定値。未定義キーはすべてここにフォールバック。
 *
 * 原則: ソースコード内に散在している defaults は段階的にここに集約する
 * (`DESIGN.md` の「マイグレーション」節参照)。本 PR では realtimeMode /
 * offlineMode のみ。
 */
export const DEFAULT_SETTINGS: NotedeckSettings = {
  _schema: CURRENT_SCHEMA_VERSION,
  // 既存 realtimeMode ストアのデフォルトが true なので追従 (既存ユーザーの
  // 体験を変えない)
  'modes.realtime': true,
  'modes.offline': false,
  // notedeck の差別化要素「過去ノートを一瞬でローカル全文検索」を尊重し、
  // デフォルトは notecli の `EvictionConfig::default()` (= per-account 1M cap、
  // TTL なし) と同等のバランスプリセット。
  'cache.evictionPreset': 'balanced',
  // チャット履歴キャッシュは default ON (#460)。プライバシーで止めたい場合は
  // false にすれば WS/REST で受信した chat も DB に書かれない。
  'chat.cacheEnabled': true,
  'chat.perAccountLimit': 1_000_000,
  'chat.ttlDays': null,
}

/**
 * 未知のキーも forward-compat で保持する loose な型。
 * parseSettings が生 JSON を受け取る時に使う中間型。
 */
export type RawSettings = Record<string, unknown> & { _schema?: number }

/**
 * 生 JSON を NotedeckSettings に正規化する。型チェックは loose で、
 * 不正値はデフォルトにフォールバックする方針 (壊れたファイルで
 * アプリが起動不能にならないように)。
 *
 * 未知のキーは保持される (forward-compat)。スキーマバージョンの
 * マイグレーションはここで行う (現状は v1 のみ)。
 */
export function parseSettings(raw: unknown): NotedeckSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_SETTINGS }
  }
  const r = raw as RawSettings
  // 分離済みキーを除去（ai.json5, keybinds.json5, performance.json5 に移行済み）
  const cleaned: RawSettings = {}
  for (const [key, value] of Object.entries(r)) {
    if (key === 'ai' || key === 'keybinds' || key.startsWith('performance.')) {
      continue
    }
    cleaned[key] = value
  }
  return {
    ...DEFAULT_SETTINGS,
    ...cleaned,
    _schema: typeof r._schema === 'number' ? r._schema : CURRENT_SCHEMA_VERSION,
  }
}
