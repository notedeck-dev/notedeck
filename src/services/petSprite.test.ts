import { describe, expect, it } from 'vitest'
import {
  clampPetScale,
  detectPetAtlas,
  PET_FRAME_HEIGHT,
  PET_FRAME_WIDTH,
  PET_STATES,
  type PetState,
  parsePetSlugInput,
  petFrames,
  petHitClipPath,
  petStateRow,
} from './petSprite'

describe('petSprite: atlas layout', () => {
  it('9 行の v1 と 11 行の v2 を寸法から判定する', () => {
    expect(detectPetAtlas(8 * PET_FRAME_WIDTH, 9 * PET_FRAME_HEIGHT)).toEqual({
      version: 1,
      rows: 9,
      scale: 1,
    })
    expect(detectPetAtlas(8 * PET_FRAME_WIDTH, 11 * PET_FRAME_HEIGHT)).toEqual({
      version: 2,
      rows: 11,
      scale: 1,
    })
  })

  it('整数倍に縮小されたシートも受け付ける', () => {
    expect(
      detectPetAtlas((8 * PET_FRAME_WIDTH) / 2, (9 * PET_FRAME_HEIGHT) / 2),
    ).toEqual({ version: 1, rows: 9, scale: 0.5 })
  })

  it('グリッドに乗らない寸法は null', () => {
    expect(detectPetAtlas(1000, 1000)).toBeNull()
    expect(detectPetAtlas(0, 9 * PET_FRAME_HEIGHT)).toBeNull()
    expect(
      detectPetAtlas(8 * PET_FRAME_WIDTH + 1, 9 * PET_FRAME_HEIGHT),
    ).toBeNull()
  })
})

describe('petSprite: state rows and frames', () => {
  it('9 状態が petdex の行順で並ぶ', () => {
    const rows = PET_STATES.map((s) => petStateRow(s))
    expect(rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(petStateRow('idle')).toBe(0)
    expect(petStateRow('review')).toBe(8)
  })

  it('各状態のコマ列は 8 列以内で表示時間が正', () => {
    for (const s of PET_STATES) {
      const frames = petFrames(s)
      expect(frames.length).toBeGreaterThan(0)
      expect(frames.length).toBeLessThanOrEqual(8)
      for (const f of frames) {
        expect(f.col).toBeGreaterThanOrEqual(0)
        expect(f.col).toBeLessThan(8)
        expect(f.durationMs).toBeGreaterThan(0)
      }
    }
  })

  it('idle は 6 コマで最初と最後が長い (本家の表と同じ)', () => {
    const frames = petFrames('idle')
    expect(frames).toHaveLength(6)
    expect(frames[0]?.durationMs).toBe(280)
    expect(frames[5]?.durationMs).toBe(320)
  })

  it('uniform 系は最後のコマだけ長い', () => {
    const frames = petFrames('waving' satisfies PetState)
    expect(frames).toHaveLength(4)
    expect(frames.slice(0, -1).every((f) => f.durationMs === 140)).toBe(true)
    expect(frames[3]?.durationMs).toBe(280)
  })
})

describe('petSprite: parsePetSlugInput', () => {
  it('slug をそのまま受ける', () => {
    expect(parsePetSlugInput('boba')).toBe('boba')
    expect(parsePetSlugInput('  Boba  ')).toBe('boba')
    expect(parsePetSlugInput('mecha-xiaobai')).toBe('mecha-xiaobai')
  })

  it('petdex.dev のペット URL から slug を取り出す', () => {
    expect(parsePetSlugInput('https://petdex.dev/pets/boba')).toBe('boba')
    expect(parsePetSlugInput('https://petdex.dev/en/pets/boba/')).toBe('boba')
    expect(parsePetSlugInput('https://www.petdex.dev/pets/boba?x=1')).toBe(
      'boba',
    )
    expect(parsePetSlugInput('petdex://boba')).toBe('boba')
  })

  it('slug の形に合わないものは null', () => {
    expect(parsePetSlugInput('')).toBeNull()
    expect(parsePetSlugInput('-bad')).toBeNull()
    expect(parsePetSlugInput('has space')).toBeNull()
    expect(parsePetSlugInput('https://example.com/pets/boba')).toBeNull()
    expect(parsePetSlugInput('https://petdex.dev/collections/x')).toBeNull()
    expect(parsePetSlugInput('a'.repeat(64))).toBeNull()
  })
})

describe('petSprite: clampPetScale', () => {
  it('未設定・非数は既定の 0.75', () => {
    expect(clampPetScale(undefined)).toBe(0.75)
    expect(clampPetScale(Number.NaN)).toBe(0.75)
    expect(clampPetScale('1')).toBe(0.75)
  })

  it('範囲内はそのまま、範囲外は端に丸める', () => {
    expect(clampPetScale(1)).toBe(1)
    expect(clampPetScale(0.1)).toBe(0.25)
    expect(clampPetScale(5)).toBe(2)
  })
})

describe('petSprite: hit mask → clip-path', () => {
  const mask = { cols: 48, rows: 52, runs: [[12, 24, 2, 13, 0, 48], []] }

  it('ランをコマ寸法に合わせた矩形の path() にする', () => {
    // 144×156 (0.75 倍) → ブロックは 3×3px
    expect(petHitClipPath(mask, 0, 144, 156)).toBe(
      'path("M72 36h6v3h-6zM0 39h144v3h-144z")',
    )
  })

  it('倍率が変わると座標だけ変わる', () => {
    expect(petHitClipPath(mask, 0, 192, 208)).toBe(
      'path("M96 48h8v4h-8zM0 52h192v4h-192z")',
    )
  })

  it('ランが無い行と範囲外の行は null (clip を付けない)', () => {
    expect(petHitClipPath(mask, 1, 144, 156)).toBeNull()
    expect(petHitClipPath(mask, 5, 144, 156)).toBeNull()
  })

  it('端数の座標は小数 2 桁に丸める', () => {
    expect(petHitClipPath(mask, 0, 100, 100)).toBe(
      'path("M50 23.08h4.17v1.92h-4.17zM0 25h100v1.92h-100z")',
    )
  })
})
