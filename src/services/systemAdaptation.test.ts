import { describe, expect, it } from 'vitest'
import type { SystemState } from '@/bindings'
import {
  deriveAdaptation,
  describeAdaptationEntry,
  NO_ADAPTATION,
} from '@/services/systemAdaptation'

const NONE: SystemState = {
  onBattery: null,
  lowPowerMode: null,
  metered: null,
  doNotDisturb: null,
}

describe('deriveAdaptation', () => {
  it('取れない項目 (null) はすべて通常どおり', () => {
    expect(deriveAdaptation(NONE, true)).toEqual(NO_ADAPTATION)
  })

  it('バッテリー駆動なら先読みと絵文字アニメを止め、メディアは自動読み込みのまま', () => {
    const a = deriveAdaptation({ ...NONE, onBattery: true }, true)
    expect(a).toEqual({
      suppressPrefetch: true,
      staticEmoji: true,
      deferMedia: false,
      muteSounds: false,
    })
  })

  it('省電力モードはバッテリー駆動と同じ扱い', () => {
    expect(deriveAdaptation({ ...NONE, lowPowerMode: true }, true)).toEqual(
      deriveAdaptation({ ...NONE, onBattery: true }, true),
    )
  })

  it('従量制回線なら先読みを止めてメディアはタップ読み込み、絵文字アニメは動く', () => {
    const a = deriveAdaptation({ ...NONE, metered: true }, true)
    expect(a).toEqual({
      suppressPrefetch: true,
      staticEmoji: false,
      deferMedia: true,
      muteSounds: false,
    })
  })

  it('AC 接続 (false) は何も落とさない', () => {
    expect(
      deriveAdaptation(
        {
          onBattery: false,
          lowPowerMode: false,
          metered: false,
          doNotDisturb: false,
        },
        true,
      ),
    ).toEqual(NO_ADAPTATION)
  })

  it('自動調整 OFF なら電源・回線は無視する', () => {
    const a = deriveAdaptation(
      { ...NONE, onBattery: true, lowPowerMode: true, metered: true },
      false,
    )
    expect(a).toEqual(NO_ADAPTATION)
  })

  it('集中モードの通知音停止は自動調整 OFF でも効く (#928: 設定に依らない)', () => {
    expect(
      deriveAdaptation({ ...NONE, doNotDisturb: true }, false).muteSounds,
    ).toBe(true)
    expect(
      deriveAdaptation({ ...NONE, doNotDisturb: true }, true).muteSounds,
    ).toBe(true)
  })
})

describe('describeAdaptationEntry', () => {
  it('落とし始めたときだけ知らせ、抜けるときと変化なしは黙る', () => {
    const battery = deriveAdaptation({ ...NONE, onBattery: true }, true)
    expect(
      describeAdaptationEntry(NO_ADAPTATION, battery, {
        ...NONE,
        onBattery: true,
      }),
    ).toMatch(/バッテリー駆動/)
    expect(
      describeAdaptationEntry(battery, battery, { ...NONE, onBattery: true }),
    ).toBeNull()
    expect(describeAdaptationEntry(battery, NO_ADAPTATION, NONE)).toBeNull()
  })

  it('省電力モードはその旨を言う', () => {
    const state = { ...NONE, lowPowerMode: true }
    expect(
      describeAdaptationEntry(
        NO_ADAPTATION,
        deriveAdaptation(state, true),
        state,
      ),
    ).toMatch(/省電力モード/)
  })

  it('従量制は電源より優先して伝える (見た目の変化が大きい方)', () => {
    const state = { ...NONE, onBattery: true, metered: true }
    expect(
      describeAdaptationEntry(
        NO_ADAPTATION,
        deriveAdaptation(state, true),
        state,
      ),
    ).toMatch(/従量制回線/)
  })

  it('集中モードは何も言わない', () => {
    const state = { ...NONE, doNotDisturb: true }
    expect(
      describeAdaptationEntry(
        NO_ADAPTATION,
        deriveAdaptation(state, true),
        state,
      ),
    ).toBeNull()
  })
})
