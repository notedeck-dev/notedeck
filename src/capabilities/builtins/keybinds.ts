import type { Command, Shortcut } from '@/commands/registry'
import { i18n } from '@/i18n'
import { useKeybindsStore } from '@/stores/keybinds'
import { implement } from '../declare'

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

export const keybindsListCapability = implement('keybinds.list', {
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
})

export const keybindsSetCapability = implement('keybinds.set', {
  requiresConfirmation: (params) => {
    const commandId =
      typeof params?.commandId === 'string' ? params.commandId : ''
    const count = Array.isArray(params?.shortcuts) ? params.shortcuts.length : 0
    return {
      title: i18n.ts._keybindsCapability.setTitle,
      message: i18n.tsx._keybindsCapability.setMessage_plural({
        commandId,
        count,
      }),
      code: JSON.stringify(params?.shortcuts ?? [], null, 2),
      codeLanguage: 'json',
      okLabel: i18n.ts._keybindsCapability.setOk,
      cancelLabel: i18n.ts._keybindsCapability.cancel,
      type: 'warning',
    }
  },
  execute: (params) => {
    const commandId =
      typeof params?.commandId === 'string' ? params.commandId : ''
    if (!commandId) throw new Error('keybinds.set: commandId is required')
    const shortcuts = parseShortcuts(params?.shortcuts)
    const store = useKeybindsStore()
    store.setShortcuts(commandId, shortcuts)
    return { commandId, count: shortcuts.length }
  },
})

export const keybindsResetCapability = implement('keybinds.reset', {
  requiresConfirmation: (params) => {
    const commandId =
      typeof params?.commandId === 'string' ? params.commandId : ''
    return {
      title: i18n.ts._keybindsCapability.resetTitle,
      message: i18n.tsx._keybindsCapability.resetMessage({ commandId }),
      okLabel: i18n.ts._keybindsCapability.resetOk,
      cancelLabel: i18n.ts._keybindsCapability.cancel,
      type: 'normal',
    }
  },
  execute: (params) => {
    const commandId =
      typeof params?.commandId === 'string' ? params.commandId : ''
    if (!commandId) throw new Error('keybinds.reset: commandId is required')
    const store = useKeybindsStore()
    store.resetToDefault(commandId)
    return { commandId, reset: true }
  },
})

export const keybindsResetAllCapability = implement('keybinds.resetAll', {
  requiresConfirmation: () => ({
    title: i18n.ts._keybindsCapability.resetAllTitle,
    message: i18n.ts._keybindsCapability.resetAllMessage,
    okLabel: i18n.ts._keybindsCapability.resetAllOk,
    cancelLabel: i18n.ts._keybindsCapability.cancel,
    type: 'warning',
  }),
  execute: () => {
    const store = useKeybindsStore()
    store.resetAll()
    return { reset: true }
  },
})

export const KEYBINDS_BUILTIN_CAPABILITIES: readonly Command[] = [
  keybindsListCapability,
  keybindsSetCapability,
  keybindsResetCapability,
  keybindsResetAllCapability,
]
