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
  if (key.length === 1) return key.toUpperCase()
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
  return map[key] ?? key
}
