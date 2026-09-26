<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import { i18n } from '@/i18n'

const PostFormEditorContent = defineAsyncComponent(
  () => import('@/components/window/PostFormEditorContent.vue'),
)

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div :class="$style.picker" @click.stop>
    <div :class="$style.header">
      <span :class="$style.title">
        <i class="ti ti-forms" />
        {{ i18n.ts._mkPostFormButtonsPicker.title }}
      </span>
      <button class="_button" :class="$style.closeBtn" :title="i18n.ts._common.close" @click="emit('close')">
        <i class="ti ti-x" />
      </button>
    </div>
    <div :class="$style.body">
      <PostFormEditorContent />
    </div>
  </div>
</template>

<style lang="scss" module>
.picker {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 520px;
  max-height: min(75vh, 640px);
  margin: 0 16px 16px;
  background: var(--nd-panelBg, var(--nd-popup));
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 8px 32px var(--nd-shadow);
}

.header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--nd-divider);
}

.title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: bold;
  font-size: 0.9em;
  flex: 1;
}

.closeBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: var(--nd-fg);
  opacity: 0.7;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
