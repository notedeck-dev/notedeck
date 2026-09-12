import { onMounted, type Ref, watch } from 'vue'
import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import { useMultiNoteCapture } from '@/composables/useMultiNoteCapture'
import {
  loadCachedTimeline,
  loadCachedTimelineBefore,
} from '@/composables/useNoteColumnCache'
import { useNoteList } from '@/composables/useNoteList'
import { useNoteScrollerRef } from '@/composables/useNoteScrollerRef'
import { variantKeyOf } from '@/services/noteKey'
import { useAccountsStore } from '@/stores/accounts'
import { useNoteStore } from '@/stores/notes'
import { useToast } from '@/stores/toast'
import { mapWithConcurrency } from '@/utils/concurrency'
import { AppError } from '@/utils/errors'
import { toggleReaction } from '@/utils/toggleReaction'
import { votePoll } from '@/utils/votePoll'
import { createWorkerClient } from '@/utils/workerClient'
import type { DedupResponse } from '@/workers/dedupWorker'

export interface CrossAccountNotesOptions {
  /** API call to fetch notes for one account */
  fetchNotes: (
    adapter: ServerAdapter,
    opts?: { untilId?: string },
  ) => Promise<NormalizedNote[]>

  /** Whether this is cross-account mode */
  isCrossAccount: () => boolean

  /**
   * Offline cache key (e.g. 'mentions' | 'specified')。指定すると、
   * ログイン中アカウントが無い（全員ログアウト）場合でも全アカウントの
   * SQLite キャッシュを読んで表示する。未指定なら従来通り live のみ。
   */
  cacheKey?: () => string | null

  /** Loading / error / scroller refs from useColumnSetup */
  isLoading: Ref<boolean>
  error: Ref<AppError | null>
  scroller: Ref<HTMLElement | null>
  onScrollReport: () => void
  closePostForm?: () => void
}

/** Promise.allSettled の結果からノートを集約 */
function collectFulfilled(
  results: PromiseSettledResult<NormalizedNote[]>[],
): NormalizedNote[] {
  const collected: NormalizedNote[] = []
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      collected.push(...r.value)
    }
  }
  return collected
}

const dedupWorker = createWorkerClient<DedupResponse>(
  () =>
    new Worker(new URL('../workers/dedupWorker.ts', import.meta.url), {
      type: 'module',
    }),
)

/** メインスレッドフォールバック（Worker が CSP 等でブロックされた場合） */
function dedupMain(
  incoming: NormalizedNote[],
  existingKeys?: Set<string>,
): NormalizedNote[] {
  const seen = existingKeys ?? new Set<string>()
  return incoming
    .filter((n) => {
      const key = variantKeyOf(n)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 既存の行キー (取得元アカウント + note id、#1010) を除外し、createdAt降順でソート（Worker で実行、失敗時メインスレッド） */
function dedupAsync(
  incoming: NormalizedNote[],
  existingKeys?: Set<string>,
): Promise<NormalizedNote[]> {
  return dedupWorker
    .post({
      type: 'dedup',
      notes: incoming,
      existingKeys: existingKeys ? [...existingKeys] : null,
    })
    .then((res) => res.notes)
    .catch(() => dedupMain(incoming, existingKeys))
}

/**
 * 全アカウント面 (メンション / ダイレクト) の取得と束ね (#1058 P2a)。
 *
 * 列は `useNoteList` (行キーの順序配列 + noteStore) に載せ、`bundle` で同一
 * identity の variant を 1 行に畳む。これで楽観更新の patch・削除 tombstone・
 * 退避保護が per-account 面と同じ経路を通り、各アカウントの接続で Note
 * Capture するので他者のリアクションもライブで届く。
 */
export function useCrossAccountNotes(options: CrossAccountNotesOptions) {
  const {
    fetchNotes,
    isCrossAccount,
    cacheKey,
    isLoading,
    error,
    scroller,
    onScrollReport,
  } = options

  const accountsStore = useAccountsStore()
  const multiAdapters = useMultiAccountAdapters()
  const noteStore = useNoteStore()
  const toast = useToast()
  const { noteScrollerRef } = useNoteScrollerRef(scroller)

  const list = useNoteList({
    bundle: true,
    getAdapter: () => null,
    closePostForm: options.closePostForm ?? (() => undefined),
    deleteHandler: async (note) => {
      const adapter = await multiAdapters.getOrCreate(note._accountId)
      if (!adapter) return false
      try {
        await adapter.api.deleteNote(note.id)
        return true
      } catch {
        return false
      }
    },
  })
  const { notes, groups, rawNotes, setNotes, onNoteUpdate, removeNote } = list

  // 各アカウントの接続で variant を購読する (§6)。接続を持たないアカウントの
  // variant は購読しない
  const capture = useMultiNoteCapture(
    (accountId) => multiAdapters.getCached(accountId)?.stream,
    onNoteUpdate,
  )
  list.setOnNotesChanged((visible) => capture.sync(visible))

  function scrollToTop() {
    if (noteScrollerRef.value) {
      noteScrollerRef.value.scrollToIndex(0, {
        align: 'start',
        behavior: 'smooth',
      })
    } else {
      scroller.value?.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  /** 全アカウント（ログアウト済み含む）の SQLite キャッシュを読んで merge する */
  async function loadCrossAccountCache(): Promise<NormalizedNote[]> {
    const key = cacheKey?.()
    if (!key) return []
    const results = await mapWithConcurrency(
      accountsStore.accounts,
      async (acc) => {
        try {
          return await loadCachedTimeline(acc.id, key)
        } catch {
          return []
        }
      },
      3,
    )
    return dedupAsync(collectFulfilled(results))
  }

  async function connectCrossAccount() {
    error.value = null
    isLoading.value = true

    // オフラインファースト: キャッシュを即時表示（ログアウト中のアカウント分も含む）
    const cached = await loadCrossAccountCache()
    if (cached.length > 0) setNotes(cached)

    const accounts = accountsStore.accounts.filter((a) => a.hasToken)
    // 全アカウントがログアウト中なら live fetch せずキャッシュ表示のみ
    if (accounts.length === 0) {
      isLoading.value = false
      return
    }

    try {
      const results = await mapWithConcurrency(
        accounts,
        async (acc) => {
          const adapter = await multiAdapters.getOrCreate(acc.id)
          if (!adapter) return []
          // capture 用に接続を張る (既に接続済みなら no-op)
          adapter.stream.connect()
          return fetchNotes(adapter)
        },
        3,
      )

      // live を優先しつつキャッシュとマージ（dedup は先勝ち）
      setNotes(await dedupAsync([...collectFulfilled(results), ...cached]))
    } catch (e) {
      error.value = AppError.from(e)
    } finally {
      isLoading.value = false
    }
  }

  async function loadMoreCrossAccount() {
    if (isLoading.value || rawNotes.value.length === 0) return
    isLoading.value = true
    const key = cacheKey?.()

    try {
      // 全アカウントを対象（ログアウト中も含む）。ログイン中は live API で
      // untilId 遡り、ログアウト中は SQLite キャッシュを createdAt で遡る。
      const results = await mapWithConcurrency(
        accountsStore.accounts,
        async (acc) => {
          const lastForAccount = [...rawNotes.value]
            .reverse()
            .find((n) => n._accountId === acc.id)

          if (acc.hasToken) {
            const adapter = await multiAdapters.getOrCreate(acc.id)
            if (!adapter) return []
            if (!lastForAccount) return fetchNotes(adapter)
            return fetchNotes(adapter, { untilId: lastForAccount.id })
          }

          // ログアウト中: hasToken 不要でキャッシュを遡る。
          // createdAt / id は同一ノート (lastForAccount) からペアで渡す (§6-14)
          if (!key || !lastForAccount) return []
          try {
            return await loadCachedTimelineBefore(
              acc.id,
              key,
              lastForAccount.createdAt,
              lastForAccount.id,
            )
          } catch {
            return []
          }
        },
        3,
      )

      const existingKeys = new Set<string>(rawNotes.value.map(variantKeyOf))
      const newOlder = await dedupAsync(collectFulfilled(results), existingKeys)
      // 下方向のページングなので古い側を残す
      setNotes([...rawNotes.value, ...newOlder], 'newest')
    } catch (e) {
      error.value = AppError.from(e)
    } finally {
      isLoading.value = false
    }
  }

  function handleScroll() {
    onScrollReport()
  }

  /** 楽観更新の差分を、その variant を保持する noteStore へ差し替えで反映する */
  function applyPatch(
    note: NormalizedNote,
    compute: (current: NormalizedNote) => Partial<NormalizedNote>,
  ) {
    const key = variantKeyOf(note)
    const current = noteStore.get(key) ?? note
    noteStore.update(key, { ...current, ...compute(current) })
  }

  /**
   * 主ビューの variant に対してリアクションする (#1058 §5.6)。宛先はその variant の
   * 取得元アカウント。adapter 取得は非同期なので、連打の二重 create は
   * toggleReaction 側の in-flight ガードで塞ぐ。
   */
  async function react(reaction: string, note: NormalizedNote) {
    const adapter = await multiAdapters.getOrCreate(note._accountId)
    if (!adapter) return
    try {
      await toggleReaction(adapter.api, note, reaction, (compute) =>
        applyPatch(note, compute),
      )
    } catch (e) {
      const err = AppError.from(e)
      toast.show(`リアクションに失敗しました（${err.displayCode}）`, 'error')
    }
  }

  async function vote(choice: number, note: NormalizedNote) {
    const adapter = await multiAdapters.getOrCreate(note._accountId)
    if (!adapter) return
    try {
      await votePoll(adapter.api, note, choice, (compute) =>
        applyPatch(note, compute),
      )
    } catch (e) {
      const err = AppError.from(e)
      toast.show(`投票に失敗しました（${err.displayCode}）`, 'error')
    }
  }

  // アカウントの追加・削除で対象が変わったら取り直す
  watch(
    () => accountsStore.accounts.map((a) => `${a.id}:${a.hasToken}`).join(','),
    () => {
      if (isCrossAccount()) connectCrossAccount()
    },
  )

  onMounted(() => {
    if (isCrossAccount()) {
      connectCrossAccount()
    }
  })

  return {
    notes,
    groups,
    noteScrollerRef,
    scrollToTop,
    connectCrossAccount,
    loadMoreCrossAccount,
    handleScroll,
    removeNote,
    react,
    vote,
  }
}
