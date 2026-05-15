import type { Command } from '@/commands/registry'
import { useWindowsStore, type WindowType } from '@/stores/windows'

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
 */

const VALID_WINDOW_TYPES: readonly WindowType[] = [
  'note-detail',
  'note-inspector',
  'notification-inspector',
  'user-profile',
  'federation-instance',
  'follow-list',
  'login',
  'plugins',
  'keybinds',
  'cssEditor',
  'themeEditor',
  'profileEditor',
  'aiSettings',
  'about',
  'navEditor',
  'performanceEditor',
  'appearanceEditor',
  'backup',
  'cacheEditor',
  'tasksEditor',
  'snippetsEditor',
  'memoEditor',
  'page-detail',
  'play-detail',
  'gallery-detail',
  'list-detail',
  'clip-detail',
  'page-edit',
  'play-edit',
  'widget-edit',
  'skill-edit',
] as const

function isValidWindowType(t: string): t is WindowType {
  return VALID_WINDOW_TYPES.includes(t as WindowType)
}

export const windowsListCapability: Command = {
  id: 'windows.list',
  label: '開いているウィンドウ一覧',
  icon: 'ti-windows',
  category: 'window',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '現在開いている DeckWindow 一覧を返す。各要素は ' +
      ' { id, type, props, x, y, zIndex, modal, minimized, maximized }。',
    params: {},
    returns: {
      type: 'array',
      description: 'DeckWindow 配列',
    },
    cheap: true,
  },
  visible: false,
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
}

export const windowsOpenCapability: Command = {
  id: 'windows.open',
  label: 'ウィンドウを開く',
  icon: 'ti-window',
  category: 'window',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      'DeckWindow を開く。type は note-detail / user-profile / aiSettings / ' +
      ' cssEditor / themeEditor / navEditor / performanceEditor / plugins / ' +
      ' keybinds 等 (詳細は windows.list の戻り値で type 一覧を参照)。' +
      ' note-detail / user-profile 等は props に noteId / userId + accountId が必要。' +
      ' 同 props の既存ウィンドウは新規作成せず focus される (singleton 化)。',
    params: {
      type: {
        type: 'string',
        description: '開く WindowType',
        enum: VALID_WINDOW_TYPES,
      },
      props: {
        type: 'object',
        description:
          'ウィンドウ固有の props (例: note-detail なら { noteId, accountId })',
        optional: true,
      },
    },
    returns: {
      type: 'object',
      description: '{ id: 開いた / focus された window id }',
    },
  },
  visible: false,
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
}

export const windowsCloseCapability: Command = {
  id: 'windows.close',
  label: 'ウィンドウを閉じる',
  icon: 'ti-x',
  category: 'window',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '指定 id の DeckWindow を閉じる。id は windows.list で取得した値を渡す。',
    params: {
      id: { type: 'string', description: '閉じる window id' },
    },
    returns: {
      type: 'object',
      description: '{ closed: true, id }',
    },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('windows.close: id is required')
    const store = useWindowsStore()
    store.close(id)
    return { closed: true, id }
  },
}

export const windowsFocusCapability: Command = {
  id: 'windows.focus',
  label: 'ウィンドウを前面に',
  icon: 'ti-stack-front',
  category: 'window',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '指定 id の DeckWindow を最前面 (= 最大 zIndex) に持ってくる。',
    params: {
      id: { type: 'string', description: '対象 window id' },
    },
    returns: {
      type: 'object',
      description: '{ focused: true, id }',
    },
  },
  visible: false,
  execute: (params) => {
    const id = typeof params?.id === 'string' ? params.id : ''
    if (!id) throw new Error('windows.focus: id is required')
    const store = useWindowsStore()
    store.bringToFront(id)
    return { focused: true, id }
  },
}

export const windowsCloseAllCapability: Command = {
  id: 'windows.closeAll',
  label: '全ウィンドウを閉じる',
  icon: 'ti-x',
  category: 'window',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  requiresConfirmation: () => ({
    title: '全ウィンドウを閉じる',
    message: '現在開いているすべての DeckWindow を閉じます。',
    okLabel: 'すべて閉じる',
    cancelLabel: 'やめる',
    type: 'warning',
  }),
  signature: {
    description: '現在開いている全 DeckWindow を一括で閉じる。',
    params: {},
    returns: {
      type: 'object',
      description: '{ closedAll: true }',
    },
  },
  visible: false,
  execute: () => {
    const store = useWindowsStore()
    store.closeAll()
    return { closedAll: true }
  },
}

export const WINDOWS_BUILTIN_CAPABILITIES: readonly Command[] = [
  windowsListCapability,
  windowsOpenCapability,
  windowsCloseCapability,
  windowsFocusCapability,
  windowsCloseAllCapability,
]
