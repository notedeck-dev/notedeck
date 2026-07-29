<script setup lang="ts">
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) => adapter.api.getFavorites(opts),
  cache: {
    getKey: () => 'favorites',
  },
  // 自分が保存した面。凍結は貫通させる（本家 i/favorites も貫通）。
  // ミュートは自分の意思なので適用したまま（#606）
  visibility: { ignoreSuspension: true },
}
</script>

<template>
  <DeckNoteColumn
    :column="column"
    title="お気に入り"
    icon="ti-star"
    :note-column-config="noteColumnConfig"
  />
</template>
