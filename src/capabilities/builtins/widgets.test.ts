import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityContext } from '@/capabilities/types'
import { useWidgetsStore, type WidgetItem } from '@/stores/widgets'

// unit プロジェクトは node 環境のため localStorage を stub する (deck.test.ts と同じ)
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
})

import {
  WIDGETS_BUILTIN_CAPABILITIES,
  widgetsCreateCapability,
  widgetsDeleteCapability,
  widgetsInstallCapability,
  widgetsListCapability,
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

  it('widgets.create: write permission, install preview confirmation, requires name+src', async () => {
    expect(widgetsCreateCapability.id).toBe('widgets.create')
    expect(widgetsCreateCapability.permissions).toEqual(['widgets.write'])
    expect(typeof widgetsCreateCapability.requiresConfirmation).toBe('function')
    await expect(widgetsCreateCapability.execute({})).rejects.toThrow(
      /name is required/,
    )
    await expect(
      widgetsCreateCapability.execute({ name: 'X' }),
    ).rejects.toThrow(/src is required/)
  })

  it('widgets.create: requiresConfirmation builds installPreview kind=widget', async () => {
    if (typeof widgetsCreateCapability.requiresConfirmation !== 'function') {
      throw new Error('requiresConfirmation must be a function')
    }
    const opts = await widgetsCreateCapability.requiresConfirmation(
      {
        name: 'demo-widget',
        src: 'widget src',
      },
      {},
    )
    expect(opts?.installPreview?.kind).toBe('widget')
    expect(opts?.installPreview?.name).toBe('demo-widget')
    expect(opts?.code).toBe('widget src')
    expect(opts?.codeLanguage).toBe('is')
  })

  it('widgets.update: write permission, install preview confirmation, requires installId+src', async () => {
    expect(widgetsUpdateCapability.id).toBe('widgets.update')
    expect(widgetsUpdateCapability.permissions).toEqual(['widgets.write'])
    expect(typeof widgetsUpdateCapability.requiresConfirmation).toBe('function')
    await expect(widgetsUpdateCapability.execute({})).rejects.toThrow(
      /installId is required/,
    )
    await expect(
      widgetsUpdateCapability.execute({ installId: 'x' }),
    ).rejects.toThrow(/src is required/)
  })

  it('widgets.setAutoRun: write permission, no confirm (= 可逆切替)', () => {
    expect(widgetsSetAutoRunCapability.id).toBe('widgets.setAutoRun')
    expect(widgetsSetAutoRunCapability.permissions).toEqual(['widgets.write'])
    expect(widgetsSetAutoRunCapability.requiresConfirmation).not.toBe(true)
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

  it('marks id as the only required param; accountId is optional (#1061)', () => {
    const params = widgetsInstallCapability.signature?.params
    expect(params?.id?.optional).not.toBe(true)
    expect(params?.accountId?.optional).toBe(true)
    expect(Object.keys(params ?? {})).toEqual(['id', 'accountId'])
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

  it('本体は storeId につき 1 つなので uninstall / delete とも installId 1 つを返す (#1202)', () => {
    expect(
      widgetsUninstallCapability.signature?.returns?.description,
    ).not.toContain('installIds')
    expect(
      widgetsDeleteCapability.signature?.returns?.description,
    ).not.toContain('installIds')
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

describe('widgets.update — 表示中なら再実行を要求する (#744)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function addWidget(id = 'w-test-1'): WidgetItem {
    const widget: WidgetItem = {
      id,
      name: 'test-widget',
      content: 'let x = 1',
      scope: { kind: 'shared', global: true, installedFor: [] },
      extra: { autoRun: false },
      createdAt: 0,
      updatedAt: 0,
    }
    useWidgetsStore().items.push(widget)
    return widget
  }

  it('未マウントなら rerunning: false', async () => {
    const widget = addWidget()
    const r = (await widgetsUpdateCapability.execute({
      installId: widget.id,
      src: 'let y = 2',
    })) as { rerunning: boolean }
    expect(r.rerunning).toBe(false)
  })

  it('マウント中なら rerunning: true でシグナルが進む', async () => {
    const widget = addWidget()
    const store = useWidgetsStore()
    store.registerMounted(widget.id)
    const r = (await widgetsUpdateCapability.execute({
      installId: widget.id,
      src: 'let y = 2',
    })) as { rerunning: boolean }
    expect(r.rerunning).toBe(true)
    expect(store.rerunSignal(widget.id)).toBe(1)
    expect(store.get(widget.id)?.content).toBe('let y = 2')
  })

  it('確認は旧 src と新 src の全文 diff を見せる (#981)', async () => {
    if (typeof widgetsUpdateCapability.requiresConfirmation !== 'function') {
      throw new Error('requiresConfirmation must be a function')
    }
    // 他テストと installId を共有すると localStorage ミラー経由で src を
    // 引き継いでしまうため、diff 検証は専用 id で作る
    addWidget('w-diff-1')
    const ctx: CapabilityContext = {}
    const opts = await widgetsUpdateCapability.requiresConfirmation(
      { installId: 'w-diff-1', src: 'let y = 2' },
      ctx,
    )
    expect(opts?.diff).toEqual({
      old: 'let x = 1',
      new: 'let y = 2',
      language: 'aiscript',
    })
    expect(ctx.stagedEdit).toEqual({ baseline: 'let x = 1', next: 'let y = 2' })
  })

  it('確認ダイアログは表示中のときのみ再実行を予告する', async () => {
    if (typeof widgetsUpdateCapability.requiresConfirmation !== 'function') {
      throw new Error('requiresConfirmation must be a function')
    }
    const widget = addWidget()
    const before = await widgetsUpdateCapability.requiresConfirmation(
      { installId: widget.id, src: 'let y = 2' },
      {},
    )
    expect(before?.message).not.toContain('再実行されます')

    useWidgetsStore().registerMounted(widget.id)
    const after = await widgetsUpdateCapability.requiresConfirmation(
      { installId: widget.id, src: 'let y = 2' },
      {},
    )
    expect(after?.message).toContain('再実行されます')
  })
})
