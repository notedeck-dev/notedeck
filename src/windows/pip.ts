// PiP ウィンドウ (カラム 1 本 / 派生ウィンドウ) を Rust に頼む。Vue に依存しない
// Tauri の窓操作なので windows 層に置く (#1098)。窓を作るのは Rust (#1131 段 4)
import { commands } from '@/bindings'
import { DEFAULT_COLUMN_WIDTH } from '@/columns/registry'
import type { DeckColumn } from '@/stores/deck'
import type { WindowType } from '@/stores/windows'
import { unwrap } from '@/utils/tauriInvoke'
import { WINDOW_SIZES } from '@/windows/registry'
import { createSubWindow } from '@/windows/subWindow'

/**
 * PiP はカラム 1 本を切り出した窓なので、幅はデッキのカラムと同じにする。
 * `decorations: false` なのでウィンドウ幅 = 中身の幅になり、コンパクト表示
 * (420px 以下) で全幅表示されるカラムの実寸もデッキ側と一致する。
 */
const PIP_WIDTH = DEFAULT_COLUMN_WIDTH

/**
 * 高さは既定サイズ (800px) のウィンドウに並ぶカラムと同じ長さにする。カラムは
 * ウィンドウ高さからタイトルバー (32px)、カラム領域の上下 padding (6px×2)、
 * ボトムバー (42px) を引いた分:
 *   800 - 32 - 12 - 42 = 714
 * PiP はカラムを選んだ後ドラッグバーを出さないので、ウィンドウの高さが
 * そのままカラムの高さになり、デッキ上のカラムと並べても長さが揃う。
 */
const PIP_HEIGHT = 714
const PIP_MIN_WIDTH = 280
const PIP_MIN_HEIGHT = 400
const PIP_WINDOW_MAX_HEIGHT = 900

/** URL の query に載せる形 (PipPage が `decodeURIComponent(atob(..))` で戻す) */
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
  await createSubWindow(
    {
      kind: 'pip',
      col: columnConfig ? encodePayload(columnConfig) : null,
      win: null,
    },
    'user',
    {
      width: PIP_WIDTH,
      height: PIP_HEIGHT,
      minWidth: PIP_MIN_WIDTH,
      minHeight: PIP_MIN_HEIGHT,
      x: null,
      y: null,
    },
  )
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
  await createSubWindow(
    { kind: 'pip', col: null, win: encodePayload({ type, props }) },
    'user',
    {
      width,
      height,
      minWidth: PIP_MIN_WIDTH,
      minHeight: Math.min(PIP_MIN_HEIGHT, height),
      x: null,
      y: null,
    },
  )
}

/**
 * PiP のカラムをデッキに戻す。届け先 (最も近いデッキ画面を描く祖先、無ければ代表窓)
 * は Rust が決め (`pip_return_to_deck`)、受けた窓が型を検証して足す。届けてから
 * 自分を閉じる (× と同じ経路なので理由は user)
 */
export async function returnPipColumnToDeck(
  columnConfig: Omit<DeckColumn, 'id'>,
): Promise<void> {
  // カラム設定は JSON で届ける
  unwrap(
    await commands.pipReturnToDeck(JSON.parse(JSON.stringify(columnConfig))),
  )
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}
