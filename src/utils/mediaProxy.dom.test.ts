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
  // soft=1: 画像の wait は最適化にすぎないので、プロキシ側は予算超過時に
  // プレースホルダへ降格してよい (効果音の hard wait と区別する)
  it('custom protocol の口に載せる (非 Android は単一トリップ + soft 降格可)', async () => {
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(
      `http://ndmedia.localhost/m?url=${encodeURIComponent(REMOTE)}&wait=1&soft=1`,
    )
  })

  it('macOS/iOS/Linux 形式でも Tauri の解決結果に従う', async () => {
    stubTauri((path, protocol) => `${protocol}://localhost/${path}`)
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE)).toBe(
      `ndmedia://localhost/m?url=${encodeURIComponent(REMOTE)}&wait=1&soft=1`,
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
      `http://127.0.0.1:19820/proxy/image?url=${encodeURIComponent(REMOTE)}&wait=1&soft=1`,
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

  it('明示 wait (効果音) には soft を付けない — プレースホルダを飲み込めない', async () => {
    const { proxyUrl } = await loadModule()
    expect(proxyUrl(REMOTE, { wait: true })).not.toContain('soft=1')
    expect(proxyUrl(REMOTE, { wait: true })).toContain('wait=1')
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

describe('失敗申告によるバックオフ再試行 (markMediaFailed)', () => {
  // @error の DOM 書き換え (unknown アイコンへの差し替え) は :src バインドが
  // 変わらない限り戻らず、一過性の 502/504 がセッション中固定化していた。
  // 失敗を申告するとバックオフ後に世代番号が進み、バインド再評価で自然復帰する
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('バックオフ後に世代番号を進めて <img> に再要求させる', async () => {
    const { proxyUrl, markMediaFailed } = await loadModule()
    const base = proxyUrl(REMOTE)
    markMediaFailed(REMOTE)
    // バックオフ前は変わらない (失敗直後の連打再要求を避ける)
    expect(proxyUrl(REMOTE)).toBe(base)
    vi.advanceTimersByTime(8_000)
    expect(proxyUrl(REMOTE)).toBe(`${base}&r=1`)
  })

  it('タイマー待ち中の重複申告は 1 回の再試行にまとまる', async () => {
    const { proxyUrl, markMediaFailed } = await loadModule()
    markMediaFailed(REMOTE)
    markMediaFailed(REMOTE)
    markMediaFailed(REMOTE)
    vi.advanceTimersByTime(10 * 60_000)
    expect(proxyUrl(REMOTE)).toContain('&r=1')
  })

  it('再試行は上限で打ち切る (無限リトライしない)', async () => {
    const { proxyUrl, markMediaFailed } = await loadModule()
    for (let i = 0; i < 10; i++) {
      markMediaFailed(REMOTE)
      vi.advanceTimersByTime(10 * 60_000)
    }
    const r = Number(/&r=(\d+)/.exec(proxyUrl(REMOTE) ?? '')?.[1])
    expect(r).toBe(3)
  })

  it('取得成功で失敗カウントがリセットされ、次の失敗からまた再試行できる', async () => {
    const { proxyUrl, markMediaFailed, handleMediaFetched } = await loadModule()
    for (let i = 0; i < 10; i++) {
      markMediaFailed(REMOTE)
      vi.advanceTimersByTime(10 * 60_000)
    }
    // 成功イベント → リセット (世代も 1 進む: 3 + 1 = 4)
    handleMediaFetched(REMOTE, true)
    markMediaFailed(REMOTE)
    vi.advanceTimersByTime(10 * 60_000)
    const r = Number(/&r=(\d+)/.exec(proxyUrl(REMOTE) ?? '')?.[1])
    expect(r).toBe(5)
  })

  it('失敗の完了イベント (ok=false) ではリセットしない', async () => {
    const { proxyUrl, markMediaFailed, handleMediaFetched } = await loadModule()
    for (let i = 0; i < 10; i++) {
      markMediaFailed(REMOTE)
      vi.advanceTimersByTime(10 * 60_000)
    }
    handleMediaFetched(REMOTE, false)
    markMediaFailed(REMOTE)
    vi.advanceTimersByTime(10 * 60_000)
    // ok=false の世代 bump (+1) だけで、リトライは復活しない
    const r = Number(/&r=(\d+)/.exec(proxyUrl(REMOTE) ?? '')?.[1])
    expect(r).toBe(4)
  })
})

describe('プレースホルダ滞留の自己修復 (ensurePlaceholderRecovery)', () => {
  // 二段階配信は「透明プレースホルダ → MediaFetched → 再要求」で完結するが、
  // イベントを取りこぼすと透明 GIF のまま固まり、onerror も発火しないため
  // 再試行機構 (markMediaFailed) の対象外になる。<img> の @load で
  // プレースホルダ (1×1) を掴んだことを申告し、一定時間内に世代が進まなければ
  // 自力で再要求させる
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('世代が進まないまま滞留したら自力で世代を進める', async () => {
    const { proxyUrl, ensurePlaceholderRecovery } = await loadModule()
    const base = proxyUrl(REMOTE)
    ensurePlaceholderRecovery(REMOTE)
    expect(proxyUrl(REMOTE)).toBe(base)
    vi.advanceTimersByTime(4_000)
    expect(proxyUrl(REMOTE)).toBe(`${base}&r=1`)
  })

  it('MediaFetched で世代が進んでいれば何もしない (正常経路に譲る)', async () => {
    const { proxyUrl, handleMediaFetched, ensurePlaceholderRecovery } =
      await loadModule()
    ensurePlaceholderRecovery(REMOTE)
    handleMediaFetched(REMOTE)
    expect(proxyUrl(REMOTE)).toContain('&r=1')
    vi.advanceTimersByTime(10 * 60_000)
    // watchdog による余計な bump (&r=2) は起きない
    expect(proxyUrl(REMOTE)).toContain('&r=1')
  })

  it('タイマー待ち中の重複申告は 1 本にまとまる', async () => {
    const { proxyUrl, ensurePlaceholderRecovery } = await loadModule()
    ensurePlaceholderRecovery(REMOTE)
    ensurePlaceholderRecovery(REMOTE)
    ensurePlaceholderRecovery(REMOTE)
    vi.advanceTimersByTime(10 * 60_000)
    expect(proxyUrl(REMOTE)).toContain('&r=1')
  })

  it('再要求でまたプレースホルダを掴んだら再申告できる (取得完了まで収束)', async () => {
    const { proxyUrl, ensurePlaceholderRecovery } = await loadModule()
    ensurePlaceholderRecovery(REMOTE)
    vi.advanceTimersByTime(4_000)
    expect(proxyUrl(REMOTE)).toContain('&r=1')
    // 再要求後もまだ取得中 → @load が再度申告 → もう一周
    ensurePlaceholderRecovery(REMOTE)
    vi.advanceTimersByTime(4_000)
    expect(proxyUrl(REMOTE)).toContain('&r=2')
  })

  it('自己修復は上限で打ち切る (本当に 1×1 の画像で無限ループしない)', async () => {
    const { proxyUrl, ensurePlaceholderRecovery } = await loadModule()
    // 本物が 1×1 の画像は再要求してもずっと 1×1 → 毎回 @load から申告される
    for (let i = 0; i < 10; i++) {
      ensurePlaceholderRecovery(REMOTE)
      vi.advanceTimersByTime(4_000)
    }
    const r = Number(/&r=(\d+)/.exec(proxyUrl(REMOTE) ?? '')?.[1])
    expect(r).toBe(3)
  })

  it('取得成功 (MediaFetched ok) で自己修復の試行回数がリセットされる', async () => {
    const { proxyUrl, handleMediaFetched, ensurePlaceholderRecovery } =
      await loadModule()
    for (let i = 0; i < 10; i++) {
      ensurePlaceholderRecovery(REMOTE)
      vi.advanceTimersByTime(4_000)
    }
    handleMediaFetched(REMOTE, true) // r=4
    ensurePlaceholderRecovery(REMOTE)
    vi.advanceTimersByTime(4_000)
    const r = Number(/&r=(\d+)/.exec(proxyUrl(REMOTE) ?? '')?.[1])
    expect(r).toBe(5)
  })
})

describe('プレースホルダ滞留の全画像監視 (installPlaceholderWatchdog) #892', () => {
  // 自己修復の関数を直接呼ぶのではなく、document capture の load 監視の
  // 判断そのものを検証する: 全画像の読み込みを通る位置にあるため、ここが
  // 壊れると「一部の画像がまれに空白のまま」という気づきにくい形で出る
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  /** 寸法を差し替えた要素を document に繋ぎ、load を capture へ流す */
  function dispatchLoad(
    tag: string,
    src: string | undefined,
    width?: number,
    height?: number,
  ) {
    const el = document.createElement(tag)
    if (width !== undefined) {
      Object.defineProperty(el, 'naturalWidth', { value: width })
      Object.defineProperty(el, 'naturalHeight', { value: height })
    }
    if (src !== undefined) (el as HTMLImageElement).src = src
    document.body.appendChild(el)
    el.dispatchEvent(new Event('load'))
    return el
  }

  it('1×1 (プレースホルダ) を掴んだ IMG は自己修復に乗る', async () => {
    const { proxyUrl } = await loadModule()
    const proxied = proxyUrl(REMOTE) ?? ''
    dispatchLoad('img', proxied, 1, 1)
    vi.advanceTimersByTime(4_000)
    expect(proxyUrl(REMOTE)).toContain('&r=1')
  })

  it('実画像 (非 1×1) を掴んだら自己修復に乗せない', async () => {
    const { proxyUrl } = await loadModule()
    const proxied = proxyUrl(REMOTE) ?? ''
    dispatchLoad('img', proxied, 200, 100)
    vi.advanceTimersByTime(10 * 60_000)
    expect(proxyUrl(REMOTE)).not.toContain('&r=')
  })

  it('プロキシ経由でない画像は 1×1 でも対象外', async () => {
    const { proxyUrl, ensurePlaceholderRecovery } = await loadModule()
    proxyUrl(REMOTE) // 監視を起動させる
    const direct = 'https://example.com/tracker.png'
    dispatchLoad('img', direct, 1, 1)
    vi.advanceTimersByTime(10 * 60_000)
    expect(proxyUrl(direct)).not.toContain('&r=')
    // ensurePlaceholderRecovery が生きていることの対照 (テスト自体の空振り防止)
    ensurePlaceholderRecovery(direct)
    vi.advanceTimersByTime(4_000)
    expect(proxyUrl(direct)).toContain('&r=1')
  })

  it('実画像が載ったら試行回数をリセットし、再度の滞留から修復できる', async () => {
    const { proxyUrl, ensurePlaceholderRecovery } = await loadModule()
    const proxied = proxyUrl(REMOTE) ?? ''
    // 上限まで自己修復を使い切る (count=3 で打ち切り状態)
    for (let i = 0; i < 10; i++) {
      ensurePlaceholderRecovery(REMOTE)
      vi.advanceTimersByTime(4_000)
    }
    expect(proxyUrl(REMOTE)).toContain('&r=3')
    // 実画像の load が届いたら試行回数がリセットされる
    dispatchLoad('img', proxied, 200, 100)
    ensurePlaceholderRecovery(REMOTE)
    vi.advanceTimersByTime(4_000)
    expect(proxyUrl(REMOTE)).toContain('&r=4')
  })

  it('IMG 以外の要素の load では試行回数をリセットしない', async () => {
    const { proxyUrl, ensurePlaceholderRecovery } = await loadModule()
    const proxied = proxyUrl(REMOTE) ?? ''
    for (let i = 0; i < 10; i++) {
      ensurePlaceholderRecovery(REMOTE)
      vi.advanceTimersByTime(4_000)
    }
    expect(proxyUrl(REMOTE)).toContain('&r=3')
    // video 要素は src と寸法を持つが、監視の対象は IMG だけ
    dispatchLoad('video', proxied, 200, 100)
    ensurePlaceholderRecovery(REMOTE)
    vi.advanceTimersByTime(4_000)
    // リセットされていないので打ち切り状態のまま (世代は進まない)
    expect(proxyUrl(REMOTE)).toContain('&r=3')
  })
})

describe('URL 単位の状態の追い出し (#893)', () => {
  // 失敗回数と自己修復の試行回数は「取得成功」でしか消えないため、恒久的に
  // 壊れた URL・本当に 1×1 の画像が長時間セッションで無限に積もっていた。
  // 世代番号の表 (mediaVersions) と同じ「上限で古い順に捨てる」規則を適用する
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('失敗記録は上限で古い順に捨てられ、追い出された URL は再試行できる', async () => {
    const { proxyUrl, markMediaFailed } = await loadModule()
    // リトライ上限まで失敗を積む (retries=3 で打ち切り状態)
    for (let i = 0; i < 10; i++) {
      markMediaFailed(REMOTE)
      vi.advanceTimersByTime(10 * 60_000)
    }
    // 上限 (テスト環境の既定 256) を超える数の別 URL が失敗を申告する
    for (let i = 0; i < 300; i++) {
      markMediaFailed(`https://example.com/f${i}.png`)
    }
    // 最古の REMOTE は追い出されているので、打ち切り状態が解けて再試行できる
    markMediaFailed(REMOTE)
    vi.advanceTimersByTime(10 * 60_000)
    expect(proxyUrl(REMOTE)).toContain('&r=4')
  })

  it('自己修復の試行回数は上限で古い順に捨てられる', async () => {
    const { proxyUrl, ensurePlaceholderRecovery } = await loadModule()
    // 自己修復上限まで積む (count=3 で打ち切り状態)
    for (let i = 0; i < 10; i++) {
      ensurePlaceholderRecovery(REMOTE)
      vi.advanceTimersByTime(4_000)
    }
    // 上限を超える数の別 URL が自己修復に乗る
    for (let i = 0; i < 300; i++) {
      ensurePlaceholderRecovery(`https://example.com/p${i}.png`)
    }
    vi.advanceTimersByTime(4_000)
    // 最古の REMOTE は追い出されているので、打ち切り状態が解けて再修復できる
    ensurePlaceholderRecovery(REMOTE)
    vi.advanceTimersByTime(4_000)
    expect(proxyUrl(REMOTE)).toContain('&r=1')
  })
})

describe('proxyThumbUrl', () => {
  // format は付けない: 明示すると「上限以下なら変換不要」の素通しが効かなくなる
  it('幅だけを付ける (非 Android は wait + soft も付く)', async () => {
    const { proxyThumbUrl } = await loadModule()
    expect(proxyThumbUrl(REMOTE, 56)).toBe(
      `http://ndmedia.localhost/m?url=${encodeURIComponent(REMOTE)}&w=56&wait=1&soft=1`,
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
