<script setup lang="ts">
import { ref, toRef } from 'vue'
import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { i18n } from '@/i18n'

const props = defineProps<{
  show: boolean
  isGuest?: boolean
}>()

const emit = defineEmits<{
  'keep-data': []
  'delete-all': []
  cancel: []
}>()

const { visible, entering, leaving } = useVaporTransition(
  toRef(props, 'show'),
  { enterDuration: 200, leaveDuration: 200 },
)

const dialogRef = ref<HTMLDialogElement | null>(null)
useNativeDialog(dialogRef, visible, {
  onCancel: () => emit('cancel'),
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
          <i :class="[$style.icon, isGuest ? 'ti ti-user-off' : 'ti ti-logout']" />
          <div :class="$style.title">{{ isGuest ? i18n.ts._logoutDialog.removeGuest : i18n.ts._common.logout }}</div>
        </div>

        <div :class="$style.body">
          <p :class="$style.message">
            {{ isGuest ? i18n.ts._logoutDialog.confirmRemoveGuest : i18n.ts._logoutDialog.keepDataQuestion }}
          </p>
          <p v-if="!isGuest" :class="$style.hint">
            {{ i18n.ts._logoutDialog.keptDataHint }}
          </p>
        </div>

        <div :class="$style.actions">
          <button class="_button" :class="$style.btnCancel" @click="emit('cancel')">
            {{ i18n.ts._common.cancel }}
          </button>
          <button class="_button" :class="$style.btnDelete" @click="emit('delete-all')">
            {{ isGuest ? i18n.ts._common.delete : i18n.ts._logoutDialog.deleteAll }}
          </button>
          <button v-if="!isGuest" class="_button" :class="$style.btnKeep" @click="emit('keep-data')">
            {{ i18n.ts._logoutDialog.keepData }}
          </button>
        </div>
      </div>
    </dialog>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/popup';

.header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 20px 4px;
}

.icon {
  font-size: 1.2em;
  color: var(--nd-fg);
  opacity: 0.7;
}

.title {
  font-size: 1em;
  font-weight: bold;
  color: var(--nd-fg);
}

.body {
  padding: 4px 20px 12px;
  text-align: center;
}

.message {
  margin: 0;
  color: var(--nd-fg);
  font-size: 0.85em;
  line-height: 1.5;
  opacity: 0.8;
}

.hint {
  margin: 4px 0 0;
  color: var(--nd-fg);
  font-size: 0.8em;
  opacity: 0.5;
}

.actions {
  display: flex;
  gap: 6px;
  padding: 0 16px 16px;
  justify-content: center;
}

.btnCancel { @include btn-secondary; }
.btnDelete { @include btn-danger; }
.btnKeep { @include btn-primary; }

</style>
