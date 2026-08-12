// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeckStore } from '@/stores/deck'
import { useWidgetsStore } from '@/stores/widgets'

// Mock localStorage
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
})

describe('deck store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    storage.clear()
    // Initialize profile store (creates default profile)
    useDeckStore().load()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('addColumn creates a column and updates layout', () => {
    const deck = useDeckStore()

    const col = deck.addColumn({
      type: 'timeline',
      name: 'Home',
      width: 400,
      accountId: 'acc1',
      tl: 'home',
    })

    expect(deck.columns).toHaveLength(1)
    expect(deck.columns[0]?.id).toBe(col.id)
    expect(deck.layout).toEqual([[col.id]])
  })

  it('removeColumn removes column and layout entry', () => {
    const deck = useDeckStore()
    const col = deck.addColumn({
      type: 'timeline',
      name: null,
      width: 400,
      accountId: null,
    })

    deck.removeColumn(col.id)

    expect(deck.columns).toHaveLength(0)
    expect(deck.layout).toHaveLength(0)
  })

  it('updateColumn modifies column properties', () => {
    const deck = useDeckStore()
    const col = deck.addColumn({
      type: 'timeline',
      name: 'Old',
      width: 400,
      accountId: null,
    })

    deck.updateColumn(col.id, { name: 'New', width: 500 })

    expect(deck.getColumn(col.id)?.name).toBe('New')
    expect(deck.getColumn(col.id)?.width).toBe(500)
  })

  it('swapColumns swaps layout positions', () => {
    const deck = useDeckStore()
    const col1 = deck.addColumn({
      type: 'timeline',
      name: 'A',
      width: 400,
      accountId: null,
    })
    const col2 = deck.addColumn({
      type: 'timeline',
      name: 'B',
      width: 400,
      accountId: null,
    })

    deck.swapColumns(0, 1)

    expect(deck.layout[0]).toEqual([col2.id])
    expect(deck.layout[1]).toEqual([col1.id])
  })

  it('moveLeft moves column one position left', () => {
    const deck = useDeckStore()
    const col1 = deck.addColumn({
      type: 'timeline',
      name: 'A',
      width: 400,
      accountId: null,
    })
    const col2 = deck.addColumn({
      type: 'timeline',
      name: 'B',
      width: 400,
      accountId: null,
    })

    deck.moveLeft(col2.id)

    expect(deck.layout[0]).toEqual([col2.id])
    expect(deck.layout[1]).toEqual([col1.id])
  })

  it('moveRight moves column one position right', () => {
    const deck = useDeckStore()
    const col1 = deck.addColumn({
      type: 'timeline',
      name: 'A',
      width: 400,
      accountId: null,
    })
    const col2 = deck.addColumn({
      type: 'timeline',
      name: 'B',
      width: 400,
      accountId: null,
    })

    deck.moveRight(col1.id)

    expect(deck.layout[0]).toEqual([col2.id])
    expect(deck.layout[1]).toEqual([col1.id])
  })

  it('does not move past boundaries', () => {
    const deck = useDeckStore()
    const col1 = deck.addColumn({
      type: 'timeline',
      name: 'A',
      width: 400,
      accountId: null,
    })
    const col2 = deck.addColumn({
      type: 'timeline',
      name: 'B',
      width: 400,
      accountId: null,
    })

    deck.moveLeft(col1.id) // already leftmost
    deck.moveRight(col2.id) // already rightmost

    expect(deck.layout[0]).toEqual([col1.id])
    expect(deck.layout[1]).toEqual([col2.id])
  })

  it('save/load persists state to localStorage', () => {
    const deck = useDeckStore()
    const col = deck.addColumn({
      type: 'timeline',
      name: 'Test',
      width: 400,
      accountId: 'acc1',
    })

    // Flush the debounced save timer (PERSIST_DEBOUNCE_MS = 300)
    vi.advanceTimersByTime(300)

    // Create a new store instance and load
    setActivePinia(createPinia())
    const deck2 = useDeckStore()
    deck2.load()

    expect(deck2.columns).toHaveLength(1)
    expect(deck2.columns[0]?.id).toBe(col.id)
    expect(deck2.layout).toEqual([[col.id]])
  })

  it('removeColumn persists across app restart (profile-aware)', () => {
    const deck = useDeckStore()
    deck.load() // creates default profile, sets windowProfileId

    const col1 = deck.addColumn({
      type: 'timeline',
      name: 'A',
      width: 400,
      accountId: null,
    })
    const col2 = deck.addColumn({
      type: 'timeline',
      name: 'B',
      width: 400,
      accountId: null,
    })
    vi.advanceTimersByTime(100) // flush debounced save

    // Remove column A
    deck.removeColumn(col1.id)

    // Simulate app restart
    setActivePinia(createPinia())
    const deck2 = useDeckStore()
    deck2.load()

    expect(deck2.columns).toHaveLength(1)
    expect(deck2.columns[0]?.name).toBe('B')
    expect(deck2.columns[0]?.id).toBe(col2.id)
  })

  it('clear removes all columns and layout', () => {
    const deck = useDeckStore()
    deck.addColumn({ type: 'timeline', name: 'A', width: 400, accountId: null })
    deck.addColumn({
      type: 'notifications',
      name: 'B',
      width: 400,
      accountId: null,
    })

    deck.clear()

    expect(deck.columns).toHaveLength(0)
    expect(deck.layout).toHaveLength(0)
  })

  describe('deck profiles', () => {
    it('saveAsProfile creates empty profile and clears deck', () => {
      const deck = useDeckStore()
      deck.addColumn({
        type: 'timeline',
        name: 'Home',
        width: 330,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      const profile = deck.saveAsProfile('Work')

      expect(profile.name).toBe('Work')
      expect(profile.columns).toHaveLength(0)
      expect(profile.layout).toHaveLength(0)
      expect(deck.columns).toHaveLength(0)
      expect(deck.layout).toHaveLength(0)
      expect(deck.activeProfileId).toBe(profile.id)
    })

    it('applyProfile restores saved layout', () => {
      const deck = useDeckStore()

      // Create profile 1 (empty), then add a column to it
      const p1 = deck.saveAsProfile('Work')
      vi.advanceTimersByTime(100)
      deck.addColumn({
        type: 'timeline',
        name: 'Home',
        width: 330,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      // Create profile 2 (auto-saves p1 with 1 column), then add a column
      const _p2 = deck.saveAsProfile('Play')
      vi.advanceTimersByTime(100)
      deck.addColumn({
        type: 'notifications',
        name: 'Notif',
        width: 300,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      // Switch back to p1 — should restore 1-column layout
      deck.applyProfile(p1.id)

      expect(deck.columns).toHaveLength(1)
      expect(deck.columns[0]?.name).toBe('Home')
    })

    it('deleteProfile removes a profile', () => {
      const deck = useDeckStore()
      const initialCount = deck.getProfiles().length
      const profile = deck.saveAsProfile('Temp')
      expect(deck.getProfiles()).toHaveLength(initialCount + 1)
      deck.deleteProfile(profile.id)
      expect(deck.getProfiles()).toHaveLength(initialCount)
    })

    it('renameProfile updates profile name', () => {
      const deck = useDeckStore()
      const profile = deck.saveAsProfile('Old Name')
      deck.renameProfile(profile.id, 'New Name')
      const renamed = deck.getProfiles().find((p) => p.name === 'New Name')
      expect(renamed).toBeDefined()
    })

    it('applyProfile does not mutate the other profile', () => {
      const deck = useDeckStore()

      // Create p1 (empty), add column
      const p1 = deck.saveAsProfile('P1')
      vi.advanceTimersByTime(100)
      deck.addColumn({
        type: 'timeline',
        name: 'Home',
        width: 330,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      // Create p2 (auto-saves p1 with [Home]), add column
      const p2 = deck.saveAsProfile('P2')
      vi.advanceTimersByTime(100)
      deck.addColumn({
        type: 'notifications',
        name: 'Notif',
        width: 300,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      // Switch to p1 (auto-saves p2 with [Notif]), modify column name
      deck.applyProfile(p1.id)
      deck.updateColumn(deck.columns[0]?.id, { name: 'Changed' })
      vi.advanceTimersByTime(100)

      // Switch to p2 (auto-saves p1 with [Changed]) — p2 should still have [Notif]
      deck.applyProfile(p2.id)

      expect(deck.columns).toHaveLength(1)
      expect(deck.columns[0]?.name).toBe('Notif')
    })

    it('applyProfile with invalid id does nothing', () => {
      const deck = useDeckStore()
      deck.addColumn({
        type: 'timeline',
        name: 'Keep',
        width: 400,
        accountId: null,
      })

      deck.applyProfile('nonexistent')

      expect(deck.columns).toHaveLength(1)
      expect(deck.columns[0]?.name).toBe('Keep')
    })

    it('applyProfile sets activeProfileId', () => {
      const deck = useDeckStore()
      const p1 = deck.saveAsProfile('Work')
      vi.advanceTimersByTime(100)
      const _p2 = deck.saveAsProfile('Play')
      vi.advanceTimersByTime(100)

      deck.applyProfile(p1.id)

      expect(deck.activeProfileId).toBe(p1.id)
    })

    it('switching profiles auto-saves current state to active profile', () => {
      const deck = useDeckStore()

      // Create Profile 1 (empty), add 1 column
      const p1 = deck.saveAsProfile('Profile 1')
      vi.advanceTimersByTime(100)
      deck.addColumn({
        type: 'timeline',
        name: 'Home',
        width: 330,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      // Create Profile 2 (auto-saves p1 with 1 column), add 1 column
      const p2 = deck.saveAsProfile('Profile 2')
      vi.advanceTimersByTime(100)
      deck.addColumn({
        type: 'notifications',
        name: 'Notif',
        width: 300,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      // Switch to p1 — should auto-save p2 with 1 column
      deck.applyProfile(p1.id)

      // Add another column while on p1
      deck.addColumn({
        type: 'search',
        name: 'Search',
        width: 300,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      // Switch to p2 — should auto-save p1 with 2 columns (original 1 + added 1)
      deck.applyProfile(p2.id)

      const profiles = deck.getProfiles()
      const savedP1 = profiles.find((p) => p.id === p1.id)
      expect(savedP1?.columns).toHaveLength(2)
    })

    it('saveAsProfile auto-saves current state to previous profile', () => {
      const deck = useDeckStore()

      // Create profile 1 (empty), add columns
      const p1 = deck.saveAsProfile('Profile 1')
      vi.advanceTimersByTime(100)
      deck.addColumn({
        type: 'timeline',
        name: 'Home',
        width: 330,
        accountId: 'a1',
      })
      deck.addColumn({
        type: 'notifications',
        name: 'Notif',
        width: 300,
        accountId: 'a1',
      })
      vi.advanceTimersByTime(100)

      // Create profile 2 — should auto-save p1 with 2 columns
      deck.saveAsProfile('Profile 2')

      const savedP1 = deck.getProfiles().find((p) => p.id === p1.id)
      expect(savedP1?.columns).toHaveLength(2)
    })

    it('deleteProfile falls back to first profile when deleting active profile', () => {
      const deck = useDeckStore()
      const defaultProfiles = deck.getProfiles()
      const firstId = defaultProfiles[0]?.id
      const profile = deck.saveAsProfile('Temp')
      expect(deck.activeProfileId).toBe(profile.id)

      deck.deleteProfile(profile.id)

      // Falls back to the default profile
      expect(deck.activeProfileId).toBe(firstId)
    })
  })

  describe('column stacking', () => {
    it('stackColumn merges two columns into one group (below)', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })

      deck.stackColumn(col2.id, col1.id, 'below')

      expect(deck.layout).toHaveLength(1)
      expect(deck.layout[0]).toEqual([col1.id, col2.id])
    })

    it('stackColumn merges two columns into one group (above)', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })

      deck.stackColumn(col2.id, col1.id, 'above')

      expect(deck.layout).toHaveLength(1)
      expect(deck.layout[0]).toEqual([col2.id, col1.id])
    })

    it('stackColumn adds to existing group', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })
      const col3 = deck.addColumn({
        type: 'search',
        name: 'C',
        width: 400,
        accountId: null,
      })

      deck.stackColumn(col2.id, col1.id, 'below')
      deck.stackColumn(col3.id, col2.id, 'below')

      expect(deck.layout).toHaveLength(1)
      expect(deck.layout[0]).toEqual([col1.id, col2.id, col3.id])
    })

    it('stackColumn does nothing when stacking onto self', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })

      deck.stackColumn(col1.id, col1.id, 'below')

      expect(deck.layout).toHaveLength(1)
      expect(deck.layout[0]).toEqual([col1.id])
    })

    it('unstackColumn separates a column from its group', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })

      deck.stackColumn(col2.id, col1.id, 'below')
      deck.unstackColumn(col2.id)

      expect(deck.layout).toHaveLength(2)
      expect(deck.layout[0]).toEqual([col1.id])
      expect(deck.layout[1]).toEqual([col2.id])
    })

    it('unstackColumn does nothing for solo column', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })

      deck.unstackColumn(col1.id)

      expect(deck.layout).toHaveLength(1)
      expect(deck.layout[0]).toEqual([col1.id])
    })

    it('swapInGroup swaps two columns within the same group', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })
      const col3 = deck.addColumn({
        type: 'search',
        name: 'C',
        width: 400,
        accountId: null,
      })

      // Stack all three into one group
      deck.stackColumn(col2.id, col1.id, 'below')
      deck.stackColumn(col3.id, col2.id, 'below')
      expect(deck.layout[0]).toEqual([col1.id, col2.id, col3.id])

      // Swap first and third
      deck.swapInGroup(col1.id, col3.id)
      expect(deck.layout[0]).toEqual([col3.id, col2.id, col1.id])
    })

    it('swapInGroup does nothing for columns in different groups', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })

      deck.swapInGroup(col1.id, col2.id)

      expect(deck.layout).toHaveLength(2)
      expect(deck.layout[0]).toEqual([col1.id])
      expect(deck.layout[1]).toEqual([col2.id])
    })

    it('insertColumnAt moves a stacked column to a specific layout position', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })
      const col3 = deck.addColumn({
        type: 'search',
        name: 'C',
        width: 400,
        accountId: null,
      })

      // Stack col2 onto col1
      deck.stackColumn(col2.id, col1.id, 'below')
      // Layout: [[col1, col2], [col3]]

      // Insert col2 at position 2 (after col3)
      deck.insertColumnAt(col2.id, 2)

      expect(deck.layout).toHaveLength(3)
      expect(deck.layout[0]).toEqual([col1.id])
      expect(deck.layout[1]).toEqual([col3.id])
      expect(deck.layout[2]).toEqual([col2.id])
    })

    it('insertColumnAt moves a stacked column to position 0', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })

      // Stack col2 onto col1
      deck.stackColumn(col2.id, col1.id, 'below')
      // Layout: [[col1, col2]]

      // Insert col2 at position 0
      deck.insertColumnAt(col2.id, 0)

      expect(deck.layout).toHaveLength(2)
      expect(deck.layout[0]).toEqual([col2.id])
      expect(deck.layout[1]).toEqual([col1.id])
    })

    it('insertColumnAt does nothing for solo column at same position', () => {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })

      deck.insertColumnAt(col1.id, 0)

      expect(deck.layout).toHaveLength(1)
      expect(deck.layout[0]).toEqual([col1.id])
    })
  })

  describe('multi-window layout', () => {
    /** 2 本のカラムを 1 グループに縦分割して返す */
    function stackedPair() {
      const deck = useDeckStore()
      const col1 = deck.addColumn({
        type: 'timeline',
        name: 'A',
        width: 400,
        accountId: null,
      })
      const col2 = deck.addColumn({
        type: 'notifications',
        name: 'B',
        width: 400,
        accountId: null,
      })
      deck.stackColumn(col2.id, col1.id, 'below')
      return { deck, col1, col2 }
    }

    it('moveColumnToWindow は分割を解除してから移す', () => {
      const { deck, col1, col2 } = stackedPair()

      deck.moveColumnToWindow(col2.id, 'w1')

      expect(deck.layout).toEqual([[col1.id], [col2.id]])
    })

    it('windowLayout は同じグループ内の他ウィンドウのカラムを含めない', () => {
      const { deck, col1, col2 } = stackedPair()
      // 分割したまま移された旧データ相当の状態を直接作る
      deck.updateColumn(col2.id, { windowId: 'w1' })

      expect(deck.windowLayout).toEqual([[col1.id]])

      deck.currentWindowId = 'w1'
      expect(deck.windowLayout).toEqual([[col2.id]])
    })
  })

  describe('removeWidget は配置から外すだけ (#1048)', () => {
    /** widget カラム 1 本 + ライブラリに 2 個の widget を用意する */
    function setup(sidebar: boolean) {
      const deck = useDeckStore()
      const widgets = useWidgetsStore()
      const col = deck.addColumn({
        type: 'widget',
        name: 'W',
        width: 400,
        accountId: null,
        ...(sidebar ? { sidebar: true } : {}),
      })
      deck.addWidget(col.id, { name: 'first' })
      deck.addWidget(col.id, { name: 'second' })
      const ids = sidebar
        ? [...widgets.sidebarWidgetIds]
        : [...(deck.getColumn(col.id)?.widgetIds ?? [])]
      return { deck, widgets, col, ids }
    }

    const placedIds = (deck: ReturnType<typeof useDeckStore>, id: string) =>
      deck.getColumn(id)?.widgetIds ?? []

    it('sidebar カラムでも widget 本体 (コード) を消さない', () => {
      const { deck, widgets, col, ids } = setup(true)

      deck.removeWidget(col.id, ids[0] as string)

      expect(widgets.sidebarWidgetIds).toEqual([ids[1]])
      // 本体はライブラリに残る (ピッカーから再配置・完全削除できる)
      expect(widgets.widgets.map((w) => w.installId).sort()).toEqual(
        [...ids].sort(),
      )
    })

    it('sidebar カラムの undo は元の位置に戻す', () => {
      const { deck, widgets, col, ids } = setup(true)

      const undo = deck.removeWidget(col.id, ids[0] as string)
      expect(undo).toBeTypeOf('function')
      undo?.()

      expect(widgets.sidebarWidgetIds).toEqual(ids)
    })

    it('通常カラムでも本体を消さず undo で元の位置に戻る', () => {
      const { deck, widgets, col, ids } = setup(false)

      const undo = deck.removeWidget(col.id, ids[0] as string)

      expect(placedIds(deck, col.id)).toEqual([ids[1]])
      expect(widgets.widgets).toHaveLength(2)
      undo?.()
      expect(placedIds(deck, col.id)).toEqual(ids)
    })

    it('配置されていない widget を外しても undo は返さない', () => {
      const { deck, col } = setup(false)

      expect(deck.removeWidget(col.id, 'not-placed')).toBeUndefined()
    })
  })

  describe('deck wallpaper', () => {
    it('setWallpaper sets wallpaper URL', () => {
      const deck = useDeckStore()
      deck.setWallpaper('data:image/png;base64,abc123')
      expect(deck.wallpaper).toBe('data:image/png;base64,abc123')
    })

    it('clearWallpaper removes wallpaper', () => {
      const deck = useDeckStore()
      deck.setWallpaper('data:image/png;base64,abc123')
      deck.clearWallpaper()
      expect(deck.wallpaper).toBeNull()
    })
  })
})
