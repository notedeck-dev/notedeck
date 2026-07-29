<script setup lang="ts">
import { computed, ref, toRef } from 'vue'

import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { SETTINGS_SECTIONS, type SettingsSection } from '@/settings/sections'
import { useWindowsStore } from '@/stores/windows'
import { WINDOW_ICONS, WINDOW_LABELS } from '@/windows/registry'

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

function openSection(section: SettingsSection) {
  windowsStore.open(section.window, {})
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
        <div
          v-for="section in SETTINGS_SECTIONS"
          :key="section.window"
          :class="$style.categorySection"
        >
          <button :class="$style.categoryHeader" @click="openSection(section)">
            <i :class="WINDOW_ICONS[section.window]" />
            <span>{{ WINDOW_LABELS[section.window] }}</span>
            <span v-if="section.hasOverride?.()" :class="$style.activeDot" />
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
