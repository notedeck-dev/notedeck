<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
import {
  type ClientSearchFilter,
  dateBounds,
  hasActiveFilter,
  resolveScopeAccounts,
} from '@/services/clientSearch'
import { variantKeyOf } from '@/services/noteKey'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { AppError } from '@/utils/errors'
import { commands, unwrap } from '@/utils/tauriInvoke'
import ColumnCrossPostForm from './ColumnCrossPostForm.vue'
import DeckColumn from './DeckColumn.vue'

/**
 * クライアント検索 (#945 / #958): 手元のキャッシュをサーバー・アカウント横断で
 * 引く面。サーバー検索 (Misskey の notes/search) とは並立する。
 * 検索語が空でも絞り込みだけで引ける (「直近 1 週間の画像付き」など)。
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

// --- 検索条件 (カラムに永続化) ---
const query = ref(props.column.query ?? '')
const filter = ref<ClientSearchFilter>({
  ...(props.column.clientSearchFilter ?? {}),
})
const showFilters = ref(hasActiveFilter(filter.value))
const hasSearched = ref(false)
const hasMore = ref(true)

/** select の値: '' / server:<host> / account:<id> */
const scopeOptions = computed(() => {
  const hosts = [...new Set(accountsStore.accounts.map((a) => a.host))]
  return {
    servers: hosts,
    accounts: accountsStore.accounts,
  }
})

function persist() {
  deckStore.updateColumn(props.column.id, {
    query: query.value,
    clientSearchFilter: { ...filter.value },
  })
}

function scopedAccountIds(): string[] {
  return resolveScopeAccounts(filter.value.scope, accountsStore.accounts)
}

async function fetchPage(untilDate: string | null): Promise<NormalizedNote[]> {
  const accountIds = scopedAccountIds()
  if (accountIds.length === 0) return []
  const bounds = dateBounds(filter.value)
  // ページングは表示中の最古 (最新順) / 最新 (古い順) を境界にする。境界は
  // 両端含みなので重なった 1 件は行キーで除外する
  const until = filter.value.ascending
    ? bounds.until
    : (untilDate ?? bounds.until)
  const since = filter.value.ascending
    ? (untilDate ?? bounds.since)
    : bounds.since
  return unwrap(
    await commands.apiSearchNotesCachedAcross(
      accountIds,
      query.value.trim(),
      PAGE_SIZE,
      since,
      until,
      filter.value.ascending ?? false,
      filter.value.author?.trim() || null,
      filter.value.hasFiles ?? null,
      null,
    ),
  ) as NormalizedNote[]
}

let generation = 0

async function search() {
  const gen = ++generation
  error.value = null
  isLoading.value = true
  hasSearched.value = true
  persist()
  try {
    const found = await fetchPage(null)
    if (gen !== generation) return
    setNotes(found)
    hasMore.value = found.length >= PAGE_SIZE
  } catch (e) {
    if (gen === generation) error.value = AppError.from(e)
  } finally {
    if (gen === generation) isLoading.value = false
  }
}

async function loadMore() {
  if (isLoading.value || !hasMore.value) return
  const last = rawNotes.value.at(-1)
  if (!last) return
  const gen = generation
  isLoading.value = true
  try {
    const found = await fetchPage(last.createdAt)
    if (gen !== generation) return
    const known = new Set(rawNotes.value.map(variantKeyOf))
    const fresh = found.filter((n) => !known.has(variantKeyOf(n)))
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
watch(query, scheduleSearch)
watch(filter, scheduleSearch, { deep: true })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.isComposing) {
    if (debounce) clearTimeout(debounce)
    void search()
  }
}

function toggleSort() {
  filter.value = { ...filter.value, ascending: !filter.value.ascending }
}

function clearFilters() {
  filter.value = { ascending: filter.value.ascending }
}

const hasFilesValue = computed({
  get: () =>
    filter.value.hasFiles === undefined ? '' : String(filter.value.hasFiles),
  set: (v: string) => {
    filter.value = {
      ...filter.value,
      hasFiles: v === '' ? undefined : v === 'true',
    }
  },
})

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
    ? '手元のキャッシュに一致するノートはありません'
    : '検索語か絞り込みを入れると、手元に貯めたノートから引きます',
)

onMounted(async () => {
  if (!accountsStore.isLoaded) await accountsStore.loadAccounts()
  // 保存された条件があれば開いた時点で引く
  if (query.value.trim() || hasActiveFilter(filter.value)) void search()
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
          @keydown="onKeydown"
        />
        <button
          :class="[$style.iconBtn, { [$style.iconBtnActive]: showFilters || hasActiveFilter(filter) }]"
          class="_button"
          :title="i18n.ts._deckClientSearchColumn.filter"
          @click="showFilters = !showFilters"
        >
          <i class="ti ti-filter" />
        </button>
        <button
          :class="[$style.iconBtn, { [$style.iconBtnActive]: filter.ascending }]"
          class="_button"
          :title="filter.ascending ? i18n.ts._deckClientSearchColumn.oldestFirst : i18n.ts._deckClientSearchColumn.newestFirst"
          @click="toggleSort"
        >
          <i :class="filter.ascending ? 'ti ti-sort-ascending' : 'ti ti-sort-descending'" />
        </button>
      </div>

      <div v-if="showFilters" :class="$style.filters">
        <label :class="$style.filterRow">
          <span :class="$style.filterLabel">{{ i18n.ts._deckClientSearchColumn.scope }}</span>
          <select v-model="filter.scope" :class="$style.filterInput">
            <option value="">{{ i18n.ts._deckClientSearchColumn.allAccounts }}</option>
            <option v-for="host in scopeOptions.servers" :key="`s:${host}`" :value="`server:${host}`">
              {{ i18n.tsx._deckClientSearchColumn.serverOption({ host }) }}
            </option>
            <option v-for="acc in scopeOptions.accounts" :key="acc.id" :value="`account:${acc.id}`">
              @{{ acc.username }}@{{ acc.host }}
            </option>
          </select>
        </label>
        <label :class="$style.filterRow">
          <span :class="$style.filterLabel">{{ i18n.ts._deckClientSearchColumn.author }}</span>
          <input
            v-model="filter.author"
            :class="$style.filterInput"
            type="text"
            :placeholder="i18n.ts._deckClientSearchColumn.authorPlaceholder"
          />
        </label>
        <div :class="$style.filterRow">
          <span :class="$style.filterLabel">{{ i18n.ts._deckClientSearchColumn.period }}</span>
          <input v-model="filter.since" type="date" :class="$style.filterInput" :title="i18n.ts._deckClientSearchColumn.since" />
          <i :class="$style.dateSeparator" class="ti ti-minus" />
          <input v-model="filter.until" type="date" :class="$style.filterInput" :title="i18n.ts._deckClientSearchColumn.until" />
        </div>
        <label :class="$style.filterRow">
          <span :class="$style.filterLabel">{{ i18n.ts._deckClientSearchColumn.attachments }}</span>
          <select v-model="hasFilesValue" :class="$style.filterInput">
            <option value="">{{ i18n.ts._deckClientSearchColumn.attachmentsAny }}</option>
            <option value="true">{{ i18n.ts._deckClientSearchColumn.attachmentsYes }}</option>
            <option value="false">{{ i18n.ts._deckClientSearchColumn.attachmentsNo }}</option>
          </select>
        </label>
        <button
          v-if="hasActiveFilter(filter)"
          :class="$style.clearBtn"
          class="_button"
          @click="clearFilters"
        >
          <i class="ti ti-x" />
          {{ i18n.ts._deckClientSearchColumn.clearFilters }}
        </button>
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

.filters {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 12px 8px;
  border-bottom: 1px solid var(--nd-divider);
  background: var(--nd-bg);
}

.filterRow {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filterLabel {
  flex: 0 0 3em;
  font-size: 0.75em;
  opacity: 0.6;
}

.filterInput {
  flex: 1;
  min-width: 0;
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  padding: 4px 6px;
  font-size: 0.8em;
  color: var(--nd-fg);
  color-scheme: dark;
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }
}

.dateSeparator {
  font-size: 0.7em;
  opacity: 0.4;
}

.clearBtn {
  align-self: flex-end;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--nd-radius-sm);
  font-size: 0.75em;
  opacity: 0.6;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}
</style>
