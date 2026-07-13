<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

/**
 * カラム単位のエラーバウンダリ。子コンポーネントが描画中に throw しても
 * デッキ全体を巻き込まず、フォールバック UI と再読み込み導線を出す。
 */
const error = ref<unknown>(null)
const retryKey = ref(0)

onErrorCaptured((err, _instance, info) => {
  console.error(`[column] uncaught error in ${info}:`, err)
  error.value = err
  return false
})

function retry() {
  error.value = null
  retryKey.value++
}
</script>

<template>
  <div v-if="error" :class="$style.boundary">
    <i class="ti ti-alert-triangle" :class="$style.icon" />
    <div :class="$style.title">カラムの表示中に問題が発生しました</div>
    <button class="_button" :class="$style.retryBtn" @click="retry">
      <i class="ti ti-refresh" />
      再読み込み
    </button>
  </div>
  <div v-else :key="retryKey" :class="$style.content">
    <slot />
  </div>
</template>

<style lang="scss" module>
.boundary {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 16px;
  border-radius: 10px;
  background: var(--nd-panel);
  color: var(--nd-fg);
}

.icon {
  font-size: 1.8em;
  opacity: 0.6;
}

.title {
  font-size: 0.85em;
  opacity: 0.8;
  text-align: center;
}

.retryBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 0.85em;
  font-weight: bold;
  color: var(--nd-fgOnAccent, #fff);
  background: var(--nd-accent);

  &:hover {
    background: var(--nd-accentDarken);
  }
}

.content {
  display: contents;
}
</style>
