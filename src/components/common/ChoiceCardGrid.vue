<script setup lang="ts">
/** ChoiceCard を並べる 4 列のグリッド。設定画面のカード面はすべてこの間隔 */
</script>

<template>
  <div :class="$style.grid">
    <slot />
  </div>
</template>

<style lang="scss" module>
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
</style>
