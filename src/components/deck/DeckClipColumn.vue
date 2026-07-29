<script setup lang="ts">
import { useEntityCrud } from '@/composables/useEntityCrud'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    adapter.api.getClipNotes(props.column.clipId!, opts),
  validate: () => !!props.column.clipId,
  cache: {
    getKey: () => (props.column.clipId ? `clip:${props.column.clipId}` : null),
  },
  // カラム化できるのは自分のクリップとお気に入りしたクリップ（picker 経由）
  // = 自分が保存した面なので凍結は貫通させる。他人のクリップは
  // ClipDetail ウィンドウで開かれ、そちらは全適用（#606）
  visibility: { ignoreSuspension: true },
}

const { rename, deleteEntity, config } = useEntityCrud(
  'clip',
  () => props.column,
)
</script>

<template>
  <DeckNoteColumn
    :column="column"
    title="クリップ"
    icon="ti-paperclip"
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
