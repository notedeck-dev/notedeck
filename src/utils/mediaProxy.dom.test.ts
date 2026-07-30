import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 画像プロキシの URL 組み立て。
 *
 * モバイルだけプロキシをバイパスしていた頃はリサイズ・ディスクキャッシュ・
 * サーキットブレーカーが Android/iOS で効かなかった。custom protocol に
 * 一本化してその分岐を無くしたので、UA によらず同じ経路に乗ることを守る。
 */

/** Tauri の内部 API を差し込む。protocol ごとの URL 形式は Tauri が決める */
function stubTauri(format: (path: string, protocol: string) => string) {
  vi.stubGlobal('__TAURI_INTERNALS__', { convertFileSrc: format })
}

function stubUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    configurable: true,
  })
}

async function loadModule() {
  vi.resetModules()
  return await import('@/utils/mediaProxy')
}

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const REMOTE = 'https://example.com/emoji/petthex.png'

beforeEach(() => {
  // Windows/Android 形式を既定にする
  stubTauri((path, protocol) => `http://${protocol}.localhost/${path}`)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('proxyUrl', () => {
  it('custom protocol の口に載せる', async () => {
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(
      `http://ndmedia.localhost/m?url=${encodeURIComponent(REMOTE)}`,
    )
  })

  it('macOS/iOS/Linux 形式でも Tauri の解決結果に従う', async () => {
    stubTauri((path, protocol) => `${protocol}://localhost/${path}`)
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(
      `ndmedia://localhost/m?url=${encodeURIComponent(REMOTE)}`,
    )
  })

  it.each([
    ['Android', ANDROID_UA],
    ['iOS', IOS_UA],
  ])('%s でもプロキシをバイパスしない', async (_name, ua) => {
    stubUserAgent(ua)
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toContain('ndmedia')
    expect(proxyUrl(REMOTE)).not.toBe(REMOTE)
  })

  it('Tauri 外 (ブラウザ確認) では HTTP の口にフォールバックする', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', undefined)
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(
      `http://127.0.0.1:19820/proxy/image?url=${encodeURIComponent(REMOTE)}`,
    )
  })

  it('https 以外はそのまま返す', async () => {
    const { proxyUrl } = await loadModule()
    expect(proxyUrl('/local/asset.svg')).toBe('/local/asset.svg')
    expect(proxyUrl('data:image/svg+xml,<svg/>')).toBe(
      'data:image/svg+xml,<svg/>',
    )
    expect(proxyUrl(null)).toBeUndefined()
  })
})

describe('proxyThumbUrl', () => {
  // format は付けない: 明示すると「上限以下なら変換不要」の素通しが効かなくなる
  it('幅だけを付ける', async () => {
    const { proxyThumbUrl } = await loadModule()
    expect(proxyThumbUrl(REMOTE, 56)).toBe(
      `http://ndmedia.localhost/m?url=${encodeURIComponent(REMOTE)}&w=56`,
    )
  })

  it('モバイルでもリサイズ指定が落ちない', async () => {
    stubUserAgent(ANDROID_UA)
    const { proxyThumbUrl } = await loadModule()
    expect(proxyThumbUrl(REMOTE, 56)).toContain('w=56')
  })

  it('幅違いは別 URL になる (srcset の 1x/2x が潰れない)', async () => {
    const { proxyThumbUrl } = await loadModule()
    expect(proxyThumbUrl(REMOTE, 56)).not.toBe(proxyThumbUrl(REMOTE, 112))
  })
})
