<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  createQuerySubscription,
  queryItemAsNote,
} from '@/adapters/misskey/query'
import type { NormalizedNote } from '@/adapters/types'
import { useEntityCrud } from '@/composables/useEntityCrud'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const deckStore = useDeckStore()
const noteColumnRef = ref<InstanceType<typeof DeckNoteColumn> | null>(null)

watch(
  () => noteColumnRef.value?.notes as NormalizedNote[] | undefined,
  (notes) => {
    deckStore.reportVisibleItems(props.column.id, notes ?? [])
  },
  { immediate: true },
)

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    adapter.api.getTimeline('user-list', {
      ...opts,
      ...(props.column.listId ? { listId: props.column.listId } : {}),
    }),
  validate: () => !!props.column.listId,
  cache: {
    getKey: () =>
      props.column.listId ? `user-list:${props.column.listId}` : null,
  },
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // biome-ignore lint/style/noNonNullAssertion: column.accountId は connect ガードで保証
      const accountId = props.column.accountId!
      // biome-ignore lint/style/noNonNullAssertion: listId 不在は validate() で connect 自体がスキップされる
      const listId = props.column.listId!
      return createQuerySubscription({
        open: async () =>
          unwrap(
            await commands.querySubscribeTimeline(
              accountId,
              'user-list',
              listId,
            ),
          ),
        onInsert: (item) => {
          const note = queryItemAsNote(item)
          if (note) enqueue(note)
        },
        onDelete: (id) =>
          callbacks.onNoteUpdated?.({
            noteId: id,
            type: 'deleted',
            body: {},
          }),
        onUpdate: (event) => callbacks.onNoteUpdated?.(event),
      })
    },
  },
}

const { rename, deleteEntity, config } = useEntityCrud(
  'list',
  () => props.column,
)
</script>

<template>
  <DeckNoteColumn
    ref="noteColumnRef"
    :column="column"
    title="リスト"
    icon="ti-list"
    :web-ui-path="column.listId ? `/my/lists/${column.listId}` : undefined"
    sound-enabled
    :note-column-config="noteColumnConfig"
  >
    <template #menu-items="{ closeMenu }">
      <button class="_popupItem" @click="rename(closeMenu)">
        <i class="ti ti-edit" />
        <span>名前を変更</span>
      </button>
      <button class="_popupItem" style="color: var(--nd-love, #ff6b6b);" @click="deleteEntity(closeMenu)">
        <i class="ti ti-trash" style="opacity: 1;" />
        <span>{{ config.label }}を削除</span>
      </button>
    </template>
  </DeckNoteColumn>
</template>
