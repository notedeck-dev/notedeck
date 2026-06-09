<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type {
  NormalizedNote,
  NoteReaction,
  ServerAdapter,
} from '@/adapters/types'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkAvatar from '@/components/common/MkAvatar.vue'
import MkEmoji from '@/components/common/MkEmoji.vue'
import MkMfm from '@/components/common/MkMfm.vue'
import MkNote from '@/components/common/MkNote.vue'
import type {
  NoteTreeHandlers,
  NoteTreeNode,
} from '@/components/common/MkNoteTree.vue'
import MkNoteTree from '@/components/common/MkNoteTree.vue'
import { commands, unwrap } from '@/utils/tauriInvoke'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

import { useEmojiResolver } from '@/composables/useEmojiResolver'
import { useNavigation } from '@/composables/useNavigation'
import { useNoteCapture } from '@/composables/useNoteCapture'
import { usePortal } from '@/composables/usePortal'
import { useAccountsStore } from '@/stores/accounts'
import { useNoteStore } from '@/stores/notes'
import { useIsCompactLayout } from '@/stores/ui'
import { AppError } from '@/utils/errors'
import { proxyUrl } from '@/utils/imageProxy'
import { toggleReaction } from '@/utils/toggleReaction'

const props = defineProps<{
  accountId: string
  noteId: string
}>()

const emit = defineEmits<{ close: [] }>()

const noteStore = useNoteStore()
const accountsStore = useAccountsStore()
const isCompact = useIsCompactLayout()
const { navigateToUser: navToUser } = useNavigation()
const { reactionUrl: reactionUrlRaw } = useEmojiResolver()

const note = ref<NormalizedNote | null>(null)
const ancestors = ref<NormalizedNote[]>([])
const children = ref<NormalizedNote[]>([])
const renotes = ref<NormalizedNote[]>([])
const reactionUsers = ref<NoteReaction[]>([])
// 本家準拠: リアクション種別チップで絞り込んでユーザー一覧を表示する
const reactionTab = ref<string | null>(null)
const reactionTypes = computed(() =>
  note.value ? Object.keys(note.value.reactions) : [],
)
const isLoading = ref(true)
const error = ref<AppError | null>(null)
const myUserId = ref<string | undefined>()

// Note Capture: 投票・リアクション等の pollVoted/reacted イベントを受けて
// 表示中のノートをリアルタイム更新する。カラムと違い詳細ウィンドウは
// channel auto-capture の対象外のため明示的に購読する。
const { sync: syncCapture } = useNoteCapture(
  () => adapter?.stream,
  (event) => {
    noteStore.applyUpdate(event, myUserId.value)
    const latest = noteStore.get(event.noteId)
    if (note.value?.id === event.noteId) {
      note.value = latest ?? null
    }
    ancestors.value = ancestors.value.map((n) =>
      n.id === event.noteId && latest
        ? latest
        : n.renoteId === event.noteId && latest
          ? { ...n, renote: latest }
          : n,
    )
    children.value = children.value.map((n) =>
      n.id === event.noteId && latest
        ? latest
        : n.renoteId === event.noteId && latest
          ? { ...n, renote: latest }
          : n,
    )
  },
)

type DetailTab = 'replies' | 'renotes' | 'reactions'
const activeTab = ref<DetailTab>('replies')

const DETAIL_TABS: { key: DetailTab; label: string; icon: string }[] = [
  { key: 'replies', label: '返信', icon: 'ti ti-arrow-back-up' },
  { key: 'renotes', label: 'リノート', icon: 'ti ti-repeat' },
  { key: 'reactions', label: 'リアクション', icon: 'ti ti-mood-happy' },
]

let adapter: ServerAdapter | null = null

onMounted(async () => {
  const account = accountsStore.accounts.find((a) => a.id === props.accountId)
  if (!account) {
    error.value = new AppError(
      'ACCOUNT_NOT_FOUND',
      'アカウントが見つかりません',
    )
    isLoading.value = false
    return
  }
  myUserId.value = account.userId

  // Show cached note immediately (skip skeleton) while fetching fresh data
  const cached = noteStore.get(props.noteId)
  if (cached) {
    note.value = cached
    isLoading.value = false
  }

  try {
    const result = await initAdapterFor(account.host, account.id, {
      pinnedReactions: false,
      hasToken: account.hasToken,
    })
    adapter = result.adapter
    note.value = await adapter.api.getNote(props.noteId)

    const [conv, replies] = await Promise.all([
      adapter.api
        .getNoteConversation(props.noteId)
        .catch(() => [] as NormalizedNote[]),
      adapter.api
        .getNoteChildren(props.noteId)
        .catch(() => [] as NormalizedNote[]),
    ])
    ancestors.value = conv.reverse()
    children.value = replies
  } catch (e) {
    // API failed: keep cached note if displayed, otherwise show error
    if (!note.value) {
      error.value = AppError.from(e)
    }
  } finally {
    isLoading.value = false
  }
})

// 表示中ノートが変わったらストア登録と購読を同期
watch(
  [note, ancestors, children],
  () => {
    const notes: NormalizedNote[] = []
    if (note.value) notes.push(note.value)
    notes.push(...ancestors.value, ...children.value)
    if (notes.length === 0) return
    noteStore.put(notes)
    syncCapture(notes)
  },
  { immediate: true },
)

const loadedTabs = ref<Set<DetailTab>>(new Set(['replies']))

watch(activeTab, async (tab) => {
  if (loadedTabs.value.has(tab) || !adapter) return
  loadedTabs.value.add(tab)
  try {
    if (tab === 'renotes') {
      renotes.value = await adapter.api.getNoteRenotes(props.noteId)
    } else if (tab === 'reactions') {
      reactionTab.value = reactionTypes.value[0] ?? null
    }
  } catch (e) {
    console.warn('[NoteDetail] failed to load tab:', tab, e)
  }
})

watch(reactionTab, async (type) => {
  if (!type || !adapter) return
  reactionUsers.value = []
  try {
    reactionUsers.value = await adapter.api.getNoteReactions(
      props.noteId,
      type,
      100,
    )
  } catch (e) {
    console.warn('[NoteDetail] failed to load reactions:', type, e)
  }
})

function reactionTypeUrl(type: string): string | null {
  if (!note.value) return null
  return reactionUrlRaw(
    type,
    note.value.emojis,
    note.value.reactionEmojis,
    note.value._serverHost,
  )
}

async function handleReaction(reaction: string, target: NormalizedNote) {
  if (!adapter) return
  try {
    await toggleReaction(adapter.api, target, reaction)
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleVote(choice: number, target: NormalizedNote) {
  if (!adapter) return
  const { votePoll } = await import('@/utils/votePoll')
  try {
    await votePoll(adapter.api, target, choice)
  } catch (e) {
    error.value = AppError.from(e)
  }
}

const postFormPortalRef = useTemplateRef<HTMLElement>('postFormPortalRef')
usePortal(postFormPortalRef)

const showPostForm = ref(false)
const postFormReplyTo = ref<NormalizedNote | undefined>()
const postFormRenoteId = ref<string | undefined>()
const postFormEditNote = ref<NormalizedNote | undefined>()

async function handleRenote(target: NormalizedNote) {
  if (!adapter) return
  try {
    await adapter.api.createNote({ renoteId: target.id })
  } catch (e) {
    error.value = AppError.from(e)
  }
}

function handleReply(target: NormalizedNote) {
  postFormReplyTo.value = target
  postFormRenoteId.value = undefined
  showPostForm.value = true
}

function handleQuote(target: NormalizedNote) {
  postFormReplyTo.value = undefined
  postFormRenoteId.value = target.id
  showPostForm.value = true
}

function handleEdit(target: NormalizedNote) {
  postFormReplyTo.value = undefined
  postFormRenoteId.value = undefined
  postFormEditNote.value = target
  showPostForm.value = true
}

async function handleDelete(target: NormalizedNote) {
  if (!adapter) return
  try {
    await adapter.api.deleteNote(target.id)
    const id = target.id
    noteStore.remove(id)
    commands
      .apiDeleteCachedNote(id)
      .then((r) => unwrap(r))
      .catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[delete-cached-note] ignored:', e)
      })
    if (id === note.value?.id) {
      emit('close')
    } else {
      children.value = children.value.filter(
        (n) => n.id !== id && n.renoteId !== id,
      )
      ancestors.value = ancestors.value.filter(
        (n) => n.id !== id && n.renoteId !== id,
      )
    }
  } catch (e) {
    error.value = AppError.from(e)
  }
}

async function handleDeleteAndEdit(target: NormalizedNote) {
  if (!adapter) return
  try {
    await adapter.api.deleteNote(target.id)
    const id = target.id
    noteStore.remove(id)
    commands
      .apiDeleteCachedNote(id)
      .then((r) => unwrap(r))
      .catch((e) => {
        if (import.meta.env.DEV)
          console.debug('[delete-cached-note] ignored:', e)
      })
    if (id === note.value?.id) {
      // Reopen post form for the focal note
      postFormReplyTo.value = target.replyId
        ? await adapter.api.getNote(target.replyId).catch(() => undefined)
        : undefined
      postFormRenoteId.value = undefined
      postFormEditNote.value = undefined
      showPostForm.value = true
    } else {
      children.value = children.value.filter(
        (n) => n.id !== id && n.renoteId !== id,
      )
      ancestors.value = ancestors.value.filter(
        (n) => n.id !== id && n.renoteId !== id,
      )
      postFormReplyTo.value = target.replyId
        ? await adapter.api.getNote(target.replyId).catch(() => undefined)
        : undefined
      postFormRenoteId.value = undefined
      postFormEditNote.value = undefined
      showPostForm.value = true
    }
  } catch (e) {
    error.value = AppError.from(e)
  }
}

function closePostForm() {
  showPostForm.value = false
  postFormReplyTo.value = undefined
  postFormRenoteId.value = undefined
  postFormEditNote.value = undefined
}

function buildTree(
  notes: NormalizedNote[],
  rootNoteId: string,
): NoteTreeNode[] {
  const childrenMap = new Map<string, NoteTreeNode[]>()
  for (const n of notes) {
    const parentId = n.replyId ?? rootNoteId
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, [])
    childrenMap.get(parentId)?.push({ note: n, children: [] })
  }

  function attachChildren(node: NoteTreeNode): NoteTreeNode {
    node.children = childrenMap.get(node.note.id) ?? []
    for (const child of node.children) attachChildren(child)
    return node
  }

  const roots = childrenMap.get(rootNoteId) ?? []
  for (const root of roots) attachChildren(root)
  return roots
}

const childrenTree = computed<NoteTreeNode[]>(() => {
  if (!note.value) return []
  return buildTree(children.value, note.value.id)
})

const treeHandlers = computed<NoteTreeHandlers>(() => ({
  react: handleReaction,
  reply: handleReply,
  renote: handleRenote,
  quote: handleQuote,
  deleteFn: handleDelete,
  edit: handleEdit,
  deleteAndEdit: handleDeleteAndEdit,
  vote: handleVote,
}))

async function handlePosted(editedNoteId?: string) {
  closePostForm()
  if (editedNoteId && adapter) {
    try {
      const updated = await adapter.api.getNote(editedNoteId)
      if (note.value?.id === editedNoteId) {
        note.value = updated
      }
      children.value = children.value.map((n) =>
        n.id === editedNoteId
          ? updated
          : n.renoteId === editedNoteId
            ? { ...n, renote: updated }
            : n,
      )
      ancestors.value = ancestors.value.map((n) =>
        n.id === editedNoteId
          ? updated
          : n.renoteId === editedNoteId
            ? { ...n, renote: updated }
            : n,
      )
    } catch {
      // note may have been deleted
    }
  }
}
</script>

<template>
  <div :class="[$style.noteDetailContent, { [$style.mobile]: isCompact }]">
    <div v-if="isLoading" :class="$style.stateMessage"><LoadingSpinner /></div>

    <div v-else-if="error" :class="[$style.stateMessage, $style.stateError]">
      <p>{{ error.message }}</p>
    </div>

    <div v-else-if="note" :class="$style.noteDetail">
      <div v-if="ancestors.length > 0" :class="$style.ancestors">
        <MkNote
          v-for="ancestor in ancestors"
          :key="ancestor.id"
          :note="ancestor"
          @react="handleReaction"
          @reply="handleReply"
          @renote="handleRenote"
          @quote="handleQuote"
          @delete="handleDelete"
          @edit="handleEdit"
          @delete-and-edit="handleDeleteAndEdit"
          @vote="handleVote"
        />
      </div>

      <div :class="$style.focalNote">
        <MkNote
          :note="note"
          detailed
          @react="handleReaction"
          @reply="handleReply"
          @renote="handleRenote"
          @quote="handleQuote"
          @delete="handleDelete"
          @edit="handleEdit"
          @delete-and-edit="handleDeleteAndEdit"
          @vote="handleVote"
        />
      </div>

      <!-- Tabs -->
      <div :class="$style.detailTabs">
        <button
          v-for="tab in DETAIL_TABS"
          :key="tab.key"
          class="_button"
          :class="[$style.detailTabItem, { [$style.active]: activeTab === tab.key }]"
          @click="activeTab = tab.key"
        >
          <i :class="tab.icon" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab: Replies -->
      <div v-if="activeTab === 'replies'">
        <MkNoteTree
          v-if="childrenTree.length > 0"
          :nodes="childrenTree"
          :account-id="accountId"
          :handlers="treeHandlers"
        />
        <div v-if="children.length === 0" :class="$style.stateMessage">
          返信はありません
        </div>
      </div>

      <!-- Tab: Renotes -->
      <div v-if="activeTab === 'renotes'">
        <div v-if="renotes.length > 0" :class="$style.tabPane">
          <div :class="$style.userCards">
            <button
              v-for="rn in renotes"
              :key="rn.id"
              class="_button"
              :class="$style.userCard"
              @click="navToUser(accountId, rn.user.id)"
            >
              <MkAvatar
                :avatar-url="rn.user.avatarUrl"
                :decorations="rn.user.avatarDecorations"
                :size="34"
                :is-cat="rn.user.isCat"
              />
              <div :class="$style.userCardBody">
                <span :class="$style.userCardName">
                  <MkMfm
                    v-if="rn.user.name"
                    :text="rn.user.name"
                    :emojis="rn.user.emojis"
                    :server-host="rn._serverHost"
                    plain
                  />
                  <template v-else>{{ rn.user.username }}</template>
                </span>
                <span :class="$style.userCardAcct">@{{ rn.user.username }}<template v-if="rn.user.host">@{{ rn.user.host }}</template></span>
              </div>
            </button>
          </div>
        </div>
        <div v-else :class="$style.stateMessage">
          リノートはありません
        </div>
      </div>

      <!-- Tab: Reactions -->
      <div v-if="activeTab === 'reactions'">
        <div v-if="reactionTypes.length > 0" :class="$style.tabPane">
          <div :class="$style.reactionChips">
            <button
              v-for="rt in reactionTypes"
              :key="rt"
              class="_button"
              :class="[$style.reactionChip, { [$style.reactionChipActive]: reactionTab === rt }]"
              @click="reactionTab = rt"
            >
              <img
                v-if="reactionTypeUrl(rt)"
                :src="proxyUrl(reactionTypeUrl(rt)!)"
                :alt="rt"
                :class="$style.reactionChipEmoji"
                decoding="async"
              />
              <MkEmoji v-else :emoji="rt" :class="$style.reactionChipEmoji" />
              <span :class="$style.reactionChipCount">{{ note.reactions[rt] }}</span>
            </button>
          </div>
          <div v-if="reactionUsers.length > 0" :class="$style.userCards">
            <button
              v-for="r in reactionUsers"
              :key="r.id"
              class="_button"
              :class="$style.userCard"
              @click="navToUser(accountId, r.user.id)"
            >
              <MkAvatar
                :avatar-url="r.user.avatarUrl"
                :decorations="r.user.avatarDecorations"
                :size="34"
                :is-cat="r.user.isCat"
              />
              <div :class="$style.userCardBody">
                <span :class="$style.userCardName">
                  <MkMfm
                    v-if="r.user.name"
                    :text="r.user.name"
                    :emojis="r.user.emojis"
                    :server-host="note._serverHost"
                    plain
                  />
                  <template v-else>{{ r.user.username }}</template>
                </span>
                <span :class="$style.userCardAcct">@{{ r.user.username }}<template v-if="r.user.host">@{{ r.user.host }}</template></span>
              </div>
            </button>
          </div>
        </div>
        <div v-else :class="$style.stateMessage">
          リアクションはありません
        </div>
      </div>
    </div>

    <div v-if="showPostForm" ref="postFormPortalRef">
      <MkPostForm
        :account-id="accountId"
        :reply-to="postFormReplyTo"
        :renote-id="postFormRenoteId"
        :edit-note="postFormEditNote"
        @close="closePostForm"
        @posted="handlePosted"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
.noteDetailContent {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--nd-bg);
}

.noteDetail {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
}

.ancestors {
  opacity: 0.85;

  :deep(.note-root + .note-root) {
    border-top: none;
  }
}

.focalNote {
  border-top: 2px solid var(--nd-accent);
  border-bottom: 1px solid var(--nd-divider);
  background: var(--nd-panelHighlight);
}

.detailTabs {
  display: flex;
  border-bottom: solid 0.5px var(--nd-divider);
  position: sticky;
  top: 0;
  background: var(--nd-bg);
  z-index: 5;
}

.detailTabItem {
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

.tabPane {
  padding: 16px;
}

/* 本家 MkNoteDetailed の renotes/reactions グリッド準拠 */
.userCards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 12px;
}

/* 本家 MkUserCardMini 準拠。_button 併用のため self-chain で
   特異度を (0,2,0) に上げる (WebView2 の _button 衝突対策)。 */
.userCard.userCard {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  text-align: left;
  background: var(--nd-panel);
  border-radius: 8px;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-panelHighlight);
  }
}

.userCardBody {
  flex: 1;
  min-width: 0;
  font-size: 0.9em;
}

.userCardName {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.userCardAcct {
  display: block;
  font-size: 0.85em;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reactionChips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.reactionChip.reactionChip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: solid 1px var(--nd-divider);
  border-radius: 6px;

  &.reactionChipActive {
    border-color: var(--nd-accent);
  }
}

.reactionChipEmoji {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.reactionChipCount {
  font-size: 0.8em;
  opacity: 0.7;
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

.stateError {
  color: var(--nd-love);
  opacity: 1;
}

.mobile {
  .detailTabItem {
    min-height: 44px;
  }
}

/* Empty placeholder classes for dynamic binding */
.active {}
</style>
