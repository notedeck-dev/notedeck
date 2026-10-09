<script setup lang="ts">
import { nextTick, ref, useCssModule, watch } from 'vue'
import { useSwipeTab } from '@/composables/useSwipeTab'
import { useTabIndicator } from '@/composables/useTabIndicator'

export interface ColumnTabDef {
  value: string
  label: string
  /** tabler icon name without the `ti-` prefix, or SVG path `d` attribute */
  icon?: string
  /** true when `icon` holds SVG path data instead of a tabler icon name */
  iconIsSvg?: boolean
}

const props = withDefaults(
  defineProps<{
    tabs: ColumnTabDef[]
    modelValue: string
    /** When provided, swipe/wheel gestures on this element switch tabs */
    swipeTarget?: HTMLElement | null
    /** Show label only on the active tab (icon-only compact layout) */
    compact?: boolean
    /** Enable horizontal scroll for many tabs */
    scrollable?: boolean
  }>(),
  {
    swipeTarget: null,
    compact: false,
    scrollable: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const $style = useCssModule()
const tabsRef = ref<HTMLElement | null>(null)
const swipeTargetRef = ref<HTMLElement | null>(null)

watch(
  () => props.swipeTarget,
  (el) => {
    swipeTargetRef.value = el ?? null
  },
  { immediate: true },
)

const { indicatorStyle } = useTabIndicator(
  tabsRef,
  `.column-tab.${$style.active}`,
  () => props.modelValue,
)

function switchTab(value: string) {
  if (value === props.modelValue) return
  emit('update:modelValue', value)
}

function next(): boolean {
  const idx = props.tabs.findIndex((t) => t.value === props.modelValue)
  const n = props.tabs[idx + 1]
  if (n) {
    switchTab(n.value)
    return true
  }
  return false
}

function prev(): boolean {
  const idx = props.tabs.findIndex((t) => t.value === props.modelValue)
  const p = props.tabs[idx - 1]
  if (p) {
    switchTab(p.value)
    return true
  }
  return false
}

useSwipeTab(swipeTargetRef, next, prev)

// Keep active tab visible when the tab bar can overflow.
// Avoid `scrollIntoView` — it walks every scrollable ancestor and would also
// scroll the parent DeckColumnsArea horizontally, throwing the whole column
// off-screen on Chromium/WebView2 (Windows).
watch(
  () => props.modelValue,
  () => {
    if (!props.scrollable) return
    nextTick(() => {
      const container = tabsRef.value
      if (!container) return
      const el = container.querySelector(
        `.column-tab.${$style.active}`,
      ) as HTMLElement | null
      if (!el) return
      const offset =
        el.offsetLeft - (container.clientWidth - el.offsetWidth) / 2
      container.scrollTo({ left: offset, behavior: 'smooth' })
    })
  },
)
</script>

<template>
  <div
    ref="tabsRef"
    :class="[$style.tabs, scrollable && $style.scrollable]"
  >
    <button
      v-for="t in tabs"
      :key="t.value"
      class="_button column-tab"
      :class="[
        $style.tab,
        {
          [$style.active]: modelValue === t.value,
          [$style.iconOnly]: compact && modelValue !== t.value,
        },
      ]"
      :title="t.label"
      @click="switchTab(t.value)"
    >
      <span v-if="t.icon" :class="$style.tabIcon">
        <i
          v-if="!t.iconIsSvg"
          :class="'ti ti-' + t.icon"
        />
        <svg
          v-else
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            :d="t.icon"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
        </svg>
      </span>
      <span
        v-if="!compact || modelValue === t.value"
        :class="$style.tabLabel"
      >{{ t.label }}</span>
    </button>
    <slot name="trailing" />
    <div :class="$style.indicator" :style="indicatorStyle" />
  </div>
</template>

<style lang="scss" module>
.tabs {
  display: flex;
  position: relative;
  border-bottom: 1px solid var(--nd-divider);
  background: var(--nd-bg);
  flex-shrink: 0;
  /* button 間の物理的な間隔。padding (button 内部) と責務を分離し、
     Chromium 系で glyph advance width が膨らんでも隣接タブへ干渉しない。 */
  gap: 4px;
  /* min-width フロアによりタブ合計幅がカラム幅を超えるケース (狭カラム +
     5+ タブ) で破綻しないよう、水平スクロールを常時有効化。scrollbar は
     両 WebView (WebKit / Chromium) で非表示。 */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.tabs.scrollable {
  /* scroll 挙動 (overflow-x) は .tabs に統合。本クラスは active タブ
     scroll-into-view (script side, watch L86-102) のためのマーカー。 */
}

.tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  flex: 0 0 auto;
  opacity: 0.4;
  transition:
    opacity var(--nd-duration-base),
    background var(--nd-duration-base);
  position: relative;
  /* タブ幅をフォントの glyph advance から切り離す。Segoe UI Bold (Windows)
     と DejaVu/Noto Bold (Linux) は同 font-size でも advance width が違い、
     短いラベルほど 4-6px 差が出る。4rem (=64px) フロアで両 OS のタブ幅を
     同一に丸める。長いラベルは natural width で伸びる。 */
  min-width: 4rem;

  &:hover {
    opacity: 0.7;
    background: var(--nd-buttonHoverBg);
  }

  &.active {
    opacity: 1;
  }
}

/* compact モードの非アクティブタブ (icon-only) は tabIcon の 20px 固定箱で
   既にフォント非依存。フロアを当てると inactive タブが無駄に広がるので除外。 */
.tab.iconOnly {
  min-width: 0;
}

/* Icon wrapper: fixed-size box that clips any glyph bleed from hinting.
   Box (20px) > glyph (16px) absorbs sub-pixel rendering differences
   between WebKitGTK / WebView2 / Chromium. */
.tabIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  overflow: hidden;
  color: currentColor;
}

.tabIcon > i {
  font-size: 16px;
  line-height: 1;
}

.tabIcon > svg {
  width: 16px;
  height: 16px;
}

.tabLabel {
  font-size: var(--nd-font-md);
  font-weight: var(--nd-weight-bold);
  white-space: nowrap;
}

.indicator {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 1px;
  height: 3px;
  background: var(--nd-accent);
  border-radius: var(--nd-radius-full) var(--nd-radius-full) 0 0;
  transform-origin: 0 0;
  transition:
    translate var(--nd-duration-slower) var(--nd-ease-pop),
    scale var(--nd-duration-slower) var(--nd-ease-pop),
    opacity var(--nd-duration-slower) var(--nd-ease-pop);
  pointer-events: none;
}
</style>
