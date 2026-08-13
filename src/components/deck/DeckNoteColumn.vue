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
import { isGuestAccount } from '@/stores/accounts'
import { useColumnQueriesStore } from '@/stores/columnQueries'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useToast } from '@/stores/toast'
import { webUiUrl as buildWebUiUrl } from '@/utils/url'
import DeckColumn from './DeckColumn.vue'
import TimelineFilterPopup from './TimelineFilterPopup.vue'

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
  {
    emptyMessage: 'まだノートがありません',
  },
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
  orderedIds,
  focusedNoteId,
  pendingCount,
  animatingIds,
  postForm,
  handlers,
  noteScrollerRef,
  removingIds,
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
  if (offlineModeStore.isOfflineMode) return 'オフラインモード'
  const accountId = props.column.accountId
  if (!accountId) return 'オフライン'
  const h = getStreamHealth(accountId)
  // WS は connected のまま API fetch 失敗でバナーが出るケースがあるので、
  // reconnecting/disconnected 以外は既定文言に落とす
  if (!h || h.state === 'connected' || h.state === 'initializing') {
    return 'オフライン (サーバーへのリクエストに失敗)'
  }
  const label = h.state === 'reconnecting' ? '再接続中' : '切断'
  return `${label} (${formatHealthDuration(h.since)})`
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

// --- カラムクエリ (#783): 全ノートカラム共通のバッジ・診断表示 ---
// 定義・編集はクエリ管理カラムに一元化。カラム側は適用状態の表示と
// (タイムラインカラムでは) フィルタメニューのトグルだけを持つ
/** バッジから 1 クリックでクエリ管理カラムへ (#783 V25 の調査導線) */
function openQueryManager(): void {
  useDeckStore().toggleSidebarColumn('queryManager', null)
}

const queryBadgeTitle = computed(() => {
  if (columnQueryState.value.status === 'safeMode') {
    return 'セーフモード中はクエリを停止しています — 絞り込まずに全件表示中。押すとクエリ管理カラムを開きます'
  }
  if (columnQueryState.value.status === 'invalid') {
    return 'クエリを解釈できません — 押すとクエリ管理カラムを開きます'
  }
  const err =
    columnQueryErrorCount.value > 0
      ? ` (評価エラー ${columnQueryErrorCount.value} 件を除外)`
      : ''
  const hint = ' — 押すとクエリ管理カラムを開きます'
  if (columnQueryState.value.status === 'degraded') {
    return `クエリ適用中 — 1 件ずつ判定するため検索では使えません${err}${hint}`
  }
  return `クエリ適用中${err}${hint}`
})

/**
 * バッジのアイコン。稲妻はストリーミングモードの表示で使っているので避け、
 * 隣のフィルタボタンと文脈が揃うフィルタ軸で示す。
 * 逐次適用は「遅い」ではなく「1 件ずつ時間をかけて判定する」なので砂時計。
 */
const queryBadgeIcon = computed(() => {
  switch (columnQueryState.value.status) {
    case 'invalid':
      return 'ti ti-alert-triangle'
    case 'degraded':
      return 'ti ti-hourglass'
    // セーフモードで停止中 (#971): フィルタ軸のまま「効いていない」を示す
    case 'safeMode':
      return 'ti ti-filter-off'
    default:
      return 'ti ti-filter-check'
  }
})

// 暴走で打ち切られたクエリ (#783 V15)。自動では戻さず、明示操作で再開する
const isQuerySuspended = computed(
  () => columnQuerySuspendedKeys.value.length > 0,
)

// --- フィルタメニュー (#841): 組込トグル + クエリトグルを全ノートカラム共通で提供 ---
const deckStore = useDeckStore()
const columnQueriesStore = useColumnQueriesStore()
columnQueriesStore.ensureLoaded()

const namedQueryToggles = computed(() =>
  columnQueriesStore.queries.map((q) => ({ id: q.id, name: q.name })),
)
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

// 反映は useNoteColumn のフィルタシグネチャ watch (即時再適用 + refetch) が担う
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

// 名前付きクエリのトグル (#783): 反映は useNoteColumn のクエリシグネチャ watch が担う
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

/** 空状態: クエリによる全件除外と「TL が空」を区別する (仕様追補 E) */
const effectiveEmptyMessage = computed(() => {
  if (columnQueryState.value.status === 'invalid') {
    return 'クエリを解釈できないため表示を停止中です'
  }
  if (
    columnQueryState.value.status === 'active' &&
    columnQueryExcludedCount.value > 0
  ) {
    return `クエリに合致するノートがありません (${columnQueryExcludedCount.value} 件を除外中)`
  }
  return props.emptyMessage
})

defineExpose({
  account,
  scroller,
  noteScrollerRef,
  reconnect,
  switchWithSnapshot,
  notes,
  orderedIds,
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
        <button
          v-if="columnQueryState.status !== 'none'"
          class="_button"
          :class="[
            $style.queryBadge,
            columnQueryState.status === 'invalid' && $style.queryBadgeInvalid,
            columnQueryState.status === 'degraded' && $style.queryBadgeDegraded,
            columnQueryState.status === 'safeMode' && $style.queryBadgeStopped,
          ]"
          :title="queryBadgeTitle"
          @click.stop="openQueryManager"
        >
          <i :class="queryBadgeIcon" />
          <span v-if="columnQueryErrorCount > 0">{{ columnQueryErrorCount }}</span>
        </button>
        <button
          v-if="showFilterBtn"
          ref="filterBtnRef"
          class="_button"
          :class="[$style.filterBtn, { [$style.filterBtnActive]: hasActiveFilter }]"
          title="フィルター"
          @click.stop="toggleFilterMenu"
        >
          <i class="ti ti-filter" />
        </button>
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
      cta-label="再試行"
      cta-icon="ti-refresh"
      @cta="refresh"
    />

    <div v-else :class="$style.tlBody">
      <div
        v-if="isPulling"
        :class="$style.pullFrame"
        :style="`--frame-min-height: ${displayHeight()}px`"
      >
        <div :class="$style.pullFrameContent">
          <i v-if="isRefreshing" class="ti ti-loader-2 nd-spin" />
          <i v-else class="ti ti-arrow-bar-to-down" :class="{ refresh: isPulledEnough }" />
          <div :class="$style.pullText">
            <template v-if="isPulledEnough">離してリフレッシュ</template>
            <template v-else-if="isRefreshing">リフレッシュ中…</template>
            <template v-else>下に引いてリフレッシュ</template>
          </div>
        </div>
      </div>

      <!-- モバイルは hover が無いのでタップで同じ詳細を toast に出す -->
      <div
        v-if="(isOffline || offlineModeStore.isOfflineMode) && !isLoggedOut"
        :class="$style.offlineBanner"
        :title="offlineDetail"
        @click="showOfflineDetail"
      >
        <i class="ti ti-cloud-off" />オフライン
      </div>
      <div v-else-if="isPollingMode && !isLoggedOut" :class="$style.pollingBanner">
        <i class="ti ti-bolt-off" />ポーリング
      </div>

      <!-- 参照先が消えたクエリ: ここでしか外せないので導線を出す -->
      <button
        v-if="columnQueryMissingIds.length > 0"
        class="_button"
        :class="$style.queryInvalidBanner"
        title="このカラムが参照しているクエリは削除されています。外すと新着の取り込みが戻ります"
        @click="dropMissingQueryRefs"
      >
        <i class="ti ti-unlink" />
        参照しているクエリが見つかりません
        <span :class="$style.querySuspendedAction">参照を外す</span>
      </button>

      <!-- クエリ評価不能 = fail-closed 中 (#783 不変条件 (f)) -->
      <div
        v-else-if="columnQueryState.status === 'invalid'"
        :class="$style.queryInvalidBanner"
        :title="queryBadgeTitle"
      >
        <i class="ti ti-alert-triangle" />クエリを解釈できないため新着を停止中
      </div>

      <!-- 暴走で打ち切ったクエリ: 明示操作でのみ再開する (#783 V15) -->
      <button
        v-else-if="isQuerySuspended"
        class="_button"
        :class="$style.querySuspendedBanner"
        title="クエリの処理が終わらなかったため停止しました。再開すると取得し直します"
        @click="resumeSuspendedQueries"
      >
        <i class="ti ti-player-pause" />
        <span v-if="columnQuerySuspendedCount > 0">{{ columnQuerySuspendedCount }} 件保留中</span>
        <span v-else>クエリを停止中</span>
        <span :class="$style.querySuspendedAction">再開</span>
      </button>

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
          <i class="ti ti-arrow-up" />新しいノート
        </button>

        <NoteScroller
          ref="noteScrollerRef"
          :items="notes"
          :focused-id="focusedNoteId"
          :animating-ids="animatingIds"
          :leaving-ids="removingIds"
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
                :focused="item.id === focusedNoteId"
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

  <TimelineFilterPopup
    :show="showFilterMenu"
    :filter-keys="effectiveFilterKeys"
    :filters="columnFilters"
    :position="filterPopupPos"
    :theme-vars="columnThemeVars"
    :named-queries="namedQueryToggles"
    :enabled-query-ids="column.noteQueryRefs ?? []"
    @close="showFilterMenu = false"
    @toggle="toggleFilter"
    @toggle-query="toggleNamedQuery"
  />

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

/* カラムクエリバッジ (#783): 適用中 = ⚡、評価不能 = ⚠ */
.queryBadge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
  padding: 2px 6px;
  border-radius: var(--nd-radius-full);
  font-size: 0.75em;
  color: var(--nd-accent);
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
}

.queryBadgeInvalid {
  color: var(--nd-error);
  background: color-mix(in srgb, var(--nd-error) 12%, transparent);
}

/* 逐次適用に降格 = 効くが検索には使えない */
.queryBadgeDegraded {
  color: var(--nd-warn);
  background: color-mix(in srgb, var(--nd-warn) 12%, transparent);
}

/*
 * セーフモードで停止中 (#971)。エラーではない (fail-open で全件表示している
 * だけ) が、適用中と同じ強調では「効いている」と誤読されるので彩度を落とす
 */
.queryBadgeStopped {
  color: var(--nd-fg);
  background: color-mix(in srgb, var(--nd-fg) 12%, transparent);
  opacity: 0.75;
}


/* フィルタメニュー (#841): サブヘッダ右端の共通トグルボタン */
.subHeaderRow {
  display: flex;
  align-items: center;
}

.subHeaderMain {
  flex: 1;
  min-width: 0;
}

.filterBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
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
