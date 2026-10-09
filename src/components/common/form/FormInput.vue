<script setup lang="ts">
// 1 行 / 複数行のテキスト入力欄 (#704 B / N)。見た目は _inputs.scss の input-base。
// error を渡すと欄の直下にエラー文を出し、aria-invalid と aria-describedby で欄と結ぶ。
// いつ error を渡すか (送信を押した後 / 欄を離れた後) は呼び出し側が決める。
// class / style は外枠に、それ以外の属性 (type / placeholder / autocomplete / @keydown 等) は
// input (multiline なら textarea) に渡る。
import { ref, useAttrs, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })

defineProps<{
  error?: string
  multiline?: boolean
  /** 大きい欄 (ログインのサーバー入力など、画面の主役になる 1 欄) */
  large?: boolean
}>()

const attrs = useAttrs()
function fieldAttrs() {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
}

const errorId = useId()
const fieldRef = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)

defineExpose({
  focus: () => fieldRef.value?.focus(),
})
</script>

<template>
  <div :class="[$style.root, attrs.class]" :style="attrs.style as never">
    <textarea
      v-if="multiline"
      ref="fieldRef"
      v-bind="fieldAttrs()"
      v-model="model"
      :class="[$style.field, $style.textarea]"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="error ? errorId : undefined"
    />
    <input
      v-else
      ref="fieldRef"
      type="text"
      v-bind="fieldAttrs()"
      v-model="model"
      :class="[$style.field, large && $style.large]"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="error ? errorId : undefined"
    />
    <p v-if="error" :id="errorId" :class="$style.error">
      <i class="ti ti-alert-circle" />{{ error }}
    </p>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/inputs' as *;

.root {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field {
  @include input-base;
  width: 100%;
  padding: 8px 10px;
}

.textarea {
  resize: vertical;
  line-height: 1.5;
}

.large {
  height: 42px;
  padding: 0 14px;
  border-radius: var(--nd-radius-md);
  font-size: 1em;
}

.error {
  @include input-error;

  i {
    flex-shrink: 0;
    margin-top: 1px;
  }
}
</style>
