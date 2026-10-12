import { describe, expect, it } from 'vitest'
import type { DistributableScope } from '@/services/distributable'
import { findWidgetByStore, isStoreWidgetInstalled } from './widgetInstances'

const shared = (
  global: boolean,
  installedFor: string[] = [],
): DistributableScope => ({ kind: 'shared', global, installedFor })

const widgets = [
  {
    id: 'clock',
    store: { id: 'clock' },
    scope: shared(false, ['misskey.io:u1', 'misskey.io:u2']),
  },
  { id: 'other', store: { id: 'other' }, scope: shared(true) },
  { id: 'local', scope: shared(true) },
]

describe('findWidgetByStore — storeId につき本体 1 つ (#1202 決定 (b))', () => {
  it('storeId で引く。ローカル個体は対象外', () => {
    expect(findWidgetByStore(widgets, 'clock')?.id).toBe('clock')
    expect(findWidgetByStore(widgets, 'local')).toBe(undefined)
    expect(findWidgetByStore(widgets, 'none')).toBe(undefined)
  })
})

describe('isStoreWidgetInstalled — ストアカードの「インストール済み」判定', () => {
  it('アカウント不要のアイテムは本体があれば済み', () => {
    const scope = { kind: 'all', accountKeys: ['misskey.io:u1'] } as const
    expect(
      isStoreWidgetInstalled(widgets, 'clock', {
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

  it('全アカウントカラム: 選べるアカウント全部が紐付けにあって初めて済み', () => {
    const ctx = {
      requiresAccount: true,
      scope: { kind: 'all', accountKeys: ['misskey.io:u1', 'misskey.io:u2'] },
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
    // 全体スコープの本体はどのアカウントでも済み
    expect(isStoreWidgetInstalled(widgets, 'other', withMore)).toBe(true)
  })

  it('全アカウントカラムで選べるアカウントが無いときは本体の有無で判定する', () => {
    const ctx = {
      requiresAccount: true,
      scope: { kind: 'all', accountKeys: [] },
    } as const
    expect(isStoreWidgetInstalled(widgets, 'clock', ctx)).toBe(true)
    expect(isStoreWidgetInstalled(widgets, 'none', ctx)).toBe(false)
  })

  it('per-account カラム: そのアカウントで選べるなら済み', () => {
    const own = {
      requiresAccount: true,
      scope: { kind: 'account', key: 'misskey.io:u1' },
    } as const
    const stranger = {
      requiresAccount: true,
      scope: { kind: 'account', key: 'misskey.io:u9' },
    } as const
    expect(isStoreWidgetInstalled(widgets, 'clock', own)).toBe(true)
    expect(isStoreWidgetInstalled(widgets, 'clock', stranger)).toBe(false)
    expect(isStoreWidgetInstalled(widgets, 'other', stranger)).toBe(true)
  })
})
