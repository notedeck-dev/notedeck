<script setup lang="ts">
/**
 * 本文の条件ビルダー (#1180)。フィルターパネルの 1 行として埋め込む。
 * 「いずれかを含む / すべてを含む / 除外する」の構造を正本として扱い、
 * 正規表現は生成しない。評価は面ごとに違う (クライアント検索は索引の条件、
 * サーバー検索は返ったページの手元照合)。
 *
 * 他の行と同じく、確定 (欄を離れた / Enter / 種別の切替 / 行の削除) で
 * 反映し、入力途中では反映しない。
 */
import { reactive, watch } from 'vue'
import { i18n } from '@/i18n'
import {
  parseConditionWords,
  type TextCondition,
  type TextConditionType,
} from '@/services/searchFilter'

const props = defineProps<{
  modelValue: TextCondition[]
  /** 外部からの検索語の差し替えで止まっている */
  paused?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [conditions: TextCondition[]]
}>()

interface Row {
  type: TextConditionType
  words: string
}

const rows = reactive<Row[]>([])

function loadRows(conditions: TextCondition[]) {
  rows.splice(
    0,
    rows.length,
    ...conditions.map((c) => ({ type: c.type, words: c.words.join(', ') })),
  )
  if (rows.length === 0) rows.push({ type: 'contains_any', words: '' })
}
loadRows(props.modelValue)
watch(() => props.modelValue, loadRows)

const conditionTypes: TextConditionType[] = [
  'contains_any',
  'contains_all',
  'excludes',
]

function conditionLabel(type: TextConditionType): string {
  switch (type) {
    case 'contains_any':
      return i18n.ts._conditionBuilder.containsAny
    case 'contains_all':
      return i18n.ts._conditionBuilder.containsAll
    case 'excludes':
      return i18n.ts._conditionBuilder.excludes
  }
}

function toConditions(): TextCondition[] {
  return rows
    .map((r) => ({ type: r.type, words: parseConditionWords(r.words) }))
    .filter((c) => c.words.length > 0)
}

function sameAs(a: TextCondition[], b: TextCondition[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 確定: 構造が変わったときだけ親へ渡す */
function commit() {
  const next = toConditions()
  if (!sameAs(next, props.modelValue)) emit('update:modelValue', next)
}

function cycleType(row: Row) {
  const i = conditionTypes.indexOf(row.type)
  const next = conditionTypes[(i + 1) % conditionTypes.length]
  if (next) row.type = next
  commit()
}

function addRow() {
  rows.push({ type: 'contains_any', words: '' })
}

function removeRow(index: number) {
  if (rows.length > 1) {
    rows.splice(index, 1)
  } else {
    const only = rows[0]
    if (only) only.words = ''
  }
  commit()
}
</script>

<template>
  <div :class="$style.builder">
    <div v-if="paused" :class="$style.paused">
      {{ i18n.ts._conditionBuilder.paused }}
    </div>
    <div v-for="(row, i) in rows" :key="i" :class="$style.row">
      <button class="_button" :class="$style.type" @click="cycleType(row)">
        {{ conditionLabel(row.type) }}
      </button>
      <input
        v-model="row.words"
        :class="$style.words"
        type="text"
        :placeholder="i18n.ts._conditionBuilder.wordsPlaceholder"
        @blur="commit"
        @keydown.enter.prevent="commit"
      />
      <button
        class="_button"
        :class="$style.remove"
        :title="i18n.ts._searchFilterPanel.remove"
        @click="removeRow(i)"
      >
        <i class="ti ti-x" />
      </button>
    </div>
    <button class="_button" :class="$style.addBtn" @click="addRow">
      <i class="ti ti-plus" />
      {{ i18n.ts._conditionBuilder.addCondition }}
    </button>
  </div>
</template>

<style lang="scss" module>
.builder {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.paused {
  padding: 4px 8px;
  border-radius: var(--nd-radius-sm);
  background: color-mix(in srgb, var(--nd-warn) 12%, transparent);
  color: var(--nd-warn);
  font-size: var(--nd-font-xs);
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.type {
  flex-shrink: 0;
  padding: 3px 8px;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  font-size: var(--nd-font-xs);
  white-space: nowrap;

  &:hover {
    background: var(--nd-buttonHoverBg);
  }
}

.words {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: none;
  border-radius: var(--nd-radius-sm);
  background: var(--nd-buttonBg);
  color: var(--nd-fg);
  font-size: var(--nd-font-sm);
  outline: none;

  &:focus {
    box-shadow: 0 0 0 2px var(--nd-accent);
  }
}

.remove {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: var(--nd-radius-sm);
  opacity: 0.5;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}

.addBtn {
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: var(--nd-radius-sm);
  font-size: var(--nd-font-xs);
  opacity: 0.6;

  &:hover {
    background: var(--nd-buttonHoverBg);
    opacity: 1;
  }
}
</style>
