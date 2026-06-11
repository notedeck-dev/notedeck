import { PERSIST_DEBOUNCE_MS } from '@/constants/persist'

export interface DebouncedPersist {
  /** debounce 付きで persist を予約する */
  schedule: () => void
  /**
   * ペンディング中の予約があれば即時 persist する (アプリ終了前など)。
   * 予約がなければ no-op。失敗は呼び出し元へ伝播する (onError は通らない)。
   */
  flush: () => Promise<void>
  /** ペンディング中の予約を破棄する */
  cancel: () => void
}

/**
 * debounce 付き永続化タイマーの共通実装。
 * 各ストアに重複していた「persistTimer + schedulePersist」パターンを吸収する。
 */
export function createDebouncedPersist(
  persist: () => void | Promise<void>,
  options: { delayMs?: number; onError?: (e: unknown) => void } = {},
): DebouncedPersist {
  const { delayMs = PERSIST_DEBOUNCE_MS, onError } = options
  let timer: ReturnType<typeof setTimeout> | null = null

  function cancel(): void {
    if (timer != null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function schedule(): void {
    cancel()
    timer = setTimeout(() => {
      timer = null
      // 同期 persist は同期のまま実行する (マイクロタスク化すると fake timer
      // テストや beforeunload 直前の書き込みで取りこぼす)
      try {
        const result = persist()
        if (result instanceof Promise) result.catch((e) => onError?.(e))
      } catch (e) {
        onError?.(e)
      }
    }, delayMs)
  }

  async function flush(): Promise<void> {
    if (timer == null) return
    cancel()
    await persist()
  }

  return { schedule, flush, cancel }
}
