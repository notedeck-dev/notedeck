<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useVaporTransitionGroup } from '@/composables/useVaporTransition'
import { useThemeStore } from '@/stores/theme'
import { useWindowsStore } from '@/stores/windows'
import { WINDOW_COMPONENTS } from '@/windows/registry'
import DeckWindow from './DeckWindow.vue'

const windowsStore = useWindowsStore()
const themeStore = useThemeStore()

// 閉じアニメ (windowOut) の間 DOM を残す。reduced-motion では即時除去
const reduceMotion = window.matchMedia(
  '(prefers-reduced-motion: reduce)',
).matches
const { rendered: renderedWindows, leavingIds } = useVaporTransitionGroup(
  computed(() => windowsStore.windows),
  { enterDuration: 200, leaveDuration: reduceMotion ? 0 : 200 },
)

function getThemeVars(accountId: unknown): Record<string, string> | undefined {
  if (typeof accountId !== 'string') return undefined
  return themeStore.getStyleVarsForAccount(accountId)
}

function closeWindow(id: string) {
  windowsStore.close(id)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (windowsStore.windows.length === 0) return
  const topWin = [...windowsStore.windows].sort(
    (a, b) => b.zIndex - a.zIndex,
  )[0]
  if (topWin) windowsStore.close(topWin.id)
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- Windows (モーダル / 背景 dimming は廃止、すべて並列に表示) -->
  <div>
    <DeckWindow
      v-for="win in renderedWindows"
      :key="win.id"
      :window="win"
      :theme-vars="getThemeVars(win.props.accountId)"
      :closing="leavingIds.has(win.id)"
      @close="closeWindow(win.id)"
    >
      <component
        :is="WINDOW_COMPONENTS[win.type]"
        v-bind="win.props"
        @close="closeWindow(win.id)"
        @success="closeWindow(win.id)"
      />
    </DeckWindow>
  </div>
</template>

<style lang="scss" module>
</style>
