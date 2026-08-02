<script setup lang="ts">
import { computed } from 'vue'
import {
  formatAbsoluteTime,
  formatTime,
  toDatetimeAttr,
} from '@/utils/formatTime'

/**
 * 経過時間の表示 (#704 H / G)。相対表記・絶対時刻の title・datetime 属性を
 * 1 箇所にまとめる。時刻を出す面はデッキ中に散っているので、表記のゆれと
 * <time> の付け忘れを構造的に防ぐ。
 */
const props = defineProps<{
  /** ISO 文字列または epoch ミリ秒 */
  at: string | number | null | undefined
  /** 定期更新する ref を持つ画面はそれを渡す (再描画のトリガになる) */
  now?: number
}>()

const label = computed(() => formatTime(props.at, props.now))
const absolute = computed(() => formatAbsoluteTime(props.at))
const datetime = computed(() => toDatetimeAttr(props.at))
</script>

<template>
  <time :datetime="datetime" :title="absolute">{{ label }}</time>
</template>
