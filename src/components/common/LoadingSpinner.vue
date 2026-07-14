<script setup lang="ts">
// スピナーの使い分け規約:
// - カラム/ペイン中央のメインローディング → この LoadingSpinner (size で調整)
// - ボタン内・行内のインラインスピナー → `ti ti-loader-2 nd-spin`
//   (font-size / color を周辺テキストに追従させるため)
import { computed } from 'vue'

const props = withDefaults(defineProps<{ size?: number }>(), { size: 28 })

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderWidth: `${Math.max(2, Math.round(props.size / 9))}px`,
}))
</script>

<template>
  <div :class="$style.spinner" :style="style" />
</template>

<style module lang="scss">
.spinner {
  border: 3px solid color-mix(in srgb, var(--nd-accent) 25%, transparent);
  border-top-color: var(--nd-accent);
  border-radius: 50%;
  animation: nd-spin 0.8s linear infinite;
}
</style>
