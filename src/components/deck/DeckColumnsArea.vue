<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useCssModule, watch } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import { useColumnDrag } from '@/composables/useColumnDrag'
import { provideColumnMountRegistry } from '@/composables/useColumnMount'
import { useColumnResize } from '@/composables/useColumnResize'
import { useColumnScroll } from '@/composables/useColumnScroll'
import { useHorizontalWheel } from '@/composables/useHorizontalWheel'
import * as snapshotStore from '@/composables/useSnapshotStore'
import { i18n } from '@/i18n'
import { columnCacheKey } from '@/services/columnCacheKey'
import { isInsertNoop } from '@/services/deckLayout'
import { useDeckStore } from '@/stores/deck'
import { useIsCompactLayout } from '@/stores/ui'
import { accountsCacheKeyDeps } from '@/utils/columnCacheKeyDeps'
import { captureFlip, type FlipSnapshot, playFlip } from '@/utils/flip'
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

const emit = defineEmits<{ 'add-column': [] }>()

// Column drag & drop (CSS Module class names are passed as selectors)
const isCompact = useIsCompactLayout()
const columnDrag = useColumnDrag(
  deckStore,
  {
    columns: $style.columns,
    columnSection: $style.columnSection,
    colResizeHandle: $style.colResizeHandle,
  },
  isCompact,
)

const columnMap = computed(() => deckStore.columnMap)

// Column resize
const {
  resizingColId,
  startColumnResize,
  resetColumnWidth,
  WIDE_COLUMN_TYPES,
} = useColumnResize(columnMap, deckStore)

const columnsRef = ref<HTMLElement | null>(null)

// カラムの追加・削除・並べ替え・縦分割で、残ったカラムを新しい位置へ滑らせる
// (経路はメニュー / ドラッグ / capability / undo と多いので、並びの変化を
// 見て一か所で受ける)。横の移動は section ごと、縦の移動は同じ section に
// 残ったセルだけを補間する (section は paint containment で、外へ出たセルは
// 切り取られる)
const layoutKey = computed(() =>
  deckStore.windowLayout.map((g) => g.join(',')).join('|'),
)
function flipTargets() {
  const root = columnsRef.value
  return {
    sections: root?.querySelectorAll<HTMLElement>('[data-flip-key]') ?? [],
    cells: root?.querySelectorAll<HTMLElement>('.stack-cell') ?? [],
  }
}
const sectionKey = (el: HTMLElement) => el.dataset.flipKey
const cellKey = (el: HTMLElement) => {
  const section = el.closest<HTMLElement>('[data-flip-key]')?.dataset.flipKey
  return section && el.dataset.columnId
    ? `${section}/${el.dataset.columnId}`
    : undefined
}
let flipSnapshot: { sections: FlipSnapshot; cells: FlipSnapshot } | null = null
watch(
  layoutKey,
  () => {
    const { sections, cells } = flipTargets()
    flipSnapshot = {
      sections: captureFlip(sections, sectionKey, columnsRef.value),
      cells: captureFlip(cells, cellKey, columnsRef.value),
    }
  },
  { flush: 'pre' },
)
watch(
  layoutKey,
  () => {
    const snap = flipSnapshot
    flipSnapshot = null
    if (!snap) return
    const { sections, cells } = flipTargets()
    playFlip(snap.sections, sections, sectionKey, columnsRef.value)
    playFlip(snap.cells, cells, cellKey, columnsRef.value, 'y')
  },
  { flush: 'post' },
)
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

// Snapshot cache key: 各カラムの cache.getKey() と同一の共有導出
// (columnCacheKey) を使う。手組みミラーの表記ゆれバグを構造的に防ぐ。
const cacheKeyDeps = accountsCacheKeyDeps()

/** Get snapshot preview lines for an unmounted column shell */
function getShellPreview(colId: string): string[] {
  const col = columnMap.value.get(colId)
  if (!col) return []
  const cacheKey = columnCacheKey(col, cacheKeyDeps)
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
  if (dragId && isInsertNoop(deckStore.windowLayout, dragId, dt.insertIndex))
    return -1
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
    data-deck-columns
    :class="[$style.columns, { [$style.swipeMode]: isCompact }]"
    @scroll.passive="columnScroll.onScroll"
  >
    <div
      v-if="dropInsertIndex === 0"
      :class="$style.dropPlaceholder"
      :style="{ flexBasis: `${dropInsertWidth}px` }"
    />
    <!-- key は先頭カラムで固定する。結合した id を key にすると縦分割・解除の
         たびに section ごと作り直され、残る側のカラムまで再マウントされる -->
    <template
      v-for="(group, groupIndex) in deckStore.windowLayout"
      :key="group[0]"
    >
      <section
        :data-flip-key="group[0]"
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
        :title="i18n.ts._deckColumnsArea.resizeHandle"
        @pointerdown="startColumnResize(group[0]!, $event)"
        @dblclick="resetColumnWidth(group[0]!)"
      />
      <div
        v-if="dropInsertIndex === groupIndex + 1"
        :class="$style.dropPlaceholder"
        :style="{ flexBasis: `${dropInsertWidth}px` }"
      />
    </template>

    <!-- 空デッキ (全カラム削除後)。CTA は既定の構成 (#1011) に戻す方。カラムを
         1 本ずつ足す入口はナビバーと ＋ にあるのでここには置かない。
         ポップアウトは applyDefaultDeck がメインの並びに足すので従来の追加 CTA -->
    <div v-if="deckStore.windowLayout.length === 0" :class="$style.emptyDeck">
      <ColumnEmptyState
        v-if="!deckStore.currentWindowId"
        :message="i18n.ts._deckColumnsArea.noColumns"
        :cta-label="i18n.ts._deckColumnsArea.startWithDefault"
        cta-icon="ti-layout-columns"
        @cta="deckStore.applyDefaultDeck()"
      />
      <ColumnEmptyState
        v-else
        :message="i18n.ts._deckColumnsArea.noColumns"
        :cta-label="i18n.ts._commands.addColumn"
        cta-icon="ti-plus"
        @cta="emit('add-column')"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
.emptyDeck {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
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
     backwards: 遅延中も from (透明) を当てる。forwards だと遅延中は素のまま
     見えていて、開始と同時に消えてからフェードし直す。完了後は fill が外れて
     コンポジタレイヤーも解放される。遅延は 6 本目で頭打ちにして、後ろの
     カラムや後から足したカラムを待たせない */
  animation: nd-col-enter var(--nd-duration-slower) var(--nd-ease-spring) backwards;
  animation-delay: calc(min(var(--col-idx, 0), 6) * 40ms + 50ms);
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
  gap: var(--nd-columnGap);
}

.colResizeHandle {
  position: relative;
  flex: 0 0 4px;
  cursor: col-resize;
  background: transparent;
  transition: background var(--nd-duration-base);

  /* 見た目の 4px は保ったまま、両隣の gap まで掴めるようにする。gap の外へは
     広げない (左隣のカラムの右端には縦スクロールバーがある) */
  &::before {
    content: "";
    position: absolute;
    inset: 0 calc(-1 * var(--nd-columnGap));
  }

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
  border-radius: var(--nd-radius-lg);
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
    /* 強フリックで複数カラム飛ばさない (1 フリック = 1 カラム) */
    scroll-snap-stop: always;
  }
}
</style>
