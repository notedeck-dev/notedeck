<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import MemoCard from '@/components/common/MemoCard.vue'
import PopupMenu from '@/components/common/PopupMenu.vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import {
  deleteMemo,
  ensureMemosLoaded,
  loadAllMemos,
  memosVersion,
  type StoredMemo,
} from '@/composables/useMemos'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import type { DeckColumn as DeckColumnType } from '@/stores/deck'
import { useToast } from '@/stores/toast'
import { useWindowsStore } from '@/stores/windows'
import { formatScheduleAbsolute } from '@/utils/scheduleFormat'
import DeckColumn from './DeckColumn.vue'

const MkPostForm = defineAsyncComponent(
  () => import('@/components/common/MkPostForm.vue'),
)

const props = defineProps<{
  column: DeckColumnType
}>()

const accountsStore = useAccountsStore()
const windowsStore = useWindowsStore()
const { confirm } = useConfirm()
const toast = useToast()
const { columnThemeVars } = useColumnTheme(() => props.column)

/**
 * メモはアカウントに紐づかない (#1018)。サーバーへ送らずローカルで完結し、
 * 同じくアカウントなしの AI カラムからも参照されるため、カラム自体を
 * 「アカウントなし」種別にしてある。ここでのアカウントは「どのアカウントで
 * 書いたか」の記録で、投稿フォームの宛先を決めるのにだけ使う。
 */
const account = computed<Account | undefined>(
  () => accountsStore.activeAccount ?? accountsStore.accounts[0],
)

interface MemoContext {
  kind: 'reply' | 'renote' | 'note' | 'channel-note'
  channelId: string | null
  refId: string | null
}

interface MemoEntry {
  key: string
  memo: StoredMemo
  context: MemoContext
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

function buildEntry(key: string, memo: StoredMemo): MemoEntry {
  return {
    key,
    memo,
    context: parseMemoKey(key),
  }
}

const entries = computed<MemoEntry[]>(() => {
  void memosVersion.value
  if (!loaded.value) return []
  const out: MemoEntry[] = []
  for (const [key, memo] of Object.entries(loadAllMemos())) {
    out.push(buildEntry(key, memo))
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
  windowsStore.open('memoEditor', { memoKey: entry.key })
}

function onRestoreToForm(entry: MemoEntry) {
  closeMenu()
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

async function onDelete(entry: MemoEntry) {
  closeMenu()
  const ok = await confirm({
    title: 'メモを削除',
    message: '選択したメモを削除しますか？',
    okLabel: '削除',
    type: 'danger',
  })
  if (!ok) return
  deleteMemo(entry.key)
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
    </template>

    <!-- Embedded post form (memoMode: post = save as memo)。
         アカウントが 1 つも無くても書ける (#1018)。渡すアカウントは MFM 補完の
         ような表示上の文脈にだけ使われ、保存はローカルで完結する -->
    <div :class="$style.embeddedForm" data-memo-form>
      <MkPostForm
        :key="formMountKey"
        inline
        memo-mode
        :account-id="account?.id ?? ''"
        :initial-slot="editingMemo"
        :initial-slot-key="editingKey"
        @posted="onPosted"
      />
    </div>

    <!-- 空状態はアプリ既定のアイコン。サーバーの infoImageUrl は引かない
         (メモはアカウント / サーバーに紐づかない — #1018) -->
    <ColumnEmptyState
      v-if="loaded && memoCount === 0"
      message="メモはありません"
    />

    <div v-else :class="$style.list">
      <div
        v-for="entry in entries"
        :key="entry.key"
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

        <!-- bubble phase で受け、MemoCard 内部 button (`もっと見る` / CW /
             avatar) の `.stop` を活かす。MemoCard は MkNote と異なり
             合成 ID で users/show を叩く navigation を持たない。 -->
        <div
          :class="$style.itemNoteBtn"
          role="button"
          tabindex="0"
          title="このメモをエディタで開く"
          @click.stop="onOpenEditor(entry)"
          @keydown.enter="onOpenEditor(entry)"
        >
          <MemoCard :memo="entry.memo" />
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
  font-family: var(--nd-font-mono);
  opacity: 0.7;
}

.metaChannel {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: var(--nd-radius-full);
  background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.06));
}

.metaScheduled {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 6px;
  border-radius: var(--nd-radius-full);
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
}

</style>
