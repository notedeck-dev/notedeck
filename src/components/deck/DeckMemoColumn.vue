<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import type { NormalizedNote, NoteVisibility } from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import MkNote from '@/components/common/MkNote.vue'
import PopupMenu from '@/components/common/PopupMenu.vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { saveDraft } from '@/composables/useDrafts'
import {
  deleteMemo,
  ensureMemosLoaded,
  loadAllMemos,
  loadAllMemosCrossAccount,
  memosVersion,
  type StoredMemo,
} from '@/composables/useMemos'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useEmojisStore } from '@/stores/emojis'
import { useServersStore } from '@/stores/servers'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { buildPreviewNote } from '@/utils/buildPreviewNote'
import { formatScheduleAbsolute } from '@/utils/scheduleFormat'
import DeckColumn from './DeckColumn.vue'
import DeckHeaderAccount from './DeckHeaderAccount.vue'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

const props = defineProps<{
  column: DeckColumnType
}>()

const accountsStore = useAccountsStore()
const serversStore = useServersStore()
const windowsStore = useWindowsStore()
const emojisStore = useEmojisStore()
const { confirm } = useConfirm()
const toast = useToast()
const { columnThemeVars } = useColumnTheme(() => props.column)

/**
 * accountId == null は cross-account ビュー (全アカウントのメモを時系列マージ)。
 * 通知カラムと同様、投稿フォームは隠し、閲覧専用として機能する。
 */
const isCrossAccount = computed(() => props.column.accountId == null)

const account = computed<Account | undefined>(() =>
  accountsStore.accounts.find((a) => a.id === props.column.accountId),
)

const accountById = computed(() => {
  const map = new Map<string, Account>()
  for (const a of accountsStore.accounts) map.set(a.id, a)
  return map
})

const serverInfoImageUrl = computed(() => {
  const host = account.value?.host
  if (!host) return undefined
  return serversStore.getServer(host)?.infoImageUrl
})

const serverIconUrl = computed(() => {
  const host = account.value?.host
  if (!host) return undefined
  return serversStore.getServer(host)?.iconUrl
})

interface MemoContext {
  kind: 'reply' | 'renote' | 'note' | 'channel-note'
  channelId: string | null
  refId: string | null
}

interface MemoEntry {
  key: string
  memo: StoredMemo
  context: MemoContext
  note: NormalizedNote
  /** Memo の所属アカウント。cross-account ビューでメモごとに異なる。 */
  account: Account
}

function parseMemoKey(key: string): MemoContext {
  let rest = key
  let channelId: string | null = null
  if (rest.startsWith('channel:')) {
    const m = rest.slice(8).match(/^(.*?)(?=(?:renote|reply|note):)/)
    if (m) {
      channelId = m[1] ?? null
      rest = rest.slice(8 + (m[1]?.length ?? 0))
    }
  }
  const idx = rest.indexOf(':')
  if (idx < 0) return { kind: 'note', channelId, refId: null }
  const prefix = rest.slice(0, idx)
  const refId = rest.slice(idx + 1) || null
  if (prefix === 'renote') return { kind: 'renote', channelId, refId }
  if (prefix === 'reply') return { kind: 'reply', channelId, refId }
  if (prefix === 'note') {
    return {
      kind: channelId ? 'channel-note' : 'note',
      channelId,
      refId,
    }
  }
  return { kind: 'note', channelId, refId: null }
}

const loaded = ref(false)

watch(
  () => true,
  async () => {
    await ensureMemosLoaded()
    loaded.value = true
  },
  { immediate: true },
)

function buildEntry(acc: Account, key: string, memo: StoredMemo): MemoEntry {
  const ctx = parseMemoKey(key)
  const emojiDict = emojisStore.cache.get(acc.host) ?? {}
  const note = buildPreviewNote({
    account: acc,
    id: `memo:${acc.id}:${key}`,
    createdAt: memo.updatedAt,
    text: memo.data.text || null,
    cw: memo.data.showCw && memo.data.cw ? memo.data.cw : null,
    visibility: memo.data.visibility as NoteVisibility,
    localOnly: memo.data.localOnly,
    replyId: ctx.kind === 'reply' ? ctx.refId : null,
    renoteId: ctx.kind === 'renote' ? ctx.refId : null,
    channelId: ctx.channelId,
    poll: {
      choices: memo.data.pollChoices,
      multiple: memo.data.pollMultiple,
      expiresAt: null,
      show: memo.data.showPoll,
    },
    emojis: emojiDict,
    reactionEmojis: emojiDict,
    // memo.data.author 埋め込みブロックがあれば avatar / 表示名を上書き (#493)。
    // skill が後で消えても author block は memo に永続化されているので壊れない。
    author: memo.data.author,
  })
  // Cross-account ビューでは @username だけだとどのサーバーか分からないため
  // host を埋めて MkNote 側で `@username@host` のフルアドレス表示にする。
  // ただし memo.data.author で persona に上書き済みの場合 (= persona は
  // ローカル概念で host を持たない) は host を埋めない (`@yui` のみ表示)。
  if (isCrossAccount.value && !memo.data.author) {
    note.user = { ...note.user, host: acc.host }
  }
  return {
    key,
    memo,
    context: ctx,
    account: acc,
    note,
  }
}

const entries = computed<MemoEntry[]>(() => {
  void memosVersion.value
  if (!loaded.value) return []
  const out: MemoEntry[] = []
  if (isCrossAccount.value) {
    for (const { accountId, memoKey, memo } of loadAllMemosCrossAccount()) {
      const acc = accountById.value.get(accountId)
      if (!acc) continue
      out.push(buildEntry(acc, memoKey, memo))
    }
  } else {
    const acc = account.value
    if (!acc) return []
    const map = loadAllMemos(acc.id)
    for (const [key, memo] of Object.entries(map)) {
      out.push(buildEntry(acc, key, memo))
    }
  }
  out.sort((a, b) => b.memo.updatedAt.localeCompare(a.memo.updatedAt))
  return out
})

const memoCount = computed(() => entries.value.length)

function contextLabel(ctx: MemoContext): string {
  switch (ctx.kind) {
    case 'reply':
      return '返信'
    case 'renote':
      return '引用'
    case 'channel-note':
      return 'チャンネル投稿'
    default:
      return ''
  }
}

function contextIcon(ctx: MemoContext): string {
  switch (ctx.kind) {
    case 'reply':
      return 'ti ti-arrow-back-up'
    case 'renote':
      return 'ti ti-quote'
    case 'channel-note':
      return 'ti ti-device-tv'
    default:
      return 'ti ti-pencil'
  }
}

function truncate(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

/**
 * Embedded MkPostForm state. Default = blank new memo (Obsidian's "Create
 * Unique New Note" flow). Edit ボタンで既存メモの内容を initialSlot に流し
 * 込んで remount することで、form 内の session slot key を引き継ぐ。
 */
const editingKey = ref<string | null>(null)
const editingMemo = ref<StoredMemo | null>(null)
const formMountKey = ref(0)

function onOpenEditor(entry: MemoEntry) {
  closeMenu()
  windowsStore.open('memoEditor', {
    accountId: entry.account.id,
    memoKey: entry.key,
  })
}

function onRestoreToForm(entry: MemoEntry) {
  closeMenu()
  // Cross-account ビューでは投稿フォームが存在しないため、エディタウィンドウで開く
  if (isCrossAccount.value) {
    onOpenEditor(entry)
    return
  }
  editingKey.value = entry.key
  editingMemo.value = entry.memo
  formMountKey.value++
  void nextTick(() => {
    const el = document.querySelector(
      `[data-column-id="${props.column.id}"] [data-memo-form]`,
    )
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

function onPosted() {
  // After saving, go back to "fresh new memo" mode
  editingKey.value = null
  editingMemo.value = null
  formMountKey.value++
}

/**
 * 「下書きにする」: 同じアカウントの server-side drafts に複製し (notes/drafts/create)、
 * 成功したら元のメモを削除する。visibility/cw/files などのフィールドは共通構造なので
 * そのままコピー可能。
 */
async function onPromoteToDraft(entry: MemoEntry) {
  closeMenu()
  const acc = entry.account
  try {
    await saveDraft(acc.id, null, { ...entry.memo.data })
  } catch (e) {
    toast.show(
      `下書き化に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      'error',
    )
    return
  }
  deleteMemo(acc.id, entry.key)
  if (editingKey.value === entry.key) {
    editingKey.value = null
    editingMemo.value = null
    formMountKey.value++
  }
  toast.show('下書きに変換しました', 'info')
}

async function onDelete(entry: MemoEntry) {
  closeMenu()
  const ok = await confirm({
    title: 'メモを削除',
    message: '選択したメモを削除しますか？',
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  deleteMemo(entry.account.id, entry.key)
  toast.show('メモを削除しました', 'info')
  if (editingKey.value === entry.key) {
    editingKey.value = null
    editingMemo.value = null
    formMountKey.value++
  }
}

// --- Context menu (shares note-style PopupMenu for theme vars + vibrancy) ---
const popupMenuRef = ref<InstanceType<typeof PopupMenu>>()
const activeEntry = ref<MemoEntry | null>(null)

function onContextMenu(e: MouseEvent, entry: MemoEntry) {
  e.preventDefault()
  e.stopPropagation()
  activeEntry.value = entry
  popupMenuRef.value?.open(e)
}

function closeMenu() {
  popupMenuRef.value?.close()
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'メモ'"
    :theme-vars="columnThemeVars"
  >
    <template #header-icon>
      <i class="ti ti-notes" />
    </template>

    <template #header-meta>
      <DeckHeaderAccount
        v-if="!isCrossAccount"
        :account="account"
        :server-icon-url="serverIconUrl"
      />
    </template>

    <!-- Embedded post form (memoMode: post = save as memo).
         Cross-account ビューでは投稿先アカウントが定まらないので非表示。 -->
    <div
      v-if="account && !isCrossAccount"
      :class="$style.embeddedForm"
      data-memo-form
    >
      <MkPostForm
        :key="formMountKey"
        inline
        memo-mode
        :account-id="account.id"
        :initial-slot="editingMemo"
        :initial-slot-key="editingKey"
        @posted="onPosted"
      />
    </div>

    <ColumnEmptyState
      v-if="loaded && memoCount === 0"
      message="メモはありません"
      :image-url="serverInfoImageUrl"
    />

    <div v-else :class="$style.list">
      <div
        v-for="entry in entries"
        :key="`${entry.account.id}:${entry.key}`"
        :class="[$style.item, { [$style.itemEditing]: editingKey === entry.key }]"
        @contextmenu.capture="onContextMenu($event, entry)"
      >
        <div
          v-if="contextLabel(entry.context) || entry.memo.data.scheduledAt"
          :class="$style.meta"
        >
          <span
            v-if="contextLabel(entry.context)"
            :class="$style.metaCtx"
          >
            <i :class="contextIcon(entry.context)" />
            {{ contextLabel(entry.context) }}
          </span>
          <span
            v-if="entry.context.refId && (entry.context.kind === 'reply' || entry.context.kind === 'renote')"
            :class="$style.metaRef"
            :title="entry.context.refId"
          >{{ truncate(entry.context.refId, 14) }}</span>
          <span
            v-if="entry.context.channelId"
            :class="$style.metaChannel"
            :title="entry.context.channelId"
          >
            <i class="ti ti-device-tv" />
            {{ truncate(entry.context.channelId, 12) }}
          </span>
          <span
            v-if="entry.memo.data.scheduledAt"
            :class="$style.metaScheduled"
            :title="entry.memo.data.scheduledAt"
          >
            <i class="ti ti-clock" />
            {{ formatScheduleAbsolute(entry.memo.data.scheduledAt) }}
          </span>
        </div>

        <!-- bubble phase で受け、内部 button (`もっと見る` / CW / mention /
             link) の `.stop` 修飾子を活かす。MkNote 側は disable-article-click
             で article 全体クリックの navigate を抑制 (合成 ID で 404 防止)。 -->
        <div
          :class="$style.itemNoteBtn"
          role="button"
          tabindex="0"
          title="このメモをエディタで開く"
          @click.stop="onOpenEditor(entry)"
          @keydown.enter="onOpenEditor(entry)"
        >
          <MkNote :note="entry.note" embedded disable-article-click />
        </div>
      </div>
    </div>

    <PopupMenu ref="popupMenuRef">
      <template v-if="activeEntry">
        <button
          class="_popupItem"
          @click="onRestoreToForm(activeEntry)"
        >
          <i class="ti ti-arrow-back-up" />
          投稿フォームに復元
        </button>
        <button
          class="_popupItem"
          @click="onPromoteToDraft(activeEntry)"
        >
          <i class="ti ti-send" />
          下書きにする
        </button>
        <div class="_popupDivider" />
        <button
          class="_popupItem _popupItemDanger"
          @click="onDelete(activeEntry)"
        >
          <i class="ti ti-trash" />
          削除
        </button>
      </template>
    </PopupMenu>
  </DeckColumn>
</template>

<style lang="scss" module>
@use './column-common.module.scss';

.embeddedForm {
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

// DeckColumn.columnBody は overflow: hidden で固定高なので、メモ一覧側で
// scroll container を作らないとアイテム展開時に内容がはみ出してスクロール
// 不可になる (`tlScroller` 系と同じパターン)。
.list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
  scrollbar-width: thin;
  -webkit-overflow-scrolling: touch;
}

.item {
  position: relative;
  border-bottom: 1px solid var(--nd-divider);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.015), rgba(255, 255, 255, 0.015));
  }
}

.itemNoteBtn {
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

.itemEditing {
  background: color-mix(in srgb, var(--nd-accent) 8%, transparent);

  &:hover {
    background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
  }
}

.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 8px 14px 0;
  font-size: 0.75em;
  opacity: 0.8;
}

.metaCtx {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.metaRef {
  font-family: var(--nd-font-mono, monospace);
  opacity: 0.7;
}

.metaChannel {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.06));
}

.metaScheduled {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
}

</style>
