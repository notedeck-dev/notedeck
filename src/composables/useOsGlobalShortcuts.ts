import { onUnmounted, watch } from 'vue'
import { useCommandStore } from '@/commands/registry'
import { i18n } from '@/i18n'
import { collectOsGlobalBindings } from '@/services/osGlobalShortcuts'
import { useKeybindsStore } from '@/stores/keybinds'
import { useToast } from '@/stores/toast'
import { useUiStore } from '@/stores/ui'

/**
 * OS グローバルホットキー (#514)。keybinds の `scope: 'os-global'` を
 * tauri-plugin-global-shortcut に登録し、押されたらウィンドウを前に出して
 * コマンドパレットと同じ `execute(id)` を呼ぶ。
 *
 * デスクトップの Tauri だけ。ブラウザ dev とモバイルでは何もしない
 * (そこでは `useKeyboard` が os-global をアプリ内の global として扱う)。
 */
function swallow(): void {
  // 失敗は呼び出し側で警告済みか、無視してよいもの
}

export function useOsGlobalShortcuts() {
  const uiStore = useUiStore()
  const commandStore = useCommandStore()
  const keybindsStore = useKeybindsStore()

  let generation = 0

  async function apply(): Promise<void> {
    if (!uiStore.isDesktop) return
    // OS への登録はプロセスに 1 つ。サブウィンドウが同じキーを登録すると衝突するので
    // main ウィンドウだけが持つ (useTrayMenu と同じ判定)
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    if (getCurrentWindow().label !== 'main') return
    const gen = ++generation
    const { register, unregisterAll } = await import(
      '@tauri-apps/plugin-global-shortcut'
    )
    if (gen !== generation) return

    const bindings = collectOsGlobalBindings(
      Array.from(commandStore.commands.values()),
    )
    try {
      await unregisterAll()
    } catch (e) {
      console.warn('[os-global-shortcuts] unregisterAll failed:', e)
    }

    const byAccelerator = new Map(bindings.map((b) => [b.accelerator, b]))
    const failed: string[] = []
    for (const b of bindings) {
      try {
        await register(b.accelerator, (event) => {
          if (event.state !== 'Pressed') return
          const hit = byAccelerator.get(event.shortcut)
          if (hit) trigger(hit.commandId)
        })
      } catch (e) {
        // OS や他アプリが既に取っているキー。黙って落とさず知らせる
        console.warn('[os-global-shortcuts] register failed:', b.accelerator, e)
        failed.push(b.accelerator)
      }
    }
    if (failed.length > 0) {
      useToast().show(
        i18n.tsx._keybindsContent.osGlobalRegisterFailed({
          keys: failed.join(', '),
        }),
        'error',
      )
    }
  }

  async function trigger(commandId: string): Promise<void> {
    // ウィンドウを隠す系 (boss-key) は前に出さない
    if (commandId !== 'boss-key') {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const w = getCurrentWindow()
      // 既に前に居る / 閉じかけなど失敗しても、コマンド自体は実行する
      await w.show().catch(swallow)
      await w.setFocus().catch(swallow)
    }
    commandStore.execute(commandId)
  }

  function init(): void {
    if (!uiStore.isDesktop) return
    apply().catch((e) =>
      console.warn('[os-global-shortcuts] initial apply failed:', e),
    )
    // キーバインドの上書きが変わったら登録し直す (設定 UI / AI の keybinds.* / 外部編集)
    watch(
      () => keybindsStore.overrides,
      () => {
        apply().catch((e) =>
          console.warn('[os-global-shortcuts] re-apply failed:', e),
        )
      },
      { deep: true },
    )
  }

  async function cleanup(): Promise<void> {
    if (!uiStore.isDesktop) return
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    if (getCurrentWindow().label !== 'main') return
    generation++
    try {
      const { unregisterAll } = await import(
        '@tauri-apps/plugin-global-shortcut'
      )
      await unregisterAll()
    } catch (e) {
      console.warn('[os-global-shortcuts] cleanup failed:', e)
    }
  }

  onUnmounted(() => {
    cleanup().catch(swallow)
  })

  return { init, cleanup, apply }
}
