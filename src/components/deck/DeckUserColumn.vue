<script setup lang="ts">
import { computed } from 'vue'
import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { i18n } from '@/i18n'
import { columnCacheKey, userNotesCacheKey } from '@/services/columnCacheKey'
import type { ColumnSource } from '@/services/columnSource'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { accountsCacheKeyDeps } from '@/utils/columnCacheKeyDeps'
import DeckCrossSourcesColumn from './DeckCrossSourcesColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const accountsStore = useAccountsStore()
const cacheKeyDeps = accountsCacheKeyDeps()

// 全アカウント (#1017 案 2): 組 (アカウント + ユーザー ID) ごとに取得・購読する
const isCrossAccount = computed(() => props.column.accountId == null)
function fetchSource(
  adapter: ServerAdapter,
  opts: { untilId?: string } | undefined,
  source: ColumnSource,
) {
  return adapter.api.getUserNotes(source.id, opts)
}
const cacheKeyOf = (source: ColumnSource) => userNotesCacheKey(source.id)

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    adapter.api.getUserNotes(props.column.userId!, opts),
  validate: () => !!props.column.userId,
  cache: {
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
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
  <DeckCrossSourcesColumn
    v-if="isCrossAccount"
    :column="column"
    :title="i18n.ts._columns.user"
    icon="ti-user"
    column-type="user"
    :fetch-notes="fetchSource"
    :cache-key-of="cacheKeyOf"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles']"
    :visibility="noteColumnConfig.visibility"
  />
  <!-- 単一ユーザーのカラムに Bot 除外は不要 (#841) -->
  <DeckNoteColumn
    v-else
    :column="column"
    :title="column.name || i18n.ts._columns.user"
    icon="ti-user"
    :note-column-config="noteColumnConfig"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles']"
  />
</template>
