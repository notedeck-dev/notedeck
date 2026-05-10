<script setup lang="ts">
import { computed, ref } from 'vue'

import SystemIcon from '@/components/common/SystemIcon.vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { type ConfirmIcon, useConfirm } from '@/stores/confirm'

const { visible: show, options, resolve } = useConfirm()

const iconType = computed<Exclude<ConfirmIcon, 'none'> | null>(() => {
  if (options.value.icon === 'none') return null
  if (options.value.icon) return options.value.icon
  switch (options.value.type) {
    case 'danger':
    case 'warning':
      return 'warn'
    case 'info':
      return 'info'
    case 'success':
      return 'success'
    case 'error':
      return 'error'
    case 'question':
      return 'question'
    case 'waiting':
      return 'waiting'
    default:
      return null
  }
})

const { visible, entering, leaving } = useVaporTransition(show, {
  enterDuration: 200,
  leaveDuration: 200,
})

const dialogRef = ref<HTMLDialogElement | null>(null)

useNativeDialog(dialogRef, visible, {
  get initialFocus() {
    return options.value.type === 'danger'
      ? '._button:first-child'
      : '._button:last-child'
  },
  onCancel: () => resolve(false),
  leaveDuration: 200,
})
</script>

<template>
    <dialog
      v-if="visible"
      ref="dialogRef"
      class="_nativeDialog"
      :class="[entering && $style.enter, leaving && $style.leave]"
    >
      <div
        class="_dialog nd-popup-content"
        :class="[entering && $style.contentEnter, leaving && $style.contentLeave]"
      >
        <div :class="$style.header">
          <div v-if="iconType" :class="$style.icon">
            <SystemIcon :type="iconType" />
          </div>
          <div :class="$style.title">{{ options.title }}</div>
        </div>
        <div :class="$style.body">
          <p :class="$style.message">{{ options.message }}</p>
        </div>
        <div :class="$style.actions">
          <button v-if="!options.hideCancel" class="_button" :class="$style.btnCancel" @click="resolve(false)">
            {{ options.cancelLabel || 'キャンセル' }}
          </button>
          <button
            class="_button"
            :class="options.type === 'danger' ? $style.btnDanger : $style.btnOk"
            @click="resolve(true)"
          >
            {{ options.okLabel || 'OK' }}
          </button>
        </div>
      </div>
    </dialog>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/popup';

.header {
  padding: 20px 20px 4px;
  text-align: center;
}

.icon {
  display: flex;
  justify-content: center;
  margin-bottom: 8px;

  svg {
    width: 40px;
    height: 40px;
  }
}

.title {
  font-size: 1em;
  font-weight: bold;
  color: var(--nd-fg);
}

.body {
  padding: 4px 20px 12px;
  text-align: center;
  // 長文 message (e.g. AI capability の params JSON) で
  // ダイアログが viewport を超えないようスクロール可能にする
  max-height: 60vh;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.message {
  margin: 0;
  color: var(--nd-fg);
  font-size: 0.85em;
  line-height: 1.5;
  opacity: 0.8;
  white-space: pre-wrap;
  word-break: break-word;
}

.actions {
  display: flex;
  gap: 6px;
  padding: 0 16px 16px;
  justify-content: center;
}

.btnCancel { @include btn-secondary; }
.btnOk { @include btn-primary; }
.btnDanger { @include btn-danger; }

</style>
