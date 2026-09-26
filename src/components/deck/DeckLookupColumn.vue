<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onMounted,
  ref,
  useTemplateRef,
  watch,
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
import { provideNoteFrame } from '@/composables/useNoteFrame'
import { useNoteGroupContext } from '@/composables/useNoteGroups'
import { useNoteVisibility } from '@/composables/useNoteVisibility'
import { usePortal } from '@/composables/usePortal'
import {
  type MergedThread,
  type MergedThreadNode,
  mergeThreadFragments,
  type ThreadFragment,
} from '@/engine/threadMerge'
import { i18n } from '@/i18n'
import { resolveNoteUriFor } from '@/services/entityResolution'
import {
  nestedVariantKey,
  type VariantKey,
  variantKeyOf,
} from '@/services/noteKey'
import { useAccountsStore } from '@/stores/accounts'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useSuspensionsStore } from '@/stores/suspensions'
import { mapWithConcurrency } from '@/utils/concurrency'
import { isImeComposing } from '@/utils/ime'
import { parseUserQuery } from '@/utils/noteUrl'
import { isRenoteOnly } from '@/utils/noteViewModel'
import { commands, unwrap } from '@/utils/tauriInvoke'
import ColumnCrossPostForm from './ColumnCrossPostForm.vue'
import DeckColumn from './DeckColumn.vue'

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
} = useColumnSetup(() => props.column, {
  // 照会結果は noteStore ではなくローカルの deep ref (result / ancestors /
  // children) に保持しているため、差分は対象オブジェクトへ直接代入して
  // 反映する (cross-account 側の handleReactionCrossAccount と同じ規則)
  // note を直接 mutate しているので、note 自身が常に最新 (#904)
  applyNotePatch: (note, compute) => Object.assign(note, compute(note)),
})

const accountsStore = useAccountsStore()
const { context: groupContext } = useNoteGroupContext()

const isCrossAccount = computed(() => props.column.accountId == null)
// 全アカウント面ではノートの基準サーバーを絶対にする (#1059)
provideNoteFrame(isCrossAccount)
const multiAdapters = useMultiAccountAdapters()

const queryInput = ref('')
const lookupLoading = ref(false)
const isProbing = ref(false)
const probeProgress = ref(0)
const lookupError = ref<string | null>(null)
const mergedThread = ref<MergedThread | null>(null)
/**
 * この照会で削除したノート (variant key)。ローカル保持 (result / ancestors /
 * children / mergedThread) から外すだけでは、遅れて返るアカウントの
 * プログレッシブ再マージや per-account のスレッド取得で復活するので、
 * 取り込み前にここで落とす。照会をやり直したら空にする
 */
const deletedKeys = new Set<VariantKey>()
/**
 * 同じく identity。全アカウント照会は同じノートを複数アカウントの variant で
 * 持つので、variant key だけだと別アカウント経由の variant が主ビューに昇格して
 * スレッドごと復活する
 */
const deletedIdentities = new Set<string>()
/** 削除済み、または削除済みノートの純 Renote か */
function isDropped(note: NormalizedNote): boolean {
  if (deletedKeys.has(variantKeyOf(note))) return true
  if (deletedIdentities.has(note._identity)) return true
  if (!note.renoteId || !isRenoteOnly(note)) return false
  if (deletedKeys.has(nestedVariantKey(note, note.renoteId))) return true
  return !!note.renote && deletedIdentities.has(note.renote._identity)
}

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

const { filterVisible } = useNoteVisibility()
// 凍結 probe の供給点（#828）
watch([ancestors, children], ([a, c]) =>
  useSuspensionsStore().probeNotes([...a, ...c]),
)

// 明示的に開いた本体ノート（result.note）は述語を通さない。祖先は文脈欠損を
// 避けるため凍結のみ貫通、返信ツリーは一覧面なので全適用（#606）
const visibleAncestors = computed(() =>
  filterVisible(ancestors.value, { ignoreSuspension: true }),
)

const childrenTree = computed<NoteTreeNode[]>(() => {
  if (result.value?.type !== 'Note') return []
  return buildTree(filterVisible(children.value), result.value.note.id)
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
  deletedKeys.clear()
  deletedIdentities.clear()

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
    lookupError.value = i18n.ts._deckLookupColumn.accountNotFound
    lookupLoading.value = false
    return
  }

  const adapter = getAdapter()
  if (!adapter) {
    lookupError.value = i18n.ts._deckLookupColumn.adapterInitFailed
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

    // ノート解決（同一ホスト高速パス + ap/show）はサービスに委譲
    const resolved = await resolveNoteUriFor(accountId, q)
    if (resolved.ok) {
      const note = await api.getNote(resolved.noteId)
      result.value = { type: 'Note', note }
      loadThread(note.id)
      return
    }

    // not_found は「ap/show が Note 以外を返した」可能性がある —
    // ユーザー URL 等は User として照会し直す
    if (resolved.code === 'not_found') {
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
      if (res.type === 'User' && res.object?.id) {
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
        return
      }
    }

    lookupError.value = i18n.ts._deckLookupColumn.lookupFailed
  } catch {
    lookupError.value = i18n.ts._deckLookupColumn.lookupFailed
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
    ancestors.value = conv.reverse().filter((n) => !isDropped(n))
    children.value = replies.filter((n) => !isDropped(n))
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
    lookupError.value = i18n.ts._deckLookupColumn.noLoggedInAccount
    lookupLoading.value = false
    return
  }

  // ユーザー照会は cross-account 非対応（ノート専用）
  if (parseUserQuery(q)) {
    lookupError.value = i18n.ts._deckLookupColumn.userLookupSingleAccountOnly
    lookupLoading.value = false
    return
  }

  // 束ねのキーは identity (正規化 AP object id)。導出は notecli 側 1 か所 (#1058)
  const focalUri = unwrap(await commands.apiNoteIdentity(q))
  const allFragments: ThreadFragment[] = []
  // 主ビュー選択の文脈 (#1058 §5.2)。ゲスト取得の variant (Phase 1 のローカル
  // DB 由来) は最下位になる
  const mergeCtx = groupContext.value

  // Phase 1: ローカル DB 横断検索（即座）
  try {
    const cached = unwrap(
      await commands.apiFindNotesByIdentity(focalUri),
    ) as unknown as NormalizedNote[]
    if (cached.length > 0) {
      for (const note of cached) {
        allFragments.push({ note, sourceAccountId: note._accountId })
      }
      mergedThread.value = mergeThreadFragments(
        allFragments.filter((f) => !isDropped(f.note)),
        focalUri,
        mergeCtx,
      )
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

        // このアカウントのサーバー上の noteId に解決（高速パス + ap/show）
        const resolved = await resolveNoteUriFor(acc.id, focalUri)
        if (!resolved.ok) return fragments
        const localNoteId = resolved.noteId

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
          mergedThread.value = mergeThreadFragments(
            allFragments.filter((f) => !isDropped(f.note)),
            focalUri,
            mergeCtx,
          )
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
    lookupError.value = i18n.ts._deckLookupColumn.lookupFailed
  }
}

function onKeydown(e: KeyboardEvent) {
  if (isImeComposing(e)) return
  if (e.key === 'Enter') {
    performLookup()
  }
}

/**
 * 削除したノードをローカル保持のスレッドから外す。照会結果は noteStore に
 * 置いていないので、handlers 側の tombstone だけでは表示から消えない
 */
function removeFromLocalThread(target: NormalizedNote) {
  deletedKeys.add(variantKeyOf(target))
  if (target._identity) deletedIdentities.add(target._identity)
  if (isCrossAccount.value) {
    const thread = mergedThread.value
    if (!thread) return
    if (isDropped(thread.focal.note)) {
      mergedThread.value = null
      return
    }
    const prune = (nodes: MergedThreadNode[]): MergedThreadNode[] =>
      nodes
        .filter((n) => !isDropped(n.note))
        .map((n) => ({ ...n, children: prune(n.children) }))
    mergedThread.value = {
      ...thread,
      ancestors: prune(thread.ancestors),
      children: prune(thread.children),
    }
    return
  }
  if (result.value?.type === 'Note' && isDropped(result.value.note)) {
    result.value = null
    ancestors.value = []
    children.value = []
  } else {
    children.value = children.value.filter((n) => !isDropped(n))
    ancestors.value = ancestors.value.filter((n) => !isDropped(n))
  }
}

/** 削除後にスレッド表示からノードを除去 */
async function handleDelete(target: NormalizedNote) {
  if (await handlers.delete(target)) removeFromLocalThread(target)
}

/** 削除して編集 — 削除後にポストフォームを開く (フォーム組み立ては handlers 側) */
async function handleDeleteAndEdit(target: NormalizedNote) {
  if (await handlers.deleteAndEdit(target)) removeFromLocalThread(target)
}

const lookupResultRef = useTemplateRef<HTMLElement>('lookupResultRef')

function scrollToTop() {
  lookupResultRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

async function handlePosted(editedNoteId?: string) {
  // 全アカウント照会では投稿したアカウント (close で消える) で再取得する
  const postedAccountId = postForm.accountId.value
  postForm.close()
  if (!editedNoteId) return
  if (isCrossAccount.value) {
    const thread = mergedThread.value
    const focal = thread?.focal.note
    if (
      !thread ||
      !focal ||
      !postedAccountId ||
      focal._accountId !== postedAccountId ||
      focal.id !== editedNoteId
    )
      return
    const adapter = await multiAdapters.getOrCreate(postedAccountId)
    if (!adapter) return
    try {
      const updated = await adapter.api.getNote(editedNoteId)
      mergedThread.value = {
        ...thread,
        focal: { ...thread.focal, note: updated },
      }
    } catch {
      // ignore
    }
    return
  }
  const adapter = getAdapter()
  if (adapter && result.value?.type === 'Note') {
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
    :title="column.name ?? i18n.ts._columns.lookup"
    :theme-vars="columnThemeVars"
    require-account
    @header-click="scrollToTop"
  >
    <template #header-icon>
      <i class="ti ti-world-search" :class="$style.tlHeaderIcon" />
    </template>

    <template #header-meta>
    </template>

    <template #header-extra>
      <div :class="$style.lookupBar">
        <i class="ti ti-world-search" :class="$style.lookupIcon" />
        <input
          v-model="queryInput"
          :class="$style.lookupInput"
          type="text"
          :placeholder="i18n.ts._deckLookupColumn.placeholder"
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
        :cta-label="i18n.ts._common.retry"
        cta-icon="ti-refresh"
        @cta="performLookup"
      />

      <ColumnEmptyState v-else-if="!mergedThread" :message="i18n.ts._deckLookupColumn.emptyThread" :image-url="serverInfoImageUrl" />

      <div v-else ref="lookupResultRef" :class="$style.lookupResult">
        <div v-if="isProbing" :class="$style.probeProgress">
          <div :class="$style.probeBar" :style="{ width: probeProgress * 100 + '%' }" />
        </div>
        <div v-if="mergedThread.ancestors.length > 0" :class="$style.ancestors">
          <MkNote
            v-for="node in mergedThread.ancestors"
            :key="node.note._identity"
            :note="node.note"
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
          :note="mergedThread.focal.note"
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
          v-if="mergedThread.children.length > 0"
          :nodes="mergedChildrenTree"
          :account-id="mergedThread.focal.note._accountId"
          :handlers="treeHandlers"
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
        :cta-label="i18n.ts._common.retry"
        cta-icon="ti-refresh"
        @cta="performLookup"
      />

      <ColumnEmptyState v-else-if="!result" :message="i18n.ts._deckLookupColumn.emptyResult" :image-url="serverInfoImageUrl" />

      <div v-else-if="result.type === 'Note'" ref="lookupResultRef" :class="$style.lookupResult">
        <div v-if="visibleAncestors.length > 0" :class="$style.ancestors">
          <MkNote
            v-for="ancestor in visibleAncestors"
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
      :initial-note="postForm.initialNote.value"
      :initial-text="postForm.initialText.value"
      :initial-cw="postForm.initialCw.value"
      :initial-visibility="postForm.initialVisibility.value"
      @close="postForm.close"
      @posted="handlePosted"
    />
  </div>
  <ColumnCrossPostForm v-if="isCrossAccount" :post-form="postForm" @posted="handlePosted" />
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
  transition: width 0.3s var(--nd-ease-decel);
}

.headerCrossIcon {
  font-size: 0.9em;
  opacity: 0.7;
}


</style>
