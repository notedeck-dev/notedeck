<script setup lang="ts">
/**
 * TutorialContent — /tutorial コマンドの window content (= DeckWindow に乗る本体)。
 *
 * 設計判断:
 * - 旧 GuideOverlay は固定 position の floating card だったが、他の補助 UI
 *   (settings / login / about 等) と paradigm 統一して **window content**
 *   として再実装。移動・リサイズ・最前面トグルは window 機能を継承
 * - store (useTutorial) が state machine、本コンポーネントは pure 表示
 * - 進捗を dots bar で可視化 (Misskey本家 MkTutorial の chapter 構造を参考)
 */

import { computed } from 'vue'
import { useTutorialStore } from '@/composables/useTutorial'

const tutorial = useTutorialStore()

const stepCount = computed(() => tutorial.totalSteps)
const stepIndex = computed(() => tutorial.currentNumber)
</script>

<template>
  <div :class="$style.root" aria-live="polite">
    <!-- Progress dots (上部) — チュートリアルの chapter 構造を可視化。
         ドットをクリックで該当 step に移動できる (= 既設定済みでも前後 step
         を見直し可能。precheck=skip も手動ジャンプは許可) -->
    <div
      :class="$style.progress"
      role="tablist"
      :aria-label="`チュートリアル ${stepIndex} / ${stepCount}`"
    >
      <button
        v-for="i in stepCount"
        :key="i"
        type="button"
        class="_button"
        :class="[
          $style.dot,
          { [$style.dotActive]: i === stepIndex, [$style.dotDone]: i < stepIndex },
        ]"
        role="tab"
        :aria-selected="i === stepIndex"
        :aria-label="`Step ${i}`"
        @click="tutorial.goToStep(i - 1)"
      />
      <span :class="$style.progressLabel">{{ stepIndex }} / {{ stepCount }}</span>
    </div>

    <!-- Body (step タイトル + 説明) -->
    <div v-if="tutorial.currentStep" :class="$style.body">
      <div :class="$style.title">{{ tutorial.currentStep.title }}</div>
      <p :class="$style.description">{{ tutorial.currentStep.description }}</p>
    </div>

    <!-- Footer actions -->
    <div :class="$style.actions">
      <template v-if="tutorial.currentStep?.isFinal">
        <button
          type="button"
          class="_button"
          :class="$style.primaryBtn"
          @click="tutorial.finish()"
        >
          閉じる
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="_button"
          :class="$style.linkBtn"
          @click="tutorial.skip()"
        >
          スキップ
        </button>
        <button
          type="button"
          class="_button"
          :class="$style.primaryBtn"
          @click="tutorial.next()"
        >
          次へ →
        </button>
      </template>
    </div>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  padding: 16px 18px 12px;
  gap: 16px;
  color: var(--nd-fg);
  font-size: 0.92em;
}

/* Progress dots bar — Misskey本家 MkTutorial / VSCode walkthrough 風 */
.progress {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--nd-divider);
}

.dot {
  width: 14px;
  height: 14px;
  padding: 3px;
  border-radius: 50%;
  cursor: pointer;
  background: transparent;
  // 内側の丸: ::after で描画。クリック領域 (14px) を確保しつつ、見た目は小さく。
  position: relative;
  transition: transform 0.15s ease;

  &::after {
    content: '';
    position: absolute;
    inset: 3px;
    border-radius: 50%;
    background: var(--nd-fg);
    opacity: 0.18;
    transition: opacity 0.2s ease, background 0.2s ease;
  }

  &:hover {
    transform: scale(1.15);
    &::after {
      opacity: 0.45;
    }
  }
}

.dotDone::after {
  background: var(--nd-accent);
  opacity: 0.5;
}

.dotActive {
  &::after {
    background: var(--nd-accent);
    opacity: 1;
  }
  transform: scale(1.2);
}

.progressLabel {
  margin-left: auto;
  font-size: 0.8em;
  opacity: 0.55;
  letter-spacing: 0.04em;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.title {
  font-weight: 600;
  font-size: 1.1em;
  color: var(--nd-fgHighlighted);
}

.description {
  margin: 0;
  line-height: 1.6;
  opacity: 0.88;
  white-space: pre-line;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--nd-divider);
}

.linkBtn {
  padding: 6px 12px;
  font-size: 0.9em;
  border-radius: 6px;
  color: var(--nd-fg);
  opacity: 0.7;
  cursor: pointer;
  transition: opacity 0.15s ease, background 0.15s ease;

  &:hover {
    opacity: 1;
    background: var(--nd-buttonHoverBg);
  }
}

.primaryBtn {
  padding: 6px 16px;
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
