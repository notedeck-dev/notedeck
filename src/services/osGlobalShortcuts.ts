import type { Shortcut } from '@/commands/registry'

/**
 * OS グローバルホットキー (#514) の純ロジック。
 *
 * keybinds の `scope: 'os-global'` なショートカットを tauri-plugin-global-shortcut の
 * accelerator 文字列に写す。登録そのものは `useOsGlobalShortcuts` がやる。
 */

export interface OsGlobalBinding {
  commandId: string
  accelerator: string
}

/** KeyboardEvent.key → tauri (global-hotkey crate) のキー名 */
const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
}

function keyName(key: string): string | null {
  if (/^[a-zA-Z]$/.test(key)) return key.toUpperCase()
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key
  return KEY_NAMES[key] ?? null
}

/**
 * accelerator 文字列にする。修飾キーの無いものは null (OS 全体で単キーを
 * 奪うことになるため作らない)。写せないキーも null
 */
export function toAccelerator(shortcut: Shortcut): string | null {
  if (!shortcut.ctrl && !shortcut.shift && !shortcut.alt) return null
  const name = keyName(shortcut.key)
  if (!name) return null
  const parts: string[] = []
  if (shortcut.ctrl) parts.push('Control')
  if (shortcut.shift) parts.push('Shift')
  if (shortcut.alt) parts.push('Alt')
  parts.push(name)
  return parts.join('+')
}

/**
 * コマンド一覧から os-global の束縛を集める。同じ accelerator は先勝ちで 1 つ
 * (後から同じキーを足しても OS には 1 回しか登録できないため)
 */
export function collectOsGlobalBindings(
  commands: ReadonlyArray<{ id: string; shortcuts: readonly Shortcut[] }>,
): OsGlobalBinding[] {
  const seen = new Set<string>()
  const out: OsGlobalBinding[] = []
  for (const cmd of commands) {
    for (const s of cmd.shortcuts) {
      if (s.scope !== 'os-global') continue
      const accelerator = toAccelerator(s)
      if (!accelerator || seen.has(accelerator)) continue
      seen.add(accelerator)
      out.push({ commandId: cmd.id, accelerator })
    }
  }
  return out
}
