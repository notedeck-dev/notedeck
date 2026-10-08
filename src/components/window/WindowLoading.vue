<script setup lang="ts">
// ウィンドウの中身のチャンクが届くまでの仮表示。これが無いとヘッダだけの
// 細いウィンドウが出てから中身の高さへ一気に伸びる
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
</script>

<template>
  <div :class="$style.loading">
    <LoadingSpinner />
  </div>
</template>

<style lang="scss" module>
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  flex: 1;
}
</style>
