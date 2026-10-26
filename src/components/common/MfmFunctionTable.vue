<script setup lang="ts">
import MkMfm from '@/components/common/MkMfm.vue'
import { i18n } from '@/i18n'
import { MFM_PLAYGROUND_FUNCTION_ROWS } from './mfmPlaygroundSamples'

/**
 * 本家 mfm-renderer が描く fn の対照表 (構文 → デッキと同じ描画)。MFM エディターカラムと
 * Dev Dashboard の MFM プレビューで共有する
 */
defineProps<{
  emojis?: Record<string, string>
  serverHost?: string
  /** 画面外のノートと同じ停止状態で描く */
  paused?: boolean
}>()
</script>

<template>
  <table :class="$style.table">
    <thead>
      <tr>
        <th>{{ i18n.ts._mfmPlayground.fnSyntax }}</th>
        <th>{{ i18n.ts._mfmPlayground.fnRender }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in MFM_PLAYGROUND_FUNCTION_ROWS" :key="row">
        <td><code :class="$style.code">{{ row }}</code></td>
        <td :style="{ '--nd-mfm-play-state': paused ? 'paused' : 'running' }">
          <MkMfm :text="row" :emojis="emojis" :server-host="serverHost" />
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style lang="scss" module>
.table {
  width: 100%;
  border-collapse: collapse;

  th,
  td {
    padding: 8px;
    border-bottom: 1px solid var(--nd-divider);
    text-align: left;
    vertical-align: middle;
  }

  th {
    font-size: var(--nd-font-xs);
    opacity: 0.6;
  }

  td:first-child {
    width: 45%;
  }
}

.code {
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-xs);
}
</style>
