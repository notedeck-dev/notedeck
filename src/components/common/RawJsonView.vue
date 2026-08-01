<script setup lang="ts">
import { json as jsonLang } from '@codemirror/lang-json'
import { defineAsyncComponent } from 'vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'

const CodeEditor = defineAsyncComponent(
  () => import('@/components/deck/widgets/CodeEditor.vue'),
)

const props = withDefaults(
  defineProps<{
    /** Pre-formatted JSON string to display */
    json: string
    loading?: boolean
    error?: string | null
    /** Whether the reveal toggle is shown */
    canReveal?: boolean
  }>(),
  { loading: false, error: null, canReveal: false },
)

const showSensitive = defineModel<boolean>('showSensitive', { default: false })
const { copied, copyToClipboard } = useClipboardFeedback()
const lang = jsonLang()
</script>

<template>
  <div :class="$style.wrapper">
    <div :class="$style.subHeader">
      <span :class="$style.hint">
        <slot name="hint" />
      </span>
      <div :class="$style.actions">
        <button
          v-if="canReveal"
          class="_button"
          :class="[$style.btn, { [$style.active]: showSensitive }]"
          :title="showSensitive ? '機密を隠す' : '機密を表示'"
          @click="showSensitive = !showSensitive"
        >
          <i :class="showSensitive ? 'ti ti-eye-off' : 'ti ti-eye'" />
          {{ showSensitive ? '隠す' : '機密を表示' }}
        </button>
        <button
          class="_button"
          :class="$style.btn"
          :disabled="!json || loading"
          :title="copied ? 'コピーしました' : '表示中の JSON をコピー'"
          @click="copyToClipboard(json)"
        >
          <i :class="copied ? 'ti ti-check' : 'ti ti-copy'" />
          {{ copied ? 'コピー済み' : 'コピー' }}
        </button>
      </div>
    </div>

    <div :class="$style.body">
      <div v-if="loading" :class="$style.state">
        <LoadingSpinner />
      </div>
      <div v-else-if="error" :class="[$style.state, $style.error]">
        {{ error }}
      </div>
      <CodeEditor
        v-else-if="json"
        :model-value="json"
        :language="lang"
        :read-only="true"
        :auto-height="true"
        :class="$style.editor"
      />
      <div v-else :class="$style.state">データがありません</div>
    </div>
  </div>
</template>

<style module lang="scss">
.wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.subHeader {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
  flex-shrink: 0;
}

.hint {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75em;
  color: var(--nd-fg);
  opacity: 0.7;
  min-width: 0;

  :deep(code) {
    font-family: var(--nd-font-mono);
    background: rgba(127, 127, 127, 0.15);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 0.9em;
  }
}

.actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 0.75em;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.7;
  transition:
    background var(--nd-duration-fast),
    opacity var(--nd-duration-fast);

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  &.active {
    color: var(--nd-accent);
    opacity: 1;
  }
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.editor {
  height: auto;
}

.state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: 0.85em;
}

.error {
  color: var(--nd-love);
  opacity: 1;
}
</style>
