<script setup lang="ts">
import { computed } from 'vue'
import {
  type ColumnQueryBadgeState,
  queryBadgeTitle,
} from '@/services/columnQuery/badge'

/**
 * カラム本体の先頭に出すクエリ状態のバナー (#783)。参照消失 (外す導線) /
 * 解釈不能 (fail-closed) / 暴走サスペンド (明示再開) の 3 つを、
 * per-account と全アカウント面で共有する。
 */
const props = defineProps<{
  state: ColumnQueryBadgeState
  errorCount: number
  missingIds: readonly string[]
  suspendedKeys: readonly string[]
  suspendedCount: number
}>()

const emit = defineEmits<{ resume: []; dropMissing: [] }>()

const invalidTitle = computed(() =>
  queryBadgeTitle(props.state, props.errorCount),
)
</script>

<template>
  <!-- 参照先が消えたクエリ: ここでしか外せないので導線を出す -->
  <button
    v-if="missingIds.length > 0"
    class="_button"
    :class="$style.queryInvalidBanner"
    title="このカラムが参照しているクエリは削除されています。外すと新着の取り込みが戻ります"
    @click="emit('dropMissing')"
  >
    <i class="ti ti-unlink" />
    参照しているクエリが見つかりません
    <span :class="$style.querySuspendedAction">参照を外す</span>
  </button>

  <!-- クエリ評価不能 = fail-closed 中 (#783 不変条件 (f)) -->
  <div
    v-else-if="state.status === 'invalid'"
    :class="$style.queryInvalidBanner"
    :title="invalidTitle"
  >
    <i class="ti ti-alert-triangle" />クエリを解釈できないため新着を停止中
  </div>

  <!-- 暴走で打ち切ったクエリ: 明示操作でのみ再開する (#783 V15) -->
  <button
    v-else-if="suspendedKeys.length > 0"
    class="_button"
    :class="$style.querySuspendedBanner"
    title="クエリの処理が終わらなかったため停止しました。再開すると取得し直します"
    @click="emit('resume')"
  >
    <i class="ti ti-player-pause" />
    <span v-if="suspendedCount > 0">{{ suspendedCount }} 件保留中</span>
    <span v-else>クエリを停止中</span>
    <span :class="$style.querySuspendedAction">再開</span>
  </button>
</template>

<style lang="scss" module>
@use './column-common.module.scss';
</style>
