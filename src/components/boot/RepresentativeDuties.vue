<script setup lang="ts">
/**
 * 代表窓だけが持つ裏の仕事 (#1131)。App.vue が `isRepresentative` のときだけ mount する。
 *
 * - HEARTBEAT の timer 構成と報告の表示 (OS 通知は 1 回)
 * - OS バッジの件数、トレイの文言と状態、トレイからの切替の受け手
 *
 * PiP の「デッキに戻す」は代表窓の仕事ではなくなった (Rust が親に届ける。
 * `listenDeckWindowEvents`)
 *
 * 代表は Rust の名簿が決める (`main` が居ればそれ、無ければ最も古いデッキ窓)。
 * 役が移れば新しい代表窓でこのコンポーネントが mount され、同じ仕事を始める。
 * lifecycle hook を持つ composable をここに置くのは、setup の外では hook が
 * 捨てられるため (`src/boot/*.ts` にはしない)。
 */
import { useHeartbeatDaemon } from '@/composables/useHeartbeatDaemon'
import { useOsUnreadBadge } from '@/composables/useOsUnreadBadge'
import { useTrayMenu } from '@/composables/useTrayMenu'

useHeartbeatDaemon()
useOsUnreadBadge()
useTrayMenu()
</script>

<template>
  <!-- 描くものは無い。composable の寿命を持つためのコンポーネント -->
</template>
