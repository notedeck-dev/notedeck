<script setup lang="ts">
import { json } from '@codemirror/lang-json'
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { StreamConnectionState } from '@/adapters/types'
import { COLUMN_ICONS, COLUMN_LABELS } from '@/columns/registry'
import ColumnBadges from '@/components/common/ColumnBadges.vue'
import ColumnEmptyState from '@/components/common/ColumnEmptyState.vue'
import { useColumnTheme } from '@/composables/useColumnTheme'
import { useServerImages } from '@/composables/useServerImages'
import { useVerticalResize } from '@/composables/useVerticalResize'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'
import { type DeckColumn as DeckColumnType, useDeckStore } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import {
  ALL_KINDS,
  KIND_LABELS,
  type StreamEventEntry,
  useStreamInspectorStore,
} from '@/stores/streamInspector'
import DeckColumn from './DeckColumn.vue'

const CodeEditor = defineAsyncComponent(
  () => import('./widgets/CodeEditor.vue'),
)

const props = defineProps<{
  column: DeckColumnType
}>()

const { account, columnThemeVars } = useColumnTheme(() => props.column)
const { serverInfoImageUrl } = useServerImages(() => props.column)
const serversStore = useServersStore()
const deckStore = useDeckStore()
const inspectorStore = useStreamInspectorStore()
const accountsStore = useAccountsStore()
const jsonLang = json()

const isScopedToAccount = computed(() => props.column.accountId != null)
const serverIconUrl = computed(() => {
  const acc = account.value
  if (!acc) return undefined
  return (
    serversStore.getServer(acc.host)?.iconUrl ??
    `https://${acc.host}/favicon.ico`
  )
})

// --- Per-column UI state ---
const paused = ref(false)
const selectedId = ref<number | null>(null)
const enabledKinds = ref(new Set<string>(ALL_KINDS))
const clearedBefore = ref(0)
/** ダッシュボードで有効化中のカラム subscriptionId 集合。空 = 全カラム表示（複数同時可） */
const focusedSubIds = ref(new Set<string>())

const filteredBuffer = computed(() => {
  const aid = props.column.accountId
  const subs = focusedSubIds.value
  return inspectorStore.buffer.filter((e) => {
    if (e.ts < clearedBefore.value) return false
    if (!enabledKinds.value.has(e.kind)) return false
    if (aid != null && e.accountId !== aid) return false
    if (subs.size > 0 && !subs.has(e.payload.subscriptionId as string))
      return false
    return true
  })
})

/** カラムマーククリックで有効/無効をトグル（複数同時に有効化できる。kind ピルと同様） */
function onMarkClick(subId: string | null) {
  if (!subId) return
  const next = new Set(focusedSubIds.value)
  if (next.has(subId)) next.delete(subId)
  else next.add(subId)
  focusedSubIds.value = next
}

// Freeze display when paused
const displayBuffer = shallowRef<StreamEventEntry[]>([])
watch(
  filteredBuffer,
  (buf) => {
    if (!paused.value) displayBuffer.value = buf
  },
  { immediate: true },
)

const selectedEntry = computed(() => {
  if (selectedId.value == null) return null
  return displayBuffer.value.find((e) => e.id === selectedId.value) ?? null
})

const selectedJson = computed(() => {
  if (!selectedEntry.value) return ''
  return JSON.stringify(
    { kind: selectedEntry.value.kind, payload: selectedEntry.value.payload },
    null,
    2,
  )
})

function toggleKind(kind: string) {
  const s = new Set(enabledKinds.value)
  if (s.has(kind)) s.delete(kind)
  else s.add(kind)
  enabledKinds.value = s
}

function selectRow(id: number) {
  selectedId.value = id
}

function clearBuffer() {
  clearedBefore.value = Date.now()
  selectedId.value = null
}

// --- Status dashboard ---

// 1s tick で「最終受信からの経過」をライブ更新する
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  nowTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer)
})

function hostOf(accountId: string | null): string {
  if (!accountId) return '—'
  return (
    accountsStore.accounts.find((a) => a.id === accountId)?.host ?? accountId
  )
}

/** account_id -> 最新イベント ts（buffer は新しい順なので最初に見た値が最新） */
const lastEventTsByAccount = computed(() => {
  const m = new Map<string, number>()
  for (const e of inspectorStore.buffer) {
    if (!m.has(e.accountId)) m.set(e.accountId, e.ts)
  }
  return m
})

function connToStatus(
  c: StreamConnectionState | null,
): 'online' | 'active' | 'offline' | 'unknown' | null {
  switch (c) {
    case 'connected':
      return 'online'
    case 'reconnecting':
      return 'unknown'
    case 'disconnected':
      return 'offline'
    default:
      return null
  }
}

// ボトムバーと同じ並び (deckStore.layout 順) で回す。layout に無いカラム
// (削除済み / 別プロファイル) は自動的に外れるので残留しない。runtimeStates を
// 持つ = stream 系カラムのみが対象。すべて reactive に追従する。
const dashboardRows = computed(() => {
  const aid = props.column.accountId
  return deckStore.layout.flat().flatMap((colId) => {
    const info = inspectorStore.runtimeStates.get(colId)
    if (!info) return []
    if (aid != null && info.accountId !== aid) return []
    const connection = info.accountId
      ? (inspectorStore.connectionState.get(info.accountId) ?? null)
      : null
    return [
      {
        columnId: info.columnId,
        accountId: info.accountId,
        subscriptionId: info.subscriptionId,
        host: hostOf(info.accountId),
        onlineStatus: connToStatus(connection),
        typeLabel: COLUMN_LABELS[info.columnType] ?? info.columnType,
        typeIcon: COLUMN_ICONS[info.columnType] ?? 'circle',
        state: info.state,
        lastEventTs: info.accountId
          ? (lastEventTsByAccount.value.get(info.accountId) ?? null)
          : null,
      },
    ]
  })
})

function ageText(ts: number | null): string {
  if (ts == null) return '—'
  const s = Math.max(0, Math.round((now.value - ts) / 1000))
  return `${s}s`
}

// --- Display helpers ---

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace('stream-', '')
}

function summarize(entry: StreamEventEntry): string {
  const p = entry.payload
  if (p.note && typeof p.note === 'object') {
    const note = p.note as Record<string, unknown>
    const user = note.user as Record<string, unknown> | undefined
    const name = user?.username ?? '?'
    const text = typeof note.text === 'string' ? note.text.slice(0, 40) : ''
    return `@${name}: ${text}`
  }
  if (p.notification && typeof p.notification === 'object') {
    const n = p.notification as Record<string, unknown>
    return `${n.type ?? 'notification'}`
  }
  if (p.eventType) return String(p.eventType)
  if (p.message && typeof p.message === 'object') return 'chat message'
  return ''
}

// --- Detail pane resize ---

const wrapperRef = ref<HTMLElement | null>(null)
const { value: detailHeight, start: onDividerPointerDown } = useVerticalResize({
  containerRef: wrapperRef,
  mode: 'bottom-px',
  initial: 350,
  min: 60,
  topMargin: 80,
})

function scrollToTop() {
  // No-op for now; list is auto-scrolled
}

function onServerIconError(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.src.endsWith('/activitypub-icon.svg')) return
  img.src = '/activitypub-icon.svg'
}

// WebView2 (Windows) で Shift+wheel が cm-scroller の横スクロールに
// 渡らないケースがあるため、detail 全体で wheel を補足して横スクロールに変換する。
function onDetailWheel(e: WheelEvent) {
  const target = e.currentTarget as HTMLElement
  const scroller = target.querySelector<HTMLElement>('.cm-scroller')
  if (!scroller) return
  if (!e.shiftKey && e.deltaX === 0) return
  const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY
  if (delta === 0) return
  const max = scroller.scrollWidth - scroller.clientWidth
  if (max <= 0) return
  const before = scroller.scrollLeft
  const next = Math.max(0, Math.min(max, before + delta))
  if (next === before) return
  scroller.scrollLeft = next
  e.preventDefault()
}
</script>

<template>
  <DeckColumn
    :column-id="column.id"
    :title="column.name ?? 'ストリーム'"
    :theme-vars="columnThemeVars"
    @header-click="scrollToTop"
  >
    <template #header-icon>
      <i class="ti ti-activity-heartbeat" :class="$style.headerIcon" />
    </template>

    <template #header-meta>
      <button
        class="_button"
        :class="[$style.headerBtn, paused && $style.headerBtnActive]"
        :title="paused ? '再開' : '一時停止'"
        @click.stop="paused = !paused"
      >
        <i :class="paused ? 'ti ti-player-play' : 'ti ti-player-pause'" />
      </button>
      <button
        class="_button"
        :class="$style.headerBtn"
        title="クリア"
        @click.stop="clearBuffer()"
      >
        <i class="ti ti-trash" />
      </button>
      <div v-if="isScopedToAccount && account" :class="$style.headerAccount">
        <img :src="getAccountAvatarUrl(account)" :class="$style.headerAvatar" />
        <img :class="$style.headerFavicon" :src="serverIconUrl" :title="account.host" />
      </div>
    </template>

    <div ref="wrapperRef" :class="$style.wrapper">
      <!-- Status dashboard: kept-alive stream columns -->
      <div v-if="dashboardRows.length > 0" :class="$style.dashboard">
        <button
          v-for="row in dashboardRows"
          :key="row.columnId"
          type="button"
          class="_button"
          :class="[
            $style.mark,
            {
              [$style.markDim]: row.state !== 'live',
              [$style.markActive]:
                !!row.subscriptionId && focusedSubIds.has(row.subscriptionId),
            },
          ]"
          :title="`${row.host} · ${row.typeLabel} · ${row.state} · ${ageText(
            row.lastEventTs,
          )}`"
          @click="onMarkClick(row.subscriptionId)"
        >
          <i :class="['ti', `ti-${row.typeIcon}`, $style.markIcon]" />
          <ColumnBadges :account-id="row.accountId" :size="12" />
          <span
            v-if="row.onlineStatus"
            :class="[$style.connDot, $style[`conn_${row.onlineStatus}`]]"
          />
        </button>
      </div>

      <!-- Filter pills -->
      <div :class="$style.filters">
        <button
          v-for="kind in ALL_KINDS"
          :key="kind"
          class="_button"
          :class="[$style.pill, enabledKinds.has(kind) && $style.pillActive]"
          @click="toggleKind(kind)"
        >
          {{ KIND_LABELS[kind] ?? kind }}
        </button>
      </div>

      <!-- Event list -->
      <div :class="$style.list">
        <div
          v-for="entry in displayBuffer"
          :key="entry.id"
          :class="[$style.row, selectedId === entry.id && $style.rowSelected]"
          @click="selectRow(entry.id)"
        >
          <span :class="$style.rowTime">{{ formatTime(entry.ts) }}</span>
          <span :class="$style.rowKind">{{ kindLabel(entry.kind) }}</span>
          <span :class="$style.rowBadges">
            <template v-if="!isScopedToAccount">
              <img v-if="entry.observer.avatar" :src="entry.observer.avatar" :class="$style.badge" />
              <img
                v-if="entry.observer.serverIcon"
                :src="entry.observer.serverIcon"
                :class="$style.badge"
                @error="onServerIconError"
              />
              <template v-if="entry.subject">
                <span :class="$style.badgeArrow">→</span>
              </template>
            </template>
            <template v-if="entry.subject">
              <img v-if="entry.subject.avatar" :src="entry.subject.avatar" :class="$style.badge" />
              <img
                v-if="entry.subject.serverIcon"
                :src="entry.subject.serverIcon"
                :class="$style.badge"
                @error="onServerIconError"
              />
            </template>
          </span>
          <span :class="$style.rowSummary">{{ summarize(entry) }}</span>
        </div>
        <ColumnEmptyState
          v-if="displayBuffer.length === 0"
          message="イベント待機中..."
          :image-url="serverInfoImageUrl"
        />
      </div>

      <!-- Resize handle + Detail pane -->
      <div v-if="selectedEntry" :class="$style.divider" @pointerdown="onDividerPointerDown" />
      <div
        v-if="selectedEntry"
        :class="$style.detail"
        :style="{ height: detailHeight + 'px' }"
        @wheel="onDetailWheel"
      >
        <div :class="$style.detailHeader">
          <span :class="$style.detailTitle">{{ kindLabel(selectedEntry.kind) }}</span>
          <span :class="$style.detailTime">{{ formatTime(selectedEntry.ts) }}</span>
        </div>
        <CodeEditor
          :model-value="selectedJson"
          :language="jsonLang"
          :read-only="true"
          :auto-height="true"
          :class="$style.editor"
        />
      </div>
    </div>
  </DeckColumn>
</template>

<style module lang="scss">
@use './column-common.module.scss';

.headerIcon {
  font-size: 1em;
}

.headerBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.6;
  transition:
    background var(--nd-duration-fast),
    opacity var(--nd-duration-fast);

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.headerBtnActive {
  color: var(--nd-accent);
  opacity: 1;
}

.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.dashboard {
  // ボトムバーのタブ同様、少数時は中央寄せ・多数時は横スクロール
  // (scrollbar は隠す)。corner badge が上下にはみ出すぶん padding で逃がす。
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 12px;
  border-bottom: 1px solid var(--nd-divider);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.mark {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.85;
  cursor: pointer;
  --column-badge-border: var(--nd-bg);
  transition:
    opacity var(--nd-duration-fast),
    color var(--nd-duration-fast),
    background var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.markActive {
  opacity: 1;
  color: var(--nd-accent);
  background: var(--nd-buttonHoverBg);
}

.markDim {
  opacity: 0.35;
}

.markIcon {
  font-size: 19px;
}

.connDot {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--nd-bg);
  box-sizing: border-box;
}

.conn_online {
  background: var(--nd-statusOnline);
}

.conn_active {
  background: var(--nd-statusActive);
}

.conn_unknown {
  background: var(--nd-statusUnknown);
}

.conn_offline {
  background: var(--nd-statusOffline);
}

.filters {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--nd-divider);
  flex-wrap: wrap;
  flex-shrink: 0;
}

.pill {
  padding: 2px 8px;
  font-size: 0.7em;
  border-radius: 10px;
  border: 1px solid var(--nd-divider);
  color: var(--nd-fg);
  opacity: 0.5;
  transition:
    opacity var(--nd-duration-fast),
    border-color var(--nd-duration-fast);

  &:hover {
    opacity: 0.8;
  }
}

.pillActive {
  opacity: 1;
  border-color: var(--nd-accent);
  color: var(--nd-accent);
}

.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.row {
  display: flex;
  gap: 8px;
  padding: 3px 8px;
  font-size: 0.72em;
  font-family: 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  white-space: nowrap;
  min-width: max-content;
  transition: background var(--nd-duration-fast);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.rowSelected {
  background: rgba(var(--nd-accentRgb, 100, 150, 255), 0.15);
  border-bottom-color: var(--nd-divider);
}

.rowTime {
  color: var(--nd-fg);
  opacity: 0.5;
  flex-shrink: 0;
}

.rowKind {
  color: var(--nd-accent);
  flex-shrink: 0;
}

.rowBadges {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.badge {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  object-fit: cover;
}

.badgeArrow {
  font-size: 0.8em;
  opacity: 0.4;
  margin: 0 1px;
}

.rowSummary {
  color: var(--nd-fg);
  opacity: 0.7;
  white-space: nowrap;
}


.divider {
  height: 5px;
  flex-shrink: 0;
  cursor: row-resize;
  background: var(--nd-divider);
  transition: background var(--nd-duration-fast);

  &:hover,
  &:active {
    background: var(--nd-accent);
  }
}

.detail {
  flex-shrink: 0;
  overflow: auto;
}

.detailHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 0.75em;
  border-bottom: 1px solid var(--nd-divider);
}

.detailTitle {
  font-weight: bold;
  color: var(--nd-accent);
}

.detailTime {
  color: var(--nd-fg);
  opacity: 0.5;
  margin-left: auto;
}

.editor {
  height: auto;
}
</style>
