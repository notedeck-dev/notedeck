<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  ref,
  useTemplateRef,
} from 'vue'
import type { TimelineFilter } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import ReadMarkerDivider from '@/components/common/ReadMarkerDivider.vue'
import { i18n } from '@/i18n'
import { variantKeyOf } from '@/services/noteKey'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

import { prefetchNoteImages } from '@/composables/useImagePrefetch'
import { prefetchNoteMfm } from '@/composables/useMfmPrefetch'
import {
  type NoteColumnConfig,
  useNoteColumn,
} from '@/composables/useNoteColumn'
import { usePortal } from '@/composables/usePortal'
import { formatHealthDuration, getStreamHealth } from '@/core/streamHealth'
import {
  accountScopeKey,
  isGuestAccount,
  useAccountsStore,
} from '@/stores/accounts'
import {
  isQueryActive,
  isQueryOfferedFor,
  useColumnQueriesStore,
} from '@/stores/columnQueries'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useToast } from '@/stores/toast'
import { webUiUrl as buildWebUiUrl } from '@/utils/url'
import ColumnFilterButton from './ColumnFilterButton.vue'
import ColumnPullFrame from './ColumnPullFrame.vue'
import ColumnQueryBadge from './ColumnQueryBadge.vue'
import ColumnQueryBanners from './ColumnQueryBanners.vue'
import DeckColumn from './DeckColumn.vue'

const props = withDefaults(
  defineProps<{
    column: DeckColumnType
    title: string
    icon: string
    webUiPath?: string
    soundEnabled?: boolean
    showInlinePostForm?: boolean
    noteColumnConfig: NoteColumnConfig
    /** 空状態のメッセージ（デフォルト: まだノートがありません） */
    emptyMessage?: string
    /** チャンネルカラム等、自明な文脈ではノートのチャンネルバッジを非表示にする */
    hideChannelBadge?: boolean
    /**
     * フィルタメニューに出す組込トグル (#841)。未指定はクエリトグルのみ。
     * 適用は useNoteColumn の組込フィルタ (クライアント側) が担う
     */
    filterKeys?: (keyof TimelineFilter)[]
  }>(),
  {},
)

const {
  account,
  columnThemeVars,
  serverIconUrl,
  serverInfoImageUrl,
  serverNotFoundImageUrl,
  serverErrorImageUrl,
  isLoading,
  isOffline,
  isLoggedOut,
  viewMarkerId,
  error,
  columnQueryState,
  columnQueryErrorCount,
  columnQueryExcludedCount,
  columnQuerySuspendedKeys,
  columnQuerySuspendedCount,
  resumeSuspendedQueries,
  columnQueryMissingIds,
  dropMissingQueryRefs,
  notes,
  orderedKeys,
  focusedNoteId,
  pendingCount,
  animatingIds,
  postForm,
  handlers,
  noteScrollerRef,
  removingKeys,
  scroller,
  scrollToTop,
  handleScroll,
  handlePosted,
  removeNote,
  loadMore,
  refresh,
  reconnect,
  switchWithSnapshot,
  isPulling,
  isPulledEnough,
  isRefreshing,
  pullDistance,
  displayHeight,
} = useNoteColumn(props.noteColumnConfig)

const isStreaming = !!props.noteColumnConfig.streaming

const offlineModeStore = useOfflineModeStore()
const realtimeModeStore = useRealtimeModeStore()
const isPollingMode = computed(() => !realtimeModeStore.isRealtime)

// オフラインバッジの詳細 (#698): いつからどの状態かを添える。デスクトップは
// hover tooltip、モバイルは hover が無いのでタップで toast に出す。
// cross-account カラム (accountId なし) や記録なしは既定文言のまま
const offlineDetail = computed(() => {
  if (offlineModeStore.isOfflineMode) return i18n.ts._deckNoteColumn.offlineMode
  const accountId = props.column.accountId
  if (!accountId) return i18n.ts._common.offline
  const h = getStreamHealth(accountId)
  // WS は connected のまま API fetch 失敗でバナーが出るケースがあるので、
  // reconnecting/disconnected 以外は既定文言に落とす
  if (!h || h.state === 'connected' || h.state === 'initializing') {
    return i18n.ts._deckNoteColumn.offlineRequestFailed
  }
  const duration = formatHealthDuration(h.since)
  return h.state === 'reconnecting'
    ? i18n.tsx._deckNoteColumn.reconnectingSince({ duration })
    : i18n.tsx._deckNoteColumn.disconnectedSince({ duration })
})

const toast = useToast()
function showOfflineDetail(): void {
  toast.show(offlineDetail.value, 'info')
}

const webUiUrl = computed(() => {
  if (!props.webUiPath || !account.value) return undefined
  return buildWebUiUrl(account.value.host, props.webUiPath)
})

const postFormPortalRef = useTemplateRef<HTMLElement>('postFormPortalRef')
usePortal(postFormPortalRef)

// --- カラムクエリ (#783): バッジ・フィルタメニュー・バナーは共通部品
// (ColumnQueryBadge / ColumnFilterButton / ColumnQueryBanners) を使う。
// 全アカウント面 (DeckTimelineColumn) と同じ見た目・操作になる
/** バッジから 1 クリックでクエリ管理カラムへ (#783 V25 の調査導線) */
function openQueryManager(): void {
  useDeckStore().toggleSidebarColumn('queryManager', null)
}

/** 空状態: クエリによる全件除外と「TL が空」を区別する (仕様追補 E) */
const effectiveEmptyMessage = computed(() => {
  if (columnQueryState.value.status === 'invalid') {
    return i18n.ts._deckNoteColumn.queryInvalid
  }
  if (
    columnQueryState.value.status === 'active' &&
    columnQueryExcludedCount.value > 0
  ) {
    return i18n.tsx._deckNoteColumn.queryExcludedAll_plural({
      count: columnQueryExcludedCount.value,
    })
  }
  return props.emptyMessage ?? i18n.ts._deckNoteColumn.noNotesYet
})

defineExpose({
  account,
  scroller,
  noteScrollerRef,
  reconnect,
  switchWithSnapshot,
  notes,
  orderedKeys,
  columnThemeVars,
  serverInfoImageUrl,
  serverNotFoundImageUrl,
  serverErrorImageUrl,
})
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name || title"
    :theme-vars="columnThemeVars"
    :web-ui-url="webUiUrl"
    :sound-enabled="soundEnabled"
    require-account
    @header-click="scrollToTop()"
    @refresh="refresh"
  >
    <template #header-icon>
      <slot name="header-icon">
        <i :class="[$style.tlHeaderIcon, 'ti ' + icon]" />
      </slot>
    </template>

    <template #header-meta>
    </template>

    <template #header-extra>
      <div :class="$style.subHeaderRow">
        <div :class="$style.subHeaderMain">
          <slot name="header-extra" />
        </div>
        <!-- クエリバッジはフィルタボタンの隣に置く (どちらも絞り込みの状態) -->
        <ColumnQueryBadge
          :state="columnQueryState"
          :error-count="columnQueryErrorCount"
          @open="openQueryManager"
        />
        <ColumnFilterButton
          :column="column"
          :filter-keys="filterKeys"
          :theme-vars="columnThemeVars"
        />
      </div>
    </template>

    <template #menu-items="{ closeMenu }">
      <slot name="menu-items" :close-menu="closeMenu" />
    </template>

    <ColumnEmptyState
      v-if="error"
      :error="error"
      :account-id="column.accountId"
      :image-url="serverErrorImageUrl"
      is-error
      :cta-label="i18n.ts._common.retry"
      cta-icon="ti-refresh"
      @cta="refresh"
    />

    <div v-else :class="$style.tlBody">
      <ColumnPullFrame
        :is-pulling="isPulling"
        :is-pulled-enough="isPulledEnough"
        :is-refreshing="isRefreshing"
        :height="displayHeight()"
      />

      <!-- モバイルは hover が無いのでタップで同じ詳細を toast に出す -->
      <div
        v-if="(isOffline || offlineModeStore.isOfflineMode) && !isLoggedOut"
        :class="$style.offlineBanner"
        :title="offlineDetail"
        @click="showOfflineDetail"
      >
        <i class="ti ti-cloud-off" />{{ i18n.ts._common.offline }}
      </div>
      <div v-else-if="isPollingMode && !isLoggedOut" :class="$style.pollingBanner">
        <i class="ti ti-bolt-off" />{{ i18n.ts._common.polling }}
      </div>

      <ColumnQueryBanners
        :state="columnQueryState"
        :error-count="columnQueryErrorCount"
        :missing-ids="columnQueryMissingIds"
        :suspended-keys="columnQuerySuspendedKeys"
        :suspended-count="columnQuerySuspendedCount"
        @resume="resumeSuspendedQueries"
        @drop-missing="dropMissingQueryRefs"
      />

      <!-- Inline post form slot (e.g. channel column) -->
      <slot name="before-notes" :handle-posted="handlePosted" />

      <div v-if="isLoading && notes.length === 0" :class="$style.columnLoading">
        <LoadingSpinner />
      </div>

      <ColumnEmptyState
        v-if="!isLoading && notes.length === 0"
        :message="effectiveEmptyMessage"
        :image-url="serverInfoImageUrl"
      />

      <template v-if="!(isLoading && notes.length === 0) && notes.length > 0">
        <button
          v-if="pendingCount > 0"
          :class="$style.newNotesBanner"
          class="_button"
          @click="scrollToTop()"
        >
          <i class="ti ti-arrow-up" />{{ i18n.ts._deckNoteColumn.newNotes }}
        </button>

        <NoteScroller
          ref="noteScrollerRef"
          :items="notes"
          :focused-id="focusedNoteId"
          :animating-ids="animatingIds"
          :leaving-ids="removingKeys"
          :prefetch="(notes) => { prefetchNoteImages(notes); prefetchNoteMfm(notes) }"
          :class="$style.tlScroller"
          @scroll="handleScroll"
          @near-end="loadMore"
        >
          <template #default="{ item, index, nearViewport }">
            <div>
              <ReadMarkerDivider
                v-if="viewMarkerId && index > 0 && item.id === viewMarkerId"
              />
              <MkNote
                :note="item"
                :focused="variantKeyOf(item) === focusedNoteId"
                :near-viewport="nearViewport"
                :hide-channel-badge="hideChannelBadge"
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
              <slot name="note-item" :item="item" :index="index" />
            </div>
          </template>

          <template #append>
            <div
              v-if="isLoading && notes.length > 0"
              :class="$style.loadingMore"
            >
              <LoadingSpinner />
            </div>
          </template>
        </NoteScroller>
      </template>
    </div>
  </DeckColumn>

  <div v-if="postForm.show.value && column.accountId && account?.hasToken" ref="postFormPortalRef">
    <MkPostForm
      :account-id="column.accountId"
      :reply-to="postForm.replyTo.value"
      :renote-id="postForm.renoteId.value"
      :edit-note="postForm.editNote.value"
      :initial-note="postForm.initialNote.value"
      :initial-text="postForm.initialText.value"
      :initial-cw="postForm.initialCw.value"
      :initial-visibility="postForm.initialVisibility.value"
      :channel-id="column.channelId"
      @close="postForm.close"
      @posted="handlePosted"
    />
  </div>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

// タブ行と同じ面に載せる (#1045)。以前はタブだけが背景と下線を持ち、右端の
// フィルタ / クエリバッジがその外に浮いて見えていた
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
