import { reactive, shallowReactive } from 'vue'
import { i18n } from '@/i18n'
import { labelTable } from '@/i18n/labelTable'
import type { ExposureTag } from '@/settings/exposure'
import type { BuiltinColumnType, ColumnType, DeckColumn } from '@/stores/deck'
import { commands, unwrap } from '@/utils/tauriInvoke'

export type ColumnGroup = 'account' | 'server' | 'tool'

export interface SelectableItem {
  id: string
  name: string
  avatarUrl?: string
  /** QuickPickItem に forward するサブテキスト (例: "by @alice") */
  description?: string
  /** QuickPickItem に forward するカテゴリグループ名 */
  group?: string
}

export interface SelectableSpec {
  /** DeckColumn 上の ID キー (listId, antennaId, channelId, clipId, userId) */
  idKey: keyof DeckColumn
  /** アイテム一覧取得 */
  fetch: (accountId: string) => Promise<SelectableItem[]>
  /** サーバー側検索 (対応するタイプのみ) */
  search?: (accountId: string, query: string) => Promise<SelectableItem[]>
  /** Misskey API の作成エンドポイント (例: 'clips/create') */
  createEndpoint?: string
  /** 作成時のデフォルト params */
  createDefaults?: Record<string, unknown>
  /** 選択されたアイテムからカラム名を派生 (既定: item.name) */
  formatName?: (item: SelectableItem) => string
}

export interface ColumnSpec {
  label: string
  icon: string
  group: ColumnGroup
  /** 認証不要で追加可能 (ゲスト/匿名 OK) */
  guestAllowed?: boolean
  /** accountId: null で横断するカラムを許可 */
  crossAccount?: boolean
  /** アカウント選択画面を必ず出す (「なし」も選べる) */
  accountOptional?: boolean
  /** アカウント選択をスキップし accountId=null で追加 */
  accountIndependent?: boolean
  /** PiP ウィンドウ化が可能 (既定: true。false を明示して opt-out) */
  pipEnabled?: boolean
  /** ワイドカラム対応 (最大幅 1200px) */
  wide?: boolean
  /** 追加時のデフォルト幅 (既定: 360) */
  defaultWidth?: number
  /** 追加時にマージされる extra props */
  defaultProps?: Partial<Omit<DeckColumn, 'id' | 'type'>>
  /** list/antenna/channel/clip/user のような選択式タイプ */
  selectable?: SelectableSpec
  /**
   * 固有の生成フローを持つため汎用の追加経路 (`column.add` capability) からは
   * 作れない。ウィジェット / AiScript / Play / ページのように「先に中身を
   * 作る」種別が該当する。
   */
  customAddFlow?: boolean
  /**
   * 追加導線に出す条件 (#1034)。既定 (未指定) は 'general' で常に出る。
   * 'developer' は開発者モードが有効なときだけ追加導線に現れる — デッキに
   * 既に置かれたカラムの描画は止めない。
   */
  exposure?: ExposureTag
}

// biome-ignore lint/suspicious/noExplicitAny: bindings の Result<T, E> と SelectableItem の橋渡し
const unwrapItems = (result: any): SelectableItem[] =>
  unwrap(result) as unknown as SelectableItem[]

interface RawRole {
  id: string
  name: string
  iconUrl: string | null
  displayOrder: number
}

// biome-ignore lint/suspicious/noExplicitAny: bindings の Result<T, E> から RawRole[] を取り出す
function unwrapRoles(result: any): SelectableItem[] {
  const roles = unwrap(result) as unknown as RawRole[]
  return [...roles]
    .sort((a, b) => (b.displayOrder ?? 0) - (a.displayOrder ?? 0))
    .map((r) => ({
      id: r.id,
      name: r.name,
      avatarUrl: r.iconUrl ?? undefined,
    }))
}

/**
 * 自分のクリップ + お気に入りクリップをマージして picker 候補にする。
 * Clips は Misskey 本家に `clips/my-favorites` API があるので List と違い
 * クライアント側キャッシュを持たずに素直に API を叩く。own と fav に同じ id
 * があったら own を優先して dedup。my-favorites 失敗時は own だけ返す。
 */
async function fetchClipsWithFavorites(
  accountId: string,
): Promise<SelectableItem[]> {
  const own = unwrap(await commands.apiGetClips(accountId))
  const ownItems: SelectableItem[] = own.map((c) => ({
    id: c.id,
    name: c.name,
    group: i18n.ts._columnPicker.myClips,
  }))
  let favItems: SelectableItem[] = []
  try {
    const fav = unwrap(await commands.apiGetMyFavoriteClips(accountId, {}))
    const ownIds = new Set(ownItems.map((i) => i.id))
    favItems = fav
      .filter((c) => !ownIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        group: i18n.ts._columnPicker.favorites,
        description: `by @${c.user.username}${c.user.host ? `@${c.user.host}` : ''}`,
      }))
  } catch {
    // my-favorites 取得失敗時は own だけにフォールバック
  }
  return [...ownItems, ...favItems]
}

/**
 * 自分のリスト + お気に入りリストをマージして picker 候補にする。
 * Misskey 本家に「お気に入りリスト一覧取得」API が無いため、NoteDeck 側で
 * favoritedListIds を settings.json にキャッシュし、各 ID を
 * users/lists/show?forPublic=true で個別解決する。own は group="マイリスト"、
 * fav は group="お気に入り" で区別。id 重複は own を優先、解決失敗の fav は
 * 黙ってスキップ (ネットワーク一時エラーでは消さない)。
 */
async function fetchListsWithFavorites(
  accountId: string,
): Promise<SelectableItem[]> {
  // 動的 import で循環依存を避ける (settings → … → registry の経路を作らない)
  const { useSettingsStore } = await import('@/stores/settings')
  const settingsStore = useSettingsStore()

  const ownList = unwrap(await commands.apiGetUserListsBy(accountId, {}))
  const ownItems: SelectableItem[] = ownList.map((l) => ({
    id: l.id,
    name: l.name,
    group: i18n.ts._columnPicker.myLists,
  }))

  const favMap = settingsStore.get('lists.favoritedIdsByAccount') ?? {}
  const favIds = (favMap[accountId] ?? []).filter((id) => id != null)
  const ownIds = new Set(ownItems.map((i) => i.id))

  const resolutions = await Promise.allSettled(
    favIds
      .filter((id) => !ownIds.has(id))
      .map(async (id) =>
        unwrap(
          await commands.apiGetList(accountId, {
            listId: id,
            forPublic: true,
          }),
        ),
      ),
  )
  const favItems: SelectableItem[] = []
  for (const r of resolutions) {
    if (r.status === 'fulfilled' && r.value) {
      favItems.push({
        id: r.value.id,
        name: r.value.name,
        group: i18n.ts._columnPicker.favorites,
      })
    }
  }
  return [...ownItems, ...favItems]
}

/**
 * 組込カラム種別の定義。`Record<BuiltinColumnType, _>` なので、種別を足して
 * ここに書き忘れるとコンパイルエラーになる (開いた registry では検査できない
 * 網羅性を、この 1 定数で維持する)。
 *
 * UI 表示順はこのオブジェクトの宣言順を用いる (group ごとに抽出)。
 */
const BUILTIN_COLUMN_REGISTRY: Record<BuiltinColumnType, ColumnSpec> = {
  // ============================================================
  // アカウント系
  // ============================================================
  timeline: {
    get label() {
      return i18n.ts._columns.timeline
    },
    icon: 'home',
    group: 'account',
    // 全アカウントはホーム / グローバルのみ (#1059)。同一ノートは束ねる (#1058)
    crossAccount: true,
    guestAllowed: true,
    defaultProps: { tl: 'home', name: null },
  },
  notifications: {
    get label() {
      return i18n.ts._columns.notifications
    },
    icon: 'bell',
    group: 'account',
    crossAccount: true,
    // ログアウト中でも追加可能。ログアウト中はローカルキャッシュ
    // (notificationCache) から read-only で履歴を読める。chat と同じ流儀。
    guestAllowed: true,
  },
  drive: {
    get label() {
      return i18n.ts._columns.drive
    },
    icon: 'cloud',
    group: 'account',
  },
  followRequests: {
    get label() {
      return i18n.ts._columns.followRequests
    },
    icon: 'user-plus',
    group: 'account',
    crossAccount: true,
  },
  list: {
    get label() {
      return i18n.ts._columns.list
    },
    icon: 'list',
    group: 'account',
    selectable: {
      idKey: 'listId',
      fetch: fetchListsWithFavorites,
      createEndpoint: 'users/lists/create',
    },
  },
  antenna: {
    get label() {
      return i18n.ts._columns.antenna
    },
    icon: 'antenna-bars-5',
    group: 'account',
    selectable: {
      idKey: 'antennaId',
      fetch: (aid) => commands.apiGetAntennas(aid).then(unwrapItems),
      createEndpoint: 'antennas/create',
      createDefaults: {
        src: 'all',
        keywords: [['']],
        excludeKeywords: [['']],
        users: [],
        caseSensitive: false,
        withReplies: false,
        withFile: false,
      },
    },
  },
  favorites: {
    get label() {
      return i18n.ts._columns.favorites
    },
    icon: 'star',
    group: 'account',
    // ログアウト中でも追加可能。ログアウト中は SQLite キャッシュ
    // (cacheKey='favorites') から履歴を読める。timeline と同じ流儀。
    // list/antenna/clip と違い ID 選択 picker が無いので素直に解放できる。
    guestAllowed: true,
    // 全アカウント = 各アカウントのお気に入りを並べる (#1017)。ID 選択が無く
    // 行キーは取得元アカウント + ノート ID の複合 (#1058) で足りる
    crossAccount: true,
  },
  clip: {
    get label() {
      return i18n.ts._columns.clip
    },
    icon: 'paperclip',
    group: 'account',
    selectable: {
      idKey: 'clipId',
      fetch: fetchClipsWithFavorites,
      createEndpoint: 'clips/create',
    },
  },
  mentions: {
    get label() {
      return i18n.ts._columns.mentions
    },
    icon: 'at',
    group: 'account',
    crossAccount: true,
    // ログアウト中でも追加可能。ログアウト中は SQLite キャッシュ
    // (cacheKey='mentions') から履歴を読める (#683)。chat と同じ流儀。
    guestAllowed: true,
  },
  specified: {
    get label() {
      return i18n.ts._columns.specified
    },
    icon: 'mail',
    group: 'account',
    crossAccount: true,
    // ログアウト中でも追加可能。ログアウト中は SQLite キャッシュ
    // (cacheKey='specified') から履歴を読める (#683)。chat と同じ流儀。
    guestAllowed: true,
  },
  chat: {
    get label() {
      return i18n.ts._columns.chat
    },
    icon: 'messages',
    group: 'account',
    crossAccount: true,
    // ログアウト中・ゲストアカウントでも追加可能。ログアウト中は
    // `chat_messages_cache` から履歴を読める (#460)。timeline と同じ流儀。
    guestAllowed: true,
  },
  achievements: {
    get label() {
      return i18n.ts._columns.achievements
    },
    icon: 'medal',
    group: 'account',
    // NoteDeck 独自実績 (#1029) はアカウントに紐づかないので、ログイン前でも
    // 見られる必要がある。サーバー実績タブはログアウト時の表示に従う
    guestAllowed: true,
  },

  // ============================================================
  // サーバー系
  // ============================================================
  serverInfo: {
    get label() {
      return i18n.ts._columns.serverInfo
    },
    icon: 'server',
    group: 'server',
    guestAllowed: true,
  },
  aboutMisskey: {
    get label() {
      return i18n.ts._columns.aboutMisskey
    },
    icon: 'info-circle',
    group: 'server',
    guestAllowed: true,
  },
  emoji: {
    get label() {
      return i18n.ts._columns.emoji
    },
    icon: 'mood-smile',
    group: 'server',
    guestAllowed: true,
  },
  ads: {
    get label() {
      return i18n.ts._columns.ads
    },
    icon: 'ad-2',
    group: 'server',
    guestAllowed: true,
  },
  explore: {
    get label() {
      return i18n.ts._columns.explore
    },
    icon: 'compass',
    group: 'server',
    guestAllowed: true,
  },
  announcements: {
    get label() {
      return i18n.ts._columns.announcements
    },
    icon: 'speakerphone',
    group: 'server',
    guestAllowed: true,
  },
  search: {
    // Misskey サーバー側の検索 (各アカウントの notes/search)。キャッシュから引く
    // 「クライアント検索」(#945 / #958) とは別の面で並立する (#1058)
    get label() {
      return i18n.ts._columns.search
    },
    icon: 'search',
    group: 'server',
    guestAllowed: true,
    crossAccount: true,
  },
  clientSearch: {
    // 手元のキャッシュ (SQLite) をサーバー・アカウント横断で引く (#945 / #958)。
    // サーバー検索と並立する別の面。アカウントに紐づかず、ログアウト中でも動く
    get label() {
      return i18n.ts._columns.clientSearch
    },
    icon: 'archive',
    group: 'tool',
    guestAllowed: true,
    accountIndependent: true,
    defaultProps: { accountId: null, query: '' },
  },
  lookup: {
    get label() {
      return i18n.ts._columns.lookup
    },
    icon: 'world-search',
    group: 'server',
    guestAllowed: true,
    crossAccount: true,
  },
  channel: {
    get label() {
      return i18n.ts._columns.channel
    },
    icon: 'device-tv',
    group: 'server',
    guestAllowed: true,
    selectable: {
      idKey: 'channelId',
      fetch: (aid) => commands.apiGetChannels(aid).then(unwrapItems),
      search: (aid, q) => commands.apiSearchChannels(aid, q).then(unwrapItems),
    },
  },
  role: {
    get label() {
      return i18n.ts._columns.role
    },
    icon: 'badge',
    group: 'server',
    selectable: {
      idKey: 'roleId',
      fetch: (aid) => commands.apiGetRoles(aid).then(unwrapRoles),
      // サーバー側の検索 API が無いため、fetch 結果をクライアントサイドでフィルタする
      search: async (aid, q) => {
        const all = await commands.apiGetRoles(aid).then(unwrapRoles)
        const query = q.trim().toLowerCase()
        return query
          ? all.filter((r) => r.name.toLowerCase().includes(query))
          : all
      },
    },
  },
  gallery: {
    get label() {
      return i18n.ts._columns.gallery
    },
    icon: 'icons',
    group: 'server',
    guestAllowed: true,
  },
  play: {
    get label() {
      return i18n.ts._columns.play
    },
    icon: 'player-play',
    group: 'server',
    guestAllowed: true,
    customAddFlow: true,
  },
  page: {
    get label() {
      return i18n.ts._columns.page
    },
    icon: 'note',
    group: 'server',
    guestAllowed: true,
    customAddFlow: true,
  },
  user: {
    get label() {
      return i18n.ts._columns.user
    },
    icon: 'user',
    group: 'server',
    guestAllowed: true,
    selectable: {
      idKey: 'userId',
      fetch: (aid) =>
        commands.apiSearchUsersByQuery(aid, '', null).then(unwrapItems),
      search: (aid, q) =>
        commands.apiSearchUsersByQuery(aid, q, null).then(unwrapItems),
      formatName: (item) => item.name,
    },
  },
  charts: {
    get label() {
      return i18n.ts._columns.charts
    },
    icon: 'chart-line',
    group: 'server',
    guestAllowed: true,
  },
  federation: {
    get label() {
      return i18n.ts._columns.federation
    },
    icon: 'planet',
    group: 'server',
    guestAllowed: true,
  },

  // ============================================================
  // ツール系
  // ============================================================
  themeManager: {
    get label() {
      return i18n.ts._columns.themeManager
    },
    icon: 'palette',
    group: 'tool',
    guestAllowed: true,
    // accountId == null は「全アカウント集約 viewer」として機能する。
    // 他カラム (notifications 等) と同じ semantics で、ストア/ローカル
    // のテーマは全 logged-in account の installedFor に追加される。
    crossAccount: true,
  },
  pluginManager: {
    get label() {
      return i18n.ts._columns.pluginManager
    },
    icon: 'puzzle',
    group: 'tool',
    guestAllowed: true,
    // accountId == null は「全アカウント集約 viewer」として機能する
    // (themeManager と同様)。per-account カラムでは installedFor が当該
    // account を含むプラグインのみが表示・handler 発火される。
    crossAccount: true,
  },
  widget: {
    get label() {
      return i18n.ts._columns.widget
    },
    icon: 'layout-dashboard',
    group: 'tool',
    guestAllowed: true,
    // accountId == null は「全アカウント」widget カラムとして機能する
    // (themeManager / pluginManager と同じ semantics)。配置済 widget は
    // column.accountId を `Mk:api` に渡して使うため、null = 認証必須機能の
    // capability チェックで弾かれる仕様。
    crossAccount: true,
    customAddFlow: true,
    defaultProps: { widgets: [] },
  },
  queryManager: {
    get label() {
      return i18n.ts._columns.queryManager
    },
    icon: 'filter',
    group: 'tool',
    guestAllowed: true,
    // スコープ別プール (#1018)。全アカウントのカラムは全体スコープ、
    // per-account カラムはそのアカウントのスコープを管理する
    crossAccount: true,
  },
  memos: {
    get label() {
      return i18n.ts._columns.memos
    },
    icon: 'notes',
    group: 'tool',
    guestAllowed: true,
    // メモはサーバーに送らずローカルで完結し、同じくアカウントなしの AI カラム
    // からも参照される。アカウントに紐づけない (#1018)
    accountIndependent: true,
    defaultProps: { accountId: null },
  },
  // 「もっと」はこの並び順で出る。AI はスキル / スクラッチパッドの前
  ai: {
    get label() {
      return i18n.ts._columns.ai
    },
    icon: 'brain',
    group: 'tool',
    accountIndependent: true,
    defaultProps: { accountId: null },
  },
  skill: {
    get label() {
      return i18n.ts._columns.skill
    },
    icon: 'sparkles',
    group: 'tool',
    guestAllowed: true,
    accountIndependent: true,
    defaultProps: { accountId: null },
  },
  aiscript: {
    get label() {
      return i18n.ts._columns.aiscript
    },
    icon: 'terminal-2',
    group: 'tool',
    exposure: 'developer',
    guestAllowed: true,
    accountOptional: true,
    customAddFlow: true,
    defaultProps: { aiscriptCode: '<: "Hello, AiScript!"' },
  },
  apiConsole: {
    get label() {
      return i18n.ts._columns.apiConsole
    },
    icon: 'api',
    group: 'tool',
    exposure: 'developer',
  },
  apiDocs: {
    get label() {
      return i18n.ts._columns.apiDocs
    },
    icon: 'file-description',
    group: 'tool',
    exposure: 'developer',
    guestAllowed: true,
    accountIndependent: true,
    wide: true,
    defaultWidth: 990,
    defaultProps: { accountId: null },
  },
  streamInspector: {
    get label() {
      return i18n.ts._columns.streamInspector
    },
    icon: 'activity-heartbeat',
    group: 'tool',
    exposure: 'developer',
    crossAccount: true,
    wide: true,
  },
  taskRunner: {
    get label() {
      return i18n.ts._columns.taskRunner
    },
    icon: 'player-play',
    group: 'tool',
    exposure: 'developer',
    guestAllowed: true,
    accountIndependent: true,
    defaultProps: { accountId: null },
  },
}

// ============================================================
// レジストリ本体と派生 (#794 W2)
// ============================================================

/**
 * カラム種別の Single Source of Truth。組込 + 実行時登録分。
 *
 * shallowReactive: プラグインの登録/解除が Vue の computed に伝播する必要が
 * ある (プラグイン起動はデッキ復元より後なので、登録時点で UI は既に描画済み)。
 * ColumnSpec 自体は不変なので深い追跡は不要。
 */
export const COLUMN_REGISTRY = shallowReactive<Record<string, ColumnSpec>>({
  ...BUILTIN_COLUMN_REGISTRY,
})

const BUILTIN_TYPES: ReadonlySet<string> = new Set(
  Object.keys(BUILTIN_COLUMN_REGISTRY),
)

// 派生は「登録のたびに全再構築」する。派生ごとに差分更新すると、派生が 1 つ
// 増えるたびに更新漏れの面が増える (= #794 が解こうとしている、まだら化そのもの)。
// 全再構築なら rebuildDerived が唯一の同期点になる。
// いずれも reactive で、参照側の `.has()` / `[type]` / `.filter()` はそのまま
// 追跡される — 呼び出し側の書き換えが不要。

/** Registry 宣言順の全カラムタイプ */
export const ALL_COLUMN_TYPES: ColumnType[] = reactive([])

/** 種別 → 表示名。組込の表示名は辞書から引くので、参照した時点で引く (#135) */
export const COLUMN_LABELS: Record<string, string> = labelTable(
  () => Object.keys(COLUMN_REGISTRY),
  (type) => COLUMN_REGISTRY[type]?.label,
)

export const COLUMN_ICONS: Record<string, string> = reactive({})

export const GUEST_ALLOWED_TYPES: Set<ColumnType> = reactive(new Set())
export const CROSS_ACCOUNT_TYPES: Set<ColumnType> = reactive(new Set())
export const ACCOUNT_OPTIONAL_TYPES: Set<ColumnType> = reactive(new Set())
export const ACCOUNT_INDEPENDENT_TYPES: Set<ColumnType> = reactive(new Set())
export const WIDE_COLUMN_TYPES: Set<ColumnType> = reactive(new Set())

/**
 * pipEnabled は組込では既定 true (false を明示して opt-out)。
 * 実行時登録されたカラムは既定 false — PiP は別 WebView で、プラグインの
 * インタプリタをどちら側で動かすかが未定のため (#794 未決事項 5)。
 */
export const PIP_ENABLED_TYPES: Set<ColumnType> = reactive(new Set())

export interface ColumnGroupInfo {
  group: ColumnGroup
  label: string
  icon: string
  types: ColumnType[]
}

/** AddColumnDialog / コマンドパレット双方が使う UI グループ定義 */
export const COLUMN_TYPE_GROUPS: ColumnGroupInfo[] = reactive([
  {
    group: 'account',
    get label() {
      return i18n.ts._common.account
    },
    icon: 'user',
    types: [],
  },
  {
    group: 'server',
    get label() {
      return i18n.ts._common.server
    },
    icon: 'server',
    types: [],
  },
  {
    group: 'tool',
    get label() {
      return i18n.ts._columnGroups.tool
    },
    icon: 'tool',
    types: [],
  },
])

const FLAG_SETS: ReadonlyArray<[keyof ColumnSpec, Set<ColumnType>]> = [
  ['guestAllowed', GUEST_ALLOWED_TYPES],
  ['crossAccount', CROSS_ACCOUNT_TYPES],
  ['accountOptional', ACCOUNT_OPTIONAL_TYPES],
  ['accountIndependent', ACCOUNT_INDEPENDENT_TYPES],
  ['wide', WIDE_COLUMN_TYPES],
]

function rebuildDerived(): void {
  const types = Object.keys(COLUMN_REGISTRY)

  ALL_COLUMN_TYPES.length = 0
  ALL_COLUMN_TYPES.push(...types)

  for (const key of Object.keys(COLUMN_ICONS)) delete COLUMN_ICONS[key]
  for (const [, set] of FLAG_SETS) set.clear()
  PIP_ENABLED_TYPES.clear()
  for (const g of COLUMN_TYPE_GROUPS) g.types.length = 0

  for (const type of types) {
    const spec = COLUMN_REGISTRY[type]
    if (!spec) continue
    COLUMN_ICONS[type] = spec.icon
    for (const [flag, set] of FLAG_SETS) {
      if (spec[flag]) set.add(type)
    }
    const pipDefault = BUILTIN_TYPES.has(type)
    if (spec.pipEnabled ?? pipDefault) PIP_ENABLED_TYPES.add(type)
    COLUMN_TYPE_GROUPS.find((g) => g.group === spec.group)?.types.push(type)
  }
}

rebuildDerived()

export function isColumnType(value: unknown): value is ColumnType {
  return typeof value === 'string' && value in COLUMN_REGISTRY
}

/**
 * カラム種別を実行時登録する (#794 W2)。
 *
 * 衝突は先勝ちで拒否する — 後勝ち上書きだと、あるプラグインが別のプラグインや
 * 組込カラムを黙って乗っ取れてしまう (#794 未決事項 2)。組込 ID 空間は予約。
 *
 * @throws 組込 ID または登録済み ID を指定した場合
 */
export function registerColumnType(type: string, spec: ColumnSpec): void {
  if (BUILTIN_TYPES.has(type)) {
    throw new Error(`column type "${type}" is reserved by NoteDeck`)
  }
  if (type in COLUMN_REGISTRY) {
    throw new Error(`column type "${type}" is already registered`)
  }
  COLUMN_REGISTRY[type] = spec
  rebuildDerived()
}

/**
 * 登録を解除する。未登録 ID は no-op — プラグイン停止時の一括解除が二重に
 * 走っても安全にするため (原則 5)。
 *
 * @throws 組込 ID を指定した場合
 */
export function unregisterColumnType(type: string): void {
  if (BUILTIN_TYPES.has(type)) {
    throw new Error(`column type "${type}" is builtin and cannot be removed`)
  }
  if (!(type in COLUMN_REGISTRY)) return
  delete COLUMN_REGISTRY[type]
  rebuildDerived()
}

/**
 * カラムの既定幅。ナビバーをアイコンのみ (80px) に畳んだ 1920px 幅の画面で、
 * カラムが 5 本並んでも横スクロールが出ない値にしている:
 * 80 + 左右 padding 12 + gap 6×9 + 列リサイズハンドル 4×5 + 350×5 = 1916px。
 */
export const DEFAULT_COLUMN_WIDTH = 350

/**
 * カラム追加時の共通デフォルト。呼び出し側は type/accountId を指定するだけでよい。
 * `defaultProps` が `accountId` を含む場合はそれが優先される (accountIndependent 用)。
 */
export function buildColumnDefaults(
  type: ColumnType,
  accountId: string | null,
): Omit<DeckColumn, 'id' | 'type'> {
  // 未登録種別でも追加自体は成立させる (種別名を仮のカラム名にして tombstone を
  // 描画する)。ここで throw すると、プラグイン起動前のデッキ復元が壊れる
  const spec = COLUMN_REGISTRY[type]
  return {
    name: spec?.label ?? type,
    width: spec?.defaultWidth ?? DEFAULT_COLUMN_WIDTH,
    accountId,
    active: true,
    ...spec?.defaultProps,
  }
}
