<script setup lang="ts">
import { computed } from 'vue'
import FormNumber from '@/components/common/form/FormNumber.vue'
import {
  AI_MAX_TOKENS_MAX,
  AI_MAX_TOKENS_MIN,
  AI_MAX_TOOL_ROUNDS_MAX,
  AI_MAX_TOOL_ROUNDS_MIN,
  AI_READ_TIMEOUT_MAX_SECONDS,
  AI_READ_TIMEOUT_MIN_SECONDS,
  AI_TITLE_MAX_TOKENS_MAX,
  AI_TITLE_MAX_TOKENS_MIN,
  defaultConfig,
  normalizeGenerationConfig,
  useAiConfig,
} from '@/composables/useAiConfig'
import { i18n } from '@/i18n'
import AiSettingsSection from './AiSettingsSection.vue'

const { config } = useAiConfig()

const defaults = defaultConfig().generation

/**
 * 入力を確定した時点で許容範囲へ丸め、空欄は既定値に戻す。
 *
 * 入力中に丸めると 15 を打とうとした 1 が最小値へ飛ぶので、`@change`
 * (blur / Enter) だけで走らせる。リクエスト側も使う直前に同じ正規化を通すので、
 * 入力途中の値がそのまま AI に渡ることはない。
 */
function commit(): void {
  config.value.generation = normalizeGenerationConfig(config.value.generation)
}

/**
 * 既定から動かしているかどうかだけをヘッダーに出す。個々の値は開かないと
 * 見えないので、「触った覚えのない値が効いている」状態に気付けるようにする。
 */
const changed = computed(() =>
  (Object.keys(defaults) as (keyof typeof defaults)[]).some(
    (k) => config.value.generation[k] !== defaults[k],
  ),
)
</script>

<template>
  <AiSettingsSection
    icon="ti-adjustments"
    :title="i18n.ts._aiGenerationSection.title"
    :badge="changed ? i18n.ts._aiGenerationSection.changedFromDefault : i18n.ts._common.default"
    :badge-ok="changed"
  >
    <p :class="$style.note">
      <i class="ti ti-info-circle" />
      {{ i18n.ts._aiGenerationSection.note }}
    </p>

    <div :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiGenerationSection.maxTokens }}</span>
        <div :class="$style.fieldValue">
          <FormNumber
            v-model="config.generation.maxTokens"
            :min="AI_MAX_TOKENS_MIN"
            :max="AI_MAX_TOKENS_MAX"
            unit="token"
            @change="commit"
          />
        </div>
      </div>
      <p :class="$style.fieldHint">
        {{ i18n.tsx._aiGenerationSection.maxTokensHint({ maxTokens: defaults.maxTokens }) }}
      </p>
    </div>

    <div :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiGenerationSection.maxToolRounds }}</span>
        <div :class="$style.fieldValue">
          <FormNumber
            v-model="config.generation.maxToolRounds"
            :min="AI_MAX_TOOL_ROUNDS_MIN"
            :max="AI_MAX_TOOL_ROUNDS_MAX"
            :unit="i18n.ts._aiGenerationSection.rounds"
            @change="commit"
          />
        </div>
      </div>
      <p :class="$style.fieldHint">
        {{ i18n.ts._aiGenerationSection.maxToolRoundsHint }}
      </p>
    </div>

    <div :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiGenerationSection.titleMaxTokens }}</span>
        <div :class="$style.fieldValue">
          <FormNumber
            v-model="config.generation.titleMaxTokens"
            :min="AI_TITLE_MAX_TOKENS_MIN"
            :max="AI_TITLE_MAX_TOKENS_MAX"
            unit="token"
            @change="commit"
          />
        </div>
      </div>
      <p :class="$style.fieldHint">
        {{ i18n.ts._aiGenerationSection.titleMaxTokensHint }}
      </p>
    </div>

    <div :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiGenerationSection.readTimeout }}</span>
        <div :class="$style.fieldValue">
          <FormNumber
            v-model="config.generation.readTimeoutSeconds"
            :min="AI_READ_TIMEOUT_MIN_SECONDS"
            :max="AI_READ_TIMEOUT_MAX_SECONDS"
            :unit="i18n.ts._aiGenerationSection.seconds"
            @change="commit"
          />
        </div>
      </div>
      <p :class="$style.fieldHint">
        {{ i18n.ts._aiGenerationSection.readTimeoutHint }}
      </p>
    </div>
  </AiSettingsSection>
</template>

<style lang="scss" module>
@use '@/styles/settingsFields' as *;

.note { @include key-hint; }
.field { @include field; }
.fieldHeader { @include field-header; }
.fieldLabel { @include field-label; }
.fieldValue { @include field-value; }
.fieldHint { @include field-hint; }
</style>
