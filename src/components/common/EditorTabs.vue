<script setup lang="ts">
import { nextTick, useTemplateRef } from 'vue'
import { useSwipeTab } from '@/composables/useSwipeTab'
import { useTabIndicator } from '@/composables/useTabIndicator'
import { nextTabValue } from '@/utils/tablistKeys'

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

// 下線は選んだタブへ滑らせる (ColumnTabs と同じ)
const { indicatorStyle } = useTabIndicator(
  tabsEl,
  '[aria-selected="true"]',
  () => props.modelValue,
)

// 左右キー / Home / End でタブを移り、選んだタブへフォーカスを移す (tablist)
function onTabKeydown(e: KeyboardEvent) {
  const value = nextTabValue(
    props.tabs.map((t) => t.value),
    props.modelValue,
    e.key,
  )
  if (value == null) return
  e.preventDefault()
  emit('update:modelValue', value)
  void nextTick(() => {
    tabsEl.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus()
  })
}

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
  <div
    ref="tabsEl"
    role="tablist"
    :class="$style.tabs"
    @wheel.prevent="onWheel"
    @keydown="onTabKeydown"
  >
    <button
      v-for="t in tabs"
      :key="t.value"
      role="tab"
      :aria-selected="modelValue === t.value"
      :tabindex="modelValue === t.value ? 0 : -1"
      class="_button"
      :class="[$style.tab, { [$style.active]: modelValue === t.value }]"
      :title="t.label"
      :aria-label="t.label"
      @click="emit('update:modelValue', t.value)"
    >
      <i :class="'ti ti-' + t.icon" />
      <span :class="$style.label">{{ t.label }}</span>
    </button>
    <div :class="$style.indicator" :style="indicatorStyle" />
  </div>
</template>

<style lang="scss" module>
.tabs {
  display: flex;
  position: relative;
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
  font-size: var(--nd-font-xs);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fg);
  opacity: 0.5;
  border-bottom: 2px solid transparent;
  flex-shrink: 0;
  transition: opacity var(--nd-duration-base), color var(--nd-duration-base);

  &:hover {
    opacity: 0.8;
  }

  &.active {
    opacity: 1;
    color: var(--nd-accentText);

    .label {
      display: inline;
    }
  }
}

.indicator {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 1px;
  height: 2px;
  background: var(--nd-accent);
  transform-origin: 0 0;
  transition:
    translate var(--nd-duration-slower) var(--nd-ease-pop),
    scale var(--nd-duration-slower) var(--nd-ease-pop),
    opacity var(--nd-duration-slower) var(--nd-ease-pop);
  pointer-events: none;
}

.label {
  display: none;
  white-space: nowrap;
}
</style>
