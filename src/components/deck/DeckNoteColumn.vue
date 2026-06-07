<script setup lang="ts">
import { computed, defineAsyncComponent, useTemplateRef } from 'vue'
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
import { isGuestAccount } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

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
    /** 空状態に「ノートを書く」CTA を表示するか */
    showEmptyCta?: boolean
    /** チャンネルカラム等、自明な文脈ではノートのチャンネルバッジを非表示にする */
    hideChannelBadge?: boolean
  }>(),
  {
    emptyMessage: 'まだノートがありません',
    showEmptyCta: false,
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
  notes,
  orderedIds,
  focusedNoteId,
  pendingCount,
  animatingIds,
  postForm,
  handlers,
  noteScrollerRef,
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

const webUiUrl = computed(() => {
  if (!props.webUiPath || !account.value) return undefined
  return `https://${account.value.host}${props.webUiPath}`
})

const postFormPortalRef = useTemplateRef<HTMLElement>('postFormPortalRef')
usePortal(postFormPortalRef)

defineExpose({
  account,
  scroller,
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
      <DeckHeaderAccount :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <template #header-extra>
      <slot name="header-extra" />
    </template>

    <template #menu-items="{ closeMenu }">
      <slot name="menu-items" :close-menu="closeMenu" />
    </template>

    <ColumnEmptyState
      v-if="error"
      :message="error.message"
      :image-url="serverErrorImageUrl"
      is-error
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

      <div v-if="(isOffline || offlineModeStore.isOfflineMode) && !isLoggedOut" :class="$style.offlineBanner">
        <i class="ti ti-cloud-off" />オフライン
      </div>
      <div v-else-if="isPollingMode && !isLoggedOut" :class="$style.pollingBanner">
        <i class="ti ti-bolt-off" />ポーリング
      </div>

      <!-- Inline post form slot (e.g. channel column) -->
      <slot name="before-notes" :handle-posted="handlePosted" />

      <div v-if="isLoading && notes.length === 0" :class="$style.columnLoading">
        <LoadingSpinner />
      </div>

      <ColumnEmptyState
        v-if="!isLoading && notes.length === 0"
        :message="emptyMessage"
        :image-url="serverInfoImageUrl"
        :cta-label="showEmptyCta && account?.hasToken ? 'ノートを書く' : undefined"
        cta-icon="ti-pencil"
        @cta="postForm.show.value = true"
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

  <div v-if="postForm.show.value && column.accountId && account?.hasToken" ref="postFormPortalRef">
    <MkPostForm
      :account-id="column.accountId"
      :reply-to="postForm.replyTo.value"
      :renote-id="postForm.renoteId.value"
      :edit-note="postForm.editNote.value"
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
</style>
