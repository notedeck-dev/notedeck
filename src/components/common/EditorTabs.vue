<script setup lang="ts">
import { useTemplateRef } from 'vue'

export interface EditorTabDef {
  value: string
  icon: string
  label: string
}

defineProps<{
  tabs: EditorTabDef[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const tabsEl = useTemplateRef<HTMLDivElement>('tabsEl')

function onWheel(e: WheelEvent) {
  const el = tabsEl.value
  if (!el) return
  el.scrollLeft += e.deltaY + e.deltaX
}
</script>

<template>
  <div ref="tabsEl" :class="$style.tabs" @wheel.prevent="onWheel">
    <button
      v-for="t in tabs"
      :key="t.value"
      class="_button"
      :class="[$style.tab, { [$style.active]: modelValue === t.value }]"
      :title="t.label"
      :aria-label="t.label"
      @click="emit('update:modelValue', t.value)"
    >
      <i :class="'ti ti-' + t.icon" />
      <span :class="$style.label">{{ t.label }}</span>
    </button>
  </div>
</template>

<style lang="scss" module>
.tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: 0.75em;
  font-weight: bold;
  color: var(--nd-fg);
  opacity: 0.5;
  border-bottom: 2px solid transparent;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base), border-color var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
  }

  &.active {
    opacity: 1;
    border-bottom-color: var(--nd-accent);
    color: var(--nd-accent);
  }
}

.label {
  white-space: nowrap;
}
</style>
