<script setup lang="ts">
import { computed, ref } from 'vue'
import { useClickOutside } from '@/composables/useClickOutside'

/**
 * CSS エディタのプリセット用ドロップダウン (#778)。
 * 選択肢リスト + 選択中ラベル + 開閉 + 外側クリックで閉じる、の同型構造が
 * セクションごとに繰り返されていたのを共通化した。見た目・挙動は従来のまま。
 */
export interface PresetDropdownOption {
  value: string
  label: string
}

const props = withDefaults(
  defineProps<{
    options: PresetDropdownOption[]
    /** ラベルと選択肢をその value のフォントで描画する (フォントプリセット用) */
    fontPreview?: boolean
    /** fontPreview 時のフォールバック総称ファミリ (等幅なら monospace) */
    fontFallback?: string
  }>(),
  { fontPreview: false, fontFallback: 'sans-serif' },
)

const model = defineModel<string>({ required: true })

const show = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const selectedLabel = computed(
  () =>
    props.options.find((o) => o.value === model.value)?.label ?? 'デフォルト',
)

function fontStyle(value: string) {
  if (!props.fontPreview || !value) return undefined
  return { fontFamily: `'${value}', ${props.fontFallback}` }
}

function select(value: string) {
  model.value = value
  show.value = false
}

useClickOutside(rootRef, () => {
  show.value = false
})
</script>

<template>
  <div ref="rootRef" :class="$style.dropdown">
    <button class="_button" :class="$style.dropdownTrigger" @click="show = !show">
      <span :class="{ [$style.fontPreviewLabel]: fontPreview }" :style="fontStyle(model)">
        {{ selectedLabel }}
      </span>
      <i class="ti ti-chevron-down" :class="$style.dropdownChevron" />
    </button>
    <div v-if="show" :class="$style.dropdownPanel">
      <button
        v-for="opt in options"
        :key="opt.value"
        class="_button"
        :class="[$style.dropdownItem, { [$style.selected]: model === opt.value }]"
        @click="select(opt.value)"
      >
        <span :class="{ [$style.fontPreviewLabel]: fontPreview }" :style="fontStyle(opt.value)">
          {{ opt.label }}
        </span>
        <i v-if="model === opt.value" class="ti ti-check" :class="$style.checkIcon" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
.dropdown {
  position: relative;
  width: 100%;
}

.dropdownTrigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.8em;
  text-align: left;
  transition: border-color var(--nd-duration-base), background var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
}

.dropdownChevron {
  margin-left: auto;
  opacity: 0.4;
  font-size: 0.85em;
}

.dropdownPanel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 2px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-panel);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.dropdownItem {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 10px;
  font-size: 0.8em;
  color: var(--nd-fg);
  text-align: left;
  cursor: pointer;
  transition: background var(--nd-duration-base);

  &:hover { background: var(--nd-buttonHoverBg); }
  &.selected { color: var(--nd-accent); }
  & + & { border-top: 1px solid color-mix(in srgb, var(--nd-divider) 50%, transparent); }
}

.fontPreviewLabel { flex: 1; min-width: 0; }
.checkIcon { margin-left: auto; opacity: 0.7; flex-shrink: 0; }
</style>
