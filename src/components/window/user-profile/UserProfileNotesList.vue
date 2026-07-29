<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import { useNoteVisibility } from '@/composables/useNoteVisibility'
import { usePaginatedList } from '@/composables/usePaginatedList'

// プロフィールの notes 面 (#707): 内タブ (ハイライト/ノート/全て/ファイル付き)
// とページングを所有する。MkNote のアクションは親へ forward する — post form・
// ピン留め状態・reactions ペインと handler を共有するため。リストの変異
// (削除/編集反映) は expose メソッド経由で親 handler から行う。
const props = defineProps<{
  adapter: ServerAdapter | null
  userId: string
  /** MkNote のピン表示用 (ピン留め状態は親が所有) */
  pinnedNoteIds: string[]
}>()

const emit = defineEmits<{
  react: [reaction: string, note: NormalizedNote]
  reply: [note: NormalizedNote]
  renote: [note: NormalizedNote]
  quote: [note: NormalizedNote]
  delete: [note: NormalizedNote]
  edit: [note: NormalizedNote]
  deleteAndEdit: [note: NormalizedNote]
  pin: [note: NormalizedNote]
  vote: [choice: number, note: NormalizedNote]
  /** 取得エラー。親のウィンドウエラー表示に集約する */
  error: [e: unknown]
}>()

type ProfileTab = 'highlight' | 'notes' | 'all' | 'files'
const PROFILE_TABS: { key: ProfileTab; label: string; icon: string }[] = [
  { key: 'highlight', label: 'ハイライト', icon: 'ti ti-bolt' },
  { key: 'notes', label: 'ノート', icon: 'ti ti-pencil' },
  { key: 'all', label: '全て', icon: 'ti ti-notebook' },
  { key: 'files', label: 'ファイル付き', icon: 'ti ti-photo' },
]
const activeTab = ref<ProfileTab>('highlight')

const MAX_PROFILE_NOTES = 500

const {
  items: notes,
  isLoading: isLoadingNotes,
  load: loadNotes,
  loadMore,
  reset: resetNotes,
} = usePaginatedList<NormalizedNote>({
  fetch: (untilId) => fetchNotes(untilId),
  maxItems: MAX_PROFILE_NOTES,
  // highlight タブはサーバー側がページング非対応
  initialHasMore: (fetched) =>
    fetched.length > 0 && activeTab.value !== 'highlight',
  onError: (e) => emit('error', e),
})

async function fetchNotes(untilId?: string): Promise<NormalizedNote[]> {
  const a = props.adapter
  if (!a) return []
  const tab = activeTab.value
  if (tab === 'highlight') {
    return a.api.getUserFeaturedNotes(props.userId, {
      limit: 30,
      untilId,
    })
  }
  if (tab === 'all') {
    return a.api.getUserNotes(props.userId, {
      limit: 20,
      untilId,
      withReplies: true,
      withChannelNotes: true,
    })
  }
  if (tab === 'files') {
    return a.api.getUserNotes(props.userId, {
      limit: 20,
      untilId,
      withFiles: true,
    })
  }
  return a.api.getUserNotes(props.userId, { limit: 20, untilId })
}

/** 内タブ切替時のリロード (reset + load) */
async function loadTabNotes() {
  resetNotes()
  await loadNotes()
}

watch(activeTab, () => {
  loadTabNotes()
})

// user 読込後にしか mount されない (親の v-else-if="user" 内) ので、
// mount 時点で adapter は解決済み。
onMounted(() => {
  void loadTabNotes()
})

// 明示的に開いた対象なので、対象由来の材料（ミュート・凍結）は貫通させる。
// ワードミュートと削除 tombstone は内容由来なので適用したまま（#606）
const { filterVisible } = useNoteVisibility()
const visibleNotes = computed(() =>
  filterVisible(notes.value, { ignoreSubject: true }),
)

/** 親の削除 handler から呼ぶ (リノート元の削除も波及させる) */
function removeNote(id: string) {
  notes.value = notes.value.filter((n) => n.id !== id && n.renoteId !== id)
}

/** 親の編集完了 handler から呼ぶ (リノートに包まれた表示も更新する) */
function replaceNote(id: string, updated: NormalizedNote) {
  notes.value = notes.value.map((n) =>
    n.id === id ? updated : n.renoteId === id ? { ...n, renote: updated } : n,
  )
}

defineExpose({ loadMore, removeNote, replaceNote })
</script>

<template>
  <div :class="$style.notesSection">
    <div :class="$style.notesTabs">
      <button
        v-for="tab in PROFILE_TABS"
        :key="tab.key"
        class="_button"
        :class="[$style.notesTabItem, { [$style.active]: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        <i :class="tab.icon" />
        {{ tab.label }}
      </button>
    </div>

    <MkNote
      v-for="note in visibleNotes"
      :key="note.id"
      :note="note"
      :pinned-note-ids="pinnedNoteIds"
      @react="(reaction, note) => emit('react', reaction, note)"
      @reply="(note) => emit('reply', note)"
      @renote="(note) => emit('renote', note)"
      @quote="(note) => emit('quote', note)"
      @delete="(note) => emit('delete', note)"
      @edit="(note) => emit('edit', note)"
      @delete-and-edit="(note) => emit('deleteAndEdit', note)"
      @pin="(note) => emit('pin', note)"
      @vote="(choice, note) => emit('vote', choice, note)"
    />

    <div v-if="isLoadingNotes" :class="$style.stateMessage">
      <LoadingSpinner />
    </div>

    <div v-if="!isLoadingNotes && visibleNotes.length === 0" :class="$style.stateMessage">
      ノートはありません
    </div>
  </div>
</template>

<style lang="scss" module>
.notesSection {
  border-top: solid 0.5px var(--nd-divider);
}

.notesTabs {
  display: flex;
  border-bottom: solid 0.5px var(--nd-divider);
  position: sticky;
  top: 0;
  background: var(--nd-bg);
  z-index: 5;
}

.notesTabItem {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 14px 8px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.6;
  border-bottom: 2px solid transparent;
  transition: opacity var(--nd-duration-base), border-color var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
  }

  &.active {
    color: var(--nd-accent);
    opacity: 1;
    border-bottom-color: var(--nd-accent);
  }

  i {
    font-size: 1em;
  }
}

.stateMessage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  color: var(--nd-fg);
  opacity: 0.6;
  font-size: 0.9em;
}

// 親 (UserProfileContent) の .profileContainer が container-type: inline-size を
// 持つため、この module の @container はコンポーネント境界を越えて反応する。
@container (max-width: 500px) {
  .notesTabItem {
    min-height: 44px;
  }
}

/* Empty placeholder classes for dynamic binding */
.active {}
</style>
