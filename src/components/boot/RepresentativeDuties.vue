<script setup lang="ts">
/**
 * 代表窓だけが持つ裏の仕事 (#1131)。App.vue が `isRepresentative` のときだけ mount する。
 *
 * - HEARTBEAT の timer 構成と報告の表示 (OS 通知は 1 回)
 * - OS バッジの件数、トレイの文言と状態、トレイからの切替の受け手
 * - PiP の「デッキに戻す」の受け手 (親の窓に届ける形は #1131 の親子の段で)
 *
 * 代表は Rust の名簿が決める (`main` が居ればそれ、無ければ最も古いデッキ窓)。
 * 役が移れば新しい代表窓でこのコンポーネントが mount され、同じ仕事を始める。
 * lifecycle hook を持つ composable をここに置くのは、setup の外では hook が
 * 捨てられるため (`src/boot/*.ts` にはしない)。
 */
import { onMounted, onUnmounted } from 'vue'
import { useHeartbeatDaemon } from '@/composables/useHeartbeatDaemon'
import { useOsUnreadBadge } from '@/composables/useOsUnreadBadge'
import { useTrayMenu } from '@/composables/useTrayMenu'
import { useDeckStore } from '@/stores/deck'
import { listenPipEvents } from '@/windows/pip'

useHeartbeatDaemon()
useOsUnreadBadge()
useTrayMenu()

let cleanupPipListener: (() => void) | null = null

onMounted(async () => {
  const deckStore = useDeckStore()
  cleanupPipListener = await listenPipEvents({
    onReturnToDeck: async (columnConfig) => {
      deckStore.addColumn(columnConfig)
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setFocus()
    },
  }).catch(() => null)
})

onUnmounted(() => {
  cleanupPipListener?.()
})
</script>

<template>
  <!-- 描くものは無い。composable の寿命を持つためのコンポーネント -->
</template>
