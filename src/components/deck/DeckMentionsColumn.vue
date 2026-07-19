<script setup lang="ts">
import { computed } from 'vue'
import {
  createQuerySubscription,
  queryItemAsNote,
} from '@/adapters/misskey/query'
import type { NormalizedNote } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import NoteScroller from '@/components/common/NoteScroller.vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useCrossAccountNotes } from '@/composables/useCrossAccountNotes'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const isSpecified = computed(() => props.column.type === 'specified')

const config = computed(() =>
  isSpecified.value
    ? {
        title: 'ダイレクト',
        icon: 'ti-mail',
        emptyText: 'ダイレクトメッセージはありません',
        cacheKey: 'specified' as const,
      }
    : {
        title: 'あなた宛て',
        icon: 'ti-at',
        emptyText: 'メンションはありません',
        cacheKey: 'mentions' as const,
      },
)

const isCrossAccount = computed(() => props.column.accountId == null)

// Single-account config
const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    isSpecified.value
      ? adapter.api.getMentions({ ...opts, visibility: 'specified' })
      : adapter.api.getMentions(opts),
  cache: { getKey: () => config.value.cacheKey },
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
  scroller,
  onScrollReport,
} = useColumnSetup(() => props.column)

const {
  notes,
  noteScrollerRef,
  scrollToTop,
  connectCrossAccount,
  loadMoreCrossAccount,
  handleScroll,
  removeNote,
} = useCrossAccountNotes({
  fetchNotes: (adapter, opts) =>
    isSpecified.value
      ? adapter.api.getMentions({ ...opts, visibility: 'specified' })
      : adapter.api.getMentions(opts),
  isCrossAccount: () => isCrossAccount.value,
  cacheKey: () => config.value.cacheKey,
  isLoading,
  error,
  scroller,
  onScrollReport,
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
      :message="error.message"
      is-error
      :image-url="serverErrorImageUrl"
    />

    <div v-else :class="$style.tlBody">
      <ColumnEmptyState
        v-if="notes.length === 0 && !isLoading"
        :message="config.emptyText"
        :image-url="serverInfoImageUrl"
      />

      <NoteScroller
        v-else
        ref="noteScrollerRef"
        :items="notes"
        :class="$style.tlScroller"
        @scroll="handleScroll"
        @near-end="loadMoreCrossAccount"
      >
        <template #default="{ item }">
          <div>
            <MkNote
              :note="item"
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

  <!-- Single-account mode -->
  <DeckNoteColumn
    v-else
    :column="column"
    :title="config.title"
    :icon="config.icon"
    sound-enabled
    :note-column-config="noteColumnConfig"
  />
</template>

<style lang="scss" module>
@use './column-common.module.scss';
</style>
