<script setup lang="ts">
import { computed, onMounted, ref, toRaw, watch } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { provideNoteFrame } from '@/composables/useNoteFrame'
import { useNoteList } from '@/composables/useNoteList'
import { useNoteScrollerRef } from '@/composables/useNoteScrollerRef'
import { i18n } from '@/i18n'
import { variantKeyOf } from '@/services/noteKey'
import {
  dateBounds,
  effectiveConditions,
  hasActiveFilter,
  resolveScopeAccounts,
  type SearchFilter,
  type TextCondition,
} from '@/services/searchFilter'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import ColumnCrossPostForm from './ColumnCrossPostForm.vue'
import ColumnFilterButton from './ColumnFilterButton.vue'
import DeckColumn from './DeckColumn.vue'
import SearchFilterPanel from './SearchFilterPanel.vue'

/**
 * クライアント検索 (#945 / #958): 手元のキャッシュをサーバー・アカウント横断で
 * 引く面。サーバー検索 (Misskey の notes/search) とは並立する。
 * 検索語が空でも絞り込みだけで引ける (「直近 1 週間の画像付き」など)。
 * 絞り込みパネルと本文の条件はサーバー検索と共有 (#1180)。
 */
const props = defineProps<{
  column: DeckColumnType
}>()

const PAGE_SIZE = 50

const deckStore = useDeckStore()
const accountsStore = useAccountsStore()

// 取得元サーバーは行ごとに違うので、ローカルユーザーにも @server とティッカーを出す
provideNoteFrame(computed(() => true))

const {
  columnThemeVars,
  serverInfoImageUrl,
  serverErrorImageUrl,
  isLoading,
  error,
  handlers,
  scroller,
  onScrollReport,
  postForm,
} = useColumnSetup(() => props.column)
const { noteScrollerRef } = useNoteScrollerRef(scroller)

const { notes, groups, rawNotes, setNotes, removeNote } = useNoteList({
  bundle: true,
  getAdapter: () => null,
  deleteHandler: handlers.delete,
  closePostForm: postForm.close,
})

// --- 検索条件。正本は column.query / column.searchFilter、ここはその写し ---
const query = ref(props.column.query ?? '')
const filter = ref<SearchFilter>({ ...props.column.searchFilter })
const hasSearched = ref(false)
const hasMore = ref(false)

const scopeOptions = computed(() => ({
  servers: [...new Set(accountsStore.accounts.map((a) => a.host))],
  accounts: accountsStore.accounts.map((a) => ({
    id: a.id,
    label: getAccountLabel(a),
  })),
}))

function saveFilter(next: SearchFilter) {
  filter.value = next
  deckStore.updateColumn(props.column.id, { searchFilter: next })
}

// 外部からの差し替え (CLI / AI) を取り込む。自分が保存したものは読み戻さない
watch(
  () => props.column.searchFilter,
  (f) => {
    if (toRaw(f) === toRaw(filter.value)) return
    filter.value = { ...f }
  },
)
watch(
  () => props.column.query,
  (q) => {
    if ((q ?? '') !== query.value) query.value = q ?? ''
  },
)

function onFilterUpdate(next: SearchFilter) {
  saveFilter(next)
}

function toggleSort() {
  const next = { ...filter.value }
  if (next.ascending) delete next.ascending
  else next.ascending = true
  saveFilter(next)
}

// 検索語の欄に手で打ったら、外部差し替えで止めていた本文の条件を戻す
function onQueryInput() {
  if (!filter.value.conditionsPaused) return
  const next = { ...filter.value }
  delete next.conditionsPaused
  saveFilter(next)
}

// --- 検索 ---

/** 検索を始める規則 (1 本): 検索語 / パネルの行 / 本文の条件のいずれかがある */
function shouldSearch(): boolean {
  return (
    query.value.trim().length > 0 ||
    hasActiveFilter(filter.value) ||
    effectiveConditions(filter.value).length > 0
  )
}

/**
 * 本文の条件を索引側の引数に畳む。段階 1 では同じ type の行の語をまとめて
 * 1 つの群にする (`contains_any` が 2 行あっても OR 群は 1 つ)。行ごとの
 * 評価 (any 行どうしの AND) は段階 2
 */
function textArgs(): Pick<
  NonNullable<Parameters<typeof commands.apiSearchNotesCachedAcross>[6]>,
  'textAny' | 'textAll' | 'textExclude'
> {
  const byType: Record<TextCondition['type'], string[]> = {
    contains_any: [],
    contains_all: [],
    excludes: [],
  }
  for (const cond of effectiveConditions(filter.value)) {
    byType[cond.type].push(...cond.words.filter(Boolean))
  }
  const orNull = (words: string[]) => (words.length > 0 ? words : null)
  return {
    textAny: orNull(byType.contains_any),
    textAll: orNull(byType.contains_all),
    textExclude: orNull(byType.excludes),
  }
}

/**
 * ページ位置は照合前の生ページの末尾 (最新順なら最古、古い順なら最新) の
 * created_at。索引側で絞るので表示中の末尾と一致するが、後段で落とす段
 * (クエリ #1178) が載っても位置がずれないよう生ページで持つ
 */
let pageCursor: string | null = null

async function fetchPage(cursor: string | null): Promise<NormalizedNote[]> {
  const accountIds = resolveScopeAccounts(
    filter.value.scope,
    accountsStore.accounts,
  )
  if (accountIds.length === 0) return []
  const bounds = dateBounds(filter.value)
  // 境界は両端含みなので重なった 1 件は行キーで除外する
  const until = filter.value.ascending ? bounds.until : (cursor ?? bounds.until)
  const since = filter.value.ascending ? (cursor ?? bounds.since) : bounds.since
  return unwrap(
    await commands.apiSearchNotesCachedAcross(
      accountIds,
      query.value.trim(),
      PAGE_SIZE,
      since,
      until,
      filter.value.ascending ?? false,
      {
        author: filter.value.author?.trim() || null,
        hasFiles: filter.value.hasFiles ?? null,
        publicOnly: null,
        ...textArgs(),
      },
    ),
  ) as NormalizedNote[]
}

let generation = 0

async function search() {
  const gen = ++generation
  error.value = null
  if (query.value !== (props.column.query ?? '')) {
    deckStore.updateColumn(props.column.id, { query: query.value })
  }
  // 条件が 1 つも無ければ案内に戻す (索引全件は出さない)
  if (!shouldSearch()) {
    setNotes([])
    pageCursor = null
    hasMore.value = false
    hasSearched.value = false
    isLoading.value = false
    return
  }
  isLoading.value = true
  hasSearched.value = true
  try {
    const found = await fetchPage(null)
    if (gen !== generation) return
    setNotes(found)
    pageCursor = found.at(-1)?.createdAt ?? null
    hasMore.value = found.length >= PAGE_SIZE
  } catch (e) {
    if (gen === generation) error.value = AppError.from(e)
  } finally {
    if (gen === generation) isLoading.value = false
  }
}

async function loadMore() {
  if (isLoading.value || !hasMore.value || !pageCursor) return
  const gen = generation
  isLoading.value = true
  try {
    const found = await fetchPage(pageCursor)
    if (gen !== generation) return
    const known = new Set(rawNotes.value.map(variantKeyOf))
    const fresh = found.filter((n) => !known.has(variantKeyOf(n)))
    pageCursor = found.at(-1)?.createdAt ?? pageCursor
    hasMore.value = found.length >= PAGE_SIZE && fresh.length > 0
    if (fresh.length > 0) setNotes([...rawNotes.value, ...fresh], 'newest')
  } catch (e) {
    if (gen === generation) error.value = AppError.from(e)
  } finally {
    if (gen === generation) isLoading.value = false
  }
}

// 入力のたびに引き直す (手元のキャッシュなので安い)。300ms でまとめる
let debounce: ReturnType<typeof setTimeout> | null = null
function scheduleSearch() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    void search()
  }, 300)
}
// filter は常に新しいオブジェクトで差し替えるので浅い watch でよい
watch(query, scheduleSearch)
watch(filter, scheduleSearch)

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.isComposing) {
    if (debounce) clearTimeout(debounce)
    void search()
  }
}

function scrollToTop() {
  if (noteScrollerRef.value) {
    noteScrollerRef.value.scrollToIndex(0, {
      align: 'start',
      behavior: 'smooth',
    })
  } else {
    scroller.value?.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

const emptyMessage = computed(() =>
  hasSearched.value
    ? i18n.ts._deckClientSearchColumn.noMatches
    : i18n.ts._deckClientSearchColumn.emptyHint,
)

onMounted(async () => {
  if (!accountsStore.isLoaded) await accountsStore.loadAccounts()
  // 保存された条件があれば開いた時点で引く (無ければ案内のまま)
  void search()
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || i18n.ts._columns.clientSearch"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
    @refresh="search"
  >
    <template #header-icon>
      <i :class="$style.tlHeaderIcon" class="ti ti-archive" />
    </template>

    <template #header-extra>
      <div :class="$style.searchBar">
        <i :class="$style.searchIcon" class="ti ti-search" />
        <input
          v-model="query"
          :class="$style.searchInput"
          type="text"
          :placeholder="i18n.ts._deckClientSearchColumn.searchPlaceholder"
          @input="onQueryInput"
          @keydown="onKeydown"
        />
        <button
          :class="[$style.iconBtn, { [$style.iconBtnActive]: filter.ascending }]"
          class="_button"
          :title="filter.ascending ? i18n.ts._deckClientSearchColumn.oldestFirst : i18n.ts._deckClientSearchColumn.newestFirst"
          @click="toggleSort"
        >
          <i :class="filter.ascending ? 'ti ti-sort-ascending' : 'ti ti-sort-descending'" />
        </button>
        <!-- 絞り込みはノートカラムと同じ漏斗 → ポップアップ (#1180)。検索の行を差し込む -->
        <ColumnFilterButton
          :column="column"
          :active="hasActiveFilter(filter)"
          :show-queries="false"
          :theme-vars="columnThemeVars"
          wide
          compact
        >
          <template #extra>
            <SearchFilterPanel
              face="client"
              :filter="filter"
              :scope-options="scopeOptions"
              @update="onFilterUpdate"
            />
          </template>
        </ColumnFilterButton>
      </div>

    </template>

    <ColumnEmptyState
      v-if="error"
      :error="error"
      :account-id="column.accountId"
      is-error
      :image-url="serverErrorImageUrl"
      :cta-label="i18n.ts._common.retry"
      cta-icon="ti-refresh"
      @cta="search"
    />

    <div v-else :class="$style.tlBody">
      <ColumnEmptyState
        v-if="notes.length === 0 && !isLoading"
        :message="emptyMessage"
        :image-url="serverInfoImageUrl"
      />

      <NoteScroller
        v-else
        ref="noteScrollerRef"
        :items="groups"
        :class="$style.tlScroller"
        @scroll="onScrollReport"
        @near-end="loadMore"
      >
        <template #default="{ item }">
          <div>
            <MkNote
              :note="item.primary"
              :group="item"
              @react="handlers.reaction"
              @reply="handlers.reply"
              @renote="handlers.renote"
              @quote="handlers.quote"
              @delete="removeNote"
              @edit="handlers.edit"
              @bookmark="handlers.bookmark"
              @delete-and-edit="handlers.deleteAndEdit"
              @vote="handlers.vote"
            />
          </div>
        </template>

        <template #append>
          <div v-if="isLoading && notes.length > 0" :class="$style.loadingMore">
            <LoadingSpinner />
          </div>
        </template>
      </NoteScroller>
    </div>
  </DeckColumn>
  <ColumnCrossPostForm :post-form="postForm" @posted="postForm.close" />
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.searchBar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
  background: var(--nd-bg);
}

.searchIcon {
  flex-shrink: 0;
  opacity: 0.4;
}

.searchInput {
  flex: 1;
  min-width: 0;
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  padding: 6px 10px;
  font-size: 0.85em;
  color: var(--nd-fg);
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.iconBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  opacity: 0.35;
  font-size: 0.9em;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 0.7;
  }
}

.iconBtnActive {
  opacity: 1;
  color: var(--nd-accent);
}

// 外部からの検索語の差し替えで本文の条件が止まっている




@keyframes conditionsIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
  }
}

@keyframes conditionsOut {
  to {
    opacity: 0;
    transform: scale(0.95) translateY(-4px);
  }
}
</style>
