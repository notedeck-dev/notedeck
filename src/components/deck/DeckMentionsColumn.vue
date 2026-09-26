<script setup lang="ts">
import { computed } from 'vue'
import {
  createQuerySubscription,
  queryItemAsNote,
} from '@/adapters/misskey/query'
import type { NormalizedNote } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import CrossAccountProgress from '@/components/common/CrossAccountProgress.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useCrossAccountNotes } from '@/composables/useCrossAccountNotes'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { provideNoteFrame } from '@/composables/useNoteFrame'
import { i18n } from '@/i18n'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { accountsCacheKeyDeps, columnCacheKey } from '@/utils/columnCacheKey'
import { commands, unwrap } from '@/utils/tauriInvoke'
import ColumnCrossPostForm from './ColumnCrossPostForm.vue'
import DeckColumn from './DeckColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const isSpecified = computed(() => props.column.type === 'specified')

const cacheKeyDeps = accountsCacheKeyDeps()

const config = computed(() =>
  isSpecified.value
    ? {
        title: i18n.ts._columns.specified,
        icon: 'ti-mail',
        emptyText: i18n.ts._deckMentionsColumn.directEmpty,
      }
    : {
        title: i18n.ts._deckMentionsColumn.toYou,
        icon: 'ti-at',
        emptyText: i18n.ts._deckMentionsColumn.mentionsEmpty,
      },
)

const isCrossAccount = computed(() => props.column.accountId == null)
// 全アカウント面ではノートの基準サーバーを絶対にする (#1059)
provideNoteFrame(isCrossAccount)

// Single-account config
const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    isSpecified.value
      ? adapter.api.getMentions({ ...opts, visibility: 'specified' })
      : adapter.api.getMentions(opts),
  cache: { getKey: () => columnCacheKey(props.column, cacheKeyDeps) },
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // useNoteColumn.connect が account.value.hasToken をガードしているので、
      // ここに到達した時点で column.accountId は必ず非 null。
      // biome-ignore lint/style/noNonNullAssertion: guaranteed by upstream gate
      const accountId = props.column.accountId!
      return createQuerySubscription({
        open: async () =>
          unwrap(await commands.querySubscribeMentions(accountId)),
        onInsert: (item) => {
          const note = queryItemAsNote(item)
          if (!note) return
          if (isSpecified.value && note.visibility !== 'specified') return
          enqueue(note)
        },
        onDelete: (id) =>
          callbacks.onNoteUpdated?.({
            accountId,
            noteId: id,
            type: 'deleted',
            body: {},
          }),
      })
    },
  },
}

// Cross-account state
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
} = useCrossAccountNotes({
  fetchNotes: (adapter, opts) =>
    isSpecified.value
      ? adapter.api.getMentions({ ...opts, visibility: 'specified' })
      : adapter.api.getMentions(opts),
  isCrossAccount: () => isCrossAccount.value,
  cacheKey: () => columnCacheKey(props.column, cacheKeyDeps),
  isLoading,
  error,
  scroller,
  onScrollReport,
  deleteNote: handlers.delete,
  streaming: {
    columnId: props.column.id,
    subscribe: (accountId, _adapter, enqueue, callbacks) =>
      createQuerySubscription({
        open: async () =>
          unwrap(await commands.querySubscribeMentions(accountId)),
        onInsert: (item) => {
          const note = queryItemAsNote(item)
          if (!note) return
          if (isSpecified.value && note.visibility !== 'specified') return
          enqueue(note)
        },
        onDelete: (id) =>
          callbacks.onNoteUpdated({
            accountId,
            noteId: id,
            type: 'deleted',
            body: {},
          }),
      }),
  },
})
</script>

<template>
  <!-- Cross-account mode -->
  <DeckColumn
    v-if="isCrossAccount"
    :column-id="column.id"
    :title="column.name || config.title"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
    @refresh="connectCrossAccount"
  >
    <template #header-icon>
      <i :class="['ti', config.icon, $style.tlHeaderIcon]" />
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
      <ColumnEmptyState
        v-if="notes.length === 0 && !isLoading"
        :message="config.emptyText"
        :image-url="serverInfoImageUrl"
      />

      <template v-else>
        <button
          v-if="pendingCount > 0"
          :class="$style.newNotesBanner"
          class="_button"
          @click="scrollToTop()"
        >
          <i class="ti ti-arrow-up" />{{ i18n.ts._common.newNotes }}
        </button>

        <NoteScroller
          ref="noteScrollerRef"
          :items="groups"
          :animating-ids="animatingRowKeys"
          :class="$style.tlScroller"
          @scroll="handleScroll"
          @near-end="loadMoreCrossAccount"
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
            <div v-if="isLoading && crossProgress" :class="$style.loadingMore">
              <CrossAccountProgress :progress="crossProgress" :size="20" />
            </div>
            <div v-else-if="isLoading && notes.length > 0" :class="$style.loadingMore">
              <LoadingSpinner />
            </div>
          </template>
        </NoteScroller>
      </template>
    </div>
  </DeckColumn>

  <!-- Single-account mode -->
  <DeckNoteColumn
    v-else
    :column="column"
    :title="config.title"
    :icon="config.icon"
    sound-enabled
    :note-column-config="noteColumnConfig"
  />
  <ColumnCrossPostForm v-if="isCrossAccount" :post-form="postForm" @posted="postForm.close" />
</template>

<style lang="scss" module>
@use './column-common.module.scss';
</style>
