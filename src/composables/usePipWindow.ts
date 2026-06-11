import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { DeckColumn } from '@/stores/deck'
import { WINDOW_SIZES, type WindowType } from '@/stores/windows'
import { listenTauri } from '@/utils/tauriEvents'

const PIP_WIDTH = 360
const PIP_HEIGHT = 640
const PIP_MIN_WIDTH = 280
const PIP_MIN_HEIGHT = 400
const PIP_WINDOW_MAX_HEIGHT = 900

const pipWindows = new Map<string, WebviewWindow>()
const creatingSet = new Set<string>()
let pipCounter = 0

function genPipLabel(): string {
  return `pip-${Date.now()}-${++pipCounter}`
}

function encodePayload(value: unknown): string {
  return btoa(encodeURIComponent(JSON.stringify(value)))
}

/**
 * Open a new PiP window.
 * - Without columnConfig: shows column selector inside the PiP window
 * - With columnConfig: immediately renders the specified column
 */
export async function openPipWindow(
  columnConfig?: Omit<DeckColumn, 'id'>,
): Promise<void> {
  const url = columnConfig ? `/pip?col=${encodePayload(columnConfig)}` : '/pip'
  await createPipWebview(url, {
    width: PIP_WIDTH,
    height: PIP_HEIGHT,
    minWidth: PIP_MIN_WIDTH,
    minHeight: PIP_MIN_HEIGHT,
  })
}

/**
 * Open a new PiP window that renders a single window-type component
 * (e.g. note-detail, user-profile, keybinds). Lets PiP users navigate
 * from inside a PiP context while staying in OS-level PiP windows.
 */
export async function openPipWindowForWindow(
  type: WindowType,
  props: Record<string, unknown> = {},
): Promise<void> {
  const size = WINDOW_SIZES[type]
  const width = size?.width ?? PIP_WIDTH
  const height = Math.min(size?.maxHeight ?? PIP_HEIGHT, PIP_WINDOW_MAX_HEIGHT)
  const url = `/pip?win=${encodePayload({ type, props })}`
  await createPipWebview(url, {
    width,
    height,
    minWidth: PIP_MIN_WIDTH,
    minHeight: Math.min(PIP_MIN_HEIGHT, height),
  })
}

async function createPipWebview(
  url: string,
  sizes: {
    width: number
    height: number
    minWidth: number
    minHeight: number
  },
): Promise<void> {
  const label = genPipLabel()

  if (creatingSet.has(label)) return
  creatingSet.add(label)

  try {
    const win = new WebviewWindow(label, {
      url,
      title: 'NoteDeck PiP',
      width: sizes.width,
      height: sizes.height,
      minWidth: sizes.minWidth,
      minHeight: sizes.minHeight,
      decorations: false,
      alwaysOnTop: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      visible: true,
      dragDropEnabled: false,
    })

    // Wait for actual creation or error
    await new Promise<void>((resolve, reject) => {
      win.once('tauri://created', () => resolve())
      win.once('tauri://error', (e) => reject(new Error(String(e.payload))))
    })

    // Windows: constructor alwaysOnTop may not take effect; re-apply explicitly
    await win.setAlwaysOnTop(true)

    pipWindows.set(label, win)

    // Clean up reference when window is closed
    win.once('tauri://destroyed', () => {
      pipWindows.delete(label)
    })
  } catch {
    // ignore
  } finally {
    creatingSet.delete(label)
  }
}

export async function closeAllPipWindows(): Promise<void> {
  for (const [, win] of pipWindows) {
    try {
      await win.close()
    } catch {
      // Already closed
    }
  }
  pipWindows.clear()
}

export function isPipOpen(): boolean {
  return pipWindows.size > 0
}

/**
 * Listen for IPC events from PiP windows (call from main window).
 * Returns cleanup function.
 */
export async function listenPipEvents(handlers: {
  onReturnToDeck?: (columnConfig: Omit<DeckColumn, 'id'>) => void
}): Promise<() => void> {
  return await listenTauri('pip:return-to-deck', (payload) => {
    handlers.onReturnToDeck?.(payload)
  })
}
