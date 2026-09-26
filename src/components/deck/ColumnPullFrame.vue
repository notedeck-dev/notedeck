<script setup lang="ts">
import { i18n } from '@/i18n'

/**
 * Pull to Refresh の引き下げ枠 (本家 MkPullToRefresh 相当)。状態は
 * `usePullToRefresh` が持ち、ここは描くだけ。per-account (DeckNoteColumn) と
 * 全アカウント面 (DeckTimelineColumn) で共有する。
 */
defineProps<{
  isPulling: boolean
  isPulledEnough: boolean
  isRefreshing: boolean
  /** 表示上の高さ (非線形ブレーキ後、px) */
  height: number
}>()
</script>

<template>
  <div
    v-if="isPulling"
    :class="$style.pullFrame"
    :style="`--frame-min-height: ${height}px`"
  >
    <div :class="$style.pullFrameContent">
      <i v-if="isRefreshing" class="ti ti-loader-2 nd-spin" />
      <i v-else class="ti ti-arrow-bar-to-down" :class="{ refresh: isPulledEnough }" />
      <div :class="$style.pullText">
        <template v-if="isPulledEnough">{{ i18n.ts._common.releaseToRefresh }}</template>
        <template v-else-if="isRefreshing">{{ i18n.ts._common.refreshing }}</template>
        <template v-else>{{ i18n.ts._columnPullFrame.pullToRefresh }}</template>
      </div>
    </div>
  </div>
</template>

<style lang="scss" module>
@use './column-common.module.scss';
</style>
