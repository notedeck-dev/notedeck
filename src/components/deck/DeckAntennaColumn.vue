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
import { useEntityCrud } from '@/composables/useEntityCrud'
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { i18n } from '@/i18n'
import { antennaCacheKey, columnCacheKey } from '@/services/columnCacheKey'
import type { ColumnSource } from '@/services/columnSource'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { accountsCacheKeyDeps } from '@/utils/columnCacheKeyDeps'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckCrossSourcesColumn from './DeckCrossSourcesColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const cacheKeyDeps = accountsCacheKeyDeps()

// 全アカウント (#1017 案 2): 組 (アカウント + アンテナ ID) ごとに取得・購読する
const isCrossAccount = computed(() => props.column.accountId == null)
function fetchSource(
  adapter: ServerAdapter,
  opts: { untilId?: string } | undefined,
  source: ColumnSource,
) {
  return adapter.api.getAntennaNotes(source.id, opts)
}
const cacheKeyOf = (source: ColumnSource) => antennaCacheKey(source.id)

function subscribeSource(
  accountId: string,
  source: ColumnSource,
  enqueue: (note: NormalizedNote) => void,
  callbacks: { onNoteUpdated: (event: NoteUpdateEvent) => void },
) {
  return createNoteQuerySubscription({
    accountId,
    open: async () =>
      unwrap(await commands.querySubscribeAntenna(accountId, source.id)),
    enqueue,
    onNoteUpdated: callbacks.onNoteUpdated,
  })
}

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    adapter.api.getAntennaNotes(props.column.antennaId!, opts),
  validate: () => !!props.column.antennaId,
  cache: {
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
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
  'antenna',
  () => props.column,
)
</script>

<template>
  <DeckCrossSourcesColumn
    v-if="isCrossAccount"
    :column="column"
    :title="i18n.ts._columns.antenna"
    icon="ti-antenna-bars-5"
    column-type="antenna"
    :fetch-notes="fetchSource"
    :cache-key-of="cacheKeyOf"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles', 'withBots']"
    :subscribe="subscribeSource"
  />
  <DeckNoteColumn
    v-else
    :column="column"
    :title="i18n.ts._columns.antenna"
    icon="ti-antenna-bars-5"
    :web-ui-path="column.antennaId ? `/my/antennas/${column.antennaId}` : undefined"
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
