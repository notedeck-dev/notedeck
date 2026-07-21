import { commands } from '@/bindings'
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

function isLightColor(color: string): boolean {
  // Simple luminance check via hex
  const hex = color.replace('#', '')
  if (hex.length !== 6 && hex.length !== 3) return false
  const r =
    hex.length === 3
      ? parseInt(hex.charAt(0) + hex.charAt(0), 16)
      : parseInt(hex.slice(0, 2), 16)
  const g =
    hex.length === 3
      ? parseInt(hex.charAt(1) + hex.charAt(1), 16)
      : parseInt(hex.slice(2, 4), 16)
  const b =
    hex.length === 3
      ? parseInt(hex.charAt(2) + hex.charAt(2), 16)
      : parseInt(hex.slice(4, 6), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 128
}
