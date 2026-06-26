import { computed, onMounted, type Ref, shallowRef } from 'vue'
import type { NormalizedNote, ServerAdapter } from '@/adapters/types'
import { useMultiAccountAdapters } from '@/composables/useMultiAccountAdapters'
import {
  loadCachedTimeline,
  loadCachedTimelineBefore,
} from '@/composables/useNoteColumnCache'
import { useNoteScrollerRef } from '@/composables/useNoteScrollerRef'
import { useNoteVisibility } from '@/composables/useNoteVisibility'
import { useAccountsStore } from '@/stores/accounts'
import { useNoteStore } from '@/stores/notes'
import { mapWithConcurrency } from '@/utils/concurrency'
import { AppError } from '@/utils/errors'
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
  existingIds?: Set<string>,
): NormalizedNote[] {
  const seen = existingIds ?? new Set<string>()
  return incoming
    .filter((n) => {
      if (seen.has(n.id)) return false
      seen.add(n.id)
      return true
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** 既存IDを除外し、createdAt降順でソート（Worker で実行、失敗時メインスレッド） */
function dedupAsync(
  incoming: NormalizedNote[],
  existingIds?: Set<string>,
): Promise<NormalizedNote[]> {
  return dedupWorker
    .post({
      type: 'dedup',
      notes: incoming,
      existingIds: existingIds ? [...existingIds] : null,
    })
    .then((res) => res.notes)
    .catch(() => dedupMain(incoming, existingIds))
}

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
  const { isHidden } = useNoteVisibility()

  // 取得した生データ。表示用 notes はミュート/削除を表示時に除外（#606 / #574）
  const rawNotes = shallowRef<NormalizedNote[]>([])
  const notes = computed(() => rawNotes.value.filter((n) => !isHidden(n)))
  const { noteScrollerRef } = useNoteScrollerRef(scroller)

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
    if (cached.length > 0) rawNotes.value = cached

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
          return fetchNotes(adapter)
        },
        3,
      )

      // live を優先しつつキャッシュとマージ（dedup は先勝ち）
      rawNotes.value = await dedupAsync([
        ...collectFulfilled(results),
        ...cached,
      ])
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

          // ログアウト中: hasToken 不要でキャッシュを遡る
          if (!key || !lastForAccount) return []
          try {
            return await loadCachedTimelineBefore(
              acc.id,
              key,
              lastForAccount.createdAt,
            )
          } catch {
            return []
          }
        },
        3,
      )

      const existingIds = new Set(rawNotes.value.map((n) => n.id))
      const newOlder = await dedupAsync(collectFulfilled(results), existingIds)
      rawNotes.value = [...rawNotes.value, ...newOlder]
    } catch (e) {
      error.value = AppError.from(e)
    } finally {
      isLoading.value = false
    }
  }

  function handleScroll() {
    onScrollReport()
  }

  async function removeNote(note: NormalizedNote) {
    const adapter = await multiAdapters.getOrCreate(note._accountId)
    if (!adapter) return
    try {
      await adapter.api.deleteNote(note.id)
    } catch {
      return
    }
    rawNotes.value = rawNotes.value.filter((n) => n.id !== note.id)
    noteStore.remove(note.id)
  }

  onMounted(() => {
    if (isCrossAccount()) {
      connectCrossAccount()
    }
  })

  return {
    notes,
    noteScrollerRef,
    scrollToTop,
    connectCrossAccount,
    loadMoreCrossAccount,
    handleScroll,
    removeNote,
  }
}
