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

/**
 * URL 単位の状態表の共通追い出し規則: 新規キーの挿入前に、上限に達していたら
 * 最古の 1 件を捨てる (#893)。取得成功でしか消えない表 (失敗回数・自己修復の
 * 試行回数) も、この規則で長時間セッションの無限成長を防ぐ。
 */
function evictOldestIfFull(
  map: Map<string, unknown>,
  key: string,
  onEvict?: (evicted: string) => void,
) {
  if (map.has(key) || map.size < getProxyCacheMax()) return
  const oldest = map.keys().next().value
  if (oldest === undefined) return
  onEvict?.(oldest)
  map.delete(oldest)
}

function bumpMediaVersion(url: string) {
  // 追い出された URL は素の URL に戻るだけで、実体はキャッシュ済みなので
  // 表示は壊れない
  evictOldestIfFull(mediaVersions, url)
  mediaVersions.set(url, (mediaVersions.get(url) ?? 0) + 1)
}

export function handleMediaFetched(url: string, ok = true) {
  if (ok) {
    // 取得成功 → 失敗カウント・自己修復の試行回数をリセット
    const entry = mediaFailures.get(url)
    if (entry?.timer != null) clearTimeout(entry.timer)
    mediaFailures.delete(url)
    placeholderRecoveryCounts.delete(url)
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
  // リトライ上限に達した URL は取得成功が来ない限り残り続けるため、
  // 上限で追い出す。待機中のタイマーごと破棄する
  evictOldestIfFull(mediaFailures, url, (evicted) => {
    const old = mediaFailures.get(evicted)
    if (old?.timer != null) clearTimeout(old.timer)
  })
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

/** 自力再要求の上限。本当に 1×1 の画像 (再要求しても 1×1 のまま) で
 * 無限ループしないための打ち切り。取得成功でリセットされる */
const PLACEHOLDER_RECOVERY_MAX = 3

const placeholderTimers = new Map<string, ReturnType<typeof setTimeout>>()
const placeholderRecoveryCounts = new Map<string, number>()

export function ensurePlaceholderRecovery(url: string): void {
  if ((placeholderRecoveryCounts.get(url) ?? 0) >= PLACEHOLDER_RECOVERY_MAX) {
    return
  }
  if (placeholderTimers.has(url)) return
  const versionAtSchedule = mediaVersions.get(url) ?? 0
  placeholderTimers.set(
    url,
    setTimeout(() => {
      placeholderTimers.delete(url)
      // MediaFetched が正常に届いて世代が進んでいれば何もしない
      if ((mediaVersions.get(url) ?? 0) === versionAtSchedule) {
        // 本当に 1×1 の画像は取得成功でリセットされないため、上限で追い出す
        evictOldestIfFull(placeholderRecoveryCounts, url)
        placeholderRecoveryCounts.set(
          url,
          (placeholderRecoveryCounts.get(url) ?? 0) + 1,
        )
        bumpMediaVersion(url)
      }
    }, PLACEHOLDER_RECHECK_MS),
  )
}

/**
 * プロキシ URL (`...?url=<encoded>`) から元 URL を取り出す。
 * プロキシ経由でない (ローカルアセット等) は null。
 */
export function proxiedRawUrl(src: string): string | null {
  try {
    return new URL(src).searchParams.get('url')
  } catch {
    return null
  }
}

/**
 * 全画像の読み込み結果の一括監視。
 *
 * 二段階配信 (Android 全画像 / デスクトップの soft 降格) はアバター・添付・
 * ピッカーなどあらゆる `<img>` を通るため、個別コンポーネントに @load /
 * @error を配線するのではなく document の capture で一括して拾う (load /
 * error イベントはバブルしないが capture では捕捉できる)。
 *
 * - load: 1×1 = プレースホルダを掴んだ `<img>` を自己修復に乗せ、実画像が
 *   載ったら試行回数をリセットする
 * - error: 失敗を申告してバックオフ再試行に乗せる (一過性の 502/504 の
 *   セッション中固定化を防ぐ)。unknown アイコン等への DOM フォールバックは
 *   各コンポーネントの @error に残る
 */
function installMediaWatchdog() {
  try {
    document.addEventListener(
      'load',
      (e) => {
        const img = e.target as HTMLImageElement | null
        if (img?.tagName !== 'IMG') return
        const raw = proxiedRawUrl(img.currentSrc || img.src)
        if (!raw) return
        if (img.naturalWidth === 1 && img.naturalHeight === 1) {
          ensurePlaceholderRecovery(raw)
        } else {
          placeholderRecoveryCounts.delete(raw)
        }
      },
      true,
    )
    document.addEventListener(
      'error',
      (e) => {
        const img = e.target as HTMLImageElement | null
        if (img?.tagName !== 'IMG') return
        const raw = proxiedRawUrl(img.currentSrc || img.src)
        if (raw) markMediaFailed(raw)
      },
      true,
    )
  } catch {
    // document の無い環境 (ユニットテストの node 側等) では何もしない
  }
}

let listenerStarted = false
function ensureFetchedListener() {
  if (listenerStarted) return
  listenerStarted = true
  installMediaWatchdog()
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
    evictOldestIfFull(proxyUrlCache, cacheKey)
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
  return proxySizedUrl(url, `w=${width}`)
}

/**
 * カスタム絵文字の共通サムネイル口。
 *
 * 本家 media-proxy の `emoji=1` と同じ「最大高さ 128px」基準 (#921)。
 * 絵文字は横長が普通に存在する資産なので、幅で丸めると高さが潰れて
 * 表示 (2em × DPR、MFM の $[x2] 等) の引き伸ばしで荒れる。128px は
 * 2em × DPR3 を賄い、全文脈 (ノート本文/ピッカー/リアクション面) で
 * 同じ variant キャッシュを共有する。
 * アニメ絵文字はプロキシ側が変換を素通しするので壊れない。
 */
export function proxyEmojiUrl(
  url: string | null | undefined,
): string | undefined {
  return proxySizedUrl(url, 'h=128')
}

function proxySizedUrl(
  url: string | null | undefined,
  sizeQuery: string,
): string | undefined {
  if (!url?.startsWith('https://')) return url ?? undefined
  ensureFetchedListener()
  // 画像は常に soft (予算超過でプレースホルダ降格可 — proxyUrl 参照)
  const wait = !IS_ANDROID
  const key = `${url}|${sizeQuery}`
  let cached = proxyUrlCache.get(key)
  if (!cached) {
    evictOldestIfFull(proxyUrlCache, key)
    cached = `${getProxyBase()}?url=${encodeURIComponent(url)}&${sizeQuery}${wait ? '&wait=1&soft=1' : ''}`
    proxyUrlCache.set(key, cached)
  }
  return withVersion(cached, url)
}
