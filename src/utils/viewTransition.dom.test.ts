// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit'
const LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit'

// Linux 判定は import 時に 1 回だけ行うので、UA ごとに読み込み直す
async function load(ua: string, reduceMotion = false) {
  vi.resetModules()
  vi.stubGlobal('navigator', { userAgent: ua })
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) =>
      ({
        matches: reduceMotion && q === '(prefers-reduced-motion: reduce)',
        media: q,
      }) as MediaQueryList,
  )
  return (await import('./viewTransition')).withViewTransition
}

function stubStartViewTransition(result: unknown = {}) {
  const start = vi.fn((cb: () => void | Promise<void>) => {
    void cb()
    return result
  })
  Object.defineProperty(document, 'startViewTransition', {
    value: start,
    configurable: true,
  })
  return start
}

describe('withViewTransition', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    Reflect.deleteProperty(document, 'startViewTransition')
  })

  it('対応環境では startViewTransition に渡し、updateCallbackDone を返す', async () => {
    const withViewTransition = await load(MAC_UA)
    const done = Promise.resolve()
    const start = stubStartViewTransition({ updateCallbackDone: done })
    const fn = vi.fn()
    const p = withViewTransition(fn)
    expect(start).toHaveBeenCalledWith(fn)
    expect(fn).toHaveBeenCalledOnce()
    expect(p).toBe(done)
  })

  it('updateCallbackDone が無い実装でも resolve 済みの Promise を返す', async () => {
    const withViewTransition = await load(MAC_UA)
    stubStartViewTransition({})
    await expect(withViewTransition(() => undefined)).resolves.toBeUndefined()
  })

  it('startViewTransition が無ければ即時実行し、その結果を待てる', async () => {
    const withViewTransition = await load(MAC_UA)
    const order: string[] = []
    const p = withViewTransition(async () => {
      await Promise.resolve()
      order.push('fn')
    })
    await p
    order.push('after')
    expect(order).toEqual(['fn', 'after'])
  })

  it('Linux (Android 以外) では API があっても使わず即時実行する', async () => {
    const withViewTransition = await load(LINUX_UA)
    const start = stubStartViewTransition()
    const fn = vi.fn()
    await withViewTransition(fn)
    expect(fn).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })

  it('Android は Linux 扱いせず API を使う', async () => {
    const withViewTransition = await load(ANDROID_UA)
    const start = stubStartViewTransition()
    await withViewTransition(() => undefined)
    expect(start).toHaveBeenCalledOnce()
  })

  it('reduced-motion なら API を使わず即時実行する', async () => {
    const withViewTransition = await load(MAC_UA, true)
    const start = stubStartViewTransition()
    const fn = vi.fn()
    await withViewTransition(fn)
    expect(fn).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })

  it('フォールバック時に fn が同期で投げても、API 経路と同じく reject で返す', async () => {
    const withViewTransition = await load(LINUX_UA)
    await expect(
      withViewTransition(() => {
        throw new Error('sync')
      }),
    ).rejects.toThrow('sync')
  })
})
