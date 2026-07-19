<script setup lang="ts">
import {
  createQuerySubscription,
  queryItemAsNote,
} from '@/adapters/misskey/query'
import type { NormalizedNote } from '@/adapters/types'
import { useEntityCrud } from '@/composables/useEntityCrud'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    adapter.api.getAntennaNotes(props.column.antennaId!, opts),
  validate: () => !!props.column.antennaId,
  cache: {
    getKey: () =>
      props.column.antennaId ? `antenna:${props.column.antennaId}` : null,
  },
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // biome-ignore lint/style/noNonNullAssertion: column.accountId は connect ガードで保証
      const accountId = props.column.accountId!
      // biome-ignore lint/style/noNonNullAssertion: antennaId 不在は validate() で connect スキップ
      const antennaId = props.column.antennaId!
      return createQuerySubscription({
        open: async () =>
          unwrap(await commands.querySubscribeAntenna(accountId, antennaId)),
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
  'antenna',
  () => props.column,
)
</script>

<template>
  <DeckNoteColumn
    :column="column"
    title="アンテナ"
    icon="ti-antenna-bars-5"
    :web-ui-path="column.antennaId ? `/my/antennas/${column.antennaId}` : undefined"
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
