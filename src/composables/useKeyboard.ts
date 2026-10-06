import { onUnmounted } from 'vue'
import { type Shortcut, useCommandStore } from '@/commands/registry'
import { useUiStore } from '@/stores/ui'

export function useKeyboard() {
  const commandStore = useCommandStore()
  // os-global はデスクトップの Tauri では OS 側の登録 (useOsGlobalShortcuts) が
  // 受けるので、ここで二重に実行しない。それ以外の環境ではアプリ内の global として扱う
  const osGlobalHandledByOs = useUiStore().isDesktop

  function handleKeyDown(e: KeyboardEvent) {
    // パレット開放中はパレット側で処理
    if (commandStore.isOpen) return

    const target = e.target as HTMLElement
    const isInput =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable

    for (const cmd of commandStore.getEnabled()) {
      for (const shortcut of cmd.shortcuts) {
        if (shortcut.scope === 'os-global' && osGlobalHandledByOs) continue
        if (matchesShortcut(e, shortcut, isInput)) {
          e.preventDefault()
          e.stopPropagation()
          cmd.execute()
          return
        }
      }
    }
  }

  function init() {
    document.addEventListener('keydown', handleKeyDown)
  }

  function cleanup() {
    document.removeEventListener('keydown', handleKeyDown)
  }

  onUnmounted(cleanup)

  return { init, cleanup }
}

function matchesShortcut(
  e: KeyboardEvent,
  s: Shortcut,
  isInput: boolean,
): boolean {
  if (s.scope === 'body' && isInput) return false
  if (e.key.toLowerCase() !== s.key.toLowerCase()) return false

  const ctrl = e.ctrlKey || e.metaKey
  if (!!s.ctrl !== ctrl) return false
  if (!!s.shift !== e.shiftKey) return false
  if (!!s.alt !== e.altKey) return false

  return true
}
