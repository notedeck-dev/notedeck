import { describe, expect, it } from 'vitest'
import {
  findWidgetInstance,
  isStoreWidgetInstalled,
  listWidgetInstances,
} from './widgetInstances'

const widgets = [
  { installId: 'clock', storeId: 'clock' },
  { installId: 'clock-2', storeId: 'clock', accountKey: 'misskey.io:u1' },
  { installId: 'clock-3', storeId: 'clock', accountKey: 'misskey.io:u2' },
  { installId: 'other', storeId: 'other' },
  { installId: 'local' },
]

describe('findWidgetInstance — storeId × 実行アカウントの組で個体を引く (#1061)', () => {
  it('accountKey 未指定は「アカウント無し」の枠にだけ一致する', () => {
    expect(findWidgetInstance(widgets, 'clock', undefined)?.installId).toBe(
      'clock',
    )
  })

  it('accountKey 指定は同じアカウントの個体にだけ一致する', () => {
    expect(
      findWidgetInstance(widgets, 'clock', 'misskey.io:u2')?.installId,
    ).toBe('clock-3')
    expect(findWidgetInstance(widgets, 'clock', 'misskey.io:u9')).toBe(
      undefined,
    )
  })

  it('storeId を持たないローカル個体は対象外', () => {
    expect(findWidgetInstance(widgets, 'local', undefined)).toBe(undefined)
  })

  it('listWidgetInstances は同 storeId の全個体を返す', () => {
    expect(
      listWidgetInstances(widgets, 'clock').map((w) => w.installId),
    ).toEqual(['clock', 'clock-2', 'clock-3'])
    expect(listWidgetInstances(widgets, 'none')).toEqual([])
  })
})

describe('isStoreWidgetInstalled — ストアカードの「インストール済み」判定 (#1061)', () => {
  it('アカウント不要のアイテムは個体が 1 つでもあれば済み (全体で 1 つ)', () => {
    const scope = { kind: 'all', accountKeys: ['misskey.io:u1'] } as const
    expect(
      isStoreWidgetInstalled(widgets, 'other', {
        requiresAccount: false,
        scope,
      }),
    ).toBe(true)
    expect(
      isStoreWidgetInstalled(widgets, 'none', {
        requiresAccount: false,
        scope,
      }),
    ).toBe(false)
  })

  it('全アカウントカラム: 選べるアカウント全部に個体が揃って初めて済み', () => {
    const ctx = {
      requiresAccount: true,
      scope: {
        kind: 'all',
        accountKeys: ['misskey.io:u1', 'misskey.io:u2'],
      },
    } as const
    expect(isStoreWidgetInstalled(widgets, 'clock', ctx)).toBe(true)
    const withMore = {
      ...ctx,
      scope: {
        kind: 'all',
        accountKeys: ['misskey.io:u1', 'misskey.io:u2', 'misskey.io:u3'],
      },
    } as const
    expect(isStoreWidgetInstalled(widgets, 'clock', withMore)).toBe(false)
  })

  it('全アカウントカラム: アカウント無しの個体は数えない (実行時に固定される過渡状態)', () => {
    const ctx = {
      requiresAccount: true,
      scope: { kind: 'all', accountKeys: ['misskey.io:u3'] },
    } as const
    expect(isStoreWidgetInstalled(widgets, 'clock', ctx)).toBe(false)
  })

  it('全アカウントカラムで選べるアカウントが無いときは個体の有無で判定する', () => {
    const ctx = {
      requiresAccount: true,
      scope: { kind: 'all', accountKeys: [] },
    } as const
    expect(isStoreWidgetInstalled(widgets, 'clock', ctx)).toBe(true)
    expect(isStoreWidgetInstalled(widgets, 'none', ctx)).toBe(false)
  })

  it('per-account カラム: アカウント無しの個体か、同じアカウントの個体があれば済み', () => {
    const own = {
      requiresAccount: true,
      scope: { kind: 'account', key: 'misskey.io:u1' },
    } as const
    expect(isStoreWidgetInstalled(widgets, 'clock', own)).toBe(true)
    const onlyOthers = [
      { installId: 'clock-2', storeId: 'clock', accountKey: 'misskey.io:u1' },
    ]
    const stranger = {
      requiresAccount: true,
      scope: { kind: 'account', key: 'misskey.io:u9' },
    } as const
    expect(isStoreWidgetInstalled(onlyOthers, 'clock', stranger)).toBe(false)
    expect(isStoreWidgetInstalled(onlyOthers, 'clock', own)).toBe(true)
  })
})
