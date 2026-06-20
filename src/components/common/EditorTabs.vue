<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { useSwipeTab } from '@/composables/useSwipeTab'

export interface EditorTabDef {
  value: string
  icon: string
  label: string
}

const props = defineProps<{
  tabs: EditorTabDef[]
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const tabsEl = useTemplateRef<HTMLDivElement>('tabsEl')

function next(): boolean {
  const idx = props.tabs.findIndex((t) => t.value === props.modelValue)
  const n = props.tabs[idx + 1]
  if (n) {
    emit('update:modelValue', n.value)
    return true
  }
  return false
}

function prev(): boolean {
  const idx = props.tabs.findIndex((t) => t.value === props.modelValue)
  const p = props.tabs[idx - 1]
  if (p) {
    emit('update:modelValue', p.value)
    return true
  }
  return false
}

// 横スクロール / Shift+wheel → タブ切り替え
useSwipeTab(tabsEl, next, prev, { checkHorizontalScroll: false })

// 縦スクロール → タブバーの横スクロール変換
function onWheel(e: WheelEvent) {
  if (e.deltaX !== 0) return // useSwipeTab が処理する
  const el = tabsEl.value
  if (!el) return
  el.scrollLeft += e.deltaY
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

    .label {
      display: inline;
    }
  }
}

.label {
  display: none;
  white-space: nowrap;
}
</style>
