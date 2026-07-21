<script setup lang="ts">
import { ref, watch } from 'vue'

/**
 * 投稿フォームのアンケート編集ブロック (#707 MkPostForm 分割)。
 * choices は usePostFormState の pollChoices と同一参照で、入力は
 * in-place 更新、増減は add / remove emit で親の state 操作に委ねる。
 */
const props = defineProps<{
  choices: string[]
}>()

const multiple = defineModel<boolean>('multiple', { required: true })
// 期限 (#753): expiredAfter = 期間 (ms、送信時に絶対時刻へ変換)、
// expiresAt = 日時指定 (epoch ms)。どちらか一方のみ非 null。
const expiresAt = defineModel<number | null>('expiresAt', { required: true })
const expiredAfter = defineModel<number | null>('expiredAfter', {
  required: true,
})

const emit = defineEmits<{
  add: []
  remove: [index: number]
}>()

const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const expiryPresets = [
  { label: '30分', ms: 30 * MINUTE },
  { label: '1時間', ms: HOUR },
  { label: '6時間', ms: 6 * HOUR },
  { label: '1日', ms: DAY },
  { label: '3日', ms: 3 * DAY },
  { label: '7日', ms: 7 * DAY },
]

// '' = 無期限 / '<ms>' = 期間プリセット / 'at' = 日時指定
const expiryMode = ref(
  expiresAt.value != null
    ? 'at'
    : expiredAfter.value != null
      ? String(expiredAfter.value)
      : '',
)

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * MINUTE)
  return d.toISOString().slice(0, 16)
}

const expiresAtLocal = ref(
  expiresAt.value != null ? toDatetimeLocal(expiresAt.value) : '',
)
const minDatetimeLocal = toDatetimeLocal(Date.now())

function onExpiryModeChange() {
  if (expiryMode.value === 'at') {
    expiredAfter.value = null
    // 日時未入力の間は無期限扱い (入力で expiresAt がセットされる)
    expiresAt.value = expiresAtLocal.value
      ? new Date(expiresAtLocal.value).getTime()
      : null
  } else {
    expiresAt.value = null
    expiredAfter.value = expiryMode.value ? Number(expiryMode.value) : null
  }
}

function onExpiresAtInput() {
  expiresAt.value = expiresAtLocal.value
    ? new Date(expiresAtLocal.value).getTime()
    : null
}

// Stable keys for poll choices (avoid index-based v-for key bugs on add/remove)
let keyCounter = 0
const choiceKeys = ref<number[]>(props.choices.map(() => keyCounter++))

function addChoice() {
  emit('add')
  choiceKeys.value.push(keyCounter++)
}

function removeChoice(index: number) {
  emit('remove', index)
  choiceKeys.value.splice(index, 1)
}

// 下書き復元などで choices が丸ごと差し替わった場合はキーを振り直す。
// add / remove 経由の増減は上で同期済みなので、長さ不一致のときだけ。
watch(
  () => props.choices.length,
  (len) => {
    if (choiceKeys.value.length === len) return
    choiceKeys.value = props.choices.map(() => keyCounter++)
  },
)
</script>

<template>
  <div :class="$style.pollEditor">
    <div v-for="(_, i) in choices" :key="choiceKeys[i]" :class="$style.pollChoiceRow">
      <input
        v-model="choices[i]"
        :class="$style.pollChoiceInput"
        :placeholder="`選択肢 ${i + 1}`"
      />
      <button
        v-if="choices.length > 2"
        class="_button"
        :class="$style.pollChoiceRemove"
        @click="removeChoice(i)"
      >
        <i class="ti ti-x" />
      </button>
    </div>
    <div :class="$style.pollActions">
      <button
        v-if="choices.length < 10"
        class="_button"
        :class="$style.pollAddBtn"
        @click="addChoice"
      >
        <i class="ti ti-plus" /> 選択肢を追加
      </button>
      <label :class="$style.pollMultipleLabel">
        <input v-model="multiple" type="checkbox" />
        複数選択
      </label>
      <label :class="$style.pollExpiryLabel">
        期限
        <select
          v-model="expiryMode"
          :class="$style.pollExpirySelect"
          @change="onExpiryModeChange"
        >
          <option value="">無期限</option>
          <option v-for="p in expiryPresets" :key="p.ms" :value="String(p.ms)">
            {{ p.label }}
          </option>
          <option value="at">日時指定</option>
        </select>
      </label>
      <input
        v-if="expiryMode === 'at'"
        v-model="expiresAtLocal"
        type="datetime-local"
        :min="minDatetimeLocal"
        :class="$style.pollExpiryDatetime"
        @input="onExpiresAtInput"
      />
    </div>
  </div>
</template>

<style lang="scss" module>
.pollEditor {
  padding: 8px 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pollChoiceRow {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pollChoiceInput {
  flex: 1;
  padding: 6px 10px;
  font-size: 0.9em;
  font-family: inherit;
  color: var(--nd-fg);
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  outline: none;

  &::placeholder {
    color: var(--nd-fg);
    opacity: 0.35;
  }
}

.pollChoiceRemove {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--nd-radius-sm);
  color: var(--nd-fg);
  opacity: 0.5;
  flex-shrink: 0;

  &:hover {
    opacity: 1;
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}

.pollActions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding-top: 2px;
}

.pollAddBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 0.8em;
  color: var(--nd-accent);
  border-radius: var(--nd-radius-sm);

  &:hover {
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
  }
}

.pollMultipleLabel {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.7;
  cursor: pointer;
}

.pollExpiryLabel {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  color: var(--nd-fg);
  opacity: 0.7;
}

.pollExpirySelect,
.pollExpiryDatetime {
  padding: 4px 6px;
  font-size: inherit;
  font-family: inherit;
  color: var(--nd-fg);
  background: var(--nd-buttonBg);
  border: none;
  border-radius: var(--nd-radius-sm);
  outline: none;
}

.pollExpiryDatetime {
  font-size: 0.8em;
}
</style>
