// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoopbackClassification } from '@/bindings'
import type { ConfirmOptions } from '@/stores/confirm'
import {
  gateLoopbackFetch,
  type LoopbackGateDeps,
  loopbackReasonFromCode,
  loopbackRequestLine,
} from './loopbackGate'

vi.mock('@/stores/plugins', () => ({
  usePluginsStore: () => ({ get: () => undefined }),
}))

function classification(
  over: Partial<LoopbackClassification> = {},
): LoopbackClassification {
  return {
    loopback: true,
    port: 8080,
    alwaysDenied: false,
    declared: true,
    granted: false,
    stale: false,
    ...over,
  }
}

function deps(over: Partial<LoopbackGateDeps> = {}): LoopbackGateDeps & {
  grants: [string, number, string][]
  confirms: ConfirmOptions[]
} {
  const grants: [string, number, string][] = []
  const confirms: ConfirmOptions[] = []
  return {
    grants,
    confirms,
    classify: async () => classification(),
    grant: async (id, port, hash) => {
      grants.push([id, port, hash])
    },
    confirm: async (opts) => {
      confirms.push(opts)
      return { accepted: true, remember: false }
    },
    describePlugin: () => ({ name: 'Alpha', author: 'alice' }),
    ...over,
  }
}

const plugin = { kind: 'plugin', pluginId: 'p1', name: 'Alpha' } as const
const url = 'http://localhost:8080/translate?q=x'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('gateLoopbackFetch (#1293)', () => {
  it('loopback 宛でなければ分類も呼ばずに通す', async () => {
    const d = deps({
      classify: async () => {
        throw new Error('must not classify')
      },
    })
    const r = await gateLoopbackFetch(
      { url: 'https://example.com/' },
      { principal: plugin, origin: 'ui' },
      {},
      d,
    )
    expect(r).toEqual({ kind: 'pass', port: null })
  })

  it('連鎖に自分以外の principal が居れば一律拒否 (AI / 別のプラグイン / 外部)', async () => {
    const d = deps()
    for (const caller of [
      { kind: 'ai.chat' } as const,
      { kind: 'plugin', pluginId: 'p2' } as const,
      { kind: 'external', tokenId: 't' } as const,
    ]) {
      const r = await gateLoopbackFetch(
        { url },
        { principal: plugin, onBehalfOf: [caller], origin: 'ui' },
        {},
        d,
      )
      expect(r).toEqual({ kind: 'denied', port: 8080, reason: 'chain' })
    }
    // 自分の Nd:call で積まれた自分自身は除く
    const self = await gateLoopbackFetch(
      { url },
      { principal: plugin, onBehalfOf: [plugin], origin: 'ui' },
      {},
      deps({ classify: async () => classification({ granted: true }) }),
    )
    expect(self).toEqual({ kind: 'pass', port: 8080 })
    expect(d.confirms).toHaveLength(0)
  })

  it('ウィジェット / Play / Page と、常に拒否するポートは分類の前に拒否', async () => {
    const d = deps({
      classify: async () => {
        throw new Error('must not classify')
      },
    })
    const widget = await gateLoopbackFetch(
      { url },
      { principal: { kind: 'plugin', pluginId: 'widget:w1' }, origin: 'ui' },
      {},
      d,
    )
    expect(widget).toEqual({
      kind: 'denied',
      port: 8080,
      reason: 'notEligible',
    })
    const self = await gateLoopbackFetch(
      { url: 'http://127.0.0.1:19820/api' },
      { principal: plugin, origin: 'ui' },
      {},
      d,
    )
    expect(self).toEqual({ kind: 'denied', port: 19820, reason: 'selfPort' })
  })

  it('宣言が無い / 本文が古い / Rust が自アプリのポートと言う → 確認を出さず拒否', async () => {
    for (const [over, reason] of [
      [{ declared: false }, 'undeclared'],
      [{ stale: true }, 'stale'],
      [{ alwaysDenied: true, declared: false }, 'selfPort'],
    ] as const) {
      const d = deps({ classify: async () => classification(over) })
      const r = await gateLoopbackFetch(
        { url },
        { principal: plugin, origin: 'ui', pluginBodyHash: 'h' },
        {},
        d,
      )
      expect(r).toEqual({ kind: 'denied', port: 8080, reason })
      expect(d.confirms).toHaveLength(0)
    }
  })

  it('未同意 × UI 起点 → 同意ダイアログ。承認 = grant の記録で、その要求の確認を兼ねる', async () => {
    const d = deps()
    const r = await gateLoopbackFetch(
      { url, method: 'post' },
      { principal: plugin, origin: 'ui', pluginBodyHash: 'hash1' },
      {},
      d,
    )
    expect(r).toEqual({ kind: 'consented', port: 8080 })
    expect(d.grants).toEqual([['p1', 8080, 'hash1']])
    expect(d.confirms).toHaveLength(1)
    const opts = d.confirms[0] as ConfirmOptions
    expect(opts.title).toContain('Alpha')
    expect(opts.title).toContain('8080')
    // method と path は見せ、query は見せない
    expect(opts.message).toContain('POST /translate')
    expect(opts.message).not.toContain('q=x')
    expect(opts.message).toContain('alice')
    expect(opts.trusted).toBe(true)
    // 「今後確認しない」は出さない
    expect(opts.rememberLabel).toBeUndefined()
    expect(opts.dedupKey).toBeUndefined()
  })

  it('未同意 × UI 起点でない (top-level / Nd:on / interval / capability / preConfirmed) → 拒否', async () => {
    const d = deps()
    const other = await gateLoopbackFetch(
      { url },
      { principal: plugin, origin: 'other' },
      {},
      d,
    )
    expect(other).toEqual({ kind: 'denied', port: 8080, reason: 'notGranted' })
    const pre = await gateLoopbackFetch(
      { url },
      { principal: plugin, origin: 'ui' },
      { preConfirmed: true },
      d,
    )
    expect(pre).toEqual({ kind: 'denied', port: 8080, reason: 'notGranted' })
    expect(d.confirms).toHaveLength(0)
  })

  it('キャンセルは cancelled、grant が拒まれたら本文が古いとして拒否', async () => {
    const cancelled = await gateLoopbackFetch(
      { url },
      { principal: plugin, origin: 'ui' },
      {},
      deps({ confirm: async () => ({ accepted: false, remember: false }) }),
    )
    expect(cancelled).toEqual({ kind: 'cancelled', port: 8080 })
    const refused = await gateLoopbackFetch(
      { url },
      { principal: plugin, origin: 'ui' },
      {},
      deps({
        grant: async () => {
          throw new Error('body changed')
        },
      }),
    )
    expect(refused).toEqual({ kind: 'denied', port: 8080, reason: 'stale' })
  })

  it('同意済みなら従来の確認に戻る (pass)', async () => {
    const d = deps({ classify: async () => classification({ granted: true }) })
    const r = await gateLoopbackFetch(
      { url },
      { principal: plugin, origin: 'other' },
      {},
      d,
    )
    expect(r).toEqual({ kind: 'pass', port: 8080 })
    expect(d.confirms).toHaveLength(0)
  })

  it('同じプラグイン × ポートの同意ダイアログは同時に 1 枚。待っていた要求は分類をやり直す', async () => {
    let granted = false
    let release: (() => void) | null = null
    const d = deps({
      classify: async () => classification({ granted }),
      confirm: async (opts) => {
        d.confirms.push(opts)
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { accepted: true, remember: false }
      },
      grant: async () => {
        granted = true
      },
    })
    const ctx = { principal: plugin, origin: 'ui' as const }
    const first = gateLoopbackFetch({ url }, ctx, {}, d)
    await Promise.resolve()
    const second = gateLoopbackFetch({ url, method: 'DELETE' }, ctx, {}, d)
    await Promise.resolve()
    expect(d.confirms).toHaveLength(1)
    ;(release as unknown as () => void)()
    expect(await first).toEqual({ kind: 'consented', port: 8080 })
    // 2 件目は一括承認されず、同意済みとして従来の確認 (pass) に進む
    expect(await second).toEqual({ kind: 'pass', port: 8080 })
    expect(d.confirms).toHaveLength(1)
  })
})

describe('loopback の補助', () => {
  it('Rust の code を理由に写す', () => {
    expect(loopbackReasonFromCode('LOOPBACK_UNDECLARED')).toBe('undeclared')
    expect(loopbackReasonFromCode('LOOPBACK_STALE')).toBe('stale')
    expect(loopbackReasonFromCode('LOOPBACK_NOT_GRANTED')).toBe('notGranted')
    expect(loopbackReasonFromCode('LOOPBACK_SELF_PORT')).toBe('selfPort')
    expect(loopbackReasonFromCode('LOOPBACK_NOT_ELIGIBLE')).toBe('notEligible')
    expect(loopbackReasonFromCode('INVALID_INPUT')).toBeNull()
    expect(loopbackReasonFromCode(undefined)).toBeNull()
  })

  it('運用ログの行は method と path だけ (query 無し)', () => {
    expect(loopbackRequestLine({ url, method: 'get' })).toBe('GET /translate')
    expect(loopbackRequestLine({ url: 'nope' })).toBe('GET /')
  })
})
