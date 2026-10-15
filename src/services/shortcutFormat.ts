import type { Shortcut } from '@/commands/registry'

/**
 * ショートカットの表示文字列。mac は記号 (⌘⇧⌥) を連結、それ以外は
 * `Ctrl+Shift+Alt+K`。判定 (navigator) は utils/shortcutLabel が渡す。
 */
export function formatShortcut(s: Shortcut, isMac: boolean): string {
  const parts: string[] = []
  if (s.ctrl) parts.push(isMac ? '⌘' : 'Ctrl')
  if (s.shift) parts.push(isMac ? '⇧' : 'Shift')
  if (s.alt) parts.push(isMac ? '⌥' : 'Alt')
  parts.push(formatKey(s.key))
  return parts.join(isMac ? '' : '+')
}

function formatKey(key: string): string {
  const map: Record<string, string> = {
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: '↵',
    Backspace: '⌫',
    Delete: 'Del',
    ' ': 'Space',
  }
  // 1 文字キーより先に表を引く (スペースも 1 文字なので)
  return map[key] ?? (key.length === 1 ? key.toUpperCase() : key)
}
