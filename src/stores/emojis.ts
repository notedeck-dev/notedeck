import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { ServerEmoji } from '@/adapters/types'
import { events } from '@/bindings'
import { usePerformanceStore } from '@/stores/performance'
import { createDebouncedPersist } from '@/utils/debouncedPersist'
import { getStorageJson, STORAGE_KEYS, setStorageJson } from '@/utils/storage'

/** 初回取得失敗のリトライバックオフ */
const RETRY_BACKOFF_MS = 30_000

/** miss 報告から再取得までのデバウンス (バースト中の miss をまとめる) */
const MISS_DEBOUNCE_MS = 3_000

/** miss 駆動の再取得の最短間隔 (host 単位) */
const REFRESH_COOLDOWN_MS = 5 * 60_000

/** これより古い辞書は ensureLoaded 時に背景で取り直す (絵文字画像の差し替えを拾う) */
const STALE_AFTER_MS = 24 * 60 * 60_000

/** localStorage の永続化形式。旧形式 (バージョンなし) は捨てて再取得に任せる */
interface PersistedCacheV2 {
  version: 2
  hosts: Record<string, { fetchedAt: number; emojis: Record<string, string> }>
}

export const useEmojisStore = defineStore('emojis', () => {
  const perfStore = usePerformanceStore()

  // host → (shortcode → url) — for fast emoji resolution in notes
  const cache = shallowRef(new Map<string, Record<string, string>>())

  // host → ServerEmoji[] — for the reaction picker (with category/aliases)
  const emojiList = shallowRef(new Map<string, ServerEmoji[]>())

  // In-flight dedup: avoid parallel fetches for the same host
  const pending = new Map<string, Promise<void>>()
  // Backoff: track failed hosts to avoid immediate retry
  const failedHosts = new Map<string, number>()

  // ── miss 駆動の再取得 (#新規絵文字が再起動まで出ない問題の解消) ──
  // 辞書は「一度取ったら終わり」ではなく、未解決 shortcode の報告を
  // シグナルに取り直す。以下はすべて非 reactive (描画中の resolve から
  // 呼ばれるため、reactive 状態に触れて再描画ループを作らない)。
  const fetchers = new Map<string, () => Promise<ServerEmoji[]>>()
  const fetchedAt = new Map<string, number>()
  const missedNames = new Map<string, Set<string>>()
  // 再取得しても辞書に現れなかった名前 (本当に存在しない)。空振りの
  // refetch ループを防ぐ。辞書に現れた時点で解放する
  const unknownNames = new Map<string, Set<string>>()
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const lastRefreshAt = new Map<string, number>()

  // Load shortcode→url cache from localStorage (for offline emoji resolution)
  function loadFromStorage() {
    const obj = getStorageJson<PersistedCacheV2 | null>(
      STORAGE_KEYS.emojisCache,
      null,
    )
    if (obj?.version !== 2) return
    // localStorage は外から壊せる (手編集・書き込み途中の切断)。ここは store
    // setup 内なので throw するとストアごと初期化に失敗する。version が
    // 合っていても形は信用しない。壊れた host は飛ばして再取得に任せる
    // (undefined を混ぜると has() が true を返し、以後取得を skip してしまう)
    if (typeof obj.hosts !== 'object' || obj.hosts === null) return
    const map = new Map<string, Record<string, string>>()
    for (const [host, entry] of Object.entries(obj.hosts)) {
      if (typeof entry?.emojis !== 'object' || entry.emojis === null) continue
      map.set(host, entry.emojis)
      if (typeof entry.fetchedAt === 'number')
        fetchedAt.set(host, entry.fetchedAt)
    }
    cache.value = map
  }

  function persistToStorage() {
    try {
      const hosts: PersistedCacheV2['hosts'] = {}
      for (const [host, lookup] of cache.value) {
        hosts[host] = {
          fetchedAt: fetchedAt.get(host) ?? Date.now(),
          emojis: lookup,
        }
      }
      setStorageJson(STORAGE_KEYS.emojisCache, {
        version: 2,
        hosts,
      } satisfies PersistedCacheV2)
    } catch {
      // storage full, ignore
    }
  }

  const { schedule: schedulePersist } = createDebouncedPersist(persistToStorage)

  // Initialize from localStorage
  loadFromStorage()

  function set(host: string, emojis: ServerEmoji[]) {
    // Build shortcode→url lookup for resolution (no cap — lightweight Record<string, string>)
    const lookup: Record<string, string> = {}
    for (const e of emojis) {
      lookup[e.name] = e.url
    }

    const nextCache = new Map(cache.value)
    nextCache.set(host, lookup)
    cache.value = nextCache
    fetchedAt.set(host, Date.now())

    // emojiList: only keep the most recent hosts to bound memory
    const nextList = new Map(emojiList.value)
    nextList.set(host, emojis)
    if (nextList.size > perfStore.get('emojiListHosts')) {
      const oldest = nextList.keys().next().value
      if (oldest !== undefined) nextList.delete(oldest)
    }
    emojiList.value = nextList

    // 辞書に現れた unknown は解放する (再登録された絵文字を拾えるように)
    const unknown = unknownNames.get(host)
    if (unknown) {
      for (const name of unknown) {
        if (lookup[name] !== undefined || lookup[`${name}@.`] !== undefined) {
          unknown.delete(name)
        }
      }
    }

    // Persist shortcode→url cache for offline use (debounced)
    schedulePersist()
  }

  function ensureLoaded(
    host: string,
    fetcher: () => Promise<ServerEmoji[]>,
  ): void {
    // miss 駆動 / 経年リフレッシュ用に常に保持 (最新の fetcher で上書き)
    fetchers.set(host, fetcher)
    if (
      (cache.value.has(host) && emojiList.value.has(host)) ||
      pending.has(host)
    ) {
      const at = fetchedAt.get(host)
      if (at !== undefined && Date.now() - at > STALE_AFTER_MS) {
        scheduleRefresh(host)
      }
      return
    }
    const failedAt = failedHosts.get(host)
    if (failedAt && Date.now() - failedAt < RETRY_BACKOFF_MS) return
    const p = fetcher()
      .then((emojis) => {
        failedHosts.delete(host)
        set(host, emojis)
      })
      .catch((e) => {
        console.warn('[emojis] failed to fetch:', host, e)
        failedHosts.set(host, Date.now())
      })
      .finally(() => {
        // 成功パスの例外でも pending を残さない (残ると永久に再取得不能)
        pending.delete(host)
      })
    pending.set(host, p)
  }

  /**
   * 解決できなかった shortcode の報告。デバウンス + クールダウン付きで
   * host の辞書を取り直す。アプリ起動後にサーバーへ追加された絵文字は
   * ここを通らないと再起動まで永久に unknown のままになる。
   * 描画中 (computed) から呼ばれるため、reactive 状態には触れない。
   */
  function reportMiss(host: string, shortcode: string): void {
    // リモート絵文字 (name@host) はローカル辞書に決して現れない
    if (shortcode.includes('@')) return
    if (!fetchers.has(host)) return
    if (unknownNames.get(host)?.has(shortcode)) return
    let missed = missedNames.get(host)
    if (!missed) {
      missed = new Set()
      missedNames.set(host, missed)
    }
    if (missed.has(shortcode)) return
    missed.add(shortcode)
    scheduleRefresh(host)
  }

  function scheduleRefresh(host: string): void {
    if (refreshTimers.has(host)) return
    const last = lastRefreshAt.get(host)
    const cooldownLeft =
      last !== undefined
        ? Math.max(0, last + REFRESH_COOLDOWN_MS - Date.now())
        : 0
    const delay = Math.max(MISS_DEBOUNCE_MS, cooldownLeft)
    refreshTimers.set(
      host,
      setTimeout(() => {
        refreshTimers.delete(host)
        void refresh(host)
      }, delay),
    )
  }

  async function refresh(host: string): Promise<void> {
    const fetcher = fetchers.get(host)
    if (!fetcher) return
    lastRefreshAt.set(host, Date.now())
    const missed = missedNames.get(host)
    missedNames.delete(host)
    try {
      const emojis = await fetcher()
      set(host, emojis)
      // 取り直しても存在しなかった名前は隔離する
      if (missed) {
        const lookup = cache.value.get(host) ?? {}
        for (const name of missed) {
          if (lookup[name] === undefined && lookup[`${name}@.`] === undefined) {
            let unknown = unknownNames.get(host)
            if (!unknown) {
              unknown = new Set()
              unknownNames.set(host, unknown)
            }
            unknown.add(name)
          }
        }
      }
    } catch (e) {
      console.warn('[emojis] refresh failed:', host, e)
      // unknown には入れない — 次の miss がクールダウン付きで再試行する
    }
  }

  /**
   * ストリーミング broadcast (emojiAdded / emojiUpdated / emojiDeleted) の
   * push 反映 (#889)。pull 型 (reportMiss + 経年リフレッシュ) はフォール
   * バックとして残る。辞書が未取得の host には適用しない — 部分適用で
   * 「取得済み」に見せると、次の ensureLoaded が全量取得を skip してしまう。
   */
  function applyServerChange(
    host: string,
    change: 'added' | 'updated' | 'deleted',
    emojis: ServerEmoji[],
  ): void {
    const lookup = cache.value.get(host)
    if (!lookup) return

    const nextLookup = { ...lookup }
    const unknown = unknownNames.get(host)
    if (change === 'deleted') {
      for (const e of emojis) {
        delete nextLookup[e.name]
        delete nextLookup[`${e.name}@.`]
      }
    } else {
      for (const e of emojis) {
        nextLookup[e.name] = e.url
        // 再登録された絵文字を拾えるよう unknown から解放する
        unknown?.delete(e.name)
      }
    }
    const nextCache = new Map(cache.value)
    nextCache.set(host, nextLookup)
    cache.value = nextCache

    if (change === 'deleted') {
      // 削除済みと分かっている名前は隔離し、miss 駆動の空振り refetch を
      // 起こさない (added が来たら上で解放される)
      let u = unknownNames.get(host)
      if (!u) {
        u = new Set()
        unknownNames.set(host, u)
      }
      for (const e of emojis) u.add(e.name)
    }

    // ピッカー/補完用リストも保持している host なら同期する
    const list = emojiList.value.get(host)
    if (list) {
      let nextEntries: ServerEmoji[]
      if (change === 'deleted') {
        const gone = new Set(emojis.map((e) => e.name))
        nextEntries = list.filter((e) => !gone.has(e.name))
      } else {
        const byName = new Map(list.map((e) => [e.name, e]))
        for (const e of emojis) byName.set(e.name, e)
        nextEntries = [...byName.values()]
      }
      const nextList = new Map(emojiList.value)
      nextList.set(host, nextEntries)
      emojiList.value = nextList
    }

    schedulePersist()
  }

  // push 反映の購読
  try {
    events.streamEmojiChanged
      .listen(({ payload }) =>
        applyServerChange(payload.host, payload.change, payload.emojis),
      )
      .catch(() => {
        // Tauri 外 (pnpm dev のブラウザ確認・テスト) では購読できない
      })
  } catch {
    // 同上
  }

  function resolve(host: string, shortcode: string): string | null {
    const map = cache.value.get(host)
    if (!map) return null
    const base = shortcode.replace(/@\.$/, '')
    return map[shortcode] || map[base] || map[`${base}@.`] || null
  }

  function getEmojiList(host: string): ServerEmoji[] {
    return emojiList.value.get(host) ?? []
  }

  function has(host: string): boolean {
    return cache.value.has(host)
  }

  return {
    cache,
    emojiList,
    set,
    ensureLoaded,
    reportMiss,
    applyServerChange,
    resolve,
    getEmojiList,
    has,
  }
})
