<script setup lang="ts">
import { computed } from 'vue'
import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import { useEntityCrud } from '@/composables/useEntityCrud'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { i18n } from '@/i18n'
import { clipCacheKey, columnCacheKey } from '@/services/columnCacheKey'
import type { ColumnSource } from '@/services/columnSource'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { accountsCacheKeyDeps } from '@/utils/columnCacheKeyDeps'
import DeckCrossSourcesColumn from './DeckCrossSourcesColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const cacheKeyDeps = accountsCacheKeyDeps()

// 全アカウント (#1017 案 2): 組 (アカウント + クリップ ID) ごとに取得・購読する
const isCrossAccount = computed(() => props.column.accountId == null)
function fetchSource(
  adapter: ServerAdapter,
  opts: { untilId?: string } | undefined,
  source: ColumnSource,
) {
  return adapter.api.getClipNotes(source.id, opts)
}
const cacheKeyOf = (source: ColumnSource) => clipCacheKey(source.id)

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
  <DeckCrossSourcesColumn
    v-if="isCrossAccount"
    :column="column"
    :title="i18n.ts._columns.clip"
    icon="ti-paperclip"
    column-type="clip"
    :fetch-notes="fetchSource"
    :cache-key-of="cacheKeyOf"
    :visibility="noteColumnConfig.visibility"
  />
  <DeckNoteColumn
    v-else
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
        <span>{{ i18n.tsx._common.deleteItem({ label: config.label }) }}</span>
      </button>
    </template>
  </DeckNoteColumn>
</template>
