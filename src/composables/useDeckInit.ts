import type { Ref } from 'vue'
import { onMounted, onUnmounted, watch } from 'vue'
import { loadCliCommands } from '@/commands/cliParser'
import {
  registerDefaultCommands,
  unregisterDefaultCommands,
} from '@/commands/definitions'
import { useCommandStore } from '@/commands/registry'
import { startTaskCommandSync } from '@/commands/taskCommands'
import {
  listenDeckWindowEvents,
  saveCurrentWindowLayout,
} from '@/composables/useDeckWindow'
import { handleDeepLink } from '@/composables/useDeepLink'
import { initOgpListener } from '@/composables/useOgpPreview'
import { destroyApiBridge, initApiBridge } from '@/core/apiBridge'
import { reattachQueryDeltaListener } from '@/core/queryDeltaBus'
import { useDeckStore } from '@/stores/deck'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { usePluginsStore } from '@/stores/plugins'
import { usePostFormStore } from '@/stores/postForm'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import {
  initDesktopNotifications,
  onNotificationAction,
} from '@/utils/desktopNotification'

export function useDeckInit(options: {
  openCompose: () => void
  navigateToSearch: () => void
  navigateToNotifications: () => void
  navigateToNote: (accountId: string, noteId: string) => void
  navigateToUser: (accountId: string, userId: string) => void
  toggleAddMenu: () => void
  navbarRef: Ref<{
    toggleNav(): void
    toggleFirstAccountMenu(): void
    handleResize(): void
  } | null>
  checkForUpdate: () => void
}) {
  const deckStore = useDeckStore()
  const pluginsStore = usePluginsStore()
  const commandStore = useCommandStore()
  const uiStore = useUiStore()

  let handleResizeRef: (() => void) | null = null
  let unlistenQuickNote: (() => void) | null = null
  let unlistenDeepLink: (() => void) | null = null
  let unlistenWindowEvents: (() => void) | null = null

  function onVisibilityChange() {
    if (document.hidden) {
      deckStore.flushSave()
    } else {
      uiStore.emitDeckResume()
    }
  }

  // Android ネイティブ (MainActivity.onResume) からの復帰通知 (#506)。
  // WebView が visibilitychange を発火しない復帰パターンの保険。
  // emitDeckResume の下流 (reconnect / observer 張り直し / refetch) は
  // すべて冪等なので visibilitychange との二重発火は無害。
  function onNativeResume() {
    uiStore.emitDeckResume()
  }

  function onPageHide() {
    deckStore.flushSave()
  }

  // 背景化で失われうる Tauri イベントリスナーの再アタッチ (#506)。
  // adapter の stream-event は useColumnSetup の reconnect() が張り直すが、
  // ノート本体を運ぶ query-delta は bus に集約したのでここで張り直す。
  watch(
    () => uiStore.deckResumeSignal,
    () => {
      void reattachQueryDeltaListener()
    },
  )

  let updateCheckHandle: { cancel: () => void } | undefined

  onMounted(() => {
    uiStore.deckMounted = true

    handleResizeRef = () => options.navbarRef.value?.handleResize()
    window.addEventListener('resize', handleResizeRef)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('nd-app-resumed', onNativeResume)
    window.addEventListener('pagehide', onPageHide)

    // Critical: start streaming immediately
    deckStore.startSync()

    // Load navbar from file (async, non-blocking)
    deckStore.initNavbar()
    void usePostFormStore().init()

    // Register commands synchronously (needed for keyboard shortcuts)
    registerDefaultCommands({
      openCompose: options.openCompose,
      openSearch: options.navigateToSearch,
      openNotifications: options.navigateToNotifications,
      toggleAddMenu: options.toggleAddMenu,
      toggleNav: () => options.navbarRef.value?.toggleNav(),
      toggleAccountMenu: () =>
        options.navbarRef.value?.toggleFirstAccountMenu(),
    })

    // Defer non-critical initialization to after first paint
    requestAnimationFrame(() => {
      initApiBridge()
      initDesktopNotifications()
      initOgpListener()
      loadCliCommands()
      startTaskCommandSync()
      void useTasksStore().init()
      onNotificationAction((ctx) => {
        if (ctx.noteId) {
          options.navigateToNote(ctx.accountId, ctx.noteId)
        } else if (ctx.userId) {
          options.navigateToUser(ctx.accountId, ctx.userId)
        }
      })
    })

    // Update check: アイドル時に確認（旧: 固定 5000ms 遅延）。
    // 起動直後のネットワーク負荷を避けつつ、idle で即実行されるので結果確認が速い。
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(options.checkForUpdate, {
        timeout: 3000,
      })
      updateCheckHandle = { cancel: () => window.cancelIdleCallback(id) }
    } else {
      const id = setTimeout(options.checkForUpdate, 2000)
      updateCheckHandle = { cancel: () => clearTimeout(id) }
    }

    // Plugins — defer to idle since AiScript is not on the critical startup path.
    // requestIdleCallback 未実装環境でも体感遅延が出ないよう 50ms に短縮（旧: 500ms）
    const idle =
      window.requestIdleCallback ??
      ((cb: IdleRequestCallback) => setTimeout(cb, 50))
    idle(() => {
      import('@/aiscript/plugin-api').then(({ launchAllPlugins }) => {
        pluginsStore.ensureLoaded()
        launchAllPlugins(pluginsStore.plugins)
      })
    })

    // Quick Note: global hotkey (Ctrl+Alt+N)
    if (uiStore.isDesktop) {
      import('@/utils/tauriEvents').then(({ listenTauri }) => {
        listenTauri('nd:quick-note', () => {
          commandStore.openWithInput('post ')
        }).then((fn) => {
          unlistenQuickNote = fn
        })
        listenTauri('nd:toggle-offline-mode', () => {
          useOfflineModeStore().toggle()
        })
        listenTauri('nd:toggle-realtime-mode', () => {
          useRealtimeModeStore().toggle()
        })
        listenTauri('nd:deep-link', (url) => {
          handleDeepLink(url)
        }).then((fn) => {
          unlistenDeepLink = fn
        })
      })

      // Cross-window event listeners (all windows listen for IPC events)
      listenDeckWindowEvents().then((fn) => {
        unlistenWindowEvents = fn
      })

      // Sub-windows save their layout on beforeunload.
      // `immediate` bypasses the resize-debounce so the write hits localStorage
      // synchronously before the webview tears down.
      if (deckStore.currentWindowId) {
        window.addEventListener('beforeunload', () => {
          saveCurrentWindowLayout({ immediate: true })
        })
      }
    }
  })

  onUnmounted(() => {
    import('@/aiscript/plugin-api').then(({ abortAllPlugins }) => {
      abortAllPlugins()
    })
    deckStore.stopSync()
    destroyApiBridge()
    unregisterDefaultCommands()
    if (handleResizeRef) window.removeEventListener('resize', handleResizeRef)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('nd-app-resumed', onNativeResume)
    window.removeEventListener('pagehide', onPageHide)
    unlistenQuickNote?.()
    unlistenDeepLink?.()
    updateCheckHandle?.cancel()
    unlistenWindowEvents?.()
  })
}
