import { describe, expect, it } from 'vitest'
import {
  PERMISSION_CATEGORIES,
  PERMISSION_LABELS,
  presetChipLabel,
} from './labels'
import {
  EXTERNAL_DEFAULT_PROFILE,
  PERMISSION_KEYS,
  type PermissionsConfig,
  PLUGIN_DEFAULT_PROFILE,
  resolvePermissions,
} from './schema'

describe('PERMISSION_CATEGORIES', () => {
  it('カテゴリ見出しが全キーを漏れなく重複なく網羅する', () => {
    const keys = PERMISSION_CATEGORIES.flatMap((c) => c.keys)
    expect(keys.length).toBe(PERMISSION_KEYS.length)
    expect(new Set(keys).size).toBe(PERMISSION_KEYS.length)
    for (const key of PERMISSION_KEYS) {
      expect(keys, key).toContain(key)
    }
  })

  it('全キーにラベルがある', () => {
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSION_LABELS[key]?.label, key).toBeTruthy()
    }
  })
})

describe('presetChipLabel (#712 §8.1 — 「custom」を無情報ラベルにしない)', () => {
  it('preset は選択肢のラベルそのまま', () => {
    expect(
      presetChipLabel({ preset: 'readonly', custom: {} as never }),
    ).toContain('読取のみ')
    expect(presetChipLabel({ preset: 'full', custom: {} as never })).toContain(
      'フル',
    )
  })

  it('EXTERNAL_DEFAULT_PROFILE と一致する custom は「標準 — Misskey read のみ」', () => {
    const profile: PermissionsConfig = {
      preset: 'custom',
      custom: { ...EXTERNAL_DEFAULT_PROFILE.custom },
    }
    expect(presetChipLabel(profile)).toBe('標準 — Misskey read のみ')
  })

  it('PLUGIN_DEFAULT_PROFILE と一致する custom は「標準 — 安全 + 外部ネットワーク」', () => {
    const profile: PermissionsConfig = {
      preset: 'custom',
      custom: { ...PLUGIN_DEFAULT_PROFILE.custom },
    }
    expect(presetChipLabel(profile)).toBe('標準 — 安全 + 外部ネットワーク')
  })

  it('その他の custom は許可数付き (「カスタム — 許可 N / 総キー数」)', () => {
    const custom = resolvePermissions({
      preset: 'safe',
      custom: {} as never,
    })
    const label = presetChipLabel({ preset: 'custom', custom })
    expect(label).toMatch(
      new RegExp(`^カスタム — 許可 \\d+ / ${PERMISSION_KEYS.length}$`),
    )
    // 1 つトグルすると一致が外れて件数が変わる
    custom['notes.write'] = true
    const label2 = presetChipLabel({ preset: 'custom', custom })
    expect(label2).not.toBe(label)
  })
})
