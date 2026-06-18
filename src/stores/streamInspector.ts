import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { initAdapterFor } from '@/adapters/factory'
import type { RawStreamEvent, StreamConnectionState } from '@/adapters/types'
import { getAccountAvatarUrl, useAccountsStore } from '@/stores/accounts'
import { useDeckStore } from '@/stores/deck'
import { useServersStore } from '@/stores/servers'
import { proxyThumbUrl } from '@/utils/imageProxy'

interface BadgePair {
  avatar: string | null
  serverIcon: string | null
}

export interface StreamEventEntry {
  id: number
  ts: number
  kind: string
  accountId: string
  observer: BadgePair
  subject: BadgePair | null
  payload: Record<string, unknown>
}

const MAX_BUFFER = 500
/** 古い entry は payload を抱えたままメモリに残るため、時間経過で自動退避する */
const ENTRY_TTL_MS = 5 * 60 * 1000
/** 定期的に古い entry を削るためのインターバル（TTL 到達後の即時 GC 用） */
const PRUNE_INTERVAL_MS = 30 * 1000

export const ALL_KINDS = [
  'stream-note',
  'stream-notification',
  'stream-main-event',
  'stream-note-updated',
  'stream-mention',
  'stream-chat-message',
  'stream-status',
] as const

export const KIND_LABELS: Record<string, string> = {
  'stream-note': 'note',
  'stream-notification': 'notif',
  'stream-main-event': 'main',
  'stream-note-updated': 'updated',
  'stream-mention': 'mention',
  'stream-chat-message': 'chat',
  'stream-status': 'status',
}

/** カラム単位の runtime_state（フロントが意図した状態）スナップショット */
export interface ColumnRuntimeInfo {
  columnId: string
  accountId: string | null
  columnType: string
  /** 下流の channel subscription id (= stream event payload.subscriptionId)。未確定時 null */
  subscriptionId: string | null
  state: 'live' | 'warm' | 'suspended'
  ts: number
}

export const useStreamInspectorStore = defineStore('streamInspector', () => {
  const accountsStore = useAccountsStore()
  const serversStore = useServersStore()

  // --- Global buffer (all accounts) ---
  let nextId = 0
  const buffer = shallowRef<StreamEventEntry[]>([])

  // --- Dashboard state ---
  /** account_id -> 直近の WS 接続状態 (stream-status raw event 由来) */
  const connectionState = ref<Map<string, StreamConnectionState>>(new Map())
  /** column_id -> フロントが意図した runtime_state (keep-alive 中は live) */
  const runtimeStates = ref<Map<string, ColumnRuntimeInfo>>(new Map())

  // --- Dedup ---
  let lastEventKey = ''
  let lastEventTs = 0
  const DEDUP_WINDOW_MS = 50

  // --- Subscription management ---
  type CleanupFn = () => void
  const cleanups: CleanupFn[] = []
  const capturing = ref(false)
  let pruneTimer: ReturnType<typeof setInterval> | null = null

  /** TTL を超えた entry を落とす（破壊的に buffer.value を差し替え） */
  function pruneStaleEntries() {
    const cutoff = Date.now() - ENTRY_TTL_MS
    const arr = buffer.value
    if (arr.length === 0) return
    // biome-ignore lint/style/noNonNullAssertion: bounded by length check above
    if (arr[arr.length - 1]!.ts >= cutoff) return
    // buffer は新しい順なので末尾から削る
    let end = arr.length
    // biome-ignore lint/style/noNonNullAssertion: end > 0 ensures index valid
    while (end > 0 && arr[end - 1]!.ts < cutoff) end--
    buffer.value = end === 0 ? [] : arr.slice(0, end)
  }

  function extractSubject(p: Record<string, unknown>): BadgePair | null {
    const src =
      (p.note as Record<string, unknown> | undefined)?.user ??
      (p.notification as Record<string, unknown> | undefined)?.user ??
      null
    if (!src || typeof src !== 'object') return null
    const u = src as Record<string, unknown>
    const avatarUrl = typeof u.avatarUrl === 'string' ? u.avatarUrl : null
    const host = typeof u.host === 'string' ? u.host : null
    return {
      avatar: avatarUrl ? (proxyThumbUrl(avatarUrl, 28) ?? avatarUrl) : null,
      serverIcon: host
        ? (serversStore.getServer(host)?.iconUrl ??
          `https://${host}/favicon.ico`)
        : null,
    }
  }

  function makeRawHandler(observer: BadgePair, accountId: string) {
    return (event: RawStreamEvent) => {
      const now = Date.now()
      // 接続状態は dedup より前に拾う（buffer から落ちても dashboard には反映）
      if (event.kind === 'stream-status') {
        const state = event.payload.state as StreamConnectionState | undefined
        if (state) connectionState.value.set(accountId, state)
      }
      const key = `${event.kind}:${event.payload.subscriptionId ?? ''}:${accountId}`
      if (key === lastEventKey && now - lastEventTs < DEDUP_WINDOW_MS) return
      lastEventKey = key
      lastEventTs = now
      const entry: StreamEventEntry = {
        id: nextId++,
        ts: now,
        kind: event.kind,
        accountId,
        observer,
        subject: extractSubject(event.payload),
        payload: event.payload,
      }
      const cutoff = now - ENTRY_TTL_MS
      const prev = buffer.value
      // buffer は新しい順。末尾から TTL 切れを削る
      let end = prev.length
      // biome-ignore lint/style/noNonNullAssertion: end > 0 ensures index valid
      while (end > 0 && prev[end - 1]!.ts < cutoff) end--
      const arr =
        end === prev.length ? [entry, ...prev] : [entry, ...prev.slice(0, end)]
      if (arr.length > MAX_BUFFER) arr.length = MAX_BUFFER
      buffer.value = arr
    }
  }

  async function subscribeAll() {
    for (const fn of cleanups) fn()
    cleanups.length = 0
    if (pruneTimer == null) {
      pruneTimer = setInterval(pruneStaleEntries, PRUNE_INTERVAL_MS)
    }

    const accounts = accountsStore.accounts.filter((a) => a.hasToken)
    for (const acc of accounts) {
      const { adapter } = await initAdapterFor(acc.host, acc.id)
      const observerBadge: BadgePair = {
        avatar:
          proxyThumbUrl(getAccountAvatarUrl(acc), 28) ??
          getAccountAvatarUrl(acc),
        serverIcon:
          serversStore.getServer(acc.host)?.iconUrl ??
          `https://${acc.host}/favicon.ico`,
      }
      const handler = makeRawHandler(observerBadge, acc.id)
      adapter.stream.onRawEvent(handler)
      cleanups.push(() => adapter.stream.offRawEvent(handler))
    }
  }

  function unsubscribeAll() {
    for (const fn of cleanups) fn()
    cleanups.length = 0
    if (pruneTimer != null) {
      clearInterval(pruneTimer)
      pruneTimer = null
    }
  }

  /**
   * Watch deck columns for streamInspector existence.
   * Call once from an always-mounted component (e.g. DeckLayout).
   */
  function startWatching() {
    const deckStore = useDeckStore()

    const hasInspector = computed(() =>
      deckStore.columns.some((c) => c.type === 'streamInspector'),
    )

    // Start/stop capture based on column existence
    watch(
      hasInspector,
      (has) => {
        if (has && !capturing.value) {
          capturing.value = true
          subscribeAll()
        } else if (!has && capturing.value) {
          capturing.value = false
          unsubscribeAll()
          connectionState.value = new Map()
        }
      },
      { immediate: true },
    )

    // Re-subscribe when accounts change (while capturing)
    watch(
      () => accountsStore.accounts.length,
      () => {
        if (capturing.value) subscribeAll()
      },
    )
  }

  /** 各カラムの runtime_state を Inspector に通知する (useColumnSetup から呼ぶ) */
  function reportRuntimeState(info: ColumnRuntimeInfo) {
    runtimeStates.value.set(info.columnId, info)
  }

  return {
    buffer,
    connectionState,
    runtimeStates,
    capturing,
    reportRuntimeState,
    startWatching,
  }
})
