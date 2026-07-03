<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { usePortal } from '@/composables/usePortal'
import { useVaporTransitionGroup } from '@/composables/useVaporTransition'
import { useToast } from '@/stores/toast'

const { toasts } = useToast()
const { rendered, enteringIds, leavingIds } = useVaporTransitionGroup(toasts, {
  enterDuration: 250,
  leaveDuration: 120,
})

const toastPortalRef = useTemplateRef<HTMLElement>('toastPortalRef')
usePortal(toastPortalRef)
</script>

<template>
    <div ref="toastPortalRef" :class="$style.container">
      <div
        v-for="toast in rendered"
        :key="toast.id"
        :class="[
          $style.toast,
          $style[toast.type],
          enteringIds.has(toast.id) && $style.toastEnter,
          leavingIds.has(toast.id) && $style.toastLeave,
        ]"
      >
        <i
          :class="[
            $style.icon,
            toast.type === 'success' ? 'ti ti-check' :
            toast.type === 'warning' ? 'ti ti-alert-triangle' :
            toast.type === 'error' ? 'ti ti-x' :
            'ti ti-info-circle',
          ]"
        />
        <span :class="$style.text">{{ toast.text }}</span>
      </div>
    </div>
</template>

<style lang="scss" module>
.container {
  position: fixed;
  top: 15%;
  left: 50%;
  translate: -50% 0;
  z-index: var(--nd-z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: var(--nd-radius-md);
  font-size: 0.85em;
  color: #fff;
  background: var(--nd-panel);
  box-shadow: var(--nd-shadow-m);
  contain: paint;
  pointer-events: auto;
  white-space: nowrap;
  max-width: 90vw;
}

.icon {
  flex-shrink: 0;
  font-size: 1.1em;
}

.text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.success {
  color: #fff;
  background: color-mix(in srgb, var(--nd-success) 90%, transparent);
}

.error {
  color: #fff;
  background: color-mix(in srgb, var(--nd-error) 90%, transparent);
}

.warning {
  color: #fff;
  background: color-mix(in srgb, var(--nd-warn) 85%, transparent);
}

.info {
  color: #fff;
  background: color-mix(in srgb, var(--nd-accent) 85%, transparent);
}

.toastEnter {
  animation: toast-enter 0.25s var(--nd-ease-spring) both;
}

.toastLeave {
  animation: toast-leave var(--nd-duration-base) var(--nd-ease-decel) both;
}

@keyframes toast-enter {
  from {
    opacity: 0;
    transform: translateY(-16px) scale(0.9);
  }
}

@keyframes toast-leave {
  to {
    opacity: 0;
    transform: translateY(6px) scale(0.95);
  }
}

</style>
