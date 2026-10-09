<script setup lang="ts">
// タイトルバーのチャンクが届くまでの同じ高さ・同じ背景の枠。これが無いと
// デッキが先に描けたときに、後からタイトルバーが差し込まれて全体が下へずれる
</script>

<template>
  <div :class="$style.shell" data-tauri-drag-region />
</template>

<style lang="scss" module>
.shell {
  height: 32px;
  flex-shrink: 0;
  background: color-mix(in srgb, var(--nd-navBg) 50%, var(--nd-deckBg));
}
</style>
