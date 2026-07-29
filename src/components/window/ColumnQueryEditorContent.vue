<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NormalizedNote } from '@/adapters/types'
import AiScriptEditor from '@/components/deck/widgets/AiScriptEditor.vue'
import { compileColumnQuery } from '@/services/columnQuery/compiler'
import { evaluateQirQuery } from '@/services/columnQuery/evaluator'
import { useDeckStore } from '@/stores/deck'
import { useToast } from '@/stores/toast'

/**
 * カラムクエリ編集ウィンドウ (#783 Phase 1)。
 *
 * AiScript 式 (v1 サブセット) でカラムの視界を定義する。保存できるのは
 * QIR コンパイルが通る式のみ (Phase 2 で逐次適用 fallback へ降格対応予定)。
 * dry-run はカラムのロード済みノート (deckStore.visibleNotesByColumn) に
 * 適用した通過数を出す (仕様追補 E)。
 */

const props = defineProps<{
  columnId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const deckStore = useDeckStore()
const toast = useToast()

const column = computed(() => deckStore.getColumn(props.columnId))
const source = ref(column.value?.noteQuery ?? '')

const compiled = computed(() => {
  const src = source.value
  if (src.trim() === '') return null
  return compileColumnQuery(src)
})

const diagnostics = computed(() =>
  compiled.value && !compiled.value.ok ? compiled.value.diagnostics : [],
)

/** ロード済みノートに対する dry-run (保存前プレビュー)。 */
const dryRun = computed(() => {
  const c = compiled.value
  if (!c?.ok) return null
  const notes = (deckStore.visibleNotesByColumn[props.columnId] ??
    []) as NormalizedNote[]
  if (notes.length === 0) return null
  let match = 0
  let error = 0
  for (const note of notes) {
    const v = evaluateQirQuery(c.query, note)
    if (v === 'match') match++
    else if (v === 'error') error++
  }
  return { total: notes.length, match, error }
})

const canSave = computed(
  () => source.value.trim() === '' || compiled.value?.ok === true,
)
const isDirty = computed(() => source.value !== (column.value?.noteQuery ?? ''))

function save(): void {
  if (!canSave.value) return
  const trimmed = source.value.trim()
  deckStore.updateColumn(props.columnId, {
    noteQuery: trimmed === '' ? undefined : source.value,
  })
  toast.show(
    trimmed === '' ? 'クエリを解除しました' : 'クエリを保存しました',
    'success',
  )
  emit('close')
}

function clear(): void {
  source.value = ''
}
</script>

<template>
  <div :class="$style.root">
    <div :class="$style.columnName">
      <i class="ti ti-layout-columns" />
      <span>{{ column?.name || 'カラム' }}</span>
    </div>

    <div :class="$style.hint">
      AiScript 式でこのカラムに流すノートを定義します (true = 表示)。
      例: <code>note.text != null && note.text.incl("misskey")</code>
    </div>

    <AiScriptEditor
      v-model="source"
      placeholder="note.text != null && note.text.incl(&quot;キーワード&quot;)"
      max-height="320px"
      auto-height
    />

    <!-- コンパイル状態 -->
    <div v-if="source.trim() !== ''" :class="$style.status">
      <template v-if="compiled?.ok">
        <span :class="$style.statusFast">
          <i class="ti ti-bolt" />高速クエリ (QIR {{ compiled.nodeCount }} ノード)
        </span>
        <span v-if="dryRun" :class="$style.dryRun">
          ロード済み {{ dryRun.total }} 件中 {{ dryRun.match }} 件通過<template
            v-if="dryRun.error > 0"
          >・エラー {{ dryRun.error }} 件 (除外)</template>
        </span>
      </template>
      <ul v-else :class="$style.diagnostics">
        <li v-for="(d, i) in diagnostics" :key="i">
          <i class="ti ti-alert-triangle" />
          <span v-if="d.line != null" :class="$style.diagLoc">{{ d.line }}行:</span>
          {{ d.message }}
        </li>
      </ul>
    </div>

    <div :class="$style.actions">
      <button
        v-if="source.trim() !== ''"
        class="_button"
        :class="$style.clearButton"
        @click="clear"
      >
        クリア
      </button>
      <button
        class="_button"
        :class="$style.saveButton"
        :disabled="!canSave || !isDirty"
        @click="save"
      >
        {{ source.trim() === '' && column?.noteQuery ? 'クエリを解除' : '保存' }}
      </button>
    </div>
  </div>
</template>

<style lang="scss" module>
.root {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.columnName {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 0.95em;
}

.hint {
  font-size: 0.8em;
  opacity: 0.7;
  line-height: 1.5;

  code {
    background: var(--nd-bg-secondary, rgba(128, 128, 128, 0.15));
    border-radius: 4px;
    padding: 1px 4px;
  }
}

.status {
  font-size: 0.82em;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.statusFast {
  color: var(--nd-accent, #86b300);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dryRun {
  opacity: 0.75;
}

.diagnostics {
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--nd-love, #ff6b6b);
  display: flex;
  flex-direction: column;
  gap: 2px;

  li {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
}

.diagLoc {
  opacity: 0.7;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.clearButton {
  padding: 6px 14px;
  border-radius: 6px;
  opacity: 0.8;
}

.saveButton {
  padding: 6px 16px;
  border-radius: 6px;
  background: var(--nd-accent, #86b300);
  color: #fff;
  font-weight: 600;

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}
</style>
