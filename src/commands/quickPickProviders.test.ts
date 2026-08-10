import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('@/commands/definitions', () => ({ refreshProfileCommands: vi.fn() }))
vi.mock('@/composables/useDeckWindow', () => ({
  switchProfileWithWindows: vi.fn(),
}))
vi.mock('@/composables/useLoginPrompt', () => ({ showLoginPrompt: vi.fn() }))
vi.mock('@/composables/useUserSearch', () => ({
  formatUserHandle: vi.fn(),
  searchUsers: vi.fn(),
}))
vi.mock('@/stores/accounts', () => ({
  getAccountAvatarUrl: vi.fn(() => null),
  getAccountLabel: vi.fn(() => 'label'),
  isGuestAccount: vi.fn(() => false),
  useAccountsStore: vi.fn(() => ({ accounts: [] })),
}))
vi.mock('@/stores/confirm', () => ({ useConfirm: vi.fn() }))
vi.mock('@/stores/deck', () => ({ useDeckStore: vi.fn() }))
vi.mock('@/stores/deckProfile', () => ({ useDeckProfileStore: vi.fn() }))
vi.mock('@/stores/prompt', () => ({ usePrompt: vi.fn() }))
vi.mock('@/stores/theme', () => ({ useThemeStore: vi.fn() }))
vi.mock('@/stores/toast', () => ({
  useToast: vi.fn(() => ({ show: vi.fn() })),
}))
vi.mock('@/stores/windows', () => ({ useWindowsStore: vi.fn() }))
let devMode = false
vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    get: (key: string) => (key === 'ui.developerMode' ? devMode : undefined),
  }),
}))
vi.mock('@/utils/mediaProxy', () => ({ proxyThumbUrl: (u: unknown) => u }))
vi.mock('@/utils/tauriInvoke', () => ({
  commands: {},
  unwrap: (r: { status: string; data?: unknown }) => r.data,
}))

import { refreshProfileCommands } from '@/commands/definitions'
import { switchProfileWithWindows } from '@/composables/useDeckWindow'
import { SETTINGS_SECTIONS } from '@/settings/sections'
import { useDeckStore } from '@/stores/deck'
import { useDeckProfileStore } from '@/stores/deckProfile'
import { useThemeStore } from '@/stores/theme'
import { useWindowsStore } from '@/stores/windows'
import { WINDOW_ICONS, WINDOW_LABELS } from '@/windows/registry'
import {
  getColumnTypeItems,
  getProfileItems,
  getSettingsItems,
} from './quickPickProviders'

let themeMock: {
  manualMode: string | null
  toggleTheme: ReturnType<typeof vi.fn>
  pinCurrentMode: ReturnType<typeof vi.fn>
  resetToOsTheme: ReturnType<typeof vi.fn>
}
let deckMock: {
  activeProfileId: string
  saveAsProfile: ReturnType<typeof vi.fn>
  clearWallpaper: ReturnType<typeof vi.fn>
  deleteProfile: ReturnType<typeof vi.fn>
}
let windowsMock: { open: ReturnType<typeof vi.fn> }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  themeMock = {
    manualMode: null,
    toggleTheme: vi.fn(),
    pinCurrentMode: vi.fn(),
    resetToOsTheme: vi.fn(),
  }
  deckMock = {
    activeProfileId: 'p1',
    saveAsProfile: vi.fn(),
    clearWallpaper: vi.fn(),
    deleteProfile: vi.fn(),
  }
  windowsMock = { open: vi.fn() }
  vi.mocked(useThemeStore).mockReturnValue(themeMock as never)
  vi.mocked(useDeckStore).mockReturnValue(deckMock as never)
  vi.mocked(useWindowsStore).mockReturnValue(windowsMock as never)
  vi.mocked(useDeckProfileStore).mockReturnValue({
    getProfiles: () => [
      { id: 'p1', name: 'Main' },
      { id: 'p2', name: 'Sub' },
    ],
  } as never)
})

describe('getSettingsItems', () => {
  it('has unique ids and an action on every item', () => {
    const items = getSettingsItems()
    expect(items.length).toBeGreaterThan(0)
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of items) {
      expect(item.label, item.id).toBeTruthy()
      expect(item.icon, item.id).toBeTruthy()
      expect(typeof item.action, item.id).toBe('function')
    }
  })

  it('設定メニューと同じウィンドウ・同じ表示名になる (#1035)', () => {
    // 定義元は SETTINGS_SECTIONS 1 本。表示名とアイコンはウィンドウレジストリ
    // から引くので、メニューとパレットで名前がずれない。両者は同じ露出判定で
    // 絞られるため比較は開発者モード on で行う
    devMode = true
    const items = getSettingsItems()

    expect(items.map((i) => i.id)).toEqual(
      SETTINGS_SECTIONS.map((s) => s.window),
    )
    for (const item of items) {
      expect(item.label, item.id).toBe(WINDOW_LABELS[item.id])
      expect(`ti ti-${item.icon}`, item.id).toBe(WINDOW_ICONS[item.id])
    }
    devMode = false
  })

  it('開発者モード off では開発者向けの設定が並ばない (#1034)', () => {
    devMode = false
    const ids = getSettingsItems().map((i) => i.id)
    expect(ids).not.toContain('aiSettings')
    expect(ids).not.toContain('tasksEditor')
    expect(ids).not.toContain('snippetsEditor')
    // 一般側は残る
    expect(ids).toContain('appearanceEditor')
    expect(ids).toContain('permissions')
    expect(ids).toContain('cssEditor')
  })

  it('全項目がウィンドウを開くだけのフラットな一覧', () => {
    const items = getSettingsItems()
    expect(items.every((i) => i.group === undefined)).toBe(true)
    items.find((i) => i.id === 'appearanceEditor')?.action?.()
    expect(windowsMock.open).toHaveBeenCalledWith('appearanceEditor')
  })

  it('window-opening settings route to the windows store', () => {
    getSettingsItems()
      .find((i) => i.id === 'keybinds')
      ?.action?.()
    expect(windowsMock.open).toHaveBeenCalledWith('keybinds')
  })
})

describe('getProfileItems', () => {
  it('marks the active profile and appends a create item', () => {
    const items = getProfileItems()
    expect(items.map((i) => i.id)).toEqual([
      'profile-p1',
      'profile-p2',
      'profile-new',
    ])
    expect(items[0]?.description).toBe('現在のプロファイル')
    expect(items[1]?.description).toBeUndefined()
  })

  it('profile-new creates a profile and refreshes profile commands', () => {
    getProfileItems()
      .find((i) => i.id === 'profile-new')
      ?.action?.()
    expect(deckMock.saveAsProfile).toHaveBeenCalledOnce()
    expect(refreshProfileCommands).toHaveBeenCalledOnce()
  })

  it('active profile only offers edit; others offer switch/edit/delete', async () => {
    const items = getProfileItems()
    const activeChildren = await items[0]?.children?.()
    expect(activeChildren?.map((i) => i.id)).toEqual(['profile-edit-p1'])

    const otherChildren = await items[1]?.children?.()
    expect(otherChildren?.map((i) => i.id)).toEqual([
      'profile-switch-p2',
      'profile-edit-p2',
      'profile-delete-p2',
    ])
  })

  it('switch action delegates to switchProfileWithWindows', async () => {
    const items = getProfileItems()
    const children = await items[1]?.children?.()
    children?.find((i) => i.id === 'profile-switch-p2')?.action?.()
    expect(switchProfileWithWindows).toHaveBeenCalledWith('p2')
  })

  it('edit action opens the profile editor window with the profile id', async () => {
    const items = getProfileItems()
    const children = await items[1]?.children?.()
    children?.find((i) => i.id === 'profile-edit-p2')?.action?.()
    expect(windowsMock.open).toHaveBeenCalledWith('profileEditor', {
      profileId: 'p2',
    })
  })
})

describe('getColumnTypeItems', () => {
  it('exposes every grouped column type with unique ids and a children step', () => {
    const items = getColumnTypeItems()
    expect(items.length).toBeGreaterThan(0)
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of items) {
      expect(item.id, item.id).toMatch(/^col-/)
      expect(item.label, item.id).toBeTruthy()
      expect(item.icon, item.id).toBeTruthy()
      expect(item.group, item.id).toBeTruthy()
      expect(typeof item.children, item.id).toBe('function')
    }
  })
})
