<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRaw, watch } from 'vue'
import type { NormalizedNote, TimelineFilter } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import { useColumnQuery } from '@/composables/useColumnQuery'
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
} from '@/services/searchFilter'
import {
  allowsAutoContinue,
  decideContinue,
  type SearchTrigger,
  shouldStartSearch,
} from '@/services/searchRun'
import { getAccountLabel, useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import { matchesFilter } from '@/utils/timelineFilter'
import ColumnCrossPostForm from './ColumnCrossPostForm.vue'
import ColumnFilterButton from './ColumnFilterButton.vue'
import ColumnQueryBadge from './ColumnQueryBadge.vue'
import ColumnQueryBanners from './ColumnQueryBanners.vue'
import DeckColumn from './DeckColumn.vue'
import SearchFilterPanel from './SearchFilterPanel.vue'

/**
 * クライアント検索 (#945 / #958): 手元のキャッシュをサーバー・アカウント横断で
 * 引く面。サーバー検索 (Misskey の notes/search) とは並立する。
 * 検索語が空でも絞り込みだけで引ける (「直近 1 週間の画像付き」など)。
 * 絞り込みパネルと本文の条件はサーバー検索と共有 (#1180)。
 * カラムクエリ (#783) はノートカラムと同じ縫い目 (useColumnQuery) で、索引から
 * 返ったページを列に入れる前に判定する (#1178)。
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

const { notes, groups, rawNotes, setNotes, removeNote, onNoteUpdate } =
  useNoteList({
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

// --- カラムクエリ (#1178)。評価器はノートカラムと共有。streaming は無い ---
const {
  columnQueryState,
  queryErrorCount,
  suspendedQueryKeys,
  querySuspendedCount,
  missingQueryIds,
  resumeSuspendedQueries,
  dropMissingQueryRefs,
  applyQueryFilter,
} = useColumnQuery({
  getColumn: () => props.column,
  rawNotes,
  setNotes: (n) => setNotes(n),
  // クエリの変更と「再開」は同じ条件で検索をやり直す (落とした結果は保持していない)
  refresh: () => search('explicit'),
  enqueue: () => {
    // streaming は無い (索引から取るだけ)
  },
  onNoteUpdate,
})

/** クエリが止まっている (fail-closed / サスペンド)。この間は保留で、走査を続けない */
const queryBlocked = computed(
  () =>
    columnQueryState.value.status === 'invalid' ||
    suspendedQueryKeys.value.length > 0,
)

function openQueryManager(): void {
  deckStore.toggleSidebarColumn('queryManager', null)
}

// --- 検索 ---

/**
 * ノートカラムと同じ組込トグル (#841 の規則で意味を持つものだけ)。添付は
 * フィルターの行にあるので出さない。評価は索引から返ったページへの手元判定
 */
const BUILTIN_FILTER_KEYS: (keyof TimelineFilter)[] = [
  'withRenotes',
  'withReplies',
  'withBots',
  'withSensitive',
]

/** 検索を始める規則 (1 本)。開いた時点 / 条件の変更 / クエリの切替 / 外の変化で同じ */
function shouldSearch(): boolean {
  return shouldStartSearch({
    term: query.value,
    filter: filter.value,
    queryStatus: columnQueryState.value.status,
    builtin: props.column.filters,
  })
}
// 組込トグルはフィルターメニューがカラムに直接書くので、変化を見て引き直す
watch(
  () => JSON.stringify(props.column.filters ?? null),
  () => scheduleSearch('explicit'),
)

/**
 * 本文の条件を索引側の引数に畳む。「いずれかを含む」は行ごとに 1 つの OR 群に
 * して群どうしを AND (#1182)。「すべて」と「除外」は語をまとめてよい (AND / NOT
 * は行をまたいでも意味が変わらない)
 */
function textArgs(): Pick<
  NonNullable<Parameters<typeof commands.apiSearchNotesCachedAcross>[6]>,
  'textAny' | 'textAll' | 'textExclude'
> {
  const anyGroups: string[][] = []
  const all: string[] = []
  const exclude: string[] = []
  for (const cond of effectiveConditions(filter.value)) {
    const words = cond.words.filter(Boolean)
    if (words.length === 0) continue
    if (cond.type === 'contains_any') anyGroups.push(words)
    else if (cond.type === 'contains_all') all.push(...words)
    else exclude.push(...words)
  }
  return {
    textAny: anyGroups.length > 0 ? anyGroups : null,
    textAll: all.length > 0 ? all : null,
    textExclude: exclude.length > 0 ? exclude : null,
  }
}

/**
 * ページ位置は照合前の生ページの末尾 (最新順なら最古、古い順なら最新) の
 * created_at。クエリで 1 ページ丸ごと落ちても位置が進むよう、表示中の
 * 末尾ではなく生ページで持つ
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

/**
 * クエリで除外した件数 (確定した検索 1 回分、追加読み込みと自動続行は累積)。
 * 評価器の件数はクエリ変更時の表示中への再判定も数えるので、ここでは取り直し後の
 * 走査で数えたものだけを持つ (同じノートを二重に数えない)
 */
const excludedCount = ref(0)
/** クエリが止まっている間に取れたが列に入れられない件数 (除外ではなく保留) */
const heldCount = ref(0)
/** 自動続行が走っている */
const scanning = ref(false)
/** 自動続行が上限で止まった (理由を見せる) */
const stoppedAtLimit = ref(false)

/** 列に入れるすべての入口はここを通る (判定を通さない入口を残さない)。組込 (最安) → クエリ */
async function admit(page: NormalizedNote[]): Promise<NormalizedNote[]> {
  const builtin = page.filter((n) => matchesFilter(n, props.column.filters))
  const admitted = await applyQueryFilter(builtin)
  // 組込トグルで落ちた分は「クエリで除外」ではないので数えない
  const dropped = builtin.length - admitted.length
  if (queryBlocked.value) heldCount.value += dropped
  else excludedCount.value += dropped
  return admitted
}

let generation = 0

function resetRun() {
  pageCursor = null
  excludedCount.value = 0
  heldCount.value = 0
  stoppedAtLimit.value = false
}

async function search(trigger: SearchTrigger = 'explicit') {
  const gen = ++generation
  error.value = null
  scanning.value = false
  if (query.value !== (props.column.query ?? '')) {
    deckStore.updateColumn(props.column.id, { query: query.value })
  }
  // 条件が 1 つも無ければ案内に戻す (索引全件は出さない)
  if (!shouldSearch()) {
    setNotes([])
    resetRun()
    hasMore.value = false
    hasSearched.value = false
    isLoading.value = false
    return
  }
  isLoading.value = true
  hasSearched.value = true
  try {
    const page = await fetchPage(null)
    if (gen !== generation) return
    resetRun()
    const admitted = await admit(page)
    if (gen !== generation) return
    // やり直しが終わるまで表示中の結果は消さない (ここで初めて差し替える)
    setNotes(admitted)
    pageCursor = page.at(-1)?.createdAt ?? null
    hasMore.value = page.length >= PAGE_SIZE
    if (allowsAutoContinue(trigger)) {
      await continueRun(gen, page.length, admitted.length)
    }
  } catch (e) {
    if (gen === generation) error.value = AppError.from(e)
  } finally {
    if (gen === generation) isLoading.value = false
  }
}

/** 次の生ページを取り、判定を通ったものを列に足す。走査した件数と足せた件数を返す */
async function loadPage(
  gen: number,
): Promise<{ scanned: number; added: number }> {
  const page = await fetchPage(pageCursor)
  if (gen !== generation) return { scanned: 0, added: 0 }
  const known = new Set(rawNotes.value.map(variantKeyOf))
  const fresh = page.filter((n) => !known.has(variantKeyOf(n)))
  pageCursor = page.at(-1)?.createdAt ?? pageCursor
  hasMore.value = page.length >= PAGE_SIZE && fresh.length > 0
  const admitted = await admit(fresh)
  if (gen !== generation) return { scanned: 0, added: 0 }
  if (admitted.length > 0) {
    setNotes([...rawNotes.value, ...admitted], 'newest')
  }
  return { scanned: page.length, added: admitted.length }
}

/** 描画が済んでから、表示が一画面を超えているかを測る (ノートの高さは可変) */
async function viewportFilled(): Promise<boolean> {
  await nextTick()
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve())
    } else {
      resolve()
    }
  })
  const el = scroller.value
  if (!el) return true
  return el.scrollHeight > el.clientHeight + 1
}

/**
 * 自動続行。明示の操作で始まった走査だけが入り、表示が一画面に満たない間か
 * 直前のページで 1 件も足せなかった間、走査件数の上限まで続ける。クエリが
 * 止まっている間は続けない。新しい検索が始まったら次のページを取らずに止める
 */
async function continueRun(gen: number, scanned: number, lastAdded: number) {
  scanning.value = true
  try {
    let total = scanned
    let added = lastAdded
    for (;;) {
      if (gen !== generation) return
      const decision = decideContinue({
        hasMore: hasMore.value,
        queryBlocked: queryBlocked.value,
        scanned: total,
        viewportFilled: await viewportFilled(),
        lastAdded: added,
      })
      if (gen !== generation) return
      if (decision === 'stop:limit') {
        stoppedAtLimit.value = true
        return
      }
      if (decision !== 'continue') return
      const r = await loadPage(gen)
      total += r.scanned
      added = r.added
    }
  } finally {
    if (gen === generation) scanning.value = false
  }
}

/** 追加読み込み (スクロールの末尾到達 / 続きを読む)。明示の操作なので続行してよい */
async function loadMore() {
  if (isLoading.value || scanning.value || !hasMore.value || !pageCursor) return
  const gen = generation
  isLoading.value = true
  stoppedAtLimit.value = false
  try {
    const r = await loadPage(gen)
    if (gen !== generation) return
    await continueRun(gen, r.scanned, r.added)
  } catch (e) {
    if (gen === generation) error.value = AppError.from(e)
  } finally {
    if (gen === generation) isLoading.value = false
  }
}

// 入力のたびに引き直す (手元のキャッシュなので安い)。300ms でまとめる。
// 入力中の検索は最初のページで止める (1 打鍵ごとに上限まで走査しない)
let debounce: ReturnType<typeof setTimeout> | null = null
function scheduleSearch(trigger: SearchTrigger) {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    void search(trigger)
  }, 300)
}
watch(query, () => scheduleSearch('typed'))
// filter は常に新しいオブジェクトで差し替えるので浅い watch でよい
watch(filter, () => scheduleSearch('explicit'))

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.isComposing) {
    if (debounce) clearTimeout(debounce)
    void search('explicit')
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

/**
 * 空状態の区別: 条件なし (案内) / クエリは適用してあるが条件に数えていない
 * (理由つき) / 保留 (fail-closed) / クエリで全件除外 / 結果なし
 */
const emptyMessage = computed(() => {
  // 文言はフルパスで引く (辞書の参照検査が間接参照を拾わない)
  if (!hasSearched.value) {
    if (columnQueryState.value.status === 'safeMode') {
      return i18n.ts._deckClientSearchColumn.queryNotCountedSafeMode
    }
    if (columnQueryState.value.status === 'disabled') {
      return i18n.ts._deckClientSearchColumn.queryNotCountedDisabled
    }
    return i18n.ts._deckClientSearchColumn.emptyHint
  }
  if (queryBlocked.value && heldCount.value > 0) {
    return i18n.ts._deckClientSearchColumn.queryPending
  }
  if (excludedCount.value > 0) {
    return i18n.tsx._deckClientSearchColumn.queryExcludedAll_plural({
      count: excludedCount.value,
    })
  }
  return i18n.ts._deckClientSearchColumn.noMatches
})

onMounted(async () => {
  if (!accountsStore.isLoaded) await accountsStore.loadAccounts()
  // 保存された条件があれば開いた時点で引く (無ければ案内のまま)。
  // 起動時は最初のページで止め、続きは利用者の操作から
  void search('restore')
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || i18n.ts._columns.clientSearch"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
    @refresh="search('explicit')"
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
        <!-- クエリバッジは漏斗の隣 (どちらも絞り込みの状態、ノートカラムと同じ) -->
        <ColumnQueryBadge
          :state="columnQueryState"
          :error-count="queryErrorCount"
          @open="openQueryManager"
        />
        <!-- 絞り込みはノートカラムと同じ漏斗 → ポップアップ (#1180)。検索の行を差し込み、
             クエリのトグルも同じポップアップに出る (#1178) -->
        <ColumnFilterButton
          :column="column"
          :filter-keys="BUILTIN_FILTER_KEYS"
          :active="hasActiveFilter(filter)"
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
      @cta="search('explicit')"
    />

    <div v-else :class="$style.tlBody">
      <ColumnQueryBanners
        :state="columnQueryState"
        :error-count="queryErrorCount"
        :missing-ids="missingQueryIds"
        :suspended-keys="suspendedQueryKeys"
        :suspended-count="querySuspendedCount"
        @resume="resumeSuspendedQueries"
        @drop-missing="dropMissingQueryRefs"
      />

      <!-- 0 件でも索引に続きがあれば続きを読める (全除外でスクロールが起こせないため) -->
      <ColumnEmptyState
        v-if="notes.length === 0 && !isLoading && !scanning"
        :message="emptyMessage"
        :image-url="serverInfoImageUrl"
        :cta-label="hasMore && !queryBlocked ? i18n.ts._deckClientSearchColumn.readMore : undefined"
        cta-icon="ti-arrow-down"
        @cta="loadMore"
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
          <div v-if="scanning || (isLoading && notes.length > 0)" :class="$style.loadingMore">
            <LoadingSpinner />
            <span v-if="scanning" :class="$style.footerText">{{ i18n.ts._deckClientSearchColumn.scanning }}</span>
          </div>
          <!-- 検索は有限の答えなので、結果が残っていても除外した件数を見せる -->
          <div
            v-else-if="hasSearched && (excludedCount > 0 || hasMore || stoppedAtLimit)"
            :class="$style.footer"
          >
            <span v-if="excludedCount > 0" :class="$style.footerText">
              {{ i18n.tsx._deckClientSearchColumn.queryExcluded_plural({ count: excludedCount }) }}
            </span>
            <span v-if="stoppedAtLimit" :class="$style.footerText">
              {{ i18n.ts._deckClientSearchColumn.stoppedAtLimit }}
            </span>
            <button
              v-if="hasMore && !queryBlocked"
              class="_button"
              :class="$style.readMoreBtn"
              @click="loadMore"
            >
              <i class="ti ti-arrow-down" />
              {{ i18n.ts._deckClientSearchColumn.readMore }}
            </button>
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

.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px;
  font-size: 0.8em;
}

.footerText {
  opacity: 0.6;
}

.readMoreBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}
</style>
