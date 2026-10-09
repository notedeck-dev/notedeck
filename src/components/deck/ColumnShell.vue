<script lang="ts">
import type { InjectionKey, Ref } from 'vue'

/** 画面外で破棄したカラムの先頭数行 (DeckStackCell が provide する) */
export const COLUMN_SHELL_PREVIEW: InjectionKey<Ref<string[]>> =
  Symbol('columnShellPreview')
</script>

<script setup lang="ts">
// カラム本体が描けるまでの仮の枠。未マウント (画面外) と、カラムの
// チャンク読み込み中 (defineAsyncComponent の loadingComponent) の両方で
// 同じものを出し、枠 → 空白 → 本体の段差を作らない
import { inject, ref } from 'vue'

const preview = inject(COLUMN_SHELL_PREVIEW, ref<string[]>([]))
</script>

<template>
  <div :class="$style.shell" aria-hidden="true">
    <div :class="$style.header" />
    <div :class="$style.body">
      <template v-if="preview.length > 0">
        <div
          v-for="(line, i) in preview"
          :key="i"
          :class="$style.preview"
        >{{ line || '\u00A0' }}</div>
      </template>
      <template v-else>
        <div :class="$style.line" />
        <div :class="[$style.line, $style.lineWide]" />
        <div :class="$style.card" />
        <div :class="$style.card" />
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
.shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: var(--nd-radius-lg);
  overflow: hidden;
  background: color-mix(in srgb, var(--nd-panel) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--nd-divider, currentColor) 30%, transparent);
}

.header {
  height: 38px;
  flex-shrink: 0;
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--nd-panelHeaderBg, var(--nd-panel)) 85%, transparent),
      color-mix(in srgb, var(--nd-panelHeaderBg, var(--nd-panel)) 60%, transparent),
      color-mix(in srgb, var(--nd-panelHeaderBg, var(--nd-panel)) 85%, transparent)
    );
  background-size: 200% 100%;
  animation: nd-shell-shimmer 1.6s linear infinite;
}

.body {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.line,
.card {
  background:
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--nd-panel) 75%, transparent),
      color-mix(in srgb, var(--nd-panel) 55%, transparent),
      color-mix(in srgb, var(--nd-panel) 75%, transparent)
    );
  background-size: 200% 100%;
  animation: nd-shell-shimmer 1.6s linear infinite;
}

.line {
  height: 10px;
  border-radius: var(--nd-radius-full);
  width: 58%;
}

.lineWide {
  width: 82%;
}

.card {
  height: 96px;
  border-radius: var(--nd-radius);
}

@keyframes nd-shell-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}

.preview {
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--nd-fg);
  opacity: 0.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid color-mix(in srgb, var(--nd-divider, currentColor) 15%, transparent);
}
</style>
