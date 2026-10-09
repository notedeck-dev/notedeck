<script setup lang="ts">
import { computed } from 'vue'
import { useMinuteClock } from '@/composables/useMinuteClock'
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
  /**
   * 基準時刻。省略時は共有の分単位の時計 (useMinuteClock) で進む。
   * 渡すと時計は読まない (独自の刻みを持つ画面向け)
   */
  now?: number
}>()

// 依存は label の computed だけに閉じる。親が時計を読むと親ごと毎分再描画になる
const clock = useMinuteClock()
const label = computed(() => formatTime(props.at, props.now ?? clock.value))
const absolute = computed(() => formatAbsoluteTime(props.at))
const datetime = computed(() => toDatetimeAttr(props.at))
</script>

<template>
  <time :class="$style.time" :datetime="datetime" :title="absolute">{{ label }}</time>
</template>

<style lang="scss" module>
/* 「9 分前」→「10 分前」で数字の幅が変わって周りが揺れないように */
.time {
  font-variant-numeric: tabular-nums;
}
</style>
