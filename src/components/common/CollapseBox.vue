<script setup lang="ts">
// 展開・折りたたみの共通部品。中身を瞬間で出し入れせず、開くときは上から
// 垂れ下がるようにフェードイン、閉じるときはフェードアウトしてから外す。
// 高さそのものは補間しない (レイアウトを動かすアニメは CSS レンダリング規約で
// 禁止。DEVELOPMENT.md)。
// 中身は初めて開くまで描かず、閉じ終わったら外す。keepAlive を付けると閉じても
// 中身を残す (入力途中の状態を保つ用途。もとが v-show だった箇所)
import { ref, toRef, watch } from 'vue'
import { useVaporTransition } from '@/composables/useVaporTransition'

const props = defineProps<{
  open: boolean
  keepAlive?: boolean
}>()

// 退場: --nd-duration-fast (100ms) と揃える
const { visible, entering, leaving } = useVaporTransition(
  toRef(props, 'open'),
  { enterDuration: 200, leaveDuration: 100 },
)

// keepAlive は一度開いたら描画を保ち、閉じている間は display: none にする
const everOpened = ref(props.open)
watch(
  () => props.open,
  (open) => {
    if (open) everOpened.value = true
  },
)
</script>

<template>
  <div
    v-if="keepAlive ? everOpened : visible"
    v-show="visible"
    :class="[entering && $style.entering, leaving && $style.leaving]"
    :inert="!open"
  >
    <slot />
  </div>
</template>

<style lang="scss" module>
.entering {
  animation: collapseIn var(--nd-duration-slow) var(--nd-ease-decel) both;
}

.leaving {
  animation: collapseOut var(--nd-duration-fast) var(--nd-ease-decel) both;
  pointer-events: none;
}

@keyframes collapseIn {
  from { opacity: 0; translate: 0 -6px; }
}

@keyframes collapseOut {
  to { opacity: 0; translate: 0 -4px; }
}
</style>
