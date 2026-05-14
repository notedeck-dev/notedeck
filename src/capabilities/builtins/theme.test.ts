import { describe, expect, it } from 'vitest'
import {
  THEME_BUILTIN_CAPABILITIES,
  themeApplyCapability,
  themeCreateCapability,
  themeInstallCapability,
  themeListCapability,
  themeReadCapability,
  themeUninstallCapability,
  themeUpdateCapability,
} from './theme'

// Note: theme.apply の execute は最終的に applyCurrentTheme → window.matchMedia
// に到達するため unit 環境では走らない。capability 定義の正しさだけ検証する。
// 実 execute 挙動は dom テストか実機で確認。

describe('theme.list capability', () => {
  it('declares no permissions and aiTool: true', () => {
    expect(themeListCapability.permissions).toEqual([])
    expect(themeListCapability.aiTool).toBe(true)
    expect(themeListCapability.signature?.returns?.type).toBe('array')
    expect(themeListCapability.id).toBe('theme.list')
  })
})

describe('theme.apply capability', () => {
  it('declares no permissions and aiTool: true', () => {
    expect(themeApplyCapability.permissions).toEqual([])
    expect(themeApplyCapability.aiTool).toBe(true)
    expect(themeApplyCapability.id).toBe('theme.apply')
  })

  it('throws when id is missing', () => {
    expect(() => themeApplyCapability.execute({})).toThrow(/id is required/)
  })

  it('declares mode enum (dark / light)', () => {
    const modeEnum = themeApplyCapability.signature?.params?.mode?.enum
    expect(modeEnum).toEqual(['dark', 'light'])
    expect(themeApplyCapability.signature?.params?.mode?.optional).toBe(true)
    expect(themeApplyCapability.signature?.params?.id?.optional).not.toBe(true)
  })
})

describe('theme.read capability', () => {
  it('declares no permissions, aiTool: true, cheap: true', () => {
    expect(themeReadCapability.id).toBe('theme.read')
    expect(themeReadCapability.permissions).toEqual([])
    expect(themeReadCapability.aiTool).toBe(true)
    expect(themeReadCapability.signature?.cheap).toBe(true)
  })

  it('throws when id is missing', () => {
    expect(() => themeReadCapability.execute({})).toThrow(/id is required/)
  })

  it('marks id as required (no other params)', () => {
    const params = themeReadCapability.signature?.params
    expect(params?.id?.optional).not.toBe(true)
    expect(Object.keys(params ?? {})).toEqual(['id'])
  })
})

describe('theme.create capability', () => {
  it('declares theme.write permission, install preview confirmation', () => {
    expect(themeCreateCapability.id).toBe('theme.create')
    expect(themeCreateCapability.permissions).toEqual(['theme.write'])
    expect(themeCreateCapability.aiTool).toBe(true)
    expect(typeof themeCreateCapability.requiresConfirmation).toBe('function')
  })

  it('rejects missing name / invalid base / missing props', async () => {
    await expect(themeCreateCapability.execute({})).rejects.toThrow(
      /name is required/,
    )
    await expect(themeCreateCapability.execute({ name: 'X' })).rejects.toThrow(
      /base must be/,
    )
    await expect(
      themeCreateCapability.execute({ name: 'X', base: 'dark' }),
    ).rejects.toThrow(/props must be/)
    await expect(
      themeCreateCapability.execute({
        name: 'X',
        base: 'invalid',
        props: { a: '1' },
      }),
    ).rejects.toThrow(/base must be/)
  })

  it('rejects props containing non-string values', async () => {
    await expect(
      themeCreateCapability.execute({
        name: 'X',
        base: 'dark',
        props: { accent: 123 } as unknown as Record<string, string>,
      }),
    ).rejects.toThrow(/props must be/)
  })

  it('declares base enum and id optional', () => {
    expect(themeCreateCapability.signature?.params?.base?.enum).toEqual([
      'dark',
      'light',
    ])
    expect(themeCreateCapability.signature?.params?.id?.optional).toBe(true)
    expect(themeCreateCapability.signature?.params?.name?.optional).not.toBe(
      true,
    )
  })
})

describe('theme.update capability', () => {
  it('declares theme.write permission, install preview confirmation', () => {
    expect(themeUpdateCapability.id).toBe('theme.update')
    expect(themeUpdateCapability.permissions).toEqual(['theme.write'])
    expect(typeof themeUpdateCapability.requiresConfirmation).toBe('function')
  })

  it('throws when id is missing', async () => {
    await expect(themeUpdateCapability.execute({})).rejects.toThrow(
      /id is required/,
    )
  })

  it('marks all body fields except id as optional', () => {
    const params = themeUpdateCapability.signature?.params
    expect(params?.id?.optional).not.toBe(true)
    expect(params?.name?.optional).toBe(true)
    expect(params?.base?.optional).toBe(true)
    expect(params?.props?.optional).toBe(true)
  })
})

describe('theme.install capability', () => {
  it('declares theme.write + network.external permissions and aiTool', () => {
    expect(themeInstallCapability.id).toBe('theme.install')
    expect(themeInstallCapability.permissions).toEqual([
      'theme.write',
      'network.external',
    ])
    expect(themeInstallCapability.aiTool).toBe(true)
    expect(typeof themeInstallCapability.requiresConfirmation).toBe('function')
  })

  it('throws when id is missing', async () => {
    await expect(themeInstallCapability.execute({})).rejects.toThrow(
      /id is required/,
    )
  })

  it('marks id as the only required param', () => {
    const params = themeInstallCapability.signature?.params
    expect(params?.id?.optional).not.toBe(true)
    expect(Object.keys(params ?? {})).toEqual(['id'])
  })
})

describe('theme.uninstall capability', () => {
  it('declares theme.write permission and aiTool', () => {
    expect(themeUninstallCapability.id).toBe('theme.uninstall')
    expect(themeUninstallCapability.permissions).toEqual(['theme.write'])
    expect(themeUninstallCapability.aiTool).toBe(true)
    expect(typeof themeUninstallCapability.requiresConfirmation).toBe(
      'function',
    )
  })

  it('throws when id is missing', () => {
    expect(() => themeUninstallCapability.execute({})).toThrow(/id is required/)
  })

  it('marks id as the only required param', () => {
    const params = themeUninstallCapability.signature?.params
    expect(params?.id?.optional).not.toBe(true)
    expect(Object.keys(params ?? {})).toEqual(['id'])
  })
})

describe('THEME_BUILTIN_CAPABILITIES', () => {
  it('contains list / read / apply / create / update / install / uninstall', () => {
    expect(THEME_BUILTIN_CAPABILITIES).toContain(themeListCapability)
    expect(THEME_BUILTIN_CAPABILITIES).toContain(themeReadCapability)
    expect(THEME_BUILTIN_CAPABILITIES).toContain(themeApplyCapability)
    expect(THEME_BUILTIN_CAPABILITIES).toContain(themeCreateCapability)
    expect(THEME_BUILTIN_CAPABILITIES).toContain(themeUpdateCapability)
    expect(THEME_BUILTIN_CAPABILITIES).toContain(themeInstallCapability)
    expect(THEME_BUILTIN_CAPABILITIES).toContain(themeUninstallCapability)
  })
})
