<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { TimelineFilter } from '@/adapters/types'
import { i18n } from '@/i18n'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
  isQueryActive,
  isQueryOfferedFor,
  useColumnQueriesStore,
} from '@/stores/columnQueries'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import TimelineFilterPopup from './TimelineFilterPopup.vue'

/**
 * フィルタメニュー (#841): 組込トグル + クエリトグルをノートカラム共通で提供する。
 * per-account (DeckNoteColumn) と全アカウント面 (DeckTimelineColumn) で共有。
 * 反映はカラム設定 (filters / noteQueryRefs) の変更検知が担うので、ここは
 * デッキ store に書くだけ。
 */
const props = defineProps<{
  column: DeckColumnType
  /** 組込トグル。未指定 / 空はクエリトグルのみ */
  filterKeys?: (keyof TimelineFilter)[]
  themeVars?: Record<string, string>
}>()

const deckStore = useDeckStore()
const columnQueriesStore = useColumnQueriesStore()
const accountsStore = useAccountsStore()
columnQueriesStore.ensureLoaded()

/**
 * このカラムで選べる名前付きクエリ (#1018 / #1043)。全体スコープのクエリは
 * どのカラムでも、アカウント別スコープのクエリはそのアカウントのカラムでだけ
 * 出す (全アカウント面は accountId が無いので全体スコープのみ)。未適用の
 * 無効なクエリは出さない。既に適用済みのものは、スコープ外でも無効でも出す —
 * 黙って選択肢から消えると、なぜ効いている / 効いていないのか追えないため。
 */
const namedQueryToggles = computed(() => {
  const account = accountsStore.accounts.find(
    (a) => a.id === props.column.accountId,
  )
  const scopeKey = account ? accountScopeKey(account) : null
  const applied = new Set(props.column.noteQueryRefs ?? [])
  return columnQueriesStore.queries
    .filter((q) => isQueryOfferedFor(q, scopeKey, applied))
    .map((q) => ({ id: q.id, name: q.name, disabled: !isQueryActive(q) }))
})
const effectiveFilterKeys = computed(() => props.filterKeys ?? [])
const showFilterBtn = computed(
  () =>
    effectiveFilterKeys.value.length > 0 || namedQueryToggles.value.length > 0,
)
const columnFilters = computed<TimelineFilter>(() => props.column.filters ?? {})
const hasActiveFilter = computed(() =>
  Object.values(columnFilters.value).some((v) => v !== undefined),
)

const showFilterMenu = ref(false)
const filterBtnRef = ref<HTMLButtonElement | null>(null)
const filterPopupPos = ref({ top: 0, left: 0 })

function toggleFilterMenu() {
  showFilterMenu.value = !showFilterMenu.value
  if (showFilterMenu.value) {
    nextTick(() => {
      const btn = filterBtnRef.value
      if (btn) {
        const rect = btn.getBoundingClientRect()
        filterPopupPos.value = {
          top: rect.bottom + 4,
          left: Math.max(8, rect.right - 220),
        }
      }
    })
  }
}

function toggleFilter(key: keyof TimelineFilter) {
  const current = columnFilters.value[key]
  const next = { ...columnFilters.value }
  if (key === 'withFiles') {
    next[key] = current === true ? undefined : true
  } else {
    next[key] = current === false ? undefined : false
  }
  for (const k of Object.keys(next) as (keyof TimelineFilter)[]) {
    if (next[k] === undefined) delete next[k]
  }
  deckStore.updateColumn(props.column.id, {
    filters: Object.keys(next).length > 0 ? next : undefined,
  })
}

// 名前付きクエリの適用トグル (#783)
function toggleNamedQuery(id: string) {
  const refs = new Set(props.column.noteQueryRefs ?? [])
  if (refs.has(id)) {
    refs.delete(id)
  } else {
    refs.add(id)
  }
  deckStore.updateColumn(props.column.id, {
    noteQueryRefs: refs.size > 0 ? [...refs] : undefined,
  })
}

/** 無効チップから管理カラムへ (#1043) */
function openQueryManager(): void {
  deckStore.toggleSidebarColumn('queryManager', null)
}
</script>

<template>
  <button
    v-if="showFilterBtn"
    ref="filterBtnRef"
    class="_button"
    :class="[$style.filterBtn, { [$style.filterBtnActive]: hasActiveFilter }]"
    :title="i18n.ts._columnFilterButton.filter"
    @click.stop="toggleFilterMenu"
  >
    <i class="ti ti-filter" />
  </button>
  <TimelineFilterPopup
    :show="showFilterMenu"
    :filter-keys="effectiveFilterKeys"
    :filters="columnFilters"
    :position="filterPopupPos"
    :theme-vars="themeVars"
    :named-queries="namedQueryToggles"
    :applied-query-ids="column.noteQueryRefs ?? []"
    @close="showFilterMenu = false"
    @toggle="toggleFilter"
    @toggle-query="toggleNamedQuery"
    @open-manager="openQueryManager"
  />
</template>

<style lang="scss" module>
/* フィルタメニュー (#841): サブヘッダ右端の共通トグルボタン */
.filterBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 8px 12px;
  // タブ行と同じ下線でつなぐ (タブが無いカラムではここだけが行を作る)
  border-bottom: 1px solid var(--nd-divider);
  opacity: 0.5;
  color: var(--nd-fg);
  transition:
    opacity var(--nd-duration-base),
    background var(--nd-duration-base),
    color var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
    background: var(--nd-buttonHoverBg);
  }

  &.filterBtnActive {
    opacity: 1;
    color: var(--nd-accent);
  }
}
</style>
