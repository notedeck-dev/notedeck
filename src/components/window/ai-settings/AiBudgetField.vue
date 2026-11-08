<script setup lang="ts">
import { computed } from 'vue'
import FormNumber from '@/components/common/form/FormNumber.vue'
import { useAiConfig } from '@/composables/useAiConfig'
import { i18n } from '@/i18n'

/**
 * 接続ごとの 1 日の token 予算 (#1133 / #1321)。書き先は `budgets[接続 id]` (0 = 無制限)。
 * 予算は接続の勘定で、その接続を使うすべての用途 (チャット / HEARTBEAT) の合計。接続
 * セクション (チャットの接続) と HEARTBEAT セクション (巡回の接続がチャットと違い、
 * ローカルでないとき) が共用する
 */
const props = defineProps<{
  connectionId: string
  label?: string
}>()

const { config } = useAiConfig()

const budget = computed<number>({
  get: () => config.value.budgets[props.connectionId] ?? 0,
  set: (v) => {
    const id = props.connectionId
    if (!id) return
    const n = Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
    const next = { ...config.value.budgets }
    if (n === 0) delete next[id]
    else next[id] = n
    config.value.budgets = next
  },
})
</script>

<template>
  <div :class="$style.field">
    <div :class="$style.fieldHeader">
      <span :class="$style.fieldLabel">{{ label ?? i18n.ts._aiConnectionSection.dailyTokenBudget }}</span>
      <div :class="$style.fieldValue">
        <FormNumber
          v-model="budget"
          :min="0"
          :step="1000"
          :empty-value="0"
          :unit="i18n.ts._aiConnectionSection.tokensPerDay"
        />
      </div>
    </div>
    <p :class="$style.fieldHint">{{ i18n.ts._aiConnectionSection.dailyTokenBudgetHint }}</p>
  </div>
</template>

<style lang="scss" module>
@use '@/styles/settingsFields' as *;

.field { @include field; }
.fieldHeader { @include field-header; }
.fieldLabel { @include field-label; }
.fieldValue { @include field-value; }
.fieldHint { @include field-hint; }
</style>
