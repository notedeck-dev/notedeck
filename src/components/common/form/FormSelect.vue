<script setup lang="ts" generic="T">
// セレクト (#704 N)。素のネイティブ select は WebKitGTK で古いフォームの見た目になるので、
// appearance を外して他の入力欄と同じ枠・テーマ色にし、シェブロンを自前で描く。
// 開いたときの選択 UI はネイティブのまま (キーボード・スクリーンリーダー・モバイルの
// ピッカーをそのまま使うため)。<option> は slot で渡し、値の型は v-model がそのまま保つ。
// class / style は外枠に、それ以外の属性 (disabled / title / @change 等) は select に渡る。
import { useAttrs } from 'vue'

defineOptions({ inheritAttrs: false })

const model = defineModel<T>({ required: true })

defineProps<{
  /** 読み上げ用の名前 (見えるラベルが label 要素で結ばれていない画面向け) */
  label?: string
  /** 枠なしの塗り。検索の絞り込みや投票のように、隣の欄も塗りで描く詰まった面に置くとき */
  filled?: boolean
}>()

const attrs = useAttrs()
function selectAttrs() {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
}
</script>

<template>
  <span :class="[$style.root, attrs.class]" :style="attrs.style as never">
    <select
      v-bind="selectAttrs()"
      v-model="model"
      :class="[$style.select, filled && $style.filled]"
      :aria-label="label"
    >
      <slot />
    </select>
    <i class="ti ti-chevron-down" :class="$style.chevron" aria-hidden="true" />
  </span>
</template>

<style lang="scss" module>
@use '@/styles/inputs' as *;

.root {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.select {
  @include input-base;
  appearance: none;
  width: 100%;
  min-width: 0;
  padding: 6px 28px 6px 10px;
  cursor: pointer;
  text-overflow: ellipsis;

  option,
  optgroup {
    background: var(--nd-panel);
    color: var(--nd-fg);
  }
}

.filled {
  padding: 4px 24px 4px 6px;
  border-color: transparent;
  background: var(--nd-buttonBg);

  &:focus {
    border-color: transparent;
    box-shadow: 0 0 0 2px var(--nd-accent);
  }
}

.chevron {
  position: absolute;
  top: 50%;
  right: 8px;
  translate: 0 -50%;
  font-size: var(--nd-font-sm);
  opacity: 0.6;
  pointer-events: none;
}
</style>
