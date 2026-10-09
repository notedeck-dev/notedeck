<script setup lang="ts">
// 数値 + 単位の入力欄 (#704 N)。設定画面の「ラベル … [ 120 ] 分」の右側。
// 範囲外・空欄はその場でエラー文を出し、v-model には流さない (直前の正しい値が残る)。
// 空欄に意味がある欄 (「0 = 無制限」等) は emptyValue でその値を流す。
// type="number" の他の属性 (title / @change 等) は input にそのまま渡る。
import { computed, ref, useAttrs, useId, watch } from 'vue'
import { i18n } from '@/i18n'

defineOptions({ inheritAttrs: false })

const model = defineModel<number>({ required: true })

const props = defineProps<{
  min?: number
  max?: number
  step?: number
  unit?: string
  /** 読み上げ用の名前 (見えるラベルが離れた場所にある画面向け) */
  label?: string
  disabled?: boolean
  emptyValue?: number
  /** 呼び出し側の検査で見つかった誤り。自前の範囲検査より優先して出す */
  error?: string
}>()

const attrs = useAttrs()
// class / style は外枠に、それ以外 (title / @change 等) は input に渡す
function inputAttrs() {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
}

const ownError = ref('')
const errorId = useId()
const message = computed(() => props.error || ownError.value)

// 外から値が変わった (リセット等) ら、打ちかけの誤りは消す
watch(model, () => {
  ownError.value = ''
})

function rangeMessage(): string {
  const { min, max } = props
  if (min != null && max != null)
    return i18n.tsx._formNumber.outOfRange({ min, max })
  if (min != null) return i18n.tsx._formNumber.tooSmall({ min })
  return i18n.tsx._formNumber.tooLarge({ max: max as number })
}

function onInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value.trim()
  if (raw === '') {
    if (props.emptyValue == null) {
      ownError.value = i18n.ts._formNumber.notNumber
      return
    }
    ownError.value = ''
    model.value = props.emptyValue
    return
  }
  const n = Number(raw)
  if (!Number.isFinite(n)) {
    ownError.value = i18n.ts._formNumber.notNumber
    return
  }
  if (
    (props.min != null && n < props.min) ||
    (props.max != null && n > props.max)
  ) {
    ownError.value = rangeMessage()
    return
  }
  ownError.value = ''
  model.value = n
}
</script>

<template>
  <span :class="[$style.root, attrs.class]" :style="attrs.style as never">
    <input
      v-bind="inputAttrs()"
      type="number"
      inputmode="decimal"
      :class="$style.input"
      :value="model"
      :min="min"
      :max="max"
      :step="step"
      :disabled="disabled"
      :aria-label="label"
      :aria-invalid="message ? true : undefined"
      :aria-describedby="message ? errorId : undefined"
      @input="onInput"
    />
    <span v-if="unit" :class="$style.unit">{{ unit }}</span>
    <span v-if="message" :id="errorId" :class="$style.error">
      <i class="ti ti-alert-circle" />{{ message }}
    </span>
  </span>
</template>

<style lang="scss" module>
@use '@/styles/inputs' as *;

.root {
  display: inline-grid;
  grid-template-columns: auto auto;
  align-items: center;
  column-gap: 4px;
  row-gap: 2px;
}

.input {
  @include input-base;
  width: 72px;
  padding: 2px 4px;
  text-align: right;

  // spinner 矢印は隠す (hover でも醜くならないように)
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  -moz-appearance: textfield;
}

.unit {
  font-size: var(--nd-font-sm);
  opacity: 0.55;
  min-width: 18px;
}

.error {
  @include input-error;
  grid-column: 1 / -1;
  justify-self: end;
  max-width: 20em;
  text-align: right;
}
</style>
