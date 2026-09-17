// カラム種別 → Vue コンポーネントの対応表 (#1098)。
//
// 以前は columns/registry.ts の ColumnSpec に component ローダーが同居していて、
// レジストリ (stores / capabilities が参照するメタデータ) がデッキの全カラム
// コンポーネントを import する形になっていた。その結果 stores → registry →
// components → stores の循環に 147 ファイルが巻き込まれていた。描画の配線は
// presentation 層のここに置き、レジストリは component を知らない。
//
// `Record<BuiltinColumnType, _>` なので、組込種別を足してここに足し忘れると
// コンパイルエラーになる。

import { type Component, defineAsyncComponent, shallowReactive } from 'vue'
import type { BuiltinColumnType } from '@/stores/deck'

type Loader = () => Promise<{ default: Component }>

const BUILTIN_COLUMN_LOADERS: Record<BuiltinColumnType, Loader> = {
  timeline: () => import('@/components/deck/DeckTimelineColumn.vue'),
  notifications: () => import('@/components/deck/DeckNotificationColumn.vue'),
  drive: () => import('@/components/deck/DeckDriveColumn.vue'),
  followRequests: () =>
    import('@/components/deck/DeckFollowRequestsColumn.vue'),
  list: () => import('@/components/deck/DeckListColumn.vue'),
  antenna: () => import('@/components/deck/DeckAntennaColumn.vue'),
  favorites: () => import('@/components/deck/DeckFavoritesColumn.vue'),
  clip: () => import('@/components/deck/DeckClipColumn.vue'),
  mentions: () => import('@/components/deck/DeckMentionsColumn.vue'),
  specified: () => import('@/components/deck/DeckMentionsColumn.vue'),
  chat: () => import('@/components/deck/DeckChatColumn.vue'),
  achievements: () => import('@/components/deck/DeckAchievementsColumn.vue'),
  serverInfo: () => import('@/components/deck/DeckServerInfoColumn.vue'),
  aboutMisskey: () => import('@/components/deck/DeckAboutMisskeyColumn.vue'),
  emoji: () => import('@/components/deck/DeckEmojiColumn.vue'),
  ads: () => import('@/components/deck/DeckAdsColumn.vue'),
  explore: () => import('@/components/deck/DeckExploreColumn.vue'),
  announcements: () => import('@/components/deck/DeckAnnouncementsColumn.vue'),
  search: () => import('@/components/deck/DeckSearchColumn.vue'),
  clientSearch: () => import('@/components/deck/DeckClientSearchColumn.vue'),
  lookup: () => import('@/components/deck/DeckLookupColumn.vue'),
  channel: () => import('@/components/deck/DeckChannelColumn.vue'),
  role: () => import('@/components/deck/DeckRoleColumn.vue'),
  gallery: () => import('@/components/deck/DeckGalleryColumn.vue'),
  play: () => import('@/components/deck/DeckPlayColumn.vue'),
  page: () => import('@/components/deck/DeckPageColumn.vue'),
  user: () => import('@/components/deck/DeckUserColumn.vue'),
  charts: () => import('@/components/deck/DeckChartsColumn.vue'),
  federation: () => import('@/components/deck/DeckFederationColumn.vue'),
  themeManager: () => import('@/components/deck/DeckThemeManagerColumn.vue'),
  pluginManager: () => import('@/components/deck/DeckPluginManagerColumn.vue'),
  widget: () => import('@/components/deck/DeckWidgetColumn.vue'),
  queryManager: () => import('@/components/deck/DeckQueryManagerColumn.vue'),
  memos: () => import('@/components/deck/DeckMemoColumn.vue'),
  ai: () => import('@/components/deck/DeckAiColumn.vue'),
  skill: () => import('@/components/deck/DeckSkillColumn.vue'),
  aiscript: () => import('@/components/deck/DeckAiScriptColumn.vue'),
  apiConsole: () => import('@/components/deck/DeckApiConsoleColumn.vue'),
  apiDocs: () => import('@/components/deck/DeckApiDocsColumn.vue'),
  streamInspector: () =>
    import('@/components/deck/DeckStreamInspectorColumn.vue'),
  taskRunner: () => import('@/components/deck/DeckTaskRunnerColumn.vue'),
}

/** `<component :is>` で描くためのマップ (DeckStackCell / PipPage から参照) */
export const COLUMN_COMPONENTS = shallowReactive<Record<string, Component>>(
  Object.fromEntries(
    Object.entries(BUILTIN_COLUMN_LOADERS).map(([type, load]) => [
      type,
      defineAsyncComponent(load),
    ]),
  ),
)

/**
 * 実行時登録の種別 (#794 W2) にコンポーネントを結びつける。種別のメタデータは
 * `registerColumnType` (columns/registry.ts) に別途登録する。組込 ID は予約。
 */
export function registerColumnComponent(type: string, load: Loader): void {
  if (type in BUILTIN_COLUMN_LOADERS) {
    throw new Error(`column type "${type}" is reserved by NoteDeck`)
  }
  COLUMN_COMPONENTS[type] = defineAsyncComponent(load)
}

export function unregisterColumnComponent(type: string): void {
  if (type in BUILTIN_COLUMN_LOADERS) {
    throw new Error(`column type "${type}" is builtin and cannot be removed`)
  }
  delete COLUMN_COMPONENTS[type]
}
