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
import { exitSafeMode, readSafeMode } from '@/utils/safeMode'
import { markStartup } from '@/utils/startupTrace'

const uiStore = useUiStore()
const { isTauri, isDesktop } = uiStore
const isCompact = useIsCompactLayout()
const route = useRoute()
const isPipWindow = computed(() => route.meta.pip === true)

// セーフモード (#794) は起動時に確定し、実行中に変わらない (解除はリロード)
const isSafeMode = readSafeMode()

const DevWelcome = isTauri
  ? null
  : defineAsyncComponent(() => import('@/components/DevWelcome.vue'))

const TitleBar = isTauri
  ? defineAsyncComponent(() => import('@/components/common/TitleBar.vue'))
  : null

const DeckWindowLayer = defineAsyncComponent(
  () => import('@/components/deck/DeckWindowLayer.vue'),
)

// 開発時のみ: フレーム統計オーバーレイ (Ctrl+Shift+F でトグル)
const DevFrameOverlay = import.meta.env.DEV
  ? defineAsyncComponent(() => import('@/components/dev/DevFrameOverlay.vue'))
  : null

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

// Dismiss splash screen (inserted by the index.html boot script).
function dismissSplash() {
  const el = document.getElementById('nd-splash')
  if (!el) return
  el.classList.add('nd-splash-leaving')
  el.addEventListener('transitionend', () => el.remove(), { once: true })
  setTimeout(() => el.remove(), 400)
}

onMounted(async () => {
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
    markStartup('window-shown')
  }

  // Dismiss splash when deck is mounted.
  // 200ms は deckMounted が立たない異常系向けのフォールバック（通常は watch が先行）。
  // 注意: `immediate: true` の watch でここを書くと、登録時点で deckMounted が
  // true の場合にコールバックが `const stopWatch` の代入前に同期実行され、
  // stopWatch() が TDZ で throw する (チャンク分割修正で prod のデッキマウントが
  // onMounted より速くなり顕在化した)。既マウントは分岐で処理する。
  // deck-mounted の計測はここではなく発生源 (useDeckInit) で打つ
  if (document.getElementById('nd-splash')) {
    const splashTimeout = setTimeout(dismissSplash, 200)
    if (uiStore.deckMounted) {
      clearTimeout(splashTimeout)
      dismissSplash()
    } else {
      const stopWatch = watch(
        () => uiStore.deckMounted,
        (mounted) => {
          if (mounted) {
            stopWatch()
            clearTimeout(splashTimeout)
            dismissSplash()
          }
        },
      )
    }
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
      <div v-if="isSafeMode && !isPipWindow" :class="$style.safeModeBar">
        <i class="ti ti-shield-half" />
        <span :class="$style.safeModeText">セーフモードで起動中 — プラグイン・ウィジェット・カスタム CSS・テーマ・HEARTBEAT は無効です</span>
        <button type="button" :class="$style.safeModeExit" @click="exitSafeMode">オフにする</button>
      </div>
      <div :class="$style.content">
        <router-view />
      </div>
    </template>
    <DevWelcome v-else />

    <template v-if="!isPipWindow">
      <DeckWindowLayer />
    </template>
    <DevFrameOverlay v-if="DevFrameOverlay" />
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

/* セーフモード (#794)。テーマ変数は当たっていない前提なので配色は固定値で持つ */
.safeModeBar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 0.8rem;
  background: #8a5a00;
  color: #fff;
}

.safeModeText {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.safeModeExit {
  flex: none;
  padding: 2px 10px;
  border: 1px solid rgb(255 255 255 / 0.5);
  border-radius: var(--nd-radius-full);
  background: transparent;
  color: inherit;
  font-size: inherit;
  cursor: pointer;

  &:hover {
    background: rgb(255 255 255 / 0.15);
  }
}

</style>
