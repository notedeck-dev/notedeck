<script setup lang="ts">
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { onMounted, ref } from 'vue'

import { usePortal } from '@/composables/usePortal'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { getLogDir, getSettingsDir } from '@/utils/settingsFs'

const menuOpen = ref(false)
const activeCategory = ref<string | null>(null)
const {
  visible: menuVisible,
  entering: menuEntering,
  leaving: menuLeaving,
} = useVaporTransition(menuOpen, { enterDuration: 200, leaveDuration: 200 })

const menuPortalRef = ref<HTMLElement | null>(null)
usePortal(menuPortalRef)

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (!menuOpen.value) activeCategory.value = null
}

function closeMenu() {
  menuOpen.value = false
  activeCategory.value = null
  clearConeGuard()
}

// ── Prediction cone ──
const menuPanelRef = ref<HTMLElement | null>(null)
const coneGuardRef = ref<HTMLElement | null>(null)

function onCategoryEnter(cat: string) {
  if (activeCategory.value && activeCategory.value !== cat) {
    if (coneGuardRef.value) return
  }
  activeCategory.value = cat
}

function onMenuMouseMove(e: MouseEvent) {
  if (!activeCategory.value || !menuPanelRef.value) {
    clearConeGuard()
    return
  }

  const panel = menuPanelRef.value.getBoundingClientRect()
  const subRight = panel.right + 220

  const cx = e.clientX - panel.left
  const cy = e.clientY - panel.top
  const rtX = subRight - panel.left
  const rtY = 0 - panel.top
  const rbY = window.innerHeight - panel.top

  if (!coneGuardRef.value) {
    const guard = document.createElement('div')
    guard.style.cssText =
      'position:absolute;inset:0;pointer-events:auto;z-index:1;'
    menuPanelRef.value.appendChild(guard)
    coneGuardRef.value = guard
    guard.addEventListener('mousemove', onGuardMove)
    guard.addEventListener('mouseleave', clearConeGuard)
  }

  coneGuardRef.value.style.clipPath = `polygon(${cx}px ${cy}px, ${rtX}px ${rtY}px, ${rtX}px ${rbY}px)`
}

function onGuardMove(_e: MouseEvent) {
  const el = document.elementFromPoint(_e.clientX, _e.clientY)
  if (el && el !== coneGuardRef.value) {
    clearConeGuard()
  }
}

function clearConeGuard() {
  if (coneGuardRef.value) {
    coneGuardRef.value.remove()
    coneGuardRef.value = null
  }
}

// ── Autostart ──
const autostartEnabled = ref(false)

onMounted(async () => {
  try {
    autostartEnabled.value = await isEnabled()
  } catch {
    // autostart not available (e.g. web)
  }
})

async function toggleAutostart() {
  try {
    if (autostartEnabled.value) {
      await disable()
    } else {
      await enable()
    }
    autostartEnabled.value = await isEnabled()
  } catch {
    // ignore
  }
}

async function openSettingsDir() {
  const dir = await getSettingsDir()
  if (dir) await revealItemInDir(dir)
  closeMenu()
}

async function openLogDir() {
  const dir = await getLogDir()
  if (dir) await revealItemInDir(dir)
  closeMenu()
}

// ── Actions ──
const zoomLevel = ref(1)

async function setZoom(delta: number) {
  zoomLevel.value =
    Math.round(Math.max(0.5, Math.min(2, zoomLevel.value + delta)) * 100) / 100
  await getCurrentWebview().setZoom(zoomLevel.value)
}

function reloadApp() {
  closeMenu()
  window.location.reload()
}

defineExpose({ toggleMenu })
</script>

<template>
  <div
    v-if="menuVisible"
    ref="menuPortalRef"
    :class="[$style.backdrop, menuEntering && $style.enter, menuLeaving && $style.leave]"
    @click="closeMenu"
  >
    <div ref="menuPanelRef" :class="$style.panel" @click.stop @mousemove="onMenuMouseMove">
      <div
        :class="$style.categoryItem"
        @mouseenter="onCategoryEnter('file')"
        @click="onCategoryEnter('file')"
      >
        <button class="_popupItem" :class="[activeCategory === 'file' && $style.itemActive]">
          <i class="ti ti-file" />
          <span>ファイル</span>
          <i class="ti ti-chevron-right" :class="$style.chevron" />
        </button>
        <div v-if="activeCategory === 'file'" :class="$style.sub">
          <button class="_popupItem" @click="openSettingsDir">
            <i class="ti ti-folder-open" />
            <span>設定フォルダを開く</span>
          </button>
          <button class="_popupItem" @click="openLogDir">
            <i class="ti ti-folder-open" />
            <span>ログフォルダを開く</span>
          </button>
          <div class="_popupDivider" />
          <button class="_popupItem" @click="toggleAutostart">
            <i class="ti ti-power" />
            <span>OS起動時に自動起動</span>
            <i :class="[autostartEnabled ? 'ti ti-check' : 'ti ti-minus', $style.kbd]" />
          </button>
        </div>
      </div>
      <div
        :class="$style.categoryItem"
        @mouseenter="onCategoryEnter('view')"
        @click="onCategoryEnter('view')"
      >
        <button class="_popupItem" :class="[activeCategory === 'view' && $style.itemActive]">
          <i class="ti ti-layout" />
          <span>表示</span>
          <i class="ti ti-chevron-right" :class="$style.chevron" />
        </button>
        <div v-if="activeCategory === 'view'" :class="$style.sub">
          <button class="_popupItem" @click="setZoom(0.1)">
            <i class="ti ti-zoom-in" />
            <span>拡大</span>
            <kbd :class="$style.kbd">Ctrl++</kbd>
          </button>
          <button class="_popupItem" @click="setZoom(-0.1)">
            <i class="ti ti-zoom-out" />
            <span>縮小</span>
            <kbd :class="$style.kbd">Ctrl+-</kbd>
          </button>
          <div class="_popupDivider" />
          <button class="_popupItem" @click="reloadApp">
            <i class="ti ti-refresh" />
            <span>再読み込み</span>
            <kbd :class="$style.kbd">Ctrl+Shift+R</kbd>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
$menu-bg: color-mix(in srgb, var(--nd-navBg) 50%, var(--nd-deckBg, #1a1a1a));

.backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--nd-z-popup);
  background: rgba(0, 0, 0, 0.08);
}

.enter {
  animation: fadeIn var(--nd-duration-base) var(--nd-ease-decel);
}

.leave {
  animation: fadeOut var(--nd-duration-base) ease-out forwards;
}

@keyframes fadeIn {
  from { opacity: 0; }
}

@keyframes fadeOut {
  to { opacity: 0; }
}

.panel {
  position: fixed;
  top: 32px;
  left: 0;
  min-width: 160px;
  box-shadow: var(--nd-shadow-m);
  font-size: 14px;
  z-index: calc(var(--nd-z-popup) + 1);
  background: $menu-bg;

  button {
    font-size: inherit;
  }
}

.itemActive {
  background: var(--nd-buttonHoverBg);
}

.categoryItem {
  position: relative;
}

.chevron {
  margin-left: auto;
  font-size: 0.8em;
  opacity: 0.4;
}

.sub {
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 180px;
  border-radius: 0;
  box-shadow: var(--nd-shadow-m);
  font-size: 14px;
  background: $menu-bg;
}

.kbd {
  margin-left: auto;
  font-size: 0.8em;
  opacity: 0.4;
  font-family: inherit;
}
</style>
