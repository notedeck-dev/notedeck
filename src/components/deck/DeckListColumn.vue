<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import { columnCacheKey, userListCacheKey } from '@/services/columnCacheKey'
import type { ColumnSource } from '@/services/columnSource'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { accountsCacheKeyDeps } from '@/utils/columnCacheKeyDeps'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckCrossSourcesColumn from './DeckCrossSourcesColumn.vue'
import DeckNoteColumn from './DeckNoteColumn.vue'

const props = defineProps<{
  column: DeckColumnType
}>()

const deckStore = useDeckStore()
const cacheKeyDeps = accountsCacheKeyDeps()
const noteColumnRef = ref<InstanceType<typeof DeckNoteColumn> | null>(null)

watch(
  () => noteColumnRef.value?.notes as NormalizedNote[] | undefined,
  (notes) => {
    deckStore.reportVisibleItems(props.column.id, notes ?? [])
  },
  { immediate: true },
)

// 全アカウント (#1017 案 2): 組 (アカウント + リスト ID) ごとに取得・購読する
const isCrossAccount = computed(() => props.column.accountId == null)
function fetchSource(
  adapter: ServerAdapter,
  opts: { untilId?: string } | undefined,
  source: ColumnSource,
) {
  return adapter.api.getTimeline('user-list', { ...opts, listId: source.id })
}
const cacheKeyOf = (source: ColumnSource) => userListCacheKey(source.id)

function subscribeSource(
  accountId: string,
  source: ColumnSource,
  enqueue: (note: NormalizedNote) => void,
  callbacks: { onNoteUpdated: (event: NoteUpdateEvent) => void },
) {
  return createNoteQuerySubscription({
    accountId,
    open: async () =>
      unwrap(
        await commands.querySubscribeTimeline(
          accountId,
          'user-list',
          source.id,
        ),
      ),
    enqueue,
    onNoteUpdated: callbacks.onNoteUpdated,
  })
}

const noteColumnConfig: NoteColumnConfig = {
  getColumn: () => props.column,
  fetch: (adapter, opts) =>
    adapter.api.getTimeline('user-list', {
      ...opts,
      ...(props.column.listId ? { listId: props.column.listId } : {}),
    }),
  validate: () => !!props.column.listId,
  cache: {
    getKey: () => columnCacheKey(props.column, cacheKeyDeps),
  },
  streaming: {
    subscribe: (_adapter, enqueue, callbacks) => {
      // biome-ignore lint/style/noNonNullAssertion: column.accountId は connect ガードで保証
      const accountId = props.column.accountId!
      // biome-ignore lint/style/noNonNullAssertion: listId 不在は validate() で connect 自体がスキップされる
      const listId = props.column.listId!
      return createQuerySubscription({
        open: async () =>
          unwrap(
            await commands.querySubscribeTimeline(
              accountId,
              'user-list',
              listId,
            ),
          ),
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
  'list',
  () => props.column,
)
</script>

<template>
  <DeckCrossSourcesColumn
    v-if="isCrossAccount"
    :column="column"
    :title="i18n.ts._columns.list"
    icon="ti-list"
    column-type="list"
    :fetch-notes="fetchSource"
    :cache-key-of="cacheKeyOf"
    :filter-keys="['withRenotes', 'withReplies', 'withFiles', 'withBots']"
    :subscribe="subscribeSource"
  />
  <DeckNoteColumn
    v-else
    ref="noteColumnRef"
    :column="column"
    :title="i18n.ts._columns.list"
    icon="ti-list"
    :web-ui-path="column.listId ? `/my/lists/${column.listId}` : undefined"
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
