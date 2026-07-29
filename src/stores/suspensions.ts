import { defineStore } from 'pinia'
import { shallowRef, triggerRef } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import { logWarn } from '@/utils/logger'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'
import { commands, unwrap } from '@/utils/tauriInvoke'

/** 1 リクエストで問い合わせる userId 数。users/show の userIds に上限は無いが
 *  応答が UserDetailed pack（pinnedNotes の packMany・ロールポリシー解決込み）
 *  でサーバー側コストが重いため、リクエスト数ではなく pack コストで律速する。 */
const PROBE_CHUNK = 50
/** 同一 id を再度問い合わせるまでの抑制時間 */
const PROBE_TTL_MS = 15 * 60_000
/** 供給元（ノート挿入・通知挿入）のバーストをまとめる */
const PROBE_DEBOUNCE_MS = 300
/** 再検証サイクルの周期 */
const REVERIFY_INTERVAL_MS = 15 * 60_000
/** 検知直後のこの期間は毎周期 due にする（解除の即応性） */
const REVERIFY_FRESH_MS = 24 * 60 * 60_000
/** 上記を過ぎた entry の再検証間隔 */
const REVERIFY_AGED_MS = 24 * 60 * 60_000
/** 集合がこれを超えたら 1 サイクルあたりのローテーションに切り替える */
const REVERIFY_ROTATION_THRESHOLD = 100
/** ローテーション時の 1 サイクル最大 chunk 数 */
const REVERIFY_MAX_CHUNKS = 2

const STORAGE_VERSION = 1

export interface SuspensionEntry {
  userId: string
  /** 検知した時刻 (epoch ms) */
  since: number
  /** 最後に再検証した時刻 (epoch ms) */
  lastVerified: number
}

interface StorageEnvelope {
  _v: number
  accounts: Record<string, SuspensionEntry[]>
}

function isEntry(v: unknown): v is SuspensionEntry {
  if (typeof v !== 'object' || v === null) return false
  const e = v as Record<string, unknown>
  return (
    typeof e.userId === 'string' &&
    typeof e.since === 'number' &&
    typeof e.lastVerified === 'number'
  )
}

function loadPersisted(): Map<string, Map<string, SuspensionEntry>> {
  const out = new Map<string, Map<string, SuspensionEntry>>()
  const raw = getStorageJson<unknown>(STORAGE_KEYS.suspensions, null)
  const envelope = raw as Partial<StorageEnvelope> | null
  if (
    !envelope ||
    envelope._v !== STORAGE_VERSION ||
    typeof envelope.accounts !== 'object' ||
    envelope.accounts === null
  ) {
    return out
  }
  for (const [accountId, entries] of Object.entries(envelope.accounts)) {
    if (!Array.isArray(entries)) continue
    const map = new Map<string, SuspensionEntry>()
    for (const e of entries) if (isEntry(e)) map.set(e.userId, e)
    if (map.size > 0) out.set(accountId, map)
  }
  return out
}

/**
 * サーバーで凍結（または削除）されたユーザーの per-account ストア（#828）。
 *
 * mutes と違い「自分の意思」ではなく**サーバー側の事実**なので相乗りさせない。
 * 表示述語 `useNoteVisibility().isHidden` の判定材料になり、集合が変われば
 * リロード無しで既存ノートが隠れる／復活する。SQLite キャッシュは触らない。
 *
 * 検知は `users/show({ userIds })` の 3 値判定:
 *   1. 応答から欠落 → 凍結（非モデレーターにはサーバーが isSuspended:false で絞る）
 *   2. `isSuspended === true` → 凍結（モデレーター経路）
 *   3. 返却され isSuspended ≠ true → 解除
 * 欠落は凍結・削除・不可視を区別しない。一覧面から隠すのは同原理で正しいため
 * 誤検知ではなく、開示 UI でも中立表現を使う。
 */
export const useSuspensionsStore = defineStore('suspensions', () => {
  const byAccount = shallowRef(loadPersisted())

  /** `${accountId}:${userId}` → 最後に問い合わせた時刻。TTL 抑制用 */
  const probedAt = new Map<string, number>()
  /** デバウンス待ちの問い合わせ対象 */
  const pending = new Map<string, Set<string>>()
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let reverifyTimer: ReturnType<typeof setInterval> | null = null
  let flushing = false

  function isSuspended(
    accountId: string | null | undefined,
    userId: string | null | undefined,
  ): boolean {
    if (!accountId || !userId) return false
    return byAccount.value.get(accountId)?.has(userId) ?? false
  }

  /** 凍結一覧 UI 用（#828 Step 1b）。検知が新しい順 */
  function entries(accountId: string): SuspensionEntry[] {
    const map = byAccount.value.get(accountId)
    if (!map) return []
    return [...map.values()].sort((a, b) => b.since - a.since)
  }

  function persist(): void {
    const accounts: Record<string, SuspensionEntry[]> = {}
    for (const [accountId, map] of byAccount.value) {
      if (map.size > 0) accounts[accountId] = [...map.values()]
    }
    try {
      setStorageJson(STORAGE_KEYS.suspensions, {
        _v: STORAGE_VERSION,
        accounts,
      } satisfies StorageEnvelope)
    } catch {
      // QuotaExceeded 等。永続化は諦めるがセッション内の判定は維持する
    }
  }

  /**
   * probe 結果の一括反映。差分がある場合のみ trigger する（無差分の再検証で
   * 全カラムの notes computed を無駄に再評価させない）。
   */
  function applyProbeResult(
    accountId: string,
    result: { suspended?: string[]; cleared?: string[] },
  ): void {
    const now = Date.now()
    let map = byAccount.value.get(accountId)
    let changed = false

    for (const userId of result.suspended ?? []) {
      if (!map) {
        map = new Map()
        byAccount.value.set(accountId, map)
      }
      const prev = map.get(userId)
      map.set(userId, {
        userId,
        since: prev?.since ?? now,
        lastVerified: now,
      })
      if (!prev) changed = true
    }

    for (const userId of result.cleared ?? []) {
      if (map?.delete(userId)) changed = true
    }

    if (!changed) {
      // 集合は同じでも lastVerified は進める（aging のため）。表示には
      // 影響しないので trigger も persist もしない
      return
    }
    triggerRef(byAccount)
    persist()
  }

  /** アカウント削除時に該当アカウントの検知結果を捨てる */
  function purgeAccount(accountId: string): void {
    if (!byAccount.value.delete(accountId)) return
    triggerRef(byAccount)
    persist()
  }

  // --- probe キュー ---

  function enqueue(
    accountId: string,
    userIds: Iterable<string>,
    force = false,
  ) {
    const now = Date.now()
    let set = pending.get(accountId)
    for (const userId of userIds) {
      const key = `${accountId}:${userId}`
      if (!force) {
        const last = probedAt.get(key)
        if (last != null && now - last < PROBE_TTL_MS) continue
      }
      if (!set) {
        set = new Set()
        pending.set(accountId, set)
      }
      set.add(userId)
    }
    if (pending.size === 0) return
    ensureReverifyTimer()
    if (debounceTimer) return
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void flush()
    }, PROBE_DEBOUNCE_MS)
  }

  /**
   * 表示に乗ったユーザーの凍結状態を問い合わせる。デバウンス + dedupe +
   * TTL 抑制 + chunk 分割 + 逐次実行で総量を制御する。
   */
  function probe(
    accountId: string | null | undefined,
    userIds: Iterable<string>,
  ): void {
    if (!accountId) return
    enqueue(accountId, userIds)
  }

  /** ノート列から distinct な当事者（投稿者 / reply 先 / renote 元）を probe する */
  function probeNotes(notes: Iterable<NormalizedNote>): void {
    const byAcc = new Map<string, Set<string>>()
    for (const note of notes) {
      const acc = note._accountId
      if (!acc) continue
      let set = byAcc.get(acc)
      if (!set) {
        set = new Set()
        byAcc.set(acc, set)
      }
      set.add(note.user.id)
      if (note.reply?.user?.id) set.add(note.reply.user.id)
      if (note.renote?.user?.id) set.add(note.renote.user.id)
    }
    for (const [accountId, ids] of byAcc) enqueue(accountId, ids)
  }

  async function probeChunk(accountId: string, chunk: string[]): Promise<void> {
    const now = Date.now()
    for (const userId of chunk) probedAt.set(`${accountId}:${userId}`, now)

    let raw: unknown
    try {
      raw = unwrap(
        await commands.apiGetUserRaw(accountId, { userIds: chunk }),
      ) as unknown
    } catch (e) {
      // I-4: 材料取得失敗は無更新（fail-open）
      logWarn('suspension-probe', e)
      return
    }
    if (!Array.isArray(raw)) return

    const returned = new Map<string, Record<string, unknown>>()
    for (const u of raw) {
      if (
        u &&
        typeof u === 'object' &&
        typeof (u as { id?: unknown }).id === 'string'
      ) {
        returned.set((u as { id: string }).id, u as Record<string, unknown>)
      }
    }

    const suspended: string[] = []
    const cleared: string[] = []
    for (const userId of chunk) {
      const user = returned.get(userId)
      if (!user || user.isSuspended === true) {
        suspended.push(userId)
      } else {
        cleared.push(userId)
      }
    }
    applyProbeResult(accountId, { suspended, cleared })
  }

  async function flush(): Promise<void> {
    if (flushing) return
    flushing = true
    try {
      while (pending.size > 0) {
        const [accountId, set] = [...pending.entries()][0] as [
          string,
          Set<string>,
        ]
        pending.delete(accountId)
        const ids = [...set]
        for (let i = 0; i < ids.length; i += PROBE_CHUNK) {
          await probeChunk(accountId, ids.slice(i, i + PROBE_CHUNK))
        }
      }
    } finally {
      flushing = false
    }
  }

  // --- 再検証サイクル ---

  function isDue(entry: SuspensionEntry, now: number): boolean {
    if (now - entry.since < REVERIFY_FRESH_MS) return true
    return now - entry.lastVerified >= REVERIFY_AGED_MS
  }

  /**
   * 凍結集合の解除検知は、カラム構成にも probe 発火にも依存させない。
   * 単一の周期タイマーが due な entry を選んで再検証する。
   */
  function reverifyTick(): void {
    const now = Date.now()
    for (const [accountId, map] of byAccount.value) {
      let due = [...map.values()].filter((e) => isDue(e, now))
      if (due.length === 0) continue
      if (map.size > REVERIFY_ROTATION_THRESHOLD) {
        due = due
          .sort((a, b) => a.lastVerified - b.lastVerified)
          .slice(0, PROBE_CHUNK * REVERIFY_MAX_CHUNKS)
      }
      // TTL 抑制を貫通させる（通常 probe には同梱しない）
      enqueue(
        accountId,
        due.map((e) => e.userId),
        true,
      )
    }
  }

  function ensureReverifyTimer(): void {
    if (reverifyTimer) return
    reverifyTimer = setInterval(reverifyTick, REVERIFY_INTERVAL_MS)
  }

  /** テスト用。周期タイマーを止める */
  function stopReverifyCycle(): void {
    if (!reverifyTimer) return
    clearInterval(reverifyTimer)
    reverifyTimer = null
  }

  if (byAccount.value.size > 0) ensureReverifyTimer()

  return {
    isSuspended,
    entries,
    applyProbeResult,
    probe,
    probeNotes,
    purgeAccount,
    reverifyTick,
    stopReverifyCycle,
  }
})
