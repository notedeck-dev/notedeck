<script setup lang="ts">
import { ref, watch } from 'vue'

import { useNativeDialog } from '@/composables/useNativeDialog'
import { useVaporTransition } from '@/composables/useVaporTransition'
import { usePrompt } from '@/stores/prompt'

const { visible: show, options, resolve } = usePrompt()

const { visible, entering, leaving } = useVaporTransition(show, {
  enterDuration: 200,
  leaveDuration: 200,
})

const dialogRef = ref<HTMLDialogElement | null>(null)
const inputValue = ref('')

useNativeDialog(dialogRef, visible, {
  initialFocus: 'input, textarea',
  onCancel: () => resolve(null),
  leaveDuration: 200,
})

watch(show, (v) => {
  if (v) {
    inputValue.value = options.value.defaultValue ?? ''
  }
})

function submit() {
  const trimmed = inputValue.value.trim()
  if (trimmed || options.value.allowEmpty) resolve(trimmed)
}
</script>

<template>
    <dialog
      v-if="visible"
      ref="dialogRef"
      class="_nativeDialog"
      :class="[entering && $style.enter, leaving && $style.leave]"
    >
      <form
        class="_dialog nd-popup-content"
        :class="[entering && $style.contentEnter, leaving && $style.contentLeave]"
        @submit.prevent="submit"
      >
        <div :class="$style.header">
          <div :class="$style.title">{{ options.title }}</div>
        </div>
        <div :class="$style.body">
          <p v-if="options.message" :class="$style.message">{{ options.message }}</p>
          <textarea
            v-if="options.multiline"
            v-model="inputValue"
            :class="[$style.input, $style.textarea]"
            rows="4"
            :placeholder="options.placeholder"
          />
          <input
            v-else
            v-model="inputValue"
            :class="$style.input"
            type="text"
            :placeholder="options.placeholder"
          />
        </div>
        <div :class="$style.actions">
          <button type="button" class="_button" :class="$style.btnCancel" @click="resolve(null)">
            {{ options.cancelLabel || 'キャンセル' }}
          </button>
          <button
            type="submit"
            class="_button"
            :class="$style.btnOk"
            :disabled="!options.allowEmpty && !inputValue.trim()"
          >
            {{ options.okLabel || 'OK' }}
          </button>
        </div>
      </form>
    </dialog>
</template>

<style lang="scss" module>
@use '@/styles/buttons' as *;
@use '@/styles/popup';

.header {
  padding: 16px 20px 4px;
  text-align: center;
}

.title {
  font-size: 1em;
  font-weight: bold;
  color: var(--nd-fg);
}

.body {
  padding: 4px 20px 12px;
}

.message {
  margin: 0 0 8px;
  color: var(--nd-fg);
  font-size: 0.85em;
  line-height: 1.5;
  opacity: 0.8;
  text-align: center;
}

.input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.95em;
  outline: none;

  &:focus {
    border-color: var(--nd-accent);
  }
}

.textarea {
  font-family: inherit;
  resize: vertical;
  min-height: 5em;
}

.actions {
  display: flex;
  gap: 6px;
  padding: 0 16px 16px;
  justify-content: center;
}

.btnCancel { @include btn-secondary; }
.btnOk { @include btn-primary; }

</style>
