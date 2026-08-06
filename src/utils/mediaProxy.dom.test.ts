import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 画像・効果音プロキシの URL 組み立て (#921 Phase 3)。
 *
 * 全プラットフォームでループバック HTTP (127.0.0.1:19820) に一本化した。
 * custom protocol (ndmedia) 時代のプラットフォーム分岐・二段階配信・
 * 自己修復機構は存在しないこと自体が仕様。ここでは「どの UA でも同じ
 * プロキシ URL になり、元 URL 直読みに戻らない」ことを守る。
 */

const BASE = 'http://127.0.0.1:19820/proxy/image'
const REMOTE = 'https://example.com/emoji/petthex.png'

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'

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

const ORIGINAL_UA = navigator.userAgent

beforeEach(() => {
  setActivePinia(createPinia())
  stubUserAgent(ORIGINAL_UA)
})

describe('proxyUrl', () => {
  it('ループバック HTTP の口に載せる', async () => {
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(`${BASE}?url=${encodeURIComponent(REMOTE)}`)
  })

  it.each([
    ['Android', ANDROID_UA],
    ['iOS', IOS_UA],
  ])('%s でも同じ経路 (プロキシをバイパスしない)', async (_name, ua) => {
    stubUserAgent(ua)
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(`${BASE}?url=${encodeURIComponent(REMOTE)}`)
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
      `${BASE}?url=${encodeURIComponent(REMOTE)}&w=56`,
    )
  })

  it('幅違いは別 URL になる (srcset の 1x/2x が潰れない)', async () => {
    const { proxyThumbUrl } = await loadModule()
    expect(proxyThumbUrl(REMOTE, 56)).not.toBe(proxyThumbUrl(REMOTE, 112))
  })
})

describe('proxyEmojiUrl (カスタム絵文字の共通サムネイル口)', () => {
  // 本家 media-proxy の emoji=1 と同じ「最大高さ 128px」基準 (#921)。
  // 幅基準 (旧 w=64) だと横長絵文字の高さが潰れ、表示 (2em × DPR) の
  // 引き伸ばしで荒れていた
  it('全文脈で同じ高さバケット (128px) に丸めてキャッシュを共有する', async () => {
    const { proxyEmojiUrl } = await loadModule()
    expect(proxyEmojiUrl(REMOTE)).toBe(
      `${BASE}?url=${encodeURIComponent(REMOTE)}&h=128`,
    )
  })

  it('幅は制限しない (横長絵文字の解像度を潰さない)', async () => {
    const { proxyEmojiUrl } = await loadModule()
    expect(proxyEmojiUrl(REMOTE)).not.toContain('w=')
  })

  it('https 以外は素通し (同梱 twemoji のローカルパス等)', async () => {
    const { proxyEmojiUrl } = await loadModule()
    expect(proxyEmojiUrl('/twemoji/1f600.svg')).toBe('/twemoji/1f600.svg')
    expect(proxyEmojiUrl(null)).toBeUndefined()
  })
})

describe('URL 文字列キャッシュの追い出し (#893)', () => {
  it('上限を超えたら古い順に捨てるが、組み立て結果は変わらない', async () => {
    const { proxyUrl } = await loadModule()
    const first = proxyUrl(REMOTE)
    for (let i = 0; i < 300; i++) {
      proxyUrl(`https://example.com/e${i}.png`)
    }
    // 追い出されても再構築されるだけで同じ URL になる
    expect(proxyUrl(REMOTE)).toBe(first)
  })
})

/**
 * CSS の url() 値としてプロキシ URL を組み立てる口 (#979)。
 *
 * ストア配布物のアイコンは第三者がメタデータで URL を指定できるため、
 * 文字列補間で url('...') を組み立てると、クォートを含む値で url() を
 * 閉じて別のプロパティを注入できてしまう。プロキシを通った URL だけを
 * CSS に入れ、素通し (https 以外) は none に倒すことで塞ぐ。
 */
describe('proxyCssUrl', () => {
  it('https の URL はプロキシ経由の url() 値になる', async () => {
    const { proxyCssUrl } = await loadModule()
    const css = proxyCssUrl(REMOTE, 48)
    expect(css).toBe(`url("${BASE}?url=${encodeURIComponent(REMOTE)}&w=48")`)
  })

  it('https 以外は none に倒す (素通し URL を CSS に入れない)', async () => {
    const { proxyCssUrl } = await loadModule()
    expect(proxyCssUrl('http://example.com/x.png', 48)).toBe('none')
    expect(proxyCssUrl('data:image/png;base64,AAAA', 48)).toBe('none')
    expect(proxyCssUrl('/local/icon.svg', 48)).toBe('none')
  })

  it('null / undefined / 空文字は none', async () => {
    const { proxyCssUrl } = await loadModule()
    expect(proxyCssUrl(null, 48)).toBe('none')
    expect(proxyCssUrl(undefined, 48)).toBe('none')
    expect(proxyCssUrl('', 48)).toBe('none')
  })

  // encodeURIComponent は ' と ) をエンコードしないので、url() は
  // ダブルクォートで囲む必要がある。" は %22 になるため閉じられない。
  it.each([
    [
      'ダブルクォート',
      `https://e.example/x.png"); background: url("https://evil.example/y.png`,
    ],
    [
      'シングルクォート',
      `https://e.example/x.png'); background: url('https://evil.example/y.png`,
    ],
  ])('%s を含む URL でも url() を閉じられない', async (_name, evil) => {
    const { proxyCssUrl } = await loadModule()
    const css = proxyCssUrl(evil, 48)
    // 開始と終了の 2 つだけ = 途中で文字列を閉じられていない
    expect((css.match(/"/g) ?? []).length).toBe(2)
    expect(css.startsWith('url("')).toBe(true)
    expect(css.endsWith('")')).toBe(true)
  })
})
