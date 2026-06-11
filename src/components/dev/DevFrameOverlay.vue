<script setup lang="ts">
import { onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import { usePortal } from '@/composables/usePortal'
import { frameTelemetry } from '@/engine/telemetry/frameTelemetry'

/**
 * DevFrameOverlay — 開発時のみ表示するフレーム統計オーバーレイ。
 *
 * FPS, フレーム時間 (EMA), P95, Jank カウントをリアルタイム表示。
 * import.meta.env.DEV でのみレンダリングされる前提。
 */

const overlayPortalRef = useTemplateRef<HTMLElement>('overlayPortalRef')
usePortal(overlayPortalRef)

const visible = ref(false)
const fps = frameTelemetry.fps
const frameTimeEma = frameTelemetry.frameTimeEma
const p95 = frameTelemetry.p95FrameTime
const jankCount = frameTelemetry.jankCount
const quality = frameTelemetry.currentQuality

function toggle() {
  visible.value = !visible.value
}

// Keyboard shortcut: Ctrl+Shift+F to toggle
function onKeydown(e: KeyboardEvent) {
  if (e.ctrlKey && e.shiftKey && e.key === 'F') {
    e.preventDefault()
    toggle()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="visible" ref="overlayPortalRef" :class="$style.overlay">
      <div :class="$style.row">
        <span :class="$style.label">FPS</span>
        <span :class="[$style.value, fps < 50 && $style.warn, fps < 30 && $style.bad]">
          {{ fps }}
        </span>
      </div>
      <div :class="$style.row">
        <span :class="$style.label">Frame</span>
        <span :class="$style.value">{{ frameTimeEma.toFixed(1) }}ms</span>
      </div>
      <div :class="$style.row">
        <span :class="$style.label">P95</span>
        <span :class="[$style.value, p95 > 20 && $style.warn, p95 > 33 && $style.bad]">
          {{ p95.toFixed(1) }}ms
        </span>
      </div>
      <div :class="$style.row">
        <span :class="$style.label">Jank</span>
        <span :class="[$style.value, jankCount > 0 && $style.warn, jankCount > 5 && $style.bad]">
          {{ jankCount }}
        </span>
      </div>
      <div :class="$style.row">
        <span :class="$style.label">Quality</span>
        <span :class="$style.value">{{ quality }}</span>
      </div>
    </div>
</template>

<style module lang="scss">
.overlay {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: var(--nd-z-dev);
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.8);
  color: #0f0;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  line-height: 1.4;
  pointer-events: none;
  user-select: none;
}

.row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.label {
  opacity: 0.6;
}

.value {
  font-variant-numeric: tabular-nums;
}

.warn {
  color: #ff0;
}

.bad {
  color: #f44;
}
</style>
