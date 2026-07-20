<script setup lang="ts">
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  FederationInstance,
  FederationInstanceSort,
} from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { useWindowsStore } from '@/stores/windows'
import { AppError } from '@/utils/errors'
import { formatTime } from '@/utils/formatTime'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl, serverErrorImageUrl } = useServerImages(
  () => props.column,
)
const serversStore = useServersStore()
const windowsStore = useWindowsStore()
const serverIconUrl = computed(() => {
  const host = account.value?.host
  if (!host) return undefined
  return serversStore.getServer(host)?.iconUrl ?? undefined
})

// `-latestRequestSentAt` は Misskey 2023.11+ で追加されたソートキー。
// 古いサーバー/フォークで INVALID_PARAM になるため、最終通信系は
// 全バージョン共通の `-firstRetrievedAt` (初回取得日時) に集約する。
type SortKey = '-pubSub' | '-users' | '-notes' | '-firstRetrievedAt'
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: '-pubSub', label: 'アクティブ' },
  { key: '-users', label: 'ユーザー' },
  { key: '-notes', label: 'ノート' },
  { key: '-firstRetrievedAt', label: '新着' },
]
const PAGE_SIZE = 30
const COLS = 3
const ROW_HEIGHT = 88

const sort = ref<SortKey>('-pubSub')
const hostQuery = ref('')
const instances = ref<FederationInstance[]>([])
const isLoading = ref(false)
const isLoadingMore = ref(false)
const hasMore = ref(true)
const error = ref<AppError | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
useColumnPullScroller(scrollContainer)

const rows = computed<FederationInstance[][]>(() => {
  const items = instances.value
  const result: FederationInstance[][] = []
  for (let i = 0; i < items.length; i += COLS) {
    result.push(items.slice(i, i + COLS))
  }
  return result
})

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollContainer.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  })),
)
const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

// softwareName (lowercase) → public/ 以下のデフォルトアイコンパス。
// どれにも当てはまらないサーバーは ActivityPub の汎用マークにフォールバック。
const SOFTWARE_DEFAULT_ICON: Record<string, string> = {
  misskey: '/misskey-icon.png',
  mastodon: '/mastodon-icon.svg',
  pleroma: '/pleroma-icon.svg',
}
const ACTIVITYPUB_ICON = '/activitypub-icon.svg'

const failedIcons = reactive(new Set<string>())
function onIconError(id: string) {
  failedIcons.add(id)
}

/** サーバーが設定したアイコンが使えるか (null でもロード失敗でもなければ true)。 */
function hasCustomIcon(inst: FederationInstance): boolean {
  if (!inst.faviconUrl && !inst.iconUrl) return false
  return !failedIcons.has(inst.id)
}

/** 独自アイコン無し時に使うデフォルトアイコン。既知ソフトウェアはそのロゴ、不明は ActivityPub。 */
function fallbackIcon(inst: FederationInstance): string {
  const key = inst.softwareName?.toLowerCase()
  if (key && SOFTWARE_DEFAULT_ICON[key]) return SOFTWARE_DEFAULT_ICON[key]
  return ACTIVITYPUB_ICON
}

function softwareLabel(inst: FederationInstance): string {
  if (!inst.softwareName) return 'unknown'
  return inst.softwareVersion
    ? `${inst.softwareName} ${inst.softwareVersion}`
    : inst.softwareName
}

async function fetchInstances(reset: boolean): Promise<void> {
  const acc = account.value
  if (!acc) {
    error.value = new AppError('UNKNOWN', 'アカウントが見つかりません')
    return
  }

  if (reset) {
    isLoading.value = true
    instances.value = []
    hasMore.value = true
    failedIcons.clear()
  } else {
    if (!hasMore.value || isLoadingMore.value) return
    isLoadingMore.value = true
  }
  error.value = null

  try {
    const { adapter } = await initAdapterFor(acc.host, acc.id, {
      hasToken: acc.hasToken,
    })
    const offset = reset ? 0 : instances.value.length
    const page = await adapter.api.getFederationInstances({
      limit: PAGE_SIZE,
      offset,
      sort: sort.value as FederationInstanceSort,
      host: hostQuery.value.trim() || null,
      federating: true,
    })
    if (page.length < PAGE_SIZE) hasMore.value = false
    instances.value = reset ? page : [...instances.value, ...page]
  } catch (e) {
    error.value = AppError.from(e)
    if (reset) instances.value = []
    hasMore.value = false
  } finally {
    isLoading.value = false
    isLoadingMore.value = false
  }
}

function onScroll() {
  const el = scrollContainer.value
  if (!el || !hasMore.value || isLoadingMore.value || isLoading.value) return
  const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
  if (remaining < 400) fetchInstances(false)
}

function scrollToTop() {
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  fetchInstances(true)
})

watch(sort, () => {
  fetchInstances(true)
})

let searchDebounce: number | undefined
watch(hostQuery, () => {
  window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(() => fetchInstances(true), 300)
})

function onInstanceClick(inst: FederationInstance) {
  const acc = account.value
  if (!acc) return
  windowsStore.open('federation-instance', {
    accountId: acc.id,
    host: inst.host,
    initialInstance: inst,
  })
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || '連合'"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
    :pull-refresh="() => fetchInstances(true)"
    @refresh="() => fetchInstances(true)"
  >
    <template #header-icon>
      <i class="ti ti-planet" />
    </template>

    <template #header-meta>
      <span v-if="instances.length > 0" :class="$style.headerCount">{{ instances.length }}</span>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <div :class="$style.body">
      <div :class="$style.search">
        <i class="ti ti-search" :class="$style.searchIcon" />
        <input
          v-model="hostQuery"
          type="text"
          :class="$style.searchInput"
          placeholder="ホスト名で検索..."
        />
      </div>

      <div :class="$style.sortBar">
        <button
          v-for="opt in SORT_OPTIONS"
          :key="opt.key"
          class="_button"
          :class="[$style.sortPill, sort === opt.key && $style.sortPillActive]"
          @click="sort = opt.key"
        >
          {{ opt.label }}
        </button>
      </div>

      <ColumnEmptyState
        v-if="error && instances.length === 0"
        :error="error"
        :account-id="column.accountId"
        subject="連合情報"
        :has-token="!!account?.hasToken"
        :image-url="serverErrorImageUrl"
        :info-image-url="serverInfoImageUrl"
        cta-label="再試行"
        cta-icon="ti-refresh"
        @cta="fetchInstances(true)"
      />
      <ColumnEmptyState
        v-else-if="!isLoading && instances.length === 0"
        message="連合中のサーバーが見つかりません"
        :image-url="serverInfoImageUrl"
      />

      <div
        v-else
        ref="scrollContainer"
        :class="$style.scroller"
        @scroll.passive="onScroll"
      >
        <div v-if="isLoading" :class="$style.centerPad">
          <LoadingSpinner />
        </div>
        <div v-else :style="{ height: `${totalSize}px`, position: 'relative' }">
          <div
            v-for="vItem in virtualItems"
            :key="vItem.index"
            :style="{
              position: 'absolute',
              top: `${vItem.start}px`,
              left: 0,
              right: 0,
              height: `${vItem.size}px`,
            }"
          >
            <div :class="$style.grid">
              <button
                v-for="inst in rows[vItem.index]"
                :key="inst.id"
                class="_button"
                :class="[
                  $style.cell,
                  inst.isNotResponding && $style.cellDim,
                  inst.isSuspended && $style.cellDim,
                ]"
                :title="`${inst.host}\n${softwareLabel(inst)}\nユーザー: ${inst.usersCount.toLocaleString()} / ノート: ${inst.notesCount.toLocaleString()}\n最終通信: ${inst.latestRequestSentAt ? formatTime(inst.latestRequestSentAt) : '—'}`"
                @click="onInstanceClick(inst)"
              >
                <div :class="$style.iconWrap">
                  <img
                    v-if="hasCustomIcon(inst)"
                    :src="inst.faviconUrl || inst.iconUrl || ''"
                    :alt="inst.host"
                    :class="$style.icon"
                    loading="lazy"
                    referrerpolicy="no-referrer"
                    @error="onIconError(inst.id)"
                  />
                  <img
                    v-else
                    :src="fallbackIcon(inst)"
                    :alt="inst.host"
                    :class="$style.icon"
                    loading="lazy"
                  />
                  <span v-if="inst.isSuspended" :class="[$style.badge, $style.badgeError]" title="停止中">
                    <i class="ti ti-ban" />
                  </span>
                  <span v-else-if="inst.isNotResponding" :class="[$style.badge, $style.badgeWarn]" title="無応答">
                    <i class="ti ti-alert-triangle" />
                  </span>
                </div>
                <span :class="$style.host">{{ inst.host }}</span>
              </button>
            </div>
          </div>
        </div>
        <div v-if="isLoadingMore" :class="$style.bottomPad">
          <LoadingSpinner />
        </div>
      </div>
    </div>
  </DeckColumn>
</template>

<style module lang="scss">
@use './column-common.module.scss';

.headerCount {
  font-size: 0.75em;
  opacity: 0.5;
  flex-shrink: 0;
}

.body {
  composes: tlBody from './column-common.module.scss';
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
}

.searchIcon {
  flex-shrink: 0;
  opacity: 0.5;
  font-size: 14px;
}

.searchInput {
  flex: 1;
  border: none;
  background: none;
  color: var(--nd-fg);
  font-size: 0.85em;
  outline: none;

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.sortBar {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  overflow-x: auto;
  border-bottom: 1px solid var(--nd-divider);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.sortPill {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: var(--nd-radius-full);
  font-size: 0.75em;
  font-weight: bold;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  transition:
    background var(--nd-duration-base),
    color var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.sortPillActive {
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
}

.scroller {
  composes: columnScroller from './column-common.module.scss';
}

.centerPad {
  padding: 24px 0;
  display: flex;
  justify-content: center;
}

.bottomPad {
  padding: 12px 0;
  display: flex;
  justify-content: center;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 0 8px;
}

.cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding: 8px 4px;
  border: none;
  outline: none;
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);
  cursor: pointer;
  min-height: 80px;
  // grid-item の min-width が auto だとホスト名の nowrap 分だけセルが
  // 広がって 3 列レイアウトを破る。0 にして親の 1fr を強制させる。
  min-width: 0;
  max-width: 100%;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.cellDim {
  opacity: 0.45;
}

.iconWrap {
  position: relative;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon {
  width: 48px;
  height: 48px;
  object-fit: contain;
  border-radius: 10px;
  // 背景は透過。アイコン自体の alpha をそのまま活かす。
  background: transparent;
}

.badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 10px;
  color: #fff;
  border: 1.5px solid var(--nd-panel);
}

.badgeWarn {
  background: var(--nd-warn, #e8a530);
}

.badgeError {
  background: var(--nd-love, #ff4400);
}

.host {
  width: 100%;
  font-size: 0.7em;
  color: var(--nd-fg);
  text-align: center;
  line-height: 1.2;
  // 長いホスト名は 2 行で折り返して ellipsis。任意位置で折り返せるよう
  // word-break: break-all (url は word boundary が無いため通常 break しない)。
  overflow: hidden;
  word-break: break-all;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
</style>
