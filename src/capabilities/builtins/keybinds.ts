import type { Command, Shortcut } from '@/commands/registry'
import { useKeybindsStore } from '@/stores/keybinds'

/**
 * Keybinds 系 capability — 「自己拡張する IDE」(memory:
 * project_self_extending_ide_roadmap) の延長線。「Vim 風キーバインドにして」
 * 「Ctrl+K を◯◯に」が会話で完結する。
 *
 * 設計判断:
 * - keybinds.json5 は { commandId: Shortcut[] } の上書きマップなので、
 *   各 commandId 単位で set / reset する小粒な API として提供
 * - getAllCommandIds で「設定可能な commandId 一覧」を AI に教える
 * - Shortcut の scope ('global' / 'body') は AI に明示させる (修飾キー
 *   なしのキーは body スコープが基本)
 */

const VALID_SCOPES: readonly Shortcut['scope'][] = ['global', 'body'] as const

function parseShortcut(input: unknown, index: number): Shortcut {
  if (!input || typeof input !== 'object') {
    throw new Error(`keybinds.set: shortcut #${index} is not an object`)
  }
  const obj = input as Record<string, unknown>
  if (typeof obj.key !== 'string' || obj.key.length === 0) {
    throw new Error(`keybinds.set: shortcut #${index} missing string "key"`)
  }
  const scopeRaw = obj.scope
  if (
    typeof scopeRaw !== 'string' ||
    !VALID_SCOPES.includes(scopeRaw as Shortcut['scope'])
  ) {
    throw new Error(
      `keybinds.set: shortcut #${index} scope must be "global" or "body"`,
    )
  }
  const result: Shortcut = {
    key: obj.key,
    scope: scopeRaw as Shortcut['scope'],
  }
  if (obj.ctrl === true) result.ctrl = true
  if (obj.shift === true) result.shift = true
  if (obj.alt === true) result.alt = true
  return result
}

function parseShortcuts(input: unknown): Shortcut[] {
  if (!Array.isArray(input)) {
    throw new Error('keybinds.set: shortcuts must be an array')
  }
  return input.map((s, i) => parseShortcut(s, i))
}

export const keybindsListCapability: Command = {
  id: 'keybinds.list',
  label: 'キーバインド一覧',
  icon: 'ti-keyboard',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: [],
  signature: {
    description:
      '設定可能なコマンド ID 一覧と、それぞれの現在の shortcut を返す。' +
      ' `customized: true` のものはユーザーが上書きしている。AI が ' +
      '「Vim 風にして」と言われたときの起点。',
    params: {},
    returns: {
      type: 'array',
      description:
        '各要素は { commandId, shortcuts: Shortcut[], default: Shortcut[], customized: boolean }',
    },
    cheap: true,
  },
  visible: false,
  execute: () => {
    const store = useKeybindsStore()
    const ids = store.getAllCommandIds()
    return ids.map((commandId) => ({
      commandId,
      shortcuts: store.getShortcuts(commandId),
      default: store.getDefaultShortcuts(commandId),
      customized: store.isCustomized(commandId),
    }))
  },
}

export const keybindsSetCapability: Command = {
  id: 'keybinds.set',
  label: 'キーバインドを設定',
  icon: 'ti-keyboard',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['keybinds.write'],
  requiresConfirmation: (params) => {
    const commandId =
      typeof params?.commandId === 'string' ? params.commandId : ''
    const count = Array.isArray(params?.shortcuts) ? params.shortcuts.length : 0
    return {
      title: 'キーバインドを変更',
      message:
        `\`${commandId}\` の shortcut を ${count} 個に変更します。` +
        ' keybinds.reset で default に戻せます。',
      code: JSON.stringify(params?.shortcuts ?? [], null, 2),
      codeLanguage: 'json',
      okLabel: '変更',
      cancelLabel: 'やめる',
      type: 'warning',
    }
  },
  signature: {
    description:
      '指定 commandId の shortcut を上書きする。Shortcut は ' +
      ' { key: string, scope: "global"|"body", ctrl?: boolean, shift?: boolean, alt?: boolean }。' +
      ' `key` は KeyboardEvent.key の値 ("k" / "p" / "Escape" / "ArrowDown" 等)。' +
      ' scope: "global" は修飾キー付き常時有効、"body" はテキスト入力中は無効。',
    params: {
      commandId: {
        type: 'string',
        description: '対象コマンドの id (keybinds.list で取得)',
      },
      shortcuts: {
        type: 'array',
        description: 'Shortcut[] (空配列を渡せば shortcut なしに上書き)',
      },
    },
    returns: {
      type: 'object',
      description: '{ commandId, count: 設定後の shortcut 数 }',
    },
  },
  visible: false,
  execute: (params) => {
    const commandId =
      typeof params?.commandId === 'string' ? params.commandId : ''
    if (!commandId) throw new Error('keybinds.set: commandId is required')
    const shortcuts = parseShortcuts(params?.shortcuts)
    const store = useKeybindsStore()
    store.setShortcuts(commandId, shortcuts)
    return { commandId, count: shortcuts.length }
  },
}

export const keybindsResetCapability: Command = {
  id: 'keybinds.reset',
  label: 'キーバインドを default に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['keybinds.write'],
  requiresConfirmation: (params) => {
    const commandId =
      typeof params?.commandId === 'string' ? params.commandId : ''
    return {
      title: 'キーバインドを default に戻す',
      message: `\`${commandId}\` のカスタム shortcut を破棄し、default に戻します。`,
      okLabel: 'default に戻す',
      cancelLabel: 'やめる',
      type: 'normal',
    }
  },
  signature: {
    description:
      '指定 commandId のキーバインドを default に戻す (override 削除)。',
    params: {
      commandId: { type: 'string', description: '対象コマンドの id' },
    },
    returns: {
      type: 'object',
      description: '{ commandId, reset: true }',
    },
  },
  visible: false,
  execute: (params) => {
    const commandId =
      typeof params?.commandId === 'string' ? params.commandId : ''
    if (!commandId) throw new Error('keybinds.reset: commandId is required')
    const store = useKeybindsStore()
    store.resetToDefault(commandId)
    return { commandId, reset: true }
  },
}

export const keybindsResetAllCapability: Command = {
  id: 'keybinds.resetAll',
  label: '全キーバインドを default に戻す',
  icon: 'ti-arrow-back-up',
  category: 'general',
  shortcuts: [],
  aiTool: true,
  permissions: ['keybinds.write'],
  requiresConfirmation: () => ({
    title: '全キーバインドを default に戻す',
    message:
      '全コマンドのカスタム shortcut を破棄し、すべて default に戻します。',
    okLabel: 'すべて default に戻す',
    cancelLabel: 'やめる',
    type: 'warning',
  }),
  signature: {
    description: '全コマンドの override を破棄して default に戻す。',
    params: {},
    returns: {
      type: 'object',
      description: '{ reset: true }',
    },
  },
  visible: false,
  execute: () => {
    const store = useKeybindsStore()
    store.resetAll()
    return { reset: true }
  },
}

export const KEYBINDS_BUILTIN_CAPABILITIES: readonly Command[] = [
  keybindsListCapability,
  keybindsSetCapability,
  keybindsResetCapability,
  keybindsResetAllCapability,
]
