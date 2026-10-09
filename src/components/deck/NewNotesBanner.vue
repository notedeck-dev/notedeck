<script setup lang="ts">
// 「新着ノート」バナー。押したとき・追いついたときに瞬間で消えないよう、
// 退場もアニメーションさせる
import { toRef } from 'vue'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ click: [] }>()

const { visible, leaving } = useVaporTransition(toRef(props, 'show'), {
  leaveDuration: 150,
})
</script>

<template>
  <button
    v-if="visible"
    :class="[$style.banner, leaving && $style.leaving]"
    class="_button"
    @click="emit('click')"
  >
    <i class="ti ti-arrow-up" />{{ i18n.ts._common.newNotes }}
  </button>
</template>

<style lang="scss" module>
.banner {
  position: absolute;
  top: 8px;
  left: 50%;
  translate: -50% 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--nd-radius-full);
  font-size: var(--nd-font-md);
  font-weight: var(--nd-weight-bold);
  color: var(--nd-fgOnAccent);
  background: color-mix(in srgb, var(--nd-accent) 88%, transparent);
  cursor: pointer;
  transition: opacity var(--nd-duration-base);
  animation: slideDown var(--nd-duration-slow) var(--nd-ease-spring);

  @media (hover: hover) {
    &:hover {
      opacity: 0.85;
    }
  }
}

/* 退場: --nd-duration-base (150ms) = leaveDuration */
.leaving {
  animation: slideUp var(--nd-duration-base) var(--nd-ease-decel) both;
  pointer-events: none;
}

@keyframes slideDown {
  from { translate: -50% -100%; opacity: 0; }
  to { translate: -50% 0; opacity: 1; }
}

@keyframes slideUp {
  to { translate: -50% -60%; opacity: 0; }
}
</style>
