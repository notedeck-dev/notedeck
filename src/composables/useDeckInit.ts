import type { Ref } from 'vue'
import { onMounted, onUnmounted, watch } from 'vue'
import { events } from '@/bindings'
import { loadCliCommands } from '@/commands/cliParser'
import {
  registerDefaultCommands,
  unregisterDefaultCommands,
} from '@/commands/definitions'
import { startTaskCommandSync } from '@/commands/taskCommands'
import { useAppBackground } from '@/composables/useAppBackground'
import { useDeckResume } from '@/composables/useDeckResume'
import { listenDeckWindowEvents } from '@/composables/useDeckWindow'
import { handleDeepLink } from '@/composables/useDeepLink'
import { useMainStreamKeeper } from '@/composables/useMainStreamKeeper'
import { useNotificationPermissionPrompt } from '@/composables/useNotificationPermissionPrompt'
import { initOgpListener } from '@/composables/useOgpPreview'
import { useOsGlobalShortcuts } from '@/composables/useOsGlobalShortcuts'
import { destroyApiBridge, initApiBridge } from '@/core/apiBridge'
import { reattachQueryDeltaListener } from '@/core/queryDeltaBus'
import { useDeckStore } from '@/stores/deck'
import { useOfflineModeStore } from '@/stores/offlineMode'
import { usePluginsStore } from '@/stores/plugins'
import { usePostFormStore } from '@/stores/postForm'
import { useRealtimeModeStore } from '@/stores/realtimeMode'
import { useTasksStore } from '@/stores/tasks'
import { useUiStore } from '@/stores/ui'
import { listenAddressed } from '@/utils/addressedEvents'
import {
  initDesktopNotifications,
  onNotificationAction,
} from '@/utils/desktopNotification'
import { logStartupSummary, markStartup } from '@/utils/startupTrace'

export function useDeckInit(options: {
  openCompose: () => void
  navigateToSearch: () => void
  navigateToClientSearch: () => void
  navigateToNotifications: () => void
  navigateToNote: (accountId: string, noteId: string) => void
  navigateToUser: (accountId: string, userId: string) => void
  toggleAddMenu: () => void
  navbarRef: Ref<{
    toggleNav(): void
    toggleFirstAccountMenu(): void
    handleResize(): void
  } | null>
}) {
  const deckStore = useDeckStore()
  const pluginsStore = usePluginsStore()
  const uiStore = useUiStore()
  // OS グローバルホットキー (#514)。コマンド登録の後に init する
  const osGlobalShortcuts = useOsGlobalShortcuts()

  // 復帰検知 (visibilitychange / OS スリープ / Android ネイティブ) は
  // useDeckResume に一元化。ここは検知後の下流処理だけを持つ
  useDeckResume()
  useMainStreamKeeper()
  useNotificationPermissionPrompt()
  // 対になる離脱検知 (#986)。猶予を超えて隠れたら購読を warm に落とす
  useAppBackground()

  let handleResizeRef: (() => void) | null = null
  let unlistenDeepLink: (() => void) | null = null
  let unlistenWindowEvents: (() => void) | null = null
  let unlistenNotificationClick: (() => void) | null = null

  function onVisibilityChange() {
    if (document.hidden) deckStore.flushSave()
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

  onMounted(() => {
    uiStore.deckMounted = true
    // 計測はマークの発生源で直接打つ (#985)。App.vue の splash watch 経由に
    // すると、watch 側の都合 (登録タイミング・splash の有無) で欠落しうる
    markStartup('deck-mounted')
    logStartupSummary()

    handleResizeRef = () => options.navbarRef.value?.handleResize()
    window.addEventListener('resize', handleResizeRef)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)

    void usePostFormStore().init()

    // Register commands synchronously (needed for keyboard shortcuts)
    registerDefaultCommands({
      openCompose: options.openCompose,
      openSearch: options.navigateToSearch,
      openClientSearch: options.navigateToClientSearch,
      openNotifications: options.navigateToNotifications,
      toggleAddMenu: options.toggleAddMenu,
      toggleNav: () => options.navbarRef.value?.toggleNav(),
      toggleAccountMenu: () =>
        options.navbarRef.value?.toggleFirstAccountMenu(),
    })

    // 外部からの問い合わせ / 通知クリック / deep link / トレイの切替は宛先付きで届く
    // (#1131)。Rust が見ている窓か代表窓の 1 つに振り分けるので、どの窓も購読する
    // だけでよく、窓の種別で分岐しない

    // Defer non-critical initialization to after first paint
    requestAnimationFrame(() => {
      osGlobalShortcuts.init()
      initApiBridge()
      initDesktopNotifications()
      initOgpListener()
      loadCliCommands()
      startTaskCommandSync()
      void useTasksStore().init()
      // OS 通知クリックの遷移先解決 (#754)。noteId 優先、なければ userId。
      // どちらもない (要約通知・システム通知) 場合はフォーカスのみで何もしない。
      const navigateFromNotification = (ctx: {
        accountId: string
        noteId?: string | null
        userId?: string | null
      }) => {
        if (ctx.noteId) {
          options.navigateToNote(ctx.accountId, ctx.noteId)
        } else if (ctx.userId) {
          options.navigateToUser(ctx.accountId, ctx.userId)
        }
      }
      // JS 経路 (sendDesktopNotification + Android onAction)
      onNotificationAction(navigateFromNotification)
      // Rust 経路 (Linux/Windows の user-notify クリック、Windows の toast)。見ている窓
      // 1 つに届く。冷えた起動で購読前に届いた分は Rust が預かり、名乗りの時点で流す
      listenAddressed(events.notificationClickAddressed, ({ click }) =>
        navigateFromNotification(click),
      )
        .then((fn) => {
          unlistenNotificationClick = fn
        })
        .catch(() => {
          // Non-Tauri environment (vitest / ブラウザ)
        })
    })

    // Plugins — defer to idle since AiScript is not on the critical startup path.
    // requestIdleCallback 未実装環境でも体感遅延が出ないよう 50ms に短縮（旧: 500ms）
    const idle =
      window.requestIdleCallback ??
      ((cb: IdleRequestCallback) => setTimeout(cb, 50))
    idle(() => {
      // 一覧はファイルから読む (#1042) ので、読み終わるのを待ってから起動する
      Promise.all([
        import('@/aiscript/plugin-api'),
        pluginsStore.whenReady(),
      ]).then(([{ launchAllPlugins }]) => {
        launchAllPlugins(pluginsStore.items)
      })
    })

    // Deep link (notedeck://)。モバイルでも登録する — Android の
    // NotificationWorker 通知クリックがこの経路で通知カラムを開く (#754)。
    // 見ている窓 1 つに届く (#1131)
    listenAddressed(events.addressedDeepLink, ({ url }) => {
      handleDeepLink(url)
    })
      .then((fn) => {
        unlistenDeepLink = fn
      })
      .catch(() => {
        // Non-Tauri environment (vitest / ブラウザ)
      })

    if (uiStore.isDesktop) {
      // トレイからの切替。代表窓 1 つに届く (#1131)。以前は全窓が受けて反転が
      // 窓の数だけ走っていた。HEARTBEAT / 常駐の切替は useTrayMenu が受ける
      void listenAddressed(events.trayToggle, ({ which }) => {
        if (which === 'offline') useOfflineModeStore().toggle()
        else if (which === 'realtime') useRealtimeModeStore().toggle()
      }).catch(() => {
        // Non-Tauri environment (vitest / ブラウザ)
      })

      // Cross-window event listeners (all deck-screen windows listen)。
      // 子窓のジオメトリは Rust が記録して親に届けるので、beforeunload での保存は
      // 要らなくなった (#1131 段 4)
      listenDeckWindowEvents().then((fn) => {
        unlistenWindowEvents = fn
      })
    }
  })

  onUnmounted(() => {
    import('@/aiscript/plugin-api').then(({ abortAllPlugins }) => {
      abortAllPlugins()
    })
    destroyApiBridge()
    unregisterDefaultCommands()
    if (handleResizeRef) window.removeEventListener('resize', handleResizeRef)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
    unlistenDeepLink?.()
    unlistenWindowEvents?.()
    unlistenNotificationClick?.()
  })
}
