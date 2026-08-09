import type { Component } from 'vue'
import { defineAsyncComponent, reactive, shallowReactive } from 'vue'
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
  /** 非同期コンポーネントローダー */
  component: () => Promise<{ default: Component }>
  /** list/antenna/channel/clip/user のような選択式タイプ */
  selectable?: SelectableSpec
  /**
   * 固有の生成フローを持つため汎用の追加経路 (`column.add` capability) からは
   * 作れない。ウィジェット / AiScript / Play / ページのように「先に中身を
   * 作る」種別が該当する。
   */
  customAddFlow?: boolean
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
    group: 'マイクリップ',
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
        group: 'お気に入り',
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
    group: 'マイリスト',
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
        group: 'お気に入り',
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
    label: 'タイムライン',
    icon: 'home',
    group: 'account',
    guestAllowed: true,
    defaultProps: { tl: 'home', name: null },
    component: () => import('@/components/deck/DeckTimelineColumn.vue'),
  },
  notifications: {
    label: '通知',
    icon: 'bell',
    group: 'account',
    crossAccount: true,
    // ログアウト中でも追加可能。ログアウト中はローカルキャッシュ
    // (notificationCache) から read-only で履歴を読める。chat と同じ流儀。
    guestAllowed: true,
    component: () => import('@/components/deck/DeckNotificationColumn.vue'),
  },
  drive: {
    label: 'ドライブ',
    icon: 'cloud',
    group: 'account',
    component: () => import('@/components/deck/DeckDriveColumn.vue'),
  },
  followRequests: {
    label: 'フォローリクエスト',
    icon: 'user-plus',
    group: 'account',
    crossAccount: true,
    component: () => import('@/components/deck/DeckFollowRequestsColumn.vue'),
  },
  list: {
    label: 'リスト',
    icon: 'list',
    group: 'account',
    component: () => import('@/components/deck/DeckListColumn.vue'),
    selectable: {
      idKey: 'listId',
      fetch: fetchListsWithFavorites,
      createEndpoint: 'users/lists/create',
    },
  },
  antenna: {
    label: 'アンテナ',
    icon: 'antenna-bars-5',
    group: 'account',
    component: () => import('@/components/deck/DeckAntennaColumn.vue'),
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
    label: 'お気に入り',
    icon: 'star',
    group: 'account',
    // ログアウト中でも追加可能。ログアウト中は SQLite キャッシュ
    // (cacheKey='favorites') から履歴を読める。timeline と同じ流儀。
    // list/antenna/clip と違い ID 選択 picker が無いので素直に解放できる。
    guestAllowed: true,
    component: () => import('@/components/deck/DeckFavoritesColumn.vue'),
  },
  clip: {
    label: 'クリップ',
    icon: 'paperclip',
    group: 'account',
    component: () => import('@/components/deck/DeckClipColumn.vue'),
    selectable: {
      idKey: 'clipId',
      fetch: fetchClipsWithFavorites,
      createEndpoint: 'clips/create',
    },
  },
  mentions: {
    label: 'メンション',
    icon: 'at',
    group: 'account',
    crossAccount: true,
    // ログアウト中でも追加可能。ログアウト中は SQLite キャッシュ
    // (cacheKey='mentions') から履歴を読める (#683)。chat と同じ流儀。
    guestAllowed: true,
    component: () => import('@/components/deck/DeckMentionsColumn.vue'),
  },
  specified: {
    label: 'ダイレクト',
    icon: 'mail',
    group: 'account',
    crossAccount: true,
    // ログアウト中でも追加可能。ログアウト中は SQLite キャッシュ
    // (cacheKey='specified') から履歴を読める (#683)。chat と同じ流儀。
    guestAllowed: true,
    component: () => import('@/components/deck/DeckMentionsColumn.vue'),
  },
  chat: {
    label: 'チャット',
    icon: 'messages',
    group: 'account',
    crossAccount: true,
    // ログアウト中・ゲストアカウントでも追加可能。ログアウト中は
    // `chat_messages_cache` から履歴を読める (#460)。timeline と同じ流儀。
    guestAllowed: true,
    component: () => import('@/components/deck/DeckChatColumn.vue'),
  },
  achievements: {
    label: '実績',
    icon: 'medal',
    group: 'account',
    // NoteDeck 独自実績 (#1029) はアカウントに紐づかないので、ログイン前でも
    // 見られる必要がある。サーバー実績タブはログアウト時の表示に従う
    guestAllowed: true,
    component: () => import('@/components/deck/DeckAchievementsColumn.vue'),
  },

  // ============================================================
  // サーバー系
  // ============================================================
  serverInfo: {
    label: 'サーバー情報',
    icon: 'server',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckServerInfoColumn.vue'),
  },
  aboutMisskey: {
    label: 'Misskeyについて',
    icon: 'info-circle',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckAboutMisskeyColumn.vue'),
  },
  emoji: {
    label: 'カスタム絵文字',
    icon: 'mood-smile',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckEmojiColumn.vue'),
  },
  ads: {
    label: '広告',
    icon: 'ad-2',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckAdsColumn.vue'),
  },
  explore: {
    label: 'みつける',
    icon: 'compass',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckExploreColumn.vue'),
  },
  announcements: {
    label: 'お知らせ',
    icon: 'speakerphone',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckAnnouncementsColumn.vue'),
  },
  search: {
    label: '検索',
    icon: 'search',
    group: 'server',
    guestAllowed: true,
    crossAccount: true,
    component: () => import('@/components/deck/DeckSearchColumn.vue'),
  },
  lookup: {
    label: '照会',
    icon: 'world-search',
    group: 'server',
    guestAllowed: true,
    crossAccount: true,
    component: () => import('@/components/deck/DeckLookupColumn.vue'),
  },
  channel: {
    label: 'チャンネル',
    icon: 'device-tv',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckChannelColumn.vue'),
    selectable: {
      idKey: 'channelId',
      fetch: (aid) => commands.apiGetChannels(aid).then(unwrapItems),
      search: (aid, q) => commands.apiSearchChannels(aid, q).then(unwrapItems),
    },
  },
  role: {
    label: 'ロール',
    icon: 'badge',
    group: 'server',
    component: () => import('@/components/deck/DeckRoleColumn.vue'),
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
    label: 'ギャラリー',
    icon: 'icons',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckGalleryColumn.vue'),
  },
  play: {
    label: 'Misskey Play',
    icon: 'player-play',
    group: 'server',
    guestAllowed: true,
    customAddFlow: true,
    component: () => import('@/components/deck/DeckPlayColumn.vue'),
  },
  page: {
    label: 'ページ',
    icon: 'note',
    group: 'server',
    guestAllowed: true,
    customAddFlow: true,
    component: () => import('@/components/deck/DeckPageColumn.vue'),
  },
  user: {
    label: 'ユーザー',
    icon: 'user',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckUserColumn.vue'),
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
    label: 'チャート',
    icon: 'chart-line',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckChartsColumn.vue'),
  },
  federation: {
    label: '連合',
    icon: 'planet',
    group: 'server',
    guestAllowed: true,
    component: () => import('@/components/deck/DeckFederationColumn.vue'),
  },

  // ============================================================
  // ツール系
  // ============================================================
  themeManager: {
    label: 'テーマ',
    icon: 'palette',
    group: 'tool',
    guestAllowed: true,
    // accountId == null は「全アカウント集約 viewer」として機能する。
    // 他カラム (notifications 等) と同じ semantics で、ストア/ローカル
    // のテーマは全 logged-in account の installedFor に追加される。
    crossAccount: true,
    component: () => import('@/components/deck/DeckThemeManagerColumn.vue'),
  },
  pluginManager: {
    label: 'プラグイン',
    icon: 'puzzle',
    group: 'tool',
    guestAllowed: true,
    // accountId == null は「全アカウント集約 viewer」として機能する
    // (themeManager と同様)。per-account カラムでは installedFor が当該
    // account を含むプラグインのみが表示・handler 発火される。
    crossAccount: true,
    component: () => import('@/components/deck/DeckPluginManagerColumn.vue'),
  },
  widget: {
    label: 'ウィジェット',
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
    component: () => import('@/components/deck/DeckWidgetColumn.vue'),
  },
  queryManager: {
    label: 'クエリ',
    icon: 'filter',
    group: 'tool',
    guestAllowed: true,
    // クエリは純粋 (アカウント状態を参照しない) な全体プール (#783 追補 A)
    accountIndependent: true,
    defaultProps: { accountId: null },
    component: () => import('@/components/deck/DeckQueryManagerColumn.vue'),
  },
  skill: {
    label: 'スキル',
    icon: 'sparkles',
    group: 'tool',
    guestAllowed: true,
    accountIndependent: true,
    defaultProps: { accountId: null },
    component: () => import('@/components/deck/DeckSkillColumn.vue'),
  },
  aiscript: {
    label: 'スクラッチパッド',
    icon: 'terminal-2',
    group: 'tool',
    guestAllowed: true,
    accountOptional: true,
    customAddFlow: true,
    defaultProps: { aiscriptCode: '<: "Hello, AiScript!"' },
    component: () => import('@/components/deck/DeckAiScriptColumn.vue'),
  },
  apiConsole: {
    label: 'APIコンソール',
    icon: 'api',
    group: 'tool',
    component: () => import('@/components/deck/DeckApiConsoleColumn.vue'),
  },
  apiDocs: {
    label: 'APIドキュメント',
    icon: 'file-description',
    group: 'tool',
    guestAllowed: true,
    accountIndependent: true,
    wide: true,
    defaultWidth: 990,
    defaultProps: { accountId: null },
    component: () => import('@/components/deck/DeckApiDocsColumn.vue'),
  },
  streamInspector: {
    label: 'ストリーム',
    icon: 'activity-heartbeat',
    group: 'tool',
    crossAccount: true,
    wide: true,
    component: () => import('@/components/deck/DeckStreamInspectorColumn.vue'),
  },
  ai: {
    label: 'AI',
    icon: 'brain',
    group: 'tool',
    accountIndependent: true,
    defaultProps: { accountId: null },
    component: () => import('@/components/deck/DeckAiColumn.vue'),
  },
  memos: {
    label: 'メモ',
    icon: 'notes',
    group: 'tool',
    guestAllowed: true,
    // accountId == null は「全アカウント集約 viewer」として機能する。
    // 投稿フォームは隠れ、各メモは frontmatter に書かれた accountId で
    // 解決される。
    crossAccount: true,
    component: () => import('@/components/deck/DeckMemoColumn.vue'),
  },
  taskRunner: {
    label: 'タスク',
    icon: 'player-play',
    group: 'tool',
    guestAllowed: true,
    accountIndependent: true,
    defaultProps: { accountId: null },
    component: () => import('@/components/deck/DeckTaskRunnerColumn.vue'),
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

export const COLUMN_LABELS: Record<string, string> = reactive({})

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
  { group: 'account', label: 'アカウント', icon: 'user', types: [] },
  { group: 'server', label: 'サーバー', icon: 'server', types: [] },
  { group: 'tool', label: 'ツール', icon: 'tool', types: [] },
])

/** Vue コンポーネントマップ (PipPage / DeckColumnsArea から参照) */
export const COLUMN_COMPONENTS = shallowReactive<Record<string, Component>>({})

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

  for (const key of Object.keys(COLUMN_LABELS)) delete COLUMN_LABELS[key]
  for (const key of Object.keys(COLUMN_ICONS)) delete COLUMN_ICONS[key]
  for (const key of Object.keys(COLUMN_COMPONENTS))
    delete COLUMN_COMPONENTS[key]
  for (const [, set] of FLAG_SETS) set.clear()
  PIP_ENABLED_TYPES.clear()
  for (const g of COLUMN_TYPE_GROUPS) g.types.length = 0

  for (const type of types) {
    const spec = COLUMN_REGISTRY[type]
    if (!spec) continue
    COLUMN_LABELS[type] = spec.label
    COLUMN_ICONS[type] = spec.icon
    COLUMN_COMPONENTS[type] = defineAsyncComponent(spec.component)
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
    width: spec?.defaultWidth ?? 360,
    accountId,
    active: true,
    ...spec?.defaultProps,
  }
}
