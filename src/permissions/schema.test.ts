import { describe, expect, it } from 'vitest'
import {
  backfillValue,
  EXTERNAL_DEFAULT_PROFILE,
  LOCAL_READ_KEYS,
  normalizeProfile,
  PERMISSION_KEYS,
  PERMISSION_PRESETS,
  type PermissionsConfig,
  presetFromMap,
  resolvePermissions,
  setPermissionPreset,
} from './schema'

describe('resolvePermissions', () => {
  it('safe preset enables react/clipboard/notifications but not write operations', () => {
    const resolved = resolvePermissions({
      preset: 'safe',
      custom: {} as PermissionsConfig['custom'],
    })
    expect(resolved['notes.react']).toBe(true)
    expect(resolved.clipboard).toBe(true)
    expect(resolved.notifications).toBe(true)
    expect(resolved['notes.write']).toBe(false)
    expect(resolved['network.external']).toBe(false)
  })

  it('full preset enables all permissions including network.external', () => {
    const resolved = resolvePermissions({
      preset: 'full',
      custom: {} as PermissionsConfig['custom'],
    })
    for (const key of PERMISSION_KEYS) {
      expect(resolved[key], `${key} must be true on full`).toBe(true)
    }
  })

  it('custom preset returns the custom map verbatim', () => {
    const custom = resolvePermissions({
      preset: 'safe',
      custom: {} as PermissionsConfig['custom'],
    })
    custom['network.external'] = true
    const resolved = resolvePermissions({ preset: 'custom', custom })
    expect(resolved['network.external']).toBe(true)
    expect(resolved['notes.write']).toBe(false)
  })

  it.each([
    'readonly',
    'safe',
    'full',
  ] as const)('every PERMISSION_KEYS entry has a boolean in the %s preset', (preset) => {
    const resolved = resolvePermissions({
      preset,
      custom: {} as PermissionsConfig['custom'],
    })
    for (const key of PERMISSION_KEYS) {
      expect(typeof resolved[key], `permissions.${key} on ${preset}`).toBe(
        'boolean',
      )
    }
  })

  it('deck.read は全 preset で true (column 系の従来 ungated 挙動の保存 #712 §5.3)', () => {
    for (const preset of ['readonly', 'safe', 'full'] as const) {
      const resolved = resolvePermissions({
        preset,
        custom: {} as PermissionsConfig['custom'],
      })
      expect(resolved['deck.read'], `deck.read on ${preset}`).toBe(true)
    }
  })
})

describe('setPermissionPreset', () => {
  it('switching from readonly to safe replaces custom with safe defaults', () => {
    const next = setPermissionPreset(
      { preset: 'readonly', custom: {} as PermissionsConfig['custom'] },
      'safe',
    )
    expect(next.preset).toBe('safe')
    expect(next.custom['notes.react']).toBe(true)
    expect(next.custom.clipboard).toBe(true)
  })

  it('switching to custom pre-fills custom from the previously resolved preset', () => {
    const next = setPermissionPreset(
      { preset: 'safe', custom: {} as PermissionsConfig['custom'] },
      'custom',
    )
    expect(next.preset).toBe('custom')
    expect(next.custom['notes.react']).toBe(true)
    expect(next.custom['notes.write']).toBe(false)
  })
})

describe('normalizeProfile — custom map の backfill (#712 §4.4)', () => {
  // 旧 33 キーの custom map (deck.read 欠損) をシミュレート
  function legacyCustomMap(): PermissionsConfig['custom'] {
    const map = resolvePermissions({
      preset: 'safe',
      custom: {} as PermissionsConfig['custom'],
    })
    delete (map as Record<string, boolean>)['deck.read']
    return map
  }

  it('ai.chat / plugin の custom には deck.read=true が補完される (挙動保存)', () => {
    for (const id of ['ai.chat', 'ai.heartbeat', 'plugin'] as const) {
      const normalized = normalizeProfile(
        { preset: 'custom', custom: legacyCustomMap() },
        id,
      )
      expect(normalized.custom['deck.read'], id).toBe(true)
    }
  })

  it('external の custom には deck.read=false が補完される (意図した縮小)', () => {
    const normalized = normalizeProfile(
      { preset: 'custom', custom: legacyCustomMap() },
      'external',
    )
    expect(normalized.custom['deck.read']).toBe(false)
  })

  it('deck.read 以外の欠損キーは false (deny) で補完される', () => {
    const map = legacyCustomMap()
    delete (map as Record<string, boolean>)['notes.write']
    const normalized = normalizeProfile(
      { preset: 'custom', custom: map },
      'ai.chat',
    )
    expect(normalized.custom['notes.write']).toBe(false)
  })

  it('preset が custom 以外なら preset 定義で custom を埋め直す', () => {
    const normalized = normalizeProfile(
      { preset: 'safe', custom: {} as PermissionsConfig['custom'] },
      'ai.chat',
    )
    expect(normalized.preset).toBe('safe')
    expect(normalized.custom['notes.react']).toBe(true)
  })

  it('壊れた preset 値は readonly にフォールバックする', () => {
    const normalized = normalizeProfile(
      { preset: 'oops' as never, custom: {} as PermissionsConfig['custom'] },
      'ai.chat',
    )
    expect(normalized.preset).toBe('readonly')
  })
})

describe('EXTERNAL_DEFAULT_PROFILE', () => {
  it('readonly から LOCAL_READ_KEYS を全て落とした縮小 custom である', () => {
    expect(EXTERNAL_DEFAULT_PROFILE.preset).toBe('custom')
    for (const key of LOCAL_READ_KEYS) {
      expect(EXTERNAL_DEFAULT_PROFILE.custom[key], key).toBe(false)
    }
    // Misskey コンテンツ read は残る
    expect(EXTERNAL_DEFAULT_PROFILE.custom['notes.read']).toBe(true)
    expect(EXTERNAL_DEFAULT_PROFILE.custom['account.read']).toBe(true)
    // write は readonly 由来で false
    expect(EXTERNAL_DEFAULT_PROFILE.custom['notes.write']).toBe(false)
  })
})

describe('backfillValue', () => {
  it('deck.read は external のみ false', () => {
    expect(backfillValue('deck.read', 'ai.chat')).toBe(true)
    expect(backfillValue('deck.read', 'ai.heartbeat')).toBe(true)
    expect(backfillValue('deck.read', 'plugin')).toBe(true)
    expect(backfillValue('deck.read', 'external')).toBe(false)
  })
})

describe('presetFromMap', () => {
  it('preset 定義と一致する map はその preset に正規化される', () => {
    const safeMap = resolvePermissions({
      preset: 'safe',
      custom: {} as PermissionsConfig['custom'],
    })
    expect(presetFromMap(safeMap).preset).toBe('safe')
  })

  it('どの preset とも一致しない map は custom のまま', () => {
    const map = resolvePermissions({
      preset: 'safe',
      custom: {} as PermissionsConfig['custom'],
    })
    map['theme.write'] = true
    const result = presetFromMap(map)
    expect(result.preset).toBe('custom')
    expect(result.custom['theme.write']).toBe(true)
  })
})

describe('deck.write (#1098: デッキ / ウィンドウ構成の変更を無条件許可にしない)', () => {
  it('readonly では false、safe / full では true', () => {
    expect(PERMISSION_PRESETS.readonly['deck.write']).toBe(false)
    expect(PERMISSION_PRESETS.safe['deck.write']).toBe(true)
    expect(PERMISSION_PRESETS.full['deck.write']).toBe(true)
  })

  it('custom map に欠損していれば ai.chat / plugin は true、ai.heartbeat / external は false で backfill', () => {
    const saved = { preset: 'custom', custom: {} } as PermissionsConfig
    expect(normalizeProfile(saved, 'ai.chat').custom['deck.write']).toBe(true)
    expect(normalizeProfile(saved, 'plugin').custom['deck.write']).toBe(true)
    expect(normalizeProfile(saved, 'ai.heartbeat').custom['deck.write']).toBe(
      false,
    )
    expect(normalizeProfile(saved, 'external').custom['deck.write']).toBe(false)
  })
})
