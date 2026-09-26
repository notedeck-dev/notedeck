<script setup lang="ts">
import { computed } from 'vue'
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
      {{ i18n.ts._aiGenerationSection.note }}
    </p>

    <div :class="$style.field">
      <div :class="$style.fieldHeader">
        <span :class="$style.fieldLabel">{{ i18n.ts._aiGenerationSection.maxTokens }}</span>
        <div :class="$style.fieldValue">
          <input
            v-model.number="config.generation.maxTokens"
            type="number"
            :min="AI_MAX_TOKENS_MIN"
            :max="AI_MAX_TOKENS_MAX"
            :class="$style.numberInput"
            @change="commit"
          />
          <span :class="$style.fieldUnit">token</span>
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
          <input
            v-model.number="config.generation.maxToolRounds"
            type="number"
            :min="AI_MAX_TOOL_ROUNDS_MIN"
            :max="AI_MAX_TOOL_ROUNDS_MAX"
            :class="$style.numberInput"
            @change="commit"
          />
          <span :class="$style.fieldUnit">{{ i18n.ts._aiGenerationSection.rounds }}</span>
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
          <input
            v-model.number="config.generation.titleMaxTokens"
            type="number"
            :min="AI_TITLE_MAX_TOKENS_MIN"
            :max="AI_TITLE_MAX_TOKENS_MAX"
            :class="$style.numberInput"
            @change="commit"
          />
          <span :class="$style.fieldUnit">token</span>
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
          <input
            v-model.number="config.generation.readTimeoutSeconds"
            type="number"
            :min="AI_READ_TIMEOUT_MIN_SECONDS"
            :max="AI_READ_TIMEOUT_MAX_SECONDS"
            :class="$style.numberInput"
            @change="commit"
          />
          <span :class="$style.fieldUnit">{{ i18n.ts._aiGenerationSection.seconds }}</span>
        </div>
      </div>
      <p :class="$style.fieldHint">
        {{ i18n.ts._aiGenerationSection.readTimeoutHint }}
      </p>
    </div>
  </AiSettingsSection>
</template>

<style lang="scss" module>
// 数値入力のレイアウトは AiHeartbeatSection と揃える
// (label 左 / [input] [単位] 右の 1 行 + 下に補足)
.note {
  margin: 0;
  font-size: 0.75em;
  opacity: 0.6;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.fieldHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fieldLabel {
  font-size: 0.85em;
}

.fieldValue {
  display: flex;
  align-items: center;
  gap: 4px;
}

.fieldHint {
  margin: 0;
  font-size: 0.7em;
  opacity: 0.5;
  line-height: 1.5;
}

.numberInput {
  width: 72px;
  padding: 2px 4px;
  border: 1px solid var(--nd-divider);
  border-radius: var(--nd-radius-sm);
  background: var(--nd-bg);
  color: var(--nd-fg);
  font-size: 0.85em;
  text-align: right;
  outline: none;
  transition: border-color var(--nd-duration-base);

  &:focus {
    border-color: var(--nd-accent);
  }

  // spinner 矢印は隠す (AiHeartbeatSection と同じ)
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  -moz-appearance: textfield;
}

.fieldUnit {
  font-size: 0.8em;
  opacity: 0.55;
  min-width: 18px;
}
</style>
