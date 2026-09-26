import type { Command } from '@/commands/registry'
import { i18n } from '@/i18n'
import { useWindowsStore, type WindowType } from '@/stores/windows'
import { WINDOW_SIZES } from '@/windows/registry'
import { implement } from '../declare'

/**
 * Windows 系 capability — DeckWindow (= 一時 UI、設定エディタ / プロファイル
 * 詳細など) を AI から操作する。column.* と同じく UI state なので permission
 * は不要 ([] = 誰でも呼べる)。各ウィンドウ内部の実際の操作は対応する
 * capability で guard される (例: cssEditor を開くこと自体は安全だが、
 * CSS 書込は styles.write perm が必要)。
 *
 * 設計判断:
 * - windows.open は確認 UI 無し (開いて閉じるだけなら可逆)
 * - windows.close も確認 UI 無し (= 不要なウィンドウを片付けるための片手間)
 * - windows.closeAll は念のため warning 確認 (= 大量同時破棄が起きるので意図確認)
 * - WindowType の enum を embed して AI に valid な type を伝える
 *   (enum はウィンドウレジストリから導出する)
 */

/**
 * AI から開ける DeckWindow 種別 (#794 W2)。
 *
 * 手書きの列挙をやめウィンドウレジストリ (#794 W6) から導出する。レジストリは
 * `Record<WindowType, _>` なので、ウィンドウ種別を足せば必ずここにも載る
 * (手書き時代は drive-file-detail / connections / connectionEdit / tutorial の
 * 4 種が漏れていた)。
 *
 * 全種別を開けてよい理由は windows.open が ungated なのと同じ — 開くこと自体は
 * 可逆で、中の操作は対応する capability で guard される。
 */
const VALID_WINDOW_TYPES: readonly WindowType[] = Object.keys(
  WINDOW_SIZES,
) as WindowType[]

function isValidWindowType(t: string): t is WindowType {
  return VALID_WINDOW_TYPES.includes(t as WindowType)
}

export const windowsListCapability = implement('windows.list', {
  execute: () => {
    const store = useWindowsStore()
    return store.windows.map((w) => ({
      id: w.id,
      type: w.type,
      props: w.props,
      x: w.x,
      y: w.y,
      zIndex: w.zIndex,
      minimized: w.minimized,
      maximized: w.maximized,
    }))
  },
})

export const windowsOpenCapability = implement('windows.open', {
  execute: (params) => {
    const type = typeof params?.type === 'string' ? params.type : ''
    if (!type) throw new Error('windows.open: type is required')
    if (!isValidWindowType(type)) {
      throw new Error(`windows.open: unknown window type "${type}"`)
    }
    const propsRaw = params?.props
    const props =
      propsRaw && typeof propsRaw === 'object' && !Array.isArray(propsRaw)
        ? (propsRaw as Record<string, unknown>)
        : {}
    const store = useWindowsStore()
    const id = store.open(type, props)
    return { id }
  },
})

export const windowsCloseCapability = implement('windows.close', {
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('windows.close: id is required')
    const store = useWindowsStore()
    store.close(id)
    return { closed: true, id }
  },
})

export const windowsFocusCapability = implement('windows.focus', {
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('windows.focus: id is required')
    const store = useWindowsStore()
    store.bringToFront(id)
    return { focused: true, id }
  },
})

export const windowsCloseAllCapability = implement('windows.closeAll', {
  requiresConfirmation: () => ({
    title: i18n.ts._windowsCapability.closeAllTitle,
    message: i18n.ts._windowsCapability.closeAllMessage,
    okLabel: i18n.ts._windowsCapability.closeAllOk,
    cancelLabel: i18n.ts._windowsCapability.cancel,
    type: 'warning',
  }),
  execute: () => {
    const store = useWindowsStore()
    store.closeAll()
    return { closedAll: true }
  },
})

export const WINDOWS_BUILTIN_CAPABILITIES: readonly Command[] = [
  windowsListCapability,
  windowsOpenCapability,
  windowsCloseCapability,
  windowsFocusCapability,
  windowsCloseAllCapability,
]
