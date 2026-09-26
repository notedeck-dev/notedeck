<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  createQuerySubscription,
  queryItemAsNote,
} from '@/adapters/misskey/query'
import type { NormalizedNote } from '@/adapters/types'
import { useEntityCrud } from '@/composables/useEntityCrud'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { i18n } from '@/i18n'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { accountsCacheKeyDeps, columnCacheKey } from '@/utils/columnCacheKey'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const deckStore = useDeckStore()
const cacheKeyDeps = accountsCacheKeyDeps()
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
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
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
            accountId,
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
    :title="i18n.ts._columns.list"
    icon="ti-list"
    :web-ui-path="column.listId ? `/my/lists/${column.listId}` : undefined"
    sound-enabled
    :note-column-config="noteColumnConfig"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles', 'withBots']"
  >
    <template #menu-items="{ closeMenu }">
      <button class="_popupItem" @click="rename(closeMenu)">
        <i class="ti ti-edit" />
        <span>{{ i18n.ts._common.rename }}</span>
      </button>
      <button class="_popupItem" style="color: var(--nd-love, #ff6b6b);" @click="deleteEntity(closeMenu)">
        <i class="ti ti-trash" style="opacity: 1;" />
        <span>{{ i18n.tsx._common.deleteItem({ label: config.label }) }}</span>
      </button>
    </template>
  </DeckNoteColumn>
</template>
