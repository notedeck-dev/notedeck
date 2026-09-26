<script setup lang="ts">
/**
 * 全アカウント面の取得進捗 (#1095)。全部が返るまで止まっているように
 * 見えないよう、「N アカウントのうち M 件待ち」をスピナーに添える。
 * 表示だけの部品で、数え方は各面の取得経路 (mapWithConcurrency の
 * onSettled) が持つ。
 */
import { i18n } from '@/i18n'
import type { SettleProgress } from '@/utils/concurrency'
import LoadingSpinner from './LoadingSpinner.vue'

defineProps<{
  progress: SettleProgress
  /** スピナーの大きさ。カラム中央は既定、行末 (追加読み込み) は小さく */
  size?: number
}>()
</script>

<template>
  <div :class="$style.root">
    <LoadingSpinner :size="size" />
    <span :class="$style.text">
      {{ i18n.tsx._crossAccountProgress.waiting({ total: progress.total, pending: progress.total - progress.done }) }}
    </span>
  </div>
</template>

<style module lang="scss">
.root {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.text {
  font-size: 0.8em;
  color: var(--nd-fgTransparent);
  font-variant-numeric: tabular-nums;
}
</style>
