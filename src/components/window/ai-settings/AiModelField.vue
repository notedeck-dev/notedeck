<script setup lang="ts">
import { computed } from 'vue'
import type { Connection } from '@/bindings'
import ChoiceCard from '@/components/common/ChoiceCard.vue'
import ChoiceCardGrid from '@/components/common/ChoiceCardGrid.vue'
import { useAiModelCandidates } from '@/composables/useAiModelCandidates'
import { i18n } from '@/i18n'

/**
 * 接続のモデル欄 (#880 / #1020 / #1321): 接続が返した候補のカード + 自由入力。
 * 書き先は呼び出し側 (`models[接続 id]`)。接続セクション (チャット) と HEARTBEAT
 * セクション (巡回の接続がチャットと違うとき) が共用する
 */
const props = defineProps<{
  connection: Connection
  modelValue: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const conn = computed(() => props.connection)
const { candidates, state } = useAiModelCandidates(conn)

const model = computed<string>({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})
</script>

<template>
  <p v-if="state === 'loading'" :class="$style.fieldHint">
    {{ i18n.ts._aiConnectionSection.modelCandidatesLoading }}
  </p>
  <template v-else-if="candidates && candidates.length > 0">
    <p :class="$style.fieldHint">{{ i18n.ts._aiConnectionSection.modelCandidates }}</p>
    <ChoiceCardGrid>
      <ChoiceCard
        v-for="m in candidates"
        :key="m"
        :label="m"
        :active="model === m"
        :title="m"
        icon="cube"
        @click="model = m"
      />
    </ChoiceCardGrid>
  </template>
  <p v-else-if="state === 'failed'" :class="$style.fieldHint">
    {{ i18n.ts._aiConnectionSection.modelCandidatesFailed }}
  </p>
  <input
    v-model="model"
    :class="$style.input"
    type="text"
    :placeholder="i18n.ts._aiConnectionSection.modelPlaceholder"
  />
</template>

<style lang="scss" module>
@use '@/styles/settingsFields' as *;
@use '@/styles/inputs' as *;

.fieldHint { @include field-hint; }

.input {
  @include input-base;
  width: 100%;
  font-size: var(--nd-font-sm);
}
</style>
