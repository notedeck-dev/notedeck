<script setup lang="ts">
// 動画・音声プレイヤーのシークバー / 音量スライダー (#1214)。本家 MkMediaRange
// と同じく input[type=range] を素のまま使い、塗りは --value で描く。
// 0〜1 の比で受け渡す
const props = defineProps<{
  modelValue: number
  /** 読み込み済みの比 (シークバーのみ) */
  buffer?: number
  label: string
  /** 動画の上に重ねるとき (地が暗い) */
  overlay?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

function clamp(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}

function onInput(e: Event) {
  emit('update:modelValue', clamp(Number((e.target as HTMLInputElement).value)))
}
</script>

<template>
  <div
    :class="[$style.root, overlay && $style.overlay]"
    :style="{ '--nd-range-value': `${clamp(props.modelValue) * 100}%`, '--nd-range-buffer': `${clamp(props.buffer ?? 0) * 100}%` }"
  >
    <div v-if="buffer !== undefined" :class="$style.buffer" aria-hidden="true" />
    <input
      :class="$style.input"
      type="range"
      min="0"
      max="1"
      step="any"
      :value="clamp(props.modelValue)"
      :aria-label="label"
      @input="onInput"
    />
  </div>
</template>

<style lang="scss" module>
.root {
  --nd-range-track: var(--nd-scrollbarHandle);
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  height: 20px;
}

.overlay {
  --nd-range-track: rgba(255, 255, 255, 0.25);
}

/* 読み込み済みの範囲。トラックの下に敷く */
.buffer {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 4px;
  margin-top: -2px;
  border-radius: var(--nd-radius-full);
  background: linear-gradient(to right, var(--nd-range-track) var(--nd-range-buffer), transparent var(--nd-range-buffer));
  pointer-events: none;
}

.input {
  position: relative;
  appearance: none;
  width: 100%;
  height: 20px;
  margin: 0;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--nd-accent);

  &::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: var(--nd-radius-full);
    background:
      linear-gradient(to right, currentcolor var(--nd-range-value), transparent var(--nd-range-value)),
      var(--nd-range-track);
  }

  &::-moz-range-track {
    height: 4px;
    border-radius: var(--nd-radius-full);
    background: var(--nd-range-track);
  }

  &::-moz-range-progress {
    height: 4px;
    border-radius: var(--nd-radius-full);
    background: currentcolor;
  }

  &::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
    transition: transform var(--nd-duration-base);
  }

  &::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 0;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
    transition: transform var(--nd-duration-base);
  }

  &:hover::-webkit-slider-thumb,
  &:active::-webkit-slider-thumb {
    transform: scale(1.25);
  }

  &:hover::-moz-range-thumb,
  &:active::-moz-range-thumb {
    transform: scale(1.25);
  }

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: 2px;
    border-radius: var(--nd-radius-xs);
  }
}
</style>
