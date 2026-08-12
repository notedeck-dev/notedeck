import JSON5 from 'json5'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Principal } from '@/permissions/principal'
import { type HistoryEntry, listSnapshots, pushSnapshot } from './historyFs'

// sidecar の実ファイルの代わりにメモリ 1 本を使う (Tauri 非依存)
let sidecar: string | null = null

vi.mock('./settingsFs', () => ({
  readHistorySidecar: vi.fn(async () => sidecar),
  writeHistorySidecar: vi.fn(
    async (_kind: string, _base: string, content: string) => {
      sidecar = content
    },
  ),
}))

const user: Principal = { kind: 'user' }
const ai: Principal = { kind: 'ai.chat' }

async function entries(): Promise<HistoryEntry<{ body: string }>[]> {
  return await listSnapshots<{ body: string }>('skill', 'my-skill')
}

async function push(
  body: string,
  attribution?: { by?: Principal; reason?: string },
): Promise<void> {
  await pushSnapshot('skill', 'my-skill', { body }, attribution)
}

describe('pushSnapshot', () => {
  beforeEach(() => {
    sidecar = null
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T00:00:00Z'))
  })

  it('帰属と理由を snapshot と一緒に記録する', async () => {
    await push('前の本文', { by: ai, reason: 'フック名の乖離を直すため' })
    expect(await entries()).toEqual([
      {
        at: Date.now(),
        snapshot: { body: '前の本文' },
        by: ai,
        reason: 'フック名の乖離を直すため',
      },
    ])
  })

  it('帰属を渡さない経路では欄を作らない (前方互換の読み方を崩さない)', async () => {
    await push('前の本文')
    const [entry] = await entries()
    expect(entry).toEqual({ at: Date.now(), snapshot: { body: '前の本文' } })
  })

  it('本人の連続した自動保存は畳んで積まない', async () => {
    await push('編集セッション前', { by: user })
    vi.advanceTimersByTime(20_000)
    await push('打鍵の途中', { by: user })
    vi.advanceTimersByTime(20_000)
    await push('打鍵の途中 2', { by: user })

    const list = await entries()
    expect(list).toHaveLength(1)
    // 残るのは「編集セッションに入る前の状態」
    expect(list[0]?.snapshot).toEqual({ body: '編集セッション前' })
  })

  it('窓を越えた保存は別の区切りとして積む', async () => {
    await push('一世代前', { by: user })
    vi.advanceTimersByTime(120_000)
    await push('直前', { by: user })
    expect(await entries()).toHaveLength(2)
  })

  it('AI の連続した編集は理由ごとに積む', async () => {
    await push('一世代前', { by: ai, reason: '理由 A' })
    vi.advanceTimersByTime(1_000)
    await push('直前', { by: ai, reason: '理由 B' })

    const list = await entries()
    expect(list.map((e) => e.reason)).toEqual(['理由 B', '理由 A'])
  })

  it('上限を超えたら本人の理由なし編集から落ちる (AI の編集は残る)', async () => {
    await push('AI が触る前', { by: ai, reason: 'AI の編集' })
    // 畳まれないよう窓を越えながら上限 (30) を超えるまで手編集を積む
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersByTime(120_000)
      await push(`手編集 ${i}`, { by: user })
    }

    const list = await entries()
    expect(list).toHaveLength(30)
    expect(list.some((e) => e.reason === 'AI の編集')).toBe(true)
  })

  it('壊れた sidecar は履歴なしとして扱い、書込を止めない', async () => {
    sidecar = '{ this is not json5 ['
    await push('前の本文', { by: user })
    expect(await entries()).toHaveLength(1)
  })

  it('保存内容は JSON5 として読み直せる', async () => {
    await push('前の本文', { by: ai, reason: '理由' })
    expect(() => JSON5.parse(sidecar ?? '')).not.toThrow()
  })
})
