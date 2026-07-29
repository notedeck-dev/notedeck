<script setup lang="ts">
/**
 * セーフモード (#794) の理由表示。プラグイン / ウィジェット / カスタム CSS /
 * テーマの管理面に置き、「編集はできるが今は効いていない」ことを伝える。
 *
 * 管理 UI 自体は塞がない — セーフモードは「暴走している拡張を直すために入る」
 * モードなので、直す手段まで消してしまうと脱出ハッチとして機能しない。
 */
import { readSafeMode } from '@/utils/safeMode'

defineProps<{
  /** 何が効いていないかの主語 (例: 「プラグイン」) */
  subject: string
}>()

const isSafeMode = readSafeMode()
</script>

<template>
  <div v-if="isSafeMode" :class="$style.notice">
    <i class="ti ti-shield-half" />
    <span>セーフモードで起動中のため{{ subject }}は適用されていません。編集内容は保存され、通常起動で有効になります。</span>
  </div>
</template>

<style lang="scss" module>
.notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 0.8rem;
  line-height: 1.5;
  background: color-mix(in srgb, var(--nd-warn) 15%, transparent);
  color: var(--nd-warn);
}
</style>
