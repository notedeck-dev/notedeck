<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import type {
  NormalizedNote,
  NormalizedUser,
  NoteVisibility,
} from '@/adapters/types'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import MkNote from '@/components/common/MkNote.vue'
import ColumnTabs, { type ColumnTabDef } from '@/components/deck/ColumnTabs.vue'
import {
  deleteDraft,
  draftsVersion,
  loadAllDrafts,
  refreshDrafts,
  type StoredDraft,
} from '@/composables/useDrafts'
import { usePortal } from '@/composables/usePortal'
import { type Account, useAccountsStore } from '@/stores/accounts'
import { useConfirm } from '@/stores/confirm'
import { useServersStore } from '@/stores/servers'
import { useThemeStore } from '@/stores/theme'
import { useToast } from '@/stores/toast'
import {
  formatScheduleAbsolute,
  formatScheduleRelative,
  isPastSchedule,
} from '@/utils/scheduleFormat'

const props = defineProps<{
  accountId: string
  /** Misskey 2025.10+ の `features.scheduledNotes` 判定結果。親から渡す。 */
  supportsScheduledNotes?: boolean
}>()

const emit = defineEmits<{
  pick: [key: string, draft: StoredDraft]
  close: []
}>()

const activeTab = ref<string>('drafts')
const bodyRef = ref<HTMLElement | null>(null)

const accountsStore = useAccountsStore()
const serversStore = useServersStore()
const themeStore = useThemeStore()
const { confirm } = useConfirm()
const toast = useToast()

const account = computed<Account | undefined>(() =>
  accountsStore.accounts.find((a) => a.id === props.accountId),
)

/** 空状態に出すサーバー側の案内画像（infoImageUrl） */
const serverInfoImage = computed(() => {
  const host = account.value?.host
  return host ? serversStore.servers.get(host)?.infoImageUrl : undefined
})

/** Per-account custom server theme so the picker matches the post form. */
const themeVars = computed(() =>
  themeStore.getStyleVarsForAccount(props.accountId),
)

interface DraftContext {
  kind: 'reply' | 'renote' | 'note' | 'channel-note'
  channelId: string | null
  refId: string | null
}

interface DraftEntry {
  key: string
  draft: StoredDraft
  context: DraftContext
  note: NormalizedNote
}

function contextOf(stored: StoredDraft): DraftContext {
  if (stored.replyId) {
    return { kind: 'reply', channelId: null, refId: stored.replyId }
  }
  if (stored.renoteId) {
    return { kind: 'renote', channelId: null, refId: stored.renoteId }
  }
  if (stored.channelId) {
    return {
      kind: 'channel-note',
      channelId: stored.channelId,
      refId: null,
    }
  }
  return { kind: 'note', channelId: null, refId: null }
}

function userFromAccount(acc: Account): NormalizedUser {
  return {
    id: acc.userId,
    username: acc.username,
    host: null,
    name: acc.displayName ?? null,
    avatarUrl: acc.avatarUrl ?? null,
  }
}

function toPreviewNote(acc: Account, stored: StoredDraft): NormalizedNote {
  const d = stored.data
  return {
    id: `draft:${acc.id}:${stored.id}`,
    _accountId: acc.id,
    _serverHost: acc.host,
    createdAt: stored.updatedAt,
    text: d.text || null,
    cw: d.showCw && d.cw ? d.cw : null,
    user: userFromAccount(acc),
    visibility: d.visibility as NoteVisibility,
    emojis: {},
    reactionEmojis: {},
    reactions: {},
    renoteCount: 0,
    repliesCount: 0,
    files: [],
    localOnly: d.localOnly,
    replyId: stored.replyId,
    renoteId: stored.renoteId,
    channelId: stored.channelId,
  }
}

const loaded = ref(false)

watch(
  () => props.accountId,
  async (id) => {
    loaded.value = false
    await refreshDrafts(id)
    loaded.value = true
  },
  { immediate: true },
)

const allEntries = computed<DraftEntry[]>(() => {
  void draftsVersion.value
  if (!loaded.value || !account.value) return []
  const map = loadAllDrafts(props.accountId)
  const acc = account.value
  const out: DraftEntry[] = []
  for (const stored of Object.values(map)) {
    const ctx = contextOf(stored)
    out.push({
      key: stored.id,
      draft: stored,
      context: ctx,
      note: toPreviewNote(acc, stored),
    })
  }
  return out
})

// 予約投稿の判定は scheduledAt 有無のみで行う。isActuallyScheduled は
// サーバー（特にフォーク）が list のレスポンスに含めないことがあり、
// そのフィールドを頼るとタブ間でアイテムが消失する。
const regularEntries = computed<DraftEntry[]>(() =>
  allEntries.value
    .filter((e) => e.draft.data.scheduledAt == null)
    .sort((a, b) => b.draft.updatedAt.localeCompare(a.draft.updatedAt)),
)

const scheduledEntries = computed<DraftEntry[]>(() =>
  allEntries.value
    .filter((e) => e.draft.data.scheduledAt != null)
    .sort((a, b) =>
      (a.draft.data.scheduledAt ?? '').localeCompare(
        b.draft.data.scheduledAt ?? '',
      ),
    ),
)

const entries = computed<DraftEntry[]>(() =>
  activeTab.value === 'scheduled'
    ? scheduledEntries.value
    : regularEntries.value,
)

const regularCount = computed(() => regularEntries.value.length)
const scheduledCount = computed(() => scheduledEntries.value.length)

// 予約タブは非対応サーバーでも既存 draft が残っている限り見せる（誤って
// 作成された予約を取消できるようにするため）。新規作成はフォームの日時
// ピッカーが出ないので自然に塞がる。
const showScheduledTab = computed(
  () => props.supportsScheduledNotes === true || scheduledCount.value > 0,
)

// supportsScheduledNotes が false になった / 予約が0件になったら drafts に戻す
watch([showScheduledTab, scheduledCount], () => {
  if (activeTab.value === 'scheduled' && !showScheduledTab.value) {
    activeTab.value = 'drafts'
  }
})

const tabs = computed<ColumnTabDef[]>(() => {
  const out: ColumnTabDef[] = [
    {
      value: 'drafts',
      label: regularCount.value ? `下書き ${regularCount.value}` : '下書き',
      icon: 'notes',
    },
  ]
  if (showScheduledTab.value) {
    out.push({
      value: 'scheduled',
      label: scheduledCount.value ? `予約 ${scheduledCount.value}` : '予約',
      icon: 'calendar-time',
    })
  }
  return out
})

// 予約タブを見ている間だけ "あと30分" 等の相対時刻をリアクティブ更新する。
// onCleanup が前回タイマーを必ず止めるので、アンマウント時も漏れない。
const nowMs = ref(Date.now())
watch(
  activeTab,
  (t, _, onCleanup) => {
    if (t !== 'scheduled') return
    nowMs.value = Date.now()
    const tm = setInterval(() => (nowMs.value = Date.now()), 30_000)
    onCleanup(() => clearInterval(tm))
  },
  { immediate: true },
)

function contextLabel(ctx: DraftContext): string {
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

function contextIcon(ctx: DraftContext): string {
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

function onPick(entry: DraftEntry) {
  emit('pick', entry.key, entry.draft)
}

// --- Custom right-click menu (overrides MkNote's default NoteMoreMenu) ---
const menuState = ref<{
  x: number
  y: number
  entry: DraftEntry
} | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuPortalRef = useTemplateRef<HTMLElement>('menuPortalRef')
usePortal(menuPortalRef)

function onContextMenu(e: MouseEvent, entry: DraftEntry) {
  e.preventDefault()
  e.stopPropagation()
  menuState.value = { x: e.clientX, y: e.clientY, entry }
  void nextTick(() => {
    const el = menuRef.value
    if (!el || !menuState.value) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const nx = Math.min(menuState.value.x, vw - rect.width - 4)
    const ny = Math.min(menuState.value.y, vh - rect.height - 4)
    menuState.value = { x: nx, y: ny, entry: menuState.value.entry }
  })
}

function closeMenu() {
  menuState.value = null
}

async function onDelete(entry: DraftEntry) {
  const isScheduled = entry.draft.data.scheduledAt != null
  const ok = await confirm({
    title: isScheduled ? '予約投稿を取消' : '下書きを削除',
    message: isScheduled
      ? '選択した予約投稿を取消しますか？'
      : '選択した下書きを削除しますか？',
    okLabel: isScheduled ? '取消' : '削除',
    type: 'danger',
  })
  if (!ok) return
  try {
    await deleteDraft(props.accountId, entry.key)
    toast.show(
      isScheduled ? '予約投稿を取消しました' : '下書きを削除しました',
      'info',
    )
  } catch (e) {
    toast.show(
      `${isScheduled ? '取消' : '削除'}に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      'error',
    )
  }
}

async function onDeleteAll() {
  if (regularCount.value === 0) return
  const ok = await confirm({
    title: 'すべての下書きを削除',
    message: `下書き ${regularCount.value} 件をすべて削除しますか？（予約投稿は対象外）`,
    okLabel: 'すべて削除',
    type: 'danger',
  })
  if (!ok) return
  try {
    // 予約投稿を誤って巻き込まないよう、下書きタブのエントリだけを個別削除
    await Promise.allSettled(
      regularEntries.value.map((e) => deleteDraft(props.accountId, e.key)),
    )
    toast.show('下書きをすべて削除しました', 'info')
  } catch (e) {
    toast.show(
      `削除に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
      'error',
    )
  }
}
</script>

<template>
  <div :class="$style.draftsPicker" :style="themeVars" @click.stop>
    <!-- Tabs: 既存カラム/ウィンドウのタブと同一 UX。横スクロール + 横スワイプ対応 -->
    <ColumnTabs
      v-model="activeTab"
      :tabs="tabs"
      :swipe-target="bodyRef"
      scrollable
    >
      <template #trailing>
        <div :class="$style.trailingBtns">
          <button
            v-if="activeTab === 'drafts' && regularCount > 0"
            class="_button"
            :class="$style.dpHeaderBtn"
            title="下書きをすべて削除"
            @click="onDeleteAll"
          >
            <i class="ti ti-trash" />
          </button>
          <button
            class="_button"
            :class="$style.dpHeaderBtn"
            title="閉じる"
            @click="emit('close')"
          >
            <i class="ti ti-x" />
          </button>
        </div>
      </template>
    </ColumnTabs>

    <!-- Body -->
    <div ref="bodyRef" :class="$style.dpBody">
      <div v-if="!loaded" :class="$style.dpEmpty">読み込み中...</div>
      <ColumnEmptyState
        v-else-if="entries.length === 0"
        :message="activeTab === 'scheduled' ? '予約投稿はありません' : '下書きはありません'"
        :image-url="serverInfoImage"
      />
      <div v-else :class="$style.dpList">
        <div
          v-for="entry in entries"
          :key="entry.key"
          :class="$style.item"
          @contextmenu.capture="onContextMenu($event, entry)"
        >
          <div
            v-if="contextLabel(entry.context)"
            :class="$style.meta"
          >
            <span :class="$style.metaCtx">
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
          </div>
          <!-- capture-phase click: MkNote 内部の navigateToDetail (合成IDなので
               404 になる) より先に拾って投稿フォーム復元に振り替える。 -->
          <div
            :class="$style.itemNoteBtn"
            role="button"
            tabindex="0"
            title="この下書きを復元"
            @click.capture.prevent.stop="onPick(entry)"
            @keydown.enter="onPick(entry)"
          >
            <MkNote :note="entry.note" embedded />
            <span
              v-if="entry.draft.data.scheduledAt"
              :class="[
                $style.scheduledBadge,
                isPastSchedule(entry.draft.data.scheduledAt, nowMs) &&
                  $style.scheduledBadgePast,
              ]"
              :title="formatScheduleAbsolute(entry.draft.data.scheduledAt, nowMs)"
            >
              <i class="ti ti-clock" />
              <span :class="$style.scheduledBadgeRel">
                {{ formatScheduleRelative(entry.draft.data.scheduledAt, nowMs) }}
              </span>
              <span :class="$style.scheduledBadgeAbs">
                {{ formatScheduleAbsolute(entry.draft.data.scheduledAt, nowMs) }}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>

  </div>

  <!-- Context menu (usePortal moves the backdrop to <body> to escape contain/overflow) -->
  <div
    v-if="menuState"
    ref="menuPortalRef"
    :class="$style.menuBackdrop"
    :style="themeVars"
    @click="closeMenu"
    @contextmenu.prevent="closeMenu"
  >
    <div
      ref="menuRef"
      class="_popup"
      :class="$style.menu"
      :style="{ top: `${menuState.y}px`, left: `${menuState.x}px` }"
      @click.stop
      @contextmenu.stop.prevent
    >
      <button
        class="_button"
        :class="$style.menuItem"
        @click="onPick(menuState.entry); closeMenu()"
      >
        <i :class="menuState.entry.draft.data.scheduledAt ? 'ti ti-pencil' : 'ti ti-arrow-back-up'" />
        {{ menuState.entry.draft.data.scheduledAt ? '内容・時刻を編集' : '復元して投稿フォームに反映' }}
      </button>
      <div :class="$style.menuDivider" />
      <button
        class="_button"
        :class="[$style.menuItem, $style.menuItemDanger]"
        @click="onDelete(menuState.entry); closeMenu()"
      >
        <i class="ti ti-trash" />
        {{ menuState.entry.draft.data.scheduledAt ? '予約を取消' : '削除' }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
.draftsPicker {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 520px;
  max-height: min(75vh, 640px);
  margin: 0 16px 16px;
  background: var(--nd-panelBg, var(--nd-popup));
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px var(--nd-shadow);
}

.trailingBtns {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding-right: 8px;
}

.dpHeaderBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}

.dpBody {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.dpList {
  display: flex;
  flex-direction: column;
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
  font-weight: 600;
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

.itemNoteBtn {
  position: relative;
  display: block;
  width: 100%;
  text-align: left;
  cursor: pointer;
}

/* 予約時刻バッジ: ノートプレビュー内の右下に重ねる */
.scheduledBadge {
  position: absolute;
  right: 12px;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--nd-accent) 15%, transparent);
  color: var(--nd-accent);
  font-size: 0.85em;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  backdrop-filter: blur(8px);
}

.scheduledBadgeRel {
  font-weight: 700;
}

.scheduledBadgeAbs {
  opacity: 0.7;
  font-size: 0.9em;

  &::before {
    content: '·';
    margin-right: 4px;
    opacity: 0.7;
  }
}

.scheduledBadgePast {
  background: color-mix(in srgb, var(--nd-danger, #e64c4c) 18%, transparent);
  color: var(--nd-danger, #e64c4c);
}

.dpEmpty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 16px;
  text-align: center;
}

.menuBackdrop {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup);
}

.menu {
  position: fixed;
  min-width: 220px;
  padding: 6px;
  border-radius: 10px;
  background: var(--nd-popup);
  box-shadow: var(--nd-shadow-m);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menuItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  font-size: 0.88em;
  color: var(--nd-fg);
  border-radius: var(--nd-radius-sm);
  transition: background var(--nd-duration-base);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.06));
  }
}

.menuItemDanger {
  color: var(--nd-danger, #e64c4c);
}

.menuDivider {
  height: 1px;
  margin: 2px 6px;
  background: var(--nd-divider);
}
</style>
