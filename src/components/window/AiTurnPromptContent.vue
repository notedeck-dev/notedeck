<script setup lang="ts">
import { onMounted, ref } from 'vue'
import LoadingSpinner from '@/components/common/LoadingSpinner.vue'
import { fetchTurnSystem } from '@/composables/useAiWorkspace'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { i18n } from '@/i18n'
import { AppError } from '@/utils/errors'

/**
 * 「この応答に送った指示」(#1162): notemaid がそのターンで送った system prompt を
 * 読むだけの開発者向けインスペクタ。notemaid は直近の数ターン分しかメモリに
 * 残さないので、消えていれば「もう残っていない」と出す。ここでも保存しない。
 */
const props = defineProps<{
  turnId: string
}>()

const text = ref<string | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)
const { copied, copyToClipboard } = useClipboardFeedback()

onMounted(async () => {
  try {
    text.value = await fetchTurnSystem(props.turnId)
  } catch (e) {
    error.value = AppError.from(e).message
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <div :class="$style.wrapper">
    <div :class="$style.subHeader">
      <span :class="$style.hint">
        <i class="ti ti-info-circle" />
        {{ i18n.ts._aiTurnPromptContent.hint }}
      </span>
      <button
        class="_button"
        :class="$style.btn"
        :disabled="!text"
        :title="copied ? i18n.ts._common.copiedToClipboard : i18n.ts._common.copy"
        @click="text && copyToClipboard(text)"
      >
        <i :class="copied ? 'ti ti-check' : 'ti ti-copy'" />
        {{ copied ? i18n.ts._common.copied : i18n.ts._common.copy }}
      </button>
    </div>

    <div :class="$style.body">
      <div v-if="isLoading" :class="$style.state">
        <LoadingSpinner />
      </div>
      <div v-else-if="error" :class="[$style.state, $style.error]">
        {{ error }}
      </div>
      <pre v-else-if="text" :class="$style.prompt">{{ text }}</pre>
      <div v-else :class="$style.state">
        {{ i18n.ts._aiTurnPromptContent.gone }}
      </div>
    </div>
  </div>
</template>

<style module lang="scss">
@use '@/styles/buttons' as *;
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
  font-size: var(--nd-font-xs);
  color: var(--nd-fg);
  opacity: 0.7;
  min-width: 0;
}

.btn {
  @include nd-interactive;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: var(--nd-font-xs);
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.7;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.prompt {
  margin: 0;
  font-family: var(--nd-font-mono);
  font-size: var(--nd-font-sm);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

.state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--nd-fg);
  opacity: 0.5;
  font-size: var(--nd-font-md);
  text-align: center;
}

.error {
  color: var(--nd-love);
  opacity: 1;
}
</style>
