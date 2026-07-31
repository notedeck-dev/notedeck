<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  buildRegexFromConditions,
  FILTER_CONDITION_LABELS,
  type FilterCondition,
  type FilterConditionType,
} from '@/utils/regexSearch'

const emit = defineEmits<{
  select: [pattern: string]
}>()

const conditions = reactive<FilterCondition[]>([
  { type: 'contains_any', words: '' },
])

const conditionTypes: FilterConditionType[] = [
  'contains_any',
  'contains_all',
  'excludes',
]

function cycleType(cond: FilterCondition) {
  const i = conditionTypes.indexOf(cond.type)
  const next = conditionTypes[(i + 1) % conditionTypes.length]
  if (next) cond.type = next
}

function addCondition() {
  conditions.push({ type: 'contains_any', words: '' })
}

function removeCondition(index: number) {
  if (conditions.length > 1) conditions.splice(index, 1)
}

const generatedPattern = computed(() => buildRegexFromConditions(conditions))
const hasWords = computed(() => conditions.some((c) => c.words.trim()))

function apply() {
  const pattern = generatedPattern.value
  if (pattern) emit('select', pattern)
}
</script>

<template>
  <div :class="$style.filterBuilder" class="_popup" @click.stop>
    <div :class="$style.builderHeader">フィルタ条件</div>

    <div :class="$style.conditions">
      <div v-for="(cond, i) in conditions" :key="i" :class="$style.conditionRow">
        <button class="_button" :class="$style.conditionType" @click="cycleType(cond)">
          {{ FILTER_CONDITION_LABELS[cond.type] }}
        </button>
        <input
          v-model="cond.words"
          :class="$style.conditionWords"
          type="text"
          placeholder="カンマ区切りで単語を入力"
          @keydown.enter="apply"
        />
        <button
          v-if="conditions.length > 1"
          class="_button"
          :class="$style.conditionRemove"
          @click="removeCondition(i)"
        >
          <i class="ti ti-x" />
        </button>
      </div>
    </div>

    <div :class="$style.builderFooter">
      <button class="_button" :class="$style.addBtn" @click="addCondition">
        <i class="ti ti-plus" />
        条件を追加
      </button>
      <button
        class="_button"
        :class="$style.applyBtn"
        :disabled="!hasWords"
        @click="apply"
      >
        適用
      </button>
    </div>

    <div v-if="generatedPattern" :class="$style.patternPreview">
      <code>{{ generatedPattern }}</code>
    </div>
  </div>
</template>

<style lang="scss" module>
.filterBuilder {
  width: 320px;
  max-height: 400px;
  overflow-y: auto;
  padding: 8px 0;
  font-size: 0.9em;
  color: var(--nd-fg);
  scrollbar-width: thin;
  scrollbar-color: var(--nd-scrollbarHandle) transparent;
}

.builderHeader {
  padding: 8px 14px 4px;
  font-size: 0.75em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.5;
}

.conditions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 10px;
}

.conditionRow {
  display: flex;
  align-items: center;
  gap: 4px;
}

.conditionType {
  flex-shrink: 0;
  padding: 5px 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg, rgba(255, 255, 255, 0.05));
  color: var(--nd-fg);
  font-size: 0.8em;
  white-space: nowrap;
  transition: background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg, rgba(255, 255, 255, 0.1));
  }
}

.conditionWords {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg, rgba(255, 255, 255, 0.05));
  color: var(--nd-fg);
  font-size: 0.85em;
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.3;
  }
}

.conditionRemove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--nd-radius-sm);
  flex-shrink: 0;
  opacity: 0.3;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg, rgba(255, 255, 255, 0.1));
    opacity: 0.7;
  }
}

.builderFooter {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 4px;
}

.addBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--nd-radius-sm);
  font-size: 0.8em;
  opacity: 0.45;
  transition: opacity var(--nd-duration-base), background var(--nd-duration-base);

  &:hover {
    background: var(--nd-buttonHoverBg, rgba(255, 255, 255, 0.1));
    opacity: 0.8;
  }
}

.applyBtn {
  padding: 5px 14px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-accent);
  color: #fff;
  font-size: 0.8em;
  font-weight: 600;
  transition: opacity var(--nd-duration-base);

  &:hover:not(:disabled) {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.25;
  }
}

.patternPreview {
  margin: 4px 10px 4px;
  padding: 5px 8px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-accent) 8%, transparent);
  overflow-x: auto;
  scrollbar-width: none;

  code {
    font-family: var(--nd-font-mono);
    font-size: 0.75em;
    color: var(--nd-accent);
    word-break: break-all;
  }
}
</style>
