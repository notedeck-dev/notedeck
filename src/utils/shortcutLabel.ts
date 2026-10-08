import type { Shortcut } from '@/commands/registry'
import { formatShortcut } from '@/services/shortcutFormat'

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.userAgent)

/** 実行環境 (navigator) に合わせたショートカット表示 */
export function shortcutLabel(s: Shortcut): string {
  return formatShortcut(s, isMac)
}
