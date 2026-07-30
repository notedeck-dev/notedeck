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

// defineProperty で書き換えた UA は unstubAllGlobals では戻らないため明示復元
const ORIGINAL_UA = navigator.userAgent

afterEach(() => {
  stubUserAgent(ORIGINAL_UA)
  vi.unstubAllGlobals()
})

describe('proxyUrl', () => {
  // 非 Android の wait=1: Android の custom protocol だけが直列 + 10 秒フューズ
  // (wry) なので二段階配信が必須。それ以外はブロッキングが安全なので、初回
  // 表示から往復 1 回で本物を返す
  it('custom protocol の口に載せる (非 Android は単一トリップ)', async () => {
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(
      `http://ndmedia.localhost/m?url=${encodeURIComponent(REMOTE)}&wait=1`,
    )
  })

  it('macOS/iOS/Linux 形式でも Tauri の解決結果に従う', async () => {
    stubTauri((path, protocol) => `${protocol}://localhost/${path}`)
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(
      `ndmedia://localhost/m?url=${encodeURIComponent(REMOTE)}&wait=1`,
    )
  })

  it('Android は二段階配信 (wait を付けない)', async () => {
    stubUserAgent(ANDROID_UA)
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toContain('ndmedia')
    expect(proxyUrl(REMOTE)).not.toContain('wait=1')
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
      `http://127.0.0.1:19820/proxy/image?url=${encodeURIComponent(REMOTE)}&wait=1`,
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

describe('wait オプション (効果音などブロッキング消費者用)', () => {
  // 二段階配信の Android でも、fetch/Audio 要素はプレースホルダを飲み込め
  // ないので明示 wait で従来のブロッキングに乗せる
  it('Android でも明示 wait は wait=1 を付ける', async () => {
    stubUserAgent(ANDROID_UA)
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE, { wait: true })).toContain('wait=1')
    const normal = proxyUrl(REMOTE)
    expect(normal).not.toContain('wait=1')
  })
})

describe('proxyEmojiUrl (カスタム絵文字の共通サムネイル口)', () => {
  it('全文脈で同じ幅バケット (64px) に丸めてキャッシュを共有する', async () => {
    const { proxyEmojiUrl, proxyThumbUrl } = await loadModule()
    expect(proxyEmojiUrl(REMOTE)).toBe(proxyThumbUrl(REMOTE, 64))
    expect(proxyEmojiUrl(REMOTE)).toContain('w=64')
  })

  it('https 以外は素通し (同梱 twemoji のローカルパス等)', async () => {
    const { proxyEmojiUrl } = await loadModule()
    expect(proxyEmojiUrl('/twemoji/1f600.svg')).toBe('/twemoji/1f600.svg')
    expect(proxyEmojiUrl(null)).toBeUndefined()
  })
})

describe('背景取得完了による再読込 (二段階配信)', () => {
  // フェーズ 1 はキャッシュミス時に透明プレースホルダを返す。取得完了イベント
  // で URL の世代を進め、テンプレート再評価 → <img> 再要求で本物に差し替える
  it('media-fetched で世代番号が付き、再度の完了でさらに進む', async () => {
    const { proxyUrl, handleMediaFetched } = await loadModule()
    const base = proxyUrl(REMOTE) ?? ''
    expect(base).not.toBe('')
    expect(base).not.toContain('&r=')

    handleMediaFetched(REMOTE)
    expect(proxyUrl(REMOTE)).toBe(`${base}&r=1`)

    handleMediaFetched(REMOTE)
    expect(proxyUrl(REMOTE)).toBe(`${base}&r=2`)
  })

  it('世代はサムネイル URL (幅違い) にも波及する', async () => {
    const { proxyThumbUrl, handleMediaFetched } = await loadModule()
    const base = proxyThumbUrl(REMOTE, 56) ?? ''
    expect(base).not.toBe('')
    handleMediaFetched(REMOTE)
    expect(proxyThumbUrl(REMOTE, 56)).toBe(`${base}&r=1`)
    expect(proxyThumbUrl(REMOTE, 112)).toContain('&r=1')
  })

  it('無関係の URL には影響しない', async () => {
    const { proxyUrl, handleMediaFetched } = await loadModule()
    const other = 'https://example.com/other.png'
    handleMediaFetched(REMOTE)
    expect(proxyUrl(other)).not.toContain('&r=')
  })

  it('世代マップは上限で古い順に捨てる (無限成長しない)', async () => {
    const { proxyUrl, handleMediaFetched } = await loadModule()
    // 上限 (テスト環境の既定 256) を超えて完了イベントを流す
    handleMediaFetched(REMOTE)
    for (let i = 0; i < 300; i++) {
      handleMediaFetched(`https://example.com/e${i}.png`)
    }
    // 最古の REMOTE は追い出され、素の URL に戻る (キャッシュ済みなので実害なし)
    expect(proxyUrl(REMOTE)).not.toContain('&r=')
    // 直近のものは世代付きのまま
    expect(proxyUrl('https://example.com/e299.png')).toContain('&r=1')
  })
})

describe('proxyThumbUrl', () => {
  // format は付けない: 明示すると「上限以下なら変換不要」の素通しが効かなくなる
  it('幅だけを付ける (非 Android は wait も付く)', async () => {
    const { proxyThumbUrl } = await loadModule()
    expect(proxyThumbUrl(REMOTE, 56)).toBe(
      `http://ndmedia.localhost/m?url=${encodeURIComponent(REMOTE)}&w=56&wait=1`,
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
