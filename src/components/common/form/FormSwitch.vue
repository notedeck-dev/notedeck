<script setup lang="ts">
// オン / オフのスイッチ (#704 N)。role="switch" と aria-checked を持つ button。
// 行全体のクリックで切り替える画面でも二重に切り替わらないよう、
// 自分のクリックは親へ伝えない。
// decorative は「行そのものが role="switch"」のメニュー項目向けで、
// 見た目だけを描いて操作と読み上げは行に任せる。
const model = defineModel<boolean>({ required: true })

defineProps<{
  /** 読み上げ用の名前 (見えるラベルが別にあっても、ボタンに名前が無いので渡す) */
  label?: string
  disabled?: boolean
  decorative?: boolean
}>()
</script>

<template>
  <span
    v-if="decorative"
    :class="[$style.track, model && $style.on]"
    aria-hidden="true"
  >
    <span :class="$style.knob" />
  </span>
  <button
    v-else
    type="button"
    role="switch"
    :class="[$style.track, model && $style.on]"
    :aria-checked="model"
    :aria-label="label"
    :disabled="disabled"
    @click.stop="model = !model"
  >
    <span :class="$style.knob" />
  </button>
</template>

<style lang="scss" module>
.track {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--nd-radius-full);
  background: var(--nd-buttonBg, rgba(255, 255, 255, 0.1));
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--nd-duration-base);

  &:focus-visible {
    outline: 2px solid var(--nd-focusRing);
    outline-offset: 2px;
  }

  // 薄くするのは行の側 (FormSwitchRow 等) に任せる。ここでも薄くすると二重にかかる
  &:disabled {
    cursor: not-allowed;
  }
}

.on {
  background: var(--nd-accent, #86b300);
}

.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: translate var(--nd-duration-base) var(--nd-ease-spring);

  .on & {
    translate: 18px 0;
  }
}
</style>
