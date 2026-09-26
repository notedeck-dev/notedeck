<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '@/i18n'
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
    :title="i18n.ts._columnQueryBanners.queryDeletedHint"
    @click="emit('dropMissing')"
  >
    <i class="ti ti-unlink" />
    {{ i18n.ts._columnQueryBanners.queryNotFound }}
    <span :class="$style.querySuspendedAction">{{ i18n.ts._columnQueryBanners.detach }}</span>
  </button>

  <!-- クエリ評価不能 = fail-closed 中 (#783 不変条件 (f)) -->
  <div
    v-else-if="state.status === 'invalid'"
    :class="$style.queryInvalidBanner"
    :title="invalidTitle"
  >
    <i class="ti ti-alert-triangle" />{{ i18n.ts._columnQueryBanners.queryInvalid }}
  </div>

  <!-- 暴走で打ち切ったクエリ: 明示操作でのみ再開する (#783 V15) -->
  <button
    v-else-if="suspendedKeys.length > 0"
    class="_button"
    :class="$style.querySuspendedBanner"
    :title="i18n.ts._columnQueryBanners.suspendedHint"
    @click="emit('resume')"
  >
    <i class="ti ti-player-pause" />
    <span v-if="suspendedCount > 0">{{ i18n.tsx._columnQueryBanners.pending_plural({ count: suspendedCount }) }}</span>
    <span v-else>{{ i18n.ts._columnQueryBanners.querySuspended }}</span>
    <span :class="$style.querySuspendedAction">{{ i18n.ts._columnQueryBanners.resume }}</span>
  </button>
</template>

<style lang="scss" module>
@use './column-common.module.scss';
</style>
