<script setup lang="ts">
import { computed, ref, toRef } from 'vue'

import { useNativeDialog } from '@/composables/useNativeDialog'
import { useTutorialStore } from '@/composables/useTutorial'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { usePerformanceStore } from '@/stores/performance'
import { useThemeStore } from '@/stores/theme'
import { useWindowsStore } from '@/stores/windows'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const { visible: menuVisible, leaving: menuLeaving } = useVaporTransition(
  toRef(props, 'show'),
  { enterDuration: 180, leaveDuration: 180 },
)
const perfStore = usePerformanceStore()
const themeStore = useThemeStore()

const dialogRef = ref<HTMLDialogElement | null>(null)

useNativeDialog(
  dialogRef,
  computed(() => menuVisible.value),
  {
    onCancel: () => emit('close'),
    leaveDuration: 180,
  },
)

const windowsStore = useWindowsStore()
const tutorialStore = useTutorialStore()

function openTutorial(): void {
  tutorialStore.start()
  emit('close')
}

function openToolWindow(
  type:
    | 'cssEditor'
    | 'plugins'
    | 'aiSettings'
    | 'connections'
    | 'performanceEditor'
    | 'appearanceEditor'
    | 'backup'
    | 'cacheEditor'
    | 'tasksEditor'
    | 'snippetsEditor',
) {
  windowsStore.open(type, {})
  emit('close')
}
</script>

<template>
  <dialog
    v-if="menuVisible"
    ref="dialogRef"
    class="_nativeDialog"
    :class="[$style.mobileBackdrop, menuLeaving ? $style.sheetBackdropLeave : $style.sheetBackdropEnter]"
  >
    <div
      autofocus
      tabindex="-1"
      class="_popupMenu"
      :class="[$style.settingsMenu, menuLeaving ? $style.sheetContentLeave : $style.sheetContentEnter]"
      @pointerdown.stop
    >
      <div :class="$style.menuBody">
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openTutorial">
            <i class="ti ti-presentation-analytics" />
            <span>チュートリアルを見る</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('appearanceEditor')">
            <i class="ti ti-brush" />
            <span>アピアランス</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>

        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('aiSettings')">
            <i class="ti ti-robot" />
            <span>AI</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('connections')">
            <i class="ti ti-plug-connected" />
            <span>接続</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('performanceEditor')">
            <i class="ti ti-gauge" />
            <span>パフォーマンス</span>
            <span v-if="Object.keys(perfStore.overrides).length > 0" :class="$style.activeDot" />
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('cssEditor')">
            <i class="ti ti-code" />
            <span>カスタムCSS</span>
            <span v-if="themeStore.customCss" :class="$style.activeDot" />
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('tasksEditor')">
            <i class="ti ti-player-play" />
            <span>タスク</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('snippetsEditor')">
            <i class="ti ti-code-plus" />
            <span>スニペット</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>

        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('backup')">
            <i class="ti ti-database" />
            <span>バックアップ</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
        <div :class="$style.categorySection">
          <button :class="$style.categoryHeader" @click="openToolWindow('cacheEditor')">
            <i class="ti ti-eraser" />
            <span>キャッシュ</span>
            <i class="ti ti-chevron-right" :class="$style.chevronNav" />
          </button>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style lang="scss" module>
@use '@/styles/navMenu';

.settingsMenu {
  width: 100%;
  margin: 0;
  border-radius: 16px 16px 0 0;
  background: color-mix(in srgb, var(--nd-navBg) 96%, transparent);
  box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.3);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: var(--nd-safe-area-bottom, env(safe-area-inset-bottom));

  &:focus,
  &:focus-visible {
    outline: none;
  }
}

.menuBody {
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  min-height: 0;
}

.categorySection {
  border-bottom: 1px solid var(--nd-divider);

  &:last-child {
    border-bottom: none;
  }
}

.categoryHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  min-height: 44px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.7;
  border: none;
  background: none;
  cursor: pointer;
  transition: opacity var(--nd-duration-fast), background var(--nd-duration-fast);

  &:hover {
    opacity: 1;
    background: var(--nd-accent-hover);
  }
}

.chevronNav {
  margin-left: auto;
  font-size: 0.9em;
  opacity: 0.5;
}

.activeDot + .chevronNav {
  margin-left: 0;
}

.activeDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--nd-accent);
  margin-left: auto;
}
</style>
