<script setup lang="ts">
import { computed } from 'vue'
import {
  type ColumnQueryBadgeState,
  queryBadgeIcon,
  queryBadgeTitle,
} from '@/services/columnQuery/badge'

/**
 * カラムヘッダのクエリバッジ (#783): 実行形態 (⚡ / 🐢 / ⚠) と停止 (セーフモード /
 * 全適用が無効) を示し、押すとクエリ管理カラムへ (V25 の調査導線)。
 * per-account と全アカウント面で共有する。
 */
const props = defineProps<{
  state: ColumnQueryBadgeState
  errorCount: number
}>()

const emit = defineEmits<{ open: [] }>()

const title = computed(() => queryBadgeTitle(props.state, props.errorCount))
const icon = computed(() => queryBadgeIcon(props.state.status))
const stopped = computed(
  () => props.state.status === 'safeMode' || props.state.status === 'disabled',
)
</script>

<template>
  <button
    v-if="state.status !== 'none'"
    class="_button"
    :class="[
      $style.queryBadge,
      state.status === 'invalid' && $style.queryBadgeInvalid,
      state.status === 'degraded' && $style.queryBadgeDegraded,
      stopped && $style.queryBadgeStopped,
    ]"
    :title="title"
    @click.stop="emit('open')"
  >
    <i :class="icon" />
    <span v-if="errorCount > 0">{{ errorCount }}</span>
  </button>
</template>

<style lang="scss" module>
/* カラムクエリバッジ (#783): 適用中 = ⚡、評価不能 = ⚠ */
.queryBadge {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 2px;
  margin: auto 0;
  padding: 2px 6px;
  border-radius: var(--nd-radius-full);
  font-size: 0.75em;
  color: var(--nd-accent);
  background: color-mix(in srgb, var(--nd-accent) 12%, transparent);
}

.queryBadgeInvalid {
  color: var(--nd-error);
  background: color-mix(in srgb, var(--nd-error) 12%, transparent);
}

/* 逐次適用に降格 = 効くが検索には使えない */
.queryBadgeDegraded {
  color: var(--nd-warn);
  background: color-mix(in srgb, var(--nd-warn) 12%, transparent);
}

/*
 * セーフモード (#971) / 全適用が無効 (#1043) で停止中。エラーではない
 * (fail-open で全件表示しているだけ) が、適用中と同じ強調では「効いている」と
 * 誤読されるので彩度を落とす
 */
.queryBadgeStopped {
  color: var(--nd-fg);
  background: color-mix(in srgb, var(--nd-fg) 12%, transparent);
  opacity: 0.75;
}
</style>
