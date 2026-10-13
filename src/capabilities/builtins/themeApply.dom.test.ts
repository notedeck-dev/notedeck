// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccountsStore } from '@/stores/accounts'
import { useThemeStore } from '@/stores/theme'
import { themeApplyCapability } from './theme'

vi.mock('@/utils/settingsFs', async () => {
  const actual =
    await vi.importActual<typeof import('@/utils/settingsFs')>(
      '@/utils/settingsFs',
    )
  return { ...actual, isTauri: false }
})

describe('themes.apply の accountId', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    useAccountsStore().accounts = [
      { id: 'acc-1', host: 'example.com' },
    ] as never
    useThemeStore().items = [
      {
        id: 'red',
        name: 'Red',
        createdAt: 1,
        updatedAt: 1,
        scope: { kind: 'shared', global: false, installedFor: [] },
        content: { base: 'dark', props: { accent: '#f00' } },
        extra: {},
      },
    ]
  })

  it('渡すとそのアカウントにだけ適用し、デッキ全体の選択は変えない', () => {
    const store = useThemeStore()
    const before = store.selectedDarkThemeId

    expect(
      themeApplyCapability.execute({ id: 'red', accountId: 'acc-1' }),
    ).toEqual({ applied: true, id: 'red', mode: 'dark', accountId: 'acc-1' })
    expect(store.accountThemeCache.get('acc-1')?.dark?.props).toEqual({
      accent: '#f00',
    })
    expect(store.selectedDarkThemeId).toBe(before)
  })

  it('知らないアカウントは拒否する', () => {
    expect(() =>
      themeApplyCapability.execute({ id: 'red', accountId: 'nope' }),
    ).toThrow(/not found/)
  })
})
