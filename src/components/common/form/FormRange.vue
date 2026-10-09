<script setup lang="ts">
// スライダー (#704 N)。つまみより手前をアクセント色で塗る (--fill)。
// vertical はパフォーマンス設定のミキサー (DAW 風の縦フェーダー) 用で、下から上へ塗る。
// title / aria-label などの属性は input にそのまま渡る。
import { computed } from 'vue'

const model = defineModel<number>({ required: true })

const props = withDefaults(
  defineProps<{
    min?: number
    max?: number
    step?: number
    vertical?: boolean
  }>(),
  { min: 0, max: 100, step: 1, vertical: false },
)

const fill = computed(() => {
  const span = props.max - props.min
  return `${span > 0 ? ((model.value - props.min) / span) * 100 : 0}%`
})

function onInput(e: Event) {
  model.value = Number((e.target as HTMLInputElement).value)
}
</script>

<template>
  <input
    type="range"
    :class="[$style.range, vertical && $style.vertical]"
    :value="model"
    :min="min"
    :max="max"
    :step="step"
    :style="{ '--fill': fill }"
    @input="onInput"
  />
</template>

<style lang="scss" module>
@mixin thumb($size, $color) {
  &::-webkit-slider-thumb {
    appearance: none;
    width: $size;
    height: $size;
    border-radius: 50%;
    background: $color;
    cursor: pointer;
    transition: transform var(--nd-duration-fast);

    &:hover {
      transform: scale(1.2);
    }
  }

  &::-moz-range-thumb {
    width: $size;
    height: $size;
    border: none;
    border-radius: 50%;
    background: $color;
    cursor: pointer;
  }
}

.range {
  flex: 1;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  background: linear-gradient(
    to right,
    var(--nd-accent) var(--fill, 0%),
    var(--nd-divider) var(--fill, 0%)
  );
  border-radius: var(--nd-radius-xs);
  outline: none;
  cursor: pointer;

  @include thumb(16px, var(--nd-accent));

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: 4px;
  }
}

// 縦向き range。writing-mode が現行仕様で、古い WebKit 用に
// slider-vertical も残す (効かない環境では横向きにフォールバックする)。
// つまみは fg 色にしてミキサーのフェーダーらしく見せる
.vertical {
  -webkit-appearance: slider-vertical;
  writing-mode: vertical-lr;
  direction: rtl;
  flex: none;
  width: 4px;
  height: 132px;
  background: linear-gradient(
    to top,
    var(--nd-accent) var(--fill, 0%),
    var(--nd-divider) var(--fill, 0%)
  );

  @include thumb(14px, var(--nd-fg));
}
</style>
