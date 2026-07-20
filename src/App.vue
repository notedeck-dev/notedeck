<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onErrorCaptured,
  onMounted,
  onUnmounted,
  watch,
} from 'vue'
import { useRoute } from 'vue-router'
import { useHeartbeatDaemon } from '@/composables/useHeartbeatDaemon'
import { useKeyboard } from '@/composables/useKeyboard'
import { initKeyboardInset } from '@/composables/useKeyboardInset'
import { useMuteSync } from '@/composables/useMuteSync'
import { useOsUnreadBadge } from '@/composables/useOsUnreadBadge'
import { useOsWindowTitle } from '@/composables/useOsWindowTitle'
import { listenPipEvents } from '@/composables/usePipWindow'
import { useRenoteMuteSync } from '@/composables/useRenoteMuteSync'
import { useTheme } from '@/composables/useTheme'
import { useWordMuteSync } from '@/composables/useWordMuteSync'
import { useLogsStore } from '@/stores/logs'
import { useIsCompactLayout, useUiStore } from '@/stores/ui'
import {
  getStorageString,
  removeStorage,
  STORAGE_KEYS,
  setStorageString,
} from '@/utils/storage'

const uiStore = useUiStore()
const { isTauri, isDesktop } = uiStore
const isCompact = useIsCompactLayout()
const route = useRoute()
const isPipWindow = computed(() => route.meta.pip === true)

const DevWelcome = isTauri
  ? null
  : defineAsyncComponent(() => import('@/components/DevWelcome.vue'))

const TitleBar = isTauri
  ? defineAsyncComponent(() => import('@/components/common/TitleBar.vue'))
  : null

const DeckWindowLayer = defineAsyncComponent(
  () => import('@/components/deck/DeckWindowLayer.vue'),
)

// console.warn / console.error を logs store にラップ。AI が `logs.recent`
// capability で自己診断できるようにする。`[ai-credentials]` のような
// 明示的に機密扱いの scope は捨てる (push しない)。
const SENSITIVE_LOG_SCOPES = /^\[(ai-credentials|secret|api-key)\]/i
const __origWarn = console.warn.bind(console)
const __origError = console.error.bind(console)
console.warn = (...args: unknown[]) => {
  const first = args[0]
  if (typeof first !== 'string' || !SENSITIVE_LOG_SCOPES.test(first)) {
    try {
      useLogsStore().push('warn', args)
    } catch {
      /* store 初期化前は無視 */
    }
  }
  __origWarn(...args)
}
console.error = (...args: unknown[]) => {
  const first = args[0]
  if (typeof first !== 'string' || !SENSITIVE_LOG_SCOPES.test(first)) {
    try {
      useLogsStore().push('error', args)
    } catch {
      /* store 初期化前は無視 */
    }
  }
  __origError(...args)
}

// Catch uncaught Vue errors from any descendant component (Vapor Mode compatible)
onErrorCaptured((err, instance, info) => {
  console.error(`[vue] Uncaught error in ${info}:`, err)
  if (import.meta.env.DEV && instance) {
    console.debug(
      '[vue] Component:',
      (instance.$options as { __name?: string }).__name ?? instance,
    )
  }
  return false // prevent propagation
})

if (isTauri) {
  const { init: initKeyboard } = useKeyboard()
  initKeyboard()
}

// HEARTBEAT (#411) — App-level singleton daemon。AI カラムの有無に関係なく
// アプリ起動中ずっと走る。manual trigger は AI 設定画面から
// commands.heartbeatTriggerNow() を直接叩く (provide/inject 経由しない)。
// PiP ウィンドウでは mount しない (= main window だけが daemon を持つ)。
if (!isPipWindow.value) {
  useHeartbeatDaemon()
}

// OS 統合 (#748): ウィンドウタイトルは各デッキウィンドウが自分の内容を反映、
// 未読バッジ (Dock/タスクバー/トレイ) は useOsUnreadBadge 内で main のみ有効化
if (isTauri && !isPipWindow.value) {
  useOsWindowTitle()
  useOsUnreadBadge()
}

// Listen for PiP IPC events (main window only)
let cleanupPipListener: (() => void) | null = null

// Cache UI shell on unload for instant display on next launch (Linear-style).
function saveShellCache() {
  if (isPipWindow.value) return
  try {
    const app = document.getElementById('app')
    if (!app) return
    const html = app.innerHTML
    if (html.length > 2_000_000) return // Skip if too large for localStorage
    setStorageString(STORAGE_KEYS.shellCache, html)
    setStorageString(STORAGE_KEYS.shellCacheVersion, __APP_VERSION__)
  } catch {
    // Storage full or other error — skip silently
  }
}
window.addEventListener('beforeunload', saveShellCache)

// Dismiss splash screen (shown only when no shell cache exists).
function dismissSplash() {
  const el = document.getElementById('nd-splash')
  if (!el) return
  el.classList.add('nd-splash-leaving')
  el.addEventListener('transitionend', () => el.remove(), { once: true })
  setTimeout(() => el.remove(), 400)
}

onMounted(async () => {
  // Invalidate shell cache if app version changed (CSS Modules hashes may differ)
  const cachedVersion = getStorageString(STORAGE_KEYS.shellCacheVersion)
  if (cachedVersion && cachedVersion !== __APP_VERSION__) {
    removeStorage(STORAGE_KEYS.shellCache)
    removeStorage(STORAGE_KEYS.shellCacheVersion)
  }
  // Clear shell-cached flag so entrance animations are re-enabled
  delete document.documentElement.dataset.shellCached
  // Set platform attributes on html element for CSS targeting (independent of viewport width)
  const { platformName } = uiStore
  if (platformName) {
    document.documentElement.dataset.platform = platformName
  }
  document.documentElement.dataset.env = isTauri ? 'tauri' : 'web'

  // ソフトキーボード高さを --nd-keyboard-inset に反映 (モバイルのみ)
  if (uiStore.isMobilePlatform) initKeyboardInset()

  // Show window immediately (visible: false in tauri.conf.json to avoid WebView2 flash).
  // NOTE: setDecorations(false) は呼ばない。config で既に false であり、
  // Windows で再度呼ぶとウィンドウスタイル再計算で非クライアント領域が復活する。
  if (isTauri) {
    const [{ getCurrentWindow }, { catchIgnore }] = await Promise.all([
      import('@tauri-apps/api/window'),
      import('@/utils/logger'),
    ])
    await getCurrentWindow().show().catch(catchIgnore('window.show'))
  }

  // Dismiss splash when deck is mounted (only exists on first launch without cache).
  // `immediate: true` なので deck が既にマウント済みなら即 dismiss。
  // 200ms は deckMounted が立たない異常系向けのフォールバック（通常は watch が先行）。
  if (document.getElementById('nd-splash')) {
    const splashTimeout = setTimeout(dismissSplash, 200)
    const stopWatch = watch(
      () => uiStore.deckMounted,
      (mounted) => {
        if (mounted) {
          clearTimeout(splashTimeout)
          dismissSplash()
          stopWatch()
        }
      },
      { immediate: true },
    )
  }

  // Defer theme account fetching (network I/O) to after first paint
  useTheme()

  // ミュート一覧を各アカウント分 hydrate（#574: 過去ノートを起動直後から非表示に）
  useMuteSync()
  // ワードミュート（mutedWords / hardMutedWords）+ インスタンスミュート（#610/#613）
  useWordMuteSync()
  // リノートミュート一覧を各アカウント分 hydrate（#614）
  useRenoteMuteSync()

  if (isTauri) {
    // Set up PiP event listener in main window
    if (!isPipWindow.value) {
      const { useDeckStore } = await import('@/stores/deck')
      const deckStore = useDeckStore()
      cleanupPipListener = await listenPipEvents({
        onReturnToDeck: async (columnConfig) => {
          deckStore.addColumn(columnConfig)
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          await getCurrentWindow().setFocus()
        },
      }).catch(() => null)
    }
  }
})

onUnmounted(() => {
  cleanupPipListener?.()
})
</script>

<template>
  <div :class="$style.root">
    <template v-if="isTauri">
      <TitleBar v-if="(isDesktop || !isCompact) && !isPipWindow" />
      <div :class="$style.content">
        <router-view />
      </div>
    </template>
    <DevWelcome v-else />

    <template v-if="!isPipWindow">
      <DeckWindowLayer />
    </template>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}

.content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

</style>
