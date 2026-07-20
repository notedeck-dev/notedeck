import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/composables/useAccountActions', () => ({
  useAccountActions: vi.fn(() => ({})),
}))
vi.mock('@/composables/useEntityCrud', () => ({
  isEntityType: vi.fn(() => false),
  useEntityCrud: vi.fn(),
}))
vi.mock('@/composables/useTutorial', () => ({
  useTutorialStore: vi.fn(() => ({ start: vi.fn() })),
}))
vi.mock('@/composables/useDeckWindow', () => ({
  switchProfileWithWindows: vi.fn(),
  popOutColumnToWindow: vi.fn(),
  openDeckWindow: vi.fn(),
  closeAllSubWindows: vi.fn(),
}))
vi.mock('@/stores/accounts', () => ({
  getAccountAvatarUrl: vi.fn(() => null),
  useAccountsStore: vi.fn(() => ({ accounts: [], activeAccount: undefined })),
}))
vi.mock('@/stores/confirm', () => ({ useConfirm: vi.fn() }))
vi.mock('@/stores/deck', () => ({ useDeckStore: vi.fn() }))
vi.mock('@/stores/keybinds', () => ({
  useKeybindsStore: vi.fn(() => ({ getShortcuts: () => [] })),
}))
vi.mock('@/stores/offlineMode', () => ({ useOfflineModeStore: vi.fn() }))
vi.mock('@/stores/realtimeMode', () => ({ useRealtimeModeStore: vi.fn() }))
vi.mock('@/stores/taskRunner', () => ({ useTaskRunnerStore: vi.fn() }))
vi.mock('@/stores/theme', () => ({ useThemeStore: vi.fn() }))
vi.mock('@/stores/toast', () => ({
  useToast: vi.fn(() => ({ show: vi.fn() })),
}))
vi.mock('@/stores/ui', () => ({ useUiStore: vi.fn() }))
vi.mock('@/stores/windows', () => ({ useWindowsStore: vi.fn() }))
vi.mock('@/utils/customTimelines', () => ({
  clearAvailableTlCache: vi.fn(),
  detectAvailableTimelines: vi.fn(),
  modeIcon: vi.fn(() => 'moon'),
  modeLabel: vi.fn(() => 'モード'),
}))
vi.mock('@/utils/imageProxy', () => ({ proxyThumbUrl: (u: unknown) => u }))

import { useDeckStore } from '@/stores/deck'
import { useThemeStore } from '@/stores/theme'
import { useUiStore } from '@/stores/ui'
import {
  type CommandHandlers,
  refreshProfileCommands,
  registerDefaultCommands,
  unregisterDefaultCommands,
} from './definitions'
import { useCommandStore } from './registry'

const VALID_CATEGORIES = [
  'general',
  'navigation',
  'column',
  'account',
  'note',
  'window',
]

function makeHandlers(): CommandHandlers {
  return {
    openCompose: vi.fn(),
    openSearch: vi.fn(),
    openNotifications: vi.fn(),
    toggleAddMenu: vi.fn(),
    toggleNav: vi.fn(),
    toggleAccountMenu: vi.fn(),
  }
}

function makeDeckMock(overrides: Record<string, unknown> = {}) {
  return {
    activeColumnId: null as string | null,
    windowProfileId: 'wp-1',
    columns: [],
    getProfiles: vi.fn(() => [] as { id: string; name: string }[]),
    getColumn: vi.fn(),
    moveLeft: vi.fn(),
    moveRight: vi.fn(),
    focusNextColumn: vi.fn(),
    focusPrevColumn: vi.fn(),
    focusColumnByIndex: vi.fn(),
    removeColumn: vi.fn(),
    updateColumn: vi.fn(),
    saveAsProfile: vi.fn(),
    toggleSidebarColumn: vi.fn(),
    ...overrides,
  }
}

let deckMock: ReturnType<typeof makeDeckMock>
let themeMock: { toggleTheme: ReturnType<typeof vi.fn> }

beforeEach(() => {
  setActivePinia(createPinia())
  deckMock = makeDeckMock()
  themeMock = { toggleTheme: vi.fn() }
  vi.mocked(useDeckStore).mockReturnValue(deckMock as never)
  vi.mocked(useThemeStore).mockReturnValue(themeMock as never)
  vi.mocked(useUiStore).mockReturnValue({ isDesktop: true } as never)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('registerDefaultCommands integrity', () => {
  it('registers commands with unique ids, required fields and valid categories', () => {
    const store = useCommandStore()
    const spy = vi.spyOn(store, 'register')
    registerDefaultCommands(makeHandlers())

    const registered = spy.mock.calls.map(([cmd]) => cmd)
    expect(registered.length).toBeGreaterThan(0)

    const ids = registered.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const cmd of registered) {
      expect(cmd.id, cmd.id).toBeTruthy()
      expect(cmd.label, cmd.id).toBeTruthy()
      expect(cmd.icon, cmd.id).toBeTruthy()
      expect(VALID_CATEGORIES, cmd.id).toContain(cmd.category)
      expect(typeof cmd.execute, cmd.id).toBe('function')
    }
  })

  it('unregisterDefaultCommands removes all registered commands', () => {
    const store = useCommandStore()
    registerDefaultCommands(makeHandlers())
    expect(store.commands.size).toBeGreaterThan(0)
    unregisterDefaultCommands()
    expect([...store.commands.keys()]).toEqual([])
  })

  it('skips desktop-only commands when not on desktop', () => {
    vi.mocked(useUiStore).mockReturnValue({ isDesktop: false } as never)
    const store = useCommandStore()
    registerDefaultCommands(makeHandlers())
    expect(store.commands.get('boss-key')).toBeUndefined()
    expect(store.commands.get('pop-out-column')).toBeUndefined()
    expect(store.commands.get('devtools')).toBeUndefined()
  })
})

describe('representative command wiring', () => {
  it('compose executes the openCompose handler', () => {
    const store = useCommandStore()
    const handlers = makeHandlers()
    registerDefaultCommands(handlers)
    store.execute('compose')
    expect(handlers.openCompose).toHaveBeenCalledOnce()
  })

  it('toggle-dark-mode calls themeStore.toggleTheme', () => {
    const store = useCommandStore()
    registerDefaultCommands(makeHandlers())
    store.execute('toggle-dark-mode')
    expect(themeMock.toggleTheme).toHaveBeenCalledOnce()
  })

  it('column-next delegates to deckStore.focusNextColumn', () => {
    const store = useCommandStore()
    registerDefaultCommands(makeHandlers())
    store.execute('column-next')
    expect(deckMock.focusNextColumn).toHaveBeenCalledOnce()
  })

  it('move-column-left is disabled without an active column and moves when one exists', () => {
    const store = useCommandStore()
    registerDefaultCommands(makeHandlers())
    const cmd = store.commands.get('move-column-left')
    expect(cmd?.enabled?.()).toBe(false)
    deckMock.activeColumnId = 'col-1'
    expect(cmd?.enabled?.()).toBe(true)
    store.execute('move-column-left')
    expect(deckMock.moveLeft).toHaveBeenCalledWith('col-1')
  })

  it('note-next dispatches an nd:note-action CustomEvent on document', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('document', { dispatchEvent })
    vi.stubGlobal(
      'CustomEvent',
      class extends Event {
        detail: unknown
        constructor(type: string, opts?: { detail: unknown }) {
          super(type)
          this.detail = opts?.detail
        }
      },
    )
    const store = useCommandStore()
    registerDefaultCommands(makeHandlers())
    store.execute('note-next')
    expect(dispatchEvent).toHaveBeenCalledOnce()
    const event = dispatchEvent.mock.calls[0]?.[0]
    expect(event.type).toBe('nd:note-action')
    expect(event.detail).toBe('next')
  })
})

describe('refreshProfileCommands', () => {
  it('registers a switch command per profile, capped at 9', () => {
    deckMock.getProfiles.mockReturnValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `p${i + 1}`,
        name: `Profile ${i + 1}`,
      })),
    )
    const store = useCommandStore()
    refreshProfileCommands()
    expect(store.commands.get('profile-1')?.label).toBe('Profile 1 に切替')
    expect(store.commands.get('profile-9')).toBeDefined()
    expect(store.commands.get('profile-10')).toBeUndefined()
  })

  it('unregisters stale profile commands when profiles shrink', () => {
    const store = useCommandStore()
    deckMock.getProfiles.mockReturnValue([
      { id: 'p1', name: 'One' },
      { id: 'p2', name: 'Two' },
    ])
    refreshProfileCommands()
    expect(store.commands.get('profile-2')).toBeDefined()
    deckMock.getProfiles.mockReturnValue([{ id: 'p1', name: 'One' }])
    refreshProfileCommands()
    expect(store.commands.get('profile-1')).toBeDefined()
    expect(store.commands.get('profile-2')).toBeUndefined()
  })
})
