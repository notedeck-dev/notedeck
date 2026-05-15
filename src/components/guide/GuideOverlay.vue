<script setup lang="ts">
/**
 * GuideOverlay — /guide コマンドが表示する右上フローティングカード。
 *
 * 設計:
 * - position: fixed; top-right。背景 UI をブロックしないので、ユーザーは
 *   並行して右側の window (login / connections) を埋められる
 * - useGuideStore.active が true のとき mount される
 * - Escape で確認ダイアログ経由でキャンセル可
 * - aria-live="polite" で step タイトル変化を SR が読み上げる
 * - reduced-motion 配慮済み
 */

import { onMounted, onUnmounted } from 'vue'
import { useGuideStore } from '@/composables/useGuide'
import { useConfirm } from '@/stores/confirm'

const guide = useGuideStore()
const confirm = useConfirm()

async function onCancelClicked(): Promise<void> {
  const ok = await confirm.confirm({
    title: 'ガイドをやめますか?',
    message: 'いつでもコマンドパレットから「ガイド」を選んで再開できます。',
    okLabel: 'やめる',
    cancelLabel: '続ける',
  })
  if (ok) guide.cancel()
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  if (!guide.active) return
  e.stopPropagation()
  e.preventDefault()
  void onCancelClicked()
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown, { capture: true })
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown, { capture: true } as never)
})
</script>

<template>
  <div
    v-if="guide.active && guide.currentStep"
    :class="$style.overlay"
    role="dialog"
    aria-modal="false"
    :aria-label="`ガイド ${guide.currentNumber} / ${guide.totalSteps}: ${guide.currentStep.title}`"
  >
    <div :class="$style.header">
      <span :class="$style.progress">
        ガイド {{ guide.currentNumber }} / {{ guide.totalSteps }}
      </span>
      <button
        type="button"
        class="_button"
        :class="$style.closeBtn"
        title="やめる"
        aria-label="ガイドをやめる"
        @click="onCancelClicked"
      >
        <i class="ti ti-x" />
      </button>
    </div>

    <div :class="$style.body" aria-live="polite">
      <div :class="$style.title">{{ guide.currentStep.title }}</div>
      <p :class="$style.description">{{ guide.currentStep.description }}</p>
    </div>

    <div :class="$style.actions">
      <template v-if="guide.currentStep.isFinal">
        <button
          type="button"
          class="_button"
          :class="$style.primaryBtn"
          @click="guide.finish()"
        >
          閉じる
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="_button"
          :class="$style.linkBtn"
          @click="guide.skip()"
        >
          スキップ
        </button>
        <button
          type="button"
          class="_button"
          :class="$style.primaryBtn"
          @click="guide.next()"
        >
          次へ
        </button>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
.overlay {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 320px;
  z-index: 9000;
  background: var(--nd-panel);
  border: 1px solid var(--nd-divider);
  border-radius: 12px;
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.18),
    0 0 0 1px rgba(170, 30, 30, 0.45);
  color: var(--nd-fg);
  font-size: 0.9em;
  animation: guideAppear 0.25s ease-out 1 forwards;
}

@media (prefers-reduced-motion: reduce) {
  .overlay {
    animation: none;
  }
}

@keyframes guideAppear {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--nd-divider);
}

.progress {
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.6;
  letter-spacing: 0.05em;
}

.closeBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--nd-fg);
  opacity: 0.6;
  cursor: pointer;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.body {
  padding: 12px 14px;
}

.title {
  font-weight: 600;
  font-size: 1.05em;
  margin-bottom: 8px;
}

.description {
  margin: 0;
  line-height: 1.55;
  color: var(--nd-fg);
  opacity: 0.85;
  white-space: pre-line;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--nd-divider);
}

.linkBtn {
  padding: 6px 10px;
  font-size: 0.9em;
  border-radius: 6px;
  color: var(--nd-fg);
  opacity: 0.7;
  cursor: pointer;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.primaryBtn {
  padding: 6px 14px;
  font-size: 0.9em;
  font-weight: 600;
  border-radius: 6px;
  background: var(--nd-accent);
  color: var(--nd-fgOnAccent, #fff);
  cursor: pointer;
  transition: filter 0.15s ease;

  &:hover {
    filter: brightness(1.08);
  }
}
</style>
