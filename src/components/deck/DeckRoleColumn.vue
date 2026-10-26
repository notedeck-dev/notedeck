<script setup lang="ts">
import { computed } from 'vue'
import {
  createNoteQuerySubscription,
  createQuerySubscription,
  queryItemAsNote,
} from '@/adapters/misskey/query'
import type {
  NormalizedNote,
  NoteUpdateEvent,
  ServerAdapter,
} from '@/adapters/types'
import { openRoleQuery } from '@/composables/querySubscriptions'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { i18n } from '@/i18n'
import { columnCacheKey, roleCacheKey } from '@/services/columnCacheKey'
import type { ColumnSource } from '@/services/columnSource'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { accountsCacheKeyDeps } from '@/utils/columnCacheKeyDeps'
import DeckCrossSourcesColumn from './DeckCrossSourcesColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const cacheKeyDeps = accountsCacheKeyDeps()

// 全アカウント (#1017 案 2): 組 (アカウント + ロール ID) ごとに取得・購読する
const isCrossAccount = computed(() => props.column.accountId == null)
function fetchSource(
  adapter: ServerAdapter,
  opts: { untilId?: string } | undefined,
  source: ColumnSource,
) {
  return adapter.api.getRoleNotes(source.id, opts)
}
const cacheKeyOf = (source: ColumnSource) => roleCacheKey(source.id)

function subscribeSource(
  accountId: string,
  source: ColumnSource,
  enqueue: (note: NormalizedNote) => void,
  callbacks: { onNoteUpdated: (event: NoteUpdateEvent) => void },
) {
  return createNoteQuerySubscription({
    accountId,
    open: async () => openRoleQuery(accountId, source.id),
    enqueue,
    onNoteUpdated: callbacks.onNoteUpdated,
  })
}

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    adapter.api.getRoleNotes(props.column.roleId!, opts),
  validate: () => !!props.column.roleId,
  cache: {
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
  },
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // biome-ignore lint/style/noNonNullAssertion: column.accountId は connect ガードで保証
      const accountId = props.column.accountId!
      // biome-ignore lint/style/noNonNullAssertion: roleId 不在は validate() で connect スキップ
      const roleId = props.column.roleId!
      return createQuerySubscription({
        open: async () => openRoleQuery(accountId, roleId),
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
</script>

<template>
  <DeckCrossSourcesColumn
    v-if="isCrossAccount"
    :column="column"
    :title="i18n.ts._columns.role"
    icon="ti-badge"
    column-type="role"
    :fetch-notes="fetchSource"
    :cache-key-of="cacheKeyOf"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles', 'withBots']"
    :subscribe="subscribeSource"
  />
  <DeckNoteColumn
    v-else
    :column="column"
    :title="i18n.ts._columns.role"
    icon="ti-badge"
    :web-ui-path="column.roleId ? `/roles/${column.roleId}` : undefined"
    sound-enabled
    :note-column-config="noteColumnConfig"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles', 'withBots']"
  />
</template>
