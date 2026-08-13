<script setup lang="ts">
/**
 * アカウント選択の 1 行 (#1018)。
 *
 * 正本はナビバーのアカウント一覧の見た目 — アバター (サーバーバッジ付き) +
 * ラベル + 次段がある場合の chevron。ノートの「別のアカウントで…」/ ウィジェット
 * の実行アカウント選択 / カラム追加のアカウント選択がそれぞれ別の見た目だった
 * のを、この行に揃える。
 *
 * アバターは slot — ナビバーのオンライン状態インジケータのように、面ごとに
 * 重ねたいものがあるため。省略時は呼び出し側が AccountAvatar を渡す。
 */
defineProps<{
  label: string
  /** 選択中 / 展開中の行を示す */
  active?: boolean
  /** この行を選ぶと次の段がある (chevron を出す) */
  hasNext?: boolean
  disabled?: boolean
}>()
</script>

<template>
  <button
    class="_button"
    :class="[$style.row, active && $style.rowActive]"
    :disabled="disabled"
  >
    <slot name="avatar" />
    <span :class="$style.label">{{ label }}</span>
    <slot name="trailing">
      <i v-if="hasNext" class="ti ti-chevron-right" :class="$style.chevron" />
    </slot>
  </button>
</template>

<style lang="scss" module>
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  min-height: 44px;
  width: 100%;
  font-size: 0.85em;
  color: var(--nd-fg);
  white-space: nowrap;
  text-align: left;
  cursor: pointer;
  transition: background var(--nd-duration-fast);

  &:hover {
    background: var(--nd-buttonHoverBg);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.rowActive {
  background: var(--nd-buttonHoverBg);
  color: var(--nd-fgHighlighted);
}

.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chevron {
  margin-left: auto;
  font-size: 0.75em;
  opacity: 0.4;
  flex-shrink: 0;
}
</style>
