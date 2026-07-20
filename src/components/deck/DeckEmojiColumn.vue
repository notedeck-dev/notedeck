<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ServerEmoji } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import { useColumnPullScroller } from '@/composables/useColumnPullScroller'
import { useColumnTheme } from '@/composables/useColumnTheme'
import {
  type GridGroup,
  useGridVirtualizer,
} from '@/composables/useGridVirtualizer'
import { useServerImages } from '@/composables/useServerImages'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useEmojisStore } from '@/stores/emojis'
import { useServersStore } from '@/stores/servers'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const accountsStore = useAccountsStore()
const serversStore = useServersStore()
const emojisStore = useEmojisStore()

const account = computed(() =>
  accountsStore.accounts.find((a) => a.id === props.column.accountId),
)

const { columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl, serverNotFoundImageUrl, serverErrorImageUrl } =
  useServerImages(() => props.column)

const serverIconUrl = ref<string | undefined>()
const isLoading = ref(false)
const error = ref<AppError | null>(null)
const scrollContainer = ref<HTMLElement | null>(null)
useColumnPullScroller(scrollContainer)
const searchQuery = ref('')
const selectedCategory = ref<string | null>(null)
const copiedName = ref<string | null>(null)
const categoryBarRef = ref<HTMLElement | null>(null)

function onCategoryBarWheel(ev: WheelEvent) {
  const el = categoryBarRef.value
  if (!el) return
  // WebView2 (Windows) では Shift+wheel が deltaX でなく deltaY で届くため、
  // 横スクロール (deltaX) を優先しつつ縦ホイールも横スクロールに変換する。
  const delta = ev.deltaX !== 0 ? ev.deltaX : ev.deltaY
  if (delta === 0) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 0) return
  const next = Math.max(0, Math.min(max, el.scrollLeft + delta))
  if (next === el.scrollLeft) return
  el.scrollLeft = next
  ev.preventDefault()
}

// Bind wheel as non-passive (needed for preventDefault)
watch(categoryBarRef, (el, oldEl) => {
  oldEl?.removeEventListener('wheel', onCategoryBarWheel)
  el?.addEventListener('wheel', onCategoryBarWheel, { passive: false })
})
onUnmounted(() => {
  categoryBarRef.value?.removeEventListener('wheel', onCategoryBarWheel)
})

const allEmojis = computed(() => {
  const acc = account.value
  if (!acc) return []
  return emojisStore.getEmojiList(acc.host)
})

const categories = computed(() => {
  const cats = new Set<string>()
  for (const e of allEmojis.value) {
    if (e.category) cats.add(e.category)
  }
  return [...cats].sort()
})

const filteredEmojis = computed(() => {
  let list = allEmojis.value

  if (selectedCategory.value) {
    list = list.filter((e) => e.category === selectedCategory.value)
  }

  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q)) ||
        e.category?.toLowerCase().includes(q),
    )
  }

  return list
})

// Group emojis by category for display
const emojiGroups = computed<GridGroup<ServerEmoji>[]>(() => {
  const groups = new Map<string, ServerEmoji[]>()
  for (const e of filteredEmojis.value) {
    const cat = e.category || '未分類'
    if (!groups.has(cat)) groups.set(cat, [])
    groups.get(cat)?.push(e)
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === '未分類') return 1
      if (b[0] === '未分類') return -1
      return a[0].localeCompare(b[0])
    })
    .map(([label, items]) => ({ label: `${label} (${items.length})`, items }))
})

const { rows, virtualItems, totalSize } = useGridVirtualizer({
  groups: emojiGroups,
  scrollElement: scrollContainer,
  itemWidth: 48,
  headerHeight: 34,
  rowHeight: 48,
})

function scrollToTop() {
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function copyEmojiCode(emoji: ServerEmoji) {
  navigator.clipboard.writeText(`:${emoji.name}:`)
  copiedName.value = emoji.name
  setTimeout(() => {
    if (copiedName.value === emoji.name) copiedName.value = null
  }, 1500)
}

async function loadEmojis() {
  const acc = account.value
  if (!acc) return

  isLoading.value = true
  error.value = null

  try {
    const info = await serversStore.getServerInfo(acc.host)
    serverIconUrl.value = info.iconUrl

    if (!emojisStore.has(acc.host)) {
      const emojis = unwrap(await commands.apiGetServerEmojis(acc.id))
      emojisStore.set(acc.host, emojis)
    }
  } catch (e) {
    error.value = AppError.from(e)
  } finally {
    isLoading.value = false
  }
}

// Reset category filter when search changes
watch(searchQuery, () => {
  if (searchQuery.value) selectedCategory.value = null
})

onMounted(() => {
  loadEmojis()
})

function getHeaderLabel(index: number): string {
  const row = rows.value[index]
  return row?.type === 'header' ? row.label : ''
}

function getRowItems(index: number): ServerEmoji[] {
  const row = rows.value[index]
  return row?.type === 'row' ? row.items : []
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'カスタム絵文字'"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
    :pull-refresh="loadEmojis"
    @refresh="loadEmojis"
  >
    <template #header-icon>
      <i class="ti ti-mood-smile" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <span v-if="allEmojis.length > 0" :class="$style.headerCount">{{ allEmojis.length }}</span>
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <ColumnEmptyState
      v-if="error"
      :error="error"
      :account-id="column.accountId"
      is-error
      :image-url="serverErrorImageUrl"
      cta-label="再試行"
      cta-icon="ti-refresh"
      @cta="loadEmojis"
    />

    <div v-else :class="$style.emojiBody">
      <!-- Search -->
      <div :class="$style.emojiSearch">
        <i :class="$style.emojiSearchIcon" class="ti ti-search" />
        <input
          v-model="searchQuery"
          :class="$style.emojiSearchInput"
          type="text"
          placeholder="絵文字を検索..."
        />
        <span v-if="searchQuery" :class="$style.emojiSearchCount">{{ filteredEmojis.length }}件</span>
      </div>

      <!-- Category filter -->
      <div v-if="categories.length > 0 && !searchQuery" ref="categoryBarRef" :class="$style.categoryBar">
        <button
          class="_button"
          :class="[$style.categoryChip, { [$style.active]: !selectedCategory }]"
          @click="selectedCategory = null"
        >
          すべて
        </button>
        <button
          v-for="cat in categories"
          :key="cat"
          class="_button"
          :class="[$style.categoryChip, { [$style.active]: selectedCategory === cat }]"
          @click="selectedCategory = selectedCategory === cat ? null : cat"
        >
          {{ cat }}
        </button>
      </div>

      <ColumnEmptyState v-if="filteredEmojis.length === 0 && !isLoading" message="絵文字が見つかりません" :image-url="serverInfoImageUrl" />

      <!-- Virtualized emoji grid -->
      <div v-else ref="scrollContainer" :class="$style.emojiScroller">
        <div :style="{ height: `${totalSize}px`, position: 'relative' }">
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
            <template v-if="rows[vItem.index]?.type === 'header'">
              <div :class="$style.emojiGroupLabel">
                {{ getHeaderLabel(vItem.index) }}
              </div>
            </template>
            <template v-else-if="rows[vItem.index]?.type === 'row'">
              <div :class="$style.emojiGrid">
                <button
                  v-for="emoji in getRowItems(vItem.index)"
                  :key="emoji.name"
                  class="_button"
                  :class="[$style.emojiCell, { [$style.copied]: copiedName === emoji.name }]"
                  :title="`:${emoji.name}:`"
                  @click="copyEmojiCode(emoji)"
                >
                  <img :src="emoji.url" :alt="emoji.name" :class="$style.emojiImg" loading="lazy" />
                  <span v-if="copiedName === emoji.name" :class="$style.emojiCopiedBadge">Copied!</span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.headerCount {
  font-size: 0.75em;
  opacity: 0.5;
  flex-shrink: 0;
}

.emojiBody {
  composes: tlBody from './column-common.module.scss';
}

.emojiSearch {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
}

.emojiSearchIcon {
  flex-shrink: 0;
  opacity: 0.5;
  font-size: 14px;
}

.emojiSearchInput {
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

.emojiSearchCount {
  flex-shrink: 0;
  font-size: 0.75em;
  opacity: 0.5;
}

.categoryBar {
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

.categoryChip {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: var(--nd-radius-full);
  font-size: 0.75em;
  font-weight: bold;
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  transition: background var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &.active {
    background: var(--nd-accent);
    color: var(--nd-fgOnAccent, #fff);
  }
}

.emojiScroller {
  composes: columnScroller from './column-common.module.scss';
}

.emojiGroup {
  padding-bottom: 8px;

  & + & {
    border-top: 1px solid var(--nd-divider);
  }
}

.emojiGroupLabel {
  padding: 10px 12px 4px;
  font-size: 0.75em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.6;
}

.emojiGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(44px, 1fr));
  gap: 2px;
  padding: 0 8px;
}

.emojiCell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border: none;
  outline: none;
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);
  cursor: pointer;
  contain: layout style paint;
  content-visibility: auto;
  contain-intrinsic-size: auto 48px;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &.copied {
    background: var(--nd-accentedBg);
  }
}

.emojiImg {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.emojiCopiedBadge {
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--nd-accent);
  color: #fff;
  font-size: 0.6em;
  font-weight: bold;
  white-space: nowrap;
  pointer-events: none;
}
</style>
