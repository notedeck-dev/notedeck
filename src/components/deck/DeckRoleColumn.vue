<script setup lang="ts">
import {
  createQuerySubscription,
  queryItemAsNote,
} from '@/adapters/misskey/query'
import type { NormalizedNote } from '@/adapters/types'
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
    adapter.api.getRoleNotes(props.column.roleId!, opts),
  validate: () => !!props.column.roleId,
  cache: {
    getKey: () => (props.column.roleId ? `role:${props.column.roleId}` : null),
  },
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // biome-ignore lint/style/noNonNullAssertion: column.accountId は connect ガードで保証
      const accountId = props.column.accountId!
      // biome-ignore lint/style/noNonNullAssertion: roleId 不在は validate() で connect スキップ
      const roleId = props.column.roleId!
      return createQuerySubscription({
        open: async () =>
          unwrap(await commands.querySubscribeRole(accountId, roleId)),
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
</script>

<template>
  <DeckNoteColumn
    :column="column"
    title="ロール"
    icon="ti-badge"
    :web-ui-path="column.roleId ? `/roles/${column.roleId}` : undefined"
    sound-enabled
    :note-column-config="noteColumnConfig"
  />
</template>
