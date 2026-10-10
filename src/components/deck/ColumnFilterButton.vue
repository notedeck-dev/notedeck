<script setup lang="ts">
import { computed, nextTick, ref, useSlots } from 'vue'
import type { TimelineFilter } from '@/adapters/types'
import { i18n } from '@/i18n'
import { accountScopeKey, useAccountsStore } from '@/stores/accounts'
import {
  isQueryActive,
  isQueryOfferedFor,
  isQueryOfferedForAny,
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
  /** 面が持つ別の絞り込み (検索カラムの条件) が効いているときの点灯 */
  active?: boolean
  /**
   * 名前付きクエリのトグルを出さない。クエリの評価経路を持たない面 (サーバー検索)
   * が立てて、効かないスイッチを出さない。省略 = 出す (boolean prop は省略時に
   * false へ畳まれるので、既定が「出す」になる向きで持つ)
   */
  hideQueries?: boolean
  /** 入力欄を持つ行を差し込むときの広いポップアップ */
  wide?: boolean
  /** 検索バーのアイコンボタン列に並べる小さい見た目 (サブヘッダー行の下線なし) */
  compact?: boolean
}>()

const slots = useSlots()

const deckStore = useDeckStore()
const columnQueriesStore = useColumnQueriesStore()
const accountsStore = useAccountsStore()
columnQueriesStore.ensureLoaded()

/**
 * このカラムで選べる名前付きクエリ (#1018 / #1043)。全体スコープのクエリは
 * どのカラムでも、アカウント別スコープのクエリはそのアカウントのカラムでだけ
 * 出す (アカウントに紐づかない面は全体スコープと、ログイン中のどれかのアカウントのスコープ)。未適用の
 * 無効なクエリは出さない。既に適用済みのものは、スコープ外でも無効でも出す —
 * 黙って選択肢から消えると、なぜ効いている / 効いていないのか追えないため。
 */
const namedQueryToggles = computed(() => {
  const applied = new Set(props.column.noteQueryRefs ?? [])
  if (props.column.accountId) {
    const account = accountsStore.accounts.find(
      (a) => a.id === props.column.accountId,
    )
    const scopeKey = account ? accountScopeKey(account) : null
    return columnQueriesStore.queries
      .filter((q) => isQueryOfferedFor(q, scopeKey, applied))
      .map((q) => ({ id: q.id, name: q.name, disabled: !isQueryActive(q) }))
  }
  // アカウントに紐づかない面 (全アカウント TL / クライアント検索) は全体スコープと、
  // ログイン中のどれかのアカウントのスコープに入っているクエリを出す
  const scopeKeys = accountsStore.accounts.map(accountScopeKey)
  return columnQueriesStore.queries
    .filter((q) => isQueryOfferedForAny(q, scopeKeys, applied))
    .map((q) => ({ id: q.id, name: q.name, disabled: !isQueryActive(q) }))
})
const effectiveFilterKeys = computed(() => props.filterKeys ?? [])
const offeredQueries = computed(() =>
  props.hideQueries ? [] : namedQueryToggles.value,
)
const showFilterBtn = computed(
  () =>
    effectiveFilterKeys.value.length > 0 ||
    offeredQueries.value.length > 0 ||
    Boolean(slots.extra),
)
const columnFilters = computed<TimelineFilter>(() => props.column.filters ?? {})
const hasActiveFilter = computed(
  () =>
    props.active === true ||
    Object.values(columnFilters.value).some((v) => v !== undefined),
)
const popupWidth = computed(() => (props.wide ? 300 : 220))

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
          left: Math.max(8, rect.right - popupWidth.value),
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
    :class="[$style.filterBtn, { [$style.filterBtnActive]: hasActiveFilter, [$style.filterBtnCompact]: compact }]"
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
    :named-queries="offeredQueries"
    :applied-query-ids="column.noteQueryRefs ?? []"
    :wide="wide"
    @close="showFilterMenu = false"
    @toggle="toggleFilter"
    @toggle-query="toggleNamedQuery"
    @open-manager="openQueryManager"
  >
    <template v-if="slots.extra" #extra>
      <slot name="extra" />
    </template>
  </TimelineFilterPopup>
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
    color: var(--nd-accentText);
  }

  /* 検索バーのアイコンボタン列に合わせる (#1180) */
  &.filterBtnCompact {
    width: 28px;
    height: 28px;
    padding: 0;
    border-bottom: none;
    border-radius: var(--nd-radius-xs);
    font-size: var(--nd-font-body);
  }
}
</style>
