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

/**
 * host キーの Map を max 件に収める。挿入順に古いものから落とし、落とした
 * host を返す。付随する非 reactive な状態も呼び出し側で一緒に捨てるため。
 */
function capHosts(map: Map<string, unknown>, max: number): string[] {
  const dropped: string[] = []
  const limit = Math.max(1, max)
  while (map.size > limit) {
    const oldest = map.keys().next()
    if (oldest.done) break
    map.delete(oldest.value)
    dropped.push(oldest.value)
  }
  return dropped
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
    const perHost = Math.max(1, perfStore.get('emojiCachePerHost'))
    for (const [host, entry] of Object.entries(obj.hosts)) {
      if (typeof entry?.emojis !== 'object' || entry.emojis === null) continue
      // 保存側の上限 (emojiPersistPerHost) と読み側の上限は独立に変えられる。
      // 上限を下げたあとの起動や旧形式の大きな保存物をそのまま抱えない
      const entries = Object.entries(entry.emojis)
      map.set(
        host,
        entries.length > perHost
          ? Object.fromEntries(entries.slice(0, perHost))
          : entry.emojis,
      )
      if (typeof entry.fetchedAt === 'number')
        fetchedAt.set(host, entry.fetchedAt)
    }
    // 上限を下げたあとの起動で、保存済みの host を丸ごと読み戻さない
    for (const gone of capHosts(map, perfStore.get('emojiCacheHosts'))) {
      fetchedAt.delete(gone)
    }
    cache.value = map
  }

  function persistToStorage() {
    try {
      const perHost = Math.max(1, perfStore.get('emojiPersistPerHost'))
      const hosts: PersistedCacheV2['hosts'] = {}
      for (const [host, lookup] of cache.value) {
        // localStorage は数 MB で頭打ちになり、超えると書き込みごと失敗して
        // オフライン解決が丸ごと効かなくなる。全量ではなく先頭 N 件だけ運ぶ
        const entries = Object.entries(lookup)
        hosts[host] = {
          fetchedAt: fetchedAt.get(host) ?? Date.now(),
          emojis:
            entries.length > perHost
              ? Object.fromEntries(entries.slice(0, perHost))
              : lookup,
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

  /**
   * 辞書から落ちた host の付随状態を捨てる。これらはすべて host をキーに
   * 持つので、辞書だけ上限で刈っても付随状態が残れば同じ速度で増える
   */
  function forgetHost(host: string): void {
    const timer = refreshTimers.get(host)
    if (timer !== undefined) clearTimeout(timer)
    refreshTimers.delete(host)
    fetchedAt.delete(host)
    fetchers.delete(host)
    failedHosts.delete(host)
    missedNames.delete(host)
    unknownNames.delete(host)
    lastRefreshAt.delete(host)
  }

  const { schedule: schedulePersist } = createDebouncedPersist(persistToStorage)

  // Initialize from localStorage
  loadFromStorage()

  function set(host: string, emojis: ServerEmoji[]) {
    // shortcode→url lookup。ホストあたりの件数は emojiCachePerHost で頭打ちに
    // する (#987 — 以前は無制限で、大規模サーバーでは数万エントリになった)。
    // 切り捨てられた絵文字は解決できないが、reportMiss → refresh でも現れない
    // ため unknownNames に隔離され、空振りの再取得ループにはならない
    const perHost = Math.max(1, perfStore.get('emojiCachePerHost'))
    const lookup: Record<string, string> = {}
    let count = 0
    for (const e of emojis) {
      if (count >= perHost) break
      lookup[e.name] = e.url
      count++
    }

    const nextCache = new Map(cache.value)
    nextCache.set(host, lookup)
    // 辞書は連合先の数だけ増える。落とした host の付随状態も一緒に捨てる
    for (const gone of capHosts(nextCache, perfStore.get('emojiCacheHosts'))) {
      forgetHost(gone)
    }
    cache.value = nextCache
    fetchedAt.set(host, Date.now())

    // emojiList: only keep the most recent hosts to bound memory
    const nextList = new Map(emojiList.value)
    nextList.set(host, emojis)
    capHosts(nextList, perfStore.get('emojiListHosts'))
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
      // フェッチ中に host が上限で追い出されていたら結果を捨てる。
      // ここで set() すると追い出し済み host が復活し、より新しい host を
      // 逆に押し出してしまう (forgetHost は fetchers も消すのでそれで判る)
      if (!fetchers.has(host)) return
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
      // emojiAdded の積み重ねで set() の上限 (emojiCachePerHost) を素通り
      // させない。追加分 (末尾) を残し、古いキー (先頭) から削る
      const perHost = Math.max(1, perfStore.get('emojiCachePerHost'))
      const names = Object.keys(nextLookup)
      if (names.length > perHost) {
        for (const name of names.slice(0, names.length - perHost)) {
          delete nextLookup[name]
        }
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
