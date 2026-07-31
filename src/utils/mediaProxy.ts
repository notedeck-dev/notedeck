import { convertFileSrc } from '@tauri-apps/api/core'
import { reactive } from 'vue'
import { events } from '@/bindings'
import { usePerformanceStore } from '@/stores/performance'

/**
 * 画像プロキシの WebView 側の口。
 *
 * 以前はローカル HTTP サーバー (127.0.0.1:19820) を直接叩き、そこへ繋げない
 * モバイルだけプロキシをバイパスして元 URL を直読みしていた
 * (Android: cleartext policy / iOS: ATS)。その結果、リサイズ・ディスク
 * キャッシュ・サーキットブレーカーがモバイルでだけ効かず、アバターは
 * `proxyThumbUrl(url, 56)` を指定しても原寸が読まれていた。
 *
 * custom protocol は WebView 自身が intercept するのでネットワークスタックを
 * 通らず、この制限を受けない。URL 形式のプラットフォーム差
 * (macOS/iOS/Linux は `ndmedia://localhost/m`、Windows/Android は
 * `http://ndmedia.localhost/m`) は convertFileSrc が吸収する。
 */
const HTTP_FALLBACK_BASE = 'http://127.0.0.1:19820/proxy/image'

/**
 * Android の custom protocol だけは直列 + 10 秒フューズ (wry) のため、ミス時
 * に上流を待てない → 二段階配信 (プレースホルダ + media-fetched 再要求)。
 * それ以外のプラットフォームはブロッキングでも安全なので wait=1 を既定にし、
 * 初回表示から往復 1 回で本物を返す (単一トリップ)。
 */
const IS_ANDROID = /Android/i.test(navigator.userAgent)

let proxyBase: string | null = null
const proxyUrlCache = new Map<string, string>()

/**
 * 二段階配信 (プロキシ側) の再読込機構。
 *
 * キャッシュミス時、プロキシは上流を待たず透明プレースホルダを即返し、
 * 取得完了を media-fetched イベントで知らせてくる。ここで URL の世代番号を
 * 進めると、テンプレート内の proxyUrl 呼び出しが再評価されて `&r=N` 付きの
 * 新 URL になり、`<img>` が自然に再要求する (呼び出し箇所の変更は不要)。
 */
const mediaVersions = reactive(new Map<string, number>())

function bumpMediaVersion(url: string) {
  // proxyUrlCache と同じ上限で古い順に捨てる (無限成長させない)。
  // 追い出された URL は素の URL に戻るだけで、実体はキャッシュ済みなので
  // 表示は壊れない
  if (!mediaVersions.has(url) && mediaVersions.size >= getProxyCacheMax()) {
    const oldest = mediaVersions.keys().next().value
    if (oldest !== undefined) mediaVersions.delete(oldest)
  }
  mediaVersions.set(url, (mediaVersions.get(url) ?? 0) + 1)
}

export function handleMediaFetched(url: string, ok = true) {
  if (ok) {
    // 取得成功 → 失敗カウントをリセット (以後の失敗からまた再試行できる)
    const entry = mediaFailures.get(url)
    if (entry?.timer != null) clearTimeout(entry.timer)
    mediaFailures.delete(url)
  }
  bumpMediaVersion(url)
}

/**
 * `<img>` の onerror 側からの失敗申告。
 *
 * @error ハンドラは src を unknown アイコンへ DOM 書き換えするが、それだけ
 * だと :src バインドが変わる契機がなく、一過性の 502/504 がセッション中
 * 固定化する。ここでバックオフ後に世代番号を進めるとバインドが再評価され、
 * `<img>` が再要求して自然復帰する。負のキャッシュが生きている間の再試行は
 * プロキシが即 502 で受けるので安価に失敗し、次のバックオフに進む。
 * 上限に達したら諦める (回復は取得成功イベントのリセット任せ)。
 */
const MEDIA_RETRY_BACKOFF_MS = [8_000, 40_000, 180_000] as const

const mediaFailures = new Map<
  string,
  { retries: number; timer: ReturnType<typeof setTimeout> | null }
>()

export function markMediaFailed(url: string): void {
  const entry = mediaFailures.get(url) ?? { retries: 0, timer: null }
  if (entry.timer !== null || entry.retries >= MEDIA_RETRY_BACKOFF_MS.length) {
    return
  }
  const delay = MEDIA_RETRY_BACKOFF_MS[entry.retries] ?? 0
  entry.timer = setTimeout(() => {
    entry.timer = null
    entry.retries += 1
    bumpMediaVersion(url)
  }, delay)
  mediaFailures.set(url, entry)
}

/**
 * プレースホルダ滞留の自己修復 (`<img>` の @load からの申告)。
 *
 * 二段階配信は「透明プレースホルダ → MediaFetched → 再要求」で完結するが、
 * イベントを取りこぼす (Android の WebView フリーズ復帰等) と透明 GIF の
 * まま固まる。プレースホルダは正常な 200 応答なので onerror が発火せず、
 * markMediaFailed の再試行にも乗らない。@load で 1×1 を掴んだことを申告し、
 * 一定時間内に世代が進まなければ自力で進めて再要求させる。再要求がまた
 * プレースホルダなら @load が再申告するので、取得完了まで自然に収束する
 * (取得失敗は 502 → onerror → markMediaFailed 側が引き継ぐ)。
 */
const PLACEHOLDER_RECHECK_MS = 4_000

const placeholderTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function ensurePlaceholderRecovery(url: string): void {
  if (placeholderTimers.has(url)) return
  const versionAtSchedule = mediaVersions.get(url) ?? 0
  placeholderTimers.set(
    url,
    setTimeout(() => {
      placeholderTimers.delete(url)
      // MediaFetched が正常に届いて世代が進んでいれば何もしない
      if ((mediaVersions.get(url) ?? 0) === versionAtSchedule) {
        bumpMediaVersion(url)
      }
    }, PLACEHOLDER_RECHECK_MS),
  )
}

let listenerStarted = false
function ensureFetchedListener() {
  if (listenerStarted) return
  listenerStarted = true
  try {
    events.mediaFetched
      .listen(({ payload }) => handleMediaFetched(payload.url, payload.ok))
      .catch(() => {
        // Tauri 外 (pnpm dev のブラウザ確認) ではイベント購読できない
      })
  } catch {
    // 同上
  }
}

/** 世代番号が進んでいれば `&r=N` を付けて別 URL 化する */
function withVersion(base: string, url: string): string {
  // 未登録キーの get も reactive の依存として追跡される (後の set で再評価)
  const v = mediaVersions.get(url)
  return v ? `${base}&r=${v}` : base
}

function getProxyBase(): string {
  if (proxyBase !== null) return proxyBase
  try {
    proxyBase = convertFileSrc('m', 'ndmedia')
  } catch {
    // Tauri 外 (pnpm dev のブラウザ確認) では custom protocol を解決できない
    proxyBase = HTTP_FALLBACK_BASE
  }
  return proxyBase
}

function getProxyCacheMax(): number {
  try {
    return usePerformanceStore().get('imageProxyCacheMax')
  } catch {
    return 256
  }
}

function evictIfFull() {
  if (proxyUrlCache.size >= getProxyCacheMax()) {
    const oldest = proxyUrlCache.keys().next().value
    if (oldest !== undefined) proxyUrlCache.delete(oldest)
  }
}

export function proxyUrl(
  url: string | null | undefined,
  opts?: {
    /**
     * 上流取得をブロッキングで待つ (プレースホルダを返さない)。
     * fetch() や Audio 要素のように透明 GIF を飲み込めない消費者 (効果音) 用。
     */
    wait?: boolean
  },
): string | undefined {
  if (!url?.startsWith('https://')) return url ?? undefined
  ensureFetchedListener()
  const wait = opts?.wait || !IS_ANDROID
  // 画像の wait は最適化にすぎないので soft を付け、プロキシ側が予算超過時に
  // プレースホルダ + MediaFetched の二段階配信へ降格できるようにする。
  // 明示 wait (効果音の fetch/Audio) はプレースホルダを飲み込めないので hard
  const soft = wait && !opts?.wait
  const cacheKey = soft ? `${url}|soft` : wait ? `${url}|wait` : url
  let cached = proxyUrlCache.get(cacheKey)
  if (!cached) {
    evictIfFull()
    cached = `${getProxyBase()}?url=${encodeURIComponent(url)}${wait ? '&wait=1' : ''}${soft ? '&soft=1' : ''}`
    proxyUrlCache.set(cacheKey, cached)
  }
  return withVersion(cached, url)
}

/**
 * 表示サイズが元画像よりずっと小さい面 (アバター・アイコン) 用のリサイズ付き URL。
 *
 * `format` は付けない。リサイズが必要な画像はプロキシ側が WebP で返すし、
 * format を明示すると「既に上限以下なので変換不要」の判定が使えなくなる
 * (明示された形式は尊重しなければならないため)。Misskey のアバターは
 * サーバー側で縮小済みのことが多く、その素通しが効くかどうかで
 * モバイルの初回表示が変わる。
 */
export function proxyThumbUrl(
  url: string | null | undefined,
  width: number,
): string | undefined {
  if (!url?.startsWith('https://')) return url ?? undefined
  ensureFetchedListener()
  // 画像は常に soft (予算超過でプレースホルダ降格可 — proxyUrl 参照)
  const wait = !IS_ANDROID
  const key = `${url}|w=${width}`
  let cached = proxyUrlCache.get(key)
  if (!cached) {
    evictIfFull()
    cached = `${getProxyBase()}?url=${encodeURIComponent(url)}&w=${width}${wait ? '&wait=1&soft=1' : ''}`
    proxyUrlCache.set(key, cached)
  }
  return withVersion(cached, url)
}

/**
 * カスタム絵文字の共通サムネイル口。
 *
 * 表示は ~20px なので retina 込みで 64px に丸め、全文脈 (ノート本文/
 * ピッカー/リアクション面) で同じ variant キャッシュを共有する。
 * アニメ絵文字はプロキシ側が変換を素通しするので壊れない。
 */
export function proxyEmojiUrl(
  url: string | null | undefined,
): string | undefined {
  return proxyThumbUrl(url, 64)
}
