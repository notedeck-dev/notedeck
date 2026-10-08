import { type Ref, shallowRef } from 'vue'
import { AppError } from '@/utils/errors'

export interface UsePaginatedListOptions<T, C = string> {
  /** cursor なし = 初回ページ、あり = その続きのページを返す */
  fetch: (cursor?: C) => Promise<T[]>
  /**
   * 1 ページの期待件数。これ未満しか返らなければ hasMore=false で打ち切る。
   * 省略時は「空が返るまで続ける」(取得結果をフィルタする API 向け)。
   */
  pageSize?: number
  /**
   * loadMore のカーソル。default: 末尾 item の `id` (untilId 式)。
   * offset 式の API は `(items) => items.length` を渡す
   */
  cursor?: (items: T[]) => C | undefined
  /** 初回ロード後の hasMore 判定を上書きする (例: ページング非対応 API) */
  initialHasMore?: (fetched: T[]) => boolean
  /** items がこの件数に達したら loadMore を打ち切る */
  maxItems?: number
  /** error ref に加えて raw error を受け取る (toast / ウィンドウエラー連携用) */
  onError?: (e: unknown) => void
}

export interface PaginatedList<T> {
  items: Ref<T[]>
  isLoading: Ref<boolean>
  error: Ref<string | null>
  hasMore: Ref<boolean>
  /** 初回ロード。2 回目以降は no-op。失敗時は retry 可能 */
  load: () => Promise<void>
  /** 末尾の item をカーソルに次ページを追記 */
  loadMore: () => Promise<void>
  /** 表示中の items を保ったまま先頭ページを取り直す (カラムの引いて更新用) */
  reload: () => Promise<void>
  /** 状態を初期化して load し直せるようにする */
  reset: () => void
}

/**
 * カーソル式ページングの共通実装 (既定は untilId、offset 式は cursor で差し替え)。
 * UserProfileContent のタブや Deck*Column に重複していた
 * 「isLoading/hasMore ガード → at(-1) → fetch → 追記」パターンを吸収する。
 */
export function usePaginatedList<T, C = string>(
  options: UsePaginatedListOptions<T, C>,
): PaginatedList<T> {
  const { fetch, pageSize, initialHasMore, maxItems, onError } = options
  const cursor =
    options.cursor ??
    ((items: T[]) => (items.at(-1) as { id: C } | undefined)?.id)

  const items = shallowRef<T[]>([])
  const isLoading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const hasMore = shallowRef(false)
  let loaded = false

  function defaultHasMore(fetched: T[]): boolean {
    return pageSize != null ? fetched.length >= pageSize : fetched.length > 0
  }

  async function load(): Promise<void> {
    if (loaded) return
    loaded = true
    isLoading.value = true
    error.value = null
    try {
      const fetched = await fetch(undefined)
      items.value = fetched
      hasMore.value = (initialHasMore ?? defaultHasMore)(fetched)
    } catch (e) {
      error.value = AppError.from(e).message
      onError?.(e)
      loaded = false
    } finally {
      isLoading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (isLoading.value || !hasMore.value) return
    if (maxItems != null && items.value.length >= maxItems) return
    if (items.value.length === 0) return
    isLoading.value = true
    try {
      const older = await fetch(cursor(items.value))
      if (!defaultHasMore(older)) hasMore.value = false
      if (older.length > 0) {
        items.value = [...items.value, ...older]
      }
    } catch (e) {
      error.value = AppError.from(e).message
      onError?.(e)
    } finally {
      isLoading.value = false
    }
  }

  function reload(): Promise<void> {
    loaded = false
    return load()
  }

  function reset(): void {
    items.value = []
    isLoading.value = false
    error.value = null
    hasMore.value = false
    loaded = false
  }

  return { items, isLoading, error, hasMore, load, loadMore, reload, reset }
}
