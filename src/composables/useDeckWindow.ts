import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { DeckWindowLayout } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { emitTauri, listenTauri } from '@/utils/tauriEvents'

let windowCounter = 0

function genWindowId(): string {
  return `deck-${Date.now()}-${++windowCounter}`
}

const openWindows = new Map<string, WebviewWindow>()

/**
 * Open a new deck sub-window for a popped-out column.
 * Uses the same profile as the current window, filtered by windowId.
 */
export async function openColumnWindow(
  profileId: string,
  windowId: string,
  options?: Partial<{ width: number; height: number; x: number; y: number }>,
): Promise<string | null> {
  const url = `/?profile=${profileId}&window=${windowId}`

  try {
    const win = new WebviewWindow(windowId, {
      url,
      title: 'NoteDeck',
      width: options?.width ?? 500,
      height: options?.height ?? 700,
      x: options?.x,
      y: options?.y,
      minWidth: 300,
      minHeight: 300,
      decorations: false,
      resizable: true,
      visible: false,
      dragDropEnabled: true,
    })

    await new Promise<void>((resolve, reject) => {
      win.once('tauri://created', () => resolve())
      win.once('tauri://error', (e) => reject(new Error(String(e.payload))))
    })
    openWindows.set(windowId, win)

    // When sub-window closes, recall its columns back to main
    win.once('tauri://destroyed', () => {
      openWindows.delete(windowId)
      const deckStore = useDeckStore()
      deckStore.recallColumnsFromWindow(windowId)
      deckStore.removeWindowLayout(windowId)
      // Notify other windows
      emitTauri('deck:window-closed', { windowId }).catch((e) => {
        if (import.meta.env.DEV) console.debug('[deck-window] emit failed:', e)
      })
    })

    return windowId
  } catch (e) {
    console.warn('[deck-window] failed to open column window:', e)
    return null
  }
}

/**
 * Open a new deck window with the given profile (mirror mode).
 */
export async function openDeckWindow(
  profileId: string,
): Promise<string | null> {
  const windowId = genWindowId()
  const url = `/?profile=${profileId}`

  try {
    const win = new WebviewWindow(windowId, {
      url,
      title: 'NoteDeck',
      // Match the main window defaults (tauri.conf.json) so a new window
      // opens at the same size instead of a smaller one.
      width: 1200,
      height: 800,
      minWidth: 360,
      minHeight: 640,
      decorations: false,
      resizable: true,
      visible: false,
      dragDropEnabled: true,
    })

    await new Promise<void>((resolve, reject) => {
      win.once('tauri://created', () => resolve())
      win.once('tauri://error', (e) => reject(new Error(String(e.payload))))
    })
    openWindows.set(windowId, win)

    win.once('tauri://destroyed', () => {
      openWindows.delete(windowId)
    })

    return windowId
  } catch (e) {
    console.warn('[deck-window] failed to open:', e)
    return null
  }
}

export function getOpenDeckWindows(): ReadonlyMap<string, WebviewWindow> {
  return openWindows
}

/**
 * Pop out a column into its own sub-window.
 * Returns the windowId on success, null on failure.
 */
export async function popOutColumnToWindow(
  columnId: string,
): Promise<string | null> {
  const deckStore = useDeckStore()
  const col = deckStore.getColumn(columnId)
  if (!col || !deckStore.windowProfileId) return null

  const windowId = genWindowId()
  deckStore.popOutColumn(columnId, windowId)
  // Flush save synchronously so the sub-window can read the updated profile
  deckStore.flushSave()

  const result = await openColumnWindow(deckStore.windowProfileId, windowId, {
    width: col.width + 40,
    height: 700,
  })

  if (!result) {
    // Failed to open — recall column back
    deckStore.recallColumn(columnId)
    return null
  }

  return windowId
}

/**
 * Save the current window's position and size to the profile.
 * Pass `{ immediate: true }` from beforeunload so the persist isn't lost
 * to the debounce timer that wouldn't fire before the window closes.
 */
export async function saveCurrentWindowLayout(opts?: {
  immediate?: boolean
}): Promise<void> {
  const deckStore = useDeckStore()
  if (!deckStore.currentWindowId) return

  try {
    const { getCurrentWindow, currentMonitor } = await import(
      '@tauri-apps/api/window'
    )
    const win = getCurrentWindow()
    const [pos, size, monitor] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      currentMonitor(),
    ])

    const layout: DeckWindowLayout = {
      id: deckStore.currentWindowId,
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      monitor: monitor?.name ?? undefined,
    }
    deckStore.saveWindowLayout(layout, opts)
  } catch {
    // Ignore — may fail on non-Tauri environment
  }
}

/**
 * Listen for cross-window events (column moves, window closes).
 * Call from main window to handle sub-window lifecycle.
 */
export async function listenDeckWindowEvents(): Promise<() => void> {
  const cleanups: (() => void)[] = []

  // When a sub-window closes, its columns are recalled (handled in openColumnWindow)
  // But we also need to listen for cross-window column moves
  const unlisten1 = await listenTauri('deck:move-column', (payload) => {
    const deckStore = useDeckStore()
    deckStore.moveColumnToWindow(payload.columnId, payload.targetWindowId)
  })
  cleanups.push(unlisten1)

  const unlisten2 = await listenTauri('deck:window-closed', () => {
    // Sub-window already handles recall in its destroyed handler
    // This event is for UI refresh in other windows
  })
  cleanups.push(unlisten2)

  // Cross-window drag: show overlay when another window starts dragging
  const unlisten3 = await listenTauri('deck:drag-start', (payload) => {
    const deckStore = useDeckStore()
    const myWindowId = deckStore.currentWindowId ?? '__main__'
    // Only show overlay if this is NOT the source window
    if (payload.sourceWindowId !== myWindowId) {
      deckStore.crossWindowDragColumnId = payload.columnId
    }
  })
  cleanups.push(unlisten3)

  // Cross-window drag: dismiss overlay when drag ends
  const unlisten4 = await listenTauri('deck:drag-end', (payload) => {
    const deckStore = useDeckStore()
    const myWindowId = deckStore.currentWindowId ?? '__main__'
    if (payload.sourceWindowId !== myWindowId) {
      deckStore.crossWindowDragColumnId = null
    }
  })
  cleanups.push(unlisten4)

  return () => {
    for (const cleanup of cleanups) cleanup()
  }
}

/**
 * Request moving a column to another window via IPC.
 * Updates local store immediately and notifies other windows.
 */
export async function requestMoveColumn(
  columnId: string,
  targetWindowId: string | null,
): Promise<void> {
  const deckStore = useDeckStore()
  // Update local store immediately so the column disappears/appears in this window
  deckStore.moveColumnToWindow(columnId, targetWindowId)
  // Notify other windows
  await emitTauri('deck:move-column', { columnId, targetWindowId })

  // Auto-close sub-window if it has no more columns
  if (deckStore.currentWindowId && deckStore.windowLayout.length === 0) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    getCurrentWindow().close()
  }
}

/**
 * Close all sub-windows opened from the main window.
 */
export async function closeAllSubWindows(): Promise<void> {
  const promises: Promise<void>[] = []
  for (const [, win] of openWindows) {
    // Timeout to prevent hanging on stale window references
    promises.push(
      Promise.race([
        win.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]),
    )
  }
  await Promise.allSettled(promises)
  openWindows.clear()
}

/**
 * Resolve window position for a saved layout, adjusting for monitor changes.
 * If the saved monitor is still available, use the saved coordinates.
 * If not, fall back to the primary monitor with centered placement.
 */
async function resolveWindowPosition(
  wl: DeckWindowLayout,
): Promise<{ x: number; y: number }> {
  try {
    const { availableMonitors, primaryMonitor } = await import(
      '@tauri-apps/api/window'
    )
    const monitors = await availableMonitors()
    const primary = await primaryMonitor()

    if (!wl.monitor || monitors.length === 0) {
      return { x: wl.x, y: wl.y }
    }

    // Check if the saved monitor is still connected
    const savedMonitor = monitors.find((m) => m.name === wl.monitor)
    if (savedMonitor) {
      // Monitor exists — verify coordinates are within its bounds
      const mx = savedMonitor.position.x
      const my = savedMonitor.position.y
      const mw = savedMonitor.size.width / savedMonitor.scaleFactor
      const mh = savedMonitor.size.height / savedMonitor.scaleFactor
      if (
        wl.x >= mx &&
        wl.x + wl.width <= mx + mw &&
        wl.y >= my &&
        wl.y + wl.height <= my + mh
      ) {
        return { x: wl.x, y: wl.y }
      }
      // Window partially off-screen on the same monitor — clamp
      return {
        x: Math.max(mx, Math.min(wl.x, mx + mw - wl.width)),
        y: Math.max(my, Math.min(wl.y, my + mh - wl.height)),
      }
    }

    // Monitor disconnected — center on primary
    if (primary) {
      const px = primary.position.x
      const py = primary.position.y
      const pw = primary.size.width / primary.scaleFactor
      const ph = primary.size.height / primary.scaleFactor
      return {
        x: px + Math.round((pw - wl.width) / 2),
        y: py + Math.round((ph - wl.height) / 2),
      }
    }
  } catch {
    // Tauri API unavailable
  }
  return { x: wl.x, y: wl.y }
}

/**
 * Switch profile with window layout restoration.
 * Closes existing sub-windows, applies the profile, then opens saved windows.
 */
export async function switchProfileWithWindows(
  profileId: string,
): Promise<void> {
  const deckStore = useDeckStore()

  // 1. Close all sub-windows (this recalls columns via destroyed handler)
  await closeAllSubWindows()

  // 2. Apply the profile (loads columns with saved windowIds)
  deckStore.applyProfile(profileId)

  // 3. Restore sub-windows from saved layouts
  const savedWindows = deckStore.getWindowLayouts()
  if (!savedWindows.length || !deckStore.windowProfileId) return

  for (const wl of savedWindows) {
    // Check if any columns are assigned to this window
    const hasColumns = deckStore.columns.some((c) => c.windowId === wl.id)
    if (!hasColumns) continue

    const pos = await resolveWindowPosition(wl)

    await openColumnWindow(deckStore.windowProfileId, wl.id, {
      width: wl.width,
      height: wl.height,
      x: pos.x,
      y: pos.y,
    })
  }
}
