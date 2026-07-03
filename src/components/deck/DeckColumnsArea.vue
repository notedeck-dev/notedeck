<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useCssModule, watch } from 'vue'
import { useColumnDrag } from '@/composables/useColumnDrag'
import { provideColumnMountRegistry } from '@/composables/useColumnMount'
import { useColumnResize } from '@/composables/useColumnResize'
import { useColumnScroll } from '@/composables/useColumnScroll'
import { useHorizontalWheel } from '@/composables/useHorizontalWheel'
import * as snapshotStore from '@/composables/useSnapshotStore'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { useIsCompactLayout } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { COLUMN_SELECTOR } from '@/utils/themeVars'
import DeckStackCell from './DeckStackCell.vue'

// Preload chunks for column types the user actually has configured
const COLUMN_PRELOADERS: Partial<Record<string, () => Promise<unknown>>> = {
  timeline: () => import('./DeckTimelineColumn.vue'),
  notifications: () => import('./DeckNotificationColumn.vue'),
  search: () => import('./DeckSearchColumn.vue'),
  list: () => import('./DeckListColumn.vue'),
  antenna: () => import('./DeckAntennaColumn.vue'),
  favorites: () => import('./DeckFavoritesColumn.vue'),
  mentions: () => import('./DeckMentionsColumn.vue'),
  channel: () => import('./DeckChannelColumn.vue'),
  user: () => import('./DeckUserColumn.vue'),
  chat: () => import('./DeckChatColumn.vue'),
}

const $style = useCssModule()
const deckStore = useDeckStore()
const accountsStore = useAccountsStore()
const windowsStore = useWindowsStore()

// Column drag & drop (CSS Module class names are passed as selectors)
const columnDrag = useColumnDrag(deckStore, {
  columns: $style.columns,
  columnSection: $style.columnSection,
  colResizeHandle: $style.colResizeHandle,
})
const isCompact = useIsCompactLayout()

const columnMap = computed(() => deckStore.columnMap)

// Column resize
const { resizingColId, startColumnResize, WIDE_COLUMN_TYPES } = useColumnResize(
  columnMap,
  deckStore,
)

const columnsRef = ref<HTMLElement | null>(null)
// Column mount / visibility / live-budget registry (per-cell registration
// happens inside DeckStackCell — provider is set up here)
const mountRegistry = provideColumnMountRegistry(columnsRef)

// Scroll ↔ active column synchronization
const columnScroll = useColumnScroll({
  containerRef: columnsRef,
  isCompact,
  windowLayout: computed(() => deckStore.windowLayout),
  onActiveColumnDetected: (id) => deckStore.setActiveColumn(id),
})

// Horizontal wheel → horizontal scroll conversion
const horizontalWheel = useHorizontalWheel({
  containerRef: columnsRef,
  columnSelector: COLUMN_SELECTOR,
})

// Derive a snapshot cache key from column config (mirrors each column's cache.getKey())
function getColumnCacheKey(col: DeckColumn): string | null {
  switch (col.type) {
    case 'timeline':
      return col.tl ?? null
    case 'antenna':
      return col.antennaId ? `antenna:${col.antennaId}` : null
    case 'channel':
      return col.channelId ? `channel:${col.channelId}` : null
    case 'clip':
      return col.clipId ? `clip:${col.clipId}` : null
    case 'user':
      return col.userId ? `user:${col.userId}` : null
    case 'list':
      return col.listId ? `list:${col.listId}` : null
    case 'favorites':
      return 'favorites'
    case 'mentions':
    case 'specified':
      return 'mentions'
    case 'explore':
      return 'explore'
    default:
      return null
  }
}

/** Get snapshot preview lines for an unmounted column shell */
function getShellPreview(colId: string): string[] {
  const col = columnMap.value.get(colId)
  if (!col) return []
  const cacheKey = getColumnCacheKey(col)
  if (!cacheKey) return []
  const snap = snapshotStore.restore(colId, cacheKey)
  if (!snap) return []
  return snap.notes.slice(0, 4).map((n) => {
    const text = n.cw ?? n.text ?? ''
    return text.length > 60 ? `${text.slice(0, 60)}…` : text
  })
}

const activeGroupIndex = computed(() => {
  const activeId = deckStore.activeColumnId
  if (!activeId) return 0
  const idx = deckStore.windowLayout.findIndex((group) =>
    group.includes(activeId),
  )
  return idx >= 0 ? idx : 0
})

function preloadVisiblePriorityGroups() {
  if (!import.meta.env.PROD) return
  const activeIdx = activeGroupIndex.value
  for (const [groupIndex, group] of deckStore.windowLayout.entries()) {
    if (Math.abs(groupIndex - activeIdx) > 1) continue
    for (const colId of group) {
      const col = columnMap.value.get(colId)
      if (col) COLUMN_PRELOADERS[col.type]?.()
    }
  }
}

onMounted(async () => {
  await horizontalWheel.attach()
  // Preload only the active/nearby groups first.
  preloadVisiblePriorityGroups()
})

onUnmounted(() => {
  horizontalWheel.detach()
})

// Store → scroll: single watcher for all activation paths
watch(
  () => deckStore.activeColumnId,
  (id) => {
    if (id) {
      columnScroll.scrollToColumnId(id)
      preloadVisiblePriorityGroups()
    }
  },
  { flush: 'post' },
)

// Live budget: recompute which columns are allowed to stream
// when active column or layout changes
watch(
  [() => deckStore.activeColumnId, () => deckStore.windowLayout],
  () => {
    const allColIds = deckStore.windowLayout.flat()
    mountRegistry.updateLiveBudget(allColIds, deckStore.activeColumnId)
  },
  { flush: 'post', deep: true, immediate: true },
)

// Compact ↔ Desktop 切替時: アクティブカラムの位置にスクロールを合わせる
watch(
  isCompact,
  (compact) => {
    const id = deckStore.activeColumnId
    if (!compact || !id) return
    columnScroll.snapToColumnId(id)
  },
  { flush: 'post' },
)

// Drop insert placeholder
const dropInsertIndex = computed(() => {
  const dt = columnDrag.dropTarget.value
  if (!dt || !('insertIndex' in dt)) return -1
  const dragId = columnDrag.dragColumnId.value
  if (dragId) {
    const fromIdx = deckStore.windowLayout.findIndex((ids) =>
      ids.includes(dragId),
    )
    if (
      fromIdx >= 0 &&
      (dt.insertIndex === fromIdx || dt.insertIndex === fromIdx + 1)
    )
      return -1
  }
  return dt.insertIndex
})

const dropInsertWidth = computed(() => {
  const dragId = columnDrag.dragColumnId.value
  if (!dragId) return 400
  return columnMap.value.get(dragId)?.width ?? 400
})

// Template helpers
function sectionClass(group: string[]) {
  const first = group[0]
  const col = first ? columnMap.value.get(first) : undefined
  return {
    [$style.stacked]: group.length > 1,
    [$style.wideColumn]: col ? WIDE_COLUMN_TYPES.has(col.type) : false,
  }
}

function sectionWidth(group: string[]): string {
  const first = group[0]
  const col = first ? columnMap.value.get(first) : undefined
  return `${col?.width ?? 400}px`
}

function cellDropZone(colId: string): string | undefined {
  const dt = columnDrag.dropTarget.value
  if (!dt || !('columnId' in dt) || dt.columnId !== colId) return undefined
  return dt.position
}

// Column pointer drag (swap / stack)
function onColumnPointerDown(colId: string, e: PointerEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.column-grabber')) return
  columnDrag.startDrag(colId, e)
}

defineExpose({
  scrollColumnToTop: columnScroll.scrollColumnToTop,
  columnMap,
})
</script>

<template>
  <div
    ref="columnsRef"
    :class="[$style.columns, { [$style.swipeMode]: isCompact }]"
    @scroll.passive="columnScroll.onScroll"
  >
    <div
      v-if="dropInsertIndex === 0"
      :class="$style.dropPlaceholder"
      :style="{ flexBasis: `${dropInsertWidth}px` }"
    />
    <!-- 空デッキの導線 (#692)。アカウント 0 件でもデッキシェルを見せる方針に伴い、
         迷子にならない最小限の CTA だけ置く (Welcome カラム的な UI は作らない) -->
    <div v-if="deckStore.windowLayout.length === 0" :class="$style.emptyState">
      <i class="ti ti-layout-columns" :class="$style.emptyIcon" />
      <template v-if="accountsStore.accounts.length === 0">
        <p :class="$style.emptyText">サーバーにログインして始めましょう</p>
        <button
          class="_button"
          :class="$style.emptyBtn"
          @click="windowsStore.open('login')"
        >
          <i class="ti ti-login-2" />
          <span>ログイン</span>
        </button>
      </template>
      <p v-else :class="$style.emptyText">
        ナビバーの <i class="ti ti-plus" /> からカラムを追加できます
      </p>
    </div>
    <template
      v-for="(group, groupIndex) in deckStore.windowLayout"
      :key="group.join('-')"
    >
      <section
        :class="[$style.columnSection, sectionClass(group)]"
        :style="{ flexBasis: sectionWidth(group), '--col-idx': groupIndex }"
      >
        <DeckStackCell
          v-for="colId in group"
          :key="colId"
          :col-id="colId"
          :column="columnMap.get(colId)"
          :is-active="deckStore.activeColumnId === colId"
          :is-compact="isCompact"
          :is-drag-source="columnDrag.dragColumnId.value === colId"
          :drop-zone="cellDropZone(colId)"
          :shell-preview="getShellPreview(colId)"
          @mousedown="deckStore.setActiveColumn(colId)"
          @pointerdown="onColumnPointerDown(colId, $event)"
        />
      </section>
      <div
        v-if="!isCompact"
        :class="[$style.colResizeHandle, { [$style.active]: resizingColId === group[0] }]"
        @pointerdown="startColumnResize(group[0]!, $event)"
      />
      <div
        v-if="dropInsertIndex === groupIndex + 1"
        :class="$style.dropPlaceholder"
        :style="{ flexBasis: `${dropInsertWidth}px` }"
      />
    </template>
  </div>
</template>

<style lang="scss" module>
.emptyState {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.emptyIcon {
  font-size: 40px;
  color: var(--nd-fg);
  opacity: 0.3;
}

.emptyText {
  font-size: 14px;
  color: var(--nd-fg);
  opacity: 0.6;
}

.emptyBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: 8px;
  background: var(--nd-accent);
  color: #fff;

  &:hover {
    opacity: 0.85;
  }
}

.columns {
  flex: 1;
  display: flex;
  gap: var(--nd-columnGap);
  padding: var(--nd-columnGap);
  overflow-x: auto;
  overflow-y: clip;
  overscroll-behavior: contain;
  min-width: 0;
  min-height: 0;
}

.columnSection {
  flex: 0 0 auto;
  min-width: 280px;
  max-width: 600px;
  display: flex;
  flex-direction: column;
  contain: layout style paint;
  /* Staggered entrance: each column fades in with a slight upward slide.
     --col-idx is set inline; forwards → 完了後にコンポジタレイヤーを解放 */
  animation: nd-col-enter var(--nd-duration-slower) var(--nd-ease-spring) forwards;
  animation-delay: calc(var(--col-idx, 0) * 40ms + 50ms);
}
@keyframes nd-col-enter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
.wideColumn {
  max-width: 1200px;
}

.stacked {
  display: flex;
  flex-direction: column;
  gap: var(--nd-columnGap, 6px);
}

.colResizeHandle {
  flex: 0 0 4px;
  cursor: col-resize;
  background: transparent;
  transition: background var(--nd-duration-base);

  &:hover,
  &.active {
    background: var(--nd-accent);
    opacity: 0.4;
  }

  &.active {
    opacity: 0.6;
  }
}

.dropPlaceholder {
  flex-shrink: 0;
  border: 2px dashed var(--nd-accent);
  border-radius: 10px;
  background: var(--nd-accent-subtle);
  box-shadow: 0 0 12px color-mix(in srgb, var(--nd-accent) 30%, transparent);
}

/* Mobile platform: full-width swipe columns */
.swipeMode {
  scroll-snap-type: x mandatory;
  gap: 0;
  padding: 0;

  .columnSection {
    flex: 0 0 100% !important;
    min-width: 100% !important;
    max-width: 100% !important;
    scroll-snap-align: start;
  }
}
</style>
