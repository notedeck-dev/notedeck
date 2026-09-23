import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmDecision, ConfirmOptions } from '@/stores/confirm'
import {
  _resetConfirmRequestsForTest,
  bundleConfirmOptions,
  closeConfirmRequest,
  closeConfirmRequestsForTurn,
  presentConfirmRequest,
} from './aiConfirmRequests'
import type { AiConfirmItem } from './useAiTurn'

// --- mocks ---

type Pending = {
  opts: ConfirmOptions
  signal?: AbortSignal
  resolve: (d: ConfirmDecision) => void
}
const pending: Pending[] = []
vi.mock('@/stores/confirm', () => ({
  useConfirm: () => ({
    confirmWithDecision: (opts: ConfirmOptions, signal?: AbortSignal) =>
      new Promise<ConfirmDecision>((resolve) => {
        const entry = { opts, signal, resolve }
        pending.push(entry)
        signal?.addEventListener('abort', () =>
          resolve({ accepted: false, remember: false }),
        )
        opts.onShow?.()
      }),
  }),
}))

const rememberConfirmation = vi.fn(async () => undefined)
vi.mock('@/capabilities/dispatcher', () => ({
  rememberConfirmation: (...args: unknown[]) =>
    rememberConfirmation(...(args as [])),
}))

const aiConfirmRespond = vi.fn(async (_id: string, _accepted: boolean) => ({
  status: 'ok' as const,
  data: null,
}))
const aiConfirmShown = vi.fn(async (_id: string) => ({
  status: 'ok' as const,
  data: null,
}))
vi.mock('@/utils/tauriInvoke', async () => {
  const actual = await vi.importActual<typeof import('@/utils/tauriInvoke')>(
    '@/utils/tauriInvoke',
  )
  return {
    unwrap: actual.unwrap,
    commands: {
      aiConfirmRespond: (id: string, accepted: boolean) =>
        aiConfirmRespond(id, accepted),
      aiConfirmShown: (id: string) => aiConfirmShown(id),
    },
  }
})

const waiting = { begun: 0, ended: 0 }
vi.mock('@/stores/aiActivity', () => ({
  useAiActivity: () => ({
    begin: () => {
      waiting.begun++
      return () => {
        waiting.ended++
      }
    },
  }),
}))

function item(over: Partial<AiConfirmItem> = {}): AiConfirmItem {
  return {
    toolUseId: 'tu1',
    capabilityId: 'notes.create',
    params: { text: 'hi' },
    preview: {
      title: '投稿しますか?',
      message: 'hi',
      rememberLabel: '今後この操作を確認しない',
      attribution: 'AI',
    },
    allowRemember: true,
    ...over,
  }
}

function noop(): void {
  // 表示フックのダミー
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  pending.length = 0
  rememberConfirmation.mockClear()
  aiConfirmRespond.mockClear()
  aiConfirmShown.mockClear()
  waiting.begun = 0
  waiting.ended = 0
  _resetConfirmRequestsForTest()
})

describe('bundleConfirmOptions (#1133: 1 ラウンドの複数呼び出しを 1 枚に)', () => {
  it('1 件ならプレビューをそのまま使い、remember 不可なら外す', () => {
    const one = bundleConfirmOptions([item({ allowRemember: false })], noop)
    expect(one.title).toBe('投稿しますか?')
    expect(one.rememberLabel).toBeUndefined()
    expect(bundleConfirmOptions([item()], noop).rememberLabel).toBe(
      '今後この操作を確認しない',
    )
  })

  it('複数件は番号付きの一覧にまとめ、diff は 1 件だけのときに載せる', () => {
    const opts = bundleConfirmOptions(
      [
        item({ toolUseId: 'a' }),
        item({
          toolUseId: 'b',
          capabilityId: 'skills.write',
          preview: {
            title: 'skill を書き換えますか?',
            message: '',
            diff: { old: 'x', new: 'y' },
          },
          allowRemember: false,
        }),
      ],
      noop,
    )
    expect(opts.title).toBe('2 件の操作の許可を求めています')
    expect(opts.message).toBe(
      '1. 投稿しますか?\nhi\n\n2. skill を書き換えますか?',
    )
    expect(opts.diff).toEqual({ old: 'x', new: 'y' })
    expect(opts.okLabel).toBe('すべて実行')
    expect(opts.trusted).toBe(true)
    expect(opts.attribution).toBe('AI')
    expect(opts.rememberLabel).toBe('今後これらの操作を確認しない')
  })
})

describe('presentConfirmRequest', () => {
  it('表示を notecore に伝え、許可 + remember なら記憶してから応答する', async () => {
    const run = presentConfirmRequest({
      requestId: 'req-1',
      turnId: 't1',
      principal: 'ai.chat',
      accountId: 'acc-1',
      items: [item(), item({ toolUseId: 'tu2', allowRemember: false })],
    })
    await flush()
    expect(aiConfirmShown).toHaveBeenCalledWith('req-1')
    expect(waiting.begun).toBe(1)
    pending[0]?.resolve({ accepted: true, remember: true })
    await run
    // remember は allowRemember の項目だけ
    expect(rememberConfirmation).toHaveBeenCalledOnce()
    expect(rememberConfirmation).toHaveBeenCalledWith(
      'notes.create',
      { text: 'hi' },
      { principal: { kind: 'ai.chat' }, accountId: 'acc-1' },
    )
    expect(aiConfirmRespond).toHaveBeenCalledWith('req-1', true)
    expect(waiting.ended).toBe(1)
  })

  it('拒否は記憶せず false で応答する', async () => {
    const run = presentConfirmRequest({
      requestId: 'req-2',
      turnId: 't1',
      principal: 'ai.chat',
      items: [item()],
    })
    await flush()
    pending[0]?.resolve({ accepted: false, remember: true })
    await run
    expect(rememberConfirmation).not.toHaveBeenCalled()
    expect(aiConfirmRespond).toHaveBeenCalledWith('req-2', false)
  })

  it('notecore が閉じた要求 (期限切れ / 中断) は畳んで応答しない', async () => {
    const run = presentConfirmRequest({
      requestId: 'req-3',
      turnId: 't1',
      principal: 'ai.chat',
      items: [item()],
    })
    await flush()
    closeConfirmRequest('req-3')
    await run
    expect(aiConfirmRespond).not.toHaveBeenCalled()

    const run2 = presentConfirmRequest({
      requestId: 'req-4',
      turnId: 't2',
      principal: 'ai.chat',
      items: [item()],
    })
    await flush()
    closeConfirmRequestsForTurn('t2')
    await run2
    expect(aiConfirmRespond).not.toHaveBeenCalled()
    expect(waiting.ended).toBe(2)
  })

  it('遅れた応答のエラーは握りつぶさず warn に残す', async () => {
    aiConfirmRespond.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'invalid_input', message: '確認要求は既に決着しています' },
    } as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop)
    const run = presentConfirmRequest({
      requestId: 'req-5',
      turnId: 't1',
      principal: 'ai.chat',
      items: [item()],
    })
    await flush()
    pending[0]?.resolve({ accepted: true, remember: false })
    await run
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
