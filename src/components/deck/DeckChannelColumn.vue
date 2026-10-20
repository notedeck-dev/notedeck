<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
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
import type { NoteColumnConfig } from '@/composables/useNoteColumn'
import { i18n } from '@/i18n'
import { channelCacheKey, columnCacheKey } from '@/services/columnCacheKey'
import type { ColumnSource } from '@/services/columnSource'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { accountsCacheKeyDeps } from '@/utils/columnCacheKeyDeps'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckCrossSourcesColumn from './DeckCrossSourcesColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

const props = defineProps<{
  column: DeckColumnType
}>()

const accountsStore = useAccountsStore()
const cacheKeyDeps = accountsCacheKeyDeps()
const account = computed(() =>
  props.column.accountId
    ? accountsStore.accountMap.get(props.column.accountId)
    : null,
)

// 全アカウント (#1017 案 2): 組 (アカウント + チャンネル ID) ごとに取得・購読する
const isCrossAccount = computed(() => props.column.accountId == null)
function fetchSource(
  adapter: ServerAdapter,
  opts: { untilId?: string } | undefined,
  source: ColumnSource,
) {
  return adapter.api.getChannelNotes(source.id, opts)
}
const cacheKeyOf = (source: ColumnSource) => channelCacheKey(source.id)

function subscribeSource(
  accountId: string,
  source: ColumnSource,
  enqueue: (note: NormalizedNote) => void,
  callbacks: { onNoteUpdated: (event: NoteUpdateEvent) => void },
) {
  return createNoteQuerySubscription({
    accountId,
    open: async () =>
      unwrap(await commands.querySubscribeChannel(accountId, source.id)),
    enqueue,
    onNoteUpdated: callbacks.onNoteUpdated,
  })
}

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    // biome-ignore lint/style/noNonNullAssertion: guarded by validate
    adapter.api.getChannelNotes(props.column.channelId!, opts),
  validate: () => !!props.column.channelId,
  cache: {
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
  },
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // biome-ignore lint/style/noNonNullAssertion: column.accountId は connect ガードで保証
      const accountId = props.column.accountId!
      // biome-ignore lint/style/noNonNullAssertion: channelId 不在は validate() で connect スキップ
      const channelId = props.column.channelId!
      return createQuerySubscription({
        open: async () =>
          unwrap(await commands.querySubscribeChannel(accountId, channelId)),
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
    :title="i18n.ts._columns.channel"
    icon="ti-device-tv"
    column-type="channel"
    :fetch-notes="fetchSource"
    :cache-key-of="cacheKeyOf"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles', 'withBots']"
    :subscribe="subscribeSource"
  />
  <DeckNoteColumn
    v-else
    :column="column"
    :title="i18n.ts._columns.channel"
    icon="ti-device-tv"
    :web-ui-path="column.channelId ? `/channels/${column.channelId}` : undefined"
    sound-enabled
    hide-channel-badge
    :note-column-config="noteColumnConfig"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles', 'withBots']"
  >
    <template #before-notes="{ handlePosted }">
      <MkPostForm
        v-if="column.channelId && column.accountId && account?.hasToken"
        :account-id="column.accountId"
        :channel-id="column.channelId"
        inline
        @posted="handlePosted"
      />
    </template>
  </DeckNoteColumn>
</template>
