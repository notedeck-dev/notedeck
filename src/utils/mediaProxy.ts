import { convertFileSrc } from '@tauri-apps/api/core'
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

let proxyBase: string | null = null
const proxyUrlCache = new Map<string, string>()

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

export function proxyUrl(url: string | null | undefined): string | undefined {
  if (!url?.startsWith('https://')) return url ?? undefined
  let cached = proxyUrlCache.get(url)
  if (!cached) {
    evictIfFull()
    cached = `${getProxyBase()}?url=${encodeURIComponent(url)}`
    proxyUrlCache.set(url, cached)
  }
  return cached
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
  const key = `${url}|w=${width}`
  let cached = proxyUrlCache.get(key)
  if (!cached) {
    evictIfFull()
    cached = `${getProxyBase()}?url=${encodeURIComponent(url)}&w=${width}`
    proxyUrlCache.set(key, cached)
  }
  return cached
}
