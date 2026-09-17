import { describe, expect, it } from 'vitest'
import {
  isReadOnlyPermissions,
  PET_PULSE_DURATION_MS,
  type PetActivityCounts,
  resolvePetState,
} from './petActivity'

const quiet: PetActivityCounts = { waiting: 0, running: 0, review: 0 }

describe('petActivity: resolvePetState', () => {
  it('何もなければ idle', () => {
    expect(resolvePetState(quiet, null, 1000)).toBe('idle')
  })

  it('running > review > idle の順で恒常状態を選ぶ', () => {
    expect(resolvePetState({ ...quiet, review: 1 }, null, 0)).toBe('review')
    expect(resolvePetState({ ...quiet, review: 1, running: 1 }, null, 0)).toBe(
      'running',
    )
  })

  it('承認待ちは何よりも優先', () => {
    expect(
      resolvePetState(
        { waiting: 1, running: 2, review: 1 },
        { state: 'failed', until: 9999 },
        0,
      ),
    ).toBe('waiting')
  })

  it('一発ものは期限内なら恒常状態に割り込む', () => {
    const pulse = { state: 'jumping' as const, until: 700 }
    expect(resolvePetState({ ...quiet, running: 1 }, pulse, 100)).toBe(
      'jumping',
    )
    expect(resolvePetState({ ...quiet, running: 1 }, pulse, 700)).toBe(
      'running',
    )
  })

  it('期限切れの一発ものは無視されて idle に戻る', () => {
    expect(resolvePetState(quiet, { state: 'waving', until: 500 }, 501)).toBe(
      'idle',
    )
  })

  it('一発ものの表示時間は本家のアニメ 1 周分', () => {
    // failed 8 コマ: 140×7 + 240 = 1220ms (petdex desktop と同じ)
    expect(PET_PULSE_DURATION_MS.failed).toBe(1220)
    // waving 4 コマ: 140×3 + 280 = 700ms
    expect(PET_PULSE_DURATION_MS.waving).toBe(700)
    // jumping 5 コマ: 140×4 + 280 = 840ms
    expect(PET_PULSE_DURATION_MS.jumping).toBe(840)
  })
})

describe('petActivity: isReadOnlyPermissions', () => {
  it('read 系だけ (または権限不要) なら true', () => {
    expect(isReadOnlyPermissions([])).toBe(true)
    expect(isReadOnlyPermissions(['notes.read'])).toBe(true)
    expect(isReadOnlyPermissions(['notes.readArchive', 'deck.read'])).toBe(true)
  })

  it('書き込み系が 1 つでもあれば false', () => {
    expect(isReadOnlyPermissions(['notes.read', 'notes.write'])).toBe(false)
    expect(isReadOnlyPermissions(['notes.react'])).toBe(false)
    expect(isReadOnlyPermissions(['clipboard'])).toBe(false)
  })
})
