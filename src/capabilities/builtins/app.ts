import type { Command } from '@/commands/registry'
import { useUiStore } from '@/stores/ui'
import { implement } from '../declare'

/**
 * `app.*` — OS 上のメインウィンドウの表示 / 非表示。Boss Key と同じ操作を
 * capability にしたもの (#511: ランチャの boss コマンド)。column.* / windows.*
 * と同じく UI 状態なので permission は不要。デスクトップ専用で、モバイルでは
 * 隠す先が無いので失敗にする。
 */
async function mainWindow() {
  if (!useUiStore().isDesktop)
    throw new Error('app.hide / app.show are desktop only')
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  return getCurrentWindow()
}

export const appHideCapability = implement('app.hide', {
  execute: async () => {
    const w = await mainWindow()
    await w.hide()
  },
})

export const appShowCapability = implement('app.show', {
  execute: async () => {
    const w = await mainWindow()
    await w.show()
    await w.setFocus()
  },
})

export const APP_BUILTIN_CAPABILITIES: readonly Command[] = [
  appHideCapability,
  appShowCapability,
]
