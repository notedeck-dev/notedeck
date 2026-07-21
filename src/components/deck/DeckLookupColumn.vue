<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  useTemplateRef,
} from 'vue'
import type { NormalizedNote, UserRelation } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import MkNote from '@/components/common/MkNote.vue'
import type {
  NoteTreeHandlers,
  NoteTreeNode,
} from '@/components/common/MkNoteTree.vue'
import MkNoteTree from '@/components/common/MkNoteTree.vue'
import MkUserListItem from '@/components/common/MkUserListItem.vue'
import { useColumnSetup } from '@/composables/useColumnSetup'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { usePortal } from '@/composables/usePortal'
import {
  getNoteUri,
  type MergedThread,
  mergeThreadFragments,
  type ThreadFragment,
} from '@/engine/threadMerge'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { mapWithConcurrency } from '@/utils/concurrency'
import { isImeComposing } from '@/utils/ime'
import { parseNoteUrl, parseUserQuery } from '@/utils/noteUrl'
import { commands, unwrap } from '@/utils/tauriInvoke'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

const props = defineProps<{
  column: DeckColumnType
}>()

const {
  account,
  columnThemeVars,
  serverIconUrl,
  serverInfoImageUrl,
  serverNotFoundImageUrl,
  serverErrorImageUrl,
  isLoading,
  error: setupError,
  initAdapter,
  getAdapter,
  postForm,
  handlers,
} = useColumnSetup(() => props.column)

const accountsStore = useAccountsStore()

const isCrossAccount = computed(() => props.column.accountId == null)
const multiAdapters = useMultiAccountAdapters()

const queryInput = ref('')
const lookupLoading = ref(false)
const isProbing = ref(false)
const probeProgress = ref(0)
const lookupError = ref<string | null>(null)
const mergedThread = ref<MergedThread | null>(null)

type LookupResult =
  | { type: 'Note'; note: NormalizedNote }
  | {
      type: 'User'
      user: {
        id: string
        username: string
        host: string | null
        name: string | null
        avatarUrl: string | null
        emojis?: Record<string, string>
      }
    }

const result = ref<LookupResult | null>(null)
/** User 結果行の relation バッジ (#752) */
const userRelation = ref<UserRelation | null>(null)
const ancestors = ref<NormalizedNote[]>([])
const children = ref<NormalizedNote[]>([])

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
  if (result.value?.type !== 'Note') return []
  return buildTree(children.value, result.value.note.id)
})

const treeHandlers = computed<NoteTreeHandlers>(() => ({
  react: handlers.reaction,
  reply: handlers.reply,
  renote: handlers.renote,
  quote: handlers.quote,
  deleteFn: handleDelete,
  edit: handlers.edit,
  deleteAndEdit: handleDeleteAndEdit,
  vote: handlers.vote,
}))

/** cross-account: MergedThreadNode[] → NoteTreeNode[] に変換 */
const mergedChildrenTree = computed<NoteTreeNode[]>(() => {
  if (!mergedThread.value) return []
  return mergedThread.value.children.map(
    function toTreeNode(node): NoteTreeNode {
      return {
        note: node.note,
        children: node.children.map(toTreeNode),
      }
    },
  )
})

const noop = () => {
  /* cross-account では未対応 */
}
const crossAccountTreeHandlers = computed<NoteTreeHandlers>(() => ({
  react: handleReactionCrossAccount,
  reply: noop,
  renote: handleRenoteCrossAccount,
  quote: noop,
  deleteFn: handleDeleteCrossAccount,
  edit: noop,
  deleteAndEdit: noop,
  vote: handleVoteCrossAccount,
}))

const postPortalRef = useTemplateRef<HTMLElement>('postPortalRef')
usePortal(postPortalRef)

onMounted(async () => {
  if (!isCrossAccount.value) {
    await initAdapter()
  }
})

async function performLookup() {
  const q = queryInput.value.trim()
  if (!q) return

  if (isCrossAccount.value) {
    await performLookupCrossAccount(q)
    return
  }

  if (!props.column.accountId) return

  lookupLoading.value = true
  lookupError.value = null
  result.value = null
  userRelation.value = null
  ancestors.value = []
  children.value = []

  const acc = accountsStore.accountMap.get(props.column.accountId)
  if (!acc) {
    lookupError.value = 'アカウントが見つかりません'
    lookupLoading.value = false
    return
  }

  const adapter = getAdapter()
  if (!adapter) {
    lookupError.value = 'アダプターの初期化に失敗しました'
    lookupLoading.value = false
    return
  }
  const api = adapter.api

  const accountId = props.column.accountId

  try {
    // Check if input is @user or @user@host format
    const userQuery = parseUserQuery(q)
    if (userQuery) {
      const { username, host } = userQuery
      const user = unwrap(
        await commands.apiLookupUser(accountId, username, host),
      )
      result.value = {
        type: 'User',
        user: {
          id: user.id,
          username: user.username,
          host: user.host,
          name: user.name,
          avatarUrl: user.avatarUrl,
          emojis: (user.emojis ?? undefined) as
            | Record<string, string>
            | undefined,
        },
      }
      // relation バッジ (#752) は非ブロッキングで後追い取得
      adapter.api
        .getUserRelations([user.id])
        .then(([rel]) => {
          if (result.value?.type === 'User' && result.value.user.id === user.id)
            userRelation.value = rel ?? null
        })
        .catch(() => {
          // relation はバッジ用の付加情報なので取得失敗は無視
        })
      lookupLoading.value = false
      return
    }

    // Try parsing as a note URL for same-server direct fetch
    const parsed = parseNoteUrl(q)
    if (parsed && parsed.host === acc.host) {
      const note = await api.getNote(parsed.noteId)
      result.value = { type: 'Note', note }
      loadThread(note.id)
      lookupLoading.value = false
      return
    }

    // Use ap/show for remote URLs or any URI
    const res = unwrap(await commands.apiApShow(accountId, q)) as unknown as {
      type: string
      object?: {
        id: string
        username?: string
        host?: string | null
        name?: string | null
        avatarUrl?: string | null
        emojis?: Record<string, string>
      }
    }

    if (res.type === 'Note' && res.object?.id) {
      const note = await api.getNote(res.object.id)
      result.value = { type: 'Note', note }
      loadThread(note.id)
    } else if (res.type === 'User' && res.object?.id) {
      result.value = {
        type: 'User',
        user: {
          id: res.object.id,
          username: res.object.username ?? '',
          host: res.object.host ?? null,
          name: res.object.name ?? null,
          avatarUrl: res.object.avatarUrl ?? null,
          emojis: res.object.emojis,
        },
      }
    } else {
      lookupError.value = '照会できませんでした'
    }
  } catch {
    lookupError.value = '照会できませんでした'
  } finally {
    lookupLoading.value = false
  }
}

/** ノート照会後にスレッド（ancestors / children）をバックグラウンドで取得 */
async function loadThread(noteId: string) {
  const adapter = getAdapter()
  if (!adapter) return
  try {
    const [conv, replies] = await Promise.all([
      adapter.api
        .getNoteConversation(noteId)
        .catch(() => [] as NormalizedNote[]),
      adapter.api.getNoteChildren(noteId).catch(() => [] as NormalizedNote[]),
    ])
    ancestors.value = conv.reverse()
    children.value = replies
  } catch {
    // スレッド取得失敗は無視（ノート自体は表示済み）
  }
}

async function performLookupCrossAccount(q: string) {
  lookupLoading.value = true
  lookupError.value = null
  result.value = null
  userRelation.value = null
  ancestors.value = []
  children.value = []
  mergedThread.value = null
  isProbing.value = false
  probeProgress.value = 0

  const accounts = accountsStore.accounts.filter((a) => a.hasToken)
  if (accounts.length === 0) {
    lookupError.value = 'ログイン済みアカウントがありません'
    lookupLoading.value = false
    return
  }

  // ユーザー照会は cross-account 非対応（ノート専用）
  if (parseUserQuery(q)) {
    lookupError.value = 'ユーザー照会は単一アカウントモードで行ってください'
    lookupLoading.value = false
    return
  }

  const focalUri = q
  const allFragments: ThreadFragment[] = []

  // Phase 1: ローカル DB 横断検索（即座）
  try {
    const cached = unwrap(
      await commands.apiFindNotesByUri(focalUri),
    ) as unknown as NormalizedNote[]
    if (cached.length > 0) {
      for (const note of cached) {
        allFragments.push({ note, sourceAccountId: note._accountId })
      }
      mergedThread.value = mergeThreadFragments(allFragments, focalUri)
      lookupLoading.value = false
    }
  } catch {
    // DB 検索失敗は無視（Phase 2 で照会する）
  }

  // Phase 2: 全アカウントで ap/show 並列照会
  let completed = 0
  isProbing.value = true

  await mapWithConcurrency(
    accounts,
    async (acc) => {
      const fragments: ThreadFragment[] = []
      try {
        const adapter = await multiAdapters.getOrCreate(acc.id)
        if (!adapter) return fragments

        // ap/show でノートを解決
        let localNoteId: string | null = null

        // 同一サーバーの URL ならパースして直接取得
        const parsed = parseNoteUrl(q)
        if (parsed && parsed.host === acc.host) {
          localNoteId = parsed.noteId
        } else {
          const apResult = unwrap(
            await commands.apiApShow(acc.id, focalUri),
          ) as unknown as {
            type: string
            object?: { id: string }
          }
          if (apResult.type === 'Note' && apResult.object?.id) {
            localNoteId = apResult.object.id
          }
        }

        if (!localNoteId) return fragments

        // ノート + スレッドを取得
        const [note, conv, replies] = await Promise.all([
          adapter.api.getNote(localNoteId),
          adapter.api
            .getNoteConversation(localNoteId)
            .catch(() => [] as NormalizedNote[]),
          adapter.api
            .getNoteChildren(localNoteId)
            .catch(() => [] as NormalizedNote[]),
        ])

        fragments.push({ note, sourceAccountId: acc.id })
        for (const n of conv) {
          fragments.push({ note: n, sourceAccountId: acc.id })
        }
        for (const n of replies) {
          fragments.push({ note: n, sourceAccountId: acc.id })
        }
      } catch {
        // このアカウントでは照会失敗 — 正常（サーバーに到達していない等）
      } finally {
        completed++
        probeProgress.value = completed / accounts.length

        // プログレッシブ更新
        if (fragments.length > 0) {
          allFragments.push(...fragments)
          mergedThread.value = mergeThreadFragments(allFragments, focalUri)
          // 最初の結果が来たらローディング解除
          if (lookupLoading.value) lookupLoading.value = false
        }
      }
      return fragments
    },
    3,
  )

  isProbing.value = false
  lookupLoading.value = false

  if (allFragments.length === 0) {
    lookupError.value = '照会できませんでした'
  }
}

/** cross-account 時: note._accountId でアダプタを逆引きして操作 */
async function handleReactionCrossAccount(
  reaction: string,
  target: NormalizedNote,
) {
  const adapter = await multiAdapters.getOrCreate(target._accountId)
  if (!adapter) return
  const { toggleReaction } = await import('@/utils/toggleReaction')
  try {
    await toggleReaction(adapter.api, target, reaction)
  } catch {
    // ignore
  }
}

async function handleVoteCrossAccount(choice: number, target: NormalizedNote) {
  const adapter = await multiAdapters.getOrCreate(target._accountId)
  if (!adapter) return
  const { votePoll } = await import('@/utils/votePoll')
  try {
    await votePoll(adapter.api, target, choice)
  } catch {
    // ignore
  }
}

async function handleRenoteCrossAccount(target: NormalizedNote) {
  const adapter = await multiAdapters.getOrCreate(target._accountId)
  if (!adapter) return
  try {
    await adapter.api.createNote({ renoteId: target.id })
  } catch {
    // ignore
  }
}

async function handleDeleteCrossAccount(target: NormalizedNote) {
  const adapter = await multiAdapters.getOrCreate(target._accountId)
  if (!adapter) return
  try {
    await adapter.api.deleteNote(target.id)
  } catch {
    // ignore
  }
}

function onKeydown(e: KeyboardEvent) {
  if (isImeComposing(e)) return
  if (e.key === 'Enter') {
    performLookup()
  }
}

/** 削除後にスレッド表示からノードを除去 */
async function handleDelete(target: NormalizedNote) {
  const deleted = await handlers.delete(target)
  if (!deleted) return
  const id = target.id
  if (result.value?.type === 'Note' && result.value.note.id === id) {
    result.value = null
    ancestors.value = []
    children.value = []
  } else {
    children.value = children.value.filter(
      (n) => n.id !== id && n.renoteId !== id,
    )
    ancestors.value = ancestors.value.filter(
      (n) => n.id !== id && n.renoteId !== id,
    )
  }
}

/** 削除して編集 — 削除後にポストフォームを開く */
async function handleDeleteAndEdit(target: NormalizedNote) {
  const adapter = getAdapter()
  if (!adapter) return
  try {
    await adapter.api.deleteNote(target.id)
    if (result.value?.type === 'Note' && result.value.note.id === target.id) {
      result.value = null
    }
    postForm.replyTo.value = target.replyId
      ? await adapter.api.getNote(target.replyId).catch(() => undefined)
      : undefined
    postForm.renoteId.value = undefined
    postForm.editNote.value = undefined
    postForm.initialText.value = target.text ?? undefined
    postForm.initialCw.value = target.cw ?? undefined
    postForm.initialVisibility.value = target.visibility
    postForm.show.value = true
  } catch {
    // ignore
  }
}

const lookupResultRef = useTemplateRef<HTMLElement>('lookupResultRef')

function scrollToTop() {
  lookupResultRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

async function handlePosted(editedNoteId?: string) {
  postForm.close()
  const adapter = getAdapter()
  if (editedNoteId && adapter && result.value?.type === 'Note') {
    try {
      const updated = await adapter.api.getNote(editedNoteId)
      if (result.value.note.id === editedNoteId) {
        result.value = { type: 'Note', note: updated }
      }
    } catch {
      // ignore
    }
  }
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? '照会'"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
  >
    <template #header-icon>
      <i class="ti ti-world-search" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
      <div v-if="isCrossAccount" :class="$style.headerAccount">
        <i class="ti ti-git-merge" :class="$style.headerCrossIcon" />
      </div>
      <DeckHeaderAccount v-else :account="account" :server-icon-url="serverIconUrl" />
    </template>

    <template #header-extra>
      <div :class="$style.lookupBar">
        <i class="ti ti-world-search" :class="$style.lookupIcon" />
        <input
          v-model="queryInput"
          :class="$style.lookupInput"
          type="text"
          placeholder="URLまたは@ユーザー名@ホスト"
          @keydown="onKeydown"
        />
        <button
          class="_button"
          :class="$style.lookupBtn"
          :disabled="!queryInput.trim() || lookupLoading"
          @click="performLookup"
        >
          <i class="ti ti-arrow-right" />
        </button>
      </div>
    </template>

    <!-- ===== Cross-account mode ===== -->
    <template v-if="isCrossAccount">
      <div v-if="lookupLoading && !mergedThread" :class="$style.columnLoading">
        <LoadingSpinner />
      </div>

      <ColumnEmptyState
        v-else-if="lookupError"
        :message="lookupError"
        is-error
        :image-url="serverErrorImageUrl"
        cta-label="再試行"
        cta-icon="ti-refresh"
        @cta="performLookup"
      />

      <ColumnEmptyState v-else-if="!mergedThread" message="URLを入力して照会" :image-url="serverInfoImageUrl" />

      <div v-else ref="lookupResultRef" :class="$style.lookupResult">
        <div v-if="isProbing" :class="$style.probeProgress">
          <div :class="$style.probeBar" :style="{ width: probeProgress * 100 + '%' }" />
        </div>
        <div v-if="mergedThread.ancestors.length > 0" :class="$style.ancestors">
          <MkNote
            v-for="node in mergedThread.ancestors"
            :key="getNoteUri(node.note)"
            :note="node.note"
            @react="handleReactionCrossAccount"
            @renote="handleRenoteCrossAccount"
            @delete="handleDeleteCrossAccount"
            @vote="handleVoteCrossAccount"
          />
        </div>
        <MkNote
          :note="mergedThread.focal.note"
          detailed
          @react="handleReactionCrossAccount"
          @renote="handleRenoteCrossAccount"
          @delete="handleDeleteCrossAccount"
          @vote="handleVoteCrossAccount"
        />
        <MkNoteTree
          v-if="mergedThread.children.length > 0"
          :nodes="mergedChildrenTree"
          :account-id="mergedThread.focal.note._accountId"
          :handlers="crossAccountTreeHandlers"
        />
      </div>
    </template>

    <!-- ===== Per-account mode ===== -->
    <template v-else>
      <div v-if="lookupLoading" :class="$style.columnLoading">
        <LoadingSpinner />
      </div>

      <ColumnEmptyState
        v-else-if="lookupError"
        :message="lookupError"
        is-error
        :image-url="serverErrorImageUrl"
        cta-label="再試行"
        cta-icon="ti-refresh"
        @cta="performLookup"
      />

      <ColumnEmptyState v-else-if="!result" message="URLまたは@ユーザー名を入力して照会" :image-url="serverInfoImageUrl" />

      <div v-else-if="result.type === 'Note'" ref="lookupResultRef" :class="$style.lookupResult">
        <div v-if="ancestors.length > 0" :class="$style.ancestors">
          <MkNote
            v-for="ancestor in ancestors"
            :key="ancestor.id"
            :note="ancestor"
            @react="handlers.reaction"
            @reply="handlers.reply"
            @renote="handlers.renote"
            @quote="handlers.quote"
            @delete="handleDelete"
            @edit="handlers.edit"
            @delete-and-edit="handleDeleteAndEdit"
            @vote="handlers.vote"
          />
        </div>
        <MkNote
          :note="result.note"
          detailed
          @react="handlers.reaction"
          @reply="handlers.reply"
          @renote="handlers.renote"
          @quote="handlers.quote"
          @delete="handleDelete"
          @edit="handlers.edit"
          @delete-and-edit="handleDeleteAndEdit"
          @vote="handlers.vote"
        />
        <MkNoteTree
          v-if="childrenTree.length > 0 && column.accountId"
          :nodes="childrenTree"
          :account-id="column.accountId"
          :handlers="treeHandlers"
        />
      </div>

      <div v-else-if="result.type === 'User'" ref="lookupResultRef" :class="$style.lookupResult">
        <MkUserListItem
          :user="result.user"
          :account-id="column.accountId ?? undefined"
          :server-host="account?.host"
          :relation="userRelation"
        />
      </div>
    </template>
  </DeckColumn>

  <div v-if="postForm.show.value && column.accountId" ref="postPortalRef">
    <MkPostForm
      :account-id="column.accountId"
      :reply-to="postForm.replyTo.value"
      :renote-id="postForm.renoteId.value"
      :edit-note="postForm.editNote.value"
      :initial-text="postForm.initialText.value"
      :initial-cw="postForm.initialCw.value"
      :initial-visibility="postForm.initialVisibility.value"
      @close="postForm.close"
      @posted="handlePosted"
    />
  </div>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.lookupBar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
  background: var(--nd-bg);
}

.lookupIcon {
  flex-shrink: 0;
  opacity: 0.4;
}

.lookupInput {
  flex: 1;
  min-width: 0;
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  padding: 6px 10px;
  font-size: 0.85em;
  color: var(--nd-fg);
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.4;
  }
}

.lookupBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }

  &:disabled {
    opacity: 0.2;
  }
}

.lookupResult {
  composes: columnScroller from './column-common.module.scss';
}

.ancestors {
  opacity: 0.85;
}

.probeProgress {
  height: 2px;
  background: var(--nd-divider);
}

.probeBar {
  height: 100%;
  background: var(--nd-accent);
  transition: width 0.3s ease;
}

.headerCrossIcon {
  font-size: 0.9em;
  opacity: 0.7;
}


</style>
