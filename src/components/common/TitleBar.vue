<script setup lang="ts">
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import {
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  ref,
} from 'vue'
import { useCommandStore } from '@/commands/registry'
import { useColumnHistory } from '@/composables/useColumnHistory'
import { openDeckWindow } from '@/composables/useDeckWindow'
import { openPipWindow } from '@/composables/usePipWindow'
import { useAccountsStore } from '@/stores/accounts'
import { useDeckStore } from '@/stores/deck'
import { useIsCompactLayout, useUiStore } from '@/stores/ui'
import { useWindowsStore } from '@/stores/windows'
import { buildWindowUri } from '@/utils/windowUri'

const CommandPalette = defineAsyncComponent(
  () => import('@/components/common/CommandPalette.vue'),
)
const TitleBarMenu = defineAsyncComponent(
  () => import('@/components/common/TitleBarMenu.vue'),
)

const appWindow = getCurrentWindow()
const commandStore = useCommandStore()
const deckStore = useDeckStore()
const windowsStore = useWindowsStore()
const accountsStore = useAccountsStore()
const { platformName, isDesktop } = useUiStore()
const isCompact = useIsCompactLayout()
const { canGoBack, canGoForward, goBack, goForward } = useColumnHistory()

const topWindowUri = computed(() => {
  const win = windowsStore.topWindow
  if (!win) return null
  const accId = win.props.accountId
  if (typeof accId !== 'string') return null
  const account = accountsStore.accounts.find((a) => a.id === accId)
  return buildWindowUri(win, account?.host ?? null)
})

const activeUri = computed(
  () => topWindowUri.value ?? deckStore.activeColumnUri,
)

const platformLabel: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
}

const titleBarText = computed(() => {
  if (activeUri.value) return activeUri.value
  const parts: string[] = []
  if (platformName) parts.push(platformLabel[platformName] ?? platformName)
  if (deckStore.currentProfileName) parts.push(deckStore.currentProfileName)
  const suffix = parts.length ? ` [${parts.join(': ')}]` : ''
  return `NoteDeck${suffix}`
})
const isMaximized = ref(false)
const isCompactSize = ref(false)

const MOBILE_WIDTH = 420
const MOBILE_HEIGHT = 780

let savedDesktopSize: { width: number; height: number } | null = null

async function syncMaximized() {
  isMaximized.value = await appWindow.isMaximized()
}

async function syncMobileState() {
  const factor = await appWindow.scaleFactor()
  const size = await appWindow.innerSize()
  const logicalWidth = size.width / factor
  isCompactSize.value = logicalWidth <= MOBILE_WIDTH + 20
}

let unlisten: (() => void) | null = null

onMounted(async () => {
  await syncMaximized()
  await syncMobileState()
  unlisten = await appWindow.onResized(async () => {
    await syncMaximized()
    await syncMobileState()
  })
})

onUnmounted(() => {
  unlisten?.()
})

async function minimize() {
  await appWindow.minimize()
}

async function toggleMaximize() {
  await appWindow.toggleMaximize()
}

async function close() {
  await appWindow.close()
}

async function toggleMobileSize() {
  if (isCompactSize.value) {
    if (savedDesktopSize) {
      await appWindow.setSize(
        new LogicalSize(savedDesktopSize.width, savedDesktopSize.height),
      )
    } else {
      await appWindow.setSize(new LogicalSize(1200, 800))
    }
    savedDesktopSize = null
  } else {
    // Exit fullscreen or unmaximize first
    if (await appWindow.isFullscreen()) {
      await appWindow.setFullscreen(false)
    } else if (isMaximized.value) {
      await appWindow.unmaximize()
    }
    const factor = await appWindow.scaleFactor()
    const current = await appWindow.innerSize()
    savedDesktopSize = {
      width: current.width / factor,
      height: current.height / factor,
    }
    await appWindow.setSize(new LogicalSize(MOBILE_WIDTH, MOBILE_HEIGHT))
  }
  await appWindow.center()
}

function openNewWindow() {
  if (!deckStore.windowProfileId) return
  openDeckWindow(deckStore.windowProfileId)
}

async function onPipClick() {
  await openPipWindow()
}

const menuRef = ref<InstanceType<typeof TitleBarMenu> | null>(null)
</script>

<template>
  <div :class="$style.titlebar" data-tauri-drag-region>
    <div :class="$style.titlebarLeft" data-tauri-drag-region>
      <button :class="$style.titlebarBtn" title="メニュー" @click="menuRef?.toggleMenu()">
        <i class="ti ti-menu-2" />
      </button>
    </div>
    <TitleBarMenu ref="menuRef" />
    <div v-if="!isCompact" :class="$style.titlebarCenter" data-tauri-drag-region>
      <div :class="$style.navButtons">
        <button
          :class="[$style.navBtn, { [$style.navBtnDisabled]: !canGoBack }]"
          :disabled="!canGoBack"
          title="戻る"
          @click="goBack"
        >
          <i class="ti ti-arrow-left" />
        </button>
        <button
          :class="[$style.navBtn, { [$style.navBtnDisabled]: !canGoForward }]"
          :disabled="!canGoForward"
          title="進む"
          @click="goForward"
        >
          <i class="ti ti-arrow-right" />
        </button>
        <button
          :class="$style.navBtn"
          title="リロード"
          @click="deckStore.refreshActiveColumn()"
        >
          <i class="ti ti-reload" />
        </button>
      </div>
      <!-- Open: command palette input replaces the search bar -->
      <CommandPalette v-if="commandStore.isOpen" :class="$style.centerBar" />
      <!-- Closed: URI display / search trigger -->
      <button v-else :class="[$style.titlebarSearchBar, $style.centerBar]" @click="commandStore.openWithInput(activeUri ?? '')">
        <i :class="[$style.titlebarSearchIcon, 'ti', 'ti-search']" />
        <span :class="[$style.titlebarSearchText, { [$style.hasUri]: activeUri }]">{{ titleBarText }}</span>
        <kbd :class="$style.titlebarSearchKbd">Ctrl+K</kbd>
      </button>
    </div>
    <div :class="$style.titlebarControls">
      <template v-if="isDesktop">
        <button
          :class="[$style.titlebarBtn, $style.titlebarWindowBtn]"
          title="開発者ツール"
          @click="commandStore.execute('devtools')"
        >
          <i class="ti ti-code" />
        </button>
        <button
          :class="[$style.titlebarBtn, $style.titlebarWindowBtn]"
          title="新しいウィンドウ"
          @click="openNewWindow"
        >
          <i class="ti ti-app-window" />
        </button>
        <button
          :class="[$style.titlebarBtn, $style.titlebarWindowBtn]"
          title="ピクチャーインピクチャー"
          @click="onPipClick"
        >
          <i class="ti ti-picture-in-picture" />
        </button>
        <button
          :class="[$style.titlebarBtn, $style.titlebarWindowBtn]"
          :title="isCompactSize ? 'デスクトップサイズ' : 'モバイルサイズ'"
          @click="toggleMobileSize"
        >
          <i :class="isCompactSize ? 'ti ti-device-desktop' : 'ti ti-device-mobile'" />
        </button>
      </template>
      <template v-if="isDesktop">
        <button :class="[$style.titlebarBtn, $style.titlebarWindowBtn]" title="最小化" @click="minimize">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button :class="[$style.titlebarBtn, $style.titlebarWindowBtn]" title="最大化" @click="toggleMaximize">
          <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1" fill="none" />
          </svg>
          <svg v-else width="10" height="10" viewBox="0 0 10 10">
            <rect x="2.5" y="0.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1" fill="none" />
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1" fill="var(--nd-navBg, #1a1a2e)" />
          </svg>
        </button>
        <button :class="[$style.titlebarBtn, $style.titlebarBtnClose]" title="閉じる" @click="close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
.titlebar {
  display: flex;
  align-items: center;
  height: 32px;
  background: color-mix(in srgb, var(--nd-navBg) 50%, var(--nd-deckBg, #1a1a1a));
  user-select: none;
  flex-shrink: 0;
}

.titlebarLeft {
  display: flex;
  align-items: center;
  height: 100%;
  flex: 1;
}

.navButtons {
  position: absolute;
  right: 100%;
  top: 0;
  display: flex;
  align-items: center;
  height: 100%;
}

.navBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--nd-fg);
  opacity: 0.6;
  cursor: pointer;
  transition: background var(--nd-duration-fast), opacity var(--nd-duration-fast);

  &:hover:not(:disabled) {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.navBtnDisabled {
  opacity: 0.2;
  cursor: default;
}

.titlebarCenter {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: 600px;
  width: 600px;
  height: 100%;
  padding: 0 12px;
  position: relative;
  flex-shrink: 1;
}

.centerBar {
  flex: 1;
  min-width: 0;
}

.titlebarSearchBar {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 22px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--nd-radius-sm);
  background: rgba(255, 255, 255, 0.05);
  color: var(--nd-fg);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  transition: background 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
}

.titlebarSearchIcon {
  font-size: 12px;
  opacity: 0.4;
  flex-shrink: 0;
}

.titlebarSearchText {
  flex: 1;
  opacity: 0.35;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.hasUri {
    opacity: 0.7;
  }
}

.titlebarSearchKbd {
  font-size: 10px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  opacity: 0.4;
  font-family: inherit;
  border: none;
  flex-shrink: 0;
}

.titlebarControls {
  display: flex;
  height: 100%;
  flex: 1;
  justify-content: flex-end;
}

.titlebarBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--nd-fg);
  opacity: 0.6;
  cursor: pointer;
  transition: background var(--nd-duration-fast), opacity var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.titlebarBtnActive {
  opacity: 0.85;
}

.titlebarBtnClose {
  &:hover {
    background: #e81123;
    color: #fff;
    opacity: 1;
  }
}

.titlebarWindowBtn {}
</style>
