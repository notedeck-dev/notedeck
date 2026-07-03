import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { ALL_BUILTIN_CAPABILITIES } from './capabilities/builtins'
import { registerCapability } from './capabilities/registry'
import { router, setupFirstRunTutorial } from './router'
import { initEarlyAccountListener, useAccountsStore } from './stores/accounts'
import { useKeybindsStore } from './stores/keybinds'
import { usePerformanceStore } from './stores/performance'
import { useServersStore } from './stores/servers'
import { useSettingsStore } from './stores/settings'
import { useThemeStore } from './stores/theme'
import { resolveEvictionConfig } from './utils/cacheEviction'
import { isTauri } from './utils/settingsFs'
import { commands, unwrap } from './utils/tauriInvoke'
import '@tabler/icons-webfont/dist/tabler-icons.min.css'
import './styles/global.css'

// Register builtin AI capabilities (time / account / column / theme) at
// module load. Capability registry は module-scoped で Pinia 非依存だが、
// 各 execute は Pinia store にアクセスするので、実呼び出しは Pinia 初期化後
// (= sendMessage 経由) に限定される。registerCapability は id で overwrite
// するので二重実行しても安全。
for (const cap of ALL_BUILTIN_CAPABILITIES) {
  registerCapability(cap)
}

if (isTauri) {
  // Register the `nd:accounts-early` listener as early as possible so the Rust
  // backend's pre-init emit (src-tauri/src/lib.rs:376) is never missed.
  // Done synchronously at module load — before Pinia, before mount.
  initEarlyAccountListener()

  // Pre-warm Tauri API module (critical path in App.vue onMounted)
  import('@tauri-apps/api/window')

  const isPipRoute = location.pathname === '/pip'

  if (!isPipRoute) {
    // Pre-fetch DeckPage chunk so its CSS <link> is inserted early.
    // DeckPage is lazy-imported in the router to preserve CSS Modules injection order,
    // but on Windows WebView2 the CSS load can race with first paint. Triggering the
    // import here (without await) starts the CSS download immediately while the router
    // still controls when the component is actually evaluated.
    import('./views/DeckPage.vue')

    // Pre-fetch most common column chunks so downloads start during Vue bootstrap
    // (normally these don't start until DeckColumnsArea.onMounted).
    if (import.meta.env.PROD) {
      import('./components/deck/DeckTimelineColumn.vue')
      import('./components/deck/DeckNotificationColumn.vue')
    }
  }
}

// Defer non-critical CSS to idle time — KaTeX and Shiki are not needed at startup.
// WebView2 など requestIdleCallback 未実装環境ではフォールバック 50ms
// （2000ms は初回描画に数式/コード表示が間に合わず空白が見えてしまう）
const _idle =
  window.requestIdleCallback ??
  ((cb: IdleRequestCallback) => setTimeout(cb, 50))
_idle(() => {
  import('katex/dist/katex.min.css')
  import('./assets/shiki-dark-plus.css')
})

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)

// Global error handler — catch unhandled promise rejections
// Vue component errors are caught by onErrorCaptured in App.vue (Vapor Mode compatible)
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled] Promise rejection:', event.reason)
})

// Suppress ResizeObserver loop warnings.
// TanStack Virtual's internal ResizeObserver cascades when dynamic-height items
// (images loading, content expanding) cause layout recalculations within the same frame.
// This is a known, harmless limitation of the ResizeObserver spec with virtual scrollers.
// See: https://github.com/TanStack/virtual/issues/426
const _roError = 'ResizeObserver loop'
window.addEventListener('error', (e) => {
  if (e.message?.startsWith(_roError)) e.stopImmediatePropagation()
})
window.addEventListener('unhandledrejection', (e) => {
  if (
    typeof e.reason?.message === 'string' &&
    e.reason.message.startsWith(_roError)
  )
    e.preventDefault()
})

if (isTauri) {
  // settings.json (single source of truth for scalar preferences) と
  // performance.json5 (CSS render-cost knobs: blur/shadow/animation) を
  // 並列ロード。両者は独立ファイルなので往復遅延を重ねない。
  // 初回 Vue paint 前に完了させて FOUC を防ぐ。
  const settingsStore = useSettingsStore()
  await Promise.all([settingsStore.load(), usePerformanceStore().init()])

  // ユーザー設定の eviction policy を Rust 側に反映 (fire-and-forget)。
  // Database::open はデフォルト (balanced) で既に開かれているので、 設定が
  // balanced 以外のときだけ追加 cleanup が走る。 失敗してもアプリ起動は続行。
  void commands
    .applyEvictionConfig(resolveEvictionConfig(settingsStore.settings))
    .then((r) => unwrap(r))
    .catch((e) => {
      if (import.meta.env.DEV)
        console.debug('[cache-eviction] apply on startup failed:', e)
    })

  // Apply cached theme before mount to prevent FOUC
  useThemeStore().init()
  useKeybindsStore().init()

  // Start loading accounts (fire-and-forget). Blocking mount on this invoke
  // would freeze the whole app if Rust AppState init stalls. Instead we rely
  // on the pre-registered `nd:accounts-early` listener (deterministic) and
  // DeckColumn's `requireAccount` guard, which renders a static blank while
  // `accountsStore.isLoaded` is false so no "アカウントが見つかりません" flashes.
  useAccountsStore().loadAccounts()

  // Pre-load server info from DB so ColumnBadges can show icons immediately
  useServersStore().loadCachedServers()
}

app.use(router)

if (isTauri) {
  // 初回起動 (アカウント 0 件 + チュートリアル未完了) の誘導 (non-blocking)
  setupFirstRunTutorial()
}

app.mount('#app')
