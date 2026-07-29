<script setup lang="ts">
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const accountsStore = useAccountsStore()

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    adapter.api.getUserNotes(props.column.userId!, opts),
  validate: () => !!props.column.userId,
  cache: {
    getKey: () => (props.column.userId ? `user:${props.column.userId}` : null),
  },
  refreshFetch: async (adapter, currentNotes) => {
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    const userId = props.column.userId!
    const firstNote = currentNotes[0]
    if (firstNote) {
      const newer = await adapter.api.getUserNotes(userId, {
        sinceId: firstNote.id,
      })
      return { notes: newer.reverse(), mode: 'prepend' as const }
    }
    const fetched = await adapter.api.getUserNotes(userId)
    return { notes: fetched, mode: 'replace' as const }
  },
  // 明示的に開いた対象なので、対象由来の材料（ミュート・凍結）は貫通させる。
  // ワードミュートと削除 tombstone は内容由来なので適用したまま（#606）
  visibility: { ignoreSubject: true },
}
</script>

<template>
  <DeckNoteColumn
    :column="column"
    :title="column.name || 'ユーザー'"
    icon="ti-user"
    :note-column-config="noteColumnConfig"
  />
</template>
