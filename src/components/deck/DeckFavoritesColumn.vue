<script setup lang="ts">
import { computed, watch } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import CrossAccountProgress from '@/components/common/CrossAccountProgress.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useCrossAccountNotes } from '@/composables/useCrossAccountNotes'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { provideNoteFrame } from '@/composables/useNoteFrame'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import {
  accountsCacheKeyDeps,
  columnCacheKey,
  FAVORITES_CACHE_KEY,
} from '@/utils/columnCacheKey'
import DeckColumn from './DeckColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const cacheKeyDeps = accountsCacheKeyDeps()

// 自分が保存した面。凍結は貫通させる（本家 i/favorites も貫通）。
// ミュートは自分の意思なので適用したまま（#606）
const visibility = { ignoreSuspension: true } as const

const isCrossAccount = computed(() => props.column.accountId == null)
// 全アカウント面ではノートの基準サーバーを絶対にする (#1059)
provideNoteFrame(isCrossAccount)

// Single-account config
const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) => adapter.api.getFavorites(opts),
  cache: {
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
  },
  visibility,
}

// Cross-account state (#1017): 各アカウントのお気に入りを並べる。
// ストリーミングは無い (お気に入りにライブ更新の経路が無い) ので、
// お気に入りの登録 / 解除は無効化シグナルで取り直す
const {
  columnThemeVars,
  serverInfoImageUrl,
  serverErrorImageUrl,
  isLoading,
  error,
  handlers,
  scroller,
  onScrollReport,
} = useColumnSetup(() => props.column)

const {
  notes,
  groups,
  noteScrollerRef,
  scrollToTop,
  connectCrossAccount,
  loadMoreCrossAccount,
  handleScroll,
  removeNote,
  react: reactCrossAccount,
  bookmark: bookmarkCrossAccount,
  vote: voteCrossAccount,
  crossProgress,
} = useCrossAccountNotes({
  fetchNotes: (adapter, opts) => adapter.api.getFavorites(opts),
  isCrossAccount: () => isCrossAccount.value,
  cacheKey: () => columnCacheKey(props.column, cacheKeyDeps),
  visibility,
  isLoading,
  error,
  scroller,
  onScrollReport,
})

// per-account 面 (useNoteColumn) と同じく、お気に入りの登録 / 解除で出る
// 無効化シグナルを見て取り直す
const deckStore = useDeckStore()
watch(
  () => deckStore.columnInvalidation[FAVORITES_CACHE_KEY],
  () => {
    if (isCrossAccount.value) connectCrossAccount()
  },
)
</script>

<template>
  <!-- Cross-account mode -->
  <DeckColumn
    v-if="isCrossAccount"
    :column-id="column.id"
    :title="column.name || 'お気に入り'"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
    @refresh="connectCrossAccount"
  >
    <template #header-icon>
      <i :class="['ti', 'ti-star', $style.tlHeaderIcon]" />
    </template>

    <ColumnEmptyState
      v-if="error"
      :error="error"
      :account-id="column.accountId"
      is-error
      :image-url="serverErrorImageUrl"
      cta-label="再試行"
      cta-icon="ti-refresh"
      @cta="connectCrossAccount"
    />

    <div v-else :class="$style.tlBody">
      <ColumnEmptyState
        v-if="notes.length === 0 && !isLoading"
        message="お気に入りはありません"
        :image-url="serverInfoImageUrl"
      />

      <NoteScroller
        v-else
        ref="noteScrollerRef"
        :items="groups"
        :class="$style.tlScroller"
        @scroll="handleScroll"
        @near-end="loadMoreCrossAccount"
      >
        <template #default="{ item }">
          <div>
            <MkNote
              :note="item.primary"
              :group="item"
              @react="reactCrossAccount"
              @reply="handlers.reply"
              @renote="handlers.renote"
              @quote="handlers.quote"
              @delete="removeNote"
              @edit="handlers.edit"
              @bookmark="bookmarkCrossAccount"
              @delete-and-edit="handlers.deleteAndEdit"
              @vote="voteCrossAccount"
            />
          </div>
        </template>

        <template #append>
          <div v-if="isLoading && crossProgress" :class="$style.loadingMore">
            <CrossAccountProgress :progress="crossProgress" :size="20" />
          </div>
          <div v-else-if="isLoading && notes.length > 0" :class="$style.loadingMore">
            <LoadingSpinner />
          </div>
        </template>
      </NoteScroller>
    </div>
  </DeckColumn>

  <!-- Single-account mode -->
  <DeckNoteColumn
    v-else
    :column="column"
    title="お気に入り"
    icon="ti-star"
    :note-column-config="noteColumnConfig"
  />
</template>

<style lang="scss" module>
@use './column-common.module.scss';
</style>
