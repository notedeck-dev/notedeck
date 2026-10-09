import { commands } from '@/bindings'
import { isLightColor } from './colorUtils'
import type { CompiledProps } from './types'

const UNSAFE_CSS_RE = /[;{}]|url\s*\(/i

export function applyTheme(compiled: CompiledProps): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(compiled)) {
    if (UNSAFE_CSS_RE.test(value)) continue
    root.style.setProperty(`--nd-${key}`, value)
  }

  // Set color-scheme for native UI elements
  const bg = compiled.bg
  if (bg) {
    const isLight = isLightColor(bg)
    root.style.setProperty('color-scheme', isLight ? 'light' : 'dark')
    root.dataset.colorScheme = isLight ? 'light' : 'dark'

    // Sync mobile status bar color via <meta name="theme-color">
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.content = bg

    // Android: ステータスバー/ナビバーのアイコン明暗をテーマに追従 (#755)。
    // Android 以外の OS では Rust 側が no-op。非 Tauri 環境 (vitest /
    // ブラウザ) は invoke が失敗するので同期・非同期どちらの例外も握りつぶす
    try {
      commands.setStatusBarStyle(isLight).catch(() => {
        // Non-Tauri environment (async reject)
      })
    } catch {
      // Non-Tauri environment
    }
  }
}
