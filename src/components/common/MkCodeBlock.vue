<script setup lang="ts">
import { ref } from 'vue'
import { useClipboardFeedback } from '@/composables/useClipboardFeedback'
import { i18n } from '@/i18n'
import { highlightCode, highlightRevision } from '@/utils/highlight'

const props = defineProps<{
  code: string
  lang: string | null
}>()

const wrap = ref(false)
const { copied, copyToClipboard } = useClipboardFeedback()
</script>

<template>
  <div :class="[$style.root, wrap && $style.wrap]">
    <div :key="highlightRevision" :class="$style.body" v-html="highlightCode(props.code, props.lang)" />
    <div :class="$style.actions">
      <button
        type="button"
        class="_button"
        :class="[$style.action, wrap && $style.active]"
        :title="i18n.ts._mkMfm.wrapLines"
        :aria-label="i18n.ts._mkMfm.wrapLines"
        :aria-pressed="wrap"
        @click.stop="wrap = !wrap"
      >
        <i class="ti ti-text-wrap" />
      </button>
      <button
        type="button"
        class="_button"
        :class="$style.action"
        :title="copied ? i18n.ts._common.copiedToClipboard : i18n.ts._common.copyCode"
        :aria-label="copied ? i18n.ts._common.copiedToClipboard : i18n.ts._common.copyCode"
        @click.stop="copyToClipboard(props.code)"
      >
        <i :class="copied ? 'ti ti-check' : 'ti ti-copy'" />
      </button>
    </div>
  </div>
</template>

<style module lang="scss">
@use '@/styles/buttons' as *;
.root {
  position: relative;
  margin: 8px 0;
  max-width: 100%;
  overflow: hidden;

  &:hover .actions,
  &:focus-within .actions {
    opacity: 1;
  }
}

.body {
  // 面はハイライトの有無に関係なく揃える (明暗は data-nd-code-scheme の変数側 #1053)
  :global(pre) {
    font-family: var(--nd-font-mono);
    font-size: var(--nd-font-md);
    padding: 12px 16px;
    background: var(--nd-codeEditorBg);
    color: var(--nd-codeEditorFg);
    border-radius: var(--nd-radius-md);
    overflow-x: auto;
    white-space: pre;
    word-break: normal;
    margin: 0;
  }

  :global(pre code) {
    font-family: inherit;
  }
}

.wrap .body :global(pre) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 2px;
  opacity: 0;
  // 行の hover で出る子要素も nd-interactive と同じ時間で
  transition: opacity var(--nd-duration-base);

  // ホバーの無い端末では常に出す
  @media (hover: none) {
    opacity: 1;
  }
}

.action {
  @include nd-interactive;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--nd-radius-sm);
  font-size: var(--nd-font-md);
  color: var(--nd-codeEditorFgMuted);
  background: var(--nd-codeEditorPanelBg);

  &:hover {
    color: var(--nd-codeEditorFg);
  }

  &.active {
    color: var(--nd-accentText);
  }
}
</style>
