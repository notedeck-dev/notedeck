<script setup lang="ts">
import { useEntityCrud } from '@/composables/useEntityCrud'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { i18n } from '@/i18n'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { accountsCacheKeyDeps, columnCacheKey } from '@/utils/columnCacheKey'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const cacheKeyDeps = accountsCacheKeyDeps()

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    adapter.api.getClipNotes(props.column.clipId!, opts),
  validate: () => !!props.column.clipId,
  cache: {
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
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
    :title="i18n.ts._columns.clip"
    icon="ti-paperclip"
    :note-column-config="noteColumnConfig"
  >
    <template #menu-items="{ closeMenu }">
      <button class="_popupItem" @click="rename(closeMenu)">
        <i class="ti ti-edit" />
        <span>{{ i18n.ts._common.rename }}</span>
      </button>
      <button class="_popupItem" style="color: var(--nd-love, #ff6b6b);" @click="deleteEntity(closeMenu)">
        <i class="ti ti-trash" style="opacity: 1;" />
        <span>{{ i18n.tsx._deckClipColumn.deleteItem({ label: config.label }) }}</span>
      </button>
    </template>
  </DeckNoteColumn>
</template>
