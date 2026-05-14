import { describe, expect, it } from 'vitest'
import {
  WIDGETS_BUILTIN_CAPABILITIES,
  widgetsCreateCapability,
  widgetsDeleteCapability,
  widgetsInstallCapability,
  widgetsListCapability,
  widgetsReadCapability,
  widgetsSetAutoRunCapability,
  widgetsUninstallCapability,
  widgetsUpdateCapability,
} from './widgets'

// Note: execute は useWidgetsStore (Pinia) を呼ぶため、ユニット環境では
// store mock 抜きでは走らない。capability 定義 (id / permissions / signature
// / aiTool / requiresConfirmation) と引数バリデーションだけ検証する。

describe('widget capabilities — declaration', () => {
  it('widgets.list: read permission, cheap, aiTool true', () => {
    expect(widgetsListCapability.id).toBe('widgets.list')
    expect(widgetsListCapability.permissions).toEqual(['widgets.read'])
    expect(widgetsListCapability.aiTool).toBe(true)
    expect(widgetsListCapability.signature?.cheap).toBe(true)
  })

  it('widgets.read: read permission, requires installId', () => {
    expect(widgetsReadCapability.id).toBe('widgets.read')
    expect(widgetsReadCapability.permissions).toEqual(['widgets.read'])
    expect(() => widgetsReadCapability.execute({})).toThrow(
      /installId is required/,
    )
  })

  it('widgets.create: write permission, install preview confirmation, requires name+src', () => {
    expect(widgetsCreateCapability.id).toBe('widgets.create')
    expect(widgetsCreateCapability.permissions).toEqual(['widgets.write'])
    expect(typeof widgetsCreateCapability.requiresConfirmation).toBe('function')
    expect(() => widgetsCreateCapability.execute({})).toThrow(
      /name is required/,
    )
    expect(() => widgetsCreateCapability.execute({ name: 'X' })).toThrow(
      /src is required/,
    )
  })

  it('widgets.create: requiresConfirmation builds installPreview kind=widget', async () => {
    if (typeof widgetsCreateCapability.requiresConfirmation !== 'function') {
      throw new Error('requiresConfirmation must be a function')
    }
    const opts = await widgetsCreateCapability.requiresConfirmation({
      name: 'demo-widget',
      src: 'widget src',
    })
    expect(opts?.installPreview?.kind).toBe('widget')
    expect(opts?.installPreview?.name).toBe('demo-widget')
    expect(opts?.code).toBe('widget src')
    expect(opts?.codeLanguage).toBe('is')
  })

  it('widgets.update: write permission, install preview confirmation, requires installId+src', () => {
    expect(widgetsUpdateCapability.id).toBe('widgets.update')
    expect(widgetsUpdateCapability.permissions).toEqual(['widgets.write'])
    expect(typeof widgetsUpdateCapability.requiresConfirmation).toBe('function')
    expect(() => widgetsUpdateCapability.execute({})).toThrow(
      /installId is required/,
    )
    expect(() => widgetsUpdateCapability.execute({ installId: 'x' })).toThrow(
      /src is required/,
    )
  })

  it('widgets.setAutoRun: write permission, no confirm (= 可逆切替)', () => {
    expect(widgetsSetAutoRunCapability.id).toBe('widgets.setAutoRun')
    expect(widgetsSetAutoRunCapability.permissions).toEqual(['widgets.write'])
    expect(widgetsSetAutoRunCapability.requiresConfirmation).not.toBe(true)
  })

  it('widgets.delete: write permission, install preview confirmation (= 不可逆)', () => {
    expect(widgetsDeleteCapability.id).toBe('widgets.delete')
    expect(widgetsDeleteCapability.permissions).toEqual(['widgets.write'])
    expect(typeof widgetsDeleteCapability.requiresConfirmation).toBe('function')
    expect(() => widgetsDeleteCapability.execute({})).toThrow(
      /installId is required/,
    )
  })

  it('widgets.create: autoRun is optional with default false (boolean)', () => {
    const params = widgetsCreateCapability.signature?.params
    expect(params?.autoRun?.optional).toBe(true)
    expect(params?.autoRun?.type).toBe('boolean')
    expect(params?.name?.optional).not.toBe(true)
    expect(params?.src?.optional).not.toBe(true)
  })
})

describe('widgets.install capability', () => {
  it('declares widgets.write + network.external permissions and aiTool', () => {
    expect(widgetsInstallCapability.id).toBe('widgets.install')
    expect(widgetsInstallCapability.permissions).toEqual([
      'widgets.write',
      'network.external',
    ])
    expect(widgetsInstallCapability.aiTool).toBe(true)
    expect(typeof widgetsInstallCapability.requiresConfirmation).toBe(
      'function',
    )
  })

  it('throws when id is missing', async () => {
    await expect(widgetsInstallCapability.execute({})).rejects.toThrow(
      /id is required/,
    )
  })

  it('marks id as the only required param', () => {
    const params = widgetsInstallCapability.signature?.params
    expect(params?.id?.optional).not.toBe(true)
    expect(Object.keys(params ?? {})).toEqual(['id'])
  })
})

describe('widgets.uninstall capability', () => {
  it('declares widgets.write permission and aiTool', () => {
    expect(widgetsUninstallCapability.id).toBe('widgets.uninstall')
    expect(widgetsUninstallCapability.permissions).toEqual(['widgets.write'])
    expect(widgetsUninstallCapability.aiTool).toBe(true)
    expect(typeof widgetsUninstallCapability.requiresConfirmation).toBe(
      'function',
    )
  })

  it('throws when neither installId nor storeId is provided', () => {
    expect(() => widgetsUninstallCapability.execute({})).toThrow(
      /installId or storeId is required/,
    )
  })

  it('marks both installId and storeId as optional (one of them required)', () => {
    const params = widgetsUninstallCapability.signature?.params
    expect(params?.installId?.optional).toBe(true)
    expect(params?.storeId?.optional).toBe(true)
  })
})

describe('WIDGETS_BUILTIN_CAPABILITIES', () => {
  it('contains all 10 widget capabilities (incl. install / uninstall)', () => {
    const ids = WIDGETS_BUILTIN_CAPABILITIES.map((c) => c.id).sort()
    expect(ids).toEqual([
      'widgets.create',
      'widgets.delete',
      'widgets.history',
      'widgets.install',
      'widgets.list',
      'widgets.read',
      'widgets.revert',
      'widgets.setAutoRun',
      'widgets.uninstall',
      'widgets.update',
    ])
  })
})
