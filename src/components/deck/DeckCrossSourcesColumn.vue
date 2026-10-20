<script setup lang="ts">
/**
 * サーバーに閉じた ID を選ぶ面 (リスト / アンテナ / クリップ / チャンネル / ロール /
 * ユーザー) の全アカウント表示 (#1017 案 2)。カラムの `sources` (アカウント +
 * リソース ID の組) を `useCrossAccountNotes` で束ねる。per-account は各カラムが
 * `DeckNoteColumn` に委ねるので、ここは組の取得・購読の口を受けるだけ。
 */
import { computed } from 'vue'
import type {
  ChannelSubscription,
  NormalizedNote,
  NoteUpdateEvent,
  ServerAdapter,
  TimelineFilter,
} from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import CrossAccountEndMarker from '@/components/common/CrossAccountEndMarker.vue'
import CrossAccountProgress from '@/components/common/CrossAccountProgress.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import NewNotesBanner from '@/components/deck/NewNotesBanner.vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useCrossAccountNotes } from '@/composables/useCrossAccountNotes'
import { provideNoteFrame } from '@/composables/useNoteFrame'
import type { VisibilityOpts } from '@/composables/useNoteVisibility'
import { i18n } from '@/i18n'
import { type ColumnSource, normalizeSources } from '@/services/columnSource'
import { matchesFilter } from '@/services/timelineFilter'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import ColumnCrossPostForm from './ColumnCrossPostForm.vue'
import ColumnFilterButton from './ColumnFilterButton.vue'
import ColumnPullFrame from './ColumnPullFrame.vue'
import ColumnQueryBadge from './ColumnQueryBadge.vue'
import ColumnQueryBanners from './ColumnQueryBanners.vue'
import DeckColumn from './DeckColumn.vue'

const props = defineProps<{
  column: DeckColumnType
  title: string
  /** tabler アイコン名 (`ti-` 付き) */
  icon: string
  /** Stream Inspector に出す種別 */
  columnType: string
  fetchNotes: (
    adapter: ServerAdapter,
    opts: { untilId?: string } | undefined,
    source: ColumnSource,
  ) => Promise<NormalizedNote[]>
  cacheKeyOf: (source: ColumnSource) => string | null
  /** 組ごとのライブ購読。無い面 (クリップ / ユーザー) は省く */
  subscribe?: (
    accountId: string,
    source: ColumnSource,
    enqueue: (note: NormalizedNote) => void,
    callbacks: { onNoteUpdated: (event: NoteUpdateEvent) => void },
  ) => ChannelSubscription
  visibility?: VisibilityOpts
  /** 組込フィルタのトグル (per-account の `filter-keys` と同じ)。無い面は省く */
  filterKeys?: (keyof TimelineFilter)[]
}>()

const deckStore = useDeckStore()

const isCrossAccount = computed(() => props.column.accountId == null)
// 全アカウント面ではノートの基準サーバーを絶対にする (#1059)
provideNoteFrame(isCrossAccount)

const sources = computed(() => normalizeSources(props.column.sources))

const {
  columnThemeVars,
  serverInfoImageUrl,
  serverErrorImageUrl,
  isLoading,
  error,
  handlers,
  postForm,
  scroller,
  onScrollReport,
} = useColumnSetup(() => props.column)

const subscribeSource = props.subscribe
const {
  notes,
  groups,
  noteScrollerRef,
  scrollToTop,
  connectCrossAccount,
  loadMoreCrossAccount,
  handleScroll,
  removeNote,
  pendingCount,
  animatingRowKeys,
  crossProgress,
  crossEndState,
  isPulling,
  isPulledEnough,
  isRefreshing,
  displayHeight,
  columnQueryState,
  columnQueryErrorCount,
  columnQueryExcludedCount,
  columnQuerySuspendedKeys,
  columnQuerySuspendedCount,
  columnQueryMissingIds,
  resumeSuspendedQueries,
  dropMissingQueryRefs,
} = useCrossAccountNotes({
  fetchNotes: (adapter, opts, source) =>
    props.fetchNotes(adapter, opts, source),
  sources: () => sources.value,
  isCrossAccount: () => isCrossAccount.value,
  cacheKey: (source) => props.cacheKeyOf(source),
  // 組込フィルタ + カラムクエリは per-account と同じ評価器で全経路に通す。
  // 組込フィルタの API 側パラメータは面ごとに違うのでクライアント側の防御層だけ
  filter: {
    getColumn: () => props.column,
    builtinAdmits: (n) => matchesFilter(n, props.column.filters),
  },
  // 組はどれも createdAt 順で並ぶ面なので、下端はいちばん浅い組の到達点で揃える
  paging: 'horizon',
  visibility: props.visibility,
  isLoading,
  error,
  scroller,
  onScrollReport,
  deleteNote: handlers.delete,
  streaming: subscribeSource
    ? {
        columnId: props.column.id,
        columnType: props.columnType,
        subscribe: (accountId, _adapter, enqueue, callbacks, source) =>
          subscribeSource(accountId, source, enqueue, callbacks),
      }
    : undefined,
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || title"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
    @refresh="connectCrossAccount"
  >
    <template #header-icon>
      <i :class="['ti', icon, $style.tlHeaderIcon]" />
    </template>

    <template #header-extra>
      <div :class="$style.subHeaderRow">
        <div :class="$style.subHeaderMain" />
        <ColumnQueryBadge
          :state="columnQueryState"
          :error-count="columnQueryErrorCount"
          @open="deckStore.toggleSidebarColumn('queryManager', null)"
        />
        <ColumnFilterButton
          :column="column"
          :filter-keys="filterKeys"
          :theme-vars="columnThemeVars"
        />
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
      @cta="connectCrossAccount"
    />

    <div v-else :class="$style.tlBody">
      <ColumnPullFrame
        :is-pulling="isPulling"
        :is-pulled-enough="isPulledEnough"
        :is-refreshing="isRefreshing"
        :height="displayHeight()"
      />
      <ColumnQueryBanners
        :state="columnQueryState"
        :error-count="columnQueryErrorCount"
        :missing-ids="columnQueryMissingIds"
        :suspended-keys="columnQuerySuspendedKeys"
        :suspended-count="columnQuerySuspendedCount"
        @resume="resumeSuspendedQueries"
        @drop-missing="dropMissingQueryRefs"
      />
      <!-- 組が無いカラム (アカウントを消して空になった等) は取りに行く先が無い -->
      <ColumnEmptyState
        v-if="sources.length === 0"
        :message="i18n.ts._deckCrossSourcesColumn.noSources"
        :image-url="serverInfoImageUrl"
      />
      <ColumnEmptyState
        v-else-if="notes.length === 0 && !isLoading"
        :message="columnQueryExcludedCount > 0 ? i18n.ts._deckCrossSourcesColumn.allExcluded : i18n.ts._deckCrossSourcesColumn.empty"
        :image-url="serverInfoImageUrl"
      />

      <template v-else>
        <NewNotesBanner :show="pendingCount > 0" @click="scrollToTop()" />

        <NoteScroller
          ref="noteScrollerRef"
          :items="groups"
          :animating-ids="animatingRowKeys"
          :class="[$style.tlScroller, 'nd-fade-appear']"
          @scroll="handleScroll"
          @near-end="loadMoreCrossAccount"
        >
          <template #default="{ item, nearViewport }">
            <div>
              <MkNote
                :near-viewport="nearViewport"
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
            <div v-if="isLoading && crossProgress" :class="$style.loadingMore">
              <CrossAccountProgress :progress="crossProgress" :size="20" />
            </div>
            <div v-else-if="isLoading && notes.length > 0" :class="$style.loadingMore">
              <LoadingSpinner />
            </div>
            <CrossAccountEndMarker v-else-if="crossEndState" :state="crossEndState" />
          </template>
        </NoteScroller>
      </template>
    </div>
  </DeckColumn>
  <ColumnCrossPostForm :post-form="postForm" @posted="postForm.close" />
</template>

<style lang="scss" module>
@use './column-common.module.scss';

/* 全アカウント面のサブヘッダ (DeckTimelineColumn と同じ行構成) */
.subHeaderRow {
  display: flex;
  align-items: stretch;
  background: var(--nd-bg);
}

.subHeaderMain {
  flex: 1;
  min-width: 0;
}
</style>
