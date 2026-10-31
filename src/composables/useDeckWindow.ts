import { nextTick } from 'vue'
import type { WindowGeometry } from '@/bindings'
import { commands, events } from '@/bindings'
import { isColumnType } from '@/columns/registry'
import type { DeckColumn, DeckWindowLayout } from '@/stores/deck'
import { useDeckStore } from '@/stores/deck'
import { MOBILE_WINDOW_SIZE } from '@/stores/ui'
import { listenAddressed } from '@/utils/addressedEvents'
import { currentWindowLabel } from '@/utils/settingsFs'
import { emitTauri, listenTauri } from '@/utils/tauriEvents'
import { unwrap } from '@/utils/tauriInvoke'
import { withViewTransition } from '@/utils/viewTransition'
import { createSubWindow, type SubWindowOrigin } from '@/windows/subWindow'

let windowCounter = 0

/** ポップアウトの label = プロファイルの `windows[].id`。形式は Rust が検証する */
function genWindowId(): string {
  return `deck-${Date.now()}-${++windowCounter}`
}

const POPOUT_LABEL = /^deck-\d+-\d+$/

const POPOUT_MIN = { minWidth: 300, minHeight: 300 }
// Match the main window defaults (tauri.conf.json) so a new window opens at
// the same size instead of a smaller one.
const MIRROR_SIZE = { width: 1200, height: 800, minWidth: 360, minHeight: 640 }

/**
 * Open a new deck sub-window for a popped-out column.
 * Uses the same profile as the current window, filtered by windowId.
 * 窓は Rust が作り、閉じたら親に `ChildClosed` が届く (#1131 段 4)
 */
export async function openColumnWindow(
  profileId: string,
  windowId: string,
  origin: SubWindowOrigin,
  options?: Partial<{ width: number; height: number; x: number; y: number }>,
): Promise<string | null> {
  return createSubWindow({ kind: 'popout', profileId, windowId }, origin, {
    width: options?.width ?? 500,
    height: options?.height ?? 700,
    x: options?.x ?? null,
    y: options?.y ?? null,
    ...POPOUT_MIN,
  })
}

/**
 * Open a new deck window with the given profile (mirror mode).
 */
export async function openDeckWindow(
  profileId: string,
): Promise<string | null> {
  return createSubWindow({ kind: 'mirror', profileId }, 'user', {
    ...MIRROR_SIZE,
    x: null,
    y: null,
  })
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

  // ポップアウト先はモバイルサイズ表示で使うので、タイトルバーの「モバイル
  // サイズ」ボタンと同じ寸法で開く (同じスマホ表示なのに窓の大きさが違うと
  // 見比べられない)
  const result = await openColumnWindow(
    deckStore.windowProfileId,
    windowId,
    'user',
    {
      width: MOBILE_WINDOW_SIZE.width,
      height: MOBILE_WINDOW_SIZE.height,
    },
  )

  if (!result) {
    // Failed to open — recall column back
    deckStore.recallColumn(columnId)
    return null
  }

  return windowId
}

/**
 * Rust が記録した子窓の位置と大きさをプロファイルに書く。payload は検証してから
 * 使う (label がポップアウトの形で、数値が有限であること)
 */
function saveChildGeometry(label: string, g: WindowGeometry): void {
  if (!POPOUT_LABEL.test(label)) return
  if (![g.x, g.y, g.width, g.height].every(Number.isFinite)) return
  const layout: DeckWindowLayout = {
    id: label,
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
    monitor: g.monitor ?? undefined,
  }
  useDeckStore().saveWindowLayout(layout)
}

/**
 * Listen for cross-window events (column moves, child windows closing).
 * デッキ画面を描く窓 (デッキ窓とポップアウト) が張る。親宛ての知らせ
 * (`ChildClosed` / `ChildGeometry` / `PipReturnRequested`) は Rust が宛先を決め、
 * 自分宛てだけ受ける
 */
export async function listenDeckWindowEvents(): Promise<() => void> {
  const cleanups: (() => void)[] = []

  // Cross-window column moves
  const unlisten1 = await listenTauri('deck:move-column', (payload) => {
    const deckStore = useDeckStore()
    deckStore.moveColumnToWindow(payload.columnId, payload.targetWindowId)
  })
  cleanups.push(unlisten1)

  // 子のポップアウトが閉じた。× で閉じた (user) ときだけカラムを回収する。
  // lost (終了 / destroy) は回収せず、次回起動で開き直す (#1131 §6)
  const unlistenClosed = await listenAddressed(
    events.childClosed,
    async (p) => {
      if (p.kind !== 'popout') return
      // 名簿に居る label の知らせは偽物 (first-party JS の emit)。聞き直して確かめる
      const live = unwrap(await commands.subWindowList())
      if (live.some((w) => w.label === p.label)) return
      const deckStore = useDeckStore()
      if (p.reason === 'user') {
        deckStore.recallColumnsFromWindow(p.label)
        deckStore.removeWindowLayout(p.label)
      } else if (p.geometry) {
        saveChildGeometry(p.label, p.geometry)
      }
    },
  )
  cleanups.push(unlistenClosed)

  // 子のポップアウトが動いた / 大きさが変わった (Rust が debounce 済み)
  const unlistenGeometry = await listenAddressed(events.childGeometry, (p) => {
    saveChildGeometry(p.label, p.geometry)
  })
  cleanups.push(unlistenGeometry)

  // PiP の「デッキに戻す」。Rust が最も近いデッキ画面を描く祖先に届けるので、
  // 受けた窓は自分の windowId を付けて足す (ポップアウトならそのポップアウトに現れる)
  const unlistenPip = await listenAddressed(
    events.pipReturnRequested,
    async (p) => {
      const column = p.column as Partial<DeckColumn> | null
      if (!column || typeof column !== 'object' || !isColumnType(column.type)) {
        return
      }
      const deckStore = useDeckStore()
      const { id: _, ...rest } = column as DeckColumn
      deckStore.addColumn({
        ...rest,
        windowId: deckStore.currentWindowId ?? undefined,
      })
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setFocus()
    },
  )
  cleanups.push(unlistenPip)

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

/** 名簿から label が消えるまで待つ (destroy は非同期に反映される) */
async function waitUntilGone(labels: string[]): Promise<void> {
  const deadline = Date.now() + 3000
  let remaining = new Set(labels)
  while (remaining.size > 0 && Date.now() < deadline) {
    const live = unwrap(await commands.subWindowList())
    remaining = new Set(
      [...remaining].filter((l) => live.some((w) => w.label === l)),
    )
    if (remaining.size === 0) break
    await new Promise((r) => setTimeout(r, 50))
  }
}

/**
 * この窓の子のポップアウトを閉じる。
 * - `graceful` (「すべてのウィンドウを閉じる」): `close()` で理由は user、カラムは回収される
 * - 既定 (プロファイル切替の前処理): `destroy()` で lost。カラムは回収されず、
 *   旧プロファイルの windowId は残って切り戻しで復元される
 */
export async function closeOwnSubWindows(opts?: {
  graceful?: boolean
}): Promise<void> {
  const me = currentWindowLabel()
  if (!me) return
  const graceful = opts?.graceful ?? false
  try {
    const live = unwrap(await commands.subWindowList())
    const mine = live
      .filter((w) => w.kind === 'popout' && w.parent === me)
      .map((w) => w.label)
    await Promise.allSettled(
      mine.map((l) => commands.subWindowClose(l, graceful)),
    )
    await waitUntilGone(mine)
  } catch (e) {
    console.warn('[deck-window] failed to close sub-windows:', e)
  }
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
      // Monitor exists — verify coordinates are within its bounds.
      // wl は論理px なのでモニター境界 (物理px) も論理px に揃える (#721)
      const mx = savedMonitor.position.x / savedMonitor.scaleFactor
      const my = savedMonitor.position.y / savedMonitor.scaleFactor
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
      const px = primary.position.x / primary.scaleFactor
      const py = primary.position.y / primary.scaleFactor
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
 * この窓の子を閉じ、プロファイルを適用し、保存された窓を開き直す (自動の経路なので
 * 上限に達していれば開かない。開けなかったカラムの見せ方は #1131 §6)
 */
export async function switchProfileWithWindows(
  profileId: string,
): Promise<void> {
  const deckStore = useDeckStore()

  // 1. Close this window's popouts (lost: columns keep their windowId)
  await closeOwnSubWindows()

  // 2. Apply the profile (loads columns with saved windowIds)
  //    カラム一式が入れ替わるのでクロスフェードでフラッシュを抑える。
  //    後続のウィンドウ復元は適用後の state を読むため await 必須
  await withViewTransition(async () => {
    deckStore.applyProfile(profileId)
    await nextTick()
  })

  // 3. Restore sub-windows from saved layouts
  const savedWindows = deckStore.getWindowLayouts()
  if (!savedWindows.length || !deckStore.windowProfileId) return

  for (const wl of savedWindows) {
    // Check if any columns are assigned to this window
    const hasColumns = deckStore.columns.some((c) => c.windowId === wl.id)
    if (!hasColumns) continue

    const pos = await resolveWindowPosition(wl)

    const opened = await openColumnWindow(
      deckStore.windowProfileId,
      wl.id,
      'automatic',
      {
        width: wl.width,
        height: wl.height,
        x: pos.x,
        y: pos.y,
      },
    )
    // 上限で拒まれたら残りも拒まれる
    if (!opened) break
  }
}
