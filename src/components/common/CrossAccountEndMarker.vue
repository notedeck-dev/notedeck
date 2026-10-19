<script setup lang="ts">
/**
 * 全アカウント面の末尾の区切り行 (#1184)。列の底は「まだ遡れるアカウントのうち
 * 到達点がいちばん浅いもの」で揃えているので、その下に隠れている行があるとき、
 * または取得できていないアカウントがあるときだけ、終端を無言にしないために出す。
 * 全アカウントが尽きたら何も出さない (通常の終端)
 */
import type { CrossEndState } from '@/composables/useCrossAccountNotes'
import { i18n } from '@/i18n'
import { formatDate } from '@/utils/format'

defineProps<{
  state: CrossEndState
}>()
</script>

<template>
  <div :class="$style.root" role="status">
    <template v-if="state.kind === 'failing'">
      <i class="ti ti-alert-triangle" :class="$style.icon" />
      <span>{{ i18n.tsx._crossAccountEndMarker.failing({ accounts: state.accounts.join(', ') }) }}</span>
    </template>
    <template v-else>
      <i class="ti ti-arrows-horizontal" :class="$style.icon" />
      <span>{{ i18n.tsx._crossAccountEndMarker.aligned({ account: state.account, date: formatDate(state.createdAt) }) }}</span>
    </template>
  </div>
</template>

<style module lang="scss">
.root {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 16px;
  font-size: var(--nd-font-sm);
  color: var(--nd-fgTransparent);
  text-align: center;
  overflow-wrap: anywhere;
}

.icon {
  flex: none;
}
</style>
